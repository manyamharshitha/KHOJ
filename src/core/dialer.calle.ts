import { config } from '../config.js';
import type { Dialer, PlaceCallRequest } from './dialer.js';

/**
 * REAL DIALER — INCOMPLETE UNTIL THE DAY-ONE GATES ARE ANSWERED.
 *
 * Every `TODO(gate-N)` below marks something that cannot be written correctly
 * until you have a CALL-E account and have placed five test calls. Nothing else
 * in this codebase depends on those answers: the mock dialer exercises the same
 * webhook route, so the whole system runs end-to-end today.
 *
 *   gate-1  Outbound supported? Concurrency ceiling on a free account?
 *   gate-2  Recognition quality on Indian-accented English and rupee figures.
 *   gate-3  Are recordings retained, exportable, and do turns carry timestamps?
 *           (Click-to-hear evidence depends on per-turn tStartMs/tEndMs. If the
 *           provider returns only a flat audio file, we need forced alignment
 *           or a coarser per-step fallback — decide before building the drawer.)
 *   gate-4  Indian numbering; does caller ID present as a normal mobile?
 *   gate-5  Is there a TypeScript SDK? If Python-only, port this file only.
 *   gate-6  Webhooks or polling? Is there a signing secret and what scheme?
 *
 * Fill this in on 26 Aug, then flip DIALER=calle. Nothing else changes.
 */
export class CalleDialer implements Dialer {
  readonly name = 'calle' as const;

  constructor() {
    if (!config.calleKey) {
      throw new Error('CALLE_API_KEY is not set — cannot use the live dialer');
    }
    if (!config.callerId) {
      throw new Error(
        'CALLER_ID_E164 is not set — never dial from the seeker\'s personal number',
      );
    }
  }

  async placeCall(req: PlaceCallRequest): Promise<{ providerCallId: string }> {
    // TODO(gate-1, gate-5): replace with the CALL-E SDK call.
    //
    // The shape we need from the provider:
    //   - place an outbound call to req.toE164 from req.fromE164
    //   - drive req.script.systemPrompt + req.script.steps as the agent's brief
    //   - return a provider-side id immediately (do not block on the call)
    //   - POST results to `${config.publicUrl}/api/webhooks/dialer` on completion
    //     with a body matching DialerWebhookBody
    //
    // If CALL-E cannot POST to us (gate-6), replace this class with a poller
    // that fabricates the same webhook body and posts it to our own route —
    // the rest of the system stays identical.
    throw new Error(
      'CalleDialer.placeCall is not implemented yet — answer the day-one gates ' +
      'first, then wire the SDK here. Run with DIALER=mock until then.',
    );
  }

  async cancel(_providerCallId: string): Promise<void> {
    // TODO(gate-1): provider-side hangup, used by the kill switch.
    throw new Error('CalleDialer.cancel is not implemented yet');
  }
}
