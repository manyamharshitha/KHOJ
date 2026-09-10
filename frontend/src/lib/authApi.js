import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  getRedirectResult,
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
/**
 * Sign in with Google by handing the whole tab over, not by opening a popup.
 *
 * There is no popup here at all, and that is the point.
 *
 * `signInWithPopup` learns that sign-in finished by polling `popup.closed` on
 * the window it opened. Google's OAuth page sets
 * `Cross-Origin-Opener-Policy: same-origin`, which severs the opener
 * relationship, so that poll is refused: the browser logs
 * "Cross-Origin-Opener-Policy policy would block the window.closed call" on
 * every tick and the promise may never settle at all.
 *
 * Declaring COOP on our own page is necessary and not sufficient — the other
 * half of the pair belongs to Google and cannot be changed from here. Keeping
 * the popup as the primary route and falling back only on an error code did
 * not help either, because this failure raises no error code and never times
 * out. It simply logs, forever.
 *
 * A redirect opens no second window, so there is no opener relationship to
 * sever and this class of failure cannot occur. The cost is a full page
 * navigation; the benefit is a sign-in that works in every browser. The answer
 * arrives on the next page load, through :func:`completeGoogleRedirect`.
 */
export async function signInWithGoogle() {
  if (!isFirebaseConfigured) return NOT_CONFIGURED;

  try {
    await signInWithRedirect(auth, googleProvider);
    // Not normally reached: the browser navigates away mid-promise. This
    // return exists for the case where the navigation itself is refused.
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
