import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from './firebase.js';
import { assessListing } from './core/authenticity.js';
import type {
  Brief, CallStatus, Extraction, ListingInput, ResultRow, Turn,
} from './types.js';

const col = {
  runs: firestore.collection('runs'),
  listings: firestore.collection('listings'),
  calls: firestore.collection('calls'),
  transcripts: firestore.collection('transcripts'),
  extractions: firestore.collection('extractions'),
  events: firestore.collection('events'),
};

const now = () => new Date().toISOString();

export const id = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export interface RunRow {
  id: string; created_at: string; status: string; brief: Brief;
  caller_number: string | null; total: number; finished: number;
}

export interface ClaimedCall {
  id: string; run_id: string; listing_id: string; attempt: number;
  phone_e164: string; locality: string | null; rent_listed: number | null; ext_ref: string | null;
}

export interface CallRow {
  id: string; run_id: string; listing_id: string; attempt: number;
  status: CallStatus; provider_call_id: string | null; started_at: string | null;
}

export async function createRun(
  brief: Brief,
  listings: ListingInput[],
  callerNumber: string,
  userId: string | null = null,
): Promise<string> {
  const runId = id('run');
  const createdAt = now();
  const batch = firestore.batch();

  batch.set(col.runs.doc(runId), {
    created_at: createdAt, status: 'queued', brief,
    caller_number: callerNumber, user_id: userId, total: listings.length,
    finished: 0, event_seq: 0,
  });

  for (const l of listings) {
    const listingId = id('lst');
    const callId = id('cal');
    batch.set(col.listings.doc(listingId), {
      run_id: runId, ext_ref: l.extRef ?? null, phone_e164: l.phone,
      rent_listed: l.rentListed ?? null, locality: l.locality ?? null,
      source_url: l.sourceUrl ?? null,
    });
    batch.set(col.calls.doc(callId), {
      run_id: runId, listing_id: listingId, phone_e164: l.phone, attempt: 1,
      provider_call_id: null, status: 'queued', consent_record: null, not_before: null,
      started_at: null, ended_at: null, duration_sec: null, recording_url: null, error: null,
      created_at: createdAt,
    });
  }

  await batch.commit();
  return runId;
}

export async function getRunRow(runId: string): Promise<RunRow | undefined> {
  const snap = await col.runs.doc(runId).get();
  if (!snap.exists) return undefined;
  const d = snap.data()!;
  return {
    id: snap.id, created_at: d.created_at, status: d.status, brief: d.brief as Brief,
    caller_number: d.caller_number ?? null, total: d.total, finished: d.finished,
  };
}

export const setRunStatus = async (status: string, runId: string): Promise<void> => {
  await col.runs.doc(runId).update({ status });
};

export async function getBrief(runId: string): Promise<Brief> {
  const row = await getRunRow(runId);
  if (!row) throw new Error(`no such run: ${runId}`);
  return row.brief;
}

export async function recountFinished(runId: string): Promise<void> {
  const runSnap = await col.runs.doc(runId).get();
  const total = (runSnap.data()?.total as number | undefined) ?? 0;
  const notFinishedSnap = await col.calls
    .where('run_id', '==', runId)
    .where('status', 'in', ['queued', 'dialing', 'live'])
    .count().get();
  await col.runs.doc(runId).update({ finished: total - notFinishedSnap.data().count });
}

export async function claimNextQueuedCall(runId: string): Promise<ClaimedCall | null> {
  const nowIso = now();
  const snap = await col.calls
    .where('run_id', '==', runId)
    .where('status', '==', 'queued')
    .orderBy('attempt', 'asc')
    .orderBy('created_at', 'asc')
    .limit(25)
    .get();

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.not_before && data.not_before > nowIso) continue;

    const claimed = await firestore.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const d = fresh.data();
      if (!d || d.status !== 'queued') return null;
      if (d.not_before && d.not_before > nowIso) return null;
      tx.update(doc.ref, { status: 'dialing', started_at: now() });
      return { run_id: d.run_id as string, listing_id: d.listing_id as string, attempt: d.attempt as number };
    });
    if (!claimed) continue;

    const listingSnap = await col.listings.doc(claimed.listing_id).get();
    const l = listingSnap.data()!;
    return {
      id: doc.id, run_id: claimed.run_id, listing_id: claimed.listing_id, attempt: claimed.attempt,
      phone_e164: l.phone_e164, locality: l.locality ?? null, rent_listed: l.rent_listed ?? null,
      ext_ref: l.ext_ref ?? null,
    };
  }
  return null;
}

