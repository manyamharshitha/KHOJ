import { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  body {
    background: ${({ theme }) => theme.bg};
    color: ${({ theme }) => theme.ink};
    transition: background-color 0.35s ease, color 0.35s ease;
  }

  ::selection {
    background: ${({ theme }) => theme.accent};
    color: #ffffff;
  }

  :focus-visible {
    outline: 2px solid ${({ theme }) => theme.accent};
    outline-offset: 3px;
    border-radius: 2px;
  }
`;
