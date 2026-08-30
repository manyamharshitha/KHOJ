/**
 * Auth enforcement, with AUTH_REQUIRED=1.
 *
 * No Google account is involved: sessions are minted directly, which is exactly
 * what /api/auth/google does once it has verified Google's signature. That means
 * everything below is the real guard, not a stand-in — the only untested step is
 * Google's own signature check, which needs a live client id.
 */
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

const DB = `./data/test-auth-${process.pid}.db`;

process.env.DB_PATH = DB;
process.env.DIALER = 'manual';
process.env.IGNORE_CALL_WINDOW = '1';
process.env.NUMBER_COOLDOWN_DAYS = '0';
process.env.AUTH_REQUIRED = '1';
process.env.DEV_AUTH_TOKEN = '';       // force real sessions
process.env.LOG_LEVEL = 'silent';

mkdirSync('./data', { recursive: true });

const { buildApp } = await import('../src/app.js');
const { createSession, upsertUser } = await import('../src/core/auth.js');
const dbm = await import('../src/db.js');
const { pauseRun, resetRuntimeState } = await import('../src/core/orchestrator.js');

const brief = {
  city: 'Hyderabad', rentCeiling: 35000, vegMatters: false,
  tenantProfile: 'working_women' as const,
};
const listings = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    extRef: `L-${i + from}`,
    phone: `9${String(700000000 + i + from * 1000).padStart(9, '0')}`,
  }));

let app: FastifyInstance;
let stop: () => Promise<void>;
let asha = '';
let bilal = '';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

before(async () => {
  ({ app, stop } = await buildApp());
  await app.ready();

  // Two people, as if each had just completed Google sign-in.
  const a = upsertUser({
    sub: 'google-asha', email: 'asha@example.com',
    emailVerified: true, name: 'Asha', picture: null,
  });
  const b = upsertUser({
    sub: 'google-bilal', email: 'bilal@example.com',
    emailVerified: true, name: 'Bilal', picture: null,
  });
  asha = createSession(a.id).token;
  bilal = createSession(b.id).token;
});

after(async () => {
  // Parked calls keep the orchestrator loop alive, which would keep the test
  // process alive. Stop every run before tearing the app down.
  const runs = dbm.db.prepare('SELECT id FROM runs').all() as { id: string }[];
  for (const r of runs) await pauseRun(r.id);
  resetRuntimeState();

  await stop();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(`${DB}${suffix}`, { force: true }); } catch { /* windows lock */ }
  }
});

describe('auth enforcement', () => {
  it('refuses to start a run for a stranger', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/runs', payload: { brief, listings: listings(2) },
    });
    assert.equal(res.statusCode, 401);
  });

  it('rejects a token that was never issued', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/auth/me', headers: auth('not-a-real-token'),
    });
    assert.equal(res.statusCode, 401);
  });

  it('lets a signed-in user start a run', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/runs',
      headers: auth(asha), payload: { brief, listings: listings(2) },
    });
    assert.equal(res.statusCode, 201);
  });

  it('identifies the signed-in user', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(asha) });
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as { user: { email: string } }).user.email, 'asha@example.com');
  });

  it('keeps one user out of another user\'s run, without confirming it exists', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/runs',
      headers: auth(asha), payload: { brief, listings: listings(2, 50) },
    });
    const { runId } = created.json() as { runId: string };

    for (const url of [
      `/api/runs/${runId}`,
      `/api/runs/${runId}/export.csv`,
      `/api/runs/${runId}/events`,
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: auth(bilal) });
      assert.equal(res.statusCode, 404, `${url} must not leak to another user`);
    }

    const paused = await app.inject({
      method: 'POST', url: `/api/runs/${runId}/pause`, headers: auth(bilal),
    });
    assert.equal(paused.statusCode, 404, 'a stranger must not be able to stop a run');

    // The owner still gets in.
    const own = await app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: auth(asha) });
    assert.equal(own.statusCode, 200);
  });

  it('accepts the session cookie the browser sends back', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/auth/me', headers: { cookie: `khoj_session=${asha}` },
    });
    assert.equal(res.statusCode, 200);
  });

  it('ends the session on logout', async () => {
    const throwaway = createSession(upsertUser({
      sub: 'google-temp', email: 'temp@example.com',
      emailVerified: true, name: null, picture: null,
    }).id).token;

    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(throwaway) })).statusCode,
      200,
    );
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth(throwaway) });
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(throwaway) })).statusCode,
      401,
      'a logged-out token must stop working',
    );
  });

  it('refuses a forged Google token rather than trusting its claims', async () => {
    // Correctly shaped, signed by nobody.
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fake' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com', aud: 'anything',
      sub: 'attacker', email: 'attacker@example.com',
      email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');

    const res = await app.inject({
      method: 'POST', url: '/api/auth/google',
      payload: { idToken: `${header}.${body}.bm90LWEtc2lnbmF0dXJl` },
    });
    assert.equal(res.statusCode, 401);
    // The reason must not be echoed: it tells an attacker which check failed.
    assert.doesNotMatch(JSON.stringify(res.json()), /signature|issuer|audience|client/i);
  });

  it('tells the frontend whether sign-in is actually configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/config' });
    const j = res.json() as { authRequired: boolean; ready: boolean };
    assert.equal(j.authRequired, true);
    // No GOOGLE_CLIENT_ID set in tests, so the frontend should not render a
    // sign-in button that cannot possibly work.
    assert.equal(j.ready, false);
  });
});
