/**
 * The portals the backend can search.
 *
 * `key` is what the API receives, and it must match a key in the backend's
 * `SITES` registry (app/scraping/sites.py).
 *
 * `contactGated` records whether a portal hides its phone numbers behind a
 * login. It is a property of the *call*, not of the search. Khoj reads these
 * pages perfectly well: the rent, the locality, the size and the photos are all
 * public, and that is most of what a person is deciding on. Only the number is
 * withheld.
 *
 * These used to be excluded from this list and actively refused by "add a
 * source", on the reasoning that a listing we cannot ring is not worth showing.
 * That got the product backwards. Finding the flat is the service; the
 * verification call is what happens next, and a listing with no number is still
 * a listing the customer wants to see — they can ring it themselves.
 *
 * They were then listed but left switched off, which was the same mistake
 * wearing a hat. A default search read only Zolo and Colive — two co-living
 * operators that list no ordinary flats and both need a browser — so every
 * search a customer ran without changing anything came back empty while
 * NoBroker had twenty-five matching properties on a page Khoj reads in a
 * second. The gated portals that actually answer are therefore on by default,
 * and labelled so nobody expects a phone number from them.
 *
 * `reach` records what each host actually did when asked for a Yelahanka 2BHK
 * page on 2026-09-11, from a plain request with an ordinary user agent:
 *
 *   'open'    - served the listings
 *   'js-only' - served a shell; the listings are drawn by client-side script
 *   'refused' - answered with an HTTP error, or did not answer
 *
 * Measured rather than assumed, and kept in the file rather than in somebody's
 * memory, because 'refused' is the interesting one: a host that answers 403 is
 * telling us it does not want an automated reader. That is its decision to
 * make, and the honest response is to stop asking — not to return wearing a
 * different hat. So those entries are disabled here and the pipeline skips
 * them, which also stops the crawler spending its per-site timeout to be told
 * no.
 *
 * Re-measure occasionally. A host that refuses today may publish an API
 * tomorrow, and one that is open today may close.
 */
export const defaultSources = [
  {
    id: 'khoj',
    key: 'khoj',
    name: 'Khoj Native Listings',
    url: 'listed directly with us',
    enabled: true,
    readable: true,
    contactGated: false,
    // Not a website. The backend matches this key before the crawler is
    // reached and reads our own `listings` collection instead. It is first in
    // the list because it is the only source where the number was given to us
    // by the person who holds the property rather than scraped off a page.
    native: true,
    note: 'Listed with us directly by owners and brokers — always a working number.',
  },
  {
    id: 'zolo',
    key: 'zolo',
    name: 'Zolo',
    url: 'zolostays.com',
    enabled: true,
    readable: true,
    contactGated: false,
    note: 'Managed co-living, with a number Khoj can ring for you.',
  },
  {
    id: 'colive',
    key: 'colive',
    name: 'Colive',
    url: 'colive.com',
    enabled: true,
    readable: true,
    contactGated: false,
    note: 'Managed co-living, with a number Khoj can ring for you.',
  },
  {
    id: 'nobroker',
    key: 'nobroker',
    name: 'NoBroker',
    url: 'nobroker.in',
    enabled: true,
    readable: true,
    reach: 'open',
    contactGated: true,
    note: 'Flats, rents and photos, with a link straight to each listing.',
  },
  {
    id: 'realestateindia',
    key: 'realestateindia',
    name: 'RealEstateIndia',
    url: 'realestateindia.com',
    enabled: true,
    readable: true,
    reach: 'open',
    contactGated: true,
    note: 'Flats, rents and photos, with a link straight to each listing.',
  },
  {
    id: 'squareyards',
    key: 'squareyards',
    name: 'Square Yards',
    url: 'squareyards.com',
    enabled: false,
    readable: true,
    reach: 'js-only',
    contactGated: true,
    note: 'Rents and sizes, across the whole city.',
  },
  {
    id: 'stanzaliving',
    key: 'stanzaliving',
    name: 'Stanza Living',
    url: 'stanzaliving.com',
    enabled: false,
    readable: true,
    reach: 'open',
    contactGated: true,
    note: 'Managed PGs and co-living rooms, ready to enquire about.',
  },

  // Everything below refused an ordinary request. They stay listed, rather than
  // being deleted, so the next person to wonder "why isn't 99acres in here?"
  // finds the answer instead of adding it back and rediscovering the 403.
  {
    id: '99acres',
    key: '99acres',
    name: '99acres',
    url: '99acres.com',
    enabled: false,
    readable: false,
    reach: 'refused',
    contactGated: true,
    note: 'Refuses automated readers (HTTP 403). Khoj cannot search this portal — open it yourself in a browser.',
  },
  {
    id: 'magicbricks',
    key: 'magicbricks',
    name: 'MagicBricks',
    url: 'magicbricks.com',
    enabled: false,
    readable: false,
    reach: 'refused',
    contactGated: true,
    note: 'Refuses automated readers. Khoj cannot search this portal — open it yourself in a browser.',
  },
  {
    id: 'housing',
    key: 'housing',
    name: 'Housing.com',
    url: 'housing.com',
    enabled: false,
    readable: false,
    reach: 'refused',
    contactGated: true,
    note: 'Refuses automated readers (HTTP 406). Khoj cannot search this portal — open it yourself in a browser.',
  },
  {
    id: 'olx',
    key: 'olx',
    name: 'OLX',
    url: 'olx.in',
    enabled: false,
    readable: false,
    reach: 'refused',
    contactGated: true,
    note: 'Did not answer within a minute. Khoj cannot search this portal — open it yourself in a browser.',
  },
];

/**
 * Sources the pipeline should actually attempt.
 *
 * A host that answered 403 will answer 403 again, and asking costs a full
 * per-site timeout before the same answer arrives — on a small instance that is
 * the difference between a search that returns and one the customer abandons.
 */
export const searchableSources = defaultSources.filter((s) => s.reach !== 'refused');

//: Spellings that name a portal above without matching its `key` or `url`.
const ALIASES = {
  'no broker': 'nobroker',
  'nobroker.in': 'nobroker',
  '99 acres': '99acres',
  'magic bricks': 'magicbricks',
  'housing.com': 'housing',
  'olx.in': 'olx',
  zolostays: 'zolo',
  'zolo stays': 'zolo',
  'co live': 'colive',
  'stanza living': 'stanzaliving',
  'square yards': 'squareyards',
  'squareyards.com': 'squareyards',
  'real estate india': 'realestateindia',
  'realestateindia.com': 'realestateindia',
  stanza: 'stanzaliving',
};

/**
 * The known portal named by free text someone typed (a bare name, not a pasted
 * https:// URL), or null.
 *
 * Used to tell someone what to expect from a portal they are adding — whether
 * the numbers will be there — not to decide whether they may add it.
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
