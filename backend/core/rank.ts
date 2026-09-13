import type {
  Brief, CallStatus, QuestionAnswer, ResultRow, RunSummary, Verdict,
} from '../types.js';

export const DEFAULT_TOTAL_QUESTIONS = 15;
export const MIN_MATCH_THRESHOLD = 12;

export const matchThreshold = (totalQuestions: number): number =>
  Math.max(1, Math.round(totalQuestions * (MIN_MATCH_THRESHOLD / DEFAULT_TOTAL_QUESTIONS)));

export function decideVerdict(
  answers: QuestionAnswer[],
  available: boolean | null,
  baitPivot: boolean | null,
  rentActual: number | null,
  brief: Brief,
  callStatus: CallStatus,
): Verdict {
  if (callStatus !== 'completed') return 'unreachable';
  if (available === false || baitPivot === true) return 'dead';
  if (rentActual !== null && rentActual > brief.rentCeiling) return 'over_budget';

  const requiredUnmet = brief.questions.some((q) => {
    if (!q.required) return false;
    const a = answers.find((x) => x.questionId === q.id);
    return !a || a.answer === null;
  });
  if (requiredUnmet) return 'mismatch';

  if (available === null) return 'unreachable';

  const total = brief.questions.length;
  const matched = answers.filter((a) => a.answer !== null).length;
  return matched >= matchThreshold(total) ? 'shortlist' : 'mismatch';
}

const VERDICT_ORDER: Record<Verdict, number> = {
  shortlist: 0, over_budget: 1, mismatch: 2, dead: 3, unreachable: 4,
};

export function rankRows(rows: ResultRow[]): ResultRow[] {
  return [...rows].sort((a, b) => {
    const va = a.extraction?.verdict ?? 'unreachable';
    const vb = b.extraction?.verdict ?? 'unreachable';
    if (VERDICT_ORDER[va] !== VERDICT_ORDER[vb]) {
      return VERDICT_ORDER[va] - VERDICT_ORDER[vb];
    }
    const ra = a.extraction?.rentActual ?? Number.POSITIVE_INFINITY;
    const rb = b.extraction?.rentActual ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return (b.extraction?.matchScore ?? 0) - (a.extraction?.matchScore ?? 0);
  });
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

export function summarise(rows: ResultRow[]): RunSummary['stats'] {
  const answered = rows.filter((r) => r.status === 'completed').length;
  const decisive = rows.filter(
    (r) => r.extraction && r.extraction.verdict !== 'unreachable',
  ).length;

  const deltaPcts = rows
    .filter((r) => r.rentDelta !== null && r.rentListed)
    .map((r) => (r.rentDelta! / r.rentListed!) * 100);

  return {
    answered,
    decisive,
    shortlisted: rows.filter((r) => r.extraction?.verdict === 'shortlist').length,
    dead: rows.filter((r) => r.extraction?.verdict === 'dead').length,
    baitPivots: rows.filter((r) => r.extraction?.baitPivot === true).length,
    medianRentDeltaPct: median(deltaPcts),
    meanRentDeltaPct: deltaPcts.length
      ? deltaPcts.reduce((a, b) => a + b, 0) / deltaPcts.length
      : null,
  };
}
