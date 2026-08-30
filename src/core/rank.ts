import type {
  Brief, CallStatus, ExtractedFields, ResultRow, RunSummary, Verdict,
} from '../types.js';

/** The five fields that count toward `fieldsPresent`. Not bait_pivot, not extra. */
const CORE_FIELDS = [
  'available', 'rentActual', 'brokerageMonths', 'nonVegAllowed', 'tenantProfile',
] as const;

export const countFieldsPresent = (f: ExtractedFields): number =>
  CORE_FIELDS.reduce((n, k) => n + (f[k] === null ? 0 : 1), 0);

export function decideVerdict(
  f: ExtractedFields,
  brief: Brief,
  callStatus: CallStatus,
): Verdict {
  if (callStatus !== 'completed') return 'unreachable';

  // A pivot to a different property means this listing is gone, whatever was said.
  if (f.available === false || f.baitPivot === true) return 'dead';

  if (f.rentActual !== null && f.rentActual > brief.rentCeiling) return 'over_budget';

  if (brief.brokerageCeilingMonths !== undefined &&
      f.brokerageMonths !== null &&
      f.brokerageMonths > brief.brokerageCeilingMonths) {
    return 'over_budget';
  }

  if (brief.vegMatters && brief.nonVegRequired && f.nonVegAllowed === false) {
    return 'mismatch';
  }

  if (f.tenantProfile !== null) {
    const p = f.tenantProfile;
    if (brief.tenantProfile === 'bachelors' &&
        (p === 'family_only' || p === 'working_women_ok')) {
      return 'mismatch';
    }
    if (brief.tenantProfile === 'working_women' && p === 'family_only') {
      return 'mismatch';
    }
  }

  // Never established whether it exists — don't promote it to shortlist.
  if (f.available === null) return 'unreachable';

  return 'shortlist';
}

const VERDICT_ORDER: Record<Verdict, number> = {
  shortlist: 0, over_budget: 1, mismatch: 2, dead: 3, unreachable: 4,
};

/** shortlist first, then cheapest, then best-evidenced. */
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
    return (b.extraction?.fieldsPresent ?? 0) - (a.extraction?.fieldsPresent ?? 0);
  });
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * The headline numbers. `decisive` — not "all five answers obtained" — is the
 * completion metric: a fifteen-second confirmed-dead call is a success, and
 * counting it as a failure makes the target unreachable by construction.
 */
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
