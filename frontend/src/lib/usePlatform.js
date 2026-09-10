/**
 * Hooks for roles, notifications, negotiations and site visits.
 *
 * Same contract as `useKhoj.js`: every one degrades rather than breaks, nothing
 * reaches a state setter without its shape being checked, and `loading` is
 * always cleared in a `finally`. An unreachable server produces an error the
 * panel can show, never an exception thrown during render.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import * as api from './api';
import { isServerUnwell, nextInterval } from './backoff';
import { API_CONFIGURED, useAuthUser } from './useKhoj';

/** How often the bell re-checks. Deliberately slow: a notification is not a chat token. */
const NOTIFICATION_POLL_MS = 20_000;

/**
 * The account's role, held once for the whole app.
 *
 * This is a context and not a plain hook because the role is shared state with
 * more than one writer, and treating it as per-component state inverted the
 * whole product. Three components call `useRole`, and each `useState` was
 * independent: the dashboard read "broker" at mount, onboarding then wrote
 * "renter" into its own copy and the database, and the dashboard re-rendered
 * from the stale value it still held. Choosing "I'm looking for a place" landed
 * the customer in the broker dashboard, with the tenant search unreachable.
 *
 * One state, one writer path, every reader in step.
 */
const RoleContext = createContext(null);

/** Anything the server does not call "broker" is a renter. */
const normalise = (raw) => (raw === 'broker' ? 'broker' : 'renter');

export function RoleProvider({ children }) {
  const { ready } = useAuthUser();
  // Renter until the server says otherwise, including while the request is in
  // flight. Guessing "broker" and correcting a moment later would flash a
  // dashboard of somebody else's calls.
  const [role, setRole] = useState('renter');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!API_CONFIGURED) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setRole(normalise((await api.getRole())?.user_type));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const choose = useCallback(async (next) => {
    // Applied locally before the round trip as well as after. The caller
    // navigates on the next line, and waiting for the server would render the
    // destination against the old role first.
    setRole(normalise(next));
    const body = await api.setRole(next);
    setRole(normalise(body?.user_type));
    return body;
  }, []);

  const value = useMemo(
    () => ({ role, isBroker: role === 'broker', loading, error, choose, reload: load }),
    [role, loading, error, choose, load],
  );

  // createElement rather than JSX: this is a .js file, and Vite's esbuild
  // loader does not transform JSX outside .jsx. One element does not justify
  // renaming the module and rewriting every import of it.
  return createElement(RoleContext.Provider, { value }, children);
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error(
      'useRole must be used inside <RoleProvider>. Without it each caller keeps ' +
        'its own copy of the role, which is how choosing "renter" during ' +
        'onboarding left the dashboard rendering the broker view.',
    );
  }
  return ctx;
}

/**
 * The notification bell.
 *
 * Polls rather than streaming. The server does expose SSE, but EventSource
 * cannot carry an Authorization header, so a streamed bell would work only
 * while auth is off — and a feature that silently stops working the day auth is
 * turned on is worse than one that polls every twenty seconds.
 */
export function useNotifications() {
  const { ready } = useAuthUser();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const failures = useRef(0);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!API_CONFIGURED) return;
    try {
      const body = await api.getNotifications();
      setItems(Array.isArray(body?.notifications) ? body.notifications : []);
      setUnread(Number.isFinite(body?.unread) ? body.unread : 0);
      setError(null);
      failures.current = 0;
    } catch (err) {
      // Quiet on purpose. A bell that cannot reach the server should go still,
      // not throw a banner over whatever the customer was doing.
      if (isServerUnwell(err)) failures.current += 1;
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  // Rescheduled rather than fixed, so the bell stops adding to the load on a
  // server that is failing. Of all the pollers in the app this is the one with
  // least claim on a struggling backend: nobody is waiting on a notification
  // count the way they wait on a search or a call.
  useEffect(() => {
    if (!ready) return undefined;

    const delay = nextInterval(failures.current, NOTIFICATION_POLL_MS);
    if (delay === null) return undefined; // circuit open: the bell goes still

    timer.current = setTimeout(async () => {
      await load();
      setTick((n) => n + 1);
    }, delay);
    return () => clearTimeout(timer.current);
  }, [ready, load, tick]);

  const markRead = useCallback(
    async (id) => {
      // Optimistic: the count drops immediately, and a failed request is
      // corrected by the next poll rather than by an error message.
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnread((n) => Math.max(0, n - 1));
      try {
        await api.markNotificationRead(id);
      } catch {
        void load();
      }
    },
    [load],
  );

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      await api.markAllNotificationsRead();
    } catch {
      void load();
    }
  }, [load]);

  return { items, unread, error, markRead, markAllRead, reload: load };
}

/** Every negotiation this account is part of. */
export function useNegotiations() {
  const { ready } = useAuthUser();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!API_CONFIGURED) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const body = await api.getNegotiations();
      setItems(Array.isArray(body?.negotiations) ? body.negotiations : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  return { items, loading, error, reload: load };
}

/** Video verifications this account has requested. */
export function useVisits() {
  const { ready } = useAuthUser();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!API_CONFIGURED) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const body = await api.getMyVisits();
      setItems(Array.isArray(body?.visits) ? body.visits : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  return { items, loading, error, reload: load };
}

/** The broker-side dashboard. */
export function useBrokerDashboard() {
  const { ready } = useAuthUser();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!API_CONFIGURED) {
      setLoading(false);
      setError(new Error('The API URL is not configured for this build.'));
      return;
    }
    setLoading(true);
    try {
      const body = await api.getBrokerDashboard();
      if (!body || typeof body !== 'object') {
        throw new Error('The server returned a dashboard in an unexpected format.');
      }
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
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
