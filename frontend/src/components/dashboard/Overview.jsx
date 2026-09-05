import styled from 'styled-components';
import { PanelHead, Kicker, Title, Sub, Card, StatGrid, StatCard, StatLabel, StatNum, Badge } from './dashboardUI';
import { STATUS_META } from '../../data/callRuns';
import { useDashboard, useProfile } from '../../lib/useKhoj';
import Button from '../ui/Button';

const ActionsRow = styled.div`
  display: flex;
  gap: 0.8rem;
  margin: 2rem 0 2.5rem;
  flex-wrap: wrap;
`;

const SectionTitle = styled.h2`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: 1.1rem;
  color: ${({ theme }) => theme.ink};
  margin: 0 0 1rem;
`;

const RunRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 0;

  & + & {
    border-top: 1px solid ${({ theme }) => theme.rule};
  }
`;

const RunInfo = styled.div`
  min-width: 0;

  strong {
    display: block;
    font-size: 0.88rem;
    font-weight: 500;
    color: ${({ theme }) => theme.ink};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  span {
    font-size: 0.76rem;
    color: ${({ theme }) => theme.muted};
  }
`;

const RunMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex: none;

  .score {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.72rem;
    color: ${({ theme }) => theme.muted};
  }
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 2.6rem 1.4rem;

  p {
    color: ${({ theme }) => theme.muted};
    font-size: 0.9rem;
    margin: 0 0 1.4rem;
    line-height: 1.6;
  }
`;

/** Backend call_status onto the badge keys STATUS_META already knows. */
const STATUS_KEY = {
  completed: 'completed',
  queued: 'scheduled',
  dialing: 'calling',
  in_progress: 'calling',
  no_answer: 'no-answer',
  busy: 'no-answer',
  failed: 'no-answer',
  cancelled: 'no-answer',
  blocked: 'no-answer',
};

const Overview = ({ onNavigate, profile }) => {
  // The signed-in name from the Google session, not profile.name — that falls
  // back to 'Guest' for the navbar, and "Welcome back, Guest" reads worse.
  const { displayName } = useProfile();
  const firstName = (displayName || profile?.name || '').trim().split(/\s+/)[0] || 'there';

  const { data, loading, error } = useDashboard();
  const stats = data?.stats;
  const activity = data?.activity ?? [];
  // `is_empty` from the server, not `activity.length` — a search that returned
  // nothing is still a search, and should not be told to get started.
  const isEmpty = data ? data.is_empty : false;

  return (
    <div>
      <PanelHead>
        <Kicker>Overview</Kicker>
        <Title>Welcome back, {firstName}</Title>
        <Sub>Here's what Khoj has been doing on your behalf.</Sub>
      </PanelHead>

      {loading && (
        <Card>
          <EmptyState>
            <p>Loading your dashboard…</p>
          </EmptyState>
        </Card>
      )}

      {/* An unreachable backend used to fall through to the stats block, which
          then rendered a full grid of em dashes and an empty activity card —
          indistinguishable from a real but idle account. Say what happened. */}
      {!loading && error && (
        <Card>
          <EmptyState>
            <SectionTitle>Couldn't load your dashboard</SectionTitle>
            <p>{error.message || 'The server did not respond.'}</p>
          </EmptyState>
        </Card>
      )}

      {!loading && !error && isEmpty && (
        <Card>
          <EmptyState>
            <SectionTitle>No activity yet</SectionTitle>
            <p>Add a listing to get started.</p>
            <ActionsRow style={{ justifyContent: 'center', margin: 0 }}>
              <Button size="sm" arrow={false} onClick={() => onNavigate('sources')}>
                Add your first listing
              </Button>
              <Button size="sm" variant="ghost" arrow={false} onClick={() => onNavigate('questions')}>
                Set your questions
              </Button>
            </ActionsRow>
          </EmptyState>
        </Card>
      )}

      {!loading && !error && !isEmpty && (
        <>

      <StatGrid>
        <StatCard>
          <StatLabel>Listings matched</StatLabel>
          <StatNum>{stats ? stats.listings_matched : '—'}</StatNum>
        </StatCard>
        <StatCard>
          <StatLabel>Calls completed</StatLabel>
          <StatNum>{stats ? stats.calls_completed : '—'}</StatNum>
        </StatCard>
        <StatCard>
          <StatLabel>Avg. questions hit</StatLabel>
          {/* An em dash until a call has completed: "0/0" looks like a failure
              rather than an absence. */}
          <StatNum>
            {stats && stats.avg_questions_total > 0
              ? `${stats.avg_questions_hit}/${stats.avg_questions_total}`
              : '—'}
          </StatNum>
        </StatCard>
        <StatCard>
          <StatLabel>Current plan</StatLabel>
          <StatNum style={{ fontSize: '1.4rem', textTransform: 'capitalize' }}>
            {stats ? stats.tier : '—'}
          </StatNum>
        </StatCard>
      </StatGrid>

      <ActionsRow>
        <Button size="sm" arrow={false} onClick={() => onNavigate('questions')}>
          Edit your questions
        </Button>
        <Button size="sm" variant="ghost" arrow={false} onClick={() => onNavigate('sources')}>
          Add a listing source
        </Button>
      </ActionsRow>

      <SectionTitle>Recent activity</SectionTitle>
      <Card>
        {activity.slice(0, 4).map((run) => {
          const meta = STATUS_META[STATUS_KEY[run.status] ?? 'scheduled'];
          return (
            <RunRow key={run.id}>
              <RunInfo>
                <strong>{run.address}</strong>
                <span>{run.source}</span>
              </RunInfo>
              <RunMeta>
                <span className="score">
                  {run.match_score}/{run.total_questions}
                </span>
                <Badge $tone={meta.tone}>{meta.label}</Badge>
              </RunMeta>
            </RunRow>
          );
        })}
      </Card>
        </>
      )}
    </div>
  );
};

export default Overview;
