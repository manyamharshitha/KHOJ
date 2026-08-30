/**
 * Integration tests. Each boots the real Fastify app in-process against a
 * throwaway SQLite file, so routes, orchestrator, guardrails and persistence
 * are all exercised together. No API key, no telephony.
 *
 * Config is read once at import, so anything a test needs to vary must be set
 * in process.env *before* the first dynamic import in that file.
 */
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

// Unique per process: a previous run's SQLite handle can still hold the file
// on Windows, and a locked DB would fail the suite for the wrong reason.
const DB = `./data/test-${process.pid}.db`;

process.env.DB_PATH = DB;
process.env.DIALER = 'manual';
process.env.IGNORE_CALL_WINDOW = '0';
// A window that is always closed, so the gate has something to refuse.
process.env.CALL_WINDOWS_IST = '11:00-11:01';
process.env.NUMBER_COOLDOWN_DAYS = '0';
process.env.MAX_LISTINGS_PER_RUN = '40';
process.env.MAX_CONCURRENT = '5';
process.env.RETRY_DELAY_MIN = '1';
process.env.LOG_LEVEL = 'silent';

mkdirSync('./data', { recursive: true });

const { buildApp } = await import('../src/app.js');
const { config } = await import('../src/config.js');
const db = await import('../src/db.js');
const { pauseRun, resetRuntimeState, startRun, setDialer } =
  await import('../src/core/orchestrator.js');
const { ManualDialer } = await import('../src/core/dialer.manual.js');

const brief = {
  city: 'Hyderabad', rentCeiling: 35000, vegMatters: false,
  tenantProfile: 'working_women' as const,
};

const listings = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    extRef: `L-${i + from}`,
    phone: `9${String(800000000 + i + from * 1000).padStart(9, '0')}`,
    rentListed: 25000,
  }));

let app: FastifyInstance;
let stop: () => Promise<void>;

const post = (url: string, payload?: unknown) =>
  app.inject({ method: 'POST', url, payload: payload as object });
const get = (url: string) => app.inject({ method: 'GET', url });

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  ({ app, stop } = await buildApp());
  await app.ready();
});

after(async () => {
  await stop();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(`${DB}${suffix}`, { force: true }); } catch { /* Windows lock */ }
  }
});

/* ------------------------------------------------------ 1. the window gate */

describe('calling window gate', () => {
  it('is enforced, not bypassed', () => {
    assert.equal(config.ignoreCallWindow, false, 'test config must enforce the window');
  });

  it('refuses to dial outside the permitted hours and says when it will resume', async () => {
    const res = await post('/api/runs', { brief, listings: listings(3) });
    assert.equal(res.statusCode, 201);
    const { runId } = res.json() as { runId: string };

    await settle();

    const run = db.getRunRow(runId);
    assert.equal(run?.status, 'paused', 'run must park, not dial');

    const events = db.db.prepare(
      `SELECT kind, payload FROM events WHERE run_id = ? AND kind = 'run.window_closed'`,
    ).all(runId) as { payload: string }[];
    assert.equal(events.length, 1, 'must emit run.window_closed');
    const payload = JSON.parse(events[0]!.payload) as { resumesAt: string };
    assert.ok(Date.parse(payload.resumesAt) > 0, 'must say when it resumes');

    const dialed = db.db.prepare(
      `SELECT COUNT(*) n FROM calls WHERE run_id = ? AND status != 'queued'`,
    ).get(runId) as { n: number };
    assert.equal(dialed.n, 0, 'not one call may be placed outside the window');
  });
});

/* ------------------------------------------------------- 2. the run cap */

describe('listings cap', () => {
  it('accepts exactly the maximum', async () => {
    const res = await post('/api/runs', { brief, listings: listings(40, 100) });
    assert.equal(res.statusCode, 201);
    assert.equal((res.json() as { queued: number }).queued, 40);
  });

  it('rejects one over, naming the limit', async () => {
    const res = await post('/api/runs', { brief, listings: listings(41, 200) });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /at most 40 listings/);
  });

  it('rejects an empty list rather than creating a run that does nothing', async () => {
    const res = await post('/api/runs', { brief, listings: [] });
    assert.equal(res.statusCode, 400);
  });
});

/* ------------------------------- 3-5. dialing behaviour, window reopened */

