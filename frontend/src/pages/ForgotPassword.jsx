import { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Loader from '../components/ui/Loader';
import Globe from '../components/ui/Globe';
import { sendReset } from '../lib/authApi';
import {
  Shell,
  BrandPanel,
  BrandNoise,
  BrandStars,
  BrandMark,
  BrandCenter,
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
  Foot,
  Feedback,
} from '../components/layout/AuthLayout';

const ForgotPassword = () => {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status === 'loading') return;
    setStatus('loading');
    setError('');

    const result = await sendReset(email);
    if (result.error) {
      setError(result.error);
      setStatus('idle');
      return;
    }
    setStatus('done');
  };

  return (
    <Shell>
      <BrandPanel>
        <BrandNoise />
        <BrandStars />
        <BrandMark to="/">khoj</BrandMark>
        <BrandCenter>
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
          <Kicker>Reset password</Kicker>
          <Title>Forgot your password?</Title>
          <Sub>Enter your email and we'll send you a link to reset it.</Sub>

          <form onSubmit={handleSubmit}>
            <Field>
              <label htmlFor="forgot-email">Email</label>
              <Input
                id="forgot-email"
                type="email"
                placeholder="yourname@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                full
                required
              />
            </Field>

            <Button type="submit" full disabled={status === 'loading'}>
              {status === 'loading' ? 'Sending link…' : 'Send reset link'}
            </Button>
            {status === 'loading' && (
              <Feedback>
                <Loader inline />
              </Feedback>
            )}
            {status === 'done' && <Feedback>Check your inbox for a reset link.</Feedback>}
            {error && <Feedback $tone="bad">{error}</Feedback>}
          </form>

          <Foot>
            Remembered it? <Link to="/login">Back to log in</Link>
          </Foot>
        </FormCard>
      </FormPanel>
    </Shell>
  );
};

export default ForgotPassword;
