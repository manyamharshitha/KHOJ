import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import * as db from '../db.js';
import { backlog, subscribe } from '../core/events.js';
import { toE164 } from '../core/guardrails.js';
import { pauseRun, startRun } from '../core/orchestrator.js';
import { rankRows, summarise } from '../core/rank.js';
import type { Brief, ListingInput, RunSummary } from '../types.js';

interface CreateRunBody {
  brief: Brief;
  listings: ListingInput[];
  callerNumber?: string;
}

export async function runRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateRunBody }>('/api/runs', async (req, reply) => {
    const { brief, listings, callerNumber } = req.body ?? ({} as CreateRunBody);

    if (!brief?.city || typeof brief.rentCeiling !== 'number') {
      return reply.code(400).send({ error: 'brief.city and brief.rentCeiling are required' });
    }
    if (!Array.isArray(listings) || listings.length === 0) {
      return reply.code(400).send({ error: 'listings must be a non-empty array' });
    }
    if (listings.length > config.maxListingsPerRun) {
      return reply.code(400).send({
        error: `at most ${config.maxListingsPerRun} listings per run`,
      });
    }

    // Reject the whole run on a bad number rather than silently dropping a row.
    const normalised: ListingInput[] = [];
    const seen = new Set<string>();
    for (const [i, l] of listings.entries()) {
      const e164 = toE164(String(l.phone ?? ''));
      if (!e164) {
        return reply.code(400).send({
          error: `listing ${i + 1}: "${l.phone}" is not a valid phone number`,
        });
      }
      if (seen.has(e164)) continue; // duplicates within one paste are silent
      seen.add(e164);
      normalised.push({ ...l, phone: e164 });
    }

    const runId = db.createRun(brief, normalised, callerNumber ?? config.callerId);
    void startRun(runId);
    return reply.code(201).send({ runId, queued: normalised.length });
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const row = db.getRunRow(req.params.id);
    if (!row) return reply.code(404).send({ error: 'no such run' });

    const rows = rankRows(db.getRows(req.params.id));
    const summary: RunSummary = {
      id: row.id,
      status: row.status as RunSummary['status'],
      createdAt: row.created_at,
      brief: JSON.parse(row.brief_json) as Brief,
      total: row.total,
      finished: row.finished,
      stats: summarise(rows),
    };
    return { run: summary, rows };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/events', async (req, reply) => {
    const runId = req.params.id;
    if (!db.getRunRow(runId)) return reply.code(404).send({ error: 'no such run' });

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

    for (const e of backlog(runId, lastId)) send(e.id, e.kind, e.payload);

    const unsubscribe = subscribe(runId, send);
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/pause', async (req, reply) => {
    if (!db.getRunRow(req.params.id)) return reply.code(404).send({ error: 'no such run' });
    await pauseRun(req.params.id);
    return { ok: true, status: 'paused' };
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/resume', async (req, reply) => {
    const row = db.getRunRow(req.params.id);
    if (!row) return reply.code(404).send({ error: 'no such run' });
    if (row.status === 'done') return reply.code(409).send({ error: 'run already finished' });
    void startRun(req.params.id);
    return { ok: true, status: 'running' };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/export.csv', async (req, reply) => {
    if (!db.getRunRow(req.params.id)) return reply.code(404).send({ error: 'no such run' });
    const rows = rankRows(db.getRows(req.params.id));

    const cols = [
      'ref', 'phone', 'locality', 'status', 'verdict', 'rent_listed', 'rent_actual',
      'rent_delta', 'deposit_months', 'brokerage_months', 'non_veg', 'tenant_profile',
      'bait_pivot', 'fields_present', 'duration_sec', 'notes',
      'evidence_rent', 'evidence_available',
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
        r.rentListed, e?.rentActual, r.rentDelta, e?.depositMonths,
        e?.brokerageMonths, e?.nonVegAllowed, e?.tenantProfile, e?.baitPivot,
        e?.fieldsPresent, r.durationSec, e?.notes,
        e?.evidence?.rentActual?.quote, e?.evidence?.available?.quote,
      ].map(esc).join(','));
    }

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${req.params.id}.csv"`);
    return lines.join('\n');
  });
}
