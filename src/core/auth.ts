import { createHash, randomBytes, timingSafeEqual, createPublicKey, createVerify } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';

/**
 * Sign-in with Google, verified server-side.
 *
 * The browser runs Google's own sign-in and gets back an ID token — a JWT that
 * Google signed. This module verifies that signature against Google's published
 * keys and mints our own opaque session. That is the whole of it: no password
 * ever reaches this server, so there is nothing here to leak and no
 * forgot-password flow to build. "Forgot password" is Google's problem.
 *
 * Deliberately no Firebase. Firebase Auth would be a second vendor, a second
 * SDK and a second source of truth for a job that is one signature check.
 */

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

interface Jwk { kid: string; n: string; e: string; kty: string; alg?: string }

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function googleKeys(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`could not fetch Google signing keys (${res.status})`);
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}

const b64urlToBuf = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/**
 * Verifies a Google ID token: signature, issuer, audience, expiry.
 *
 * Written against node:crypto rather than pulling in a JWT library — the check
 * is small enough to read in one sitting, and an auth dependency you cannot
 * read is an auth dependency you cannot audit.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (!config.googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID is not set — cannot verify Google sign-in');
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const header = JSON.parse(b64urlToBuf(headerB64).toString('utf8')) as
    { alg: string; kid: string };
  if (header.alg !== 'RS256') throw new Error(`unexpected token algorithm ${header.alg}`);

  const key = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!key) throw new Error('token signed with an unknown key');

  const pub = createPublicKey({ key: { kty: 'RSA', n: key.n, e: key.e }, format: 'jwk' });
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  if (!verifier.verify(pub, b64urlToBuf(sigB64))) {
    throw new Error('token signature does not verify');
  }

  const claims = JSON.parse(b64urlToBuf(payloadB64).toString('utf8')) as {
    iss: string; aud: string; sub: string; exp: number; email?: string;
    email_verified?: boolean | string; name?: string; picture?: string;
  };

  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new Error(`unexpected issuer ${claims.iss}`);
  // Without this check any Google token from any app would sign someone in here.
  if (claims.aud !== config.googleClientId) throw new Error('token was issued for another app');
  if (claims.exp * 1000 < Date.now()) throw new Error('token has expired');
  if (!claims.email) throw new Error('token carries no email');

  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!verified) throw new Error('Google has not verified that email address');

  return {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    emailVerified: verified,
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  };
}

/* ------------------------------------------------------------- sessions */

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

const SESSION_DAYS = 30;
/** Stored as a hash: a leaked database must not hand over live sessions. */
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function upsertUser(identity: GoogleIdentity): SessionUser {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM users WHERE google_sub = ?')
    .get(identity.sub) as { id: string } | undefined;

  const id = existing?.id ?? `usr_${randomBytes(9).toString('base64url')}`;
  db.prepare(
    `INSERT INTO users (id, google_sub, email, name, picture, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = excluded.email, name = excluded.name,
       picture = excluded.picture, last_seen_at = excluded.last_seen_at`,
  ).run(id, identity.sub, identity.email, identity.name, identity.picture, now, now);

  return { id, email: identity.email, name: identity.name, picture: identity.picture };
}

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(hash(token), userId, new Date().toISOString(), expiresAt);
  return { token, expiresAt };
}

export function userForToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id, u.email, u.name, u.picture, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
  ).get(hash(token)) as
    { id: string; email: string; name: string | null; picture: string | null; expires_at: string }
    | undefined;

  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, picture: row.picture };
}

export const destroySession = (token: string): void => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
};

/** Bearer token, or the session cookie the browser sends back. */
export function tokenFromRequest(headers: Record<string, unknown>): string | undefined {
  const auth = String(headers.authorization ?? '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim() || undefined;

  const cookie = String(headers.cookie ?? '');
  const match = /(?:^|;\s*)khoj_session=([^;]+)/.exec(cookie);
  return match?.[1];
}

/**
 * Constant-time compare for the dev bypass token, so an attacker cannot learn
 * it a character at a time.
 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
