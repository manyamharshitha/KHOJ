import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import type {
  Brief, CallStatus, Evidence, Extraction, FieldName,
  ListingInput, ResultRow, Turn, Verdict,
} from './types.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  status        TEXT NOT NULL,
  brief_json    TEXT NOT NULL,
  caller_number TEXT,
  total         INTEGER NOT NULL DEFAULT 0,
  finished      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS listings (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(id),
  ext_ref     TEXT,
  phone_e164  TEXT NOT NULL,
  rent_listed INTEGER,
  locality    TEXT,
  source_url  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_listing_dedupe ON listings(run_id, phone_e164);
CREATE INDEX IF NOT EXISTS ix_listing_run ON listings(run_id);

CREATE TABLE IF NOT EXISTS calls (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES runs(id),
  listing_id       TEXT NOT NULL REFERENCES listings(id),
  attempt          INTEGER NOT NULL DEFAULT 1,
  provider_call_id TEXT UNIQUE,
  status           TEXT NOT NULL,
  consent_record   INTEGER,
  not_before       TEXT,
  started_at       TEXT,
  ended_at         TEXT,
  duration_sec     INTEGER,
  recording_url    TEXT,
  error            TEXT
);
CREATE INDEX IF NOT EXISTS ix_calls_run ON calls(run_id, status);
CREATE INDEX IF NOT EXISTS ix_calls_listing ON calls(listing_id);

CREATE TABLE IF NOT EXISTS transcripts (
  call_id    TEXT PRIMARY KEY REFERENCES calls(id),
  turns_json TEXT NOT NULL,
  raw_json   TEXT
);

CREATE TABLE IF NOT EXISTS extractions (
  call_id          TEXT PRIMARY KEY REFERENCES calls(id),
  model            TEXT NOT NULL,
  extracted_at     TEXT NOT NULL,
  available        INTEGER,
  bait_pivot       INTEGER,
  rent_actual      INTEGER,
  deposit_months   REAL,
  brokerage_months REAL,
  non_veg_allowed  INTEGER,
  tenant_profile   TEXT,
  extra_answer     TEXT,
  notes            TEXT,
  fields_present   INTEGER NOT NULL,
  evidence_json    TEXT NOT NULL,
  verdict          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT,
  call_id TEXT,
  at      TEXT NOT NULL,
  kind    TEXT NOT NULL,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS ix_events_run ON events(run_id, id);
`);

const now = () => new Date().toISOString();
const bool = (v: number | null): boolean | null => (v === null ? null : v === 1);
const int = (v: boolean | null | undefined): number | null =>
  v === null || v === undefined ? null : v ? 1 : 0;

export const id = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------ runs */

export function createRun(brief: Brief, listings: ListingInput[], callerNumber: string) {
  const runId = id('run');
  const insertRun = db.prepare(
    `INSERT INTO runs (id, created_at, status, brief_json, caller_number, total)
     VALUES (?, ?, 'queued', ?, ?, ?)`,
  );
  const insertListing = db.prepare(
    `INSERT INTO listings (id, run_id, ext_ref, phone_e164, rent_listed, locality, source_url)
     VALUES (@id, @runId, @extRef, @phone, @rentListed, @locality, @sourceUrl)`,
  );
  const insertCall = db.prepare(
    `INSERT INTO calls (id, run_id, listing_id, status) VALUES (?, ?, ?, 'queued')`,
  );

  db.transaction(() => {
    insertRun.run(runId, now(), JSON.stringify(brief), callerNumber, listings.length);
    for (const l of listings) {
      const listingId = id('lst');
      insertListing.run({
        id: listingId,
        runId,
        extRef: l.extRef ?? null,
        phone: l.phone,
        rentListed: l.rentListed ?? null,
        locality: l.locality ?? null,
        sourceUrl: l.sourceUrl ?? null,
      });
      insertCall.run(id('cal'), runId, listingId);
    }
  })();

  return runId;
}

export interface RunRow {
  id: string; created_at: string; status: string; brief_json: string;
  caller_number: string | null; total: number; finished: number;
}

export const getRunRow = (runId: string): RunRow | undefined =>
  db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as RunRow | undefined;

export const setRunStatus = (status: string, runId: string) =>
  db.prepare(`UPDATE runs SET status = ? WHERE id = ?`).run(status, runId);

export function getBrief(runId: string): Brief {
  const row = getRunRow(runId);
  if (!row) throw new Error(`no such run: ${runId}`);
  return JSON.parse(row.brief_json) as Brief;
}

export function recountFinished(runId: string) {
  db.prepare(
    `UPDATE runs SET finished = (
       SELECT COUNT(*) FROM calls
       WHERE run_id = ? AND status NOT IN ('queued','dialing','live')
     ) WHERE id = ?`,
  ).run(runId, runId);
}

/* ----------------------------------------------------------------- calls */

export interface ClaimedCall {
  id: string;
  run_id: string;
  listing_id: string;
  attempt: number;
  phone_e164: string;
  locality: string | null;
  rent_listed: number | null;
  ext_ref: string | null;
}

/**
 * Atomically move one queued call to `dialing` and return it.
 * SQLite serialises writes, so the transaction is enough — no explicit lock.
 */
export function claimNextQueuedCall(runId: string): ClaimedCall | null {
  const claim = db.transaction((): ClaimedCall | null => {
    const row = db
      .prepare(
        `SELECT c.id, c.run_id, c.listing_id, c.attempt,
                l.phone_e164, l.locality, l.rent_listed, l.ext_ref
         FROM calls c JOIN listings l ON l.id = c.listing_id
         WHERE c.run_id = ? AND c.status = 'queued'
           AND (c.not_before IS NULL OR c.not_before <= ?)
         ORDER BY c.attempt ASC, c.rowid ASC LIMIT 1`,
      )
      .get(runId, now()) as ClaimedCall | undefined;
    if (!row) return null;
    db.prepare(`UPDATE calls SET status = 'dialing', started_at = ? WHERE id = ?`)
      .run(now(), row.id);
    return row;
  });
  return claim();
}

export const hasWorkLeft = (runId: string): boolean =>
  (db.prepare(
    `SELECT COUNT(*) AS n FROM calls WHERE run_id = ? AND status IN ('queued','dialing','live')`,
  ).get(runId) as { n: number }).n > 0;

/**
 * Earliest moment a queued call becomes claimable, when every remaining call is
 * held behind a retry delay. Null when something is claimable right now.
 */
export const nextClaimableAt = (runId: string): string | null => {
  const row = db.prepare(
    `SELECT MIN(not_before) AS at FROM calls
     WHERE run_id = ? AND status = 'queued' AND not_before IS NOT NULL`,
  ).get(runId) as { at: string | null };
  return row.at;
};

export const setCallStatus = (callId: string, status: CallStatus) =>
  db.prepare(`UPDATE calls SET status = ? WHERE id = ?`).run(status, callId);

export const attachProviderId = (callId: string, providerCallId: string) =>
  db.prepare(`UPDATE calls SET provider_call_id = ? WHERE id = ?`).run(providerCallId, callId);

export const failCall = (callId: string, error: string) =>
  db.prepare(
    `UPDATE calls SET status = 'failed', error = ?, ended_at = ? WHERE id = ?`,
  ).run(error.slice(0, 500), now(), callId);

export const blockCall = (callId: string, reason: string) =>
  db.prepare(
    `UPDATE calls SET status = 'blocked', error = ?, ended_at = ? WHERE id = ?`,
  ).run(reason, now(), callId);

export interface CallRow {
  id: string; run_id: string; listing_id: string; attempt: number;
  status: CallStatus; provider_call_id: string | null; started_at: string | null;
}

export const getCall = (callId: string): CallRow | undefined =>
  db.prepare(`SELECT * FROM calls WHERE id = ?`).get(callId) as CallRow | undefined;

export const findCallByProviderId = (providerCallId: string): CallRow | undefined =>
  db.prepare(`SELECT * FROM calls WHERE provider_call_id = ?`)
    .get(providerCallId) as CallRow | undefined;

export function finishCall(
  callId: string,
  status: CallStatus,
  durationSec: number | null,
  recordingUrl: string | null,
  consentRecord: boolean | null,
  error: string | null,
) {
  db.prepare(
    `UPDATE calls SET status = ?, ended_at = ?, duration_sec = ?,
            recording_url = ?, consent_record = ?, error = ?
     WHERE id = ?`,
  ).run(status, now(), durationSec, recordingUrl, int(consentRecord), error, callId);
}

/** Requeue for one retry after a no-answer. True if a retry was scheduled. */
export function scheduleRetry(callId: string, delayMin: number, maxAttempts: number): boolean {
  const call = getCall(callId);
  if (!call || call.attempt >= maxAttempts) return false;
  const notBefore = new Date(Date.now() + delayMin * 60_000).toISOString();
  db.prepare(
    `UPDATE calls SET status = 'queued', attempt = attempt + 1, not_before = ?,
            provider_call_id = NULL, started_at = NULL, ended_at = NULL
     WHERE id = ?`,
  ).run(notBefore, callId);
  return true;
}

/** A call stuck in `dialing` means the webhook never arrived. Free the slot. */
export const sweepStuckCalls = (olderThanMs: number): string[] => {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const rows = db.prepare(
    `SELECT id FROM calls WHERE status = 'dialing' AND started_at IS NOT NULL AND started_at < ?`,
  ).all(cutoff) as { id: string }[];
  for (const r of rows) failCall(r.id, 'no webhook received within timeout');
  return rows.map((r) => r.id);
};

/** Cross-run cooldown: has this number been dialled recently by anyone? */
export const calledRecently = (
  phone: string, withinDays: number, exceptCallId: string,
): boolean => {
  const cutoff = new Date(Date.now() - withinDays * 86_400_000).toISOString();
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM calls c JOIN listings l ON l.id = c.listing_id
     WHERE l.phone_e164 = ? AND c.id != ? AND c.started_at IS NOT NULL
       AND c.started_at > ? AND c.status NOT IN ('blocked','queued')`,
  ).get(phone, exceptCallId, cutoff) as { n: number };
  return row.n > 0;
};

