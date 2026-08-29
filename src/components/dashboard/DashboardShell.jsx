import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import ThemeToggle from '../ui/ThemeToggle';
import ProfileModal from './ProfileModal';
import { ONBOARDING_DONE_KEY, ONBOARDING_RESULT_KEY, TOUR_DONE_KEY } from '../../data/onboardingQuestions';

const Shell = styled.div`
  min-height: 100svh;
  background: ${({ theme }) => theme.bgAlt};
`;

const TopBar = styled.header`
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.6rem;
  background: ${({ theme }) => theme.surfaceGlass};
  backdrop-filter: blur(14px);
  border-bottom: 1px solid ${({ theme }) => theme.rule};
`;

const Mark = styled(Link)`
  font-family: 'Fraunces', Georgia, serif;
  font-size: 1.2rem;
  color: ${({ theme }) => theme.ink};
  text-decoration: none;
`;

const TopActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.8rem;
`;

const Avatar = styled.button`
  width: 2.15rem;
  height: 2.15rem;
  border-radius: 50%;
  background: ${({ theme, $hasImage }) => ($hasImage ? 'transparent' : theme.ink)};
  color: ${({ theme }) => theme.bg};
  border: none;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex: none;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const LogoutLink = styled(Link)`
  font-size: 0.78rem;
  font-weight: 500;
  color: ${({ theme }) => theme.muted};
  text-decoration: none;
  padding: 0.4rem 0.2rem;

  &:hover {
    color: ${({ theme }) => theme.ink};
  }
`;

const Body = styled.div`
  display: flex;
  max-width: 1280px;
  margin: 0 auto;
`;

const Sidebar = styled.nav`
  flex: none;
  width: 220px;
  padding: 2rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;

  @media (max-width: 860px) {
    display: none;
  }
`;

const NavItem = styled.button`
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  padding: 0.65rem 0.8rem;
  border-radius: 8px;
  border: none;
  background: ${({ theme, $active }) => ($active ? theme.surface : 'transparent')};
  box-shadow: ${({ theme, $active }) => ($active ? theme.shadow : 'none')};
  color: ${({ theme, $active }) => ($active ? theme.ink : theme.ink2)};
  font-size: 0.86rem;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;

  &:hover {
    color: ${({ theme }) => theme.ink};
  }

  svg {
    width: 16px;
    height: 16px;
    flex: none;
    opacity: ${({ $active }) => ($active ? 1 : 0.7)};
  }
`;

const Main = styled.main`
  flex: 1;
  min-width: 0;
  padding: 2.5rem 2rem 6rem;

  @media (max-width: 860px) {
    padding: 1.6rem 1.2rem 6rem;
  }
`;

const MobileTabs = styled.nav`
  display: none;

  @media (max-width: 860px) {
    display: flex;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 20;
    background: ${({ theme }) => theme.surfaceGlass};
    backdrop-filter: blur(14px);
    border-top: 1px solid ${({ theme }) => theme.rule};
    padding: 0.5rem 0.4rem calc(0.5rem + env(safe-area-inset-bottom));
  }
`;

const MobileTab = styled.button`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.2rem;
  border: none;
  background: none;
  color: ${({ theme, $active }) => ($active ? theme.ink : theme.muted)};
  font-size: 0.62rem;
  font-weight: 500;
  cursor: pointer;

  svg {
    width: 18px;
    height: 18px;
  }
`;

const icons = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  questions: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="20" cy="18" r="1.4" fill="currentColor" />
    </svg>
  ),
  sources: (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 12h17M12 3.5c2.4 2.3 3.7 5.3 3.7 8.5s-1.3 6.2-3.7 8.5c-2.4-2.3-3.7-5.3-3.7-8.5S9.6 5.8 12 3.5Z" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  results: (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M6.5 8.5c-1.5-1.5-1.5-3 0-4.2 1.4-1.2 3-.8 4.2.6l1 1.1M17.5 15.5c1.5 1.5 1.5 3 0 4.2-1.4 1.2-3 .8-4.2-.6l-1-1.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M9 15l6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
};

export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'questions', label: 'Questions' },
  { id: 'sources', label: 'Sources' },
  { id: 'results', label: 'Results' },
];

const initials = (name) =>
  name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'K';

const DashboardShell = ({ active, onChange, profile, onProfileChange, children }) => {
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);

  const handleLogout = () => {
    try {
      window.localStorage.removeItem(ONBOARDING_DONE_KEY);
      window.localStorage.removeItem(ONBOARDING_RESULT_KEY);
      window.localStorage.removeItem(TOUR_DONE_KEY);
    } catch {
      /* ignore storage access errors */
    }
    navigate('/');
  };

  return (
    <Shell>
      <TopBar>
        <Mark to="/">khoj</Mark>
        <TopActions>
          <ThemeToggle />
          <LogoutLink to="/" onClick={handleLogout}>
            Log out
          </LogoutLink>
          <Avatar
            aria-label="Edit profile"
            $hasImage={!!profile.avatar}
            onClick={() => setProfileOpen(true)}
          >
            {profile.avatar ? <img src={profile.avatar} alt="" /> : initials(profile.name)}
          </Avatar>
        </TopActions>
      </TopBar>

      {profileOpen && (
        <ProfileModal profile={profile} onChange={onProfileChange} onClose={() => setProfileOpen(false)} />
      )}

      <Body>
        <Sidebar>
          {TABS.map((tab) => (
            <NavItem
              key={tab.id}
              data-tour-id={tab.id}
              $active={active === tab.id}
              onClick={() => onChange(tab.id)}
            >
              {icons[tab.id]}
              {tab.label}
            </NavItem>
          ))}
        </Sidebar>

        <Main>{children}</Main>
      </Body>

      <MobileTabs>
        {TABS.map((tab) => (
          <MobileTab
            key={tab.id}
            data-tour-id={tab.id}
            $active={active === tab.id}
            onClick={() => onChange(tab.id)}
          >
            {icons[tab.id]}
            {tab.label}
          </MobileTab>
        ))}
      </MobileTabs>
    </Shell>
  );
};

export default DashboardShell;
