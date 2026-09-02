import { Link } from 'react-router-dom';
import styled from 'styled-components';

const Wrap = styled.footer`
  background: ${({ theme }) => theme.bg};
  color: ${({ theme }) => theme.ink2};
  border-top: 1px solid ${({ theme }) => theme.rule};
  padding: 4.4rem 6vw 2.5rem;
`;

const Top = styled.div`
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1fr;
  gap: 2.5rem;
  padding-bottom: 3.75rem;
  border-bottom: 1px solid ${({ theme }) => theme.rule};

  @media (max-width: 760px) {
    grid-template-columns: 1fr 1fr;
  }
  @media (max-width: 520px) {
    grid-template-columns: 1fr;
  }
`;

const Brand = styled.div`
  .mark {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 500;
    font-size: 1.6rem;
    letter-spacing: -0.01em;
    color: ${({ theme }) => theme.ink};
  }
  .tag {
    font-family: 'Fraunces', Georgia, serif;
    font-style: italic;
    font-size: 0.9rem;
    color: ${({ theme }) => theme.accentDeep};
    margin-top: 0.25rem;
  }
  p {
    font-size: 0.84rem;
    max-width: 34ch;
    line-height: 1.65;
    margin: 1.2rem 0 0;
    color: ${({ theme }) => theme.muted};
  }
`;

const Col = styled.div`
  h4 {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.64rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${({ theme }) => theme.muted};
    margin: 0 0 1.1rem;
    font-weight: 500;
  }
  a {
    display: block;
    color: ${({ theme }) => theme.ink2};
    text-decoration: none;
    font-size: 0.84rem;
    margin-bottom: 0.75rem;
    transition: color 0.2s ease;
  }
  a:hover {
    color: ${({ theme }) => theme.ink};
  }
`;

const Bottom = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  padding-top: 1.9rem;
  font-size: 0.76rem;
  color: ${({ theme }) => theme.muted};
`;

const LegalLinks = styled.div`
  display: flex;
  gap: 1.2rem;

  a {
    color: ${({ theme }) => theme.muted};
    text-decoration: none;
  }
  a:hover {
    color: ${({ theme }) => theme.ink};
  }
`;

const Footer = () => (
  <Wrap>
    <Top>
      <Brand>
        <div className="mark">khoj</div>
        <div className="tag">Where families belong.</div>
        <p>A voice agent that verifies rental listings by calling brokers — so the search for a home ends in a home.</p>
      </Brand>
      <Col>
        <h4>Product</h4>
        <Link to="/#how-it-works">How it works</Link>
        <Link to="/#commitments">Why Khoj</Link>
        <Link to="/#faq">FAQ</Link>
      </Col>
      <Col>
        <h4>Company</h4>
        <a href="#about">About</a>
        <Link to="/#contact">Contact</Link>
        <Link to="/pricing">Plans</Link>
      </Col>
      <Col>
        <h4>Keep in touch</h4>
        <a href="#">LinkedIn</a>
        <a href="#">GitHub</a>
        <a href="#">Instagram</a>
      </Col>
    </Top>
    <Bottom>
      <span>© {new Date().getFullYear()} Khoj. All rights reserved.</span>
      <LegalLinks>
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
      </LegalLinks>
      <span>Where families belong.</span>
    </Bottom>
  </Wrap>
);

export default Footer;