/* ------------------------------------------ transcripts and extractions */

export const saveTranscript = (callId: string, turns: Turn[], raw: unknown) =>
  db.prepare(
    `INSERT INTO transcripts (call_id, turns_json, raw_json) VALUES (?, ?, ?)
     ON CONFLICT(call_id) DO UPDATE SET turns_json = excluded.turns_json,
                                        raw_json  = excluded.raw_json`,
  ).run(callId, JSON.stringify(turns), raw ? JSON.stringify(raw) : null);

export const getTranscript = (callId: string): Turn[] | null => {
  const row = db.prepare(`SELECT turns_json FROM transcripts WHERE call_id = ?`)
    .get(callId) as { turns_json: string } | undefined;
  return row ? (JSON.parse(row.turns_json) as Turn[]) : null;
};

export function saveExtraction(e: Extraction) {
  db.prepare(
    `INSERT INTO extractions (call_id, model, extracted_at, available, bait_pivot,
        rent_actual, deposit_months, brokerage_months, non_veg_allowed,
        tenant_profile, extra_answer, notes, fields_present, evidence_json, verdict)
     VALUES (@callId, @model, @extractedAt, @available, @baitPivot, @rentActual,
        @depositMonths, @brokerageMonths, @nonVegAllowed, @tenantProfile,
        @extraAnswer, @notes, @fieldsPresent, @evidenceJson, @verdict)
     ON CONFLICT(call_id) DO UPDATE SET
        model = excluded.model, extracted_at = excluded.extracted_at,
        available = excluded.available, bait_pivot = excluded.bait_pivot,
        rent_actual = excluded.rent_actual, deposit_months = excluded.deposit_months,
        brokerage_months = excluded.brokerage_months,
        non_veg_allowed = excluded.non_veg_allowed,
        tenant_profile = excluded.tenant_profile, extra_answer = excluded.extra_answer,
        notes = excluded.notes, fields_present = excluded.fields_present,
        evidence_json = excluded.evidence_json, verdict = excluded.verdict`,
  ).run({
    callId: e.callId, model: e.model, extractedAt: e.extractedAt,
    available: int(e.available), baitPivot: int(e.baitPivot),
    rentActual: e.rentActual, depositMonths: e.depositMonths,
    brokerageMonths: e.brokerageMonths, nonVegAllowed: int(e.nonVegAllowed),
    tenantProfile: e.tenantProfile, extraAnswer: e.extraAnswer, notes: e.notes,
    fieldsPresent: e.fieldsPresent, evidenceJson: JSON.stringify(e.evidence),
    verdict: e.verdict,
  });
}

