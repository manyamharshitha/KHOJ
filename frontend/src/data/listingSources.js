/**
 * The portals the backend can actually search.
 *
 * These used to be three invented names — listings.khoj.app, citynest.example.com,
 * rentdirect.example.com — whose ids (`src-1`, `src-2`) were sent verbatim as the
 * `sites` payload. The backend has never heard of them, so a search either failed
 * with "none of those sites could be resolved" or fell through to the server
 * defaults. The panel looked configurable while controlling nothing.
 *
 * `key` is what the API receives, and it must match a key in the backend's
 * `SITES` registry (app/scraping/sites.py).
 *
 * `readable` records what a headless browser actually gets back, measured
 * 2026-09-06 against each portal's live rent-search page. `contactGated` is the
 * field that decides whether a call can actually happen. Zolo and Colive are
 * the only two shown here — managed co-living operators publish one central
 * number on every city page, no login, because it is their own line, not an
 * individual owner's lead to protect. The five that gate the number
 * (MagicBricks, NoBroker, 99acres, Housing.com, OLX) and Stanza Living
 * (no number at all without a callback form) are not listed — they cannot be
 * searched, so listing them as an option only to fail later is worse than not
 * offering it. They still live in `GATED_SITES` below purely so typing one of
 * their names into "add a source" gets an honest explanation instead of a
 * silent, doomed attempt.
 */
export const defaultSources = [
  {
    id: 'zolo',
    key: 'zolo',
    name: 'Zolo',
    url: 'zolostays.com',
    enabled: true,
    readable: true,
    contactGated: false,
    note: 'Managed co-living operator — one central number on every city page, no login.',
  },
  {
    id: 'colive',
    key: 'colive',
    name: 'Colive',
    url: 'colive.com',
    enabled: true,
    readable: true,
    contactGated: false,
    note: 'Managed co-living operator — one central number on every city page, no login.',
  },
];

//: Known but unusable — kept only so `findKnownSource` can explain why.
const GATED_SITES = [
  { key: 'magicbricks', name: 'MagicBricks', contactGated: true },
  { key: 'nobroker', name: 'NoBroker', contactGated: true },
  { key: '99acres', name: '99acres', contactGated: true },
  { key: 'housing', name: 'Housing.com', contactGated: true },
  { key: 'olx', name: 'OLX', contactGated: true },
  { key: 'stanzaliving', name: 'Stanza Living', contactGated: true },
];

//: Spellings that name a portal above without matching its `key` or `url`.
const ALIASES = {
  'no broker': 'nobroker',
  'nobroker.in': 'nobroker',
  '99 acres': '99acres',
  'magic bricks': 'magicbricks',
  'housing.com': 'housing',
  'olx.in': 'olx',
  'zolostays': 'zolo',
  'zolo stays': 'zolo',
  'co live': 'colive',
  'stanza living': 'stanzaliving',
  stanza: 'stanzaliving',
};

/**
 * The known portal named by free text someone typed (a bare name, not a
 * pasted https:// URL), or null. Lets the "add a source" field warn about a
 * gated portal before a search runs rather than after it comes back empty.
 */
export function findKnownSource(raw) {
  const entry = (raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  if (!entry) return null;

  const stem = entry.split('.')[0];
  const key = ALIASES[entry] ?? ALIASES[stem] ?? entry ?? stem;
  return [...defaultSources, ...GATED_SITES].find((s) => s.key === key || s.key === stem) ?? null;
}
