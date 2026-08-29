import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { PanelHead, Kicker, Title, Sub, IconButton, TextInput } from './dashboardUI';
import { defaultQuestions, MAX_CUSTOM_QUESTIONS, MAX_REQUIRED_QUESTIONS } from '../../data/questionBank';
import { ONBOARDING_RESULT_KEY } from '../../data/onboardingQuestions';
import Button from '../ui/Button';

const EmptyNote = styled.p`
  margin: 0;
  font-size: 0.88rem;
  color: ${({ theme }) => theme.ink2};
  padding: 0.4rem 0;
`;

const CategoryTitle = styled.h3`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.64rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  margin: 2rem 0 0.8rem;

  &:first-of-type {
    margin-top: 0;
  }
`;

const QCard = styled.div`
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.rule};
  border-radius: 10px;
  padding: 1.1rem 1.2rem;
  opacity: ${({ $included }) => ($included ? 1 : 0.5)};

  & + & {
    margin-top: 0.7rem;
  }
`;

const QTop = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
`;

const QCheck = styled.input`
  margin-top: 0.2rem;
  width: 15px;
  height: 15px;
  accent-color: ${({ theme }) => theme.ink};
  flex: none;
  cursor: pointer;
`;

const QText = styled.p`
  flex: 1;
  margin: 0;
  font-size: 0.92rem;
  color: ${({ theme }) => theme.ink};
  line-height: 1.4;
`;

const StarButton = styled.button`
  flex: none;
  width: 1.7rem;
  height: 1.7rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid ${({ theme, $on }) => ($on ? theme.gold : theme.rule2)};
  background: ${({ theme, $on }) => ($on ? theme.goldSoft : theme.surface)};
  color: ${({ theme, $on }) => ($on ? theme.gold : theme.muted)};
  cursor: pointer;

  svg {
    width: 13px;
    height: 13px;
  }
`;

const Options = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.8rem 0 0 1.75rem;
`;

const Pill = styled.button`
  font-size: 0.78rem;
  font-weight: 500;
  padding: 0.4rem 0.8rem;
  border-radius: 999px;
  border: 1px solid ${({ theme, $active }) => ($active ? theme.ink : theme.rule2)};
  background: ${({ theme, $active }) => ($active ? theme.ink : theme.surface)};
  color: ${({ theme, $active }) => ($active ? theme.bg : theme.ink2)};
  cursor: pointer;
  transition: 0.15s ease;
`;

const AddOptionRow = styled.form`
  display: flex;
  gap: 0.5rem;
  margin: 0.6rem 0 0 1.75rem;
`;

const SmallInput = styled(TextInput)`
  font-size: 0.8rem;
  padding: 0.5em 0.75em;
`;

const AddOptionButton = styled.button`
  flex: none;
  font-size: 0.78rem;
  font-weight: 500;
  padding: 0 0.9rem;
  border-radius: 0.5em;
  border: 1px dashed ${({ theme }) => theme.rule2};
  background: none;
  color: ${({ theme }) => theme.ink2};
  cursor: pointer;

  &:hover {
    border-color: ${({ theme }) => theme.ink};
    color: ${({ theme }) => theme.ink};
  }
`;

const AddRow = styled.form`
  display: flex;
  gap: 0.6rem;
  margin-top: 0.9rem;

  @media (max-width: 520px) {
    flex-direction: column;
  }
`;

const Upsell = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.9rem;
  padding: 0.9rem 1rem;
  background: ${({ theme }) => theme.goldSoft};
  border-radius: 8px;
  font-size: 0.82rem;
  color: ${({ theme }) => theme.ink2};

  a {
    font-weight: 600;
    color: ${({ theme }) => theme.ink};
    white-space: nowrap;
  }
