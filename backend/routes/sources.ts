import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { parseListings } from '../core/parseListings.js';
import { fetchSource } from '../core/sources.js';
import { requireUser } from './auth.js';

export async function sourceRoutes(app: FastifyInstance) {
  app.post<{ Body: { urls?: string[] } }>('/api/sources/fetch', async (req, reply) => {
    if (config.authRequired && !(await requireUser(req, reply))) return reply;

    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    if (urls.length === 0) {
      return reply.code(400).send({ error: 'urls must be a non-empty array' });
    }
    if (urls.length > config.maxSourcesPerRequest) {
      return reply.code(400).send({
        error: `at most ${config.maxSourcesPerRequest} URLs at a time`,
      });
    }

    const sources = [];
    const allText: string[] = [];
    for (const url of urls) {
      const result = await fetchSource(String(url));
      allText.push(result.text);
      sources.push({
        url: result.url,
        outcome: result.outcome,
        phones: result.phones,
        note: result.note,
      });
    }

    const parsed = await parseListings(allText.join('\n\n'));

    return {
      sources,
      listings: parsed.listings,
      enriched: parsed.enriched,
      note: parsed.note,
    };
  });
}
