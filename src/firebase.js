import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/**
 * Whether Firebase has enough configuration to be usable.
 *
 * Vite inlines `VITE_*` at build time, so a build made without them produces
 * `undefined` for every field — and `getAuth()` then throws `auth/invalid-api-key`
 * synchronously at module load. This module is imported by the router, so that
 * exception escapes before React mounts and the entire page renders blank: no
 * error boundary, no message, nothing to click.
 *
 * Missing sign-in configuration should cost you sign-in, not the whole site.
 * So Firebase is only constructed when the config is actually present, and
 * callers check `isFirebaseConfigured` rather than assuming `auth` exists.
 */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId,
);

let firebaseApp = null;
let auth = null;
let googleProvider = null;

if (isFirebaseConfigured) {
  firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  googleProvider = new GoogleAuthProvider();
} else {
  // Loud, because the alternative symptom is a site that looks fine but whose
  // sign-in silently does nothing.
  console.warn(
    'Firebase is not configured — sign-in is disabled. Set VITE_FIREBASE_API_KEY, ' +
      'VITE_FIREBASE_AUTH_DOMAIN and VITE_FIREBASE_PROJECT_ID (plus storage bucket, ' +
      'messaging sender id and app id), then REBUILD. Vite inlines these at build ' +
      'time, so adding them without a fresh deploy changes nothing.',
  );
}

export { firebaseApp, auth, googleProvider };
