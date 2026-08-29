import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import {
  createSession, destroySession, safeEqual, tokenFromRequest,
  upsertUser, userForToken, verifyGoogleIdToken, type SessionUser,
} from '../core/auth.js';

const COOKIE = 'khoj_session';

const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: string) => {
  const attrs = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',                    // JavaScript cannot read it, so XSS cannot steal it
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (config.publicUrl.startsWith('https://')) attrs.push('Secure');
  reply.header('set-cookie', attrs.join('; '));
};

/**
 * Resolves the caller, or null when anonymous.
 *
 * `AUTH_REQUIRED=0` (the default) keeps every existing workflow — the demo
 * script, Postman, the tests — working without a Google account. Turn it on for
 * a deployment where runs belong to people.
 */
export function currentUser(req: FastifyRequest): SessionUser | null {
  const token = tokenFromRequest(req.headers as Record<string, unknown>);

  // A fixed dev token, so automated tests can exercise the authenticated paths
  // without a Google round-trip. Refused unless explicitly configured.
  if (token && config.devAuthToken && safeEqual(token, config.devAuthToken)) {
    return { id: 'usr_dev', email: 'dev@localhost', name: 'Dev', picture: null };
  }
  return userForToken(token);
}

/** Route guard. Returns the user, or replies 401 and returns null. */
export function requireUser(req: FastifyRequest, reply: FastifyReply): SessionUser | null {
  if (!config.authRequired) return currentUser(req);
  const user = currentUser(req);
  if (!user) {
    reply.code(401).send({ error: 'sign in to continue' });
    return null;
  }
  return user;
}

export async function authRoutes(app: FastifyInstance) {
  /** What the frontend needs to render the sign-in button. */
  app.get('/api/auth/config', async () => ({
    googleClientId: config.googleClientId || null,
    authRequired: config.authRequired,
    // Says plainly why sign-in would fail, instead of a silent dead button.
    ready: Boolean(config.googleClientId),
  }));

  /**
   * The browser completes Google sign-in and posts the resulting ID token here.
   * We verify Google's signature ourselves and mint our own session.
   */
  app.post<{ Body: { idToken?: string } }>('/api/auth/google', async (req, reply) => {
    const idToken = req.body?.idToken;
    if (!idToken) return reply.code(400).send({ error: 'idToken is required' });

    let identity;
    try {
      identity = await verifyGoogleIdToken(idToken);
    } catch (err) {
      req.log.warn({ err }, 'google sign-in rejected');
      // Never echo the reason: it tells an attacker which check they failed.
      return reply.code(401).send({ error: 'that sign-in could not be verified' });
    }

    const user = upsertUser(identity);
    const { token, expiresAt } = createSession(user.id);
    setSessionCookie(reply, token, expiresAt);
    return { user, expiresAt };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ error: 'not signed in' });
    return { user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = tokenFromRequest(req.headers as Record<string, unknown>);
    if (token) destroySession(token);
    reply.header('set-cookie', `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    return { ok: true };
  });
}
