import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { PanelHead, Kicker, Title, Sub, Card, CardRow, Badge, Switch, IconButton, TextInput } from './dashboardUI';
import { defaultSources } from '../../data/listingSources';
import { LOCATION_KEY } from '../../data/onboardingQuestions';
import { useSearchSession } from '../../lib/SearchContext';
import { addManualListing, callAll as callAllApi } from '../../lib/api';
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

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
  margin-top: 0.9rem;

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
  }
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

const SearchForm = styled.form`
  display: flex;
  gap: 0.6rem;
  align-items: center;
  flex-wrap: wrap;

  input {
    flex: 1 1 240px;
  }
`;

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
  const [prompt, setPrompt] = useState('');
  const { startSearch, adoptSession, callAll, status, isBusy, error, isConfigured } =
    useSearchSession();

  // Adding a listing by hand. The path that still works when a portal hides
  // its phone numbers, or the page reader cannot start on the server.
  const [manual, setManual] = useState({
    contact_number: '',
    title: '',
    locality: '',
    rent: '',
    maintenance: '',
    deposit: '',
  });
  const [manualState, setManualState] = useState({ status: 'idle', message: null });

  // A search that found dialable listings, waiting for the go-ahead. Calls
  // are not placed as a side effect of searching: the search is free and
  // reversible, the call is neither.
  const [pendingCall, setPendingCall] = useState(null);
  const [callState, setCallState] = useState({ busy: false, error: null });

  const setField = (k) => (e) => setManual((prev) => ({ ...prev, [k]: e.target.value }));

  const submitManual = async (e) => {
    e.preventDefault();
    if (!manual.contact_number.trim()) {
      setManualState({ status: 'error', message: 'A phone number is needed — that is what gets called.' });
      return;
    }
    setManualState({ status: 'saving', message: null });
    try {
      // Blank number fields are omitted rather than sent as 0. "Not stated" and
      // "free" are different claims, and the call is what settles which.
      const num = (v) => (String(v).trim() === '' ? undefined : Number(v));
      const res = await addManualListing({
        contact_number: manual.contact_number.trim(),
        title: manual.title.trim() || undefined,
        locality: manual.locality.trim() || undefined,
        rent: num(manual.rent),
        maintenance: num(manual.maintenance),
        deposit: num(manual.deposit),
      });
      setManualState({
        status: 'done',
        message: `Added ${res.contact_number}. It is ready to call from Results.`,
      });
      setManual({ contact_number: '', title: '', locality: '', rent: '', maintenance: '', deposit: '' });
      adoptSession?.(res.session_id);
    } catch (err) {
      setManualState({ status: 'error', message: err?.message || 'Could not add that listing.' });
    }
  };


  /**
   * Start a real search over the enabled sources.
   *
   * The customer's sentence is sent as-is — the backend parses it rather than
   * this form guessing at fields. Custom URLs go first: she chose those, most
   * likely because she can already see a number on them, and portals keep
   * contact details behind a login.
   */
  const runSearch = async (e) => {
    e.preventDefault();
    const text = prompt.trim();
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
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" size="sm" arrow={false}>
            Add source
          </Button>
        </AddRow>
      </Card>

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
        <Kicker>Add by hand</Kicker>
        <Title>Have a number already?</Title>
        <Sub>
          Type in what you know and Khoj will call it. Nothing is read from a website, so this
          works when a portal hides its numbers behind a login.
        </Sub>
      </PanelHead>

      <Card>
        <form onSubmit={submitManual}>
          <TextInput
            placeholder="Phone number — 10 digits, or +91…"
            value={manual.contact_number}
            onChange={setField('contact_number')}
            aria-label="Phone number"
          />
          <FieldGrid>
            <TextInput placeholder="What is it? e.g. 2BHK near the metro" value={manual.title} onChange={setField('title')} aria-label="Title" />
            <TextInput placeholder="Locality" value={manual.locality} onChange={setField('locality')} aria-label="Locality" />
            <TextInput placeholder="Rent (₹/month)" inputMode="numeric" value={manual.rent} onChange={setField('rent')} aria-label="Rent" />
            <TextInput placeholder="Maintenance (₹/month)" inputMode="numeric" value={manual.maintenance} onChange={setField('maintenance')} aria-label="Maintenance" />
            <TextInput placeholder="Deposit (₹)" inputMode="numeric" value={manual.deposit} onChange={setField('deposit')} aria-label="Deposit" />
          </FieldGrid>
          <AddRow as="div" style={{ marginTop: '1rem' }}>
            <Button type="submit" size="sm" arrow={false} disabled={manualState.status === 'saving'}>
              {manualState.status === 'saving' ? 'Adding…' : 'Add listing'}
            </Button>
          </AddRow>
          {manualState.message && (
            <FormNote $error={manualState.status === 'error'}>{manualState.message}</FormNote>
          )}
          <FormNote>
            Only the phone number is required. Leave a figure blank if the advert never stated it —
            the call is what settles it, and a blank is not the same claim as zero.
          </FormNote>
        </form>
      </Card>

      <Card style={{ marginTop: '1.4rem' }}>
        <SearchForm onSubmit={runSearch}>
          <TextInput
            placeholder="What are you looking for? e.g. pet-friendly 2BHK near HSR under 35k"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            aria-label="What you are looking for"
          />
          <Button type="submit" size="sm" arrow={false} disabled={isBusy || !prompt.trim()}>
            {isBusy ? 'Searching…' : 'Search and call'}
          </Button>
        </SearchForm>

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
      </Card>
    </div>
  );
};

export default SourcesPanel;
