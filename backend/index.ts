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

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(
  `khoj up on ${config.publicUrl} · dialer=calle · ` +
  `concurrency=${config.maxConcurrent}`,
);
