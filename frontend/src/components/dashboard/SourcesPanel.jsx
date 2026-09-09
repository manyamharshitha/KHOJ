import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { PanelHead, Kicker, Title, Sub, Card, CardRow, Badge, Switch, IconButton, TextInput } from './dashboardUI';
import { defaultSources, findKnownSource } from '../../data/listingSources';
import { LOCATION_KEY, ONBOARDING_RESULT_KEY } from '../../data/onboardingQuestions';
import { useSearchSession } from '../../lib/SearchContext';
import { addManualListing, callAll as callAllApi } from '../../lib/api';
import ListingAddedDialog from './ListingAddedDialog';
import ConfirmDialog from '../ui/ConfirmDialog';
import { useProfile } from '../../lib/useKhoj';
import Button from '../ui/Button';

const SourceInfo = styled.div`
  min-width: 0;

  strong {
    display: block;
    font-size: 0.88rem;
    font-weight: 500;
    color: ${({ theme }) => theme.ink};
  }

  span {
    font-size: 0.78rem;
    color: ${({ theme }) => theme.muted};
    font-family: 'IBM Plex Mono', monospace;
  }
`;

const Right = styled.div`
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex: none;
`;

const FormNote = styled.p`
  font-size: 0.78rem;
  color: ${({ theme, $error }) => ($error ? theme.danger ?? '#b3261e' : theme.muted)};
  margin: 0.7rem 0 0;
  line-height: 1.5;
`;

const AddRow = styled.form`
  display: flex;
  gap: 0.6rem;
  margin-top: 1.2rem;

  @media (max-width: 520px) {
    flex-direction: column;
  }
`;

const Note = styled.p`
  font-size: 0.82rem;
  color: ${({ theme }) => theme.muted};
  line-height: 1.6;
  margin: 1.4rem 0 0;
`;

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * The questions already answered in onboarding/Questions, one clause per
 * answer — nobody should have to retype what they just spent ten questions
 * specifying. Shared by the search prompt and the "have a number" call, so
 * both ask exactly the same things.
 */
