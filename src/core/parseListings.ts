import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { toE164 } from './guardrails.js';
import type { ListingInput } from '../types.js';

const client = new Anthropic({ apiKey: config.anthropicKey || undefined });

/**
 * Runs of digits and separators long enough to be a phone number. Letters break
 * a run, so "Rent 28,000 deposit 3" yields "28000" and "3", both of which fail
 * toE164 and are discarded.
 */
const PHONE_RUN = /\+?\d[\d\s\-().]{7,18}\d/g;

/**
 * Every dialable number in the text, in order, deduplicated.
 *
 * Deterministic on purpose. The phone number is the one field where a wrong
 * value means calling a stranger, so it is never left to a model — the model
 * only gets to attach rent and locality to numbers found here.
 */
export function extractPhoneCandidates(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const run of text.match(PHONE_RUN) ?? []) {
    const e164 = toE164(run);
    if (e164 && !seen.has(e164)) {
      seen.add(e164);
      out.push(e164);
    }
  }
  return out;
}

interface Enrichment {
  phone: string;
  rentListed?: number | null;
  locality?: string | null;
  extRef?: string | null;
}

const attachDetails: Anthropic.Tool = {
  name: 'attach_details',
  description:
    'Attach the rent, locality and reference for each phone number that the ' +
    'text actually states. Omit anything the text does not say.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['listings'],
    properties: {
      listings: {
        type: 'array',
        description: 'One entry per phone number you were given. Keep the order.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['phone', 'rentListed', 'locality', 'extRef'],
          properties: {
            phone: {
              type: 'string',
              description: 'Copied exactly from the list of numbers provided.',
            },
            rentListed: {
              type: 'string',
              description:
                'Monthly rent as a plain integer string, e.g. "28000". ' +
                '"28k" is 28000, "1.2 lakh" is 120000. Empty string if unstated.',
            },
            locality: {
              type: 'string',
              description:
                'Area or neighbourhood, e.g. "Kondapur". Empty string if unstated.',
            },
            extRef: {
              type: 'string',
              description:
                'Any listing id or reference the text gives. Empty string if none.',
            },
          },
        },
      },
    },
  },
};

const RULES = `You are given a block of text a house-hunter copied from a rental
portal, a WhatsApp forward, or her own notes, plus the phone numbers already
found in it.

For each phone number, attach only the rent, locality and reference that the
text actually states for that number. The text is messy and the details are not
always adjacent to the number they belong to — use the layout to decide which
detail goes with which number.

Never invent a number, never carry a rent from one listing to another, and never
guess a locality from a phone number's prefix. An empty string is the correct
answer whenever the text does not say. A blank field costs nothing; a wrong rent
makes the tenant's whole comparison useless.`;

export interface ParseResult {
  listings: ListingInput[];
  /** True when details came from a model; false when it was numbers only. */
  enriched: boolean;
  note?: string;
}

/**
 * Turns pasted text into listings ready for POST /api/runs.
 *
 * Degrades rather than fails: with no API key, or if the model call errors, you
 * still get every phone number in the text. The seeker can fill in rents by
 * hand, and the run still works — rentListed is optional.
 */
export async function parseListings(text: string): Promise<ParseResult> {
  const phones = extractPhoneCandidates(text);
  if (phones.length === 0) {
    return { listings: [], enriched: false, note: 'No phone numbers found in that text.' };
  }

  const bare: ListingInput[] = phones.map((phone) => ({ phone }));

  if (!config.anthropicKey && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return {
      listings: bare,
      enriched: false,
      note: 'No ANTHROPIC_API_KEY set — returning phone numbers only.',
    };
  }

  try {
    const res = await client.messages.create({
      model: config.extractionModel,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: RULES, cache_control: { type: 'ephemeral' } }],
      tools: [attachDetails],
      tool_choice: { type: 'tool', name: 'attach_details' },
      messages: [
        {
          role: 'user',
          content:
            `Phone numbers found in the text:\n${phones.join('\n')}\n\n` +
            `Text:\n\n${text}`,
        },
      ],
    });

    const block = res.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') return { listings: bare, enriched: false };

    const { listings } = block.input as { listings: Enrichment[] };
    const byPhone = new Map<string, Enrichment>();
    for (const l of listings ?? []) {
      // The guard: a number the model produced that is not in the text is
      // dropped, not dialled.
      const e164 = toE164(String(l.phone ?? ''));
      if (e164 && phones.includes(e164)) byPhone.set(e164, l);
    }

    return {
      listings: phones.map((phone, i) => {
        const e = byPhone.get(phone);
        const rent = Number(String(e?.rentListed ?? '').replace(/[^\d]/g, ''));
        const listing: ListingInput = { phone };
        if (Number.isFinite(rent) && rent > 0) listing.rentListed = rent;
        if (e?.locality) listing.locality = String(e.locality).trim() || undefined;
        listing.extRef = (e?.extRef && String(e.extRef).trim())
          ? String(e.extRef).trim()
          : `L-${String(i + 1).padStart(3, '0')}`;
        return listing;
      }),
      enriched: true,
    };
  } catch (err) {
    console.error('[parse] enrichment failed', err);
    return {
      listings: bare,
      enriched: false,
      note: 'Could not read the details — returning phone numbers only.',
    };
  }
}