export async function hasWorkLeft(runId: string): Promise<boolean> {
  const snap = await col.calls
    .where('run_id', '==', runId)
    .where('status', 'in', ['queued', 'dialing', 'live'])
    .count().get();
  return snap.data().count > 0;
}

export async function nextClaimableAt(runId: string): Promise<string | null> {
  const snap = await col.calls
    .where('run_id', '==', runId)
    .where('status', '==', 'queued')
    .where('not_before', '!=', null)
    .orderBy('not_before', 'asc')
    .limit(1)
    .get();
  return snap.empty ? null : ((snap.docs[0]!.data().not_before as string | undefined) ?? null);
}

export const setCallStatus = async (callId: string, status: CallStatus): Promise<void> => {
  await col.calls.doc(callId).update({ status });
};

export const attachProviderId = async (callId: string, providerCallId: string): Promise<void> => {
  await col.calls.doc(callId).update({ provider_call_id: providerCallId });
};

export const failCall = async (callId: string, error: string): Promise<void> => {
  await col.calls.doc(callId).update({ status: 'failed', error: error.slice(0, 500), ended_at: now() });
};

export const blockCall = async (callId: string, reason: string): Promise<void> => {
  await col.calls.doc(callId).update({ status: 'blocked', error: reason, ended_at: now() });
};

export async function getCall(callId: string): Promise<CallRow | undefined> {
  const snap = await col.calls.doc(callId).get();
  if (!snap.exists) return undefined;
  const d = snap.data()!;
  return {
    id: snap.id, run_id: d.run_id, listing_id: d.listing_id, attempt: d.attempt,
    status: d.status, provider_call_id: d.provider_call_id ?? null, started_at: d.started_at ?? null,
  };
}

export async function findCallByProviderId(providerCallId: string): Promise<CallRow | undefined> {
  const snap = await col.calls.where('provider_call_id', '==', providerCallId).limit(1).get();
  if (snap.empty) return undefined;
  const doc = snap.docs[0]!;
  const d = doc.data();
  return {
    id: doc.id, run_id: d.run_id, listing_id: d.listing_id, attempt: d.attempt,
    status: d.status, provider_call_id: d.provider_call_id ?? null, started_at: d.started_at ?? null,
  };
}

export async function finishCall(
  callId: string, status: CallStatus, durationSec: number | null, recordingUrl: string | null,
  consentRecord: boolean | null, error: string | null,
): Promise<void> {
  await col.calls.doc(callId).update({
    status, ended_at: now(), duration_sec: durationSec, recording_url: recordingUrl,
    consent_record: consentRecord, error,
  });
}

export async function scheduleRetry(callId: string, delayMin: number, maxAttempts: number): Promise<boolean> {
  const call = await getCall(callId);
  if (!call || call.attempt >= maxAttempts) return false;
  const notBefore = new Date(Date.now() + delayMin * 60_000).toISOString();
  await col.calls.doc(callId).update({
    status: 'queued', attempt: FieldValue.increment(1), not_before: notBefore,
    provider_call_id: null, started_at: null, ended_at: null,
  });
  return true;
}

export async function sweepStuckCalls(olderThanMs: number): Promise<string[]> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const snap = await col.calls
    .where('status', '==', 'dialing')
    .where('started_at', '<', cutoff)
    .get();
  const ids: string[] = [];
  for (const doc of snap.docs) {
    ids.push(doc.id);
    await failCall(doc.id, 'no webhook received within timeout');
  }
  return ids;
}

export async function calledRecently(phone: string, withinDays: number, exceptCallId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - withinDays * 86_400_000).toISOString();
  const snap = await col.calls
    .where('phone_e164', '==', phone)
    .where('started_at', '>', cutoff)
    .get();
  return snap.docs.some((d) => {
    const c = d.data();
    return d.id !== exceptCallId && c.status !== 'blocked' && c.status !== 'queued';
  });
}

export async function saveTranscript(callId: string, turns: Turn[], raw: unknown): Promise<void> {
  await col.transcripts.doc(callId).set({
    turns_json: JSON.stringify(turns), raw_json: raw ? JSON.stringify(raw) : null,
  });
}

