import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { CalleDialer } from './core/dialer.calle.js';
import { ManualDialer } from './core/dialer.manual.js';
import { MockDialer } from './core/dialer.mock.js';
import { assertScriptCompliance } from './core/guardrails.js';
import type { Dialer } from './core/dialer.js';
import { setDialer, startStuckSweeper } from './core/orchestrator.js';
import { callRoutes } from './routes/calls.js';
import { listingRoutes } from './routes/listings.js';
import { runRoutes } from './routes/runs.js';
import { webhookRoutes } from './routes/webhooks.js';

export function dialerFor(name: string): Dialer {
  if (name === 'calle') return new CalleDialer();
  if (name === 'manual') return new ManualDialer();
  return new MockDialer();
}

export interface BuiltApp {
  app: FastifyInstance;
  stop: () => Promise<void>;
}

/**
 * Builds the server without listening, so integration tests can boot it
 * in-process on an ephemeral port. `src/index.ts` is the thin entry point that
 * calls this and listens.
 */
export async function buildApp(opts: { dialer?: Dialer } = {}): Promise<BuiltApp> {
  // Fails the boot rather than the compliance story: the disclosure and consent
  // sentences cannot be edited away by accident.
  assertScriptCompliance();

  setDialer(opts.dialer ?? dialerFor(config.dialer));

  const app = Fastify({
    logger: { transport: undefined, level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });
  await app.register(runRoutes);
  await app.register(callRoutes);
  await app.register(listingRoutes);
  await app.register(webhookRoutes);

  app.get('/api/health', async () => ({
    ok: true,
    // Surfaced so you never demo the wrong dialer by accident.
    dialer: config.dialer,
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