describe('with the window open', () => {
  // Reopen the window in place — config is a plain object, not frozen.
  const openWindow = () => {
    (config as { callWindowsIST: { startMin: number; endMin: number }[] })
      .callWindowsIST = [{ startMin: 0, endMin: 24 * 60 }];
  };

  before(() => openWindow());

  it('caps concurrency at MAX_CONCURRENT', async () => {
    const res = await post('/api/runs', { brief, listings: listings(12, 300) });
    const { runId } = res.json() as { runId: string };

    await settle(400);

    // The manual dialer parks every call in `dialing`, so the number sitting
    // there is exactly the number of permits the semaphore handed out.
    const counts = db.db.prepare(
      `SELECT status, COUNT(*) n FROM calls WHERE run_id = ? GROUP BY status`,
    ).all(runId) as { status: string; n: number }[];
    const dialing = counts.find((c) => c.status === 'dialing')?.n ?? 0;
    const queued = counts.find((c) => c.status === 'queued')?.n ?? 0;

    assert.equal(dialing, config.maxConcurrent,
      `expected exactly ${config.maxConcurrent} in flight, saw ${dialing}`);
    assert.equal(dialing + queued, 12, 'the rest must wait, not be dropped');

    await post(`/api/runs/${runId}/pause`);
  });

  it('pause cancels the calls that are in flight', async () => {
    const cancelled: string[] = [];
    class RecordingDialer extends ManualDialer {
      override async cancel(providerCallId: string) {
        cancelled.push(providerCallId);
      }
    }
    setDialer(new RecordingDialer());

    const res = await post('/api/runs', { brief, listings: listings(8, 400) });
    const { runId } = res.json() as { runId: string };
    await settle(400);

    const before = db.db.prepare(
      `SELECT COUNT(*) n FROM calls WHERE run_id = ? AND status = 'dialing'`,
    ).get(runId) as { n: number };
    assert.ok(before.n > 0, 'need calls in flight to cancel');

    const acknowledged = db.db.prepare(
      `SELECT COUNT(*) n FROM calls
       WHERE run_id = ? AND status = 'dialing' AND provider_call_id IS NOT NULL`,
    ).get(runId) as { n: number };

    await pauseRun(runId);

    // A call whose placeCall has not resolved yet has no provider id to cancel
    // with. It is still marked cancelled locally; the provider-side call would
    // be orphaned. Acceptable at this concurrency, worth revisiting if the cap
    // rises or placeCall gets slow.
    assert.equal(cancelled.length, acknowledged.n,
      'every call the provider acknowledged must be cancelled there');

    const still = db.db.prepare(
      `SELECT COUNT(*) n FROM calls WHERE run_id = ? AND status IN ('dialing','live')`,
    ).get(runId) as { n: number };
    assert.equal(still.n, 0, 'no call may be left hanging in dialing');

    const now = db.db.prepare(
      `SELECT COUNT(*) n FROM calls WHERE run_id = ? AND status = 'cancelled'`,
    ).get(runId) as { n: number };
    assert.equal(now.n, before.n);

    setDialer(new ManualDialer());
  });

  it('recovers a half-finished run after the process restarts', async () => {
    const res = await post('/api/runs', { brief, listings: listings(9, 500) });
    const { runId } = res.json() as { runId: string };
    await settle(400);

    // Simulate a crash: tear the app down without finishing the run, and drop
    // the in-memory bookkeeping a dying process would have taken with it.
    // State lives in SQLite, so a fresh app must be able to pick it up.
    await stop();
    resetRuntimeState();

    const revived = await buildApp();
    app = revived.app;
    stop = revived.stop;
    await app.ready();
    openWindow();

    const stuck = db.db.prepare(
      `SELECT COUNT(*) n FROM calls WHERE run_id = ? AND status = 'dialing'`,
    ).get(runId) as { n: number };
    assert.ok(stuck.n > 0, 'calls were mid-flight when the process died');

    // Sweep them back to retryable, the way the stuck-call sweeper does, then
    // resume and confirm the run picks up where it left off.
    db.db.prepare(
      `UPDATE calls SET status = 'queued', provider_call_id = NULL
       WHERE run_id = ? AND status = 'dialing'`,
    ).run(runId);

    // Fire, don't await: with every line held by parked calls the loop blocks
    // on the semaphore and never returns — the same way the route calls it.
    void startRun(runId);
    await settle(600);

    const after = db.db.prepare(
      `SELECT COUNT(*) n FROM calls WHERE run_id = ? AND status = 'dialing'`,
    ).get(runId) as { n: number };
    assert.ok(after.n > 0, 'a revived process must re-dial the queued calls');
    assert.equal(db.getRunRow(runId)?.status, 'running');

    await post(`/api/runs/${runId}/pause`);
  });
});
