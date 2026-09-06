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
 * field that decides whether a call can actually happen: MagicBricks renders
 * fine but still needs a sign-in for the number, so it is readable yet gated.
 * Zolo and Colive are the opposite of the other five — managed co-living
 * operators publish one central number on every city page, no login, because
 * it is their own line, not an individual owner's lead to protect. Only they
 * and MagicBricks are worth defaulting on; the rest stay listed and
 * selectable — pasting a specific listing URL from them still works — because
 * defaulting to a site that cannot be read or dialled makes an empty result
 * look like a broken product.
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
  {
    id: 'magicbricks',
    key: 'magicbricks',
    name: 'MagicBricks',
    url: 'magicbricks.com',
    enabled: false,
    readable: true,
    contactGated: true,
    note: 'Listings render for automated readers. Contact numbers need a sign-in.',
  },
  {
    id: 'nobroker',
    key: 'nobroker',
    name: 'NoBroker',
    url: 'nobroker.in',
    enabled: false,
    readable: false,
    contactGated: true,
    note: 'Serves only a page shell to automated readers — listings never render.',
  },
  {
    id: '99acres',
    key: '99acres',
    name: '99acres',
    url: '99acres.com',
    enabled: false,
    readable: false,
    contactGated: true,
    note: 'Refuses automated readers outright (HTTP 403).',
  },
  {
    id: 'housing',
    key: 'housing',
    name: 'Housing.com',
    url: 'housing.com',
    enabled: false,
    readable: false,
    contactGated: true,
    note: 'Refuses automated readers outright (HTTP 406).',
  },
  {
    id: 'olx',
    key: 'olx',
    name: 'OLX',
    url: 'olx.in',
    enabled: false,
    readable: false,
    contactGated: true,
    note: 'Numbers sit behind an in-app chat rather than on the listing.',
  },
  {
    id: 'stanzaliving',
    key: 'stanzaliving',
    name: 'Stanza Living',
    url: 'stanzaliving.com',
    enabled: false,
    readable: true,
    contactGated: true,
    note: "No number on the page — only a 'request a callback' form.",
  },
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
  return defaultSources.find((s) => s.key === key || s.key === stem) ?? null;
}
