import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  updateProfile,
} from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '../firebase';

const FRIENDLY_MESSAGES = {
  'auth/invalid-credential': 'That email or password is incorrect.',
  'auth/invalid-email': 'That email address doesn\'t look right.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'That email or password is incorrect.',
  'auth/email-already-in-use': 'An account already exists with that email.',
  'auth/weak-password': 'Choose a password with at least 8 characters.',
  'auth/popup-closed-by-user': 'The Google sign-in window was closed before finishing.',
  'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection.',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'Sign-in isn\'t configured yet — Firebase credentials are missing.',
};

const friendlyError = (err) => FRIENDLY_MESSAGES[err?.code] ?? err?.message ?? 'Something went wrong. Please try again.';

/** The same answer every sign-in path gives when Firebase was never configured. */
const NOT_CONFIGURED = {
  error: "Sign-in isn't set up yet — the app is missing its Firebase configuration.",
};

export async function signUpWithEmail(name, email, password) {
  if (!isFirebaseConfigured) return NOT_CONFIGURED;
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (name) await updateProfile(credential.user, { displayName: name });
    return { user: credential.user };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

export async function signInWithEmail(email, password) {
  if (!isFirebaseConfigured) return NOT_CONFIGURED;
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return { user: credential.user };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

/**
 * How long to wait for the Google popup before saying something.
 *
 * Generous: a person has to pick an account and possibly type a password, and
 * cutting that short would be worse than saying nothing. This deadline is not
 * about slow humans — it is about a popup that never renders at all.
 */
const POPUP_TIMEOUT_MS = 90_000;

export async function signInWithGoogle() {
  if (!isFirebaseConfigured) return NOT_CONFIGURED;

  // Firebase drives the popup through https://<authDomain>/__/auth/handler.
  // When that host is unreachable — a firewall, an antivirus web shield, an ISP
  // or DNS filter blocking Firebase Hosting — the window opens on about:blank
  // and simply stays there: no navigation, no error, and signInWithPopup never
  // settles. The person is left staring at a blank rectangle with nothing to
  // read and nothing to click.
  //
  // Racing a deadline does not repair that, and is not meant to. It converts
  // silence into a sentence that names the blocked host, which is the
  // difference between "the site is broken" and "something here is blocking
  // firebaseapp.com".
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), POPUP_TIMEOUT_MS);
  });

  try {
    const outcome = await Promise.race([signInWithPopup(auth, googleProvider), deadline]);

    if (outcome === 'timeout') return redirectInstead();

    return { user: outcome.user };
  } catch (err) {
    // A popup that cannot be driven is not a dead end, so it is not reported as
    // one. Google's OAuth page sets Cross-Origin-Opener-Policy: same-origin,
    // which severs the opener relationship and stops Firebase polling
    // `popup.closed` to learn that sign-in finished — the browser logs
    // "Cross-Origin-Opener-Policy policy would block the window.closed call"
    // and the promise may never settle. Declaring COOP on our own page helps
    // and does not always suffice, because the other half of the pair belongs
    // to Google.
    //
    // Redirecting has no second window and therefore no opener relationship to
    // sever, so it cannot fail this way at all.
    if (POPUP_UNUSABLE.has(err?.code)) return redirectInstead();
    return { error: friendlyError(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Firebase error codes that mean "the popup could not be used", as distinct
 * from "the sign-in was refused".
 *
 * Only the first kind is worth retrying by another route. Falling back on a
 * genuine credential failure would send somebody round a redirect to be told
 * no a second time.
 */
const POPUP_UNUSABLE = new Set([
  'auth/popup-blocked',
  'auth/cancelled-popup-request',
  'auth/popup-closed-by-user',
  'auth/web-storage-unsupported',
  'auth/operation-not-supported-in-this-environment',
]);

/**
 * Hand the whole tab to Google instead of opening a window.
 *
 * Never resolves in the normal case: the browser navigates away mid-promise
 * and the answer arrives on the next page load, through
 * :func:`completeGoogleRedirect`. The returned shape exists for the case where
 * the navigation itself is refused.
 */
async function redirectInstead() {
  try {
    await signInWithRedirect(auth, googleProvider);
    return { pending: true };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

/**
 * Finish a sign-in that went via redirect. Call once, early, on page load.
 *
 * Returns `{ user }` when this load is the return leg, and `{}` on every
 * ordinary load — which is most of them, and is not an error.
 */
export async function completeGoogleRedirect() {
  if (!isFirebaseConfigured) return {};
  try {
    const credential = await getRedirectResult(auth);
    return credential?.user ? { user: credential.user } : {};
  } catch (err) {
    return { error: friendlyError(err) };
  }
}

export async function sendReset(email) {
  if (!isFirebaseConfigured) return NOT_CONFIGURED;
  try {
    await sendPasswordResetEmail(auth, email);
    return { ok: true };
  } catch (err) {
    return { error: friendlyError(err) };
  }
}
