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
  Divider,
  SocialButton,
  Foot,
  Feedback,
  GoogleIcon,
} from '../components/layout/AuthLayout';

const Login = () => {
  const [status, setStatus] = useState('idle');
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (status === 'loading') return;
    setStatus('loading');
    window.setTimeout(() => {
      setStatus('done');
      window.setTimeout(() => navigate('/dashboard'), 700);
    }, 1200);
  };

  return (
    <Shell>
      <BrandPanel>
        <BrandNoise />
        <BrandWatermark>khoj</BrandWatermark>
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
              <Input id="login-email" type="email" placeholder="yourname@gmail.com" full required />
            </Field>
            <Field>
              <label htmlFor="login-password">
                Password
                <Link to="/forgot-password">Forgot password?</Link>
              </label>
              <PasswordInput id="login-password" placeholder="Your password" required />
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
          </form>

          <Divider>or log in with</Divider>

          <SocialButton type="button">
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
