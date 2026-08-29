import type { FastifyInstance } from 'fastify';
import * as db from '../db.js';
import { runExtraction } from '../core/orchestrator.js';

export async function callRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/api/calls/:id', async (req, reply) => {
    const call = db.getCall(req.params.id);
    if (!call) return reply.code(404).send({ error: 'no such call' });

    return {
      call,
      transcript: db.getTranscript(call.id),
      extraction: db.getExtraction(call.id),
    };
  });

  /**
   * Re-run extraction over the stored transcript. Places no calls, costs one
   * Claude request. This is the entire extraction dev loop — and on stage it
   * lets you change the brief and re-rank the table instantly.
   */
  app.post<{ Params: { id: string } }>('/api/calls/:id/reextract', async (req, reply) => {
    const call = db.getCall(req.params.id);
    if (!call) return reply.code(404).send({ error: 'no such call' });
    if (!db.getTranscript(call.id)) {
      return reply.code(409).send({ error: 'no transcript stored for this call' });
    }

    await runExtraction(call.id, call.run_id);
    return { ok: true, extraction: db.getExtraction(call.id) };
  });
}
