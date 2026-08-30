import { appendEvent, eventsSince } from '../db.js';

type Subscriber = (id: number, kind: string, payload: unknown) => void;

const subscribers = new Map<string, Set<Subscriber>>();

/** Persist to the audit log, then fan out to any live SSE connections. */
export function emit(
  runId: string, callId: string | null, kind: string, payload: unknown = null,
): void {
  const id = appendEvent(runId, callId, kind, payload);
  for (const fn of subscribers.get(runId) ?? []) {
    try {
      fn(id, kind, payload);
    } catch (err) {
      console.error('[events] subscriber threw', err);
    }
  }
}

export function subscribe(runId: string, fn: Subscriber): () => void {
  let set = subscribers.get(runId);
  if (!set) {
    set = new Set();
    subscribers.set(runId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) subscribers.delete(runId);
  };
}

/**
 * Everything the client missed since `lastEventId`. Replayed from the events
 * table on reconnect, so a dropped connection mid-demo recovers silently.
 */
export const backlog = (runId: string, lastEventId: number) =>
  eventsSince(runId, lastEventId).map((e) => ({
    id: e.id,
    kind: e.kind,
    payload: e.payload ? (JSON.parse(e.payload) as unknown) : null,
  }));
