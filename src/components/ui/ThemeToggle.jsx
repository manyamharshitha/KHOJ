import styled from 'styled-components';
import { useThemeMode } from '../../theme/ThemeContext';

const Toggle = styled.button`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.15rem;
  height: 2.15rem;
  padding: 0;
  border-radius: 50%;
  border: 1px solid ${({ theme, $onDark }) => ($onDark ? 'rgba(244, 246, 248, 0.3)' : theme.rule2)};
  background: ${({ theme, $onDark }) => ($onDark ? 'rgba(244, 246, 248, 0.08)' : theme.surface)};
  color: ${({ theme, $onDark }) => ($onDark ? theme.onDark : theme.ink)};
  cursor: pointer;
  transition: border-color 0.25s ease, background-color 0.25s ease, transform 0.15s ease;

  &:hover {
    border-color: ${({ theme, $onDark }) => ($onDark ? 'rgba(244, 246, 248, 0.55)' : theme.ink)};
  }

  &:active {
    transform: scale(0.92);
  }

  svg {
    width: 15px;
    height: 15px;
    position: absolute;
    transition: opacity 0.3s ease, transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
`;

const SunIcon = ({ visible }) => (
  <svg viewBox="0 0 24 24" fill="none" style={{ opacity: visible ? 1 : 0, transform: visible ? 'rotate(0deg) scale(1)' : 'rotate(-60deg) scale(0.6)' }}>
    <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.6" />
    <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M12 2.5v2.4" />
      <path d="M12 19.1v2.4" />
      <path d="M4.2 4.2l1.7 1.7" />
      <path d="M18.1 18.1l1.7 1.7" />
      <path d="M2.5 12h2.4" />
      <path d="M19.1 12h2.4" />
      <path d="M4.2 19.8l1.7-1.7" />
      <path d="M18.1 5.9l1.7-1.7" />
    </g>
  </svg>
);

const MoonIcon = ({ visible }) => (
  <svg viewBox="0 0 24 24" fill="none" style={{ opacity: visible ? 1 : 0, transform: visible ? 'rotate(0deg) scale(1)' : 'rotate(60deg) scale(0.6)' }}>
    <path
      d="M20.2 14.3A8.2 8.2 0 1 1 9.7 3.8a6.6 6.6 0 0 0 10.5 10.5Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
);

const ThemeToggle = ({ onDark = false }) => {
  const { isDark, toggle } = useThemeMode();
  return (
    <Toggle type="button" onClick={toggle} $onDark={onDark} aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
      <SunIcon visible={!isDark} />
      <MoonIcon visible={isDark} />
    </Toggle>
  );
};

export default ThemeToggle;
