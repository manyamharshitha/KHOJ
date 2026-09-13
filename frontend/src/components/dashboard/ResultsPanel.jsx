import { useEffect, useState } from 'react';

import { callAll, streamAboutListing } from '../../lib/api';
import styled from 'styled-components';
import { PanelHead, Kicker, Title, Sub, Card, Badge, TextInput } from './dashboardUI';
import { STATUS_META } from '../../data/callRuns';
import { useResults } from '../../lib/useKhoj';
import { useSearchSession } from '../../lib/SearchContext';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';

const Chips = styled.div`
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1.6rem;
`;

const Chip = styled.button`
  font-size: 0.78rem;
  font-weight: 500;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  border: 1px solid ${({ theme, $active }) => ($active ? theme.ink : theme.rule2)};
  background: ${({ theme, $active }) => ($active ? theme.ink : theme.surface)};
  color: ${({ theme, $active }) => ($active ? theme.bg : theme.ink2)};
  cursor: pointer;
  transition: 0.2s ease;
`;

const RunCard = styled.div`
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.rule};
  border-radius: 10px;
  overflow: hidden;

  & + & {
    margin-top: 0.9rem;
  }
`;

const RunHead = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.1rem 1.3rem;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
`;

const Thumb = styled.img`
  width: 4.5rem;
  height: 3.4rem;
  object-fit: cover;
  border-radius: 0.5rem;
  flex: none;
  background: ${({ theme }) => theme.surface2};
  border: 1px solid ${({ theme }) => theme.rule2};

  @media (max-width: 560px) {
    display: none;
  }
`;

const SourceLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.78rem;
  color: ${({ theme }) => theme.muted};
  text-decoration: none;
  border-bottom: 1px solid ${({ theme }) => theme.rule2};
  padding-bottom: 1px;

  &:hover {
    color: ${({ theme }) => theme.ink};
    border-bottom-color: currentColor;
  }
`;

const RunInfo = styled.div`
  min-width: 0;

  strong {
    display: block;
    font-size: 0.92rem;
    font-weight: 500;
    color: ${({ theme }) => theme.ink};
  }

  span {
    font-size: 0.78rem;
    color: ${({ theme }) => theme.muted};
  }
`;

const RunMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: none;

  .score {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.72rem;
    color: ${({ theme }) => theme.muted};
    display: none;

    @media (min-width: 560px) {
      display: inline;
    }
  }
`;

const Chevron = styled.svg`
  width: 14px;
  height: 14px;
  color: ${({ theme }) => theme.muted};
  transform: rotate(${({ $open }) => ($open ? '180deg' : '0deg')});
  transition: transform 0.25s ease;
  flex: none;
`;

const RunBody = styled.div`
  display: grid;
  grid-template-rows: ${({ $open }) => ($open ? '1fr' : '0fr')};
  transition: grid-template-rows 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);

  > div {
    overflow: hidden;
  }
`;

const BodyInner = styled.div`
  padding: 0 1.3rem 1.3rem;
  border-top: 1px solid ${({ theme }) => theme.rule};
`;

const MetaLine = styled.div`
  display: flex;
  gap: 1.2rem;
  flex-wrap: wrap;
  padding: 1rem 0 0.3rem;
  font-size: 0.78rem;
  color: ${({ theme }) => theme.muted};

  strong {
    color: ${({ theme }) => theme.ink2};
    font-weight: 500;
  }
`;

const SectionLabel = styled.p`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  margin: 1.4rem 0 0.6rem;
`;

const QA = styled.div`
  margin-top: 0.6rem;

  div {
    padding: 0.6rem 0;
  }
  div + div {
    border-top: 1px solid ${({ theme }) => theme.rule};
  }
  p {
    margin: 0;
  }
  .q {
    font-size: 0.8rem;
    color: ${({ theme }) => theme.muted};
    margin-bottom: 0.2rem;
  }
  .a {
    font-size: 0.88rem;
    color: ${({ theme }) => theme.ink};
  }
`;

const UnmatchedList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
`;

const Empty = styled.p`
  font-size: 0.85rem;
  color: ${({ theme }) => theme.muted};
  padding: 1rem 0;
`;

const ContactRow = styled.div`
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: 1rem;
`;

const AskRow = styled.form`
  display: flex;
  gap: 0.6rem;

  @media (max-width: 520px) {
    flex-direction: column;
  }
`;

