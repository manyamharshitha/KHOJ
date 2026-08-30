import styled from 'styled-components';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import Button from '../ui/Button';

const VIDEO_SRC = 'https://videos.pexels.com/video-files/7578546/7578546-uhd_2560_1440_30fps.mp4';
const POSTER_SRC =
  'https://images.pexels.com/videos/7578546/apartment-at-home-business-buy-7578546.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop';

const Wrap = styled.section`
  position: relative;
  height: 100svh;
  min-height: 640px;
  overflow: hidden;
  color: #ffffff;
  background: #0b0c0e;
`;

const Video = styled.video`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
`;

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1;
  background: ${({ theme }) => theme.heroGradient};
`;

const Center = styled.div`
  position: absolute;
  top: 44%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2;
  text-align: center;
  width: 100%;
  padding: 0 6vw;
`;

const TaglineChip = styled(motion.p)`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.66rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.onDark2};
  margin: 0 0 1.2rem;
`;

const Wordmark = styled(motion.h1)`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(3.4rem, 11vw, 8rem);
  line-height: 0.9;
  letter-spacing: -0.02em;
  margin: 0;
  color: ${({ theme }) => theme.onDark};
`;

const Content = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 64px;
  z-index: 2;
  padding: 0 6vw;
`;

const Lower = styled.div`
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 2.5rem;
  align-items: end;
  max-width: 1280px;
  margin: 0 auto;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }
`;

const Statement = styled(motion.p)`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(0.98rem, 1.6vw, 1.15rem);
  line-height: 1.5;
  color: ${({ theme }) => theme.onDark};
  max-width: 32ch;
  margin: 0;
`;

const CtaWrap = styled(motion.div)`
  display: flex;
  justify-content: flex-end;

  @media (max-width: 760px) {
    justify-content: flex-start;
  }
`;

const ScrollHint = styled(motion.button)`
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: ${({ theme }) => theme.onDark2};
  background: none;
  border: none;
  cursor: pointer;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;

  .line {
    width: 1px;
    height: 34px;
    background: currentColor;
  }

  @media (max-width: 760px) {
    display: none;
  }
`;

const Hero = () => (
  <Wrap>
    <Video src={VIDEO_SRC} poster={POSTER_SRC} autoPlay muted loop playsInline />
    <Overlay />

    <Center>
      <TaglineChip initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 1.1 }}>
        Where families belong
      </TaglineChip>
      <Wordmark
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.3, delay: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      >
        khoj
      </Wordmark>
    </Center>

    <Content>
      <Lower>
        <Statement initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.8 }}>
          Set the questions that matter to you. Khoj checks the listings, calls only the ones that qualify —
          and brings back what the broker actually said.
        </Statement>
        <CtaWrap initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 1 }}>
          <Button as={Link} to="/pricing" variant="outlineLight">
            Start your search
          </Button>
        </CtaWrap>
      </Lower>
    </Content>

    <ScrollHint
      onClick={() => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' })}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1, delay: 1.5 }}
      aria-label="Scroll down"
    >
      scroll
      <motion.span
        className="line"
        style={{ transformOrigin: 'top' }}
        animate={{ scaleY: [0.3, 1, 0.3], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
    </ScrollHint>
  </Wrap>
);

export default Hero;
