import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type {
  Brief, CallStatus, Evidence, Extraction, ExtractedFields, FieldName, Turn,
} from '../types.js';
import { countFieldsPresent, decideVerdict } from './rank.js';

const client = new Anthropic({ apiKey: config.anthropicKey || undefined });

const FIELD_NAMES: FieldName[] = [
  'available', 'baitPivot', 'rentActual', 'depositMonths',
  'brokerageMonths', 'nonVegAllowed', 'tenantProfile', 'extraAnswer',
];

const EXTRACTION_RULES = `You read transcripts of short phone calls between an AI
assistant and a property broker in India, and record ONLY what the broker actually said.

The single rule that matters: if the broker did not say it, do not record it.
A blank field costs the tenant one phone call. A wrong field costs her a Saturday.
Never infer, never average, never carry over a number from the listing, never
guess from context. Omit the field instead.

For every field you record you must supply a "quote" containing the broker's exact
words, copied character-for-character from the transcript. Quotes are checked
programmatically against the transcript; an invented quote discards the field.

Field notes:

- available: true only if the broker offered a concrete way to see THIS flat
  (a day, a time, "anytime", "come today"). false if they said it is gone, taken,
  rented, or on hold. Vagueness alone is not false — leave it null.

- baitPivot: true when the broker steers away from the flat that was asked about
  and toward a different property ("I have a better one", "that one is gone but
  I can show you another in the same area"). This is the strongest available
  signal that a listing is dead, so record it whenever it happens, including
  when the broker also claims the original flat is available.

- rentActual: the monthly rent in rupees, as a plain integer. "Thirty-two
  thousand" is 32000. "32k" is 32000. "1.2 lakh" is 120000. If the broker
  corrected themselves after a read-back, record the CORRECTED number and quote
  the correction.

- depositMonths: deposit expressed in months of rent. "Three months" is 3.
  If they gave an absolute rupee figure, divide by rentActual only when you have
  recorded rentActual from the transcript; otherwise leave null.

- brokerageMonths: brokerage in months of rent. "One month" is 1. "Half month"
  is 0.5. "No brokerage" is 0.

- nonVegAllowed: true or false, only if explicitly addressed.

- tenantProfile: one of family_only, bachelors_ok, working_women_ok, anyone.
  "Owner prefers family but working women are fine" is working_women_ok.

- extraAnswer: a short verbatim-grounded answer to the tenant's custom question,
  if one was asked and answered.

Record every field the broker addressed, and nothing else. If the call ended after
one question because the flat was gone, record only what you have.`;

const recordListing: Anthropic.Tool = {
  name: 'record_listing',
  description:
    'Record only fields the broker explicitly stated. Omit anything unstated.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['fields', 'notes'],
    properties: {
      fields: {
        type: 'array',
        description: 'One entry per field the broker actually addressed.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'value', 'quote'],
          properties: {
            name: { type: 'string', enum: FIELD_NAMES },
            value: {
              type: 'string',
              description:
                'The value as a plain string: "32000", "true", "false", "3", "0.5", ' +
                'or one of the tenantProfile enum values.',
            },
            quote: {
              type: 'string',
              description:
                "The broker's exact words from the transcript, copied verbatim.",
            },
          },
        },
      },
      notes: {
        type: 'string',
        description:
          'One short sentence of context a tenant would want, or an empty string.',
      },
    },
  },
};

interface ToolInput {
  fields: { name: FieldName; value: string; quote: string }[];
  notes: string;
}

/** Loose enough to survive transcript formatting, tight enough to catch invention. */
export const normalise = (s: string): string =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const EMPTY_FIELDS: ExtractedFields = {
  available: null, baitPivot: null, rentActual: null, depositMonths: null,
  brokerageMonths: null, nonVegAllowed: null, tenantProfile: null, extraAnswer: null,
};

