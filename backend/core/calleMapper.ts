import type { DialerStructuredResult, DialerWebhookBody, Question, Turn } from '../types.js';

interface CalleTranscriptTurn {
  offset_seconds: number | null;
  speaker: 'bot' | 'user' | 'unknown';
  text: string;
}

interface CalleAttempt {
  id: string;
  phone: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  summary: string | null;
  transcript_turns: CalleTranscriptTurn[] | null;
  provider_call_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
  recording_url?: string | null;
}

interface CalleRecipient {
  id: string;
  phones: string[];
  status: string;
  structured_result: Record<string, unknown> | null;
  summary: string | null;
  attempts: CalleAttempt[] | null;
}

export interface CalleCallTask {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'canceled';
  recipients: CalleRecipient[] | null;
  structured_result: Record<string, unknown> | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  failure_code: string | null;
  failure_message: string | null;
  completed_at: string | null;
}

export interface CalleWebhookEvent {
  id: string;
  type: 'call.completed' | 'call.failed' | 'call.result_validation_failed';
  created_at: string;
  data: CalleCallTask;
}

export const isCalleEvent = (b: unknown): b is CalleWebhookEvent =>
  !!b && typeof b === 'object' &&
  typeof (b as CalleWebhookEvent).type === 'string' &&
  (b as CalleWebhookEvent).type.startsWith('call.') &&
  typeof (b as CalleWebhookEvent).data === 'object';

const speakerToWho = (s: string): Turn['who'] => (s === 'bot' ? 'agent' : 'broker');

export function mapTurns(turns: CalleTranscriptTurn[]): Turn[] {
  return turns.map((t, i) => {
    const start = t.offset_seconds === null ? null : t.offset_seconds * 1000;
    const nextStart = turns[i + 1]?.offset_seconds;
    const end = start === null
      ? null
      : (nextStart === null || nextStart === undefined ? start + 4000 : nextStart * 1000);
    return { who: speakerToWho(t.speaker), text: t.text, tStartMs: start, tEndMs: end };
  });
}

const yesNo = (v: unknown): boolean | null =>
  v === 'yes' ? true : v === 'no' ? false : null;

const numOrNull = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null;
};

export function mapStructuredResult(
  r: Record<string, unknown> | null,
  questions: Question[],
): DialerStructuredResult | null {
  if (!r) return null;
  return {
    available: yesNo(r.available),
    baitPivot: yesNo(r.bait_pivot),
    rentActual: numOrNull(r.rent_actual),
    notes: typeof r.notes === 'string' && r.notes.trim() ? r.notes.trim() : null,
    answers: questions.map((q) => ({
      questionId: q.id,
      answer: typeof r[q.id] === 'string' && (r[q.id] as string).trim()
        ? (r[q.id] as string).trim()
        : null,
    })),
  };
}

function mapStatus(task: CalleCallTask, attempt: CalleAttempt | undefined):
DialerWebhookBody['status'] {
  if (task.status === 'completed' && attempt?.transcript_turns?.length) return 'completed';
  if (task.status === 'canceled') return 'failed';

  const code = (attempt?.failure_code ?? task.failure_code ?? '').toLowerCase();
  if (code.includes('no_answer') || code.includes('noanswer') || code.includes('timeout')) {
    return 'no_answer';
  }
  if (code.includes('busy')) return 'busy';
  if (code.includes('decline') || code.includes('reject')) return 'declined';
  if (task.status === 'completed') return 'no_answer';
  return 'failed';
}

const durationSec = (a: CalleAttempt | undefined): number | null => {
  if (!a?.started_at || !a?.completed_at) return null;
  const ms = Date.parse(a.completed_at) - Date.parse(a.started_at);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : null;
};

export function fromCalleEvent(
  event: CalleWebhookEvent,
  questions: Question[],
): DialerWebhookBody | null {
  const task = event.data;
  const callId = String(task.metadata?.callId ?? '');
  if (!callId) return null;

  const recipient = task.recipients?.[0];
  const attempts = recipient?.attempts ?? [];
  const attempt = attempts[attempts.length - 1];

  const turns = attempt?.transcript_turns?.length ? mapTurns(attempt.transcript_turns) : undefined;
  const fields = mapStructuredResult(recipient?.structured_result ?? null, questions);

  return {
    callId,
    providerCallId: task.id,
    status: mapStatus(task, attempt),
    turns,
    durationSec: durationSec(attempt),
    recordingUrl: attempt?.recording_url ?? null,
    consentRecord: yesNo(recipient?.structured_result?.consent_to_record),
    error: attempt?.failure_message ?? task.failure_message ?? null,
    structuredResult: fields,
  };
}
