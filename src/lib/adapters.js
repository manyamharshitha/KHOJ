/**
 * Backend shapes → the shapes the dashboard already renders.
 *
 * The UI was built against `src/data/callRuns.js`, and that shape is fine. So
 * the translation happens here, at the boundary, rather than by rewriting the
 * components — which keeps this change small and makes it obvious where the
 * mapping lives when a field name changes on either side.
 *
 * The rule that carries over from the backend: **a missing value stays missing.**
 * Nothing here invents a rent, a score, or an answer. A field the call never
 * established renders as "not answered", not as a plausible-looking blank.
 */

/** Backend call_status → the status keys `STATUS_META` already knows. */
const STATUS_MAP = {
  completed: 'completed',
  queued: 'scheduled',
  dialing: 'calling',
  in_progress: 'calling',
  no_answer: 'no-answer',
  busy: 'no-answer',
  failed: 'no-answer',
  cancelled: 'no-answer',
  blocked: 'no-answer',
};

/** A verdict of `dead` outranks the call status — the call worked, the flat didn't. */
function statusFor(call, honesty) {
  if (honesty?.final_verdict === 'likely_misleading') return 'dead';
  return STATUS_MAP[call?.call_status] ?? 'scheduled';
}

const rupees = (n) =>
  typeof n === 'number' && Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : null;

/**
 * A one-line address from whatever the listing actually has.
 *
 * Falls back through title → locality → source, rather than printing "undefined"
 * or an empty card, because a listing with a thin record is still a real result
 * the customer paid a call for.
 */
function addressFor(listing) {
  const bits = [];
  if (listing.bedrooms != null) bits.push(`${listing.bedrooms}BHK`);
  else if (listing.property_type) bits.push(listing.property_type);
  if (listing.locality) bits.push(listing.locality);
  const line = bits.join(' · ');
  return line || listing.title || listing.source_site || 'Listing';
}

/**
 * Honesty score (0–10) → the 0–100 "authenticity" the card shows.
 *
 * Returns null rather than 0 when there is no report. Zero reads as "we checked
 * and it is terrible"; null lets the UI say "not verified yet", which is true.
 */
const authenticityFor = (honesty) =>
  typeof honesty?.honesty_score === 'number' ? Math.round(honesty.honesty_score * 10) : null;

/** Mask a phone for display — the full number is on the card action, not in the list. */
function maskPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return phone;
  return `+${digits.slice(0, 2)} ${digits.slice(2, 4)}xxx xx${digits.slice(-3)}`;
}

/**
 * One backend result → one dashboard run card.
 *
 * @param {object} result  a `ListingResult` from GET /api/session/{id}/results
 */
export function toRunCard(result) {
  const { listing = {}, call, honesty, total_monthly_cost: total } = result ?? {};

  const answers = (call?.qna_pairs ?? [])
    .filter((p) => p?.question)
    .map((p) => ({
      q: p.question,
      // The quote is the broker's exact words; prefer it over a tidied answer,
      // because it is the thing that is actually defensible.
      a: p.quote || p.answer || null,
    }));

  const unmatched = answers.filter((a) => !a.a).map((a) => a.q);

  const spoken = honesty?.listing_discrepancies ?? [];

  return {
    id: listing.id ?? call?.id ?? Math.random().toString(36).slice(2),
    address: addressFor(listing),
    source: listing.source_site ?? 'Khoj',
    matchScore: answers.filter((a) => a.a).length,
    totalQuestions: answers.length || 0,
    status: statusFor(call, honesty),
    language: 'English',
    date: call?.started_at ?? listing.created_at ?? null,
    authenticity: authenticityFor(honesty),

    broker: {
      phone: maskPhone(call?.phone_dialed ?? listing.contact_number),
      email: null,
      isBroker: listing.is_broker ?? null,
    },

    answers: answers.filter((a) => a.a),
    unmatched,

    // Everything below is new information the static fixture never had, and is
    // the actual product: what the advert said versus what was said on the call.
    cost: {
      advertised: rupees(total),
      rent: rupees(listing.rent),
      maintenance: rupees(listing.maintenance),
      deposit: rupees(listing.deposit),
    },
    verdict: honesty?.final_verdict ?? null,
    summary: honesty?.summary ?? listing.ai_match_reason ?? null,
    redFlags: honesty?.red_flags ?? [],
    discrepancies: spoken.map((d) => ({
      field: d.field,
      listed: d.listing_claim,
      said: d.spoken_claim,
      quote: d.quote ?? null,
      severity: d.severity ?? 'moderate',
    })),
    audioUrl: call?.audio_url ?? null,
    recordingConsent: call?.consent_to_record ?? null,
  };
}

/** A whole results payload → the array the dashboard renders. */
export function toRunCards(payload) {
  return (payload?.results ?? []).map(toRunCard);
}

/** The plan banner: what the tier allows and what is left. */
export function toQuota(payload) {
  if (!payload) return null;
  const q = payload.quota ?? payload.current ?? payload;
  return {
    tier: q.tier ?? 'free',
    limit: q.limit ?? q.listings_limit ?? 0,
    used: q.used ?? q.listings_used ?? 0,
    remaining: q.remaining ?? Math.max(0, (q.limit ?? 0) - (q.used ?? 0)),
    message: payload.message ?? q.message ?? null,
  };
}

/** Backend plan catalogue → the pricing cards, keeping their copy. */
export function mergePlans(backendPlans, uiPlans) {
  const byTier = new Map((backendPlans ?? []).map((p) => [p.tier, p]));
  return (uiPlans ?? []).map((plan) => {
    const key = plan.id === 'trial' ? 'free' : plan.id;
    const live = byTier.get(key);
    // The backend owns the number of listings; the UI keeps its own wording.
    return live ? { ...plan, listingsLimit: live.listings_limit } : plan;
  });
}
