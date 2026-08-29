import styled from 'styled-components';

const StyledWrapper = styled.div`
  width: ${({ $full }) => ($full ? '100%' : 'auto')};

  .input {
    font-family: 'Inter', system-ui, sans-serif;
    font-weight: 500;
    font-size: 14px;
    width: ${({ $full }) => ($full ? '100%' : 'auto')};
    color: ${({ theme }) => theme.ink};
    background-color: ${({ theme }) => theme.surface};
    border: 1px solid ${({ theme }) => theme.rule2};
    box-shadow: 0 1px 3px rgba(11, 37, 69, 0.05);
    border-radius: 0.6em;
    outline: none;
    padding: 0.85em 1em;
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

const Input = ({ full = false, ...rest }) => (
  <StyledWrapper $full={full}>
    <input className="input" {...rest} />
  </StyledWrapper>
);

export default Input;
