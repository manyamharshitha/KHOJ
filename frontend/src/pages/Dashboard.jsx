import { useState } from 'react';
import DashboardShell from '../components/dashboard/DashboardShell';
import Onboarding from '../components/dashboard/Onboarding';
import GuidedTour from '../components/dashboard/GuidedTour';
import Overview from '../components/dashboard/Overview';
import QuestionsPanel from '../components/dashboard/QuestionsPanel';
import SourcesPanel from '../components/dashboard/SourcesPanel';
import ResultsPanel from '../components/dashboard/ResultsPanel';
import VisitsPanel from '../components/dashboard/VisitsPanel';
import NegotiationsPanel from '../components/dashboard/NegotiationsPanel';
import BrokerPanel from '../components/dashboard/BrokerPanel';
import { ONBOARDING_DONE_KEY, ONBOARDING_RESULT_KEY, TOUR_DONE_KEY } from '../data/onboardingQuestions';
import { SearchProvider, useSearchSession } from '../lib/SearchContext';
import { useProfile } from '../lib/useKhoj';
import { RoleProvider, useRole } from '../lib/usePlatform';
import ErrorBoundary from '../components/ui/ErrorBoundary';

const PANELS = {
  overview: Overview,
  questions: QuestionsPanel,
  sources: SourcesPanel,
  results: ResultsPanel,
  verified: VisitsPanel,
  deposit: NegotiationsPanel,
  broker: BrokerPanel,
};

/**
 * Which panels each side of the product can open.
 *
 * A tenant looks for a flat; a broker receives the calls that follow. Listing
 * management is meaningless to the first and the search pipeline is meaningless
 * to the second, so neither is offered what it cannot use.
 *
 * This is navigation, not security. The backend already refuses a broker route
 * to an account that is not one — see `app/routes/brokers.py`, which says the
 * separation is enforced there "rather than in the frontend: a dashboard that
 * hides a section is a UI preference, while a route that refuses to return it
 * is a permission". This keeps the two consistent so nobody is shown a tab that
 * would answer 403.
 */
const PANELS_FOR = {
  renter: ['overview', 'questions', 'sources', 'results', 'verified', 'deposit'],
  broker: ['overview', 'broker', 'verified'],
};

const HOME_FOR = { renter: 'overview', broker: 'broker' };

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
  // Which side of the product this account is on. Defaults to renter while the
  // role is still loading: showing a tenant the search for a moment is a far
  // smaller wrong than flashing broker tools at them.
  const { role } = useRole();
  const allowed = PANELS_FOR[role] ?? PANELS_FOR.renter;

  // Two failure modes collapse into one fallback here. An unrecognised tab id
  // makes <Panel /> an undefined element type, which React reports as "Element
  // type is invalid" and which takes the whole route down. A tab this role may
  // not open is a different problem with the same answer: send them home rather
  // than render it. Recomputed on every pass, so a role that arrives late — or
  // changes — closes a panel that is no longer permitted instead of leaving it
  // on screen.
  const home = HOME_FOR[role] ?? 'overview';
  const current = allowed.includes(tab) ? tab : home;
  const Panel = PANELS[current] ?? Overview;

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
    <DashboardShell
      active={current}
      onChange={setTab}
      allowed={allowed}
      profile={profile}
      onProfileChange={onProfileChange}
    >
      {/* Per-panel, so a panel that throws leaves the shell and its navigation
          standing — the customer can move to another tab instead of reloading.
          Keyed on the tab so leaving mounts a fresh boundary rather than
          carrying the previous panel's failure across. */}
      <ErrorBoundary key={current} title="This panel failed to load">
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
  <RoleProvider>
    <SearchProvider>
      <DashboardInner />
    </SearchProvider>
  </RoleProvider>
);

export default Dashboard;
