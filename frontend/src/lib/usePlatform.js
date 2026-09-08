/**
 * Hooks for roles, notifications, negotiations and site visits.
 *
 * Same contract as `useKhoj.js`: every one degrades rather than breaks, nothing
 * reaches a state setter without its shape being checked, and `loading` is
 * always cleared in a `finally`. An unreachable server produces an error the
 * panel can show, never an exception thrown during render.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import * as api from './api';
import { API_CONFIGURED, useAuthUser } from './useKhoj';

/** How often the bell re-checks. Deliberately slow: a notification is not a chat token. */
const NOTIFICATION_POLL_MS = 20_000;

/**
 * Which side of the product the account is on.
 *
 * Renter until the server says otherwise, including while the request is in
 * flight. Guessing "broker" and correcting a moment later would flash a
 * dashboard of somebody else's calls.
 */
export function useRole() {
  const { ready } = useAuthUser();
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
      const body = await api.getRole();
      setRole(body?.user_type === 'broker' ? 'broker' : 'renter');
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
    const body = await api.setRole(next);
    setRole(body?.user_type === 'broker' ? 'broker' : 'renter');
    return body;
  }, []);

  return { role, isBroker: role === 'broker', loading, error, choose, reload: load };
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

  const load = useCallback(async () => {
    if (!API_CONFIGURED) return;
    try {
      const body = await api.getNotifications();
      setItems(Array.isArray(body?.notifications) ? body.notifications : []);
      setUnread(Number.isFinite(body?.unread) ? body.unread : 0);
      setError(null);
    } catch (err) {
      // Quiet on purpose. A bell that cannot reach the server should go still,
      // not throw a banner over whatever the customer was doing.
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    void load();
    timer.current = setInterval(() => void load(), NOTIFICATION_POLL_MS);
    return () => clearInterval(timer.current);
  }, [ready, load]);

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