export async function getTranscript(callId: string): Promise<Turn[] | null> {
  const snap = await col.transcripts.doc(callId).get();
  if (!snap.exists) return null;
  return JSON.parse(snap.data()!.turns_json as string) as Turn[];
}

export async function saveExtraction(e: Extraction): Promise<void> {
  await col.extractions.doc(e.callId).set({
    model: e.model, extracted_at: e.extractedAt, available: e.available, bait_pivot: e.baitPivot,
    rent_actual: e.rentActual, notes: e.notes, answers: e.answers, match_score: e.matchScore,
    total_questions: e.totalQuestions, verdict: e.verdict,
  });
}

export async function getExtraction(callId: string): Promise<Extraction | null> {
  const snap = await col.extractions.doc(callId).get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  return {
    callId, model: d.model, extractedAt: d.extracted_at,
    available: d.available ?? null, baitPivot: d.bait_pivot ?? null, rentActual: d.rent_actual ?? null,
    notes: d.notes ?? null, answers: d.answers ?? [], matchScore: d.match_score,
    totalQuestions: d.total_questions, verdict: d.verdict,
  };
}

export async function getRows(runId: string): Promise<ResultRow[]> {
  const callsSnap = await col.calls.where('run_id', '==', runId).orderBy('created_at', 'asc').get();
  const rows: ResultRow[] = [];

  for (const doc of callsSnap.docs) {
    const c = doc.data();
    const [listingSnap, extraction] = await Promise.all([
      col.listings.doc(c.listing_id).get(),
      getExtraction(doc.id),
    ]);
    const l = listingSnap.data()!;
    const rentDelta = extraction?.rentActual != null && l.rent_listed != null
      ? extraction.rentActual - l.rent_listed
      : null;

    rows.push({
      callId: doc.id, listingId: c.listing_id, extRef: l.ext_ref ?? null,
      phone: l.phone_e164, locality: l.locality ?? null, rentListed: l.rent_listed ?? null,
      status: c.status, durationSec: c.duration_sec ?? null, consentRecord: c.consent_record ?? null,
      recordingUrl: c.recording_url ?? null, error: c.error ?? null, extraction, rentDelta,
      assessment: assessListing({
        extraction, rentListed: l.rent_listed ?? null, status: c.status, durationSec: c.duration_sec ?? null,
      }),
    });
  }

  return rows;
}

export async function appendEvent(
  runId: string, callId: string | null, kind: string, payload: unknown,
): Promise<number> {
  const runRef = col.runs.doc(runId);
  return firestore.runTransaction(async (tx) => {
    const runSnap = await tx.get(runRef);
    const seq = ((runSnap.data()?.event_seq as number | undefined) ?? 0) + 1;
    if (runSnap.exists) tx.update(runRef, { event_seq: seq });
    tx.set(col.events.doc(), {
      seq, run_id: runId, call_id: callId, at: now(), kind,
      payload: payload ? JSON.stringify(payload) : null,
    });
    return seq;
  });
}

export async function eventsSince(runId: string, sinceId: number) {
  const snap = await col.events
    .where('run_id', '==', runId)
    .where('seq', '>', sinceId)
    .orderBy('seq', 'asc')
    .get();
  return snap.docs.map((d) => {
    const e = d.data();
    return { id: e.seq as number, kind: e.kind as string, payload: (e.payload as string | null), at: e.at as string };
  });
}

export async function runOwner(runId: string): Promise<string | null> {
  const snap = await col.runs.doc(runId).get();
  return (snap.data()?.user_id as string | undefined) ?? null;
}

export async function getInFlightCalls(runId: string): Promise<{ id: string; provider_call_id: string | null }[]> {
  const snap = await col.calls
    .where('run_id', '==', runId)
    .where('status', 'in', ['dialing', 'live'])
    .get();
  return snap.docs.map((d) => ({ id: d.id, provider_call_id: (d.data().provider_call_id as string | null) ?? null }));
}

export async function cancelInFlightCalls(runId: string): Promise<void> {
  const snap = await col.calls
    .where('run_id', '==', runId)
    .where('status', 'in', ['dialing', 'live'])
    .get();
  const batch = firestore.batch();
  const endedAt = now();
  for (const doc of snap.docs) batch.update(doc.ref, { status: 'cancelled', ended_at: endedAt });
  await batch.commit();
}
