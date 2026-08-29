import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import PasswordInput from '../components/ui/PasswordInput';
import Loader from '../components/ui/Loader';
import {
  Shell,
  BrandPanel,
  BrandNoise,
  BrandWatermark,
  BrandMark,
  BrandQuote,
  BrandCite,
  Trust,
  FormPanel,
  FormCard,
  MobileMark,
  Kicker,
  Title,
  Sub,
  Field,
  Row,
  Divider,
  SocialButton,
  Foot,
  Feedback,
  GoogleIcon,
} from '../components/layout/AuthLayout';

const Signup = () => {
  const [status, setStatus] = useState('idle');
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (status === 'loading') return;
    setStatus('loading');
    window.setTimeout(() => {
      setStatus('done');
      window.setTimeout(() => navigate('/dashboard'), 700);
    }, 1400);
  };

  return (
    <Shell>
      <BrandPanel>
        <BrandNoise />
        <BrandWatermark>khoj</BrandWatermark>
        <BrandMark to="/">khoj</BrandMark>
        <div>
          <Trust />
          <BrandQuote>Pick your questions. Khoj checks the listings and calls the ones that qualify.</BrandQuote>
          <BrandCite>Where families belong</BrandCite>
        </div>
      </BrandPanel>

      <FormPanel>
        <FormCard>
          <MobileMark to="/">khoj</MobileMark>
          <Kicker>Create account</Kicker>
          <Title>Start your first search</Title>
          <Sub>Free to try — no card required.</Sub>

          <form onSubmit={handleSubmit}>
            <Field>
              <label htmlFor="signup-name">Full name</label>
              <Input id="signup-name" type="text" placeholder="Your name" full required />
            </Field>
            <Field>
              <label htmlFor="signup-email">Email</label>
              <Input id="signup-email" type="email" placeholder="yourname@gmail.com" full required />
            </Field>
            <Field>
              <label htmlFor="signup-phone">
                Phone number <span style={{ opacity: 0.7 }}>(optional)</span>
              </label>
              <Input id="signup-phone" type="tel" placeholder="Your number (optional)" full />
            </Field>
            <Field>
              <label htmlFor="signup-password">Password</label>
              <PasswordInput id="signup-password" placeholder="At least 8 characters" minLength={8} required />
            </Field>

            <Row>
              <input id="signup-terms" type="checkbox" required />
              <label htmlFor="signup-terms">
                I agree to Khoj's{' '}
                <a href="/terms" target="_blank" rel="noreferrer">
                  Terms
                </a>{' '}
                and{' '}
                <a href="/privacy" target="_blank" rel="noreferrer">
                  Privacy Policy
                </a>
                .
              </label>
            </Row>

            <Button type="submit" full disabled={status === 'loading'}>
              {status === 'loading' ? 'Creating account…' : 'Create account'}
            </Button>
            {status === 'loading' && (
              <Feedback>
                <Loader inline />
              </Feedback>
            )}
            {status === 'done' && <Feedback>You're in — taking you to your dashboard.</Feedback>}
          </form>

          <Divider>or sign up with</Divider>

          <SocialButton type="button">
            <GoogleIcon />
            Continue with Google
          </SocialButton>

          <Foot>
            Already have an account? <Link to="/login">Log in</Link>
          </Foot>
        </FormCard>
      </FormPanel>
    </Shell>
  );
};

export default Signup;
