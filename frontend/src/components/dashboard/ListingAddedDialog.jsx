/**
 * What happens immediately after a listing is added by hand.
 *
 * The choice is the point. A manually added listing is dialable straight away,
 * and placing a call is irreversible — it rings a real person and spends one of
 * a small number of daily verifications. So the two paths are presented side by
 * side and neither is preselected.
 *
 * "Call now" is the destructive one and is styled as the quieter option, not the
 * primary. The default action on a dialog people will dismiss quickly should not
 * be the one that telephones a stranger.
 */

import { useEffect, useRef } from 'react';
import styled from 'styled-components';

import Button from '../ui/Button';

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(18, 17, 15, 0.55);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
  padding: 1.2rem;
  z-index: 60;
`;

const Panel = styled.div`
  width: min(28rem, 100%);
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.rule};
  border-radius: 14px;
  box-shadow: ${({ theme }) => theme.shadow};
  padding: 1.6rem 1.5rem 1.4rem;
`;

const Kicker = styled.p`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  margin: 0 0 0.5rem;
`;

const Title = styled.h2`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: 1.3rem;
  line-height: 1.3;
  color: ${({ theme }) => theme.ink};
  margin: 0 0 0.6rem;
`;

const Body = styled.p`
  font-size: 0.88rem;
  line-height: 1.6;
  color: ${({ theme }) => theme.ink2};
  margin: 0 0 0.7rem;

  strong {
    font-weight: 500;
    color: ${({ theme }) => theme.ink};
  }
`;

const Caution = styled.p`
  font-size: 0.82rem;
  line-height: 1.55;
  color: ${({ theme }) => theme.muted};
  margin: 0 0 1.3rem;
`;

const Actions = styled.div`
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;

  > * {
    flex: 1 1 10rem;
  }
`;

const ListingAddedDialog = ({ phone, onCallNow, onAskQuestions, busy = false }) => {
  const panel = useRef(null);

  // Focus moves into the dialog so a keyboard user is not left behind on the
  // form underneath, and Escape is deliberately not wired: this dialog asks a
  // question that has no sensible default answer.
  useEffect(() => {
    panel.current?.querySelector('button')?.focus();
  }, []);

  return (
    <Backdrop>
      <Panel
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="listing-added-title"
        aria-describedby="listing-added-body"
      >
        <Kicker>Listing added</Kicker>
        <Title id="listing-added-title">What would you like to do next?</Title>
        <Body id="listing-added-body">
          <strong>{phone}</strong> is saved and ready. Khoj can call now, or you can set the
          questions it should ask first.
        </Body>
        <Caution>
          Calling places a real phone call to a real person and uses one of your daily
          verifications. It cannot be undone once it starts.
        </Caution>

        <Actions>
          <Button
            size="sm"
            variant="ghost"
            arrow={false}
            onClick={onAskQuestions}
            disabled={busy}
          >
            Ask questions first
          </Button>
          <Button size="sm" arrow={false} onClick={onCallNow} disabled={busy}>
            {busy ? 'Starting…' : 'Call now'}
          </Button>
        </Actions>
      </Panel>
    </Backdrop>
  );
};

export default ListingAddedDialog;
