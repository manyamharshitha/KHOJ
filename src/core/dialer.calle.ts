import { config } from '../config.js';
import type { Dialer, PlaceCallRequest } from './dialer.js';
import type { RenderedScript } from './script.js';

/**
 * Real CALL-E integration, written against the published contract
 * (CALL-E Developer API 0.6.0 — https://docs.heycall-e.com/openapi/calle.openapi.yaml).
 *
 * Two properties of the API shape this file:
 *
 * 1. The task is natural language, not a step machine. There is no per-question
 *    endpoint, so `buildScript` output is rendered into one task instruction.
 *    The wording still comes from script.ts, which means the boot-time
 *    compliance assertion and the unit tests continue to govern what is said.
 *
 * 2. CALL-E extracts structured JSON itself from `recipient_result_schema`,
 *    after the call reaches a terminal state. That is why `structuredResult`
 *    rides along on our webhook body: the core pipeline needs no LLM key of its
 *    own. Our extractor stays as a fallback and as the thing that attaches
 *    verbatim evidence quotes, which CALL-E does not do.
 */

/** Mirrors ExtractedFields, expressed as the schema CALL-E extracts against. */
export function recipientResultSchema(opts: { extraQuestion?: string }) {
  const properties: Record<string, unknown> = {
    available: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description:
        'yes only if the broker offered a concrete way to see THIS flat — a day, ' +
        'a time, "anytime", "come today". no if they said it is gone, taken, ' +
        'rented, or on hold. unknown if they were merely vague.',
    },
    bait_pivot: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description:
        'yes when the broker steered away from the flat that was asked about and ' +
        'toward a different property — "I have a better one", "that one is gone ' +
        'but I can show you another nearby". Record yes even when they also ' +
        'claimed the original flat was available.',
    },
    rent_actual: {
      type: 'string',
      description:
        'Monthly rent in rupees as a plain integer string, e.g. "32000". ' +
        '"thirty-two thousand" is 32000, "32k" is 32000, "1.2 lakh" is 120000. ' +
        'If the broker corrected a number after the agent read it back, use the ' +
        'correction. Empty string if never stated.',
    },
    deposit_months: {
      type: 'string',
      description:
        'Deposit in months of rent as a plain number string, e.g. "3". Empty ' +
        'string if never stated.',
    },
    brokerage_months: {
      type: 'string',
      description:
        'Brokerage in months of rent, e.g. "1" or "0.5". "no brokerage" is "0". ' +
        'Empty string if never stated.',
    },
    non_veg_allowed: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description:
        'Whether non-vegetarian food is permitted. unknown unless explicitly addressed.',
    },
    tenant_profile: {
      type: 'string',
      enum: ['family_only', 'bachelors_ok', 'working_women_ok', 'anyone', 'unknown'],
      description:
        'Who the owner will rent to. "prefers family but working women are fine" ' +
        'is working_women_ok. unknown unless explicitly addressed.',
    },
    consent_to_record: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description:
        'Whether the broker agreed to the call being recorded when asked in the opener.',
    },
    notes: {
      type: 'string',
      description: 'One short sentence of context a tenant would want. Empty string if none.',
    },
  };

  if (opts.extraQuestion) {
    properties.extra_answer = {
      type: 'string',
      description:
        `Short answer to the tenant's own question: "${opts.extraQuestion}". ` +
        'Empty string if unanswered.',
    };
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

/** Renders the declarative script into the natural-language task CALL-E takes. */
export function buildTask(script: RenderedScript, toE164: string): string {
  const questions = script.steps
    .map((s, i) => {
      const readback = s.confirmNumeric
        ? ' Read the numbers back once to confirm you heard them correctly, and accept any correction.'
        : '';
      const exit = s.exitIf
        ? ' If the answer shows the flat is gone, or they push a different property, thank them and end the call immediately without asking anything else.'
        : '';
      return `${i + 1}. ${s.ask}${readback}${exit}`;
    })
    .join('\n');

  return [
    script.systemPrompt,
    '',
    `Call ${toE164}.`,
    '',
    'Open with exactly this sentence:',
    `"${script.opener}"`,
    '',
    'If they refuse to be recorded, say exactly this and end the call:',
    `"${script.onConsentRefused}"`,
    '',
    'Then ask these questions in order:',
    questions,
    '',
    'Close with:',
    `"${script.close}"`,
  ].join('\n');
}

interface CalleCreateResponse {
  id: string;
  status: string;
}

export class CalleDialer implements Dialer {
  readonly name = 'calle' as const;

  constructor() {
    if (!config.calleKey) {
      throw new Error(
        'DIALER=calle but CALLE_API_KEY is not set. Add it to .env, or run DIALER=mock.',
      );
    }
    // CALL-E requires an https webhook URL. A localhost PUBLIC_URL would place
    // real calls whose results never come back — fail now, not after the spend.
    if (!/^https:\/\//.test(config.publicUrl)) {
      throw new Error(
        `PUBLIC_URL must be a public https:// URL for CALL-E webhooks, got "${config.publicUrl}". ` +
        'Use a tunnel (cloudflared / ngrok) or a deployed host.',
      );
    }
  }

  async placeCall(req: PlaceCallRequest): Promise<{ providerCallId: string }> {
    const body = {
      task: buildTask(req.script, req.toE164),
      recipients: [
        { phones: [req.toE164], region: config.callRegion, locale: config.callLocale },
      ],
      recipient_result_schema: recipientResultSchema({
        extraQuestion: req.metadata.extraQuestion,
      }),
      // Echoed back on the webhook — how a CALL-E task maps to one of our calls.
      metadata: { callId: req.callId, runId: req.metadata.runId ?? '' },
      webhook_url: `${config.publicUrl}/api/webhooks/dialer`,
    };

    const res = await fetch(`${config.calleBaseUrl}/v1/calls`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.calleKey}`,
        // A retried placement must not dial the same broker twice.
        'Idempotency-Key': `${req.callId}:${req.metadata.attempt ?? '1'}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`CALL-E create failed ${res.status}: ${await res.text()}`);
    }

    const call = (await res.json()) as CalleCreateResponse;
    return { providerCallId: call.id };
  }

  async cancel(providerCallId: string): Promise<void> {
    // Contract 0.6.0 exposes no cancel endpoint. The kill switch still stops new
    // placements and marks in-flight calls cancelled locally, but a call already
    // ringing runs to completion. Say so rather than pretending otherwise.
    console.warn(
      `[calle] no cancel endpoint in API 0.6.0; ${providerCallId} will run to completion`,
    );
  }

  /**
   * Read a call task back from CALL-E. The contract defines no webhook
   * signature, so this is how an unsigned delivery is verified: fetch the task
   * by id and trust that, not the request body.
   */
  async fetchCall(providerCallId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${config.calleBaseUrl}/v1/calls/${providerCallId}`, {
      headers: { authorization: `Bearer ${config.calleKey}` },
    });
    if (!res.ok) throw new Error(`CALL-E fetch failed ${res.status}: ${await res.text()}`);
    return (await res.json()) as Record<string, unknown>;
  }
}
