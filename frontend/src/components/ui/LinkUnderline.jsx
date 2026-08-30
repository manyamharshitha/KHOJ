import styled from 'styled-components';

const StyledLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.4rem;
  font-size: 0.86rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: ${({ theme }) => theme.ink};
  border-bottom: 1px solid ${({ theme }) => theme.ink};
  padding-bottom: 0.2rem;
  text-decoration: none;
  transition: color 0.25s ease, border-color 0.25s ease, gap 0.25s ease;

  &:hover {
    color: ${({ theme }) => theme.accentDeep};
    border-color: ${({ theme }) => theme.accentDeep};
    gap: 0.8rem;
  }
`;

const LinkUnderline = ({ children, as, ...rest }) => (
  <StyledLink as={as} {...rest}>
    {children}
    <span aria-hidden="true">&rarr;</span>
  </StyledLink>
);

export default LinkUnderline;
