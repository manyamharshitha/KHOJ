import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { motion, useScroll, useTransform, useMotionValueEvent } from 'framer-motion';
import ScrollReveal from '../ui/ScrollReveal';
import Button from '../ui/Button';
import { ListIllustration, CallIllustration, VerifiedIllustration } from '../ui/Illustrations';

const steps = [
  {
    n: '01',
    Media: ListIllustration,
    label: 'Your questions',
    title: 'build your question set',
    desc: 'Pick from Khoj\'s question bank — rent, deposit, food policy — or write your own. Up to 15 in total.',
  },
  {
    n: '02',
    Media: CallIllustration,
    label: 'The match',
    title: 'khoj checks the listings',
    desc: 'It scans your listing sites, or ours by default, and only calls when a listing already answers most of what you asked.',
  },
  {
    n: '03',
    Media: VerifiedIllustration,
    label: 'The call',
    title: 'verified, live',
    desc: 'Discloses it\'s AI, asks when and in which language, then runs your questions and logs every answer.',
  },
];

const DESKTOP_BREAKPOINT = 861;

const useIsDesktop = () => {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= DESKTOP_BREAKPOINT : true
  );

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setIsDesktop(mq.matches && !reduceMq.matches);
    update();
    mq.addEventListener('change', update);
    reduceMq.addEventListener('change', update);
    return () => {
      mq.removeEventListener('change', update);
      reduceMq.removeEventListener('change', update);
    };
  }, []);

  return isDesktop;
};

const Wrap = styled.section`
  padding: 7rem 6vw;
  background: ${({ theme }) => theme.bg};
`;

const Head = styled.div`
  max-width: 1280px;
  margin: 0 auto 3rem;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 2rem;
  flex-wrap: wrap;
`;

const LabelRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.1rem;

  .bar {
    width: 24px;
    height: 1px;
    background: ${({ theme }) => theme.rule2};
  }
`;

const Label = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.64rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
`;

const Title = styled.h2`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(1.6rem, 3vw, 2.35rem);
  line-height: 1.15;
  letter-spacing: -0.02em;
  margin: 0;
  color: ${({ theme }) => theme.ink};
`;

/* ---------- mobile / plain card list ---------- */

const Grid = styled.div`
  max-width: 1280px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.8rem;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
    max-width: 440px;
    gap: 2.75rem;
  }
`;

const Card = styled.div`
  display: flex;
  flex-direction: column;
`;

const CardMedia = styled.div`
  position: relative;
  aspect-ratio: 4 / 5;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.rule};
  margin-bottom: 1.4rem;
  transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);

  &:hover {
    transform: translateY(-3px);
  }
`;

const Badge = styled.span`
  position: absolute;
  top: 1rem;
  left: 1rem;
  z-index: 1;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  background: rgba(255, 255, 255, 0.92);
  color: #14171a;
  padding: 0.28rem 0.55rem;
  border-radius: 2px;
`;

const CardTitle = styled.h3`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: 1.3rem;
  letter-spacing: -0.01em;
  margin: 0 0 0.6rem;
  color: ${({ theme }) => theme.ink};
`;

const CardDesc = styled.p`
  color: ${({ theme }) => theme.ink2};
  font-size: 0.86rem;
  line-height: 1.6;
  margin: 0;
`;

const StepGrid = () => (
  <Grid>
    {steps.map((step, i) => (
      <ScrollReveal key={step.n} delay={i * 0.08}>
        <Card>
          <CardMedia>
            <Badge>STEP {step.n}</Badge>
            <step.Media />
          </CardMedia>
          <Label style={{ marginBottom: '0.6rem', display: 'block' }}>{step.label}</Label>
          <CardTitle>{step.title}</CardTitle>
          <CardDesc>{step.desc}</CardDesc>
        </Card>
      </ScrollReveal>
    ))}
  </Grid>
);

/* ---------- desktop / scroll-driven macbook ---------- */

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const ScrollStage = styled.div`
  position: relative;
  height: 320vh;
`;

const Sticky = styled.div`
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
`;

const Rig = styled.div`
  perspective: 1600px;
  width: min(760px, 82vw);
`;

const Lid = styled(motion.div)`
  position: relative;
  transform-origin: 50% 100%;
  transform-style: preserve-3d;
`;

const Chassis = styled.div`
  position: relative;
  border-radius: 18px;
  padding: 7px;
  background: linear-gradient(180deg, ${({ theme }) => theme.rule2}, ${({ theme }) => theme.rule});
  box-shadow: ${({ theme }) => theme.shadowLg};
`;

const Bezel = styled.div`
  position: relative;
  aspect-ratio: 16 / 10.2;
  border-radius: 12px;
  padding: 0.5rem;
  background: ${({ theme }) => theme.ink};
`;

const Notch = styled.div`
  position: absolute;
  top: 0.3rem;
  left: 50%;
  transform: translateX(-50%);
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${({ theme }) => theme.onDark2};
  z-index: 2;
`;

