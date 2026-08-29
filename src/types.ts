// Shared between server and web client.

export type CallStatus =
  | 'queued' | 'dialing' | 'live' | 'completed'
  | 'no_answer' | 'busy' | 'declined' | 'failed' | 'cancelled' | 'blocked';

export type RunStatus =
  | 'queued' | 'running' | 'awaiting_retry' | 'paused' | 'done' | 'killed';

export type Verdict =
  | 'shortlist' | 'over_budget' | 'mismatch' | 'dead' | 'unreachable';

export type TenantProfile =
  | 'family_only' | 'bachelors_ok' | 'working_women_ok' | 'anyone';

/** Every extracted field carries the words it came from. */
export interface Evidence {
  quote: string;
  tStartMs: number | null;
  tEndMs: number | null;
}

export interface Brief {
  city: string;
  rentCeiling: number;
  /** Max brokerage the seeker will accept, in months of rent. */
  brokerageCeilingMonths?: number;
  vegMatters: boolean;
  nonVegRequired?: boolean;
  tenantProfile: 'family' | 'bachelors' | 'working_women';
  moveInBy?: string;
  /** One optional custom question appended to the script. */
  extraQuestion?: string;
}

export interface ListingInput {
  extRef?: string;
  phone: string;
  rentListed?: number;
  locality?: string;
  sourceUrl?: string;
}

export interface Turn {
  who: 'agent' | 'broker';
  text: string;
  tStartMs: number | null;
  tEndMs: number | null;
}

export interface ExtractedFields {
  available: boolean | null;
  /** True when the broker dodged the flat and pushed a different one. */
  baitPivot: boolean | null;
  rentActual: number | null;
  depositMonths: number | null;
  brokerageMonths: number | null;
  nonVegAllowed: boolean | null;
  tenantProfile: TenantProfile | null;
  extraAnswer: string | null;
}

export type FieldName = keyof ExtractedFields;

export interface Extraction extends ExtractedFields {
  callId: string;
  model: string;
  extractedAt: string;
  notes: string | null;
  /** How many of the core fields came back non-null. The honest confidence. */
  fieldsPresent: number;
  evidence: Partial<Record<FieldName, Evidence>>;
  verdict: Verdict;
}

/** One row of the results table. */
export interface ResultRow {
  callId: string;
  listingId: string;
  extRef: string | null;
  phone: string;
  locality: string | null;
  rentListed: number | null;
  status: CallStatus;
  durationSec: number | null;
  consentRecord: boolean | null;
  recordingUrl: string | null;
  error: string | null;
  extraction: Extraction | null;
  /** rentActual - rentListed. Null unless both are known. */
  rentDelta: number | null;
}

export interface RunSummary {
  id: string;
  status: RunStatus;
  createdAt: string;
  brief: Brief;
  total: number;
  finished: number;
  /** Aggregate findings — the headline numbers for the demo. */
  stats: {
    answered: number;
    decisive: number;
    shortlisted: number;
    dead: number;
    baitPivots: number;
    medianRentDeltaPct: number | null;
    meanRentDeltaPct: number | null;
  };
}

/** What a Dialer implementation posts back to /api/webhooks/dialer. */
export interface DialerWebhookBody {
  callId: string;
  providerCallId: string;
  status: 'completed' | 'no_answer' | 'busy' | 'declined' | 'failed';
  turns?: Turn[];
  recordingUrl?: string | null;
  durationSec?: number | null;
  consentRecord?: boolean | null;
  error?: string | null;
}
