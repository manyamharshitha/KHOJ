import type { Extraction, ResultRow } from '../types.js';

export type Trust = 'verified' | 'likely' | 'doubtful' | 'dead' | 'unknown';

export interface Signal {
  id: string;
  weight: number;
  label: string;
  quote?: string | null;
}

export interface Assessment {
  trust: Trust;
  score: number;
  signals: Signal[];
  summary: string;
}

const pct = (actual: number, listed: number) => ((actual - listed) / listed) * 100;

export function assessListing(row: {
  extraction: Extraction | null;
  rentListed: number | null;
  status: ResultRow['status'];
  durationSec: number | null;
}): Assessment {
  const e = row.extraction;

  if (row.status !== 'completed') {
    return { trust: 'unknown', score: 0, signals: [], summary: 'Nobody answered, so there is nothing to judge yet.' };
  }

  if (!e) {
    return { trust: 'unknown', score: 0, signals: [], summary: 'The broker answered, but the call has not been read yet.' };
  }

  const signals: Signal[] = [];

  if (e.baitPivot === true) {
    signals.push({ id: 'bait_pivot', weight: -60, label: 'Steered you toward a different property' });
  }
  if (e.available === false) {
    signals.push({ id: 'gone', weight: -50, label: 'Said the flat is gone' });
  }
  if (e.available === true) {
    signals.push({ id: 'viewing_offered', weight: 30, label: 'Offered a concrete time to see it' });
  }

  if (e.rentActual !== null && row.rentListed) {
    const delta = pct(e.rentActual, row.rentListed);
    if (delta <= 2) {
      signals.push({ id: 'rent_matches', weight: 25, label: 'Quoted rent matches the advert' });
    } else if (delta <= 15) {
      signals.push({ id: 'rent_above', weight: -10, label: `Quoted ${Math.round(delta)}% above the advert` });
    } else {
      signals.push({
        id: 'rent_far_above', weight: -30,
        label: `Quoted ${Math.round(delta)}% above the advert — the advert is bait`,
      });
    }
  }

  const matchRatio = e.totalQuestions > 0 ? e.matchScore / e.totalQuestions : 0;
  if (matchRatio >= 0.7) {
    signals.push({ id: 'specific', weight: 20, label: 'Answered the specifics without hedging' });
  } else if (matchRatio <= 0.2) {
    signals.push({ id: 'vague', weight: -20, label: 'Would not commit to any specifics' });
  }

  if (row.durationSec !== null && row.durationSec < 20 && e.available !== false) {
    signals.push({ id: 'too_short', weight: -15, label: 'Call ended before anything was established' });
  }

  const sourced = e.answers.filter((a) => a.quote).length;
  if (e.matchScore > 0 && sourced === 0) {
    signals.push({ id: 'unsourced', weight: -10, label: 'No answer could be tied to the recording' });
  }

  const raw = signals.reduce((sum, s) => sum + s.weight, 0);
  const score = Math.max(0, Math.min(100, 50 + raw));

  const trust: Trust =
    e.baitPivot === true || e.available === false ? 'dead'
    : score >= 80 ? 'verified'
    : score >= 60 ? 'likely'
    : 'doubtful';

  return { trust, score, signals, summary: summarise(trust, signals, e, row.rentListed) };
}

function summarise(trust: Trust, signals: Signal[], e: Extraction, rentListed: number | null): string {
  if (e.baitPivot === true) {
    return 'The broker pushed a different flat when asked about this one. Treat the advert as bait.';
  }
  if (e.available === false) return 'Gone. The broker said so themselves.';

  const gap = e.rentActual !== null && rentListed ? Math.round(pct(e.rentActual, rentListed)) : null;

  if (trust === 'verified') {
    return gap !== null && gap > 2
      ? `Real, and worth a visit — but budget for ${gap}% above the advert.`
      : 'Real, priced as advertised, and they offered a time to see it.';
  }
  if (trust === 'likely') {
    return gap !== null && gap > 15
      ? `Probably real, but the advert is ${gap}% under what they quoted.`
      : 'Probably real. A few answers were missing, so confirm before you travel.';
  }
  const worst = signals.filter((s) => s.weight < 0).sort((a, b) => a.weight - b.weight)[0];
  return worst ? `Doubtful — ${worst.label.toLowerCase()}.` : 'Doubtful. The broker would not commit to specifics.';
}
