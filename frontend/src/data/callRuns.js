export const STATUS_META = {
  completed: { label: 'Completed', tone: 'good' },
  // No call has been placed against this listing at all. Distinct from
  // `scheduled`, which promises a call is queued and about to happen.
  pending: { label: 'Not called yet', tone: 'muted' },
  scheduled: { label: 'Scheduled', tone: 'accent' },
  calling: { label: 'Calling now', tone: 'accent' },
  // Only for a telephone that rang and was not picked up. Anything that stopped
  // the call from being placed at all belongs below, where it can be told apart.
  'no-answer': { label: 'No answer', tone: 'muted' },
  busy: { label: 'Line busy', tone: 'muted' },
  failed: { label: 'Call failed', tone: 'bad' },
  blocked: { label: 'Not called — recently dialled', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  dead: { label: 'Listing dead', tone: 'bad' },
};
