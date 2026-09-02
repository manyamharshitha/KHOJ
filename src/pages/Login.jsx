import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import PasswordInput from '../components/ui/PasswordInput';
import Loader from '../components/ui/Loader';
import Globe from '../components/ui/Globe';
import { signInWithEmail, signInWithGoogle } from '../lib/authApi';
import {
  Shell,
  BrandPanel,
  BrandNoise,
  BrandWatermark,
  BrandMark,
  BrandQuote,
  BrandCite,
  GlobeWrap,
  Trust,
  FormPanel,
  FormCard,
  MobileMark,
  Kicker,
  Title,
  Sub,
  Field,
  Divider,
  SocialButton,
  Foot,
  Feedback,
  GoogleIcon,
} from '../components/layout/AuthLayout';

const Login = () => {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status === 'loading') return;
    setStatus('loading');
    setError('');

    const result = await signInWithEmail(email, password);
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
        <BrandWatermark>khoj</BrandWatermark>
        <GlobeWrap>
          <Globe />
        </GlobeWrap>
        <BrandMark to="/">khoj</BrandMark>
        <div>
          <Trust />
          <BrandQuote>Your questions, your listings, your dashboard — right where you left them.</BrandQuote>
          <BrandCite>Where families belong</BrandCite>
        </div>
      </BrandPanel>

      <FormPanel>
        <FormCard>
          <MobileMark to="/">khoj</MobileMark>
          <Kicker>Welcome back</Kicker>
          <Title>Log in to Khoj</Title>
          <Sub>Pick up your search where you left off.</Sub>

          <form onSubmit={handleSubmit}>
            <Field>
              <label htmlFor="login-email">Email</label>
              <Input
                id="login-email"
                type="email"
                placeholder="yourname@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                full
                required
              />
            </Field>
            <Field>
              <label htmlFor="login-password">
                Password
                <Link to="/forgot-password">Forgot password?</Link>
              </label>
              <PasswordInput
                id="login-password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>

            <Button type="submit" full disabled={status === 'loading'}>
              {status === 'loading' ? 'Logging in…' : 'Log in'}
            </Button>
            {status === 'loading' && (
              <Feedback>
                <Loader inline />
              </Feedback>
            )}
            {status === 'done' && <Feedback>Logged in — redirecting to your dashboard.</Feedback>}
            {error && <Feedback $tone="bad">{error}</Feedback>}
          </form>

          <Divider>or log in with</Divider>

          <SocialButton type="button" onClick={handleGoogle} disabled={status === 'loading'}>
            <GoogleIcon />
            Continue with Google
          </SocialButton>

          <Foot>
            New to Khoj? <Link to="/signup">Create an account</Link>
          </Foot>
        </FormCard>
      </FormPanel>
    </Shell>
  );
};

export default Login;
