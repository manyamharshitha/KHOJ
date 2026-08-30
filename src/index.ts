import { buildApp } from './app.js';
import { config } from './config.js';

const { app, stop } = await buildApp();

export { app };
export default app;

const shutdown = async () => {
  await stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/*
 * Always listen. Render, Railway and Fly all set NODE_ENV=production, so gating
 * this on the environment means the process boots, binds nothing, and gets
 * killed by the health check.
 *
 * There is no serverless variant of this server to fall back to: the
 * orchestrator loop, the concurrency semaphore, the SSE streams and the retry
 * timers all need one long-lived process.
 */
await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(
  `khoj up on ${config.publicUrl} · dialer=${config.dialer} · ` +
  `concurrency=${config.maxConcurrent}`,
);
