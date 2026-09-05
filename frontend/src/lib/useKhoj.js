/**
 * React hooks over the backend.
 *
 * Every one of these degrades rather than breaks. If `VITE_API_URL` is unset, or
 * the Render instance is asleep, or the user is signed out, the dashboard falls
 * back to the bundled demo data and says so through `isLive`. A hackathon demo
 * that shows an error card because a free instance was cold is a worse outcome
 * than one that shows sample data with an honest label.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';

import { auth, isFirebaseConfigured } from '../firebase';
import * as api from './api';
import { toQuota, toRunCards } from './adapters';
import { callRuns as demoRuns } from '../data/callRuns';

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
export function useResults(sessionId) {
  const { user, ready } = useAuthUser();
  const [runs, setRuns] = useState(demoRuns);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!API_CONFIGURED || !sessionId || !user) {
      setRuns(demoRuns);
      setIsLive(false);
      return;
    }
    setLoading(true);
    try {
      const cards = toRunCards(await api.getResults(sessionId));
      // An empty live result is still live — showing demo data over the top of
      // it would tell the customer she has results she does not have.
      setRuns(cards);
      setIsLive(true);
      setError(null);
    } catch (err) {
      setError(err);
      setRuns(demoRuns);
      setIsLive(false);
    } finally {
      setLoading(false);
    }
  }, [sessionId, user]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

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
    async ({ prompt, city, localities = [], sites = [], pastedContent, autoCall = false }) => {
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
    if (!API_CONFIGURED) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setData(await api.getDashboard());
      setError(null);
    } catch (err) {
      setError(err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  return { data, loading, error, reload: load };
}
