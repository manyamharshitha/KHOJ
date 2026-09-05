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
 * 2026-09-06 against each portal's live rent-search page. Only MagicBricks
 * renders its listings to an automated reader; the rest serve a page shell or
 * refuse outright. The unreadable ones stay listed and selectable — pasting a
 * specific listing URL from them still works — but they are off by default,
 * because defaulting to a site that cannot be read makes an empty result look
 * like a broken product.
 */
export const defaultSources = [
  {
    id: 'magicbricks',
    key: 'magicbricks',
    name: 'MagicBricks',
    url: 'magicbricks.com',
    enabled: true,
    readable: true,
    note: 'Listings render for automated readers. Contact numbers need a sign-in.',
  },
  {
    id: 'nobroker',
    key: 'nobroker',
    name: 'NoBroker',
    url: 'nobroker.in',
    enabled: false,
    readable: false,
    note: 'Serves only a page shell to automated readers — listings never render.',
  },
  {
    id: '99acres',
    key: '99acres',
    name: '99acres',
    url: '99acres.com',
    enabled: false,
    readable: false,
    note: 'Refuses automated readers outright (HTTP 403).',
  },
  {
    id: 'housing',
    key: 'housing',
    name: 'Housing.com',
    url: 'housing.com',
    enabled: false,
    readable: false,
    note: 'Refuses automated readers outright (HTTP 406).',
  },
  {
    id: 'olx',
    key: 'olx',
    name: 'OLX',
    url: 'olx.in',
    enabled: false,
    readable: false,
    note: 'Numbers sit behind an in-app chat rather than on the listing.',
  },
];
