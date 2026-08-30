import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { CalleDialer } from './core/dialer.calle.js';
import { assertScriptCompliance } from './core/script.js';
import type { Dialer } from './core/dialer.js';
import { setDialer, startStuckSweeper } from './core/orchestrator.js';
import { areaRoutes } from './routes/area.js';
import { authRoutes } from './routes/auth.js';
import { callRoutes } from './routes/calls.js';
import { listingRoutes } from './routes/listings.js';
import { runRoutes } from './routes/runs.js';
import { sourceRoutes } from './routes/sources.js';
import { webhookRoutes } from './routes/webhooks.js';

export interface BuiltApp {
  app: FastifyInstance;
  stop: () => Promise<void>;
}

export async function buildApp(opts: { dialer?: Dialer } = {}): Promise<BuiltApp> {
  assertScriptCompliance();

  setDialer(opts.dialer ?? new CalleDialer());

  const app = Fastify({
    logger: { transport: undefined, level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 2 * 1024 * 1024,
  });

  const frontendOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || frontendOrigins.includes(origin) || frontendOrigins.includes('*')) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS origin not allowed'), false);
    },
    credentials: true,
  });

  await app.register(authRoutes);
  await app.register(runRoutes);
  await app.register(callRoutes);
  await app.register(listingRoutes);
  await app.register(sourceRoutes);
  await app.register(webhookRoutes);
  await app.register(areaRoutes);

  app.get('/api/health', async () => ({
    ok: true,
    dialer: 'calle',
    model: config.extractionModel,
    maxConcurrent: config.maxConcurrent,
    callWindowEnforced: !config.ignoreCallWindow,
  }));

  const sweeper = startStuckSweeper();

  return {
    app,
    stop: async () => {
      clearInterval(sweeper);
      await app.close();
    },
  };
}
