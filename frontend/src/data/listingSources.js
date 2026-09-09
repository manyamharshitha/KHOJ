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
 * a listing the customer wants to see — they can ring it themselves. So the
 * gated portals are offered here, switched off by default and labelled, rather
 * than hidden and blocked.
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
    note: 'Properties added to Khoj by owners and brokers. Always has a working number.',
  },
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
    note: 'Listings are readable. Phone numbers sit behind a login, so Khoj cannot call these for you.',
  },
  {
    id: 'nobroker',
    key: 'nobroker',
    name: 'NoBroker',
    url: 'nobroker.in',
    enabled: false,
    readable: true,
    contactGated: true,
    note: 'Listings are readable. Phone numbers sit behind a login, so Khoj cannot call these for you.',
  },
  {
    id: '99acres',
    key: '99acres',
    name: '99acres',
    url: '99acres.com',
    enabled: false,
    readable: true,
    contactGated: true,
    note: 'Listings are readable. Phone numbers sit behind a login, so Khoj cannot call these for you.',
  },
  {
    id: 'housing',
    key: 'housing',
    name: 'Housing.com',
    url: 'housing.com',
    enabled: false,
    readable: true,
    contactGated: true,
    note: 'Listings are readable. Phone numbers sit behind a login, so Khoj cannot call these for you.',
  },
  {
    id: 'olx',
    key: 'olx',
    name: 'OLX',
    url: 'olx.in',
    enabled: false,
    readable: true,
    contactGated: true,
    note: 'Listings are readable. Phone numbers sit behind a login, so Khoj cannot call these for you.',
  },
  {
    id: 'stanzaliving',
    key: 'stanzaliving',
    name: 'Stanza Living',
    url: 'stanzaliving.com',
    enabled: false,
    readable: true,
    contactGated: true,
    note: 'Listings are readable. Enquiries go through a callback form rather than a published number.',
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
  zolostays: 'zolo',
  'zolo stays': 'zolo',
  'co live': 'colive',
  'stanza living': 'stanzaliving',
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
