import { useState } from 'react';
import styled from 'styled-components';
import ScrollReveal from '../ui/ScrollReveal';
import LinkUnderline from '../ui/LinkUnderline';

const faqs = [
  {
    q: 'does khoj pretend to be a human?',
    a: "No — it opens every call by saying it's an AI, then asks if it's a good time or if you'd rather it call back later.",
  },
  {
    q: 'how does khoj find listings to call?',
    a: 'It checks your listing sources — ours by default, or your own — and calls the broker behind any listing that already matches enough of your questions.',
  },
  {
    q: 'what does it actually ask?',
    a: "Whatever you pick. Choose from Khoj's question bank or write your own — higher plans unlock more custom questions.",
  },
  {
    q: 'can i choose the language?',
    a: "Yes. Khoj asks the broker's preference up front, and currently speaks a couple of languages besides English.",
  },
  {
    q: 'can i see the actual conversation?',
    a: 'Yes — every result links to the transcript and recording behind it, so you can check before deciding.',
  },
];

const Wrap = styled.section`
  padding: 7rem 6vw;
  background: ${({ theme }) => theme.bg};
`;

const Grid = styled.div`
  max-width: 1280px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 0.85fr 1.15fr;
  gap: 4.4rem;
  align-items: start;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
    gap: 2.25rem;
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
  margin: 0 0 1.1rem;
  color: ${({ theme }) => theme.ink};
`;

const IntroCopy = styled.p`
  color: ${({ theme }) => theme.ink2};
  font-size: 0.92rem;
  line-height: 1.65;
  max-width: 38ch;
  margin: 0 0 1.5rem;
`;

const List = styled.div`
  border-top: 1px solid ${({ theme }) => theme.rule};
`;

const Item = styled.div`
  border-bottom: 1px solid ${({ theme }) => theme.rule};
`;

const QRow = styled.button`
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 1.4rem;
  padding: 1.6rem 0;
  color: ${({ theme }) => theme.ink};
`;

const FNum = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.72rem;
  color: ${({ theme }) => theme.muted};
  flex: none;
`;

const QText = styled.span`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(1rem, 1.7vw, 1.2rem);
  letter-spacing: -0.01em;
  flex: 1;
`;

const Plus = styled.span`
  position: relative;
  width: 16px;
  height: 16px;
  flex: none;

  &::before,
  &::after {
    content: '';
    position: absolute;
    background: ${({ theme }) => theme.ink};
    transition: 0.3s ease;
  }
  &::before {
    top: 7px;
    left: 0;
    width: 16px;
    height: 1.5px;
  }
  &::after {
    top: 0;
    left: 7px;
    width: 1.5px;
    height: 16px;
    transform: ${({ $open }) => ($open ? 'rotate(90deg)' : 'rotate(0deg)')};
    opacity: ${({ $open }) => ($open ? 0 : 1)};
  }
`;

const ARow = styled.div`
  display: grid;
  grid-template-rows: ${({ $open }) => ($open ? '1fr' : '0fr')};
  transition: grid-template-rows 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);

  div {
    overflow: hidden;
  }

  p {
    margin: 0;
    padding: 0 0 1.75rem 2.6rem;
    font-size: 0.88rem;
    line-height: 1.65;
    color: ${({ theme }) => theme.ink2};
    max-width: 56ch;
  }

  @media (max-width: 760px) {
    p {
      padding-left: 0;
    }
  }
`;

const FaqSection = () => {
  const [open, setOpen] = useState(0);

  return (
    <Wrap id="faq">
      <Grid>
        <ScrollReveal direction="left">
          <div>
            <LabelRow>
              <span className="bar" />
              <Label>FAQ</Label>
            </LabelRow>
            <Title>
              questions
              <br />
              &amp; answers
            </Title>
            <IntroCopy>What people ask before their first run. Don't see yours? Reach out.</IntroCopy>
            <LinkUnderline href="#contact">Get in touch</LinkUnderline>
          </div>
        </ScrollReveal>

        <ScrollReveal direction="right" delay={0.1}>
          <List>
            {faqs.map((item, i) => {
              const isOpen = open === i;
              return (
                <Item key={item.q}>
                  <QRow onClick={() => setOpen(isOpen ? -1 : i)}>
                    <FNum>{String(i + 1).padStart(2, '0')}</FNum>
                    <QText>{item.q}</QText>
                    <Plus $open={isOpen} />
                  </QRow>
                  <ARow $open={isOpen}>
                    <div>
                      <p>{item.a}</p>
                    </div>
                  </ARow>
                </Item>
              );
            })}
          </List>
        </ScrollReveal>
      </Grid>
    </Wrap>
  );
};

export default FaqSection;
