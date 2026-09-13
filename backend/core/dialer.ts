import type { Brief } from '../types.js';
import type { RenderedScript } from './script.js';

export interface PlaceCallRequest {
  callId: string;
  toE164: string;
  fromE164: string;
  script: RenderedScript;
  brief: Brief;
  metadata: Record<string, string>;
}

export interface Dialer {
  readonly name: 'calle';
  placeCall(req: PlaceCallRequest): Promise<{ providerCallId: string }>;
  cancel(providerCallId: string): Promise<void>;
}
