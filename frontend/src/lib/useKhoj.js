/**
 * React hooks over the backend.
 *
 * Every one of these degrades rather than breaks. If `VITE_API_URL` is unset, or
 * the Render instance is asleep, or the user is signed out, the hook reports an
 * error and an empty result and the panel says so. It used to substitute bundled
 * demo data instead, which read as a completed verification on an account that
 * had never placed a call.
 *
 * Two rules hold throughout: a fetch runs inside try/catch/finally so `loading`
 * is always cleared, and nothing reaches a state setter without its shape being
 * checked first — a bad payload should surface as an error card, never as an
 * exception thrown during render.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';

import { auth, isFirebaseConfigured } from '../firebase';
import * as api from './api';
import { toDashboard, toQuota, toRunCards } from './adapters';

/** True once Vite has an API URL baked in. */
export const API_CONFIGURED = Boolean(import.meta.env.VITE_API_URL);

/* ------------------------------------------------------------------ auth */

/**
 * The Firebase user, once Firebase has decided.
 *
 * `ready` matters: on first paint Firebase has not yet restored the session, so
 * `user` is null for a moment. Rendering "signed out" during that window makes
 * the app flicker people back to the login screen on every refresh.
 */
export function useAuthUser() {
  const [state, setState] = useState({ user: null, ready: false });

  useEffect(() => {
    // No Firebase, no session to wait for. Report ready immediately so the app
    // renders signed-out instead of hanging on a spinner.
    if (!isFirebaseConfigured || !auth) {
      setState({ user: null, ready: true });
      return undefined;
    }

    let active = true;
    const unsub = onAuthStateChanged(
      auth,
      (user) => active && setState({ user, ready: true }),
      // A misconfigured Firebase throws here. Treat it as signed out and ready,
      // so the app renders rather than hanging on a spinner forever.
      () => active && setState({ user: null, ready: true }),
    );
    return () => {
      active = false;
      unsub();
    };
  }, []);

  return state;
}

/* --------------------------------------------------------------- profile */

/** The signed-in user's plan and remaining quota, from the backend. */
export function useQuota() {
  const { user, ready } = useAuthUser();
  const [quota, setQuota] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!API_CONFIGURED || !user) return;
    try {
      setQuota(toQuota(await api.getMe()));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [user]);

  useEffect(() => {
    if (ready) void refresh();
  }, [ready, refresh]);

  return { quota, error, refresh, isLive: API_CONFIGURED && Boolean(user) };
}

/* --------------------------------------------------------------- results */

/**
 * Verified listings for one session, or the demo set when there is nothing live.
 *
 * @param {string|null} sessionId  omit to show the demo data
 */
