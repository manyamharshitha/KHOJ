import { appendEvent, eventsSince } from '../db.js';

type Subscriber = (id: number, kind: string, payload: unknown) => void;

const subscribers = new Map<string, Set<Subscriber>>();

export function emit(
  runId: string, callId: string | null, kind: string, payload: unknown = null,
): void {
  void appendEvent(runId, callId, kind, payload)
    .then((id) => {
      for (const fn of subscribers.get(runId) ?? []) {
        try {
          fn(id, kind, payload);
        } catch (err) {
          console.error('[events] subscriber threw', err);
        }
      }
    })
    .catch((err: unknown) => console.error('[events] appendEvent failed', err));
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

export const backlog = async (runId: string, lastEventId: number) =>
  (await eventsSince(runId, lastEventId)).map((e) => ({
    id: e.id,
    kind: e.kind,
    payload: e.payload ? (JSON.parse(e.payload) as unknown) : null,
  }));
