/**
 * The 11-character video id from any common YouTube link, or null.
 *
 * Accepts watch?v=, youtu.be/, /embed/, /shorts/ and /live/, on www., m. and the
 * no-cookie domain. Anything else — a Vimeo link, a typo, a playlist with no
 * video, a lookalike host — returns null, so the caller can keep its placeholder
 * up rather than render an iframe that says "video unavailable".
 *
 * Its own module rather than an export beside the component that uses it: a
 * .jsx file exporting something other than components makes Fast Refresh fall
 * back to a full reload on every edit.
 */
export function youtubeId(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.)/, '');
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v');
    if (!id) {
      const [, kind, rest] = url.pathname.split('/');
      if (['embed', 'shorts', 'live'].includes(kind)) id = rest;
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}