export function useResults(sessionId, { active = false } = {}) {
  const { ready } = useAuthUser();
  const [runs, setRuns] = useState([]);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    // Nothing to show is shown as nothing.
    //
    // This used to fall back to a bundled sample set — a Gachibowli flat at
    // Rs 38,000, "96% likely genuine", a broker email at example.com. On an
    // account that had never placed a call it read as a completed verification,
    // which is the single most misleading thing this product could display: the
    // whole premise is that a number on screen was confirmed by a phone call.
    //
    // Being signed in is deliberately *not* a condition. It used to be, and
    // that emptied the panel for the entire configuration the product ships in
    // for demos: with AUTH_REQUIRED off there is no Firebase user, so a search
    // that had scraped and ranked a dozen flats rendered as nothing at all. The
    // server decides who may read a session; guessing at it here only produced
    // a blank screen for people the server would have answered.
    if (!API_CONFIGURED || !sessionId) {
      setRuns([]);
      setIsLive(false);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const payload = await api.getResults(sessionId);
      // toRunCards already returns an array for any input; the guard here is
      // for the day someone changes it and this stops being true.
      const cards = toRunCards(payload);
      if (!Array.isArray(cards)) throw new Error('The server returned results in an unexpected format.');
      // An empty live result is still live — showing samples over the top of it
      // would tell the customer she has results she does not have.
      setRuns(cards);
      setIsLive(true);
      setError(null);
    } catch (err) {
      // A failed fetch is an error, not an empty result. Saying so lets the
      // panel offer a retry instead of implying the search found nothing.
      // Normalised to an Error so `error.message` is always reachable: a
      // rejected promise can carry a string, and a string has no `.message`.
      setError(err instanceof Error ? err : new Error(String(err)));
      setRuns([]);
      setIsLive(false);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // Two things here take time, and both would otherwise be watched by a person
  // pressing refresh.
  //
  // A crawl runs for tens of seconds before the first listing exists, so a
  // panel that fetched once on mount showed an empty session and stopped —
  // which is what "search does nothing" looked like from the outside.
  //
  // A call then runs for minutes, its row moving DIALING → IN_PROGRESS →
  // COMPLETED, so a single fetch froze whichever state happened to exist when
  // the panel mounted.
  //
  // `active` is the caller saying a search is still running. Polling stops as
  // soon as neither is true, so a settled result set costs nothing.
  const inFlight = runs.some((r) => r.status === 'calling' || r.status === 'scheduled');

  useEffect(() => {
    if (!ready || (!inFlight && !active)) return undefined;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [ready, inFlight, active, load]);

  return { runs, isLive, loading, error, reload: load };
}


/* ---------------------------------------------------------------- search */

/**
 * Start a search and follow it to completion.
 *
 * The backend returns a session id immediately and does the crawling in the
 * background, so this polls and reports progress rather than blocking on one
 * long request that a proxy would time out anyway.
 */
export function useSearch() {
  const [sessionId, setSessionId] = useState(null);
  const [status, setStatus] = useState('idle');
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  const start = useCallback(
    async ({
      prompt,
      city,
      localities = [],
      sites = [],
      pastedContent,
      autoCall = false,
      onStarted,
    }) => {
    setError(null);
    setStatus('starting');
    try {
      const created = await api.startSearch({
        prompt,
        city,
        localities,
        sites,
        pastedContent,
        autoCall,
      });
      if (cancelled.current) return null;
      setSessionId(created.session_id);
      setStatus('running');

      // The session exists and the backend is now crawling. Callers are told
      // here rather than at the end, because this promise does not settle until
      // the whole search has finished — which can be minutes, and which is a
      // useless moment to learn the id. A caller that waited for the return
      // value before showing the results tab left the customer on the previous
      // screen for the entire crawl, and showed them nothing at all if it timed
      // out, since the failure path returns null and never fires.
      onStarted?.(created.session_id);

      const final = await api.waitForSession(created.session_id, {
        autoCall,
        onUpdate: (payload) => {
          // `payload` is null when a poll failed but is worth retrying — a cold
          // instance, a dropped connection. Keep the last known state rather
          // than blanking the panel on a blip.
          if (cancelled.current || !payload) return;
          setSession(payload.session);
          setStatus(payload.session?.status ?? 'running');
        },
      });
      if (!cancelled.current) setStatus(final?.session?.status ?? 'complete');
      return created.session_id;
    } catch (err) {
      if (!cancelled.current) {
        setError(err);
        setStatus('failed');
      }
      return null;
    }
  }, []);

  const callAll = useCallback(
    async (limit = 0) => {
      if (!sessionId) return null;
      try {
        return await api.callAll(sessionId, limit);
      } catch (err) {
        setError(err);
        return null;
      }
    },
    [sessionId],
  );

  return { start, callAll, sessionId, session, status, error, isConfigured: API_CONFIGURED };
}

/* ----------------------------------------------------------------- leads */

/** The "need more than 25 a day?" form. Works signed out, on purpose. */
export function useAgencyLead() {
  const [state, setState] = useState({ status: 'idle', message: null });

  const submit = useCallback(async (email, notes) => {
    setState({ status: 'sending', message: null });
    if (!API_CONFIGURED) {
      setState({
        status: 'error',
        message: 'The server is not connected yet. Please email us directly.',
      });
      return false;
    }
    try {
      const res = await api.submitAgencyLead({ email, notes });
      setState({ status: 'sent', message: res?.message ?? 'Thanks — we will be in touch.' });
      return true;
    } catch (err) {
      setState({ status: 'error', message: err?.message ?? 'Could not send that just now.' });
      return false;
    }
  }, []);

  return { ...state, submit };
}


/* --------------------------------------------------------------- profile */

/**
 * The signed-in user's profile, synced with the backend.
 *
 * On sign-in it fetches the stored profile. First-time users have none, so the
 * Firebase display name and email are pushed up once to create it — which is
 * also what captures a Google name into our own store. `needsName` is true when
 * neither the token nor the stored profile has a usable name, so the UI can
 * prompt for one rather than showing "there".
 */
export function useProfile() {
  const { user, ready } = useAuthUser();
  const [profile, setProfile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ready || !API_CONFIGURED || !user) return;
    let active = true;

    (async () => {
      const fallbackName = user.displayName || '';
      try {
        let stored = null;
        try {
          stored = await api.getUserProfile(user.uid);
        } catch (err) {
          if (err?.status !== 404) throw err;
        }

        // No profile yet, or the token carries a name the store is missing:
        // write once so a Google sign-in is captured without a form.
        if (!stored || (!stored.name && fallbackName)) {
          stored = await api.saveUserProfile({
            userId: user.uid,
            name: fallbackName || undefined,
            email: user.email || undefined,
          });
        }
        if (active) setProfile(stored);
      } catch {
        // Never block the dashboard on a profile round-trip — fall back to the
        // token's own fields.
        if (active) {
          setProfile({ user_id: user.uid, name: fallbackName, email: user.email });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [ready, user]);

  const saveName = useCallback(
    async (name) => {
      if (!user || !name?.trim()) return;
      setSaving(true);
      try {
        const updated = await api.saveUserProfile({ userId: user.uid, name: name.trim() });
        setProfile(updated);
      } finally {
        setSaving(false);
      }
    },
    [user],
  );

  /**
   * Persist the customer's own listing sites against her account.
   *
   * The whole list is sent, not a delta — the endpoint replaces the field, so
   * an add and a remove are the same call and cannot drift out of sync.
   */
  const saveCustomSources = useCallback(
    async (urls) => {
      if (!user) return null;
      setSaving(true);
      try {
        const updated = await api.saveUserProfile({ userId: user.uid, customSources: urls });
        setProfile(updated);
        return updated;
      } finally {
        setSaving(false);
      }
    },
    [user],
  );

  const displayName = profile?.name || user?.displayName || '';
  const needsName = Boolean(ready && user && !displayName);

  return {
    profile,
    displayName,
    needsName,
    saveName,
    saveCustomSources,
    customSources: profile?.custom_sources ?? null,
    saving,
    user,
    ready,
  };
}


/* ------------------------------------------------------------- dashboard */

/**
 * The overview panel's stats and recent activity.
 *
 * `data` stays null until the request settles, which is what lets the panel
 * tell "still loading" apart from "this account has genuinely done nothing" —
 * showing an empty state during the first fetch would flash a "get started"
 * prompt at someone who has run fifty searches.
 */
export function useDashboard() {
  const { ready } = useAuthUser();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    // No API URL is a build configuration problem, not an empty account. Saying
    // so beats rendering a grid of em dashes that looks like a real but idle
    // dashboard — the two used to be indistinguishable on screen.
    if (!API_CONFIGURED) {
      setData(null);
      setError(new Error('The API URL is not configured for this build.'));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const payload = await api.getDashboard();
      // Verified before it is stored, not after it reaches JSX. A 200 is not a
      // promise that the body is the object this panel expects.
      const next = toDashboard(payload);
      if (!next) throw new Error('The server returned a dashboard in an unexpected format.');
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setData(null);
    } finally {
      // In `finally` so a throw between the two setters cannot strand the
      // panel on its loading state forever.
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  return { data, loading, error, reload: load };
}
