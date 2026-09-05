import { useEffect, useRef } from 'react';
import styled from 'styled-components';

import Button from './Button';

/**
 * A confirmation step for something that cannot be undone.
 *
 * Placing a call is not like saving a form: it rings a stranger's phone, costs
 * credits, and spends one of a small daily allowance. There is no undo, so the
 * only place to stop a mistake is before it happens.
 */

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.2rem;
  z-index: 1000;
`;

const Panel = styled.div`
  background: ${({ theme }) => theme.bg};
  border: 1px solid ${({ theme }) => theme.rule};
  border-radius: 14px;
  max-width: 30rem;
  width: 100%;
  padding: 1.6rem;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.25);
`;

const Title = styled.h2`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: 1.2rem;
  color: ${({ theme }) => theme.ink};
  margin: 0 0 0.6rem;
`;

const Body = styled.div`
  font-size: 0.9rem;
  line-height: 1.6;
  color: ${({ theme }) => theme.muted};
  margin-bottom: 1.3rem;

  strong {
    color: ${({ theme }) => theme.ink};
    font-weight: 500;
  }
`;

const Row = styled.div`
  display: flex;
  gap: 0.7rem;
  justify-content: flex-end;
  flex-wrap: wrap;
`;

const ConfirmDialog = ({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
}) => {
  const panelRef = useRef(null);

  // Escape cancels. A dialog you cannot dismiss with the keyboard is a trap,
  // and this one stands between the user and a real phone call.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <Backdrop
      // Clicking the backdrop cancels, but never while the call is being
      // placed — a stray click must not leave the UI out of step with a
      // request that is already in flight.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel?.();
      }}
    >
      <Panel
        ref={panelRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <Title>{title}</Title>
        <Body>{children}</Body>
        <Row>
          <Button size="sm" variant="ghost" arrow={false} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button size="sm" arrow={false} onClick={onConfirm} disabled={busy}>
            {busy ? 'Calling…' : confirmLabel}
          </Button>
        </Row>
      </Panel>
    </Backdrop>
  );
};

export default ConfirmDialog;