interface ExtractionRow {
  call_id: string; model: string; extracted_at: string;
  available: number | null; bait_pivot: number | null; rent_actual: number | null;
  deposit_months: number | null; brokerage_months: number | null;
  non_veg_allowed: number | null; tenant_profile: string | null;
  extra_answer: string | null; notes: string | null; fields_present: number;
  evidence_json: string; verdict: string;
}

const rowToExtraction = (r: ExtractionRow): Extraction => ({
  callId: r.call_id, model: r.model, extractedAt: r.extracted_at,
  available: bool(r.available), baitPivot: bool(r.bait_pivot),
  rentActual: r.rent_actual, depositMonths: r.deposit_months,
  brokerageMonths: r.brokerage_months, nonVegAllowed: bool(r.non_veg_allowed),
  tenantProfile: r.tenant_profile as Extraction['tenantProfile'],
  extraAnswer: r.extra_answer, notes: r.notes, fieldsPresent: r.fields_present,
  evidence: JSON.parse(r.evidence_json) as Partial<Record<FieldName, Evidence>>,
  verdict: r.verdict as Verdict,
});

export const getExtraction = (callId: string): Extraction | null => {
  const r = db.prepare(`SELECT * FROM extractions WHERE call_id = ?`)
    .get(callId) as ExtractionRow | undefined;
  return r ? rowToExtraction(r) : null;
};

