import type { Brief, Language, Question } from '../types.js';

export interface ScriptStep {
  id: string;
  ask: string;
  confirmNumeric: boolean;
  exitIf?: 'flat_is_gone';
}

export interface RenderedScript {
  opener: string;
  onConsentRefused: string;
  close: string;
  steps: ScriptStep[];
  systemPrompt: string;
  language: Language;
}

interface LanguageCopy {
  name: string;
  opener: string;
  onConsentRefused: string;
  close: string;
  viewingAsk: string;
}

const COPY: Record<Language, LanguageCopy> = {
  en: {
    name: 'English',
    opener:
      "Hello, I'm an AI assistant calling on behalf of a tenant about your listing " +
      'in {locality}. This will take under a minute, and I am recording it so they ' +
      'can hear your answers. Is that alright?',
    onConsentRefused:
      "No problem, I won't record. I'll ask them to call you directly instead. Thank you.",
    close: "That's everything, thank you. They'll call you back directly if it fits.",
    viewingAsk: 'When can they come and see the flat?',
  },
  hi: {
    name: 'Hindi',
    opener:
      'Namaste, main ek AI assistant hoon aur ek tenant ki taraf se {locality} mein ' +
      'aapki listing ke baare mein baat kar raha hoon. Yeh ek minute se kam ka hai, ' +
      'aur main isse recording kar raha hoon taaki woh aapke jawab sun sakein. Kya ' +
      'yeh sahi hai?',
    onConsentRefused:
      'Koi baat nahi, main record nahi karunga. Main unhe seedhe aapko call karne ' +
      'ke liye kahunga. Dhanyawad.',
    close: 'Bas itna hi, dhanyawad. Agar sahi laga toh woh aapko seedhe call karenge.',
    viewingAsk: 'Woh flat dekhne kab aa sakte hain?',
  },
  te: {
    name: 'Telugu',
    opener:
      'Namaskaram, nenu oka AI assistant ni mariyu oka tenant tarapu nundi mee ' +
      '{locality} listing gurinchi maatladutunnanu. Idi okka nimisham kante ' +
      'takkuva samayam padutundi, mariyu meeru cheppedi vinataniki nenu ee call ni ' +
      'recording chestunnanu. Sare naa?',
    onConsentRefused:
      'Parledu, nenu record cheyanu. Vaalu meeku nerugaa call cheyamani cheputanu. ' +
      'Dhanyavaadamulu.',
    close: 'Ala aithe ivi anni, dhanyavaadamulu. Sarigga sarithe vaalu meeku nerugaa ' +
      'call chestaru.',
    viewingAsk: 'Aa flat ni chudataniki eppudu randi?',
  },
};

const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

const isNumericQuestion = (q: Question): boolean =>
  /rent|deposit|brokerage|price|cost|fee/i.test(q.text);

export function buildScript(
  brief: Brief,
  listing: { locality: string | null; rentListed: number | null },
): RenderedScript {
  const copy = COPY[brief.language] ?? COPY.en;
  const vars = { locality: listing.locality ?? brief.city };

  const steps: ScriptStep[] = [
    {
      id: '__viewing__',
      ask: copy.viewingAsk,
      confirmNumeric: false,
      exitIf: 'flat_is_gone',
    },
    ...brief.questions.map((q) => ({
      id: q.id,
      ask: q.text,
      confirmNumeric: isNumericQuestion(q),
    })),
  ];

  const systemPrompt = [
    'You are placing a short outbound call to a property broker in India on behalf',
    'of a tenant who is house-hunting. You are not selling anything.',
    '',
    `Conduct the entire call in ${copy.name}. If the broker responds in a`,
    'different language, switch to match them.',
    '',
    'Rules, in order of importance:',
    '1. Say the opener exactly as written. Never claim to be a human.',
    '2. Ask the questions in order. Do not add pleasantries, small talk, or filler.',
    '3. If the broker says the flat is gone, or pivots to a different property,',
    '   thank them and end the call immediately. Do not ask the remaining questions.',
    '4. When a step is marked confirmNumeric, read the numbers back once and',
    '   accept their correction. Rupee figures over a phone line are easy to mishear.',
    '5. Never state a rent, a budget, or any offer. You are only collecting answers.',
    '6. Never agree to book a viewing. Say the tenant will call back directly.',
    '',
    `The tenant is looking in ${brief.city}.`,
    listing.rentListed ? `The listing shows a rent of Rs ${listing.rentListed}.` : '',
    'Do not mention the listed rent unless the broker raises it first.',
  ].filter(Boolean).join('\n');

  return {
    opener: fill(copy.opener, vars),
    onConsentRefused: copy.onConsentRefused,
    close: copy.close,
    steps,
    systemPrompt,
    language: brief.language,
  };
}

export function assertScriptCompliance(): void {
  for (const lang of Object.keys(COPY) as Language[]) {
    const opener = COPY[lang].opener.toLowerCase();
    if (!/\bai\b|automated|assistant/.test(opener)) {
      throw new Error(`COMPLIANCE: ${lang} opener must disclose that the caller is an AI`);
    }
    if (!opener.includes('recording')) {
      throw new Error(`COMPLIANCE: ${lang} opener must ask for consent to record`);
    }
    const promo = ['offer', 'discount', 'deal', 'best price', 'sign up', 'we provide'];
    const allText = [COPY[lang].opener, COPY[lang].close].join(' ').toLowerCase();
    for (const p of promo) {
      if (allText.includes(p)) {
        throw new Error(`COMPLIANCE: ${lang} script contains promotional language: "${p}"`);
      }
    }
  }
}
