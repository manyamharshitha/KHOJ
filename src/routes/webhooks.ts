import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { fromCalleEvent, isCalleEvent } from '../core/calleMapper.js';
import { CalleDialer } from '../core/dialer.calle.js';
import { getDialer, handleCallResult } from '../core/orchestrator.js';
import type { DialerWebhookBody } from '../types.js';

const safeEqual = (a: string, b: string): boolean => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

export async function webhookRoutes(app: FastifyInstance) {
  app.post('/api/webhooks/dialer', async (req, reply) => {
    const raw = req.body as unknown;

    /*
     * Two shapes arrive here.
     *
     * CALL-E sends its own event envelope. API 0.6.0 defines no webhook
     * signature, so a shared secret would be theatre — anyone who learned the
     * URL could post a fabricated broker answer straight into the results
     * table. So a CALL-E delivery is treated as a *notification only*: the call
     * task is read back over an authenticated request and that is what gets
     * stored. Nothing in the request body is trusted except the task id.
     *
     * The mock and manual dialers send our own body and are authenticated by
     * the shared secret, which is meaningful because they are local.
     */
    if (isCalleEvent(raw)) {
      const taskId = raw.data?.id;
      if (!taskId) return reply.code(400).send({ error: 'event carries no call id' });

      const dialer = getDialer();
      if (!(dialer instanceof CalleDialer)) {
        // Not running the live dialer, so there is nothing to verify against.
        // Refuse rather than accept an unauthenticated result.
        return reply.code(401).send({ error: 'live dialer not active' });
      }

      let mapped: DialerWebhookBody | null;
      try {
        const verified = await dialer.fetchCall(taskId);
        mapped = fromCalleEvent({ ...raw, data: verified as unknown as typeof raw.data });
      } catch (err) {
        req.log.error({ err, taskId }, 'could not verify CALL-E event');
        // 5xx so CALL-E retries — this is our failure, not a bad delivery.
        return reply.code(503).send({ error: 'verification failed' });
      }

      if (!mapped) {
        // A task we did not place, or metadata we never set. Ack so it stops.
        return reply.code(200).send({ ok: true, result: 'ignored' });
      }

      try {
        const result = await handleCallResult(mapped);
        return reply.code(200).send({ ok: true, result });
      } catch (err) {
        req.log.error({ err, callId: mapped.callId }, 'webhook handling failed');
        return reply.code(200).send({ ok: false, error: String(err) });
      }
    }

    const sig = String(req.headers['x-dialer-signature'] ?? '');
    if (!safeEqual(sig, config.calleWebhookSecret)) {
      return reply.code(401).send({ error: 'bad signature' });
    }

    const body = raw as DialerWebhookBody;
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
