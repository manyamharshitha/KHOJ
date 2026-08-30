import { useState } from 'react';
import styled from 'styled-components';
import { PanelHead, Kicker, Title, Sub, Card, CardRow, Badge, Switch, IconButton, TextInput } from './dashboardUI';
import { defaultSources } from '../../data/listingSources';
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

const SourcesPanel = () => {
  const [sources, setSources] = useState(defaultSources);
  const [custom, setCustom] = useState([]);
  const [draft, setDraft] = useState('');

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
    </div>
  );
};

export default SourcesPanel;
