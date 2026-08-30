import { readFileSync, existsSync } from 'node:fs';

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
  port: num(process.env.PORT, 8080),
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${num(process.env.PORT, 8080)}`,

  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? '',
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
  firebasePrivateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),

  groqKey: process.env.GROQ_API_KEY ?? '',
  extractionModel: process.env.EXTRACTION_MODEL ?? 'llama-3.3-70b-versatile',
  areaAgentModel: process.env.AREA_AGENT_MODEL ?? 'groq/compound',

  authRequired: process.env.AUTH_REQUIRED === '1',
  devAuthToken: process.env.DEV_AUTH_TOKEN ?? '',

  calleKey: process.env.CALLE_API_KEY ?? '',
  calleBaseUrl: process.env.CALLE_BASE_URL ?? 'https://api.heycall-e.com',
  callRegion: process.env.CALL_REGION ?? 'IN',
  calleLocale: { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' } as const,
  calleWebhookSecret: process.env.CALLE_WEBHOOK_SECRET ?? 'dev-secret',
  callerId: process.env.CALLER_ID_E164 ?? '',

  maxConcurrent: num(process.env.MAX_CONCURRENT, 5),
  maxListingsPerRun: num(process.env.MAX_LISTINGS_PER_RUN, 40),
  maxSourcesPerRequest: num(process.env.MAX_SOURCES_PER_REQUEST, 10),
  sourceTimeoutMs: num(process.env.SOURCE_TIMEOUT_MS, 15_000),

  callWindowsIST: parseWindows(process.env.CALL_WINDOWS_IST) ?? [
    { startMin: 11 * 60, endMin: 13 * 60 },
    { startMin: 17 * 60, endMin: 20 * 60 },
  ],
  ignoreCallWindow: process.env.IGNORE_CALL_WINDOW === '1',

  retryDelayMin: num(process.env.RETRY_DELAY_MIN, 30),
  maxAttempts: 2,
  stuckCallMs: num(process.env.STUCK_CALL_MS, 5 * 60_000),
  perNumberCooldownDays: num(process.env.NUMBER_COOLDOWN_DAYS, 7),
} as const;