function coerce(name: FieldName, raw: string): unknown {
  const v = raw.trim();
  switch (name) {
    case 'available':
    case 'baitPivot':
    case 'nonVegAllowed': {
      const t = v.toLowerCase();
      if (t === 'true' || t === 'yes') return true;
      if (t === 'false' || t === 'no') return false;
      return null;
    }
    case 'rentActual': {
      const n = Number(v.replace(/[^\d.]/g, ''));
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }
    case 'depositMonths':
    case 'brokerageMonths': {
      const n = Number(v.replace(/[^\d.]/g, ''));
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    case 'tenantProfile': {
      const t = v.toLowerCase().replace(/\s+/g, '_');
      return ['family_only', 'bachelors_ok', 'working_women_ok', 'anyone'].includes(t)
        ? t : null;
    }
    case 'extraAnswer':
      return v.length ? v : null;
    default:
      return null;
  }
}

export interface ExtractResult {
  extraction: Extraction;
  /** Fields the model returned whose quote was not in the transcript. */
  rejected: { name: string; quote: string }[];
}

export interface AcceptedFields {
  fields: ExtractedFields;
  evidence: Partial<Record<FieldName, Evidence>>;
  rejected: { name: string; quote: string }[];
}

/**
 * The hallucination guard, as a pure function so it can be tested without an
 * API key. A field whose quote is not literally present in what the broker said
 * is discarded and stays null. The model cannot talk its way past this.
 */
export function acceptFields(
  claimed: { name: FieldName; value: string; quote: string }[],
  brokerTurns: Turn[],
): AcceptedFields {
  const fields: ExtractedFields = { ...EMPTY_FIELDS };
  const evidence: Partial<Record<FieldName, Evidence>> = {};
  const rejected: { name: string; quote: string }[] = [];

  const haystack = normalise(brokerTurns.map((t) => t.text).join(' '));

  for (const f of claimed) {
    const needle = normalise(f.quote ?? '');
    if (!needle || !haystack.includes(needle)) {
      rejected.push({ name: f.name, quote: f.quote });
      continue;
    }
    const value = coerce(f.name, f.value);
    if (value === null) {
      rejected.push({ name: f.name, quote: f.quote });
      continue;
    }
    const turn = brokerTurns.find((t) => normalise(t.text).includes(needle));
    (fields as unknown as Record<string, unknown>)[f.name] = value;
    evidence[f.name] = {
      quote: f.quote,
      tStartMs: turn?.tStartMs ?? null,
      tEndMs: turn?.tEndMs ?? null,
    };
  }

  return { fields, evidence, rejected };
}

export async function extractFromTranscript(
  callId: string,
  turns: Turn[],
  brief: Brief,
  callStatus: CallStatus,
): Promise<ExtractResult> {
  const brokerTurns = turns.filter((t) => t.who === 'broker');
  const rendered = turns
    .map((t) => `${t.who === 'agent' ? 'AGENT' : 'BROKER'}: ${t.text}`)
    .join('\n');

  let fields: ExtractedFields = { ...EMPTY_FIELDS };
  let evidence: Partial<Record<FieldName, Evidence>> = {};
  let rejected: { name: string; quote: string }[] = [];
  let notes: string | null = null;
  let model = config.extractionModel;

  if (brokerTurns.length > 0) {
    const res = await client.messages.create({
      model: config.extractionModel,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: EXTRACTION_RULES, cache_control: { type: 'ephemeral' } },
      ],
      tools: [recordListing],
      tool_choice: { type: 'tool', name: 'record_listing' },
      messages: [
        {
          role: 'user',
          content:
            (brief.extraQuestion
              ? `The tenant's custom question was: "${brief.extraQuestion}"\n\n`
              : '') + `Transcript:\n\n${rendered}`,
        },
      ],
    });
    model = res.model;

    const block = res.content.find((b) => b.type === 'tool_use');
    if (block && block.type === 'tool_use') {
      const input = block.input as ToolInput;
      notes = input.notes?.trim() ? input.notes.trim() : null;

      const accepted = acceptFields(input.fields ?? [], brokerTurns);
      fields = accepted.fields;
      evidence = accepted.evidence;
      rejected = accepted.rejected;
    }
  }

  return {
    extraction: {
      callId,
      model,
      extractedAt: new Date().toISOString(),
      ...fields,
      notes,
      fieldsPresent: countFieldsPresent(fields),
      evidence,
      verdict: decideVerdict(fields, brief, callStatus),
    },
    rejected,
  };
}
