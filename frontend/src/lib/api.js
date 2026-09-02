/**
 * The backend client for Khoj.
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

  get isQuotaExhausted() {
    return this.status === 402;
  }

  get isUnauthorized() {
    return this.status === 401;
  }
}

async function authHeader() {
  const user = auth?.currentUser;
  if (!user) return {};
  try {
    return { Authorization: `Bearer ${await user.getIdToken()}` };
  } catch {
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
    throw new ApiError(payload?.detail ?? payload?.message ?? payload?.error ?? `Request failed (${response.status})`, {
      status: response.status,
      code: payload?.code,
    });
  }
  return payload;
}

/* ------------------------------------------------------------------ meta */

export const getHealth = () => request('/api/health');
export const getAuthConfig = () => request('/api/auth/config');

/* --------------------------------------------------------------- account */

export const getMe = () => request('/api/auth/me');

/* ---------------------------------------------------------------- search */

/**
 * Start a search (create a run). Returns immediately with a run id.
 *
 * @param {object} params - Search parameters
 * @param {string} params.prompt - What the customer asked
 * @param {string[]} params.sites - Listing sites to search
 * @param {string} params.pastedContent - Pasted listing content
 * @param {boolean} params.autoCall - Whether to auto-call listings
 */
export const startSearch = ({ prompt, sites = [], pastedContent, autoCall = false }) =>
  request('/api/runs', {
    method: 'POST',
    body: {
      prompt,
      sites,
      ...(pastedContent ? { pasted_content: pastedContent } : {}),
      auto_call: autoCall,
    },
  }).then(res => res.id || res);

export const getSession = (sessionId) => request(`/api/runs/${sessionId}`);

export const getResults = (sessionId) => request(`/api/runs/${sessionId}`);

export const callAll = (sessionId, limit = 0) =>
  request(`/api/runs/${sessionId}${limit ? `?limit=${limit}` : ''}`, {
    method: 'POST',
  });

/**
 * Poll a run until it completes or times out.
 */
export async function waitForSession(
  sessionId, 
  { onUpdate, intervalMs = 3000, timeoutMs = 300000 } = {}
) {
  const finished = new Set(['ranked', 'complete', 'failed', 'done']);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const payload = await getSession(sessionId);
      onUpdate?.(payload);
      if (finished.has(payload?.status)) return payload;
    } catch (err) {
      onUpdate?.(null);
      if (err.status === 404) throw new ApiError('Run not found', { status: 404 });
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new ApiError('That search is taking longer than expected.', { status: 0 });
}

export default {
  getHealth,
  getAuthConfig,
  getMe,
  startSearch,
  getSession,
  getResults,
  callAll,
  waitForSession,
};
