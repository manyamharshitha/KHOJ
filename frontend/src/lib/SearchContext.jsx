/**
 * One search, shared across the dashboard.
 *
 * The panels are siblings — Sources starts a search, Results shows what came
 * back — so the session has to live above both. Threading `sessionId` through
 * props would mean every panel in between carries a prop it does not use.
 *
 * The id is also mirrored to localStorage, because a search takes minutes and
 * people refresh. Losing the session on reload would leave a run happening on
 * the server that the UI has no way to find again.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useSearch } from './useKhoj';

const SESSION_KEY = 'khoj.session.id';

const SearchContext = createContext(null);

const readStored = () => {
  try {
    return window.localStorage.getItem(SESSION_KEY) || null;
  } catch {
    return null;
  }
};

const writeStored = (id) => {
  try {
    if (id) window.localStorage.setItem(SESSION_KEY, id);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode — the search still works, it just will not survive a reload */
  }
};

export function SearchProvider({ children }) {
  const search = useSearch();
  const [sessionId, setSessionId] = useState(readStored);

  // Adopt whatever the hook produces, and remember it.
  useEffect(() => {
    if (search.sessionId && search.sessionId !== sessionId) {
      setSessionId(search.sessionId);
      writeStored(search.sessionId);
    }
  }, [search.sessionId, sessionId]);

  const startSearch = useCallback(
    async (input) => {
      const id = await search.start(input);
      if (id) {
        setSessionId(id);
        writeStored(id);
      }
      return id;
    },
    [search],
  );

  /**
   * Take over a session created somewhere other than the search box — a
   * listing added by hand, for instance — so Results shows it immediately.
   */
  const adoptSession = useCallback((id) => {
    if (!id) return;
    setSessionId(id);
    writeStored(id);
  }, []);

  const clearSearch = useCallback(() => {
    setSessionId(null);
    writeStored(null);
  }, []);

  const value = useMemo(
    () => ({
      sessionId,
      startSearch,
      adoptSession,
      clearSearch,
      callAll: search.callAll,
      status: search.status,
      session: search.session,
      error: search.error,
      isConfigured: search.isConfigured,
      isBusy: ['starting', 'running', 'scraping', 'extracting', 'calling'].includes(search.status),
    }),
    [sessionId, startSearch, adoptSession, clearSearch, search],
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

/**
 * The current search.
 *
 * Returns a safe no-op shape outside the provider so a panel rendered on its
 * own — in a story, or a test — does not crash on a null context.
 */
export function useSearchSession() {
  return (
    useContext(SearchContext) ?? {
      sessionId: null,
      startSearch: async () => null,
      adoptSession: () => {},
      clearSearch: () => {},
      callAll: async () => null,
      status: 'idle',
      session: null,
      error: null,
      isConfigured: false,
      isBusy: false,
    }
  );
}
