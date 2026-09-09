import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { PanelHead, Kicker, Title, Sub, Card, CardRow, Badge, Switch, IconButton, TextInput } from './dashboardUI';
import { defaultSources, findKnownSource } from '../../data/listingSources';
import { LOCATION_KEY, ONBOARDING_RESULT_KEY } from '../../data/onboardingQuestions';
import { useSearchSession } from '../../lib/SearchContext';
import { addManualListing, callAll as callAllApi } from '../../lib/api';
import ListingAddedDialog from './ListingAddedDialog';
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
      // This is the one place on this panel where offering a call is right: the
      // customer has just typed a specific number, so "call it now, or set the
      // questions first" is a real choice about a known property. It is not the
      // same as being asked to ring an unseen search result.
      setManualState({ status: 'idle', message: null });
      setManualPhone('');
      adoptSession?.(res.session_id);
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
    if (isBusy) return;

    const sites = [
      ...custom.map((c) => c.url),
      ...sources.filter((s) => s.enabled).map((s) => s.key ?? s.id),
    ].slice(0, 5); // the backend caps at five and rejects more
    if (!sites.length) return;

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

    // The ten questions decide what Khoj *asks on the call*. They were also,
    // wrongly, deciding whether a search could run at all: with none answered
    // this returned before reaching the API, so anyone who skipped setup got a
    // permanently dead "Search properties" button and a page that looked like a
    // static shell. Searching is the thing that does not need them — the worst
    // case is a broader result set.
    const text =
      buildPromptFromAnswers() ||
      ['Rental listings', localities[0] || city ? `in ${localities[0] || city}` : '']
        .filter(Boolean)
        .join(' ');

    // Move as soon as the session exists, not when the crawl ends.
    //
    // `startSearch` does not settle until the whole search has finished, so
    // navigating on its return value kept the customer on this panel for the
    // entire crawl — and, when it timed out, forever: the failure path resolves
    // to null and the navigation never ran at all. The results panel is built
    // to show a search in progress, so it is the right place to wait.
    //
    // Not awaited. The promise still runs, and the panel it lands on is already
    // polling the same session.
    void startSearch({
      prompt: text,
      city,
      localities,
      sites,
      onStarted: () => onNavigate?.('results'),
    });
  };

  /**
   * One button, two paths: a typed number is added as a listing; an empty field
   * runs the search instead.
   */
  const searchOrAdd = async (e) => {
    e.preventDefault();
    if (manualPhone.trim()) {
      await submitManual();
    } else {
      await runSearch();
    }
  };

  const busy = isBusy || manualState.status === 'saving';

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

  const toggleSource = (id) =>
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));

  const addCustom = (e) => {
    e.preventDefault();
    const url = draft.trim();
    if (!url) return;

    // A bare portal name ("nobroker"), not a pasted URL: say what to expect
    // from it, then add it anyway.
    //
    // This used to return here and refuse the source outright, because the
    // numbers are behind a login and a listing Khoj cannot ring was treated as
    // worthless. That is the wrong way round: the rent, the locality and the
    // size are all on the page and are most of what a person decides on.
    // Refusing to search MagicBricks because we cannot dial it withheld the
    // listings as well as the call.
    let note = null;
    if (!/^https?:\/\//.test(url)) {
      const known = findKnownSource(url);
      if (known?.contactGated) {
        note =
          `${known.name} will be searched and its listings shown. Its phone numbers ` +
          'sit behind a login, so Khoj cannot place a verification call to those — ' +
          "you'll see the property and can ring it yourself.";
      }
    }

    setDraftNote(note);
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
              <span>{s.note || s.url}</span>
            </SourceInfo>
            <Right>
              {/* What the badge reports is whether Khoj can *call* what it
                  finds there — every source in this list can be searched. */}
              <Badge $tone={s.native ? 'good' : s.contactGated ? 'muted' : 'accent'}>
                {s.native ? 'On Khoj' : s.contactGated ? 'Listings only' : 'Callable'}
              </Badge>
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
          disabled={isBusy || (!sources.some((s) => s.enabled) && custom.length === 0)}
          onClick={runSearch}
          style={{ width: '100%', backgroundColor: '#000', color: '#fff', padding: '0.6rem', borderRadius: '6px' }}
        >
          {isBusy ? 'Searching properties...' : 'Search Properties From Selected Sources'}
        </Button>
        {/* Against the button that started it. A failed POST leaves the
            customer on this panel — the navigation is triggered by the session
            being created, which never happened — so an error reported only on
            the Results tab would be somewhere they never reach. */}
        {error && !isBusy && (
          <FormNote $error style={{ marginTop: '0.7rem' }}>
            {error.isQuotaExhausted
              ? error.message
              : `That search could not start — ${error.message}`}
          </FormNote>
        )}
      </div>

      {added && (
        <ListingAddedDialog
          phone={added.phone}
          busy={added.busy}
          onCallNow={callAddedNow}
          onAskQuestions={askQuestionsFirst}
        />
      )}

      <Note>Custom sources are checked the same way as our defaults — no extra setup on your end.</Note>

      <PanelHead style={{ marginTop: '2.4rem' }}>
        <Kicker>Add a listing</Kicker>
        <Title>Already have a number?</Title>
        <Sub>
          Type a number you already have and Khoj adds it as a listing you can verify. Leave it
          blank and Khoj searches your enabled sources instead.
        </Sub>
      </PanelHead>

      <Card>
        <form onSubmit={searchOrAdd}>
          <AddRow as="div">
            <TextInput
              placeholder="Have a number? Type it — 10 digits, or +91… (optional)"
              value={manualPhone}
              onChange={(e) => setManualPhone(e.target.value)}
              aria-label="Phone number"
            />
            <Button type="submit" size="sm" arrow={false} disabled={busy}>
              {busy ? 'Working…' : manualPhone.trim() ? 'Add this listing' : 'Search properties'}
            </Button>
          </AddRow>

          {manualState.message && (
            <FormNote $error={manualState.status === 'error'}>{manualState.message}</FormNote>
          )}
          {!manualPhone.trim() && !hasAnswers && (
            <Note style={{ marginTop: '0.8rem' }}>
              This searches on your saved location.{' '}
              <button
                type="button"
                onClick={() => onNavigate?.('questions')}
                style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}
              >
                Answer a few questions
              </button>{' '}
              to narrow it, and to tell Khoj what to ask on the call.
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
