import styled from 'styled-components';
import ScrollReveal from '../ui/ScrollReveal';

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

  svg {
    width: 15px;
    height: 15px;
    margin-left: 2px;
    fill: ${({ theme }) => theme.ink};
  }
`;

const ComingSoon = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
`;

const ProductDemo = () => (
  <Wrap>
    <Head>
      <LabelRow>
        <span className="bar" />
        <Label>See it in action</Label>
        <span className="bar" />
      </LabelRow>
      <Title>A minute inside a real Khoj run.</Title>
    </Head>
    <ScrollReveal>
      <Frame>
        <Pattern />
        <Center>
          <PlayButton>
            <svg viewBox="0 0 24 24">
              <path d="M6 4.5v15l13-7.5-13-7.5z" />
            </svg>
          </PlayButton>
          <ComingSoon>Walkthrough video — coming soon</ComingSoon>
        </Center>
      </Frame>
    </ScrollReveal>
  </Wrap>
);

export default ProductDemo;
