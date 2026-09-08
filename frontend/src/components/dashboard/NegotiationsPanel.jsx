/**
 * Deposit negotiation.
 *
 * The history is the point. A deposit conversation happens over days across SMS
 * and phone calls, and what people lose is the record of what was actually
 * offered — so every move, from either side, is listed with a timestamp and
 * nothing is editable after the fact.
 *
 * Drafts are proposed, never sent. The model writes three; the customer picks
 * one, edits it, and sends it themselves. A message that goes to a real person
 * asking them for money should have been read by the person whose name is on it.
 */

import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';

import * as api from '../../lib/api';
import { useNegotiations } from '../../lib/usePlatform';
import { Badge, Card, Kicker, PanelHead, Sub, TextInput, Title } from './dashboardUI';
import Button from '../ui/Button';

const Row = styled.div`
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
  align-items: flex-end;
  margin-bottom: 1rem;
`;

const Field = styled.label`
  display: block;
  flex: 1 1 9rem;

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

const Area = styled.textarea`
  width: 100%;
  min-height: 4.5rem;
  resize: vertical;
  font: inherit;
  font-size: 0.88rem;
  line-height: 1.5;
  padding: 0.7rem 0.85rem;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.rule2};
  background: ${({ theme }) => theme.surface};
  color: ${({ theme }) => theme.ink};
`;

const Thread = styled.div`
  margin-top: 1rem;
  border-top: 1px solid ${({ theme }) => theme.rule};
`;

const Move = styled.div`
  padding: 0.75rem 0;
  border-bottom: 1px solid ${({ theme }) => theme.rule};

  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.3rem;
  }

  p {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.5;
    color: ${({ theme }) => theme.ink};
  }

  time {
    font-size: 0.7rem;
    color: ${({ theme }) => theme.muted};
    margin-left: auto;
  }
`;

const Draft = styled.button`
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  font-size: 0.85rem;
  line-height: 1.5;
  padding: 0.75rem 0.9rem;
  margin-bottom: 0.5rem;
  border-radius: 8px;
  border: 1px solid ${({ theme, $picked }) => ($picked ? theme.ink : theme.rule2)};
  background: ${({ theme }) => theme.surface2};
  color: ${({ theme }) => theme.ink};
  cursor: pointer;

  em {
    display: block;
    font-family: 'IBM Plex Mono', monospace;
    font-style: normal;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${({ theme }) => theme.muted};
    margin-bottom: 0.3rem;
  }
`;

const Empty = styled.div`
  text-align: center;
  padding: 2.6rem 1.4rem;

  p {
    color: ${({ theme }) => theme.muted};
    font-size: 0.9rem;
    line-height: 1.6;
    margin: 0.4rem 0 0;
  }
`;

const rupees = (n) => (typeof n === 'number' ? `₹${n.toLocaleString('en-IN')}` : '—');

const stamp = (iso) => {
  if (!iso) return '';
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

const NegotiationsPanel = ({ sessionId = null }) => {
  const { items, loading, error, reload } = useNegotiations();
  const [openId, setOpenId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [fromDraft, setFromDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const open = items.find((n) => n.id === openId) ?? null;

  useEffect(() => {
    setOpenId((id) => (items.some((n) => n.id === id) ? id : items[0]?.id ?? null));
  }, [items]);

  const loadDrafts = useCallback(async () => {
    if (!open) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = await api.getNegotiationDrafts(open.id);
      setDrafts((prev) => ({ ...prev, [open.id]: body?.drafts ?? [] }));
      if (!body?.drafts?.length) setProblem(body?.note ?? 'No drafts could be generated.');
    } catch (err) {
      setProblem(err?.message ?? 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, [open]);

  const send = async () => {
    if (!open || !text.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = await api.sendNegotiationOffer(open.id, {
        message: text.trim(),
        amount: amount ? Number(amount) : null,
        aiDrafted: fromDraft,
      });
      // Said plainly rather than hidden: the offer is recorded either way, and
      // the customer needs to know whether the broker actually received a text.
      if (body?.delivery && !body.delivery.sent) {
        setProblem(`Recorded, but not sent: ${body.delivery.reason}`);
      }
      setText('');
      setAmount('');
      setFromDraft(false);
      await reload();
    } catch (err) {
      setProblem(err?.message ?? 'That message could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PanelHead>
        <Kicker>Negotiations</Kicker>
        <Title>Security deposit</Title>
        <Sub>
          Every offer and reply, kept in one place. Khoj drafts the message; you decide what
          is actually sent.
        </Sub>
      </PanelHead>

      {loading && (
        <Card>
          <Empty>
            <p>Loading…</p>
          </Empty>
        </Card>
      )}

      {!loading && error && (
        <Card>
          <Empty>
            <p>{error.message || 'The server did not respond.'}</p>
          </Empty>
        </Card>
      )}

      {!loading && !error && items.length === 0 && (
        <Card>
          <Empty>
            <p>
              No negotiations yet. Open one from a listing in Results once you have a deposit
              you would like to reduce.
            </p>
          </Empty>
        </Card>
      )}

      {open && (
        <Card>
          <Row>
            <Field>
              <span>Asking</span>
              <TextInput value={rupees(open.current_deposit)} readOnly />
            </Field>
            <Field>
              <span>You want</span>
              <TextInput value={rupees(open.desired_deposit)} readOnly />
            </Field>
            <Badge $tone={open.status === 'accepted' ? 'good' : 'muted'}>{open.status}</Badge>
          </Row>

          <Button size="sm" variant="ghost" arrow={false} onClick={loadDrafts} disabled={busy}>
            {busy ? 'Working…' : 'Draft three messages'}
          </Button>

          {(drafts[open.id] ?? []).map((d, i) => (
            <Draft
              key={i}
              $picked={text === d.message}
              onClick={() => {
                setText(d.message);
                setFromDraft(true);
              }}
              style={{ marginTop: i === 0 ? '0.9rem' : 0 }}
            >
              <em>{d.tone}</em>
              {d.message}
            </Draft>
          ))}

          <Area
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFromDraft(false);
            }}
            placeholder="Write your message, or pick one above and edit it."
            style={{ marginTop: '0.9rem' }}
          />

          <Row style={{ marginTop: '0.7rem' }}>
            <Field>
              <span>Offer amount (optional)</span>
              <TextInput
                value={amount}
                inputMode="numeric"
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="50000"
              />
            </Field>
            <Button size="sm" arrow={false} onClick={send} disabled={busy || !text.trim()}>
              {busy ? 'Sending…' : 'Send to broker'}
            </Button>
          </Row>

          {problem && (
            <p style={{ fontSize: '0.82rem', margin: '0.2rem 0 0', opacity: 0.75 }}>{problem}</p>
          )}

          <Thread>
            {(open.offers ?? []).map((o, i) => (
              <Move key={i}>
                <header>
                  <Badge $tone={o.party === 'renter' ? 'accent' : 'muted'}>{o.party}</Badge>
                  {o.amount != null && <Badge $tone="muted">{rupees(o.amount)}</Badge>}
                  {o.ai_drafted && <Badge $tone="muted">AI drafted</Badge>}
                  <time>{stamp(o.sent_at)}</time>
                </header>
                <p>{o.message}</p>
              </Move>
            ))}
          </Thread>
        </Card>
      )}
    </div>
  );
};

export default NegotiationsPanel;
