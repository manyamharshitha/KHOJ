import type { FastifyInstance } from 'fastify';
import { parseListings } from '../core/parseListings.js';
import { config } from '../config.js';

export async function listingRoutes(app: FastifyInstance) {
  app.post<{ Body: { text?: string } }>('/api/listings/parse', async (req, reply) => {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) {
      return reply.code(400).send({ error: 'paste some text to read' });
    }
    if (text.length > 200_000) {
      return reply.code(400).send({ error: 'that text is too long — split it up' });
    }

    const result = await parseListings(text);

    if (result.listings.length > config.maxListingsPerRun) {
      return reply.code(400).send({
        error:
          `found ${result.listings.length} numbers, more than the ` +
          `${config.maxListingsPerRun} allowed in one run`,
        listings: result.listings,
      });
    }

    return result;
  });
}
