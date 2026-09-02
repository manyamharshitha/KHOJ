/**
 * The backend client for Khoj.
 *
 * Every path here mirrors a route in `backend-py/app/routes/`. When one changes
 * on the server it has to change here too — there is no generated client, so
 * this file is the contract, and a mismatch shows up as a 404 at runtime rather
 * than as an error at build time.
 *
 * Every call carries the signed-in user's Firebase ID token, which is what the
 * backend verifies to identify them. Tokens are short-lived and the Firebase SDK
 * refreshes them, so one is fetched per request rather than cached here.
 */

import { auth } from '../firebase';

/**
 * Where the backend lives. Set VITE_API_URL in Vercel to the backend URL.
 *
 * Falls back to localhost for development. If it is unset in a deployed build
 * every request goes to the user's own machine and fails silently-ish, so the
 * console warning below is worth the noise.
 */
const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');

if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  console.warn(
    'VITE_API_URL is not set — API calls will go to localhost and fail. ' +
      'Set it in the Vercel project settings and redeploy.',
  );
}

export class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** The plan is used up. The UI shows an upgrade prompt, not an error. */
  get isQuotaExhausted() {
    return this.status === 402;
  }

  get isUnauthorized() {
    return this.status === 401;
  }

  /** Unreachable or asleep — worth retrying, unlike a 4xx. */
  get isOffline() {
    return this.status === 0;
  }
}

async function authHeader() {
  const user = auth?.currentUser;
  if (!user) return {};
  try {
    return { Authorization: `Bearer ${await user.getIdToken()}` };
  } catch {
    // An expired token that will not refresh is the same as being signed out.
    return {};
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(await authHeader()),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(
      'Could not reach the server. It may be starting up — free instances sleep after inactivity.',
      { status: 0 },
    );
  }

  if (response.status === 204) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    // FastAPI puts the message in `detail`; a validation error puts an array of
    // objects there instead, which would render as "[object Object]" raw.
    const detail = payload?.detail;
    const message =
      (Array.isArray(detail) ? detail.map((d) => d?.msg).filter(Boolean).join(', ') : detail) ||
      payload?.message ||
      `Request failed (${response.status})`;
    throw new ApiError(message, { status: response.status, code: payload?.code });
  }
  return payload;
}

/* ------------------------------------------------------------------ meta */

/** GET /api/health */
export const getHealth = () => request('/api/health');

/** GET /api/auth/config — whether the backend can verify sign-ins at all. */
export const getAuthConfig = () => request('/api/auth/config');

/** GET /api/sites — the portals we know, and which gate their phone numbers. */
export const getSites = () => request('/api/sites');

/** GET /api/plans — the pricing table and the custom-agency threshold. */
export const getPlans = () => request('/api/plans');

/* --------------------------------------------------------------- account */

/** GET /api/auth/me — `{ user, quota }`. Requires a signed-in user. */
export const getMe = () => request('/api/auth/me');

/** GET /api/subscription */
export const getSubscription = () => request('/api/subscription');

/* ---------------------------------------------------------------- search */

/**
 * POST /api/search — start a search.
 *
 * Returns the whole SearchResponse (session_id, status, criteria, target_sites,
 * tier, listings_limit), not just the id, because the caller shows the parsed
 * criteria back to the customer while she waits.
 *
 * @param {object}   params
 * @param {string}   params.prompt         what the customer asked for
 * @param {string[]} params.sites          portal keys or full URLs (max 5)
 * @param {string}   params.pastedContent  listing text; skips crawling entirely
 * @param {boolean}  params.autoCall       start calling once ranking finishes
 */
export const startSearch = ({ prompt, sites = [], pastedContent, autoCall = false }) =>
  request('/api/search', {
    method: 'POST',
    body: {
      prompt,
      sites,
      ...(pastedContent ? { pasted_content: pastedContent } : {}),
      auto_call: autoCall,
    },
  });

/** GET /api/session/{id} — `{ session, listings }`. Progress while it runs. */
export const getSession = (sessionId) => request(`/api/session/${sessionId}`);

/** GET /api/session/{id}/results — `{ session, results, tier, listings_limit, beyond_plan }`. */
export const getResults = (sessionId) => request(`/api/session/${sessionId}/results`);

/** POST /api/session/{id}/call-all — start dialling, cheapest first. */
export const callAll = (sessionId, limit = 0) =>
  request(`/api/session/${sessionId}/call-all${limit ? `?limit=${limit}` : ''}`, {
    method: 'POST',
  });

/**
 * Poll a session until it settles.
 *
 * `ranked` is terminal for a plain search but only a waypoint when the customer
 * asked us to call — the session goes ranked, calling, complete. Treating it as
 * final in that case would stop polling just as the calls began.
 */
export async function waitForSession(
  sessionId,
  { onUpdate, intervalMs = 3000, timeoutMs = 300000, autoCall = false } = {},
) {
  const finished = autoCall
    ? new Set(['complete', 'failed'])
    : new Set(['ranked', 'complete', 'failed']);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const payload = await getSession(sessionId);
      onUpdate?.(payload);
      if (finished.has(payload?.session?.status)) return payload;
    } catch (err) {
      // A 404 means the id is wrong, and polling harder will not fix that.
      // Anything else is likely a cold instance, so keep waiting.
      if (err?.status === 404) throw err;
      onUpdate?.(null);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new ApiError('That search is taking longer than expected.', { status: 0 });
}

/* ----------------------------------------------------------------- leads */

/**
 * POST /api/leads/custom-agency — "need more than 25 a day?".
 *
 * Deliberately works signed out: the person may not have an account yet, and
 * putting a login in front of a "talk to us about money" box loses the lead.
 */
export const submitAgencyLead = ({ email, notes, source = 'pricing_page' }) =>
  request('/api/leads/custom-agency', {
    method: 'POST',
    body: { email, notes: notes || null, source },
  });
