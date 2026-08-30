import { config } from '../config.js';
import type { Brief } from '../types.js';
import type { Dialer, PlaceCallRequest } from './dialer.js';
import type { RenderedScript } from './script.js';

export function recipientResultSchema(brief: Brief) {
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
        'toward a different property. Record yes even when they also claimed the ' +
        'original flat was available.',
    },
    rent_actual: {
      type: 'string',
      description:
        'Monthly rent in rupees as a plain integer string, e.g. "32000". ' +
        '"thirty-two thousand" is 32000, "32k" is 32000, "1.2 lakh" is 120000. ' +
        'Empty string if never stated.',
    },
    consent_to_record: {
      type: 'string',
      enum: ['yes', 'no', 'unknown'],
      description: 'Whether the broker agreed to the call being recorded when asked in the opener.',
    },
    notes: {
      type: 'string',
      description: 'One short sentence of context a tenant would want. Empty string if none.',
    },
  };

  for (const q of brief.questions) {
    properties[q.id] = {
      type: 'string',
      description: `Answer to: "${q.text}". Empty string if the broker never addressed it.`,
    };
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

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
        { phones: [req.toE164], region: config.callRegion, locale: config.calleLocale[req.brief.language] },
      ],
      recipient_result_schema: recipientResultSchema(req.brief),
      metadata: { callId: req.callId, runId: req.metadata.runId ?? '' },
      webhook_url: `${config.publicUrl}/api/webhooks/dialer`,
    };

    const res = await fetch(`${config.calleBaseUrl}/v1/calls`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.calleKey}`,
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
    console.warn(
      `[calle] no cancel endpoint in API 0.6.0; ${providerCallId} will run to completion`,
    );
  }

  async fetchCall(providerCallId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${config.calleBaseUrl}/v1/calls/${providerCallId}`, {
      headers: { authorization: `Bearer ${config.calleKey}` },
    });
    if (!res.ok) throw new Error(`CALL-E fetch failed ${res.status}: ${await res.text()}`);
    return (await res.json()) as Record<string, unknown>;
  }
}
