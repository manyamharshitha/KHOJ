import type { Brief, FieldName } from '../types.js';

/**
 * The call script is DATA, not a free-form prompt. Every step is declarative so
 * the flow is testable, the median call length is controllable, and the
 * "we don't waste the broker's time" claim is demonstrable rather than hoped for.
 */
export interface ScriptStep {
  id: string;
  /** Utterance template. {placeholders} are filled from the brief and listing. */
  ask: string;
  /** Which extraction fields this step is trying to establish. */
  fields: FieldName[];
  /** Agent reads the number back for confirmation before moving on. */
  confirmNumeric?: boolean;
  /** Skip this step entirely when the brief makes it irrelevant. */
  skipIf?: (brief: Brief) => boolean;
  /** End the call politely once this is known — nothing after it matters. */
  exitIf?: 'flat_is_gone';
}

export interface CallScript {
  opener: string;
  onConsentRefused: string;
  steps: ScriptStep[];
  close: string;
}

/**
 * Question 1 is deliberately NOT "is it still available?".
 *
 * A broker running a bait listing says "yes" to that reflexively and it costs
 * them nothing — and that single answer is what the whole dead-listing statistic
 * rests on. "When can she come and see it?" cannot be answered smoothly without
 * a real, empty flat: a genuine listing gives a specific time, a bait listing
 * goes vague or pivots to a different property. The pivot is itself a signal,
 * on the record, in the broker's own voice.
 *
 * To fall back to the original phrasing, swap `ask` on the `viewing` step —
 * everything downstream is unchanged.
 */
export const SCRIPT: CallScript = {
  opener:
    "Hello — I'm an AI assistant calling for a tenant about your listing in " +
    '{locality}. This will take under a minute, and I am recording it so she ' +
    'can hear your answers. Is that alright?',

  onConsentRefused:
    "No problem, I won't record. I'll ask her to call you directly instead. Thank you.",

  steps: [
    {
      id: 'viewing',
      ask: 'When can she come and see the flat?',
      fields: ['available', 'baitPivot'],
      exitIf: 'flat_is_gone',
    },
    {
      id: 'rent',
      ask: "What's the rent and the deposit right now?",
      fields: ['rentActual', 'depositMonths'],
      confirmNumeric: true,
    },
    {
      id: 'brokerage',
      ask: 'Is there a brokerage on top, and how much?',
      fields: ['brokerageMonths'],
    },
    {
      id: 'food',
      ask: 'Is non-veg allowed in the building?',
      fields: ['nonVegAllowed'],
      skipIf: (b) => !b.vegMatters,
    },
    {
      id: 'profile',
      ask: 'Does the owner rent to bachelors, or is it family only?',
      fields: ['tenantProfile'],
    },
    {
      id: 'extra',
      ask: '{extraQuestion}',
      fields: ['extraAnswer'],
      skipIf: (b) => !b.extraQuestion,
    },
  ],

  close: "That's everything, thank you. She'll call you back directly if it fits.",
};

export interface RenderedScript {
  opener: string;
  onConsentRefused: string;
  close: string;
  steps: { id: string; ask: string; confirmNumeric: boolean; exitIf?: string }[];
  systemPrompt: string;
}

const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

/** Build the concrete script for one call. */
export function buildScript(
  brief: Brief,
  listing: { locality: string | null; rentListed: number | null },
): RenderedScript {
  const vars = {
    locality: listing.locality ?? brief.city,
    extraQuestion: brief.extraQuestion ?? '',
  };

  const steps = SCRIPT.steps
    .filter((s) => !s.skipIf?.(brief))
    .map((s) => ({
      id: s.id,
      ask: fill(s.ask, vars),
      confirmNumeric: s.confirmNumeric ?? false,
      ...(s.exitIf ? { exitIf: s.exitIf } : {}),
    }));

  const systemPrompt = [
    'You are placing a short outbound call to a property broker in India on behalf',
    'of a tenant who is house-hunting. You are not selling anything.',
    '',
    'Rules, in order of importance:',
    '1. Say the opener exactly as written. Never claim to be a human.',
    '2. Ask the questions in order. Do not add pleasantries, small talk, or filler.',
    '3. If the broker says the flat is gone, or pivots to a different property,',
    '   thank them and end the call immediately. Do not ask the remaining questions.',
    '4. When a step is marked confirmNumeric, read the numbers back once',
    '   ("thirty-two thousand rent, three months deposit — correct?") and accept',
    '   their correction. Rupee figures over a phone line are easy to mishear.',
    '5. If the broker answers in Hindi or another language, continue in that language.',
    '6. Never state a rent, a budget, or any offer. You are only collecting answers.',
    '7. Never agree to book a viewing. Say the tenant will call back directly.',
    '',
    `The tenant is looking in ${brief.city}.`,
    listing.rentListed ? `The listing shows a rent of Rs ${listing.rentListed}.` : '',
    'Do not mention the listed rent unless the broker raises it first.',
  ].filter(Boolean).join('\n');

  return {
    opener: fill(SCRIPT.opener, vars),
    onConsentRefused: SCRIPT.onConsentRefused,
    close: SCRIPT.close,
    steps,
    systemPrompt,
  };
}
