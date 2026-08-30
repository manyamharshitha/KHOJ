import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { TOUR_STEPS } from '../../data/onboardingQuestions';

const PAD = 8;

const getTargetRect = (id) => {
  const els = document.querySelectorAll(`[data-tour-id="${id}"]`);
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  return null;
};

const Spotlight = styled.div`
  position: fixed;
  z-index: 310;
  border-radius: 10px;
  box-shadow: 0 0 0 9999px rgba(8, 10, 12, 0.62);
  transition: top 0.3s ease, left 0.3s ease, width 0.3s ease, height 0.3s ease;
  pointer-events: none;
`;

const Card = styled.div`
  position: fixed;
  z-index: 311;
  width: min(300px, calc(100vw - 2rem));
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.rule};
  border-radius: 12px;
  padding: 1.3rem 1.4rem;
  box-shadow: ${({ theme }) => theme.shadowLg};
  transition: top 0.3s ease, left 0.3s ease;
`;

const ArrowOuter = styled.div`
  position: absolute;
  width: 12px;
  height: 12px;
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.rule};
  transform: rotate(45deg);

  ${({ $side }) =>
    $side === 'left'
      ? `left: -7px; top: 50%; margin-top: -6px; border-right: none; border-bottom: none;`
      : $side === 'top'
        ? `top: -7px; left: 50%; margin-left: -6px; border-right: none; border-bottom: none;`
        : `bottom: -7px; left: 50%; margin-left: -6px; border-left: none; border-top: none;`}
`;

const Kicker = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  display: block;
  margin-bottom: 0.6rem;
`;

const Title = styled.h3`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: 1.15rem;
  margin: 0 0 0.5rem;
  color: ${({ theme }) => theme.ink};
`;

const Desc = styled.p`
  font-size: 0.84rem;
  line-height: 1.55;
  color: ${({ theme }) => theme.ink2};
  margin: 0 0 1.1rem;
`;

const Foot = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
`;

const Dots = styled.div`
  display: flex;
  gap: 0.35rem;
`;

const Dot = styled.span`
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: ${({ theme, $active }) => ($active ? theme.gold : theme.rule2)};
`;

const Buttons = styled.div`
  display: flex;
  gap: 0.6rem;
`;

const TextButton = styled.button`
  font-size: 0.78rem;
  font-weight: 500;
  color: ${({ theme }) => theme.muted};
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.3rem;

  &:hover {
    color: ${({ theme }) => theme.ink};
  }
`;

const NextButton = styled.button`
  font-size: 0.8rem;
  font-weight: 600;
  color: ${({ theme }) => theme.bg};
  background: ${({ theme }) => theme.ink};
  border: none;
  border-radius: 999px;
  padding: 0.5rem 1rem;
  cursor: pointer;
`;

const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

const computePlacement = (rect) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(300, vw - 32);
  const cardH = 150;
  const gap = 14;

  if (rect.bottom > vh - 120) {
    return {
      side: 'bottom',
      top: rect.top - gap - cardH,
      left: clamp(rect.left + rect.width / 2 - cardW / 2, 16, vw - cardW - 16),
    };
  }
  if (rect.left < vw * 0.45) {
    return {
      side: 'left',
      top: clamp(rect.top + rect.height / 2 - cardH / 2, 16, vh - cardH - 16),
      left: clamp(rect.right + gap, 16, vw - cardW - 16),
    };
  }
  return {
    side: 'top',
    top: clamp(rect.bottom + gap, 16, vh - cardH - 16),
    left: clamp(rect.left + rect.width / 2 - cardW / 2, 16, vw - cardW - 16),
  };
};

const GuidedTour = ({ onFinish, onSkip }) => {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    const measure = () => setRect(getTargetRect(TOUR_STEPS[index].id));
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [index]);

  if (!rect) return null;

  const step = TOUR_STEPS[index];
  const placement = computePlacement(rect);
  const isLast = index === TOUR_STEPS.length - 1;

  return (
    <>
      <Spotlight
        style={{
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
        }}
      />
      <Card style={{ top: placement.top, left: placement.left }}>
        <ArrowOuter $side={placement.side} />
        <Kicker>
          Guided tour · {index + 1} of {TOUR_STEPS.length}
        </Kicker>
        <Title>{step.title}</Title>
        <Desc>{step.desc}</Desc>
        <Foot>
          <Dots>
            {TOUR_STEPS.map((t, i) => (
              <Dot key={t.id} $active={i === index} />
            ))}
          </Dots>
          <Buttons>
            <TextButton type="button" onClick={onSkip}>
              Skip
            </TextButton>
            <NextButton type="button" onClick={() => (isLast ? onFinish() : setIndex((i) => i + 1))}>
              {isLast ? 'Got it' : 'Next'}
            </NextButton>
          </Buttons>
        </Foot>
      </Card>
    </>
  );
};

export default GuidedTour;
