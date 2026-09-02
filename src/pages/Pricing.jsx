import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import styled from 'styled-components';
import PlanSelector from '../components/ui/PlanSelector';
import PricingCard from '../components/ui/PricingCard';
import Loader from '../components/ui/Loader';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { plans } from '../data/plans';
import { useAgencyLead } from '../lib/useKhoj';

const Wrap = styled.div`
  background: ${({ theme }) => theme.bg};
`;

const Head = styled.section`
  padding: 9.5rem 6vw 3rem;
  text-align: center;
  background: ${({ theme }) => theme.bg};
`;

const HeadInner = styled.div`
  max-width: 640px;
  margin: 0 auto;
`;

const Kicker = styled.p`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.68rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  margin: 0 0 1.1rem;
`;

const Title = styled.h1`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(2.1rem, 4.2vw, 3.2rem);
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 1rem;
  color: ${({ theme }) => theme.ink};
`;

const Sub = styled.p`
  color: ${({ theme }) => theme.muted};
  font-size: 1.02rem;
  line-height: 1.6;
  margin: 0 0 2.2rem;
`;

const SelectorRow = styled.div`
  display: flex;
  justify-content: center;
`;

const Section = styled.section`
  padding: 5rem 6vw;
`;

const Grid = styled.div`
  max-width: 1180px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.4rem;

  @media (max-width: 980px) {
    grid-template-columns: 1fr 1fr;
  }
  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const Feedback = styled.div`
  max-width: 1180px;
  margin: -1.6rem auto 2.4rem;
  display: flex;
  justify-content: center;
`;

const Note = styled.div`
  max-width: 560px;
  margin: 0 auto;
  text-align: center;
  padding: 1.4rem 1.6rem;
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.rule};
  border-radius: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.9rem;
  justify-content: center;

  span {
    font-size: 0.9rem;
    color: ${({ theme }) => theme.ink2};
  }

  strong {
    color: ${({ theme }) => theme.good};
  }
`;

const CompareHead = styled.div`
  max-width: 640px;
  margin: 0 auto 3rem;
  text-align: center;
`;

const CTitle = styled.h2`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(1.8rem, 3.2vw, 2.3rem);
  color: ${({ theme }) => theme.ink};
  margin: 0 0 0.7rem;
`;

const CLede = styled.p`
  color: ${({ theme }) => theme.muted};
  font-size: 0.98rem;
  margin: 0;
`;

const TableWrap = styled.div`
  max-width: 1000px;
  margin: 0 auto;
  overflow-x: auto;
  border: 1px solid ${({ theme }) => theme.rule};
  border-radius: 1rem;
  background: ${({ theme }) => theme.surface};
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  min-width: 640px;

  th,
  td {
    padding: 0.95rem 1.2rem;
    text-align: left;
    border-bottom: 1px solid ${({ theme }) => theme.rule};
    font-size: 0.88rem;
  }

  th {
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: ${({ theme }) => theme.muted};
    background: ${({ theme }) => theme.surface2};
  }

  td {
    color: ${({ theme }) => theme.ink2};
  }

  tbody tr:last-child td {
    border-bottom: none;
  }
`;

const LeadForm = styled.form`
  max-width: 460px;
  margin: 0 auto;
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
  justify-content: center;
`;

const rows = [
  ['Daily listing cap', '1–2', '5–10', '10–15', '15–25'],
  ['Custom questions', 'Up to 2', 'Up to 3', 'Up to 5', 'Unlimited'],
  ['Transcript playback', 'Yes', 'Yes', 'Yes', 'Yes'],
  ['CSV import / export', '—', 'Yes', 'Yes', 'Yes'],
  ['Multi-city lists', '—', '—', 'Yes', 'Yes'],
  ['Regional language on calls', '—', '—', 'Add-on', 'Included'],
  ['Dedicated callback number', '—', '—', '—', 'Yes'],
  ['Weekly saved-search re-runs', '—', '—', '—', 'Yes'],
];

const LeadNote = styled.p`
  margin: 0.9rem 0 0;
  font-size: 0.85rem;
  text-align: center;
  color: ${({ theme, $error }) => ($error ? theme.bad ?? '#A03028' : theme.muted)};
`;

const Pricing = () => {
  // Sends the lead to the backend, which stores it and alerts the team.
  const agencyLead = useAgencyLead();
  const [selectedTier, setSelectedTier] = useState('trial');
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [confirmedPlan, setConfirmedPlan] = useState(null);
  const [email, setEmail] = useState('');

  const orderedPlans = useMemo(() => {
    const chosen = plans.find((p) => p.id === selectedTier);
    if (!chosen) return plans;
    return [chosen, ...plans.filter((p) => p.id !== selectedTier)];
  }, [selectedTier]);

  const handleSelect = (planId) => {
    setSelectedTier(planId);
    setConfirmedPlan(null);
    setLoadingPlan(planId);
    window.setTimeout(() => {
      setLoadingPlan(null);
      setConfirmedPlan(planId);
    }, 1600);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;

    // The lead is the point of this form, so it goes first. The plan animation
    // is decoration and must not gate a real enquiry.
    const sent = await agencyLead.submit(address, `Interested in the ${selectedTier} tier or above.`);
    if (sent) setEmail('');
    handleSelect(selectedTier);
  };

  const confirmedName = plans.find((p) => p.id === confirmedPlan)?.name;

  return (
    <Wrap>
      <Head>
        <HeadInner>
          <Kicker>[ business plans ]</Kicker>
          <Title>Priced by how many doors you need opened</Title>
          <Sub>
            Every plan runs the same verified call — the difference is how many listings Khoj clears for you
            each day, and how many questions you can customize.
          </Sub>
          <SelectorRow>
            <PlanSelector value={selectedTier} onChange={setSelectedTier} />
          </SelectorRow>
        </HeadInner>
      </Head>

      <Section>
        <Grid>
          {orderedPlans.map((plan) => (
            <motion.div key={plan.id} layout transition={{ layout: { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] } }}>
              <PricingCard
                plan={plan}
                onSelect={handleSelect}
                loading={loadingPlan === plan.id}
                selected={loadingPlan === plan.id}
                active={selectedTier === plan.id}
              />
            </motion.div>
          ))}
        </Grid>

        {loadingPlan && (
          <Feedback>
            <Loader inline />
          </Feedback>
        )}

        {confirmedPlan && !loadingPlan && (
          <Feedback>
            <Note>
              <span>
                You're set on the <strong>{confirmedName}</strong> plan — check your inbox to finish setup.
              </span>
            </Note>
          </Feedback>
        )}
      </Section>

      <Section style={{ paddingTop: 0 }}>
        <CompareHead>
          <CTitle>Compare plans in detail</CTitle>
          <CLede>Everything included at every tier, side by side.</CLede>
        </CompareHead>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Free Trial</th>
                <th>Silver</th>
                <th>Gold</th>
                <th>Premium</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) => (
                    <td key={i}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Section>

      <Section style={{ paddingTop: 0 }}>
        <CompareHead>
          <CTitle>Need more than 25 a day?</CTitle>
          <CLede>Leave your email and we'll set up a custom agency plan.</CLede>
        </CompareHead>
        <LeadForm onSubmit={handleSubmit}>
          <Input
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" size="sm" disabled={agencyLead.status === 'sending'}>
            {agencyLead.status === 'sending' ? 'Sending…' : 'Talk to us'}
          </Button>
        </LeadForm>
        {agencyLead.message && (
          <LeadNote $error={agencyLead.status === 'error'}>{agencyLead.message}</LeadNote>
        )}
      </Section>
    </Wrap>
  );
};

export default Pricing;
