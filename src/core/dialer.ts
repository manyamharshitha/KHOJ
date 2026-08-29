import type { RenderedScript } from './script.js';

export interface PlaceCallRequest {
  /** Our id, echoed back on the webhook. */
  callId: string;
  toE164: string;
  fromE164: string;
  script: RenderedScript;
  metadata: Record<string, string>;
}

/**
 * Both implementations deliver results the same way: by POSTing to
 * /api/webhooks/dialer. The mock does NOT short-circuit into the database —
 * it calls the real HTTP route, so every line of orchestration, persistence,
 * extraction, ranking and streaming is exercised by offline runs. On demo day
 * the only untested code path is the provider's own SDK call.
 */
export interface Dialer {
  readonly name: 'mock' | 'calle';
  placeCall(req: PlaceCallRequest): Promise<{ providerCallId: string }>;
  cancel(providerCallId: string): Promise<void>;
}
