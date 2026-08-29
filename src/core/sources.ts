import { config } from '../config.js';
import { extractPhoneCandidates } from './parseListings.js';

/**
 * Fetches a listing page the seeker gives us and pulls the phone numbers out of
 * it. One URL at a time, on her instruction — this is not a crawler and does
 * not follow links.
 *
 * Be realistic about what this reaches. NoBroker, 99acres and MagicBricks all
 * gate broker phone numbers behind a login and most of them behind an OTP, and
 * they front their pages with bot protection. Expect `blocked` or zero numbers
 * from those hosts. Where it works is the long tail: a Google Sites page, a
 * builder's own site, a WhatsApp-exported HTML file, a Docs export, a plain
 * classifieds page.
 *
 * When a portal blocks us, saying so plainly is the honest outcome. Working
 * around bot protection would mean pretending to be a browser we are not.
 */

const UA = 'KhojBot/0.1 (+https://github.com/manyamharshitha; rental verification)';
const MAX_BYTES = 3 * 1024 * 1024;

/** Hosts known to gate phone numbers. Used to explain a null result, not to block. */
const GATED_HOSTS = [
  'nobroker.in', 'nobroker.com', '99acres.com', 'magicbricks.com',
  'housing.com', 'olx.in', 'squareyards.com',
];

export type SourceOutcome = 'ok' | 'empty' | 'gated' | 'blocked' | 'unreachable' | 'refused';

export interface SourceResult {
  url: string;
  outcome: SourceOutcome;
  phones: string[];
  /** Visible text, kept so the caller can run it through the listing parser. */
  text: string;
  note: string;
}

const isPrivateHost = (host: string): boolean =>
  host === 'localhost' ||
  host.endsWith('.local') ||
  /^(10|127)\./.test(host) ||
  /^192\.168\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
  /^\[?::1\]?$/.test(host) ||
  /^169\.254\./.test(host);

/** Crude but adequate HTML-to-text. No parser dependency for one function. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export async function fetchSource(rawUrl: string): Promise<SourceResult> {
  const base: SourceResult = { url: rawUrl, outcome: 'refused', phones: [], text: '', note: '' };

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ...base, note: 'That does not look like a URL.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ...base, note: 'Only http and https URLs can be read.' };
  }
  // Without this, a URL could make the server fetch its own private network.
  if (isPrivateHost(url.hostname)) {
    return { ...base, note: 'That address is on a private network.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.sourceTimeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,text/plain' },
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return {
      ...base,
      outcome: 'unreachable',
      note: `Could not reach that page (${String(err).slice(0, 80)}).`,
    };
  }
  clearTimeout(timer);

  const gated = GATED_HOSTS.some((h) => url.hostname.endsWith(h));

  if (!res.ok) {
    return {
      ...base,
      outcome: 'blocked',
      note: gated
        ? `${url.hostname} refused the request (HTTP ${res.status}). Portals block ` +
          'automated readers and keep broker numbers behind a login — open the ' +
          'listing yourself and paste the text instead.'
        : `That page returned HTTP ${res.status}.`,
    };
  }

  const type = res.headers.get('content-type') ?? '';
  if (!/text\/html|text\/plain|application\/xhtml/.test(type)) {
    return { ...base, outcome: 'refused', note: `That page is ${type || 'not text'}.` };
  }

  const body = await res.text();
  const html = body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
  const text = htmlToText(html);
  const phones = extractPhoneCandidates(text);

  if (phones.length === 0) {
    return {
      ...base,
      outcome: gated ? 'gated' : 'empty',
      text,
      note: gated
        ? `${url.hostname} does not put broker numbers in the page — they are ` +
          'behind a login and an OTP. Open the listing yourself and paste what ' +
          'you can see.'
        : 'That page loaded, but there were no phone numbers in it.',
    };
  }

  return {
    ...base,
    outcome: 'ok',
    phones,
    text,
    note: `Found ${phones.length} number${phones.length === 1 ? '' : 's'}.`,
  };
}
