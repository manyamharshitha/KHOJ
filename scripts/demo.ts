/**
 * End-to-end demo against a running server. Creates a run, streams the live
 * event feed, and prints the ranked table when it finishes.
 *
 *   npm start          # in one terminal
 *   npm run demo       # in another
 *
 * With DIALER=mock this places no calls and needs no telephony account.
 * Extraction still needs ANTHROPIC_API_KEY; without it the calls complete and
 * transcripts persist, but every row's verdict stays empty.
 */
import { config } from '../src/config.js';
import type { ResultRow, RunSummary } from '../src/types.js';

const BASE = process.env.DEMO_BASE ?? config.publicUrl;

const BRIEF = {
  city: 'Hyderabad',
  rentCeiling: 35000,
  brokerageCeilingMonths: 1,
  vegMatters: true,
  nonVegRequired: true,
  tenantProfile: 'working_women' as const,
  extraQuestion: 'Is there covered parking?',
};

const LISTINGS = [
  { extRef: 'L-001', phone: '9876543210', rentListed: 28000, locality: 'Kondapur' },
  { extRef: 'L-002', phone: '09876543211', rentListed: 30000, locality: 'Gachibowli' },
  { extRef: 'L-003', phone: '+919876543212', rentListed: 26000, locality: 'Madhapur' },
  { extRef: 'L-004', phone: '98765 43213', rentListed: 24000, locality: 'Kothrud' },
  { extRef: 'L-005', phone: '9876543214', rentListed: 31000, locality: 'Hitec City' },
  { extRef: 'L-006', phone: '9876543215', rentListed: 75000, locality: 'Andheri East' },
  { extRef: 'L-007', phone: '9876543216', rentListed: 29000, locality: 'Indiranagar' },
  { extRef: 'L-008', phone: '9876543217', rentListed: 27000, locality: 'Kukatpally' },
  { extRef: 'L-009', phone: '9876543218', rentListed: 33000, locality: 'Manikonda' },
  { extRef: 'L-010', phone: '9876543219', rentListed: 25000, locality: 'Miyapur' },
  { extRef: 'L-011', phone: '9876543220', rentListed: 32000, locality: 'Nallagandla' },
  { extRef: 'L-012', phone: '9876543221', rentListed: 28500, locality: 'Bachupally' },
];

async function main() {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`No server at ${BASE}. Start one with:  npm start`);
    process.exit(2);
  }
  const h = (await health.json()) as { dialer: string; model: string };
  console.log(`\n  server up · dialer=${h.dialer} · model=${h.model}\n`);

  const created = await fetch(`${BASE}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brief: BRIEF, listings: LISTINGS }),
  });
  if (!created.ok) {
    console.error('run rejected:', await created.text());
    process.exit(1);
  }
  const { runId, queued } = (await created.json()) as { runId: string; queued: number };
  console.log(`  run ${runId} · ${queued} listings queued\n`);

  await streamUntilDone(runId);
  await printTable(runId);
}

/** Consume the SSE feed the way the web client will. */
async function streamUntilDone(runId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/runs/${runId}/events`, {
    headers: { accept: 'text/event-stream' },
  });
  if (!res.body) throw new Error('no event stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const event = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (!event) continue;
      const payload = data && data !== 'null' ? JSON.parse(data) : null;
      render(event, payload);
      if (event === 'run.done') {
        await reader.cancel();
        return;
      }
      if (event === 'run.awaiting_retry') {
        console.log(`     (waiting for retries until ${payload?.resumesAt}) …`);
      }
    }
  }
}

function render(event: string, p: Record<string, unknown> | null) {
  switch (event) {
    case 'run.started':      console.log(`  ▸ dialing ${p?.total} numbers, 5 at a time`); break;
    case 'call.dialing':     console.log(`    · ${p?.extRef ?? ''} ringing ${p?.phone ?? ''}`); break;
    case 'call.answered':    console.log(`    · answered after ${p?.durationSec}s`); break;
    case 'call.done':        console.log(`    ✓ ${p?.verdict ?? p?.status}`); break;
    case 'call.blocked':     console.log(`    ⨯ blocked: ${p?.reason}`); break;
    case 'call.retry_scheduled': console.log(`    ↻ ${p?.status}, retry queued`); break;
    case 'extraction.failed':    console.log(`    ! extraction failed (API key set?)`); break;
    case 'extraction.rejected_fields':
      console.log(`    ! guard discarded unsupported field(s)`); break;
    case 'run.done':         console.log(`  ▸ run finished\n`); break;
    default: break;
  }
}

async function printTable(runId: string) {
  const res = await fetch(`${BASE}/api/runs/${runId}`);
  const { run, rows } = (await res.json()) as { run: RunSummary; rows: ResultRow[] };

  const w = { ref: 7, loc: 14, verdict: 12, listed: 8, actual: 8, delta: 8, ev: 30 };
  const head =
    'REF'.padEnd(w.ref) + 'LOCALITY'.padEnd(w.loc) + 'VERDICT'.padEnd(w.verdict) +
    'LISTED'.padStart(w.listed) + 'ACTUAL'.padStart(w.actual) + 'DELTA'.padStart(w.delta) +
    '  EVIDENCE';
  console.log('  ' + head);
  console.log('  ' + '─'.repeat(head.length));

  for (const r of rows) {
    const e = r.extraction;
    const quote = e?.evidence?.rentActual?.quote ?? e?.evidence?.available?.quote ?? '';
    console.log(
      '  ' +
      (r.extRef ?? '').padEnd(w.ref) +
      (r.locality ?? '').slice(0, w.loc - 1).padEnd(w.loc) +
      (e?.verdict ?? r.status).padEnd(w.verdict) +
      fmtNum(r.rentListed).padStart(w.listed) +
      fmtNum(e?.rentActual ?? null).padStart(w.actual) +
      fmtDelta(r.rentDelta).padStart(w.delta) +
      '  ' + quote.slice(0, w.ev),
    );
  }

  const s = run.stats;
  console.log(`\n  ${run.finished}/${run.total} calls · ${s.answered} answered · ` +
    `${s.decisive} decisive`);
  console.log(`  ${s.shortlisted} shortlisted · ${s.dead} dead · ${s.baitPivots} bait pivots`);
  if (s.meanRentDeltaPct !== null) {
    console.log(
      `\n  Quoted rent ran ${s.meanRentDeltaPct >= 0 ? '+' : ''}` +
      `${s.meanRentDeltaPct.toFixed(1)}% against the listing on average ` +
      `(median ${s.medianRentDeltaPct!.toFixed(1)}%).`,
    );
  } else {
    console.log('\n  No rent comparisons — set ANTHROPIC_API_KEY and run `npm run replay`.');
  }
  console.log(`\n  CSV: ${BASE}/api/runs/${runId}/export.csv\n`);
}

const fmtNum = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-IN'));
const fmtDelta = (n: number | null) =>
  n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toLocaleString('en-IN')}`;

main().catch((err: unknown) => {
  console.error('demo failed:', err);
  process.exit(1);
});
