import Groq from 'groq-sdk';
import { config } from '../config.js';
import type {
  Brief, CallStatus, Extraction, QuestionAnswer, Turn,
} from '../types.js';
import { decideVerdict } from './rank.js';

const groq = new Groq({ apiKey: config.groqKey || undefined });

const EXTRACTION_RULES = `You read transcripts of short phone calls between an AI
assistant and a property broker in India, and record ONLY what the broker actually
said.

The single rule that matters: if the broker did not say it, do not record it.
A blank field costs the tenant one phone call. A wrong field costs her a Saturday.
Never infer, never average, never carry over a number from the listing, never
guess from context. Leave it empty instead.

For every answer you record you must supply a "quote" containing the broker's
exact words, copied character-for-character from the transcript. Quotes are
checked programmatically against the transcript; an invented quote discards the
answer.

available: "yes" only if the broker offered a concrete way to see THIS flat (a
day, a time, "anytime", "come today"). "no" if they said it is gone, taken,
rented, or on hold. "unknown" if merely vague.

bait_pivot: "yes" when the broker steers away from the flat that was asked about
and toward a different property. This is the strongest signal a listing is dead
— record it even when the broker also claims the original flat is available.

rent_actual: the monthly rent in rupees, as a plain integer string. "Thirty-two
thousand" is "32000". "32k" is "32000". "1.2 lakh" is "120000". Empty string if
never stated.

answers: one entry per question that the broker actually addressed, matched to
its question_id. Omit a question entirely if the broker never addressed it.`;

function buildTool(questions: { id: string; text: string }[]): Groq.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: 'record_listing',
      description: 'Record only what the broker explicitly stated. Omit anything unstated.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['available', 'bait_pivot', 'rent_actual', 'answers', 'notes'],
        properties: {
          available: { type: 'string', enum: ['yes', 'no', 'unknown'] },
          bait_pivot: { type: 'string', enum: ['yes', 'no', 'unknown'] },
          rent_actual: { type: 'string' },
          answers: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['question_id', 'value', 'quote'],
              properties: {
                question_id: { type: 'string', enum: questions.map((q) => q.id) },
                value: { type: 'string' },
                quote: { type: 'string' },
              },
            },
          },
          notes: { type: 'string' },
        },
      },
    },
  };
}

export const normalise = (s: string): string =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const yesNo = (v: string | undefined): boolean | null => {
  const t = (v ?? '').trim().toLowerCase();
  if (t === 'yes') return true;
  if (t === 'no') return false;
  return null;
};

const numOrNull = (v: string | undefined): number | null => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

interface ToolAnswer { question_id: string; value: string; quote: string }
interface ToolInput {
  available: string; bait_pivot: string; rent_actual: string;
  answers: ToolAnswer[]; notes: string;
}

export interface ExtractResult {
  extraction: Extraction;
  rejected: { questionId: string; quote: string }[];
}

