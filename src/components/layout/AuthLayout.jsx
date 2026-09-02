import { Link } from 'react-router-dom';
import styled from 'styled-components';

export const Shell = styled.div`
  min-height: 100svh;
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: ${({ theme }) => theme.bg};

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
  }
`;

export const BrandPanel = styled.div`
  position: relative;
  padding: 0 3.5rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  color: ${({ theme }) => theme.onDark};
  overflow: hidden;
  background:
    radial-gradient(circle at 18% 18%, ${({ theme }) => theme.accent}4d, transparent 46%),
    radial-gradient(circle at 88% 82%, ${({ theme }) => theme.gold}3d, transparent 42%),
    linear-gradient(165deg, #1b3462 0%, #0f2244 55%, #081530 100%);

  @media (max-width: 960px) {
    display: none;
  }
`;

export const BrandNoise = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.5;
  background-image: radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px);
  background-size: 22px 22px;
`;

export const GlobeWrap = styled.div`
  position: absolute;
  right: -8%;
  bottom: -12%;
  width: 60%;
  max-width: 460px;
  pointer-events: none;
  opacity: 0.9;
`;

export const BrandWatermark = styled.span`
  position: absolute;
  right: 6%;
  bottom: 5%;
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(3.5rem, 9vw, 7rem);
  line-height: 1;
  letter-spacing: -0.03em;
  color: ${({ theme }) => theme.onDark};
  opacity: 0.07;
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
`;

export const BrandMark = styled(Link)`
  position: absolute;
  top: 6.5rem;
  left: 3.5rem;
  font-family: 'Fraunces', Georgia, serif;
  font-size: 1.3rem;
  letter-spacing: -0.01em;
  color: ${({ theme }) => theme.onDark};
  text-decoration: none;
  z-index: 1;
`;

export const TrustRow = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.6rem;
`;

export const AvatarStack = styled.div`
  display: flex;

  span {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.62rem;
    font-weight: 500;
    color: #0f2244;
    border: 2px solid #0f2244;
    margin-left: -8px;
  }

  span:first-child {
    margin-left: 0;
  }
`;

export const TrustCaption = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.66rem;
  letter-spacing: 0.06em;
  color: ${({ theme }) => theme.onDark2};
`;

export const BrandQuote = styled.p`
  position: relative;
  z-index: 1;
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(1.2rem, 2vw, 1.55rem);
  line-height: 1.42;
  letter-spacing: -0.01em;
  max-width: 26ch;
  margin: 0;
`;

export const BrandCite = styled.span`
  position: relative;
  z-index: 1;
  display: block;
  margin-top: 1.3rem;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.64rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.onDark2};
`;

export const FormPanel = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 7.5rem 6vw 4rem;
`;

export const FormCard = styled.div`
  width: 100%;
  max-width: 380px;
`;

export const MobileMark = styled(Link)`
  display: none;
  font-family: 'Fraunces', Georgia, serif;
  font-size: 1.25rem;
  color: ${({ theme }) => theme.ink};
  text-decoration: none;
  margin-bottom: 2rem;

  @media (max-width: 960px) {
    display: inline-block;
  }
`;

export const Kicker = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  display: block;
  margin-bottom: 0.8rem;
`;

export const Title = styled.h1`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(1.35rem, 2.4vw, 1.6rem);
  letter-spacing: -0.02em;
  line-height: 1.25;
  margin: 0 0 0.5rem;
  color: ${({ theme }) => theme.ink};
`;

export const Sub = styled.p`
  color: ${({ theme }) => theme.muted};
  font-size: 0.82rem;
  line-height: 1.55;
  margin: 0 0 1.8rem;
`;

export const Field = styled.div`
  margin-bottom: 1rem;

  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: ${({ theme }) => theme.muted};
    margin-bottom: 0.5rem;
  }

  a {
    text-transform: none;
    letter-spacing: 0;
    font-family: 'Inter', sans-serif;
    font-size: 0.76rem;
    color: ${({ theme }) => theme.accentDeep};
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
`;

export const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1.3rem;

  input {
    width: 14px;
    height: 14px;
    accent-color: ${({ theme }) => theme.ink};
    flex: none;
  }

  label {
    font-size: 0.76rem;
    line-height: 1.4;
    color: ${({ theme }) => theme.ink2};
  }

  a {
    color: ${({ theme }) => theme.ink};
    text-decoration: underline;
    text-underline-offset: 2px;
  }
`;

export const Divider = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 1.4rem 0;
  color: ${({ theme }) => theme.muted};
  font-size: 0.72rem;

  &::before,
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: ${({ theme }) => theme.rule};
  }
`;

export const SocialButton = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  height: 2.75em;
  border-radius: 0.6em;
  border: 1px solid ${({ theme }) => theme.rule2};
  background: ${({ theme }) => theme.surface};
  color: ${({ theme }) => theme.ink};
  font-family: 'Inter', sans-serif;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease;

  &:hover {
    border-color: ${({ theme }) => theme.ink};
    background: ${({ theme }) => theme.surface2};
  }
`;

export const Foot = styled.p`
  margin: 1.8rem 0 0;
  text-align: center;
  font-size: 0.8rem;
  color: ${({ theme }) => theme.muted};

  a {
    color: ${({ theme }) => theme.ink};
    font-weight: 500;
    text-decoration: none;
    border-bottom: 1px solid ${({ theme }) => theme.rule2};
  }

  a:hover {
    color: ${({ theme }) => theme.accentDeep};
    border-color: ${({ theme }) => theme.accentDeep};
  }
`;

export const Feedback = styled.div`
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-top: 1rem;
  font-size: 0.8rem;
  color: ${({ theme, $tone }) => ($tone === 'bad' ? theme.bad : theme.good)};
`;

export const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18">
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18z"
    />
    <path fill="#FBBC05" d="M3.95 10.7a5.4 5.4 0 0 1 0-3.4V4.97H.9a9 9 0 0 0 0 8.06l3.05-2.33z" />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .9 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"
    />
  </svg>
);

const AVATARS = [
  { bg: '#F6D998', label: 'A' },
  { bg: '#C9DCF6', label: 'R' },
  { bg: '#F2C7C0', label: 'S' },
  { bg: '#CDEAD9', label: 'M' },
];

export const Trust = () => (
  <TrustRow>
    <AvatarStack>
      {AVATARS.map((a) => (
        <span key={a.label} style={{ background: a.bg }}>
          {a.label}
        </span>
      ))}
    </AvatarStack>
    <TrustCaption>Renters · Families · First-time movers</TrustCaption>
  </TrustRow>
);
