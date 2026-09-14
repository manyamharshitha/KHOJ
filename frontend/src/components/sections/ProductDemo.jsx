/**
 * The walkthrough video on the home page.
 *
 * The video lives on YouTube, never in this repository or on Vercel. A few
 * minutes of 1080p is tens to hundreds of megabytes; committed, it bloats every
 * clone for good, and deployed, it counts against the build and is served by a
 * CDN that was not built for streaming. YouTube streams at whatever bitrate the
 * viewer's connection can hold, which is the whole problem solved elsewhere.
 *
 * The link comes from VITE_DEMO_VIDEO_URL, so replacing the video is a setting
 * in Vercel and a redeploy — no code change. Until it is set, or if it is not a
 * YouTube link, the "coming soon" frame stays exactly as it was: a malformed
 * value must never produce a broken player on the landing page.
 *
 * Nothing from YouTube loads until someone presses play. The embedded player
 * pulls in roughly a megabyte of script and a pile of third-party requests; on
 * a landing page most visitors scroll past, that is a slower first paint for
 * everybody to benefit the few who watch. So the page shows a still thumbnail
 * and a real button, and swaps in the player on click — from the no-cookie
 * domain, so an unplayed video sets nothing in the visitor's browser.
 */

import { useState } from 'react';
import styled from 'styled-components';
import ScrollReveal from '../ui/ScrollReveal';
import { youtubeId } from '../../lib/youtube';

const VIDEO_ID = youtubeId(import.meta.env.VITE_DEMO_VIDEO_URL);

const Wrap = styled.section`
  padding: 2rem 6vw 7rem;
  background: ${({ theme }) => theme.bg};
`;

const Head = styled.div`
  max-width: 560px;
  margin: 0 auto 2.25rem;
  text-align: center;
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
  font-size: clamp(1.6rem, 2.8vw, 2.15rem);
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

  iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }
`;

const Pattern = styled.div`
  position: absolute;
  inset: 0;
  background-image: radial-gradient(${({ theme }) => theme.rule2} 1px, transparent 1px);
  background-size: 28px 28px;
  opacity: 0.6;
`;

const Center = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.1rem;
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
`;

/** The whole frame is the button: a bigger target, and one tab stop. */
const Poster = styled.button`
  position: absolute;
  inset: 0;
  width: 100%;
  padding: 0;
  border: 0;
  cursor: pointer;
  background: transparent;

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Darken the thumbnail just enough for the button to read on any frame. */
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(10, 12, 14, 0.05), rgba(10, 12, 14, 0.35));
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

const Caption = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
`;

const OnPoster = styled(Caption)`
  color: #f4f6f8;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.45);
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
  const [playing, setPlaying] = useState(false);

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
          {!VIDEO_ID && (
            <>
              <Pattern />
              <Center>
                <PlayButton>
                  <PlayIcon />
                </PlayButton>
                <Caption>Walkthrough video — coming soon</Caption>
              </Center>
            </>
          )}

          {VIDEO_ID && !playing && (
            <Poster type="button" onClick={() => setPlaying(true)} aria-label="Play the Khoj walkthrough video">
              <Pattern />
              <img
                src={`https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`}
                alt=""
                loading="lazy"
                decoding="async"
                // A blocked or missing thumbnail leaves the dotted frame and
                // the button, not a broken-image glyph.
                onError={(e) => {
                  e.currentTarget.hidden = true;
                }}
              />
              <Center>
                <PlayButton>
                  <PlayIcon />
                </PlayButton>
                <OnPoster>Watch the walkthrough</OnPoster>
              </Center>
            </Poster>
          )}

          {VIDEO_ID && playing && (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0`}
              title="Khoj walkthrough video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          )}
        </Frame>
      </ScrollReveal>
      {VIDEO_ID && (
        <Below>
          <a href={`https://www.youtube.com/watch?v=${VIDEO_ID}`} target="_blank" rel="noopener noreferrer">
            Watch on YouTube ↗
          </a>
        </Below>
      )}
    </Wrap>
  );
};

export default ProductDemo;
