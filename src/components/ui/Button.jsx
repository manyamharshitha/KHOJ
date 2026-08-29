import styled, { css } from 'styled-components';

const variants = {
  dark: css`
    color: ${({ theme }) => theme.bg};
    background-color: ${({ theme }) => theme.ink};
    border-color: ${({ theme }) => theme.ink};
    &:hover {
      background-color: ${({ theme }) => theme.accent};
      border-color: ${({ theme }) => theme.accent};
      color: #ffffff;
    }
  `,
  primary: css`
    color: #ffffff;
    background-color: ${({ theme }) => theme.accent};
    border-color: ${({ theme }) => theme.accent};
    &:hover {
      background-color: ${({ theme }) => theme.accentDeep};
      border-color: ${({ theme }) => theme.accentDeep};
    }
  `,
  ghost: css`
    color: ${({ theme }) => theme.ink};
    background-color: transparent;
    border-color: ${({ theme }) => theme.rule2};
    &:hover {
      border-color: ${({ theme }) => theme.ink};
      background-color: ${({ theme }) => theme.surface2};
    }
  `,
  light: css`
    color: ${({ theme }) => theme.ink};
    background-color: #ffffff;
    border-color: #ffffff;
    &:hover {
      background-color: rgba(255, 255, 255, 0.85);
    }
  `,
  outlineLight: css`
    color: #ffffff;
    background-color: transparent;
    border-color: rgba(255, 255, 255, 0.5);
    &:hover {
      border-color: #ffffff;
      background-color: rgba(255, 255, 255, 0.1);
    }
  `,
};

const StyledButton = styled.button`
  width: ${({ $full }) => ($full ? '100%' : 'fit-content')};
  position: relative;
  height: ${({ $size }) => ($size === 'sm' ? '2.6em' : '3em')};
  padding: 0 ${({ $size }) => ($size === 'sm' ? '1.3em' : '1.5em')};
  border: 1px solid;
  outline: none;
  transition: background-color 0.25s ease, border-color 0.25s ease, color 0.25s ease, transform 0.15s ease;
  border-radius: 999px;
  font-size: ${({ $size }) => ($size === 'sm' ? '13px' : '14px')};
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5em;
  white-space: nowrap;

  &:active {
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  ${({ $variant }) => variants[$variant] || variants.dark}
`;

const Arrow = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
    <path
      d="M7 17 17 7M17 7H9M17 7v8"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Button = ({ children, variant = 'dark', size = 'md', full = false, as, arrow = true, ...rest }) => (
  <StyledButton as={as} $variant={variant} $size={size} $full={full} {...rest}>
    {children}
    {arrow && <Arrow />}
  </StyledButton>
);

export default Button;
