import { useState } from 'react';
import styled from 'styled-components';
import ScrollReveal from '../ui/ScrollReveal';
import Button from '../ui/Button';
import Loader from '../ui/Loader';
import { photos } from '../../data/photos';

const Wrap = styled.section`
  position: relative;
  overflow: hidden;
`;

const Media = styled.div`
  position: absolute;
  inset: 0;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(8, 14, 20, 0.55), rgba(8, 14, 20, 0.78));
  }
`;

const Inner = styled.div`
  position: relative;
  z-index: 2;
  padding: 7.5rem 6vw;
`;

const Grid = styled.div`
  max-width: 1280px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4.4rem;
  align-items: start;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
    gap: 2.75rem;
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
    background: rgba(255, 255, 255, 0.4);
  }
`;

const Label = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.64rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.onDark2};
`;

const Title = styled.h2`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(1.6rem, 3vw, 2.35rem);
  line-height: 1.15;
  letter-spacing: -0.02em;
  margin: 0;
  color: ${({ theme }) => theme.onDark};
`;

const Copy = styled.p`
  margin-top: 1.3rem;
  color: ${({ theme }) => theme.onDark2};
  font-size: 0.92rem;
  line-height: 1.65;
  max-width: 36ch;
`;

const Field = styled.div`
  margin-bottom: 1.4rem;

  label {
    display: block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: ${({ theme }) => theme.onDark2};
    margin-bottom: 0.6rem;
  }

  input,
  textarea {
    width: 100%;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 2px;
    padding: 0.85rem 1rem;
    color: ${({ theme }) => theme.onDark};
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    outline: none;
    transition: 0.3s ease;
    resize: vertical;
  }

  input:focus,
  textarea:focus {
    border-color: #ffffff;
    background: rgba(255, 255, 255, 0.1);
  }

  input::placeholder,
  textarea::placeholder {
    color: rgba(244, 246, 248, 0.4);
  }
`;

const Feedback = styled.div`
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-top: 1rem;
  font-size: 0.88rem;
  color: ${({ theme }) => theme.onDark};
`;

const Contact = () => {
  const [status, setStatus] = useState('idle');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (status === 'loading') return;
    setStatus('loading');
    window.setTimeout(() => setStatus('done'), 1400);
  };

  return (
    <Wrap id="contact">
      <Media>
        <img src={photos.duskInteriorWide} alt="A warm home interior at dusk" />
      </Media>
      <Inner>
        <Grid>
          <ScrollReveal direction="left">
            <div>
              <LabelRow>
                <span className="bar" />
                <Label>Start free</Label>
              </LabelRow>
              <Title>
                find a home
                <br />
                worth keeping
              </Title>
              <Copy>Set your questions, add a listing, and hear Khoj place one real, verified call — free.</Copy>
            </div>
          </ScrollReveal>

          <ScrollReveal direction="right" delay={0.1}>
            <form onSubmit={handleSubmit}>
              <Field>
                <label htmlFor="contact-name">Name</label>
                <input id="contact-name" type="text" placeholder="Your name" required />
              </Field>
              <Field>
                <label htmlFor="contact-email">Email</label>
                <input id="contact-email" type="email" placeholder="yourname@gmail.com" required />
              </Field>
              <Field>
                <label htmlFor="contact-brief">What are you looking for?</label>
                <textarea
                  id="contact-brief"
                  rows={3}
                  placeholder="2BHK in Kondapur, under ₹35k, family, move-in October…"
                />
              </Field>
              <Button type="submit" variant="light" full disabled={status === 'loading'}>
                {status === 'loading' ? 'Sending…' : 'Start my free trial'}
              </Button>
              {status === 'loading' && (
                <Feedback>
                  <Loader inline />
                </Feedback>
              )}
              {status === 'done' && <Feedback>You're in — check your inbox to start your first run.</Feedback>}
            </form>
          </ScrollReveal>
        </Grid>
      </Inner>
    </Wrap>
  );
};

export default Contact;
