import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { safeEqual, tokenFromRequest, verifyFirebaseToken, type SessionUser } from '../core/auth.js';

export async function currentUser(req: FastifyRequest): Promise<SessionUser | null> {
  const token = tokenFromRequest(req.headers as Record<string, unknown>);
  if (!token) return null;

  if (config.devAuthToken && safeEqual(token, config.devAuthToken)) {
    return { id: 'usr_dev', email: 'dev@localhost', name: 'Dev', picture: null };
  }

  try {
    return await verifyFirebaseToken(token);
  } catch {
    return null;
  }
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> {
  if (!config.authRequired) return currentUser(req);
  const user = await currentUser(req);
  if (!user) {
    reply.code(401).send({ error: 'sign in to continue' });
    return null;
  }
  return user;
}

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/config', async () => ({
    authRequired: config.authRequired,
  }));

  app.get('/api/auth/me', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'not signed in' });
    return { user };
  });
}