export function buildAnswers(
  brief: Brief,
  claimed: ToolAnswer[],
  brokerTurns: Turn[],
): { answers: QuestionAnswer[]; rejected: { questionId: string; quote: string }[] } {
  const haystack = normalise(brokerTurns.map((t) => t.text).join(' '));
  const byId = new Map(claimed.map((a) => [a.question_id, a]));
  const rejected: { questionId: string; quote: string }[] = [];

  const answers: QuestionAnswer[] = brief.questions.map((q) => {
    const claim = byId.get(q.id);
    if (!claim || !claim.value?.trim()) {
      return {
        questionId: q.id, text: q.text, required: q.required,
        answer: null, quote: null, tStartMs: null, tEndMs: null,
      };
    }
    const needle = normalise(claim.quote ?? '');
    if (!needle || !haystack.includes(needle)) {
      rejected.push({ questionId: q.id, quote: claim.quote });
      return {
        questionId: q.id, text: q.text, required: q.required,
        answer: null, quote: null, tStartMs: null, tEndMs: null,
      };
    }
    const turn = brokerTurns.find((t) => normalise(t.text).includes(needle));
    return {
      questionId: q.id, text: q.text, required: q.required,
      answer: claim.value.trim(), quote: claim.quote,
      tStartMs: turn?.tStartMs ?? null, tEndMs: turn?.tEndMs ?? null,
    };
  });

  return { answers, rejected };
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

  let available: boolean | null = null;
  let baitPivot: boolean | null = null;
  let rentActual: number | null = null;
  let answers: QuestionAnswer[] = brief.questions.map((q) => ({
    questionId: q.id, text: q.text, required: q.required,
    answer: null, quote: null, tStartMs: null, tEndMs: null,
  }));
  let rejected: { questionId: string; quote: string }[] = [];
  let notes: string | null = null;
  let model = config.extractionModel;

  if (brokerTurns.length > 0 && brief.questions.length > 0) {
    const res = await groq.chat.completions.create({
      model: config.extractionModel,
      messages: [
        { role: 'system', content: EXTRACTION_RULES },
        {
          role: 'user',
          content:
            `Questions to look for answers to:\n` +
            brief.questions.map((q) => `${q.id}: ${q.text}`).join('\n') +
            `\n\nTranscript:\n\n${rendered}`,
        },
      ],
      tools: [buildTool(brief.questions)],
      tool_choice: { type: 'function', function: { name: 'record_listing' } },
    });
    model = res.model;

    const toolCall = res.choices[0]?.message?.tool_calls?.[0];
    if (toolCall) {
      const input = JSON.parse(toolCall.function.arguments) as ToolInput;
      available = yesNo(input.available);
      baitPivot = yesNo(input.bait_pivot);
      rentActual = numOrNull(input.rent_actual);
      notes = input.notes?.trim() ? input.notes.trim() : null;

      const built = buildAnswers(brief, input.answers ?? [], brokerTurns);
      answers = built.answers;
      rejected = built.rejected;
    }
  }

  const matchScore = answers.filter((a) => a.answer !== null).length;

  return {
    extraction: {
      callId, model, extractedAt: new Date().toISOString(),
      available, baitPivot, rentActual, notes, answers,
      matchScore, totalQuestions: answers.length,
      verdict: decideVerdict(answers, available, baitPivot, rentActual, brief, callStatus),
    },
    rejected,
  };
}

export function fromDialerResult(
  callId: string,
  fields: { available: boolean | null; baitPivot: boolean | null; rentActual: number | null; notes: string | null; answers: { questionId: string; answer: string | null }[] },
  turns: Turn[],
  brief: Brief,
  callStatus: CallStatus,
): Extraction {
  const brokerTurns = turns.filter((t) => t.who === 'broker');
  const byId = new Map(fields.answers.map((a) => [a.questionId, a.answer]));

  const findText = (value: string): Turn | undefined => {
    const needle = normalise(value);
    return brokerTurns.find((t) => normalise(t.text).includes(needle));
  };

  const answers: QuestionAnswer[] = brief.questions.map((q) => {
    const answer = byId.get(q.id) ?? null;
    const turn = answer ? findText(answer) : undefined;
    return {
      questionId: q.id, text: q.text, required: q.required, answer,
      quote: turn?.text ?? null, tStartMs: turn?.tStartMs ?? null, tEndMs: turn?.tEndMs ?? null,
    };
  });

  const matchScore = answers.filter((a) => a.answer !== null).length;

  return {
    callId,
    model: 'calle:recipient_result_schema',
    extractedAt: new Date().toISOString(),
    available: fields.available,
    baitPivot: fields.baitPivot,
    rentActual: fields.rentActual,
    notes: fields.notes,
    answers,
    matchScore,
    totalQuestions: answers.length,
    verdict: decideVerdict(answers, fields.available, fields.baitPivot, fields.rentActual, brief, callStatus),
  };
}
