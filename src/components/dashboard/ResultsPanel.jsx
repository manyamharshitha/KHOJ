import { useState } from 'react';
import styled from 'styled-components';
import { PanelHead, Kicker, Title, Sub, Badge, TextInput } from './dashboardUI';
import { callRuns, STATUS_META } from '../../data/callRuns';
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
  color: ${({ theme, $me }) => ($me ? theme.bg : theme.ink)};
  font-size: 0.84rem;
  line-height: 1.5;
  padding: 0.55rem 0.85rem;
  border-radius: 12px;
`;

const canned = (q) => {
  const text = q.toLowerCase();
  if (text.includes('flood') || text.includes('water')) {
    return "The broker didn't mention drainage — I've flagged it for the next call if you want it confirmed.";
  }
  if (text.includes('fake') || text.includes('genuine') || text.includes('real')) {
    return 'Based on the call and listing details so far, nothing here raised a red flag — but always worth a site visit before you commit.';
  }
  return "Good question — that wasn't covered on the call. I can include it if this listing gets a follow-up.";
};

const filters = ['All', 'Completed', 'Scheduled', 'No answer', 'Dead'];
const statusFor = { All: null, Completed: 'completed', Scheduled: 'scheduled', 'No answer': 'no-answer', Dead: 'dead' };

const ResultsPanel = () => {
  const [filter, setFilter] = useState('All');
  const [openId, setOpenId] = useState(callRuns[0]?.id ?? null);
  const [threads, setThreads] = useState({});
  const [drafts, setDrafts] = useState({});

  const visible = callRuns
    .filter((r) => !statusFor[filter] || r.status === statusFor[filter])
    .slice()
    .sort((a, b) => b.matchScore - a.matchScore);

  const ask = (runId, e) => {
    e.preventDefault();
    const text = (drafts[runId] || '').trim();
    if (!text) return;
    setThreads((prev) => ({ ...prev, [runId]: [...(prev[runId] || []), { me: true, text }] }));
    setDrafts((prev) => ({ ...prev, [runId]: '' }));
    window.setTimeout(() => {
      setThreads((prev) => ({ ...prev, [runId]: [...(prev[runId] || []), { me: false, text: canned(text) }] }));
    }, 700);
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
                  {(threads[run.id] || []).length > 0 && (
                    <Thread>
                      {threads[run.id].map((m, i) => (
                        <Bubble key={i} $me={m.me}>
                          {m.text}
                        </Bubble>
                      ))}
                    </Thread>
                  )}
                  <AskRow onSubmit={(e) => ask(run.id, e)}>
                    <TextInput
                      placeholder="e.g. Does this area flood in monsoon?"
                      value={drafts[run.id] || ''}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [run.id]: e.target.value }))}
                    />
                    <Button type="submit" size="sm" variant="ghost" arrow={false}>
                      Ask
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
