export type CallStatus =
  | 'queued' | 'dialing' | 'live' | 'completed'
  | 'no_answer' | 'busy' | 'declined' | 'failed' | 'cancelled' | 'blocked';

export type RunStatus =
  | 'queued' | 'running' | 'awaiting_retry' | 'paused' | 'done' | 'killed';

export type Verdict =
  | 'shortlist' | 'over_budget' | 'mismatch' | 'dead' | 'unreachable';

export type Language = 'en' | 'hi' | 'te';

export interface Question {
  id: string;
  text: string;
  category: string | null;
  options: string[];
  selectedOption: string | null;
  customOptions: string[];
  required: boolean;
  custom: boolean;
}

export interface Source {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface Brief {
  city: string;
  rentCeiling: number;
  language: Language;
  questions: Question[];
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

export interface QuestionAnswer {
  questionId: string;
  text: string;
  required: boolean;
  answer: string | null;
  quote: string | null;
  tStartMs: number | null;
  tEndMs: number | null;
}

export interface Extraction {
  callId: string;
  model: string;
  extractedAt: string;
  available: boolean | null;
  baitPivot: boolean | null;
  rentActual: number | null;
  notes: string | null;
  answers: QuestionAnswer[];
  matchScore: number;
  totalQuestions: number;
  verdict: Verdict;
}

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
  rentDelta: number | null;
  assessment: import('./core/authenticity.js').Assessment | null;
}

export interface RunSummary {
  id: string;
  status: RunStatus;
  createdAt: string;
  brief: Brief;
  total: number;
  finished: number;
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

export interface DialerStructuredResult {
  available: boolean | null;
  baitPivot: boolean | null;
  rentActual: number | null;
  notes: string | null;
  answers: { questionId: string; answer: string | null }[];
}

export interface DialerWebhookBody {
  callId: string;
  providerCallId: string;
  status: 'completed' | 'no_answer' | 'busy' | 'declined' | 'failed';
  turns?: Turn[];
  recordingUrl?: string | null;
  durationSec?: number | null;
  consentRecord?: boolean | null;
  error?: string | null;
  structuredResult?: DialerStructuredResult | null;
}
