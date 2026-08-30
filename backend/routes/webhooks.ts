import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import * as db from '../db.js';
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

    if (isCalleEvent(raw)) {
      const taskId = raw.data?.id;
      if (!taskId) return reply.code(400).send({ error: 'event carries no call id' });

      const dialer = getDialer();
      if (!(dialer instanceof CalleDialer)) {
        return reply.code(401).send({ error: 'live dialer not active' });
      }

      let mapped: DialerWebhookBody | null;
      try {
        const verified = await dialer.fetchCall(taskId);
        const callId = String((verified as { metadata?: Record<string, unknown> }).metadata?.callId ?? '');
        const call = callId ? await db.getCall(callId) : undefined;
        const brief = call ? await db.getBrief(call.run_id) : null;

        mapped = fromCalleEvent(
          { ...raw, data: verified as unknown as typeof raw.data },
          brief?.questions ?? [],
        );
      } catch (err) {
        req.log.error({ err, taskId }, 'could not verify CALL-E event');
        return reply.code(503).send({ error: 'verification failed' });
      }

      if (!mapped) {
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
      return reply.code(200).send({ ok: false, error: String(err) });
    }
  });
}
