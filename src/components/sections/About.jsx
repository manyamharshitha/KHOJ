import styled from 'styled-components';
import ScrollReveal from '../ui/ScrollReveal';
import LinkUnderline from '../ui/LinkUnderline';
import { photos } from '../../data/photos';

const Wrap = styled.section`
  padding: 7rem 6vw;
  background: ${({ theme }) => theme.bg};
`;

const Grid = styled.div`
  max-width: 1280px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5rem;
  align-items: center;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
    gap: 2.75rem;
  }
`;

const Media = styled.div`
  position: relative;
  aspect-ratio: 4 / 3;
  border-radius: 4px;
  overflow: hidden;
  background: ${({ theme }) => theme.surface2};

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 1.1s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  &:hover img {
    transform: scale(1.04);
  }
`;

const LabelRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.4rem;

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

const Lead = styled.p`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: 1.2rem;
  line-height: 1.5;
  color: ${({ theme }) => theme.ink};
  margin: 0 0 1.1rem;
`;

const Copy = styled.p`
  color: ${({ theme }) => theme.ink2};
  font-size: 0.92rem;
  line-height: 1.7;
  max-width: 48ch;
  margin: 0 0 1.3rem;
`;

const About = () => (
  <Wrap id="about">
    <Grid>
      <ScrollReveal direction="left">
        <Media>
          <img src={photos.interiorBright} alt="A calm, sunlit living room" />
        </Media>
      </ScrollReveal>
      <ScrollReveal direction="right" delay={0.1}>
        <div>
          <LabelRow>
            <span className="bar" />
            <Label>What is Khoj</Label>
          </LabelRow>
          <Lead>Khoj is an AI voice agent — built on Call-e — that calls only when a listing already looks right.</Lead>
          <Copy>
            You choose what matters: rent, deposit, food policy, move-in date, anything else. Khoj checks that
            against each listing before it ever dials, then confirms the rest live, on the call.
          </Copy>
          <LinkUnderline href="#how-it-works">See how it works</LinkUnderline>
        </div>
      </ScrollReveal>
    </Grid>
  </Wrap>
);

export default About;
