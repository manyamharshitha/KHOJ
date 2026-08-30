import styled from 'styled-components';
import ScrollReveal from '../ui/ScrollReveal';
import { photos } from '../../data/photos';

const Wrap = styled.section`
  height: 70vh;
  min-height: 420px;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
`;

const Img = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const BandOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(10, 18, 26, 0.6), rgba(10, 18, 26, 0.2));
`;

const Inner = styled.div`
  position: relative;
  z-index: 2;
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 6vw;
  width: 100%;
`;

const Quote = styled.blockquote`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(1.3rem, 2.8vw, 2.1rem);
  line-height: 1.35;
  letter-spacing: -0.01em;
  color: ${({ theme }) => theme.onDark};
  max-width: 20ch;
  margin: 0;
`;

const Cite = styled.cite`
  display: block;
  margin-top: 1.6rem;
  font-style: normal;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  color: ${({ theme }) => theme.onDark2};
  text-transform: uppercase;
`;

const EditorialBand = () => (
  <Wrap>
    <Img src={photos.aerialNeighborhood} alt="An aerial view of a residential neighbourhood" />
    <BandOverlay />
    <Inner>
      <ScrollReveal>
        <Quote>A listing can match every question on paper. Only a call confirms it's still true.</Quote>
        <Cite>The problem Khoj was built for</Cite>
      </ScrollReveal>
    </Inner>
  </Wrap>
);

export default EditorialBand;
