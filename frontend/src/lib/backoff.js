/**
 * A polling interval that widens while the server is unwell.
 *
 * Every poller in this app fires on a fixed timer, and a fixed timer is exactly
 * wrong when the server is failing: a backend under memory pressure gets killed,
 * the platform answers 503, and the browser — which cannot read a response the
 * edge produced, because it carries no CORS headers — reports a CORS error. The
 * pollers notice none of that and keep firing at the same rate into an instance
 * that is trying to restart, holding it down.
 *
 * So failures widen the gap and a success closes it again. The point is not to
 * be clever about retrying; it is to stop being part of the problem.
 */

/** Consecutive failures after which polling stops until something succeeds. */
export const CIRCUIT_TRIPS_AT = 5;

/**
 * The next interval, given how many consecutive failures a poller has seen.
 *
 * Doubles per failure from `base`, capped at `max`. Returns `null` once the
 * circuit trips — the caller should stop polling entirely rather than settle
 * into a slow drip against a server that has failed five times running.
 *
 * @param {number} failures  consecutive failures; 0 means the last poll worked
 * @param {number} base      the healthy interval, in milliseconds
 * @param {number} max       the widest interval to back off to
 */
export function nextInterval(failures, base, max = 60_000) {
  if (failures === 0) return base;
  if (failures >= CIRCUIT_TRIPS_AT) return null;
  return Math.min(base * 2 ** failures, max);
}

/**
 * Whether a failure says the server is struggling, as opposed to answering.
 *
 * A 404 or a 422 is a healthy server disagreeing with the request, and backing
 * off from those would be pointless — they will say the same thing next time.
 * These are the ones that mean "stop asking for a moment": the platform's own
 * 5xx, its rate limit, and a network failure, which is what a CORS-masked 503
 * looks like from `fetch`.
 */
export function isServerUnwell(err) {
  const status = err?.status;
  return status === 0 || status === 429 || (status >= 500 && status <= 599);
}
