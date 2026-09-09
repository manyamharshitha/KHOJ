export const STATUS_META = {
  completed: { label: 'Completed', tone: 'good' },
  // No call has been placed against this listing at all. Distinct from
  // `scheduled`, which promises a call is queued and about to happen.
  pending: { label: 'Not called yet', tone: 'muted' },
  scheduled: { label: 'Scheduled', tone: 'accent' },
  calling: { label: 'Calling now', tone: 'accent' },
  'no-answer': { label: 'No answer', tone: 'muted' },
  dead: { label: 'Listing dead', tone: 'bad' },
};
