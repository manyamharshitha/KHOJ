import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import PasswordInput from '../components/ui/PasswordInput';
import Loader from '../components/ui/Loader';
import Globe from '../components/ui/Globe';
import { signInWithGoogle, signUpWithEmail } from '../lib/authApi';
import {
  Shell,
  BrandPanel,
  BrandNoise,
  BrandStars,
  BrandMark,
  BrandCenter,
  BrandGlow,
  BrandGlobe,
  BrandWordmark,
  BrandTagline,
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
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status === 'loading') return;
    setStatus('loading');
    setError('');

    const result = await signUpWithEmail(name, email, password);
    if (result.error) {
      setError(result.error);
      setStatus('idle');
      return;
    }
    setStatus('done');
    navigate('/dashboard');
  };

  const handleGoogle = async () => {
    if (status === 'loading') return;
    setStatus('loading');
    setError('');

    const result = await signInWithGoogle();
    if (result.error) {
      setError(result.error);
      setStatus('idle');
      return;
    }
    setStatus('done');
    navigate('/dashboard');
  };

  return (
    <Shell>
      <BrandPanel>
        <BrandNoise />
        <BrandStars />
        <BrandMark to="/">khoj</BrandMark>
        <BrandCenter>
          <BrandGlow />
          <BrandGlobe>
            <Globe />
          </BrandGlobe>
          <BrandWordmark>khoj</BrandWordmark>
          <BrandTagline>Where families belong</BrandTagline>
        </BrandCenter>
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
              <Input
                id="signup-name"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                full
                required
              />
            </Field>
            <Field>
              <label htmlFor="signup-email">Email</label>
              <Input
                id="signup-email"
                type="email"
                placeholder="yourname@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                full
                required
              />
            </Field>
            <Field>
              <label htmlFor="signup-phone">
                Phone number <span style={{ opacity: 0.7 }}>(optional)</span>
              </label>
              <Input id="signup-phone" type="tel" placeholder="Your number (optional)" full />
            </Field>
            <Field>
              <label htmlFor="signup-password">Password</label>
              <PasswordInput
                id="signup-password"
                placeholder="At least 8 characters"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
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
            {error && <Feedback $tone="bad">{error}</Feedback>}
          </form>

          <Divider>or sign up with</Divider>

          <SocialButton type="button" onClick={handleGoogle} disabled={status === 'loading'}>
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
