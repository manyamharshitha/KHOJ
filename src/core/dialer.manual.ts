import type { Dialer, PlaceCallRequest } from './dialer.js';

/**
 * Places the call and then does nothing — you deliver the result yourself by
 * POSTing to /api/webhooks/dialer.
 *
 * This exists for hand-testing in Postman or curl. The mock dialer completes a
 * call in milliseconds, so there is never a moment where a call is sitting in
 * `dialing` waiting for a webhook. With DIALER=manual every call parks there
 * until you answer it, which lets you drive the exact sequence a real provider
 * would produce: an answered call with a transcript, a no-answer, a duplicate
 * delivery, a bad signature.
 *
 * It also stands in for CALL-E before that integration exists — if you place a
 * real call by hand today, you can feed the transcript in through this path.
 */
export class ManualDialer implements Dialer {
  readonly name = 'mock' as const;

  async placeCall(req: PlaceCallRequest): Promise<{ providerCallId: string }> {
    const providerCallId = `manual_${req.callId}`;
    if (process.env.LOG_LEVEL !== 'silent') console.log(
      `\n[manual] call parked, waiting for you\n` +
      `         callId  ${req.callId}\n` +
      `         to      ${req.toE164}\n` +
      `         opener  "${req.script.opener}"\n` +
      `         deliver a result:  POST /api/webhooks/dialer  { "callId": "${req.callId}", ... }\n`,
    );
    return { providerCallId };
  }

  async cancel(providerCallId: string): Promise<void> {
    if (process.env.LOG_LEVEL !== 'silent') console.log(`[manual] cancelled ${providerCallId}`);
  }
}
