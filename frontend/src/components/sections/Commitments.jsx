import styled from 'styled-components';
import ScrollReveal from '../ui/ScrollReveal';

const items = [
  {
    n: '01',
    title: 'honest disclosure',
    desc: 'Every call opens by naming itself: an AI, calling on your behalf.',
  },
  {
    n: '02',
    title: 'asks first',
    desc: "Always checks it's a good time — or offers to call back later.",
  },
  {
    n: '03',
    title: 'your language',
    desc: "Runs the call in whichever language the broker's comfortable in.",
  },
  {
    n: '04',
    title: 'never guessed',
    desc: 'Unsaid stays blank. A wrong answer is worse than none.',
  },
  {
    n: '05',
    title: 'full transcripts',
    desc: 'Every answer traces back to its own recording.',
  },
];

const Wrap = styled.section`
  background: ${({ theme }) => theme.bgAlt};
  padding: 7rem 6vw;
`;

const Head = styled.div`
  max-width: 1280px;
  margin: 0 auto 4rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2.5rem;
  align-items: end;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
    gap: 1.25rem;
  }
`;

const LabelRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.2rem;

  .bar {
    width: 28px;
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

const Sub = styled.p`
  color: ${({ theme }) => theme.ink2};
  font-size: 0.9rem;
  line-height: 1.65;
  max-width: 42ch;
  margin: 0;
`;

const Grid = styled.div`
  max-width: 1280px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: ${({ theme }) => theme.rule};
  border: 1px solid ${({ theme }) => theme.rule};

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const Cell = styled.div`
  background: ${({ $dark, theme }) => ($dark ? theme.ink : theme.bg)};
  color: ${({ $dark, theme }) => ($dark ? theme.bg : theme.ink)};
  padding: 2.5rem 2.1rem;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: background-color 0.3s ease;

  &:hover {
    background: ${({ $dark, theme }) => ($dark ? theme.ink : theme.surface)};
  }
`;

const N = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  color: ${({ $dark, theme }) => ($dark ? 'rgba(255,255,255,0.5)' : theme.muted)};
`;

const CellTitle = styled.h4`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: 1.15rem;
  letter-spacing: -0.01em;
  margin: 0 0 0.6rem;
`;

const CellDesc = styled.p`
  font-size: 0.82rem;
  line-height: 1.55;
  margin: 0;
  color: ${({ $dark }) => ($dark ? 'rgba(255,255,255,0.72)' : undefined)};
  opacity: ${({ $dark }) => ($dark ? 1 : 0.85)};
`;

const Commitments = () => (
  <Wrap id="commitments">
    <Head>
      <div>
        <ScrollReveal>
          <LabelRow>
            <span className="bar" />
            <Label>Why Khoj</Label>
          </LabelRow>
        </ScrollReveal>
        <ScrollReveal delay={0.08}>
          <Title>
            we never
            <br />
            compromise on
          </Title>
        </ScrollReveal>
      </div>
      <ScrollReveal delay={0.12}>
        <Sub>Not louder promises — five small commitments, kept on every call.</Sub>
      </ScrollReveal>
    </Head>

    <Grid>
      {items.map((item, i) => (
        <ScrollReveal key={item.n} delay={i * 0.06}>
          <Cell>
            <N>[ {item.n} ]</N>
            <div>
              <CellTitle>{item.title}</CellTitle>
              <CellDesc>{item.desc}</CellDesc>
            </div>
          </Cell>
        </ScrollReveal>
      ))}
      <ScrollReveal delay={items.length * 0.06}>
        <Cell $dark>
          <N $dark>[ · ]</N>
          <div>
            <CellTitle>where families belong</CellTitle>
            <CellDesc $dark>The search should end in a home — not another dead number.</CellDesc>
          </div>
        </Cell>
      </ScrollReveal>
    </Grid>
  </Wrap>
);

export default Commitments;
