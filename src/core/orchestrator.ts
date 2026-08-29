import { config } from '../config.js';
import * as db from '../db.js';
import type { CallStatus, DialerWebhookBody } from '../types.js';
import type { Dialer } from './dialer.js';
import { emit } from './events.js';
import { extractFromTranscript } from './extract.js';
import { checkCall, insideCallingWindow, nextWindowOpensAt } from './guardrails.js';
import { buildScript } from './script.js';

/**
 * Minimal counting semaphore. No dependency, no queue server.
 *
 * `release` hands its permit straight to the next waiter instead of
 * decrementing and letting the waiter re-increment. The two-step version has a
 * race: the waiter's `active++` runs a microtask after `release`'s `active--`,
 * and a fresh `acquire` arriving in that window sees a free slot that is
 * already spoken for, so both proceed and the cap is exceeded.
 */
function semaphore(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    async acquire() {
      if (active < max) { active++; return; }
      await new Promise<void>((resolve) => waiting.push(resolve));
      // The permit was transferred to us; `active` already counts it.
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

/**
 * Semaphore permits, held per call from the moment it is placed until it
 * reaches a terminal state.
 *
 * The permit deliberately outlives `dialOne`. Placing a call returns as soon as
 * the provider accepts it, and the call itself then runs for a minute —
 * releasing when `placeCall` resolves would let the entire list go out at once
 * and burn the call quota. The webhook is what frees the line.
 */
const permits = new Map<string, () => void>();

function releaseCall(callId: string): void {
  const release = permits.get(callId);
  if (release) {
    permits.delete(callId);
    release();
  }
}

/**
 * Every remaining call is waiting out a retry delay. Park the run instead of
 * spinning, and wake it when the first one becomes claimable.
 */
function scheduleResume(runId: string, at: string): void {
  db.setRunStatus('awaiting_retry', runId);
  emit(runId, null, 'run.awaiting_retry', { resumesAt: at });

  const existing = resumeTimers.get(runId);
  if (existing) clearTimeout(existing);

  const delay = Math.max(1_000, Date.parse(at) - Date.now());
  const timer = setTimeout(() => {
    resumeTimers.delete(runId);
    const row = db.getRunRow(runId);
    // A paused run was stopped deliberately — don't override the kill switch.
    if (row && row.status === 'awaiting_retry') void startRun(runId);
  }, delay);
  timer.unref?.();
  resumeTimers.set(runId, timer);
}

/**
 * Clears in-memory run bookkeeping. A real crash takes the process with it, so
 * production never needs this — it exists so a test can simulate a restart
 * without forking, and it is what makes `startRun` willing to adopt a run it
 * still believes is in flight.
 */
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

/**
 * All state lives in the `calls` table, so this loop is restartable: if the
 * process dies mid-run, calling start() again picks up everything still queued.
 */
export async function startRun(runId: string): Promise<void> {
  if (running.has(runId)) return;
  running.add(runId);
  db.setRunStatus('running', runId);
  emit(runId, null, 'run.started', { total: db.getRunRow(runId)?.total ?? 0 });

  const gate = semaphore(config.maxConcurrent);

  try {
    for (;;) {
      const run = db.getRunRow(runId);
      if (!run || run.status !== 'running') break;

      if (!insideCallingWindow(new Date())) {
        db.setRunStatus('paused', runId);
        emit(runId, null, 'run.window_closed', {
          resumesAt: nextWindowOpensAt(new Date()),
        });
        break;
      }

      // Take the line before claiming the call. Claiming first would mark a
      // call `dialing` while it is really still queued behind the semaphore —
      // a phantom ringing row in the UI, and eventually a false `failed` from
      // the stuck-call sweeper.
      await gate.acquire();

      // The wait can be long. Re-read the run: a pause may have landed.
      const current = db.getRunRow(runId);
      if (!current || current.status !== 'running') {
        gate.release();
        break;
      }

      const next = db.claimNextQueuedCall(runId);
      if (!next) {
        gate.release();
        if (gate.active > 0) {
          // Calls still in flight; their webhooks may queue more work.
          await sleep(200);
          continue;
        }
        if (!db.hasWorkLeft(runId)) break;

        // Everything left is held behind a retry delay. Sleep the run rather
        // than busy-waiting for half an hour, and wake it up on a timer.
        const at = db.nextClaimableAt(runId);
        if (at) {
          scheduleResume(runId, at);
          break;
        }
        await sleep(200);
        continue;
      }

      permits.set(next.id, () => gate.release());
      void dialOne(next).catch((err: unknown) => {
        db.failCall(next.id, String(err));
        db.recountFinished(runId);
        emit(runId, next.id, 'call.failed', { error: String(err) });
        releaseCall(next.id);
      });
    }

    // Drain anything still in flight before declaring the run finished.
    while (gate.active > 0) await sleep(150);

    const finalRun = db.getRunRow(runId);
    if (finalRun?.status === 'running') {
      db.setRunStatus('done', runId);
      emit(runId, null, 'run.done', null);
    }
  } finally {
    running.delete(runId);
    db.recountFinished(runId);
  }
}

async function dialOne(call: db.ClaimedCall): Promise<void> {
  const block = checkCall({ id: call.id, phone_e164: call.phone_e164 });
  if (block) {
    db.blockCall(call.id, block);
    db.recountFinished(call.run_id);
    emit(call.run_id, call.id, 'call.blocked', { reason: block });
    releaseCall(call.id);
    return;
  }

  emit(call.run_id, call.id, 'call.dialing', {
    phone: maskPhone(call.phone_e164),
    extRef: call.ext_ref,
  });

  const brief = db.getBrief(call.run_id);
  const script = buildScript(brief, {
    locality: call.locality,
    rentListed: call.rent_listed,
  });

  const { providerCallId } = await dialer.placeCall({
    callId: call.id,
    toE164: call.phone_e164,
    fromE164: config.callerId || '+910000000000',
    script,
    metadata: { runId: call.run_id, attempt: String(call.attempt) },
  });

  db.attachProviderId(call.id, providerCallId);
  // The webhook takes it from here. No polling.
}

/**
 * Called by the webhook route. Idempotent: a duplicate delivery is a no-op
 * rather than a second extraction. Providers retry.
 */
export async function handleCallResult(body: DialerWebhookBody): Promise<'ok' | 'duplicate'> {
  const call = db.getCall(body.callId);
  if (!call) throw new Error(`unknown callId ${body.callId}`);

  if (call.status !== 'dialing' && call.status !== 'live') return 'duplicate';
  if (db.getExtraction(call.id)) return 'duplicate';

  const status = body.status as CallStatus;

  if (status !== 'completed') {
    const retried =
      (status === 'no_answer' || status === 'busy') &&
      db.scheduleRetry(call.id, config.retryDelayMin, config.maxAttempts);

    releaseCall(call.id);
    if (retried) {
      emit(call.run_id, call.id, 'call.retry_scheduled', { status });
    } else {
      db.finishCall(call.id, status, body.durationSec ?? null, null, null,
        body.error ?? null);
      db.recountFinished(call.run_id);
      emit(call.run_id, call.id, 'call.done', { status, verdict: 'unreachable' });
    }
    return 'ok';
  }

  db.finishCall(
    call.id, 'completed', body.durationSec ?? null,
    body.recordingUrl ?? null, body.consentRecord ?? null, null,
  );
  if (body.turns?.length) db.saveTranscript(call.id, body.turns, body);
  // Extraction is not a phone call — free the line before it runs.
  releaseCall(call.id);
  emit(call.run_id, call.id, 'call.answered', { durationSec: body.durationSec });

  await runExtraction(call.id, call.run_id);
  db.recountFinished(call.run_id);
  return 'ok';
}

/** Extraction over a stored transcript. Safe to re-run; places no calls. */
export async function runExtraction(callId: string, runId: string): Promise<void> {
  const turns = db.getTranscript(callId);
  const call = db.getCall(callId);
  if (!turns || !call) return;

  try {
    const { extraction, rejected } = await extractFromTranscript(
      callId, turns, db.getBrief(runId), call.status,
    );
    db.saveExtraction(extraction);

    if (rejected.length) {
      emit(runId, callId, 'extraction.rejected_fields', { rejected });
      console.warn(`[extract] ${callId}: dropped ${rejected.length} unsupported field(s)`,
        rejected.map((r) => r.name).join(', '));
    }
    emit(runId, callId, 'call.done', {
      status: 'completed',
      verdict: extraction.verdict,
      fieldsPresent: extraction.fieldsPresent,
    });
  } catch (err) {
    console.error(`[extract] ${callId} failed`, err);
    emit(runId, callId, 'extraction.failed', { error: String(err) });
  }
}

/** Kill switch. Cancels in-flight provider calls. */
export async function pauseRun(runId: string): Promise<void> {
  cancelResume(runId);
  db.setRunStatus('paused', runId);
  const inFlightIds = db.db.prepare(
    `SELECT id FROM calls WHERE run_id = ? AND status IN ('dialing','live')`,
  ).all(runId) as { id: string }[];
  const inFlight = db.db.prepare(
    `SELECT provider_call_id FROM calls
     WHERE run_id = ? AND status IN ('dialing','live') AND provider_call_id IS NOT NULL`,
  ).all(runId) as { provider_call_id: string }[];

  for (const c of inFlight) {
    try {
      await dialer.cancel(c.provider_call_id);
    } catch (err) {
      console.error('[pause] cancel failed', err);
    }
  }
  db.db.prepare(
    `UPDATE calls SET status = 'cancelled', ended_at = ?
     WHERE run_id = ? AND status IN ('dialing','live')`,
  ).run(new Date().toISOString(), runId);

  for (const c of inFlightIds) releaseCall(c.id);

  db.recountFinished(runId);
  emit(runId, null, 'run.paused', { cancelled: inFlight.length });
}

/** Without this, one hung call holds a semaphore slot for the whole demo. */
export function startStuckSweeper(): NodeJS.Timeout {
  return setInterval(() => {
    const swept = db.sweepStuckCalls(config.stuckCallMs);
    for (const callId of swept) {
      const call = db.getCall(callId);
      if (call) {
        db.recountFinished(call.run_id);
        releaseCall(callId);
        emit(call.run_id, callId, 'call.done', { status: 'failed', verdict: 'unreachable' });
      }
    }
  }, 30_000);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const maskPhone = (p: string) => `${p.slice(0, 3)}…${p.slice(-4)}`;
