import { config } from '../config.js';
import * as db from '../db.js';
import type { CallStatus, DialerWebhookBody } from '../types.js';
import type { Dialer } from './dialer.js';
import { emit } from './events.js';
import { extractFromTranscript, fromDialerResult } from './extract.js';
import { checkCall, insideCallingWindow, nextWindowOpensAt } from './guardrails.js';
import { buildScript } from './script.js';

function semaphore(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    async acquire() {
      if (active < max) { active++; return; }
      await new Promise<void>((resolve) => waiting.push(resolve));
    },
    release() {
      const next = waiting.shift();
      if (next) { next(); return; }
      active--;
    },
    get active() { return active; },
  };
}

let dialer: Dialer;
export const setDialer = (d: Dialer) => { dialer = d; };
export const getDialer = () => dialer;

const running = new Set<string>();
const resumeTimers = new Map<string, NodeJS.Timeout>();
const permits = new Map<string, () => void>();

function releaseCall(callId: string): void {
  const release = permits.get(callId);
  if (release) {
    permits.delete(callId);
    release();
  }
}

function scheduleResume(runId: string, at: string): void {
  void db.setRunStatus('awaiting_retry', runId);
  emit(runId, null, 'run.awaiting_retry', { resumesAt: at });

  const existing = resumeTimers.get(runId);
  if (existing) clearTimeout(existing);

  const delay = Math.max(1_000, Date.parse(at) - Date.now());
  const timer = setTimeout(() => {
    resumeTimers.delete(runId);
    void db.getRunRow(runId).then((row) => {
      if (row && row.status === 'awaiting_retry') void startRun(runId);
    });
  }, delay);
  timer.unref?.();
  resumeTimers.set(runId, timer);
}

export function resetRuntimeState(): void {
  running.clear();
  permits.clear();
  for (const t of resumeTimers.values()) clearTimeout(t);
  resumeTimers.clear();
}

export function cancelResume(runId: string): void {
  const t = resumeTimers.get(runId);
  if (t) {
    clearTimeout(t);
    resumeTimers.delete(runId);
  }
}

export async function startRun(runId: string): Promise<void> {
  if (running.has(runId)) return;
  running.add(runId);
  await db.setRunStatus('running', runId);
  emit(runId, null, 'run.started', { total: (await db.getRunRow(runId))?.total ?? 0 });

  const gate = semaphore(config.maxConcurrent);

  try {
    for (;;) {
      const run = await db.getRunRow(runId);
      if (!run || run.status !== 'running') break;

      if (!insideCallingWindow(new Date())) {
        await db.setRunStatus('paused', runId);
        emit(runId, null, 'run.window_closed', {
          resumesAt: nextWindowOpensAt(new Date()),
        });
        break;
      }

      await gate.acquire();

      const current = await db.getRunRow(runId);
      if (!current || current.status !== 'running') {
        gate.release();
        break;
      }

      const next = await db.claimNextQueuedCall(runId);
      if (!next) {
        gate.release();
        if (gate.active > 0) {
          await sleep(200);
          continue;
        }
        if (!(await db.hasWorkLeft(runId))) break;

        const at = await db.nextClaimableAt(runId);
        if (at) {
          scheduleResume(runId, at);
          break;
        }
        await sleep(200);
        continue;
      }

      permits.set(next.id, () => gate.release());
      void dialOne(next).catch(async (err: unknown) => {
        await db.failCall(next.id, String(err));
        await db.recountFinished(runId);
        emit(runId, next.id, 'call.failed', { error: String(err) });
        releaseCall(next.id);
      });
    }

    while (gate.active > 0) await sleep(150);

    const finalRun = await db.getRunRow(runId);
    if (finalRun?.status === 'running') {
      await db.setRunStatus('done', runId);
      emit(runId, null, 'run.done', null);
    }
  } finally {
    running.delete(runId);
    await db.recountFinished(runId);
  }
}

async function dialOne(call: db.ClaimedCall): Promise<void> {
  const block = await checkCall({ id: call.id, phone_e164: call.phone_e164 });
  if (block) {
    await db.blockCall(call.id, block);
    await db.recountFinished(call.run_id);
    emit(call.run_id, call.id, 'call.blocked', { reason: block });
    releaseCall(call.id);
    return;
  }

  emit(call.run_id, call.id, 'call.dialing', {
    phone: maskPhone(call.phone_e164),
    extRef: call.ext_ref,
  });

  const brief = await db.getBrief(call.run_id);
  const script = buildScript(brief, {
    locality: call.locality,
    rentListed: call.rent_listed,
  });

  const { providerCallId } = await dialer.placeCall({
    callId: call.id,
    toE164: call.phone_e164,
    fromE164: config.callerId || '+910000000000',
    script,
    brief,
    metadata: { runId: call.run_id, attempt: String(call.attempt) },
  });

  await db.attachProviderId(call.id, providerCallId);
}

