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

  const start = useCallback(async ({ prompt, sites = [], pastedContent, autoCall = false }) => {
    setError(null);
    setStatus('starting');
    try {
      const created = await api.startSearch({ prompt, sites, pastedContent, autoCall });
      if (cancelled.current) return null;
      setSessionId(created.session_id);
      setStatus('running');

      const final = await api.waitForSession(created.session_id, {
        onUpdate: (payload) => {
          if (cancelled.current) return;
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
