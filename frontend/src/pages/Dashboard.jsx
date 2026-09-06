import { useState } from 'react';
import DashboardShell from '../components/dashboard/DashboardShell';
import Onboarding from '../components/dashboard/Onboarding';
import GuidedTour from '../components/dashboard/GuidedTour';
import Overview from '../components/dashboard/Overview';
import QuestionsPanel from '../components/dashboard/QuestionsPanel';
import SourcesPanel from '../components/dashboard/SourcesPanel';
import ResultsPanel from '../components/dashboard/ResultsPanel';
import { ONBOARDING_DONE_KEY, ONBOARDING_RESULT_KEY, TOUR_DONE_KEY } from '../data/onboardingQuestions';
import { SearchProvider, useSearchSession } from '../lib/SearchContext';
import { useProfile } from '../lib/useKhoj';
import ErrorBoundary from '../components/ui/ErrorBoundary';

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

const DashboardInner = () => {
  const { sessionId } = useSearchSession();
  const [phase, setPhase] = useState(initialPhase);
  const [tab, setTab] = useState('overview');

  // The real signed-in user, synced with the backend profile. Falls back to a
  // neutral label rather than a fake person when nobody is signed in — the demo
  // data is honest about being sample data, and the name should be too.
  const { displayName, saveName, user } = useProfile();
  const [localProfile, setLocalProfile] = useState({ name: '', avatar: null });

  const profile = {
    name: displayName || localProfile.name || 'Guest',
    avatar: user?.photoURL || localProfile.avatar || null,
  };
  const onProfileChange = (next) => {
    setLocalProfile(next);
    if (next?.name && next.name !== displayName) void saveName(next.name);
  };
  // An unrecognised tab id would make <Panel /> an undefined element type,
  // which React reports as "Element type is invalid" and which takes the whole
  // route down. Fall back to the overview instead of crashing.
  const Panel = PANELS[tab] ?? Overview;

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
    // From the Google token via the backend profile. Deliberately not
    // profile.name — that falls back to 'Guest' for the navbar, and
    // "Hey Guest" reads worse than "Hey there".
    const firstName = (displayName || '').trim().split(/\s+/)[0] || 'there';
    return (
      <ErrorBoundary title="Setup could not load">
        <Onboarding firstName={firstName} onComplete={completeSetup} onSkip={() => completeSetup(null)} />
      </ErrorBoundary>
    );
  }

  return (
    <DashboardShell active={tab} onChange={setTab} profile={profile} onProfileChange={onProfileChange}>
      {/* Per-panel, so a panel that throws leaves the shell and its navigation
          standing — the customer can move to another tab instead of reloading.
          Keyed on the tab so leaving mounts a fresh boundary rather than
          carrying the previous panel's failure across. */}
      <ErrorBoundary key={tab} title="This panel failed to load">
        <Panel onNavigate={setTab} profile={profile} sessionId={sessionId} />
      </ErrorBoundary>
      {phase === 'tour' && <GuidedTour onFinish={completeTour} onSkip={completeTour} />}
    </DashboardShell>
  );
};

/**
 * The search lives above the panels so Sources can start one and Results can
 * read it, without either knowing about the other.
 */
const Dashboard = () => (
  <SearchProvider>
    <DashboardInner />
  </SearchProvider>
);

export default Dashboard;
