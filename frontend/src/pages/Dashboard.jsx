import { useState } from 'react';
import DashboardShell from '../components/dashboard/DashboardShell';
import Onboarding from '../components/dashboard/Onboarding';
import GuidedTour from '../components/dashboard/GuidedTour';
import Overview from '../components/dashboard/Overview';
import QuestionsPanel from '../components/dashboard/QuestionsPanel';
import SourcesPanel from '../components/dashboard/SourcesPanel';
import ResultsPanel from '../components/dashboard/ResultsPanel';
import { ONBOARDING_DONE_KEY, ONBOARDING_RESULT_KEY, TOUR_DONE_KEY } from '../data/onboardingQuestions';

const PANELS = {
  overview: Overview,
  questions: QuestionsPanel,
  sources: SourcesPanel,
  results: ResultsPanel,
};

const readFlag = (key) => {
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return true;
  }
};

const writeFlag = (key) => {
  try {
    window.localStorage.setItem(key, 'true');
  } catch {}
};

const initialPhase = () => {
  if (!readFlag(ONBOARDING_DONE_KEY)) return 'setup';
  if (!readFlag(TOUR_DONE_KEY)) return 'tour';
  return 'ready';
};

const Dashboard = () => {
  const [phase, setPhase] = useState(initialPhase);
  const [tab, setTab] = useState('overview');
  const [profile, setProfile] = useState({ name: 'Ananya Rao', avatar: null });
  const Panel = PANELS[tab];

  const completeSetup = (questionCards) => {
    writeFlag(ONBOARDING_DONE_KEY);
    if (questionCards) {
      try {
        window.localStorage.setItem(ONBOARDING_RESULT_KEY, JSON.stringify(questionCards));
      } catch {}
    }
    setPhase('tour');
  };

  const completeTour = () => {
    writeFlag(TOUR_DONE_KEY);
    setPhase('ready');
  };

  if (phase === 'setup') {
    const firstName = (profile.name || 'there').trim().split(/\s+/)[0];
    return <Onboarding firstName={firstName} onComplete={completeSetup} onSkip={() => completeSetup(null)} />;
  }

  return (
    <DashboardShell active={tab} onChange={setTab} profile={profile} onProfileChange={setProfile}>
      <Panel onNavigate={setTab} profile={profile} />
      {phase === 'tour' && <GuidedTour onFinish={completeTour} onSkip={completeTour} />}
    </DashboardShell>
  );
};

export default Dashboard;
