import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { motion, AnimatePresence, useScroll, useTransform, useMotionValueEvent } from 'framer-motion';
import ScrollReveal from '../ui/ScrollReveal';
import Button from '../ui/Button';
import Iphone from '../ui/Iphone';
import Ipad from '../ui/Ipad';

const steps = [
  {
    n: '01',
    label: 'Your questions',
    title: 'build your question set',
    desc: 'Pick from Khoj\'s question bank — rent, deposit, food policy — or write your own. Up to 15 in total.',
  },
  {
    n: '02',
    label: 'The match',
    title: 'khoj checks the listings',
    desc: 'It scans your listing sites, or ours by default, and only calls when a listing already answers most of what you asked.',
  },
  {
    n: '03',
    label: 'The call',
    title: 'verified, live',
    desc: 'Discloses it\'s AI, asks when and in which language, then runs your questions and logs every answer.',
  },
];

const TABLET_BREAKPOINT = 640;
const DESKTOP_BREAKPOINT = 861;

const getDeviceTier = () => {
  if (typeof window === 'undefined') return 'desktop';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const w = window.innerWidth;
  if (w >= DESKTOP_BREAKPOINT && !reduceMotion) return 'desktop';
  if (w >= TABLET_BREAKPOINT) return 'tablet';
  return 'phone';
};

const useDeviceTier = () => {
  const [tier, setTier] = useState(getDeviceTier);

  useEffect(() => {
    const desktopMq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const tabletMq = window.matchMedia(`(min-width: ${TABLET_BREAKPOINT}px)`);
    const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setTier(getDeviceTier());
    update();
    desktopMq.addEventListener('change', update);
    tabletMq.addEventListener('change', update);
    reduceMq.addEventListener('change', update);
    return () => {
      desktopMq.removeEventListener('change', update);
      tabletMq.removeEventListener('change', update);
      reduceMq.removeEventListener('change', update);
    };
  }, []);

  return tier;
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

/* ---------- mobile & tablet / click-driven device ---------- */

const PhoneLayout = styled.div`
  max-width: 420px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2.25rem;
`;

const PhoneStage = styled.div`
  width: ${({ $width }) => $width};
`;

const PhoneScreenInner = styled.button`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: ${({ $lg }) => ($lg ? '2.4rem' : '1.1rem')};
  background: none;
  border: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
`;

const PhoneBadge = styled.span`
  display: inline-block;
  font-family: 'IBM Plex Mono', monospace;
  font-size: ${({ $lg }) => ($lg ? '0.72rem' : '0.52rem')};
  letter-spacing: 0.1em;
  color: ${({ theme }) => theme.muted};
  border: 1px solid ${({ theme }) => theme.rule2};
  border-radius: 2px;
  padding: ${({ $lg }) => ($lg ? '0.3rem 0.6rem' : '0.2rem 0.4rem')};
  margin-bottom: ${({ $lg }) => ($lg ? '1rem' : '0.75rem')};
`;

const PhoneTitle = styled.h3`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: ${({ $lg }) => ($lg ? '1.7rem' : '1.02rem')};
  line-height: 1.25;
  letter-spacing: -0.01em;
  margin: ${({ $lg }) => ($lg ? '0 0 0.9rem' : '0 0 0.5rem')};
  color: ${({ theme }) => theme.ink};
`;

const PhoneDesc = styled.p`
  color: ${({ theme }) => theme.ink2};
  font-size: ${({ $lg }) => ($lg ? '1rem' : '0.7rem')};
  line-height: 1.55;
  max-width: ${({ $lg }) => ($lg ? '34ch' : 'none')};
  margin: 0 auto;
`;

const TapHint = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: ${({ $lg }) => ($lg ? '0.68rem' : '0.56rem')};
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  margin-top: ${({ $lg }) => ($lg ? '2.2rem' : '1.5rem')};
`;

const DeviceSteps = ({ Frame, stageWidth, large }) => {
  const [activeStep, setActiveStep] = useState(0);
  const step = steps[activeStep];

  const advance = () => setActiveStep((i) => (i + 1) % steps.length);

  return (
    <PhoneLayout>
      <ScrollReveal>
        <PhoneStage $width={stageWidth}>
          <Frame>
            <PhoneScreenInner type="button" $lg={large} onClick={advance} aria-label="Show next step">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step.n}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <PhoneBadge $lg={large}>STEP {step.n}</PhoneBadge>
                  <Label style={{ marginBottom: '0.4rem', display: 'block' }}>{step.label}</Label>
                  <PhoneTitle $lg={large}>{step.title}</PhoneTitle>
                  <PhoneDesc $lg={large}>{step.desc}</PhoneDesc>
                  <Dots>
                    {steps.map((s, i) => (
                      <Dot key={s.n} $active={i === activeStep} />
                    ))}
                  </Dots>
                </motion.div>
              </AnimatePresence>
              <TapHint $lg={large}>Tap to see the next step</TapHint>
            </PhoneScreenInner>
          </Frame>
        </PhoneStage>
      </ScrollReveal>
    </PhoneLayout>
  );
};

const PhoneSteps = () => <DeviceSteps Frame={Iphone} stageWidth="min(228px, 58vw)" />;

const TabletSteps = () => <DeviceSteps Frame={Ipad} stageWidth="min(460px, 62vw)" large />;

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
  display: inline-block;
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
  const tier = useDeviceTier();

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

      {tier === 'desktop' ? <MacbookSteps /> : tier === 'tablet' ? <TabletSteps /> : <PhoneSteps />}
    </Wrap>
  );
};

export default HowItWorks;
