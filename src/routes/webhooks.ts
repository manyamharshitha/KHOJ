import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { handleCallResult } from '../core/orchestrator.js';
import type { DialerWebhookBody } from '../types.js';

const safeEqual = (a: string, b: string): boolean => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

export async function webhookRoutes(app: FastifyInstance) {
  app.post<{ Body: DialerWebhookBody }>('/api/webhooks/dialer', async (req, reply) => {
    // TODO(gate-6): replace with CALL-E's real signature scheme once known.
    // The shared-secret header is a placeholder that the mock also uses, so the
    // verification path is exercised offline.
    const sig = String(req.headers['x-dialer-signature'] ?? '');
    if (!safeEqual(sig, config.calleWebhookSecret)) {
      return reply.code(401).send({ error: 'bad signature' });
    }

    const body = req.body;
    if (!body?.callId || !body?.status) {
      return reply.code(400).send({ error: 'callId and status are required' });
    }

    try {
      const result = await handleCallResult(body);
      return reply.code(200).send({ ok: true, result });
    } catch (err) {
      req.log.error({ err, callId: body.callId }, 'webhook handling failed');
      // 200 on unknown callId so the provider stops retrying a call we lost.
      return reply.code(200).send({ ok: false, error: String(err) });
    }
  });
}
