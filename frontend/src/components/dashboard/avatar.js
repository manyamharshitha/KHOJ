/**
 * One definition of "the little round picture of you", shared by the top bar
 * and the profile modal.
 *
 * It exists because of a specific, visible bug: a signed-in Google account
 * carries a `photoURL` on `lh3.googleusercontent.com`, and that host refuses a
 * fair number of those requests — it rate-limits, and it 403s when the browser
 * sends a referrer from an origin it does not recognise. When the request
 * fails, an `<img>` does not disappear. It renders the browser's torn-photo
 * placeholder: a grey square, sharp-cornered, sitting next to "Log out" where
 * a face should be. Worse than no picture, because it reads as a broken page.
 *
 * Two fixes, both needed. `referrerPolicy="no-referrer"` stops the referrer
 * being sent at all, which is what Google's CDN is objecting to most of the
 * time. And when it still fails, `onError` retires the image and the caller
 * falls back to initials — which is what the account has when there is no
 * photo anyway, so the failure looks like a design choice rather than a fault.
 */

import { useEffect, useState } from 'react';

/** Up to two initials, or `K` for a name that yields none. */
export const initials = (name) =>
  (name || '')
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'K';

/**
 * Decide whether an avatar URL can be shown, and hand back the props to show it.
 *
 * `usable` is false both when there is no URL and when the one there is has
 * already failed to load, so a caller can use the single flag for the image and
 * for the background behind it — a transparent circle around a missing image is
 * the other half of how this looked broken.
 */
export const useAvatarImage = (src) => {
  const [broken, setBroken] = useState(false);

  // A new URL deserves its own attempt: signing in as somebody else, or
  // uploading a photo after a remote one failed, must not inherit the verdict
  // on the previous one.
  useEffect(() => {
    setBroken(false);
  }, [src]);

  return {
    usable: Boolean(src) && !broken,
    imgProps: {
      src,
      alt: '',
      referrerPolicy: 'no-referrer',
      onError: () => setBroken(true),
    },
  };
};
