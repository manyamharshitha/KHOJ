/**
 * Khoj Verified — the renter's view of video verifications.
 *
 * The badge here claims one narrow thing, and the copy says exactly that:
 * a video was recorded from a device whose GPS was near the address, near the
 * agreed time. It does not claim the flat in the video is the flat in the
 * advert. Overstating it would be the single most damaging thing this product
 * could do, because the whole premise is that the badge means something.
 *
 * A location mismatch is shown with its measured distance and an override,
 * never as a verdict: GPS indoors is routinely tens of metres out, and failing
 * a broker on a satellite fix they do not control is not a judgement this
 * software is entitled to make.
 */

import { useState } from 'react';
import styled from 'styled-components';

import * as api from '../../lib/api';
import { useVisits } from '../../lib/usePlatform';
import { Badge, Card, Kicker, PanelHead, Sub, Title } from './dashboardUI';
import Button from '../ui/Button';

const Visit = styled.div`
  padding: 1rem 0;

  & + & {
    border-top: 1px solid ${({ theme }) => theme.rule};
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-bottom: 0.4rem;
  }

  strong {
    font-size: 0.9rem;
    font-weight: 500;
    color: ${({ theme }) => theme.ink};
  }

  p {
    margin: 0.3rem 0 0;
    font-size: 0.82rem;
    line-height: 1.55;
    color: ${({ theme }) => theme.muted};
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

/** What each status means, in the words a customer should read. */
const MEANING = {
  scheduled: { tone: 'muted', label: 'Scheduled', says: 'Waiting for the agreed time.' },
  sms_sent: { tone: 'accent', label: 'Asked', says: 'The broker has been sent the link.' },
  video_received: {
    tone: 'accent',
    label: 'Received',
    says: 'A video arrived, but the location could not be checked — so this is not verified.',
  },
  verified: {
    tone: 'good',
    label: 'Verified',
    says: 'A video was recorded near this address, at around the agreed time.',
  },
  gps_mismatch: {
    tone: 'bad',
    label: 'Location mismatch',
    says: 'The video came from further away than expected. GPS indoors is often wrong — check the video before deciding.',
  },
  late_submission: {
    tone: 'bad',
    label: 'Late',
    says: 'The video arrived outside the agreed window.',
  },
  expired: { tone: 'muted', label: 'Expired', says: 'No video arrived in time.' },
  failed: { tone: 'bad', label: 'Failed', says: 'This verification could not be completed.' },
};

const stamp = (iso) => {
  if (!iso) return '';
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

const VisitsPanel = () => {
  const { items, loading, error, reload } = useVisits();
  const [busy, setBusy] = useState(null);

  const act = async (id, fn) => {
    setBusy(id);
    try {
      await fn();
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PanelHead>
        <Kicker>Khoj Verified</Kicker>
        <Title>Video verifications</Title>
        <Sub>
          A short live video from the property, recorded by the broker at a time you both
          agreed. Verified means the video came from near the address at around that time —
          it is not a guarantee about the flat itself.
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
              No verifications yet. Open one from a listing in Results to ask the broker for
              live video proof.
            </p>
          </Empty>
        </Card>
      )}

      {items.length > 0 && (
        <Card>
          {items.map((v) => {
            const meaning = MEANING[v.status] ?? MEANING.scheduled;
            return (
              <Visit key={v.id}>
                <header>
                  <strong>{v.property_address || 'Property'}</strong>
                  <Badge $tone={meaning.tone}>{meaning.label}</Badge>
                  {v.distance_m != null && (
                    <Badge $tone="muted">{Math.round(v.distance_m)} m away</Badge>
                  )}
                </header>
                <p>{meaning.says}</p>
                <p>
                  Agreed for {stamp(v.scheduled_for)}
                  {v.captured_at ? ` · video at ${stamp(v.captured_at)}` : ''}
                </p>
                {v.override_reason && <p>Accepted by you: {v.override_reason}</p>}

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                  {v.status === 'scheduled' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      arrow={false}
                      disabled={busy === v.id}
                      onClick={() => act(v.id, () => api.sendVisitRequest(v.id))}
                    >
                      {busy === v.id ? 'Sending…' : 'Send the request now'}
                    </Button>
                  )}
                  {v.status === 'gps_mismatch' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      arrow={false}
                      disabled={busy === v.id}
                      onClick={() =>
                        act(v.id, () =>
                          api.overrideVisit(v.id, 'Accepted despite a GPS mismatch'),
                        )
                      }
                    >
                      Accept anyway
                    </Button>
                  )}
                </div>
              </Visit>
            );
          })}
        </Card>
      )}
    </div>
  );
};

export default VisitsPanel;
