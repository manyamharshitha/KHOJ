import styled from 'styled-components';
import Button from './Button';

const dotColor = {
  blue: (theme) => theme.accent,
  silver: () => '#9AA0A8',
  gold: (theme) => theme.gold,
  premium: (theme) => theme.ink,
};

const Card = styled.div`
  position: relative;
  background: ${({ theme }) => theme.surface};
  border: 1px solid
    ${({ $active, $highlight, theme }) => ($active ? theme.accentDeep : $highlight ? theme.ink : theme.rule)};
  box-shadow: ${({ $active, theme }) => ($active ? `0 0 0 3px ${theme.accentSoft}` : 'none')};
  border-radius: 1rem;
  padding: 2rem 1.8rem;
  display: flex;
  flex-direction: column;
  height: 100%;
  transition: border-color 0.25s ease, box-shadow 0.25s ease;
`;

const Ribbon = styled.span`
  position: absolute;
  top: -11px;
  left: 1.8rem;
  background: ${({ theme }) => theme.ink};
  color: ${({ theme }) => theme.bg};
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.28rem 0.7rem;
  border-radius: 999px;
`;

const Dot = styled.span`
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: ${({ $tone, theme }) => (dotColor[$tone] || dotColor.blue)(theme)};
  margin-bottom: 1rem;
`;

const Name = styled.h3`
  font-family: 'Fraunces', Georgia, serif;
  font-size: 1.15rem;
  font-weight: 600;
  color: ${({ theme }) => theme.ink};
  margin: 0 0 0.5rem;
`;

const PriceRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  margin-bottom: 0.5rem;

  strong {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.9rem;
    font-weight: 700;
    color: ${({ theme }) => theme.ink};
    letter-spacing: -0.01em;
  }

  span {
    font-size: 0.82rem;
    color: ${({ theme }) => theme.muted};
  }
`;

const Listings = styled.p`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.72rem;
  letter-spacing: 0.02em;
  color: ${({ theme }) => theme.ink2};
  background: ${({ theme }) => theme.surface2};
  display: inline-block;
  padding: 0.3rem 0.6rem;
  border-radius: 0.35rem;
  margin: 0 0 1rem;
`;

const Desc = styled.p`
  font-size: 0.87rem;
  color: ${({ theme }) => theme.muted};
  line-height: 1.55;
  margin: 0 0 1.4rem;
`;

const Features = styled.ul`
  list-style: none;
  margin: 0 0 1.8rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  flex: 1;

  li {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    font-size: 0.85rem;
    color: ${({ theme }) => theme.ink2};
    line-height: 1.45;
  }

  li::before {
    content: '';
    width: 4px;
    height: 4px;
    margin-top: 0.55rem;
    border-radius: 50%;
    background: ${({ theme }) => theme.muted};
    flex: none;
  }
`;

const PricingCard = ({ plan, onSelect, loading, selected, active }) => (
  <Card $highlight={plan.highlight} $active={active}>
    {plan.highlight && <Ribbon>Most popular</Ribbon>}
    <Dot $tone={plan.tone} />
    <Name>{plan.name}</Name>
    <PriceRow>
      <strong>{plan.price}</strong>
      <span>{plan.period}</span>
    </PriceRow>
    <Listings>{plan.listings}</Listings>
    <Desc>{plan.description}</Desc>
    <Features>
      {plan.features.map((f) => (
        <li key={f}>{f}</li>
      ))}
    </Features>
    <Button
      full
      arrow={false}
      variant={plan.highlight || active ? 'primary' : 'ghost'}
      onClick={() => onSelect?.(plan.id)}
      disabled={loading}
    >
      {loading && selected ? 'Setting up…' : plan.cta}
    </Button>
  </Card>
);

export default PricingCard;
