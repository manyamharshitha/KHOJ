/**
 * The bell in the dashboard header.
 *
 * Quiet by design. It shows a count only when there is one, and the dropdown
 * says what happened in the same plain words the rest of the product uses —
 * "Video verified", not "VISIT_COMPLETE". A notification whose underlying event
 * the customer already saw is not worth a badge.
 */

import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

import { useNotifications } from '../../lib/usePlatform';

const Wrap = styled.div`
  position: relative;
`;

const Button = styled.button`
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid ${({ theme }) => theme.rule2};
  background: ${({ theme }) => theme.surface};
  color: ${({ theme }) => theme.ink2};
  display: grid;
  place-items: center;
  cursor: pointer;

  svg {
    width: 16px;
    height: 16px;
  }
`;

const Badge = styled.span`
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: ${({ theme }) => theme.bad ?? '#B4442F'};
  color: #fff;
  font-size: 0.62rem;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
`;

const Panel = styled.div`
  position: absolute;
  right: 0;
  top: calc(100% + 0.5rem);
  width: min(21rem, calc(100vw - 2rem));
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.rule};
  border-radius: 12px;
  box-shadow: ${({ theme }) => theme.shadow};
  z-index: 40;
  overflow: hidden;
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.8rem 1rem;
  border-bottom: 1px solid ${({ theme }) => theme.rule};

  p {
    margin: 0;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${({ theme }) => theme.muted};
  }

  button {
    font: inherit;
    font-size: 0.74rem;
    background: none;
    border: none;
    color: ${({ theme }) => theme.ink2};
    cursor: pointer;
    text-decoration: underline;
  }
`;

const List = styled.div`
  max-height: 22rem;
  overflow-y: auto;
`;

const Item = styled.button`
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.75rem 1rem;
  background: ${({ theme, $unread }) => ($unread ? theme.surface2 : 'transparent')};
  border: none;
  border-bottom: 1px solid ${({ theme }) => theme.rule};
  cursor: pointer;

  strong {
    display: block;
    font-size: 0.84rem;
    font-weight: 400;
    color: ${({ theme }) => theme.ink};
    line-height: 1.45;
  }

  span {
    font-size: 0.7rem;
    color: ${({ theme }) => theme.muted};
  }
`;

const Empty = styled.p`
  padding: 1.8rem 1rem;
  margin: 0;
  text-align: center;
  font-size: 0.85rem;
  color: ${({ theme }) => theme.muted};
`;

const when = (iso) => {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const mins = Math.round((Date.now() - at.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const NotificationBell = () => {
  const { items, unread, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  // Close on an outside click or Escape. A dropdown that traps the page is the
  // fastest way to make a header feel broken.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <Wrap ref={wrap}>
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && <Badge>{unread > 9 ? '9+' : unread}</Badge>}
      </Button>

      {open && (
        <Panel role="dialog" aria-label="Notifications">
          <Head>
            <p>Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </Head>
          <List>
            {items.length === 0 ? (
              <Empty>Nothing yet.</Empty>
            ) : (
              items.map((n) => (
                <Item
                  key={n.id}
                  $unread={!n.read}
                  onClick={() => !n.read && markRead(n.id)}
                >
                  <strong>{n.message}</strong>
                  <span>{when(n.created_at)}</span>
                </Item>
              ))
            )}
          </List>
        </Panel>
      )}
    </Wrap>
  );
};

export default NotificationBell;