export async function handleCallResult(body: DialerWebhookBody): Promise<'ok' | 'duplicate'> {
  const call = await db.getCall(body.callId);
  if (!call) throw new Error(`unknown callId ${body.callId}`);

  if (call.status !== 'dialing' && call.status !== 'live') return 'duplicate';
  if (await db.getExtraction(call.id)) return 'duplicate';

  const status = body.status as CallStatus;

  if (status !== 'completed') {
    const retried =
      (status === 'no_answer' || status === 'busy') &&
      (await db.scheduleRetry(call.id, config.retryDelayMin, config.maxAttempts));

    releaseCall(call.id);
    if (retried) {
      emit(call.run_id, call.id, 'call.retry_scheduled', { status });
    } else {
      await db.finishCall(call.id, status, body.durationSec ?? null, null, null, body.error ?? null);
      await db.recountFinished(call.run_id);
      emit(call.run_id, call.id, 'call.done', { status, verdict: 'unreachable' });
    }
    return 'ok';
  }

  await db.finishCall(
    call.id, 'completed', body.durationSec ?? null,
    body.recordingUrl ?? null, body.consentRecord ?? null, null,
  );
  if (body.turns?.length) await db.saveTranscript(call.id, body.turns, body);
  releaseCall(call.id);
  emit(call.run_id, call.id, 'call.answered', { durationSec: body.durationSec });

  await runExtraction(call.id, call.run_id, body.structuredResult ?? null);
  await db.recountFinished(call.run_id);
  return 'ok';
}

export async function runExtraction(
  callId: string,
  runId: string,
  fromDialer?: DialerWebhookBody['structuredResult'],
): Promise<void> {
  const turns = await db.getTranscript(callId);
  const call = await db.getCall(callId);
  if (!turns || !call) return;

  const brief = await db.getBrief(runId);

  if (fromDialer) {
    const extraction = fromDialerResult(callId, fromDialer, turns, brief, call.status);
    await db.saveExtraction(extraction);
    emit(runId, callId, 'call.done', {
      status: 'completed',
      verdict: extraction.verdict,
      matchScore: extraction.matchScore,
      totalQuestions: extraction.totalQuestions,
      source: 'dialer',
    });
    return;
  }

  try {
    const { extraction, rejected } = await extractFromTranscript(
      callId, turns, brief, call.status,
    );
    await db.saveExtraction(extraction);

    if (rejected.length) {
      emit(runId, callId, 'extraction.rejected_fields', { rejected });
      console.warn(`[extract] ${callId}: dropped ${rejected.length} unsupported answer(s)`,
        rejected.map((r) => r.questionId).join(', '));
    }
    emit(runId, callId, 'call.done', {
      status: 'completed',
      verdict: extraction.verdict,
      matchScore: extraction.matchScore,
      totalQuestions: extraction.totalQuestions,
    });
  } catch (err) {
    console.error(`[extract] ${callId} failed`, err);
    emit(runId, callId, 'extraction.failed', { error: String(err) });
  }
}

export async function pauseRun(runId: string): Promise<void> {
  cancelResume(runId);
  await db.setRunStatus('paused', runId);
  const inFlight = await db.getInFlightCalls(runId);

  for (const c of inFlight) {
    if (!c.provider_call_id) continue;
    try {
      await dialer.cancel(c.provider_call_id);
    } catch (err) {
      console.error('[pause] cancel failed', err);
    }
  }
  await db.cancelInFlightCalls(runId);

  for (const c of inFlight) releaseCall(c.id);

  await db.recountFinished(runId);
  emit(runId, null, 'run.paused', { cancelled: inFlight.filter((c) => c.provider_call_id).length });
}

export function startStuckSweeper(): NodeJS.Timeout {
  return setInterval(() => {
    void db.sweepStuckCalls(config.stuckCallMs).then(async (swept) => {
      for (const callId of swept) {
        const call = await db.getCall(callId);
        if (call) {
          await db.recountFinished(call.run_id);
          releaseCall(callId);
          emit(call.run_id, callId, 'call.done', { status: 'failed', verdict: 'unreachable' });
        }
      }
    });
  }, 30_000);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const maskPhone = (p: string) => `${p.slice(0, 3)}…${p.slice(-4)}`;
