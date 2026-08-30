import styled from 'styled-components';
import ScrollReveal from '../ui/ScrollReveal';

const stats = [
  {
    label: 'Match threshold',
    num: '11/15',
    cap: 'How many of your questions a listing already answers before Khoj dials.',
  },
  {
    label: 'Listing sources',
    num: '2–3',
    cap: 'Checked by default — plus any site you add yourself.',
  },
  {
    label: 'Answers invented',
    num: '0',
    cap: 'Unsaid stays blank. Nothing is ever guessed.',
  },
];

const Wrap = styled.section`
  border-top: 1px solid ${({ theme }) => theme.rule};
  border-bottom: 1px solid ${({ theme }) => theme.rule};
  background: ${({ theme }) => theme.bg};
`;

const Grid = styled.div`
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 6vw;
  display: grid;
  grid-template-columns: repeat(3, 1fr);

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const Stat = styled.div`
  padding: 3.5rem 0;

  & + & {
    border-left: 1px solid ${({ theme }) => theme.rule};
    padding-left: 3rem;
  }

  @media (max-width: 760px) {
    & + & {
      border-left: none;
      border-top: 1px solid ${({ theme }) => theme.rule};
      padding-left: 0;
    }
  }
`;

const Label = styled.span`
  display: block;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.64rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  margin-bottom: 1rem;
`;

const Num = styled.div`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(2.4rem, 5vw, 3.8rem);
  line-height: 1;
  letter-spacing: -0.02em;
  color: ${({ theme }) => theme.ink};
`;

const Cap = styled.p`
  margin-top: 0.8rem;
  color: ${({ theme }) => theme.muted};
  font-size: 0.82rem;
  line-height: 1.55;
  max-width: 32ch;
`;

const Principles = () => (
  <Wrap>
    <Grid>
      {stats.map((s, i) => (
        <ScrollReveal key={s.label} delay={i * 0.08}>
          <Stat>
            <Label>{s.label}</Label>
            <Num>{s.num}</Num>
            <Cap>{s.cap}</Cap>
          </Stat>
        </ScrollReveal>
      ))}
    </Grid>
  </Wrap>
);

export default Principles;
