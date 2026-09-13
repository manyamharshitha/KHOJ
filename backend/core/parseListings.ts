import Groq from 'groq-sdk';
import { config } from '../config.js';
import { toE164 } from './guardrails.js';
import type { ListingInput } from '../types.js';

/** Lazy: Groq's constructor throws without a key, and this module is imported
 * at boot. See core/extract.ts for the full reasoning. */
let groqClient: Groq | null = null;
function groq(): Groq {
  if (!groqClient) {
    if (!config.groqKey) throw new Error('GROQ_API_KEY is not set');
    groqClient = new Groq({ apiKey: config.groqKey });
  }
  return groqClient;
}

const PHONE_RUN = /\+?\d[\d\s\-().]{7,18}\d/g;

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

const ATTACH_DETAILS_TOOL: Groq.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'attach_details',
    description:
      'Attach the rent, locality and reference for each phone number that the ' +
      'text actually states. Omit anything the text does not say.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['listings'],
      properties: {
        listings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['phone', 'rentListed', 'locality', 'extRef'],
            properties: {
              phone: { type: 'string' },
              rentListed: { type: 'string' },
              locality: { type: 'string' },
              extRef: { type: 'string' },
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
answer whenever the text does not say.`;

export interface ParseResult {
  listings: ListingInput[];
  enriched: boolean;
  note?: string;
}

export async function parseListings(text: string): Promise<ParseResult> {
  const phones = extractPhoneCandidates(text);
  if (phones.length === 0) {
    return { listings: [], enriched: false, note: 'No phone numbers found in that text.' };
  }

  const bare: ListingInput[] = phones.map((phone) => ({ phone }));

  if (!config.groqKey) {
    return { listings: bare, enriched: false, note: 'No GROQ_API_KEY set — returning phone numbers only.' };
  }

  try {
    const res = await groq().chat.completions.create({
      model: config.extractionModel,
      messages: [
        { role: 'system', content: RULES },
        {
          role: 'user',
          content: `Phone numbers found in the text:\n${phones.join('\n')}\n\nText:\n\n${text}`,
        },
      ],
      tools: [ATTACH_DETAILS_TOOL],
      tool_choice: { type: 'function', function: { name: 'attach_details' } },
    });

    const toolCall = res.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) return { listings: bare, enriched: false };

    const { listings } = JSON.parse(toolCall.function.arguments) as { listings: Enrichment[] };
    const byPhone = new Map<string, Enrichment>();
    for (const l of listings ?? []) {
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
    return { listings: bare, enriched: false, note: 'Could not read the details — returning phone numbers only.' };
  }
}
