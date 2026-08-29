import { readFileSync, existsSync } from 'node:fs';

// Minimal .env loader — avoids a dependency for six variables.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
    }
  }
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/**
 * "11:00-13:00,17:00-20:00" → minute ranges. Returns null on an unset or
 * unparseable value so the caller falls back to the shipped default rather than
 * silently calling at 3am with an empty window list.
 */
function parseWindows(raw: string | undefined) {
  if (!raw?.trim()) return null;
  const out: { startMin: number; endMin: number }[] = [];
  for (const part of raw.split(',')) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(part);
    if (!m) return null;
    const startMin = Number(m[1]) * 60 + Number(m[2]);
    const endMin = Number(m[3]) * 60 + Number(m[4]);
    if (startMin >= endMin) return null;
    out.push({ startMin, endMin });
  }
  return out.length ? out : null;
}

export const config = {
  dialer: (process.env.DIALER ?? 'mock') as 'mock' | 'manual' | 'calle',
  port: num(process.env.PORT, 8080),
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${num(process.env.PORT, 8080)}`,
  dbPath: process.env.DB_PATH ?? './data/broker.db',

  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  calleKey: process.env.CALLE_API_KEY ?? '',
  calleWebhookSecret: process.env.CALLE_WEBHOOK_SECRET ?? 'dev-secret',
  callerId: process.env.CALLER_ID_E164 ?? '',

  maxConcurrent: num(process.env.MAX_CONCURRENT, 5),
  maxListingsPerRun: num(process.env.MAX_LISTINGS_PER_RUN, 40),

  /** TRAI-friendly windows, IST. Two blocks a day. */
  callWindowsIST: parseWindows(process.env.CALL_WINDOWS_IST) ?? [
    { startMin: 11 * 60, endMin: 13 * 60 },
    { startMin: 17 * 60, endMin: 20 * 60 },
  ],
  ignoreCallWindow: process.env.IGNORE_CALL_WINDOW === '1',

  /** One retry on no-answer, this many minutes later. */
  retryDelayMin: num(process.env.RETRY_DELAY_MIN, 30),
  maxAttempts: 2,
  /** A call stuck in `dialing` longer than this is swept to `failed`. */
  stuckCallMs: num(process.env.STUCK_CALL_MS, 5 * 60_000),
  /** Don't call the same number twice within this many days, across all runs. */
  perNumberCooldownDays: num(process.env.NUMBER_COOLDOWN_DAYS, 7),

  extractionModel: process.env.EXTRACTION_MODEL ?? 'claude-opus-5',
} as const;
