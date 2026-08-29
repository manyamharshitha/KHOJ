import { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
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
  Foot,
  Feedback,
} from '../components/layout/AuthLayout';

const ForgotPassword = () => {
  const [status, setStatus] = useState('idle');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (status === 'loading') return;
    setStatus('loading');
    window.setTimeout(() => setStatus('done'), 1200);
  };

  return (
    <Shell>
      <BrandPanel>
        <BrandNoise />
        <BrandWatermark>khoj</BrandWatermark>
        <BrandMark to="/">khoj</BrandMark>
        <div>
          <Trust />
          <BrandQuote>Nothing is ever guessed — including your password. Let's reset it properly.</BrandQuote>
          <BrandCite>Where families belong</BrandCite>
        </div>
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
              <Input id="forgot-email" type="email" placeholder="yourname@gmail.com" full required />
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
