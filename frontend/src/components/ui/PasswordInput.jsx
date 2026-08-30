import { useState } from 'react';
import styled from 'styled-components';

const Wrap = styled.div`
  position: relative;
  width: 100%;

  .input {
    font-family: 'Inter', system-ui, sans-serif;
    font-weight: 500;
    font-size: 14px;
    width: 100%;
    color: ${({ theme }) => theme.ink};
    background-color: ${({ theme }) => theme.surface};
    border: 1px solid ${({ theme }) => theme.rule2};
    box-shadow: 0 1px 3px rgba(11, 37, 69, 0.05);
    border-radius: 0.6em;
    outline: none;
    padding: 0.85em 2.6em 0.85em 1em;
    transition: 0.3s;
  }

  .input::placeholder {
    color: ${({ theme }) => theme.muted};
  }

  .input:hover {
    border-color: ${({ theme }) => theme.accent};
  }

  .input:focus {
    border-color: ${({ theme }) => theme.accent};
    box-shadow: 0 0 0 3px ${({ theme }) => theme.accentSoft};
  }
`;

const Toggle = styled.button`
  position: absolute;
  right: 0.6em;
  top: 50%;
  transform: translateY(-50%);
  width: 1.9em;
  height: 1.9em;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  color: ${({ theme }) => theme.muted};
  border-radius: 0.4em;
  transition: color 0.2s ease;

  &:hover {
    color: ${({ theme }) => theme.ink};
  }

  svg {
    width: 17px;
    height: 17px;
  }
`;

const EyeIcon = ({ open }) =>
  open ? (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M3 3l18 18M10.6 10.7a3.2 3.2 0 0 0 4.5 4.5M7.4 7.5C4.9 8.9 3 12 3 12s3.6 7 10 7c2 0 3.7-.6 5.1-1.5M15.7 6.3C14.5 5.9 13.3 5.7 12 5.7c-.6 0-1.2.05-1.8.14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

const PasswordInput = ({ ...rest }) => {
  const [visible, setVisible] = useState(false);
  return (
    <Wrap>
      <input className="input" type={visible ? 'text' : 'password'} {...rest} />
      <Toggle type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Hide password' : 'Show password'}>
        <EyeIcon open={visible} />
      </Toggle>
    </Wrap>
  );
};

export default PasswordInput;
