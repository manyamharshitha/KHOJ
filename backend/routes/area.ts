import type { FastifyInstance } from 'fastify';
import { askAboutArea } from '../core/areaAgent.js';

interface AskBody {
  question?: string;
  locality?: string;
  city?: string;
  broker?: { phone?: string | null; email?: string | null } | null;
}

export async function areaRoutes(app: FastifyInstance) {
  app.post<{ Body: AskBody }>('/api/area/ask', async (req, reply) => {
    const { question, locality, city, broker } = req.body ?? {};
    if (!question?.trim()) {
      return reply.code(400).send({ error: 'question is required' });
    }
    if (!locality?.trim() || !city?.trim()) {
      return reply.code(400).send({ error: 'locality and city are required' });
    }

    const result = await askAboutArea(question.trim(), locality.trim(), city.trim());

    if (result.found) {
      return { answer: result.answer, sources: result.sources, found: true, brokerContact: null };
    }
    return { answer: null, sources: [], found: false, brokerContact: broker ?? null };
  });
}