/* --------------------------------------------------------------- results */

export function getRows(runId: string): ResultRow[] {
  const rows = db.prepare(
    `SELECT c.id AS call_id, c.listing_id, c.status, c.duration_sec, c.consent_record,
            c.recording_url, c.error,
            l.ext_ref, l.phone_e164, l.locality, l.rent_listed
     FROM calls c JOIN listings l ON l.id = c.listing_id
     WHERE c.run_id = ? ORDER BY c.rowid ASC`,
  ).all(runId) as {
    call_id: string; listing_id: string; status: CallStatus;
    duration_sec: number | null; consent_record: number | null;
    recording_url: string | null; error: string | null; ext_ref: string | null;
    phone_e164: string; locality: string | null; rent_listed: number | null;
  }[];

  return rows.map((r) => {
    const extraction = getExtraction(r.call_id);
    const rentDelta =
      extraction?.rentActual != null && r.rent_listed != null
        ? extraction.rentActual - r.rent_listed
        : null;
    return {
      callId: r.call_id, listingId: r.listing_id, extRef: r.ext_ref,
      phone: r.phone_e164, locality: r.locality, rentListed: r.rent_listed,
      status: r.status, durationSec: r.duration_sec,
      consentRecord: bool(r.consent_record), recordingUrl: r.recording_url,
      error: r.error, extraction, rentDelta,
    };
  });
}

/* ---------------------------------------------------------------- events */

export const appendEvent = (
  runId: string | null, callId: string | null, kind: string, payload: unknown,
): number => {
  const info = db.prepare(
    `INSERT INTO events (run_id, call_id, at, kind, payload) VALUES (?, ?, ?, ?, ?)`,
  ).run(runId, callId, now(), kind, payload ? JSON.stringify(payload) : null);
  return Number(info.lastInsertRowid);
};

export const eventsSince = (runId: string, sinceId: number) =>
  db.prepare(
    `SELECT id, kind, payload, at FROM events WHERE run_id = ? AND id > ? ORDER BY id ASC`,
  ).all(runId, sinceId) as
    { id: number; kind: string; payload: string | null; at: string }[];
