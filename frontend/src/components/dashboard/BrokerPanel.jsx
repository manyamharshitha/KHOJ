/**
 * The broker side.
 *
 * A broker's inbound calls and video requests are joined to them by the phone
 * number on their profile — a scraped listing carries a number long before
 * anyone knows an account claims it, so there is no broker id to join on. That
 * is why this panel leads with the number, and why the empty state explains it
 * rather than showing zeroes: "0 calls" reads as nobody rang, when the truth is
 * that nothing has been connected up yet.
 */

import { useEffect, useState } from 'react';
import styled from 'styled-components';

import * as api from '../../lib/api';
import { useBrokerDashboard, useRole } from '../../lib/usePlatform';
import {
  Badge,
  Card,
  Kicker,
  PanelHead,
  StatCard,
  StatGrid,
  StatLabel,
  StatNum,
  Sub,
  TextInput,
  Title,
} from './dashboardUI';
import Button from '../ui/Button';
import AddListingForm from './AddListingForm';

const Field = styled.label`
  display: block;
  margin-bottom: 0.8rem;

  span {
    display: block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${({ theme }) => theme.muted};
    margin-bottom: 0.35rem;
  }
`;

const Note = styled.p`
  font-size: 0.85rem;
  line-height: 1.6;
  color: ${({ theme }) => theme.muted};
  margin: 0 0 1.2rem;
`;

const Line = styled.div`
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.8rem 0;

  & + & {
    border-top: 1px solid ${({ theme }) => theme.rule};
  }

  strong {
    font-size: 0.86rem;
    font-weight: 500;
    color: ${({ theme }) => theme.ink};
  }

  time {
    margin-left: auto;
    font-size: 0.72rem;
    color: ${({ theme }) => theme.muted};
  }
`;

const SectionTitle = styled.h2`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: 1.05rem;
  color: ${({ theme }) => theme.ink};
  margin: 1.8rem 0 0.8rem;
`;

const stamp = (iso) => {
  if (!iso) return '';
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

const BrokerPanel = () => {
  const { isBroker, choose } = useRole();
  const { data, loading, error, reload } = useBrokerDashboard();
  const [form, setForm] = useState({ business_name: '', contact_name: '', phone: '', address: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    if (data?.profile) {
      setForm({
        business_name: data.profile.business_name ?? '',
        contact_name: data.profile.contact_name ?? '',
        phone: data.profile.phone ?? '',
        address: data.profile.address ?? '',
      });
    }
  }, [data]);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api.saveBrokerProfile(form);
      if (!isBroker) await choose('broker');
      await reload();
    } catch (err) {
      setProblem(err?.message ?? 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const stats = data?.stats ?? {};
  const calls = Array.isArray(data?.calls) ? data.calls : [];
  const visits = Array.isArray(data?.site_visits) ? data.site_visits : [];

  return (
    <div>
      <PanelHead>
        <Kicker>Broker</Kicker>
        <Title>Your listings and enquiries</Title>
        <Sub>
          Calls and verification requests are matched to you by the phone number on your
          listings, so that number has to be here first.
        </Sub>
      </PanelHead>

      {loading && <Card><Note style={{ margin: 0 }}>Loading…</Note></Card>}

      {!loading && error && (
        <Card>
          <Note style={{ margin: 0 }}>{error.message || 'The server did not respond.'}</Note>
        </Card>
      )}

      {!loading && !error && (
        <>
          <Card>
            {data?.needs_phone && <Note>{data.note}</Note>}
            <Field>
              <span>Business name</span>
              <TextInput
                value={form.business_name}
                onChange={(e) => setForm({ ...form, business_name: e.target.value })}
                placeholder="Sai Estates"
              />
            </Field>
            <Field>
              <span>Your name</span>
              <TextInput
                value={form.contact_name}
                onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                placeholder="Ravi"
              />
            </Field>
            <Field>
              <span>Business phone — the number on your listings</span>
              <TextInput
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="9876543210"
              />
            </Field>
            <Field>
              <span>Address</span>
              <TextInput
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Kondapur, Hyderabad"
              />
            </Field>
            <Button
              size="sm"
              arrow={false}
              onClick={save}
              disabled={busy || !form.business_name.trim()}
            >
              {busy ? 'Saving…' : data?.profile ? 'Update profile' : 'Create profile'}
            </Button>
            {problem && <Note style={{ margin: '0.8rem 0 0' }}>{problem}</Note>}
          </Card>

          {!data?.needs_phone && (
            <>
              <StatGrid style={{ marginTop: '1.6rem' }}>
                <StatCard>
                  <StatLabel>Calls received</StatLabel>
                  <StatNum>{stats.calls_received ?? 0}</StatNum>
                </StatCard>
                <StatCard>
                  <StatLabel>Video requests</StatLabel>
                  <StatNum>{stats.visits_requested ?? 0}</StatNum>
                </StatCard>
                <StatCard>
                  <StatLabel>Verified</StatLabel>
                  <StatNum>{stats.visits_verified ?? 0}</StatNum>
                </StatCard>
                <StatCard>
                  <StatLabel>Reputation</StatLabel>
                  {/* An em dash, not zero. A broker with no history is unrated,
                      and zero reads as rated badly. */}
                  <StatNum style={{ fontSize: '1.4rem' }}>
                    {stats.reputation_score ?? '—'}
                  </StatNum>
                </StatCard>
              </StatGrid>

              {/* Above the calls, because listing a property is what causes
                  them. A broker arriving at an empty dashboard needs somewhere
                  to put their first flat, not a report on the calls they have
                  not received yet. */}
              <SectionTitle>Add a property</SectionTitle>
              <AddListingForm />

              <SectionTitle>Incoming calls</SectionTitle>
              <Card>
                {calls.length === 0 ? (
                  <Note style={{ margin: 0 }}>No calls to this number yet.</Note>
                ) : (
                  calls.slice(0, 10).map((c) => (
                    <Line key={c.id}>
                      <strong>{c.phone_dialed}</strong>
                      <Badge $tone="muted">{c.call_status}</Badge>
                      <time>{stamp(c.created_at)}</time>
                    </Line>
                  ))
                )}
              </Card>

              <SectionTitle>Verification requests</SectionTitle>
              <Card>
                {visits.length === 0 ? (
                  <Note style={{ margin: 0 }}>
                    No one has asked you for video proof yet. When they do, you will get an
                    SMS with a link — no account or app needed.
                  </Note>
                ) : (
                  visits.slice(0, 10).map((v) => (
                    <Line key={v.id}>
                      <strong>{v.property_address || 'Property'}</strong>
                      <Badge $tone={v.status === 'verified' ? 'good' : 'muted'}>{v.status}</Badge>
                      <time>{stamp(v.scheduled_for)}</time>
                    </Line>
                  ))
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default BrokerPanel;
