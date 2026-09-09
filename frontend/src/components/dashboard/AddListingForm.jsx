/**
 * Put a property on Khoj by hand.
 *
 * The third way a listing gets in, beside crawling a portal and pasting a page,
 * and the only one where the number comes from the person who actually holds
 * the property. That makes it the most reliable source in the product, so it is
 * a real form rather than the single phone field it grew out of.
 *
 * Only the phone number is required. An advert that omits the maintenance
 * charge is precisely the case this product exists to catch, so a listing with
 * nothing but a number is still worth having — the call establishes the rest.
 * Marking more fields required would push owners into inventing figures, which
 * is the one outcome worse than a blank.
 */

import { useState } from 'react';
import styled from 'styled-components';

import { addManualListing } from '../../lib/api';
import { Card, TextInput } from './dashboardUI';
import Button from '../ui/Button';

const Form = styled.form`
  display: grid;
  gap: 1rem;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 0.9rem;
`;

const Field = styled.label`
  display: grid;
  gap: 0.35rem;
  min-width: 0;

  span {
    font-size: 0.76rem;
    color: ${({ theme }) => theme.muted};
    font-family: 'IBM Plex Mono', monospace;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
`;

const Area = styled.textarea`
  width: 100%;
  min-height: 5rem;
  resize: vertical;
  padding: 0.6rem 0.7rem;
  font: inherit;
  font-size: 0.88rem;
  color: ${({ theme }) => theme.ink};
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.rule2};
  border-radius: 8px;

  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.gold};
    outline-offset: 1px;
  }
`;

const Note = styled.p`
  font-size: 0.8rem;
  line-height: 1.55;
  margin: 0;
  color: ${({ theme, $tone }) =>
    $tone === 'error' ? theme.bad : $tone === 'good' ? theme.good : theme.muted};
`;

const Actions = styled.div`
  display: flex;
  gap: 0.6rem;
  align-items: center;
  flex-wrap: wrap;
`;

const EMPTY = {
  title: '',
  rent: '',
  maintenance: '',
  deposit: '',
  locality: '',
  city: '',
  bedrooms: '',
  contact_number: '',
  notes: '',
};

/** A rupee field to a number, or undefined. Never NaN, which the API rejects. */
const money = (raw) => {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return undefined;
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const AddListingForm = ({ onAdded }) => {
  const [form, setForm] = useState(EMPTY);
  const [state, setState] = useState({ status: 'idle', message: null });

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.contact_number.trim()) return;

    setState({ status: 'saving', message: null });
    try {
      const saved = await addManualListing({
        contact_number: form.contact_number.trim(),
        // Omitted rather than sent empty: the backend treats a missing field as
        // "the advert did not say", which is true, and stores null. An empty
        // string would be stored as a value and read back as a stated blank.
        title: form.title.trim() || undefined,
        locality: form.locality.trim() || undefined,
        city: form.city.trim() || undefined,
        bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
        rent: money(form.rent),
        maintenance: money(form.maintenance),
        deposit: money(form.deposit),
        notes: form.notes.trim() || undefined,
      });

      setForm(EMPTY);
      setState({
        status: 'done',
        message: `Listed. ${saved.contact_number} is live on Khoj and will appear in tenant searches.`,
      });
      onAdded?.(saved);
    } catch (err) {
      setState({
        status: 'error',
        message: err?.message || 'That listing could not be saved.',
      });
    }
  };

  const busy = state.status === 'saving';

  return (
    <Card>
      <Form onSubmit={submit}>
        <Field>
          <span>Contact phone — required</span>
          <TextInput
            value={form.contact_number}
            onChange={set('contact_number')}
            placeholder="10 digits, or +91…"
            inputMode="tel"
            required
          />
        </Field>

        <Field>
          <span>Title</span>
          <TextInput
            value={form.title}
            onChange={set('title')}
            placeholder="2BHK with balcony, near the metro"
            maxLength={300}
          />
        </Field>

        <Grid>
          <Field>
            <span>Locality</span>
            <TextInput value={form.locality} onChange={set('locality')} placeholder="Kondapur" />
          </Field>
          <Field>
            <span>City</span>
            <TextInput value={form.city} onChange={set('city')} placeholder="Hyderabad" />
          </Field>
          <Field>
            <span>Bedrooms</span>
            <TextInput
              value={form.bedrooms}
              onChange={set('bedrooms')}
              type="number"
              min="0"
              max="20"
              placeholder="2"
            />
          </Field>
        </Grid>

        <Grid>
          <Field>
            <span>Rent / month</span>
            <TextInput value={form.rent} onChange={set('rent')} inputMode="numeric" placeholder="22000" />
          </Field>
          <Field>
            <span>Maintenance</span>
            <TextInput
              value={form.maintenance}
              onChange={set('maintenance')}
              inputMode="numeric"
              placeholder="2000"
            />
          </Field>
          <Field>
            <span>Deposit</span>
            <TextInput
              value={form.deposit}
              onChange={set('deposit')}
              inputMode="numeric"
              placeholder="60000"
            />
          </Field>
        </Grid>

        <Field>
          <span>Details</span>
          <Area
            value={form.notes}
            onChange={set('notes')}
            placeholder="Anything a tenant would ask: furnishing, parking, water, restrictions, when it is free."
            maxLength={2000}
          />
        </Field>

        <Actions>
          <Button type="submit" size="sm" arrow={false} disabled={busy || !form.contact_number.trim()}>
            {busy ? 'Adding…' : 'Add to Khoj'}
          </Button>
          {state.message && (
            <Note $tone={state.status === 'error' ? 'error' : 'good'}>{state.message}</Note>
          )}
        </Actions>

        <Note>
          Only the number is required. Leave anything you are unsure of blank — Khoj asks about it
          on the call rather than guessing.
        </Note>
      </Form>
    </Card>
  );
};

export default AddListingForm;
