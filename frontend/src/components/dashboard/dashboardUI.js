import styled, { css } from 'styled-components';

export const PanelHead = styled.div`
  margin-bottom: 2rem;
`;

export const Kicker = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  display: block;
  margin-bottom: 0.6rem;
`;

export const Title = styled.h1`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(1.4rem, 2.4vw, 1.8rem);
  letter-spacing: -0.02em;
  line-height: 1.2;
  margin: 0 0 0.5rem;
  color: ${({ theme }) => theme.ink};
`;

export const Sub = styled.p`
  color: ${({ theme }) => theme.muted};
  font-size: 0.86rem;
  line-height: 1.55;
  max-width: 52ch;
  margin: 0;
`;

export const Card = styled.div`
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.rule};
  border-radius: 10px;
  padding: 1.4rem 1.5rem;
`;

export const CardRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 0;

  & + & {
    border-top: 1px solid ${({ theme }) => theme.rule};
  }
`;

const toneColor = {
  good: (t) => t.good,
  accent: (t) => t.accentDeep,
  muted: (t) => t.muted,
  bad: (t) => t.bad,
};

const toneBg = {
  good: (t) => t.goodSoft,
  accent: (t) => t.accentSoft,
  muted: (t) => t.surface2,
  bad: (t) => t.badSoft,
};

export const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.64rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.3rem 0.55rem;
  border-radius: 999px;
  color: ${({ theme, $tone }) => (toneColor[$tone] || toneColor.muted)(theme)};
  background: ${({ theme, $tone }) => (toneBg[$tone] || toneBg.muted)(theme)};
  white-space: nowrap;
`;

export const Switch = styled.button`
  position: relative;
  width: 2.15rem;
  height: 1.25rem;
  border-radius: 999px;
  border: 1px solid ${({ theme, $on }) => ($on ? theme.gold : theme.rule2)};
  background: ${({ theme, $on }) => ($on ? theme.goldSoft : theme.surface2)};
  cursor: pointer;
  padding: 0;
  flex: none;
  transition: border-color 0.2s ease, background-color 0.2s ease;

  &::after {
    content: '';
    position: absolute;
    top: 50%;
    left: ${({ $on }) => ($on ? 'calc(100% - 1.05rem)' : '0.14rem')};
    transform: translateY(-50%);
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 50%;
    background: ${({ theme, $on }) => ($on ? theme.gold : theme.muted)};
    transition: left 0.2s ease, background-color 0.2s ease;
  }
`;

export const IconButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 6px;
  border: 1px solid ${({ theme }) => theme.rule2};
  background: ${({ theme }) => theme.surface};
  color: ${({ theme }) => theme.muted};
  cursor: pointer;
  flex: none;
  transition: color 0.2s ease, border-color 0.2s ease;

  &:hover {
    color: ${({ theme }) => theme.bad};
    border-color: ${({ theme }) => theme.bad};
  }

  svg {
    width: 12px;
    height: 12px;
  }
`;

export const StatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 2.5rem;

  @media (max-width: 720px) {
    grid-template-columns: 1fr 1fr;
  }
`;

export const StatCard = styled(Card)`
  padding: 1.2rem 1.3rem;
`;

export const StatLabel = styled.span`
  display: block;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  margin-bottom: 0.7rem;
`;

export const StatNum = styled.div`
  font-family: 'Fraunces', Georgia, serif;
  font-size: 1.8rem;
  letter-spacing: -0.02em;
  color: ${({ theme }) => theme.ink};
`;

export const inputStyles = css`
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 14px;
  color: ${({ theme }) => theme.ink};
  background-color: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.rule2};
  border-radius: 0.5em;
  outline: none;
  padding: 0.7em 0.9em;
  transition: 0.2s;

  &::placeholder {
    color: ${({ theme }) => theme.muted};
  }

  &:focus {
    border-color: ${({ theme }) => theme.accent};
    box-shadow: 0 0 0 3px ${({ theme }) => theme.accentSoft};
  }
`;

export const TextInput = styled.input`
  ${inputStyles}
  width: 100%;
`;