const Thread = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.7rem;
`;

const Bubble = styled.div`
  align-self: ${({ $me }) => ($me ? 'flex-end' : 'flex-start')};
  max-width: 80%;
  background: ${({ theme, $me }) => ($me ? theme.ink : theme.surface2)};
  /* A reply the call could not support is deliberately quieter than one it
     could. The difference between "the broker said 30,000" and "the call
     didn't cover that" should be visible before either is read. */
  color: ${({ theme, $me, $muted }) => ($me ? theme.bg : $muted ? theme.muted : theme.ink)};
  font-size: 0.84rem;
  line-height: 1.5;
  padding: 0.55rem 0.85rem;
  border-radius: 12px;
`;

/** The broker's own words. Verified against the transcript server-side. */
const Quote = styled.span`
  display: block;
  margin-top: 0.35rem;
  padding-left: 0.6rem;
  border-left: 2px solid ${({ theme }) => theme.line};
  color: ${({ theme }) => theme.muted};
  font-style: italic;
  font-size: 0.8rem;
`;



const SourceNote = styled.p`
  font-size: 0.8rem;
  color: ${({ theme }) => theme.muted};
  margin: 0 0 1.2rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;

  span {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${({ theme, $live }) => ($live ? theme.good ?? '#1F6141' : theme.rule2)};
  }
`;

/**
 * A readable timestamp, or nothing.
 *
 * `new Date(null)` is the Unix epoch rather than a blank, so an un-dialled
 * listing used to be stamped "1 Jan, 5:30 am" — a specific, wrong, and
 * entirely plausible-looking time for a call that never happened.
 */
const formatDate = (value) => {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const filters = ['All', 'Completed', 'Scheduled', 'No answer', 'Failed', 'Dead'];
const statusFor = {
  All: null,
  Completed: 'completed',
  Scheduled: 'scheduled',
  'No answer': 'no-answer',
  Failed: 'failed',
  Dead: 'dead',
};

/**
 * What the backend is doing, in the customer's terms.
 *
 * Keyed on `SessionStatus` from the API. Naming the stage matters more than it
 * looks: a crawl and an extraction take different amounts of time for different
 * reasons, and "scraping" that sits still for thirty seconds reads as broken,
 * where "reading the pages" followed by "pulling out the details" reads as
 * progress.
 */
/**
 * How long the panel will claim a search is running before it stops believing
 * its own status.
 *
 * Ninety seconds, not sixty. A cold Render instance takes thirty just to wake,
 * and a five-portal crawl is genuinely slower than a minute — cutting a working
 * search off to prove responsiveness would trade one wrong answer for another.
 */
const SPINNER_CEILING_MS = 90_000;

/**
 * Card states where offering to place a call makes sense.
 *
 * Anything without a *successful* call behind it, which is the point: this was
 * previously `status === 'pending'` alone, so the moment a call failed the
 * button vanished and the listing became uncallable forever. With a provider
 * that returns "no route" intermittently, that meant one bad attempt
 * permanently stranded a listing — and since the call control lives only here,
 * there was no other way to reach it.
 *
 * `completed` and `dead` are excluded because a call already happened and the
 * answers are on the card. `calling` and `scheduled` are excluded because one
 * is happening right now, and offering a second would place two calls to the
 * same person.
 */
const CAN_CALL = new Set([
  'pending',
  'failed',
  'no-answer',
  'busy',
  'cancelled',
  'blocked',
]);

const SEARCH_PROGRESS = {
  starting: 'Starting the search…',
  queued: 'Queued…',
  running: 'Searching your selected sources…',
  scraping: 'Reading the pages from your selected sources…',
  extracting: 'Pulling the rent, locality and contact details out of each listing…',
  ranked: 'Ranking what was found…',
  calling: 'Calling…',
};

const CallRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
  margin: 0 0 1rem;

  span {
    font-size: 0.8rem;
    line-height: 1.5;
    color: ${({ theme }) => theme.muted};
    font-family: 'IBM Plex Mono', monospace;
  }
`;

const CallError = styled.p`
  font-size: 0.8rem;
  line-height: 1.55;
  color: ${({ theme }) => theme.bad};
  background: ${({ theme }) => theme.badSoft};
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
  margin: 0 0 1rem;
  word-break: break-word;
`;

const ResultsEmpty = styled.div`
  text-align: center;
  padding: 2.8rem 1.4rem;

  p {
    color: ${({ theme }) => theme.muted};
    font-size: 0.9rem;
    line-height: 1.6;
    margin: 0.4rem 0 0;
  }
`;