const answeredClauses = () => {
  let cards = [];
  try {
    cards = JSON.parse(window.localStorage.getItem(ONBOARDING_RESULT_KEY) || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(cards)) return [];

  return cards
    .filter((c) => c.included !== false && c.id !== 'city' && c.id !== 'locality')
    .map((c) => {
      const answer = c.selectedOption || c.customOptions?.[0];
      if (answer) return `${c.text} ${answer}.`;
      if (c.custom) return `Also ask: ${c.text}.`;
      return null;
    })
    .filter(Boolean);
};

const buildPromptFromAnswers = () => answeredClauses().join(' ');

const SourcesPanel = ({ onNavigate }) => {
  const [sources, setSources] = useState(defaultSources);
  const [custom, setCustom] = useState([]);

  // Custom sources live on the account, not in this component's state, so they
  // survive a reload and follow the customer to another device. `customSources`
  // is null until the profile has been fetched — distinct from an empty list,
  // which means she has genuinely removed them all and must not be re-seeded.
  const { customSources, saveCustomSources, user } = useProfile();
  useEffect(() => {
    if (!customSources) return;
    setCustom(customSources.map((url, i) => ({ id: `custom-${i}-${url}`, url })));
  }, [customSources]);

  /** Write the whole list back, so add and remove share one code path. */
  const persist = (next) => {
    setCustom(next);
    if (user) void saveCustomSources(next.map((c) => c.url)).catch(() => {});
  };
  const [draft, setDraft] = useState('');
  const [draftNote, setDraftNote] = useState(null);
  const { startSearch, adoptSession, status, isBusy, error, isConfigured } = useSearchSession();
  const hasAnswers = Boolean(buildPromptFromAnswers());

  // Adding a listing by hand. The path that still works when a portal hides
  // its phone numbers, or the page reader cannot start on the server. Asks
  // exactly the questions already answered in onboarding — the same ones a
  // real search would ask, nothing extra to fill in.
  const [manualPhone, setManualPhone] = useState('');
  const [manualState, setManualState] = useState({ status: 'idle', message: null });
  const [added, setAdded] = useState(null);

  // A search (or a manually-added number) that's ready for the go-ahead.
  // Calls are not placed as a side effect: finding/adding a number is free and
  // reversible, the call is neither.
  const [pendingCall, setPendingCall] = useState(null);
  const [callState, setCallState] = useState({ busy: false, error: null });

  const submitManual = async () => {
    setManualState({ status: 'saving', message: null });
    try {
      const notes = buildPromptFromAnswers();
      const res = await addManualListing({
        contact_number: manualPhone.trim(),
        notes: notes || undefined,
        // The backend caps custom_questions at 8; the rest still reach the
        // call via `notes`, which has no such limit.
        custom_questions: answeredClauses().slice(0, 8),
      });
      // No inline confirmation: the next step is a decision, and a line of text
      // under the form is something people scroll past. The dialog asks.
      //
      // ListingAddedDialog rather than the pendingCall path this merged with:
      // both open a modal, but that one offers "call / not now", and the choice
      // that actually matters here is "call now / set the questions first".
      // Clearing the single phone field comes from the incoming change, which
      // replaced the multi-field form this branch was written against.
      setManualState({ status: 'idle', message: null });
      setManualPhone('');
      adoptSession?.(res.session_id);
      setCallState({ busy: false, error: null });
      setAdded({
        sessionId: res.session_id,
        phone: res.contact_number,
        listingId: res.listing_id,
        busy: false,
      });
    } catch (err) {
      setManualState({ status: 'error', message: err?.message || 'Could not add that listing.' });
    }
  };

  /**
   * Start a real search over the enabled sources.
   *
   * The prompt is built from the questions already answered in onboarding —
   * nobody re-describes what they just spent ten questions specifying. Custom
   * URLs go first: she chose those, most likely because she can already see a
   * number on them, and portals keep contact details behind a login.
   */
  const runSearch = async () => {
    const text = buildPromptFromAnswers();
    if (!text || isBusy) return;

    const sites = [
      ...custom.map((c) => c.url),
      ...sources.filter((s) => s.enabled).map((s) => s.key ?? s.id),
    ].slice(0, 5); // the backend caps at five and rejects more

    // The questionnaire already asked which city and which area. Sending them
    // as fields, rather than hoping the model re-extracts them from the prompt,
    // is what makes the portal URL correct even when parsing is unavailable.
    let city;
    let localities = [];
    try {
      const saved = JSON.parse(window.localStorage.getItem(LOCATION_KEY) || '{}');
      city = saved.city || undefined;
      if (saved.locality) localities = [saved.locality];
    } catch {
      /* no saved answers is normal on a first visit */
    }

    const id = await startSearch({ prompt: text, city, localities, sites });
    if (id) {
      // Stop here and ask. Dialling used to happen automatically the moment a
      // search finished, so a customer could ring a stranger without ever
      // having agreed to it.
      setCallState({ busy: false, error: null });
      setPendingCall({ sessionId: id, prompt: text });
    }
  };

  /**
   * One button, two paths: a typed number is called directly; an empty field
   * runs the automatic search instead. Two identically-labelled "Search and
   * call" buttons used to sit on this page doing each of these separately.
   */
  const searchAndCall = async (e) => {
    e.preventDefault();
    if (manualPhone.trim()) {
      await submitManual();
    } else {
      await runSearch();
    }
  };

  const busy = isBusy || manualState.status === 'saving';

  /** Place the calls, now that the customer has said yes. */
  const confirmCall = async () => {
    if (!pendingCall) return;
    setCallState({ busy: true, error: null });
    try {
      await callAllApi(pendingCall.sessionId, 1);
      setPendingCall(null);
      setCallState({ busy: false, error: null });
      onNavigate?.('results');
    } catch (err) {
      // 403 is a rate limit, 402 is an exhausted plan. Both carry a message
      // written for the customer, so it is shown rather than replaced.
      setCallState({
        busy: false,
        error: err?.message || 'That call could not be placed.',
      });
    }
  };

  /**
   * The two answers to "listing added, now what?".
   *
   * Call now dials immediately: the customer has just been told in the dialog
   * that this rings a real person and spends a verification, so asking a second
   * time would be nagging rather than care.
   */
  const callAddedNow = async () => {
    if (!added) return;
    setAdded((prev) => ({ ...prev, busy: true }));
    try {
      await callAllApi(added.sessionId, 1);
      setAdded(null);
      onNavigate?.('results');
    } catch (err) {
      // 403 is a rate limit, 402 an exhausted plan. Both carry a message
      // written for the customer, so the dialog closes and it is shown against
      // the form rather than swallowed.
      setAdded(null);
      setManualState({
        status: 'error',
        message: err?.message || 'That call could not be placed.',
      });
    }
  };

  const askQuestionsFirst = () => {
    setAdded(null);
    onNavigate?.('questions');
  };

  /** Keep the results, skip the calls. */
  const cancelCall = () => {
    const target = pendingCall;
    setPendingCall(null);
    setCallState({ busy: false, error: null });
    if (target) onNavigate?.('results');
  };

  const toggleSource = (id) =>
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));

  const addCustom = (e) => {
    e.preventDefault();
    const url = draft.trim();
    if (!url) return;

    // A bare portal name ("nobroker"), not a pasted URL: warn now, rather than
    // after a search comes back with nothing dialable.
    if (!/^https?:\/\//.test(url)) {
      const known = findKnownSource(url);
      if (known?.contactGated) {
        setDraftNote(
          `${known.name} keeps contact numbers behind a login, and we don't have an ` +
            "agreement with them for that — so it can't be searched automatically yet. " +
            'Paste a specific listing URL instead, or add the number below if you have it.'
        );
        return;
      }
    }

    setDraftNote(null);
    // Adding the same site twice would send it two identical calls.
    if (custom.some((c) => c.url === url)) {
      setDraft('');
      return;
    }
    persist([...custom, { id: `custom-${Date.now()}`, url }]);
    setDraft('');
  };

  const removeCustom = (id) => persist(custom.filter((s) => s.id !== id));

  return (
    <div>
      <PanelHead>
        <Kicker>Sources</Kicker>
        <Title>Listing sources</Title>
        <Sub>Khoj checks these sites daily for listings that already match your questions.</Sub>
      </PanelHead>

      <Card>
        {sources.map((s) => (
          <CardRow key={s.id}>
            <SourceInfo>
              <strong>{s.name}</strong>
              <span>{s.url}</span>
            </SourceInfo>
            <Right>
              <Badge $tone="muted">Default</Badge>
              <Switch $on={s.enabled} onClick={() => toggleSource(s.id)} aria-label={`Toggle ${s.name}`} />
            </Right>
          </CardRow>
        ))}

        {custom.map((s) => (
          <CardRow key={s.id}>
            <SourceInfo>
              <strong>{s.url}</strong>
              <span>Added by you</span>
            </SourceInfo>
            <Right>
              <IconButton type="button" onClick={() => removeCustom(s.id)} aria-label="Remove source">
                <CloseIcon />
              </IconButton>
            </Right>
          </CardRow>
        ))}

        <AddRow onSubmit={addCustom}>
          <TextInput
            placeholder="Paste a listing site URL"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDraftNote(null);
            }}
          />
          <Button type="submit" size="sm" arrow={false}>
            Add source
          </Button>
        </AddRow>
        {draftNote && <FormNote>{draftNote}</FormNote>}
      </Card>

      <div style={{ marginTop: '1.2rem' }}>
        <Button
          size="sm"
          arrow={false}
          disabled={isBusy || !hasAnswers || (!sources.some((s) => s.enabled) && custom.length === 0)}
          onClick={runSearch}
          style={{ width: '100%', backgroundColor: '#000', color: '#fff', padding: '0.6rem', borderRadius: '6px' }}
        >
          {isBusy ? 'Searching properties...' : 'Search Properties From Selected Sources'}
        </Button>
      </div>

      {added && (
        <ListingAddedDialog
          phone={added.phone}
          busy={added.busy}
          onCallNow={callAddedNow}
          onAskQuestions={askQuestionsFirst}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingCall)}
        title="Place a verification call?"
        confirmLabel="Yes, call now"
        cancelLabel="Not now"
        busy={callState.busy}
        onConfirm={confirmCall}
        onCancel={cancelCall}
      >
        <p style={{ margin: '0 0 0.7rem' }}>
          Khoj will phone the owner or broker for the best match it found, say it is an AI
          assistant calling for you, and ask permission to record.
        </p>
        <p style={{ margin: '0 0 0.7rem' }}>
          This is a <strong>real phone call to a real person</strong> and it uses one of your
          daily verifications. It cannot be undone once it starts.
        </p>
        {callState.error && (
          <p style={{ margin: 0, color: '#b3261e' }}>{callState.error}</p>
        )}
      </ConfirmDialog>

      <Note>Custom sources are checked the same way as our defaults — no extra setup on your end.</Note>

      <PanelHead style={{ marginTop: '2.4rem' }}>
        <Kicker>Search and call</Kicker>
        <Title>Have a number, or search?</Title>
        <Sub>
          Type in a number you already have and Khoj calls it directly. Leave it blank and Khoj
          searches your enabled sources instead, using the questions you've already answered.
        </Sub>
      </PanelHead>

      <Card>
        <form onSubmit={searchAndCall}>
          <AddRow as="div">
            <TextInput
              placeholder="Have a number? Type it — 10 digits, or +91… (optional)"
              value={manualPhone}
              onChange={(e) => setManualPhone(e.target.value)}
              aria-label="Phone number"
            />
            <Button type="submit" size="sm" arrow={false} disabled={busy || (!manualPhone.trim() && !hasAnswers)}>
              {busy ? 'Searching…' : 'Search and call'}
            </Button>
          </AddRow>

          {manualState.message && (
            <FormNote $error={manualState.status === 'error'}>{manualState.message}</FormNote>
          )}
          {!manualPhone.trim() && !hasAnswers && (
            <Note style={{ marginTop: '0.8rem' }}>
              <button
                type="button"
                onClick={() => onNavigate?.('questions')}
                style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}
              >
                Answer a few questions
              </button>{' '}
              first, or type a number above.
            </Note>
          )}
          {!isConfigured && (
            <Note style={{ marginTop: '0.8rem' }}>
              Not connected to the server yet, so this will not run. Set VITE_API_URL and redeploy.
            </Note>
          )}
          {isBusy && <Note style={{ marginTop: '0.8rem' }}>Status: {status}</Note>}
          {error && (
            <Note style={{ marginTop: '0.8rem' }}>
              {error.isQuotaExhausted
                ? error.message
                : `Could not run that search — ${error.message}`}
            </Note>
          )}
        </form>
      </Card>
    </div>
  );
};

export default SourcesPanel;