`;

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const StarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path
      d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      fill={'currentColor'}
      fillOpacity="0.15"
    />
  </svg>
);

const seedCustom = [
  { id: 'custom-seed-1', text: 'Is there a lease lock-in period?' },
  { id: 'custom-seed-2', text: 'Is the building gated with security?' },
];

const fallbackQuestions = [
  ...defaultQuestions.map((q) => ({
    ...q,
    included: true,
    selectedOption: null,
    customOptions: [],
    required: false,
    custom: false,
  })),
  ...seedCustom.map((q) => ({
    ...q,
    category: null,
    options: [],
    included: true,
    selectedOption: null,
    customOptions: [],
    required: false,
    custom: true,
  })),
];

const loadInitialQuestions = () => {
  try {
    const raw = window.localStorage.getItem(ONBOARDING_RESULT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* ignore storage/parsing errors */
  }
  return fallbackQuestions;
};

const QuestionsPanel = () => {
  const [questions, setQuestions] = useState(loadInitialQuestions);
  const [customDraft, setCustomDraft] = useState('');
  const [optionDrafts, setOptionDrafts] = useState({});

  const categories = useMemo(() => {
    const seen = [];
    questions.forEach((q) => {
      if (q.category && !seen.includes(q.category)) seen.push(q.category);
    });
    return seen;
  }, [questions]);

  const uncategorized = questions.filter((q) => !q.category);

  const customCount = questions.filter((q) => q.custom).length;
  const requiredCount = questions.filter((q) => q.required).length;

  const toggleIncluded = (id) =>
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, included: !q.included } : q)));

  const selectOption = (id, option) =>
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, selectedOption: q.selectedOption === option ? null : option } : q))
    );

  const toggleRequired = (id) =>
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== id) return q;
        if (!q.required && requiredCount >= MAX_REQUIRED_QUESTIONS) return q;
        return { ...q, required: !q.required };
      })
    );

  const addOption = (id, e) => {
    e.preventDefault();
    const text = (optionDrafts[id] || '').trim();
    if (!text) return;
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === id ? { ...q, customOptions: [...q.customOptions, text], selectedOption: text } : q
      )
    );
    setOptionDrafts((prev) => ({ ...prev, [id]: '' }));
  };

  const addCustomQuestion = (e) => {
    e.preventDefault();
    const text = customDraft.trim();
    if (!text || customCount >= MAX_CUSTOM_QUESTIONS) return;
    setQuestions((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        text,
        category: null,
        options: [],
        included: true,
        selectedOption: null,
        customOptions: [],
        required: false,
        custom: true,
      },
    ]);
    setCustomDraft('');
  };

  const removeCustomQuestion = (id) => setQuestions((prev) => prev.filter((q) => q.id !== id));

  const renderCard = (q) => (
    <QCard key={q.id} $included={q.included}>
      <QTop>
        <QCheck type="checkbox" checked={q.included} onChange={() => toggleIncluded(q.id)} />
        <QText>{q.text}</QText>
        <StarButton
          type="button"
          $on={q.required}
          onClick={() => toggleRequired(q.id)}
          aria-label={q.required ? 'Remove as required' : 'Mark as required'}
          title={q.required ? 'Required for every call' : 'Mark as required'}
        >
          <StarIcon />
        </StarButton>
        {q.custom && (
          <IconButton type="button" onClick={() => removeCustomQuestion(q.id)} aria-label="Remove question">
            <CloseIcon />
          </IconButton>
        )}
      </QTop>

      {(q.options.length > 0 || q.customOptions.length > 0) && (
        <Options>
          {[...q.options, ...q.customOptions].map((opt) => (
            <Pill key={opt} type="button" $active={q.selectedOption === opt} onClick={() => selectOption(q.id, opt)}>
              {opt}
            </Pill>
          ))}
        </Options>
      )}

      <AddOptionRow onSubmit={(e) => addOption(q.id, e)}>
        <SmallInput
          placeholder="Add your own answer, e.g. I have a peanut allergy"
          value={optionDrafts[q.id] || ''}
          onChange={(e) => setOptionDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
        />
        <AddOptionButton type="submit">+ Add</AddOptionButton>
      </AddOptionRow>
    </QCard>
  );

  return (
    <div>
      <PanelHead>
        <Kicker>Questions</Kicker>
        <Title>Your question set</Title>
        <Sub>Pick what Khoj checks before it calls, then add anything specific to what you're looking for.</Sub>
      </PanelHead>

      {categories.map((cat) => (
        <div key={cat}>
          <CategoryTitle>{cat}</CategoryTitle>
          {questions.filter((q) => q.category === cat).map(renderCard)}
        </div>
      ))}

      <CategoryTitle>Your custom questions</CategoryTitle>
      {uncategorized.length === 0 && <EmptyNote>None added yet.</EmptyNote>}
      {uncategorized.map(renderCard)}

      {customCount < MAX_CUSTOM_QUESTIONS ? (
        <AddRow onSubmit={addCustomQuestion}>
          <TextInput
            placeholder="e.g. Is the water supply municipal or borewell?"
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
          />
          <Button type="submit" size="sm" arrow={false}>
            Add question
          </Button>
        </AddRow>
      ) : (
        <Upsell>
          <span>You've used all {MAX_CUSTOM_QUESTIONS} custom questions on this plan.</span>
          <Link to="/pricing">Upgrade to Premium →</Link>
        </Upsell>
      )}
    </div>
  );
};

export default QuestionsPanel;
