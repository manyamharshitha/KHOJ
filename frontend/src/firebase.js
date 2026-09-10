import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

/**
 * Where the sign-in handler lives.
 *
 * Firebase runs sign-in through `https://<authDomain>/__/auth/handler`. Left at
 * the project default that is `khoj-cd80b.firebaseapp.com` — a different site
 * from this one — so Firebase has to hold the in-flight sign-in in storage
 * belonging to firebaseapp.com. From this page that is third-party storage, and
 * Chrome and Safari block it: the redirect goes to Google, returns, and
 * `getRedirectResult` finds nothing. The person lands back signed out with no
 * error raised anywhere.
 *
 * `vercel.json` proxies `/__/auth/*` to the Firebase handler, so in a deployed
 * build the handler is reachable on this origin and the storage is first-party.
 * Preferring the current host is therefore correct wherever that proxy is
 * deployed — and the proxy ships in the same repository as this file, so the
 * two cannot drift apart.
 *
 * In development there is no proxy, so the configured domain is used. Setting
 * VITE_FIREBASE_AUTH_DOMAIN explicitly still overrides everything, for a host
 * that serves the app without the rewrite.
 */
const configuredAuthDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
const authDomain =
  import.meta.env.PROD && typeof window !== 'undefined'
    ? window.location.hostname
    : configuredAuthDomain;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain,
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
// Deliberately not `firebaseConfig.authDomain`: that is derived from the
// current host in production and so is always truthy, which would make this
// report "configured" for a build that has no Firebase credentials at all. The
// values that actually have to come from the environment are the key and the
// project id.
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.authDomain,
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
