import styled from 'styled-components';
import { PanelHead, Kicker, Title, Sub, Card, StatGrid, StatCard, StatLabel, StatNum, Badge } from './dashboardUI';
import { callRuns, STATUS_META } from '../../data/callRuns';
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

const Overview = ({ onNavigate, profile }) => {
  const firstName = (profile?.name || 'there').trim().split(/\s+/)[0];

  return (
    <div>
      <PanelHead>
        <Kicker>Overview</Kicker>
        <Title>Welcome back, {firstName}</Title>
        <Sub>Here's what Khoj has been doing on your behalf.</Sub>
      </PanelHead>

      <StatGrid>
        <StatCard>
          <StatLabel>Listings matched</StatLabel>
          <StatNum>7</StatNum>
        </StatCard>
        <StatCard>
          <StatLabel>Calls completed</StatLabel>
          <StatNum>5</StatNum>
        </StatCard>
        <StatCard>
          <StatLabel>Avg. questions hit</StatLabel>
          <StatNum>12/15</StatNum>
        </StatCard>
        <StatCard>
          <StatLabel>Current plan</StatLabel>
          <StatNum style={{ fontSize: '1.4rem' }}>Silver</StatNum>
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
        {callRuns.slice(0, 4).map((run) => {
          const meta = STATUS_META[run.status];
          return (
            <RunRow key={run.id}>
              <RunInfo>
                <strong>{run.address}</strong>
                <span>{run.source}</span>
              </RunInfo>
              <RunMeta>
                <span className="score">
                  {run.matchScore}/{run.totalQuestions}
                </span>
                <Badge $tone={meta.tone}>{meta.label}</Badge>
              </RunMeta>
            </RunRow>
          );
        })}
      </Card>
    </div>
  );
};

export default Overview;
