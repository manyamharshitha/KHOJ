import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
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

export async function signInWithGoogle() {
  if (!isFirebaseConfigured) return NOT_CONFIGURED;
  try {
    const credential = await signInWithPopup(auth, googleProvider);
    return { user: credential.user };
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
