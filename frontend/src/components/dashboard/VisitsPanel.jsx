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

const Said = styled.div`
  margin-top: 0.7rem;
  padding: 0.6rem 0.75rem;
  border-radius: 0.5rem;
  font-size: 0.8rem;
  line-height: 1.55;
  background: ${({ theme }) => theme.surface2};
  border-left: 2px solid
    ${({ theme, $tone }) =>
      $tone === 'good' ? theme.gold : $tone === 'bad' ? theme.danger ?? '#b3261e' : theme.rule2};
  color: ${({ theme }) => theme.ink};
`;

const LinkRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;

  code {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.72rem;
    color: ${({ theme }) => theme.muted};
    /* A verification link is long. Let it wrap rather than push the card wide. */
    word-break: break-all;
    min-width: 0;
  }
`;

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
  //: Per-visit outcome of the last action: `{ tone, text, link }`.
  const [said, setSaid] = useState({});

  /**
   * Run an action and say what happened — including when nothing did.
   *
   * This used to be `await fn(); await reload();`, discarding the result. The
   * send endpoint answers honestly with `{sent: false, reason}` when SMS is not
   * configured, and because that is a successful HTTP response rather than an
   * error, nothing rejected: the button stopped spinning, the status stayed
   * "scheduled", and the broker was never texted. It looked like it had worked.
   *
   * A request that did not go out is reported with the link, because the link
   * is the useful half — she can send it herself over WhatsApp and the
   * verification still happens.
   */
  const act = async (id, fn) => {
    setBusy(id);
    setSaid((prev) => ({ ...prev, [id]: null }));
    try {
      const result = await fn();

      if (result && result.sent === false) {
        // No text-message service on the server is the normal case here, not a
        // failure: WhatsApp is how the link goes out, so it is offered as the way
        // to send rather than as an apology. A service that exists and refused —
        // a trial account, an unverified number — is still said plainly, and
        // its own explanation is not the customer's problem to read.
        const handoff = result.sms_configured === false;
        setSaid((prev) => ({
          ...prev,
          [id]: {
            tone: handoff ? 'good' : 'warn',
            text: handoff
              ? 'Your request is ready. Send it to the broker on WhatsApp:'
              : 'Khoj could not send it automatically. Send it yourself:',
            link: result.link || null,
            whatsapp: result.whatsapp_url || null,
          },
        }));
      } else if (result && result.sent === true) {
        setSaid((prev) => ({
          ...prev,
          [id]: { tone: 'good', text: 'Request sent to the broker.', link: null },
        }));
      }

      await reload();
    } catch (err) {
      setSaid((prev) => ({
        ...prev,
        [id]: { tone: 'bad', text: err?.message || 'That did not work.', link: null },
      }));
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

                {/* The result of the last action on this visit, including the
                    case where nothing happened. A link that could not be texted
                    is still a link she can send herself, so it is offered rather
                    than swallowed with the failure. */}
                {said[v.id] && (
                  <Said $tone={said[v.id].tone}>
                    <span>{said[v.id].text}</span>
                    {said[v.id].link && (
                      <LinkRow>
                        {/* The primary way out when the gateway refuses. Opens
                            her own WhatsApp with the broker's number and the
                            message filled in — one tap, any number, no account,
                            and the broker sees a message from a person rather
                            than a link from a shortcode they do not recognise. */}
                        {said[v.id].whatsapp && (
                          <Button
                            size="sm"
                            arrow={false}
                            as="a"
                            href={said[v.id].whatsapp}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Send on WhatsApp
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          arrow={false}
                          onClick={() => navigator.clipboard?.writeText(said[v.id].link)}
                        >
                          Copy link
                        </Button>
                        <code>{said[v.id].link}</code>
                      </LinkRow>
                    )}
                  </Said>
                )}
              </Visit>
            );
          })}
        </Card>
      )}
    </div>
  );
};

export default VisitsPanel;
