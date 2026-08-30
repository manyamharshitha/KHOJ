import { Link } from 'react-router-dom';
import styled from 'styled-components';
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

const HowItWorks = () => (
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
  </Wrap>
);

export default HowItWorks;
