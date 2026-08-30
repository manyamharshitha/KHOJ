import styled from 'styled-components';

const Wrap = styled.div`
  background: ${({ theme }) => theme.bg};
  padding: 9rem 6vw 6rem;
`;

const Inner = styled.div`
  max-width: 680px;
  margin: 0 auto;
`;

const Kicker = styled.p`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.68rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  margin: 0 0 1.1rem;
`;

const Title = styled.h1`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(2rem, 4vw, 2.8rem);
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 0.9rem;
  color: ${({ theme }) => theme.ink};
`;

const Updated = styled.p`
  font-size: 0.84rem;
  color: ${({ theme }) => theme.muted};
  margin: 0 0 3rem;
  padding-bottom: 2.5rem;
  border-bottom: 1px solid ${({ theme }) => theme.rule};
`;

const Article = styled.article`
  h2 {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 400;
    font-size: 1.35rem;
    letter-spacing: -0.01em;
    color: ${({ theme }) => theme.ink};
    margin: 2.4rem 0 0.9rem;
  }

  h2:first-child {
    margin-top: 0;
  }

  p {
    font-size: 0.94rem;
    line-height: 1.75;
    color: ${({ theme }) => theme.ink2};
    margin: 0 0 1rem;
  }

  ul {
    margin: 0 0 1.1rem;
    padding-left: 1.3rem;
  }

  li {
    font-size: 0.94rem;
    line-height: 1.7;
    color: ${({ theme }) => theme.ink2};
    margin-bottom: 0.5rem;
  }

  strong {
    color: ${({ theme }) => theme.ink};
    font-weight: 600;
  }

  a {
    color: ${({ theme }) => theme.accentDeep};
  }
`;

const Disclaimer = styled.p`
  margin-top: 3.5rem;
  padding-top: 2rem;
  border-top: 1px solid ${({ theme }) => theme.rule};
  font-size: 0.78rem;
  line-height: 1.6;
  color: ${({ theme }) => theme.muted};
`;

const LegalPage = ({ kicker, title, updated, children }) => (
  <Wrap>
    <Inner>
      <Kicker>{kicker}</Kicker>
      <Title>{title}</Title>
      <Updated>Last updated {updated}</Updated>
      <Article>{children}</Article>
      <Disclaimer>
        This document is a draft written for the Khoj demo and hasn't been reviewed by legal counsel. Don't rely
        on it as an actual binding policy.
      </Disclaimer>
    </Inner>
  </Wrap>
);

export default LegalPage;