const Screen = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 7px;
  overflow: hidden;
  background: ${({ theme }) => theme.surface};
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Base = styled.div`
  position: relative;
  margin: 0 -16px;
  padding: 14px 26px 22px;
  border-radius: 0 0 16px 16px;
  background: linear-gradient(180deg, ${({ theme }) => theme.rule2}, ${({ theme }) => theme.rule});
  box-shadow: ${({ theme }) => theme.shadowLg};

  &::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 0;
    transform: translateX(-50%);
    width: 96px;
    height: 6px;
    border-radius: 0 0 6px 6px;
    background: ${({ theme }) => theme.bg};
  }
`;

const KeyboardDeck = styled.div`
  height: clamp(64px, 10vw, 104px);
  border-radius: 6px;
  border: 1px solid ${({ theme }) => theme.rule2};
  background: ${({ theme }) => theme.surface2};
  background-image:
    repeating-linear-gradient(90deg, ${({ theme }) => theme.rule} 0 1.5px, transparent 1.5px 3.6%),
    repeating-linear-gradient(0deg, ${({ theme }) => theme.rule} 0 1.5px, transparent 1.5px 26%);
  opacity: 0.9;
`;

const Trackpad = styled.div`
  width: 24%;
  min-width: 90px;
  height: 20px;
  margin: 10px auto 0;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.rule2};
  background: ${({ theme }) => theme.surface};
`;

const ScreenInner = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: clamp(1.4rem, 4vw, 3rem);
`;

const ScreenBadge = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  color: ${({ theme }) => theme.muted};
  border: 1px solid ${({ theme }) => theme.rule2};
  border-radius: 2px;
  padding: 0.24rem 0.5rem;
  margin-bottom: 1rem;
`;

const ScreenTitle = styled.h3`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(1.3rem, 2.6vw, 1.9rem);
  letter-spacing: -0.01em;
  margin: 0 0 0.7rem;
  color: ${({ theme }) => theme.ink};
`;

const ScreenDesc = styled.p`
  color: ${({ theme }) => theme.ink2};
  font-size: 0.88rem;
  line-height: 1.65;
  max-width: 42ch;
  margin: 0;
`;

const Dots = styled.div`
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 1.6rem;
`;

const Dot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${({ theme, $active }) => ($active ? theme.gold : theme.rule2)};
  transition: background 0.3s ease;
`;

const MacbookSteps = () => {
  const stageRef = useRef(null);
  const [activeStep, setActiveStep] = useState(0);

  const { scrollYProgress } = useScroll({
    target: stageRef,
    offset: ['start start', 'end end'],
  });

  const rotateX = useTransform(scrollYProgress, [0, 0.26, 0.82, 1], [-95, 0, 0, -95]);
  const scale = useTransform(scrollYProgress, [0, 0.26, 0.82, 1], [0.92, 1, 1, 0.92]);

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const openStart = 0.3;
    const openEnd = 0.8;
    const span = (openEnd - openStart) / steps.length;
    const idx = clamp(Math.floor((v - openStart) / span), 0, steps.length - 1);
    setActiveStep(idx);
  });

  const step = steps[activeStep];

  return (
    <ScrollStage ref={stageRef}>
      <Sticky>
        <Rig>
          <Lid style={{ rotateX, scale }}>
            <Chassis>
              <Bezel>
                <Notch />
                <Screen>
                  <ScreenInner>
                    <ScreenBadge>STEP {step.n}</ScreenBadge>
                    <Label style={{ marginBottom: '0.5rem', display: 'block' }}>{step.label}</Label>
                    <ScreenTitle>{step.title}</ScreenTitle>
                    <ScreenDesc>{step.desc}</ScreenDesc>
                    <Dots>
                      {steps.map((s, i) => (
                        <Dot key={s.n} $active={i === activeStep} />
                      ))}
                    </Dots>
                  </ScreenInner>
                </Screen>
              </Bezel>
            </Chassis>
          </Lid>
          <Base>
            <KeyboardDeck />
            <Trackpad />
          </Base>
        </Rig>
      </Sticky>
    </ScrollStage>
  );
};

/* ---------- section ---------- */

const HowItWorks = () => {
  const isDesktop = useIsDesktop();

  return (
    <Wrap id="how-it-works">
      <Head>
        <div>
          <ScrollReveal>
            <LabelRow>
              <span className="bar" />
              <Label>How it works</Label>
            </LabelRow>
          </ScrollReveal>
          <ScrollReveal delay={0.08}>
            <Title>
              three steps between you
              <br />
              and a shortlist you trust
            </Title>
          </ScrollReveal>
        </div>
        <ScrollReveal delay={0.16}>
          <Button as={Link} to="/signup" variant="ghost" size="sm">
            Build your question set
          </Button>
        </ScrollReveal>
      </Head>

      {isDesktop ? <MacbookSteps /> : <StepGrid />}
    </Wrap>
  );
};

export default HowItWorks;
