import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import * as db from '../db.js';
import { backlog, subscribe } from '../core/events.js';
import { toE164 } from '../core/guardrails.js';
import { pauseRun, startRun } from '../core/orchestrator.js';
import { rankRows, summarise } from '../core/rank.js';
import { requireUser } from './auth.js';
import type { Brief, ListingInput, RunSummary } from '../types.js';

interface CreateRunBody {
  brief: Brief;
  listings: ListingInput[];
  callerNumber?: string;
}

export async function runRoutes(app: FastifyInstance) {
  const ownsRun = async (
    req: Parameters<typeof requireUser>[0],
    reply: Parameters<typeof requireUser>[1],
    runId: string,
  ): Promise<boolean> => {
    if (!config.authRequired) return true;
    const user = await requireUser(req, reply);
    if (!user) return false;
    const owner = await db.runOwner(runId);
    if (owner && owner !== user.id) {
      reply.code(404).send({ error: 'no such run' });
      return false;
    }
    return true;
  };

  app.post<{ Body: CreateRunBody }>('/api/runs', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (config.authRequired && !user) return reply;
    const { brief, listings, callerNumber } = req.body ?? ({} as CreateRunBody);

    if (!brief?.city || typeof brief.rentCeiling !== 'number') {
      return reply.code(400).send({ error: 'brief.city and brief.rentCeiling are required' });
    }
    if (!Array.isArray(brief.questions)) {
      return reply.code(400).send({ error: 'brief.questions must be an array' });
    }
    if (!Array.isArray(listings) || listings.length === 0) {
      return reply.code(400).send({ error: 'listings must be a non-empty array' });
    }
    if (listings.length > config.maxListingsPerRun) {
      return reply.code(400).send({
        error: `at most ${config.maxListingsPerRun} listings per run`,
      });
    }

    const normalisedBrief: Brief = { ...brief, language: brief.language ?? 'en' };

    const normalised: ListingInput[] = [];
    const seen = new Set<string>();
    for (const [i, l] of listings.entries()) {
      const e164 = toE164(String(l.phone ?? ''));
      if (!e164) {
        return reply.code(400).send({
          error: `listing ${i + 1}: "${l.phone}" is not a valid phone number`,
        });
      }
      if (seen.has(e164)) continue;
      seen.add(e164);
      normalised.push({ ...l, phone: e164 });
    }

    const runId = await db.createRun(
      normalisedBrief, normalised, callerNumber ?? config.callerId, user?.id ?? null,
    );
    void startRun(runId);
    return reply.code(201).send({ runId, queued: normalised.length });
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    if (!(await ownsRun(req, reply, req.params.id))) return reply;
    const row = await db.getRunRow(req.params.id);
    if (!row) return reply.code(404).send({ error: 'no such run' });

    const rows = rankRows(await db.getRows(req.params.id));
    const summary: RunSummary = {
      id: row.id,
      status: row.status as RunSummary['status'],
      createdAt: row.created_at,
      brief: row.brief,
      total: row.total,
      finished: row.finished,
      stats: summarise(rows),
    };
    return { run: summary, rows };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/events', async (req, reply) => {
    if (!(await ownsRun(req, reply, req.params.id))) return reply;
    const runId = req.params.id;
    if (!(await db.getRunRow(runId))) return reply.code(404).send({ error: 'no such run' });

    const lastId = Number(req.headers['last-event-id'] ?? 0) || 0;

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const send = (id: number, kind: string, payload: unknown) => {
      reply.raw.write(`id: ${id}\nevent: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    for (const e of await backlog(runId, lastId)) send(e.id, e.kind, e.payload);

    const unsubscribe = subscribe(runId, send);
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/pause', async (req, reply) => {
    if (!(await ownsRun(req, reply, req.params.id))) return reply;
    if (!(await db.getRunRow(req.params.id))) return reply.code(404).send({ error: 'no such run' });
    await pauseRun(req.params.id);
    return { ok: true, status: 'paused' };
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/resume', async (req, reply) => {
    if (!(await ownsRun(req, reply, req.params.id))) return reply;
    const row = await db.getRunRow(req.params.id);
    if (!row) return reply.code(404).send({ error: 'no such run' });
    if (row.status === 'done') return reply.code(409).send({ error: 'run already finished' });
    void startRun(req.params.id);
    return { ok: true, status: 'running' };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/export.csv', async (req, reply) => {
    if (!(await ownsRun(req, reply, req.params.id))) return reply;
    if (!(await db.getRunRow(req.params.id))) return reply.code(404).send({ error: 'no such run' });
    const rows = rankRows(await db.getRows(req.params.id));

    const cols = [
      'ref', 'phone', 'locality', 'status', 'verdict', 'rent_listed', 'rent_actual',
      'rent_delta', 'match_score', 'total_questions', 'bait_pivot', 'duration_sec', 'notes',
    ];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [cols.join(',')];
    for (const r of rows) {
      const e = r.extraction;
      lines.push([
        r.extRef, r.phone, r.locality, r.status, e?.verdict ?? '',
        r.rentListed, e?.rentActual, r.rentDelta, e?.matchScore, e?.totalQuestions,
        e?.baitPivot, r.durationSec, e?.notes,
      ].map(esc).join(','));
    }

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${req.params.id}.csv"`);
    return lines.join('\n');
  });
}
