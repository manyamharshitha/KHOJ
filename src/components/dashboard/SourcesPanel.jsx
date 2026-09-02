import { useState } from 'react';
import styled from 'styled-components';
import { PanelHead, Kicker, Title, Sub, Card, CardRow, Badge, Switch, IconButton, TextInput } from './dashboardUI';
import { defaultSources } from '../../data/listingSources';
import { useSearchSession } from '../../lib/SearchContext';
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
  const [draft, setDraft] = useState('');
  const [prompt, setPrompt] = useState('');

  const { startSearch, callAll, status, isBusy, error, isConfigured } = useSearchSession();

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

    const id = await startSearch({ prompt: text, sites });
    if (id) {
      await callAll();
      onNavigate?.('results');
    }
  };

  const toggleSource = (id) =>
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));

  const addCustom = (e) => {
    e.preventDefault();
    const url = draft.trim();
    if (!url) return;
    setCustom((prev) => [...prev, { id: `custom-${Date.now()}`, url }]);
    setDraft('');
  };

  const removeCustom = (id) => setCustom((prev) => prev.filter((s) => s.id !== id));

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

      <Note>Custom sources are checked the same way as our defaults — no extra setup on your end.</Note>

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
