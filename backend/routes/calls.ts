import type { FastifyInstance } from 'fastify';
import * as db from '../db.js';
import { runExtraction } from '../core/orchestrator.js';

export async function callRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/api/calls/:id', async (req, reply) => {
    const call = await db.getCall(req.params.id);
    if (!call) return reply.code(404).send({ error: 'no such call' });

    return {
      call,
      transcript: await db.getTranscript(call.id),
      extraction: await db.getExtraction(call.id),
    };
  });

  app.post<{ Params: { id: string } }>('/api/calls/:id/reextract', async (req, reply) => {
    const call = await db.getCall(req.params.id);
    if (!call) return reply.code(404).send({ error: 'no such call' });
    if (!(await db.getTranscript(call.id))) {
      return reply.code(409).send({ error: 'no transcript stored for this call' });
    }

    await runExtraction(call.id, call.run_id);
    return { ok: true, extraction: await db.getExtraction(call.id) };
  });
}