const ResultsPanel = ({ sessionId = null }) => {
  const [filter, setFilter] = useState('All');
  const [openId, setOpenId] = useState(null);
  const [threads, setThreads] = useState({});
  const [drafts, setDrafts] = useState({});
  const [pending, setPending] = useState({});

  // The listing the customer is being asked to confirm a call for, and the
  // outcome of the last attempt. Held here rather than in Sources because a
  // call is a decision about one property, not about a search.
  const [verifying, setVerifying] = useState(null);
  const [calling, setCalling] = useState({ id: null, error: null });

  // The search that is running right now, if one is. Read from the shared
  // context rather than a prop, because Sources navigates here the moment the
  // session is created and the crawl continues for some time afterwards — this
  // panel is where that wait is actually shown.
  const { status: searchStatus, isBusy: reportedBusy, error: searchError } = useSearchSession();

  /**
   * A ceiling on the spinner, independent of what the backend says.
   *
   * Everything else here trusts the session status to stop being a running one.
   * That trust is misplaced in exactly the case that matters: if the worker is
   * killed rather than raising, nothing ever writes a terminal status, and the
   * customer watches a progress bar with no end. The backend now reaps those
   * on its next boot, but "next boot" is not a timescale a person waiting on a
   * screen cares about.
   *
   * So the panel gives up on its own and shows whatever exists. Listings arrive
   * incrementally, so there is usually something; when there is not, saying the
   * search is still going is worse than admitting it stalled.
   */
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (!reportedBusy) {
      setGaveUp(false);
      return undefined;
    }
    const timer = setTimeout(() => setGaveUp(true), SPINNER_CEILING_MS);
    return () => clearTimeout(timer);
  }, [reportedBusy, sessionId]);

  const searching = reportedBusy && !gaveUp;

  // Live results when a session is open and the backend is reachable, and an
  // empty list otherwise — there is no sample set to fall back to any more.
  // `active` keeps it polling while the crawl is still producing listings.
  // Keyed on what the backend reports, not on whether the spinner is still up.
  // Giving up on the spinner is a statement about how long a person should be
  // asked to watch one; it is not a decision to stop collecting results, and
  // listings that arrive late should still appear.
  const { runs: rawRuns, isLive, loading, error, reload } = useResults(sessionId, {
    active: reportedBusy,
  });

  /** Place the call, now that the customer has said yes to this property. */
  const confirmCall = async () => {
    const target = verifying;
    if (!target) return;
    setCalling({ id: target.id, error: null });
    try {
      // `target.id` is the listing id — see toRunCard in adapters.js, which
      // keys a card on the listing. Sending it is what makes the property named
      // in the dialog the one that actually rings.
      await callAll(sessionId, 1, target.id);
      setVerifying(null);
      setCalling({ id: null, error: null });
      // The row goes to DIALING server-side; pull it now rather than waiting
      // for the next poll so the badge changes as the dialog closes.
      void reload();
    } catch (err) {
      // 403 is a rate limit, 402 an exhausted plan. Both carry a message
      // written for the customer, so it is shown rather than replaced.
      setVerifying(null);
      setCalling({
        id: target.id,
        error: err?.message || 'That call could not be placed.',
      });
    }
  };

  // Never trust the shape at the render boundary. One undefined reaching a
  // `.map` here throws during render, and a throw during render is a white
  // page: the panel gets no chance to recover from its own failure.
  const runs = Array.isArray(rawRuns) ? rawRuns.filter(Boolean) : [];

  // Open the first card whenever the underlying set changes, not just on mount —
  // otherwise the panel stays collapsed after results arrive.
  useEffect(() => {
    setOpenId((current) => (runs.some((r) => r.id === current) ? current : runs[0]?.id ?? null));
  }, [runs]);

  const visible = runs
    .filter((r) => !statusFor[filter] || r.status === statusFor[filter])
    .slice()
    // `undefined - undefined` is NaN, and a NaN comparator scrambles the order
    // silently instead of throwing.
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));

  const append = (runId, message) =>
    setThreads((prev) => ({ ...prev, [runId]: [...(prev[runId] || []), message] }));

  /**
   * Ask about one listing. The answer comes from that listing's call
   * transcript, read server-side by the model — nothing here is generated in
   * the browser, and an answer the call did not support is not returned at all.
   */
  const ask = async (runId, e) => {
    e.preventDefault();
    const text = (drafts[runId] || '').trim();
    if (!text || pending[runId]) return;

    append(runId, { me: true, text });
    setDrafts((prev) => ({ ...prev, [runId]: '' }));

    setPending((prev) => ({ ...prev, [runId]: true }));
    try {
      // A sample card's id is not in the database, so its own content travels
      // with the question and the server answers from that. Live cards send
      // ids only and are answered from the real call transcript.
      const card = runs.find((r) => r.id === runId);
      const inline =
        !sessionId || !isLive
          ? {
              listing: {
                title: card?.address ?? null,
                locality: card?.address?.split('·').pop()?.trim() ?? null,
              },
              qna: (card?.answers ?? []).map((a) => ({ question: a.q, answer: a.a ?? null })),
            }
          : {};

      // Show an empty reply immediately and fill it in as the text arrives.
      const index = (threads[runId] || []).length + 1;
      append(runId, { me: false, text: '', muted: false });

      const patch = (fields) =>
        setThreads((prev) => {
          const thread = [...(prev[runId] || [])];
          if (!thread[index]) return prev;
          thread[index] = { ...thread[index], ...fields };
          return { ...prev, [runId]: thread };
        });

      let streamed = '';
      const res = await streamAboutListing(
        { sessionId, listingId: runId, question: text, ...inline },
        (delta) => {
          streamed += delta;
          patch({ text: streamed });
        },
      );

      // The quote check lands after the text. An answer that cited words the
      // broker never said is replaced rather than left on screen.
      if (res?.verified === false) {
        patch({ text: "The call didn't cover that.", muted: true });
      } else {
        patch({ text: res?.text || streamed, muted: res?.covered === false });
      }
    } catch (err) {
      append(runId, {
        me: false,
        text: err?.message || 'I could not check the call just now. Please try again.',
        muted: true,
      });
    } finally {
      setPending((prev) => ({ ...prev, [runId]: false }));
    }
  };

  return (
    <div>
      <PanelHead>
        <Kicker>Results</Kicker>
        <Title>Call results</Title>
        <Sub>
          Every listing Khoj has checked and called on your behalf, sorted by how closely it matched — full
          matches first.
        </Sub>
      </PanelHead>

      <SourceNote $live={isLive}>
        <span />
        {searching
          ? SEARCH_PROGRESS[searchStatus] ?? SEARCH_PROGRESS.running
          : loading
            ? 'Loading your results…'
            : error
              ? 'Could not reach the server.'
              : isLive
                ? 'Live results from your search.'
                : 'No results yet. Run a search to see your own.'}
      </SourceNote>

      <Chips>
        {filters.map((f) => (
          <Chip key={f} $active={filter === f} onClick={() => setFilter(f)}>
            {f}
          </Chip>
        ))}
      </Chips>

      {!loading && error && (
        <Card>
          <ResultsEmpty>
            <SectionLabel>Couldn't load results</SectionLabel>
            <p>{error?.message || 'The server did not respond.'}</p>
          </ResultsEmpty>
        </Card>
      )}

      {/* A crawl produces nothing for tens of seconds, and an empty results
          array during that window is not the same fact as "nothing was found".
          Reporting the second while the first is true is what made a working
          search look like a broken one. */}
      {searching && visible.length === 0 && (
        <Card>
          <ResultsEmpty>
            <SectionLabel>Searching</SectionLabel>
            <p>
              {SEARCH_PROGRESS[searchStatus] ?? SEARCH_PROGRESS.running} Listings appear here as
              they are found — you do not need to wait on this screen.
            </p>
          </ResultsEmpty>
        </Card>
      )}

      {searchError && !searching && (
        <Card>
          <ResultsEmpty>
            <SectionLabel>That search did not finish</SectionLabel>
            <p>{searchError?.message || 'The search stopped before it returned anything.'}</p>
          </ResultsEmpty>
        </Card>
      )}

      {/* The backend still calls this search live; the panel has stopped
          believing it. Say so plainly rather than either spinning forever or
          pretending the search finished normally. */}
      {gaveUp && reportedBusy && (
        <Card>
          <ResultsEmpty>
            <SectionLabel>This is taking longer than expected</SectionLabel>
            <p>
              {visible.length > 0
                ? 'Showing what has been found so far. Anything still arriving will appear here.'
                : 'The search has not returned anything yet. The portals may be slow or ' +
                  'unreachable — try fewer sources, or add a listing by hand.'}
            </p>
          </ResultsEmpty>
        </Card>
      )}

      {/* Three different facts used to share one message, and that is why a
          working search was indistinguishable from a broken one.

          "You have not searched", "the search ran and found nothing" and "your
          filter is hiding everything" all rendered as "Nothing here yet. Start
          a search" — so a search that completed correctly with no matches
          looked exactly like a search that never happened. There was no way to
          tell whether the thing worked. */}
      {!searching && !gaveUp && !searchError && !loading && !error && visible.length === 0 && (
        <Card>
          <ResultsEmpty>
            {runs.length > 0 ? (
              <>
                <SectionLabel>Nothing matches this filter</SectionLabel>
                <p>
                  {runs.length} {runs.length === 1 ? 'property is' : 'properties are'} in these
                  results, but none {runs.length === 1 ? 'is' : 'are'}{' '}
                  <strong>{filter}</strong>.
                </p>
                <Button size="sm" arrow={false} onClick={() => setFilter('All')}>
                  Show all {runs.length}
                </Button>
              </>
            ) : sessionId ? (
              <>
                <SectionLabel>That search finished — nothing matched</SectionLabel>
                <p>
                  Khoj read the listing sites and found no property that fits what you asked
                  for. The search itself worked; there was simply nothing to return.
                </p>
                <p>
                  Try a wider budget or a nearby locality, add more sources, or add a listing by
                  hand if you already have a number.
                </p>
              </>
            ) : (
              <>
                <SectionLabel>Nothing here yet</SectionLabel>
                <p>No recent activity. Start a search or add a listing to get started.</p>
              </>
            )}
          </ResultsEmpty>
        </Card>
      )}

      {visible.map((run) => {
        // A status the backend adds later — or one this build has not heard
        // of — is a missing key, and `meta.tone` on undefined throws. Pending is
        // the honest reading of "known about, nothing has happened yet";
        // `scheduled` would promise a call is queued that may not be.
        const meta = STATUS_META[run.status] ?? STATUS_META.pending;
        const open = openId === run.id;
        const when = formatDate(run.date);
        const answers = Array.isArray(run.answers) ? run.answers : [];
        const unmatched = Array.isArray(run.unmatched) ? run.unmatched : [];
        const thread = Array.isArray(threads[run.id]) ? threads[run.id] : [];
        return (
          <RunCard key={run.id}>
            <RunHead onClick={() => setOpenId(open ? null : run.id)} aria-expanded={open}>
              {run.photo && (
                <Thumb
                  src={run.photo}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  // The portal's image on the portal's CDN. No referrer, so the
                  // customer's session is not announced to a third party every
                  // time a result renders.
                  referrerPolicy="no-referrer"
                  // A dead CDN link, a hotlink the portal blocks, or a URL that
                  // is no longer an image: hide the element rather than leave a
                  // broken-image glyph in the middle of the card.
                  onError={(e) => {
                    e.currentTarget.hidden = true;
                  }}
                />
              )}
              <RunInfo>
                <strong>{run.address}</strong>
                <span>
                  {run.source}
                  {run.areaSqft ? ` · ${run.areaSqft.toLocaleString('en-IN')} sq ft` : ''}
                </span>
              </RunInfo>
              <RunMeta>
                <span className="score">
                  {run.matchScore ?? 0}/{run.totalQuestions ?? 0} matched
                </span>
                <Badge $tone={meta.tone}>{meta.label}</Badge>
                <Chevron $open={open} viewBox="0 0 24 24" fill="none">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </Chevron>
              </RunMeta>
            </RunHead>

            <RunBody $open={open}>
              <div>
                <BodyInner>
                  <MetaLine>
                    <span>
                      Language: <strong>{run.language}</strong>
                    </span>
                    {when && <span>{when}</span>}
                    {run.link && (
                      // noreferrer as well as noopener: the first stops the
                      // opened page reaching back through window.opener, the
                      // second stops Khoj being named as the referrer on a
                      // portal the customer did not choose to tell.
                      <SourceLink
                        href={run.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View on {run.source} ↗
                      </SourceLink>
                    )}
                    {run.authenticity != null && (
                      <span>
                        <Badge $tone={run.authenticity >= 70 ? 'good' : run.authenticity >= 45 ? 'accent' : 'bad'}>
                          {run.authenticity}% likely genuine
                        </Badge>
                      </span>
                    )}
                  </MetaLine>

                  {/* Why nothing happened, in the pipeline's own words. A
                      failure badge with no reason is a dead end — this is what
                      separates "no API key" from "wrong number". */}
                  {run.error && <CallError>{run.error}</CallError>}

                  {/* The verification call is offered here and nowhere else.
                      It is a decision about one property, and this is the only
                      place the price, the source and the number are all in
                      front of the customer at the moment they make it.

                      A listing from a portal that hides its numbers simply has
                      no button: there is nothing to ring, and an enabled
                      control that can only fail is worse than none. */}
                  {CAN_CALL.has(run.status) && (
                    <CallRow>
                      {run.broker?.phone ? (
                        <>
                          <Button
                            size="sm"
                            arrow={false}
                            disabled={calling.id === run.id}
                            onClick={() => setVerifying(run)}
                          >
                            {calling.id === run.id
                              ? 'Starting…'
                              : run.status === 'pending'
                                ? 'Verify by phone'
                                : 'Try the call again'}
                          </Button>
                          <span>{run.broker.phone}</span>
                        </>
                      ) : (
                        <span>
                          No published number — this portal keeps them behind a login, so Khoj
                          cannot call this one for you.
                        </span>
                      )}
                    </CallRow>
                  )}
                  {calling.error && calling.id === run.id && (
                    <CallError>{calling.error}</CallError>
                  )}

                  {answers.length > 0 ? (
                    <QA>
                      {answers.map((qa, i) => (
                        <div key={qa?.q ?? i}>
                          <p className="q">{qa?.q}</p>
                          <p className="a">{qa?.a}</p>
                        </div>
                      ))}
                    </QA>
                  ) : (
                    <Empty>
                      {run.status === 'scheduled' ? 'Call scheduled — answers will appear here after it runs.' : 'No answers recorded for this call.'}
                    </Empty>
                  )}

                  {unmatched.length > 0 && (
                    <>
                      <SectionLabel>Not specified ({unmatched.length})</SectionLabel>
                      <UnmatchedList>
                        {unmatched.map((q, i) => (
                          <Badge key={q ?? i} $tone="muted">
                            {q}
                          </Badge>
                        ))}
                      </UnmatchedList>
                    </>
                  )}

                  {run.broker && (
                    <ContactRow>
                      {run.broker.phone && <Badge $tone="muted">{run.broker.phone}</Badge>}
                      {run.broker.email && <Badge $tone="muted">{run.broker.email}</Badge>}
                    </ContactRow>
                  )}

                  <SectionLabel>Ask Khoj about this listing</SectionLabel>
                  {(thread.length > 0 || pending[run.id]) && (
                    <Thread>
                      {thread.map((m, i) => (
                        <Bubble key={i} $me={m?.me} $muted={m?.muted}>
                          {m?.text}
                          {m?.quote && <Quote>“{m.quote}”</Quote>}
                        </Bubble>
                      ))}
                      {pending[run.id] && (
                        <Bubble $me={false} $muted>
                          Reading the call…
                        </Bubble>
                      )}
                    </Thread>
                  )}
                  <AskRow onSubmit={(e) => ask(run.id, e)}>
                    <TextInput
                      placeholder="e.g. What is the actual rent?"
                      value={drafts[run.id] || ''}
                      disabled={pending[run.id]}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [run.id]: e.target.value }))}
                    />
                    <Button type="submit" size="sm" variant="ghost" arrow={false} disabled={pending[run.id]}>
                      {pending[run.id] ? 'Asking…' : 'Ask'}
                    </Button>
                  </AskRow>
                </BodyInner>
              </div>
            </RunBody>
          </RunCard>
        );
      })}

      {/* Named, priced and sourced. Asking "call this one?" is answerable here
          in a way it never was on the Sources panel, where the question arrived
          before any result existed. */}
      <ConfirmDialog
        open={Boolean(verifying)}
        title="Place a verification call?"
        confirmLabel="Yes, call now"
        cancelLabel="Not now"
        busy={Boolean(calling.id) && !calling.error}
        onConfirm={confirmCall}
        onCancel={() => setVerifying(null)}
      >
        <p style={{ margin: '0 0 0.7rem' }}>
          Khoj will phone <strong>{verifying?.broker?.phone}</strong> about{' '}
          <strong>{verifying?.address}</strong>, say it is an AI assistant calling for you, and
          ask permission to record.
        </p>
        <p style={{ margin: 0 }}>
          This is a <strong>real phone call to a real person</strong> and it uses one of your
          daily verifications. It cannot be undone once it starts.
        </p>
      </ConfirmDialog>
    </div>
  );
};

export default ResultsPanel;
