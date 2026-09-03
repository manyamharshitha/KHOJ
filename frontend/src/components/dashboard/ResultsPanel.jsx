import { useEffect, useState } from 'react';

import { askAboutListing } from '../../lib/api';
import styled from 'styled-components';
import { PanelHead, Kicker, Title, Sub, Badge, TextInput } from './dashboardUI';
import { STATUS_META } from '../../data/callRuns';
import { useResults } from '../../lib/useKhoj';
import Button from '../ui/Button';

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

const filters = ['All', 'Completed', 'Scheduled', 'No answer', 'Dead'];
const statusFor = { All: null, Completed: 'completed', Scheduled: 'scheduled', 'No answer': 'no-answer', Dead: 'dead' };

const ResultsPanel = ({ sessionId = null }) => {
  const [filter, setFilter] = useState('All');
  const [openId, setOpenId] = useState(null);
  const [threads, setThreads] = useState({});
  const [drafts, setDrafts] = useState({});
  const [pending, setPending] = useState({});

  // Live results when a session is open and the backend is reachable; the
  // bundled sample set otherwise, labelled as such rather than passed off.
  const { runs, isLive, loading, error } = useResults(sessionId);

  // Open the first card whenever the underlying set changes, not just on mount —
  // otherwise the panel stays collapsed after results arrive.
  useEffect(() => {
    setOpenId((current) => (runs.some((r) => r.id === current) ? current : runs[0]?.id ?? null));
  }, [runs]);

  const visible = runs
    .filter((r) => !statusFor[filter] || r.status === statusFor[filter])
    .slice()
    .sort((a, b) => b.matchScore - a.matchScore);

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

    // Without a live session there is no transcript to read, so say that
    // rather than sending a request that can only fail.
    if (!sessionId || !isLive) {
      append(runId, {
        me: false,
        text: 'This is sample data, so there is no real call for me to read. Run a search to ask about a listing you actually called.',
        muted: true,
      });
      return;
    }

    setPending((prev) => ({ ...prev, [runId]: true }));
    try {
      const res = await askAboutListing({ sessionId, listingId: runId, question: text });
      append(runId, { me: false, text: res.answer, muted: !res.covered, quote: res.quote });
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
        {loading
          ? 'Loading your results…'
          : isLive
            ? 'Live results from your calls.'
            : error
              ? 'Showing sample results — could not reach the server.'
              : 'Showing sample results. Run a search to see your own.'}
      </SourceNote>

      <Chips>
        {filters.map((f) => (
          <Chip key={f} $active={filter === f} onClick={() => setFilter(f)}>
            {f}
          </Chip>
        ))}
      </Chips>

      {visible.map((run) => {
        const meta = STATUS_META[run.status];
        const open = openId === run.id;
        return (
          <RunCard key={run.id}>
            <RunHead onClick={() => setOpenId(open ? null : run.id)} aria-expanded={open}>
              <RunInfo>
                <strong>{run.address}</strong>
                <span>{run.source}</span>
              </RunInfo>
              <RunMeta>
                <span className="score">
                  {run.matchScore}/{run.totalQuestions} matched
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
                    <span>
                      {new Date(run.date).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                    {run.authenticity != null && (
                      <span>
                        <Badge $tone={run.authenticity >= 70 ? 'good' : run.authenticity >= 45 ? 'accent' : 'bad'}>
                          {run.authenticity}% likely genuine
                        </Badge>
                      </span>
                    )}
                  </MetaLine>

                  {run.answers.length > 0 ? (
                    <QA>
                      {run.answers.map((qa) => (
                        <div key={qa.q}>
                          <p className="q">{qa.q}</p>
                          <p className="a">{qa.a}</p>
                        </div>
                      ))}
                    </QA>
                  ) : (
                    <Empty>
                      {run.status === 'scheduled' ? 'Call scheduled — answers will appear here after it runs.' : 'No answers recorded for this call.'}
                    </Empty>
                  )}

                  {run.unmatched && run.unmatched.length > 0 && (
                    <>
                      <SectionLabel>Not specified ({run.unmatched.length})</SectionLabel>
                      <UnmatchedList>
                        {run.unmatched.map((q) => (
                          <Badge key={q} $tone="muted">
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
                  {((threads[run.id] || []).length > 0 || pending[run.id]) && (
                    <Thread>
                      {threads[run.id].map((m, i) => (
                        <Bubble key={i} $me={m.me} $muted={m.muted}>
                          {m.text}
                          {m.quote && <Quote>“{m.quote}”</Quote>}
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
    </div>
  );
};

export default ResultsPanel;
