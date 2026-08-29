import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import type { DialerWebhookBody, Turn } from '../types.js';
import type { Dialer, PlaceCallRequest } from './dialer.js';

interface Fixture {
  name: string;
  /** completed | no_answer | busy | declined */
  outcome: DialerWebhookBody['status'];
  consentRecord?: boolean | null;
  weight?: number;
  turns: Turn[];
}

const FIXTURE_DIR = 'fixtures';

function loadFixtures(): Fixture[] {
  let files: string[];
  try {
    files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.map((f) => {
    const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) as Fixture;
    return { ...raw, name: raw.name ?? f };
  });
}

/** Deterministic per callId, so a replayed run produces the same outcomes. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const lastTurnEnd = (turns: Turn[]): number =>
  turns.reduce((max, t) => Math.max(max, t.tEndMs ?? 0), 0);

export class MockDialer implements Dialer {
  readonly name = 'mock' as const;
  private fixtures: Fixture[];
  private timers = new Map<string, NodeJS.Timeout>();
  /** Compress mock call durations so a 20-call run finishes in seconds. */
  private speed: number;

  constructor(speed = Number(process.env.MOCK_SPEED ?? 25)) {
    this.fixtures = loadFixtures();
    this.speed = speed > 0 ? speed : 1;
    if (this.fixtures.length === 0) {
      console.warn('[mock] no fixtures found in ./fixtures — every call will fail');
    }
  }

  async placeCall(req: PlaceCallRequest): Promise<{ providerCallId: string }> {
    // Seed includes the attempt so a retry can succeed where the first try
    // didn't — otherwise every retry deterministically repeats its no-answer.
    const attempt = req.metadata.attempt ?? '1';
    const seed = `${req.callId}#${attempt}`;
    const providerCallId = `mock_${req.callId}_${attempt}`;
    const r = hash(seed);

    // Realistic outcome distribution for Indian broker numbers.
    let fixture: Fixture | undefined;
    let status: DialerWebhookBody['status'];
    if (r < 0.14) {
      status = 'no_answer';
    } else if (r < 0.19) {
      status = 'busy';
    } else {
      status = 'completed';
      const pool = this.fixtures.filter((f) => f.outcome === 'completed');
      fixture = pool.length
        ? pool[Math.floor(hash(seed + 'x') * pool.length) % pool.length]
        : undefined;
      if (!fixture) status = 'failed';
    }

    const realMs =
      status === 'completed' && fixture ? lastTurnEnd(fixture.turns) + 800 : 12_000;
    const delay = Math.max(120, realMs / this.speed);

    const timer = setTimeout(() => {
      this.timers.delete(providerCallId);
      const body: DialerWebhookBody = {
        callId: req.callId,
        providerCallId,
        status,
        turns: fixture?.turns,
        durationSec: Math.round(realMs / 1000),
        recordingUrl: fixture ? `mock://recording/${req.callId}.mp3` : null,
        consentRecord: fixture ? (fixture.consentRecord ?? true) : null,
        error: status === 'failed' ? 'no fixture available' : null,
      };
      void this.deliver(body);
    }, delay);

    this.timers.set(providerCallId, timer);
    return { providerCallId };
  }

  async cancel(providerCallId: string): Promise<void> {
    const t = this.timers.get(providerCallId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(providerCallId);
    }
  }

  /** Deliberately goes over HTTP to the same route the real provider uses. */
  private async deliver(body: DialerWebhookBody): Promise<void> {
    try {
      const res = await fetch(`${config.publicUrl}/api/webhooks/dialer`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dialer-signature': config.calleWebhookSecret,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error(`[mock] webhook rejected ${res.status}`, await res.text());
      }
    } catch (err) {
      console.error('[mock] webhook delivery failed', err);
    }
  }
}
