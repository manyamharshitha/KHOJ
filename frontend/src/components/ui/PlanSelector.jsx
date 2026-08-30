import styled from 'styled-components';

const PLANS = [
  { id: 'trial', label: 'Free Trial' },
  { id: 'silver', label: 'Silver' },
  { id: 'gold', label: 'Gold' },
  { id: 'premium', label: 'Premium' },
];

const StyledWrapper = styled.div`
  .glass-radio-group {
    --bg: ${({ theme }) => (theme.name === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(11,37,69,0.04)')};
    display: inline-flex;
    position: relative;
    background: var(--bg);
    border: 1px solid ${({ theme }) => theme.rule};
    border-radius: 1rem;
    backdrop-filter: blur(12px);
    box-shadow:
      inset 1px 1px 4px rgba(255, 255, 255, 0.25),
      inset -1px -1px 6px rgba(11, 37, 69, 0.08),
      0 4px 14px rgba(11, 37, 69, 0.08);
    overflow: hidden;
    width: fit-content;
    max-width: 100%;
  }

  input {
    display: none;
  }

  label {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 90px;
    font-size: 13.5px;
    padding: 0.85rem 1.3rem;
    cursor: pointer;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: ${({ theme }) => theme.ink2};
    position: relative;
    z-index: 2;
    transition: color 0.3s ease-in-out;
    white-space: nowrap;
  }

  label:hover {
    color: ${({ theme }) => theme.ink};
  }

  #glass-trial:checked ~ label[for='glass-trial'] {
    color: ${({ theme }) => (theme.name === 'dark' ? '#0a1220' : '#ffffff')};
  }

  #glass-premium:checked ~ label[for='glass-premium'] {
    color: #ffffff;
  }

  #glass-gold:checked ~ label[for='glass-gold'],
  #glass-silver:checked ~ label[for='glass-silver'] {
    color: #17202b;
  }

  .glass-glider {
    position: absolute;
    top: 0;
    bottom: 0;
    width: calc(100% / 4);
    border-radius: 1rem;
    z-index: 1;
    transition:
      transform 0.5s cubic-bezier(0.37, 1.95, 0.66, 0.56),
      background 0.4s ease-in-out,
      box-shadow 0.4s ease-in-out;
  }

  #glass-trial:checked ~ .glass-glider {
    transform: translateX(0%);
    background: linear-gradient(135deg, ${({ theme }) => theme.accent}, ${({ theme }) => theme.accentDeep});
    box-shadow: 0 0 18px rgba(22, 99, 184, 0.45), 0 0 10px rgba(255, 255, 255, 0.25) inset;
  }

  #glass-silver:checked ~ .glass-glider {
    transform: translateX(100%);
    background: linear-gradient(135deg, #d7dbe1, #aab2bf);
    box-shadow: 0 0 18px rgba(170, 178, 191, 0.5), 0 0 10px rgba(255, 255, 255, 0.4) inset;
  }

  #glass-gold:checked ~ .glass-glider {
    transform: translateX(200%);
    background: linear-gradient(135deg, #f4dc9d, #cf9f34);
    box-shadow: 0 0 18px rgba(207, 159, 52, 0.5), 0 0 10px rgba(255, 235, 150, 0.4) inset;
  }

  #glass-premium:checked ~ .glass-glider {
    transform: translateX(300%);
    background: linear-gradient(135deg, #123a69, #0b2545);
    box-shadow: 0 0 18px rgba(11, 37, 69, 0.55), 0 0 10px rgba(95, 163, 230, 0.4) inset;
  }

`;

const PlanSelector = ({ value = 'trial', onChange }) => (
  <StyledWrapper>
    <div className="glass-radio-group">
      {PLANS.map((plan) => (
        <input
          key={plan.id}
          type="radio"
          name="plan"
          id={`glass-${plan.id}`}
          checked={value === plan.id}
          onChange={() => onChange?.(plan.id)}
        />
      ))}
      {PLANS.map((plan) => (
        <label key={plan.id} htmlFor={`glass-${plan.id}`}>
          {plan.label}
        </label>
      ))}
      <div className="glass-glider" />
    </div>
  </StyledWrapper>
);

export default PlanSelector;
