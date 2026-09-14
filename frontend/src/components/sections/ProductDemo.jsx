/**
 * The walkthrough video on the home page.
 *
 * The video is served from the site itself (public/media), compressed to 720p
 * with its index at the front of the file, so it starts playing before the
 * whole ~5 MB has arrived and Vercel serves it with range requests like any
 * other static file.
 *
 * Nothing downloads until someone presses play. preload="none" means the page
 * fetches only the poster image; on a landing page most visitors scroll past,
 * so the video should cost them nothing. The frame is the play button — a big
 * target, one tab stop — and the native controls appear once it has started.
 *
 * The frame keeps a 16:9 shape at every width, so the video fills a phone
 * screen edge to edge and caps at 1100px on a desktop. playsInline stops iOS
 * from forcing fullscreen the moment it starts.
 *
 * If VITE_DEMO_VIDEO_URL holds a YouTube link, a "Watch on YouTube" link sits
 * under the player for anyone who would rather watch it there.
 */

import { useRef, useState } from 'react';
import styled from 'styled-components';
import ScrollReveal from '../ui/ScrollReveal';
import { youtubeId } from '../../lib/youtube';

const VIDEO_SRC = '/media/khoj-walkthrough.mp4';
const POSTER_SRC = '/media/khoj-walkthrough-poster.jpg';
const YOUTUBE_ID = youtubeId(import.meta.env.VITE_DEMO_VIDEO_URL);

const Wrap = styled.section`
  padding: 2rem 6vw 7rem;
  background: ${({ theme }) => theme.bg};

  @media (max-width: 760px) {
    padding: 1.5rem 4vw 4.5rem;
  }
`;

const Head = styled.div`
  max-width: 560px;
  margin: 0 auto 2.25rem;
  text-align: center;

  @media (max-width: 760px) {
    margin-bottom: 1.5rem;
  }
`;

const LabelRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
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
  font-size: clamp(1.35rem, 2.8vw, 2.15rem);
  line-height: 1.2;
  letter-spacing: -0.02em;
  margin: 0;
  color: ${({ theme }) => theme.ink};
`;

const Frame = styled.div`
  max-width: 1100px;
  margin: 0 auto;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: ${({ theme }) => theme.shadowLg};
  border: 1px solid ${({ theme }) => theme.rule};
  position: relative;
  background: ${({ theme }) => (theme.name === 'dark' ? theme.surface2 : theme.bgAlt)};

  video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  @media (max-width: 760px) {
    border-radius: 6px;
  }
`;

const Center = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.1rem;

  @media (max-width: 760px) {
    gap: 0.7rem;
  }
`;

const PlayButton = styled.div`
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.rule2};
  box-shadow: ${({ theme }) => theme.shadow};
  transition: transform 0.25s ease, box-shadow 0.25s ease;

  svg {
    width: 15px;
    height: 15px;
    margin-left: 2px;
    fill: ${({ theme }) => theme.ink};
  }

  @media (max-width: 760px) {
    width: 3rem;
    height: 3rem;

    svg {
      width: 12px;
      height: 12px;
    }
  }
`;

/** Covers the video until the first play, so the whole frame is the button. */
const Cover = styled.button`
  position: absolute;
  inset: 0;
  width: 100%;
  padding: 0;
  border: 0;
  cursor: pointer;
  background: transparent;

  /* The poster is a light title card, so only a faint shade; the caption
     carries its own dark pill to stay readable on any frame. */
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(10, 12, 14, 0), rgba(10, 12, 14, 0.12));
  }

  ${Center} {
    z-index: 1;
  }

  &:hover ${PlayButton}, &:focus-visible ${PlayButton} {
    transform: scale(1.06);
    box-shadow: ${({ theme }) => theme.shadowLg};
  }

  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.accent};
    outline-offset: -4px;
  }
`;

const OnCover = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #f4f6f8;
  background: rgba(17, 17, 16, 0.78);
  padding: 0.45rem 0.85rem;
  border-radius: 999px;

  @media (max-width: 760px) {
    font-size: 0.58rem;
    padding: 0.35rem 0.7rem;
  }
`;

const Below = styled.p`
  max-width: 1100px;
  margin: 0.9rem auto 0;
  text-align: right;

  a {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${({ theme }) => theme.muted};
    text-decoration: none;
  }
  a:hover {
    color: ${({ theme }) => theme.ink};
  }
`;

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 4.5v15l13-7.5-13-7.5z" />
  </svg>
);

const ProductDemo = () => {
  const videoRef = useRef(null);
  const [started, setStarted] = useState(false);

  // play() is called inside the click, so mobile browsers count it as the
  // user's own gesture and allow sound. A refused play still reveals the
  // native controls, so the visitor can press play there instead.
  const start = () => {
    setStarted(true);
    videoRef.current?.play().catch(() => {});
  };

  return (
    <Wrap id="demo">
      <Head>
        <LabelRow>
          <span className="bar" />
          <Label>See it in action</Label>
          <span className="bar" />
        </LabelRow>
        <Title>A real Khoj run, from sign-in to the broker’s answers.</Title>
      </Head>
      <ScrollReveal>
        <Frame>
          <video
            ref={videoRef}
            src={VIDEO_SRC}
            poster={POSTER_SRC}
            preload="none"
            playsInline
            controls={started}
            onPlay={() => setStarted(true)}
            aria-label="Khoj walkthrough video"
          >
            Your browser can’t play this video.
          </video>
          {!started && (
            <Cover type="button" onClick={start} aria-label="Play the Khoj walkthrough video">
              <Center>
                <PlayButton>
                  <PlayIcon />
                </PlayButton>
                <OnCover>Watch the walkthrough · 3 min</OnCover>
              </Center>
            </Cover>
          )}
        </Frame>
      </ScrollReveal>
      {YOUTUBE_ID && (
        <Below>
          <a href={`https://www.youtube.com/watch?v=${YOUTUBE_ID}`} target="_blank" rel="noopener noreferrer">
            Watch on YouTube ↗
          </a>
        </Below>
      )}
    </Wrap>
  );
};

export default ProductDemo;
