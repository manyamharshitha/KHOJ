import { useState } from 'react';
import styled from 'styled-components';
import Button from '../ui/Button';
import { TextInput } from './dashboardUI';
import {
  COMMON_QUESTIONS,
  BUY_QUESTIONS,
  RENT_QUESTIONS,
  MAX_SECONDARY_PICKS,
  LOCALITIES,
} from '../../data/onboardingQuestions';

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 300;
  background: ${({ theme }) => theme.bg};
  display: flex;
  flex-direction: column;
  overflow-y: auto;
`;

const ProgressTrack = styled.div`
  height: 3px;
  background: ${({ theme }) => theme.rule};
  flex: none;
`;

const ProgressFill = styled.div`
  height: 100%;
  width: ${({ $pct }) => $pct}%;
  background: ${({ theme }) => theme.gold};
  transition: width 0.3s ease;
`;

const SkipRow = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: 1.2rem 1.2rem 0;
  flex: none;
`;

const SkipLink = styled.button`
  font-size: 0.8rem;
  color: ${({ theme }) => theme.muted};
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.4rem;

  &:hover {
    color: ${({ theme }) => theme.ink};
  }
`;

const Center = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 6vw 3rem;
`;

const Box = styled.div`
  width: 100%;
  max-width: 460px;
  text-align: center;
`;

const Kicker = styled.span`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  display: block;
  margin-bottom: 1rem;
`;

const Heading = styled.h1`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(1.4rem, 5vw, 2.1rem);
  letter-spacing: -0.02em;
  line-height: 1.2;
  margin: 0 0 0.8rem;
  color: ${({ theme }) => theme.ink};
`;

const Sub = styled.p`
  font-size: 0.9rem;
  line-height: 1.6;
  color: ${({ theme }) => theme.muted};
  margin: 0 0 2rem;
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.7rem;
  flex-wrap: wrap;
`;

const QCount = styled.p`
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.64rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  margin: 0 0 1.1rem;
`;

const QCard = styled.div`
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.rule};
  border-radius: 14px;
  padding: 1.8rem 1.4rem;
  margin-bottom: 1.4rem;

  @media (min-width: 480px) {
    padding: 2.2rem 1.8rem;
  }
`;

const QText = styled.h2`
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: clamp(1.15rem, 4vw, 1.35rem);
  letter-spacing: -0.01em;
  margin: 0 0 1.3rem;
  color: ${({ theme }) => theme.ink};
`;

const OptionGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.55rem;
  margin-bottom: 1.1rem;
`;

const OptionPill = styled.button`
  font-size: 0.84rem;
  font-weight: 500;
  padding: 0.55rem 1rem;
  border-radius: 999px;
  border: 1px solid ${({ theme, $active }) => ($active ? theme.ink : theme.rule2)};
  background: ${({ theme, $active }) => ($active ? theme.ink : theme.surface)};
  color: ${({ theme, $active }) => ($active ? theme.bg : theme.ink2)};
  cursor: pointer;
  transition: 0.15s ease;
`;

const SuggestList = styled.ul`
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0.25rem;
  border: 1px solid ${({ theme }) => theme.line};
  border-radius: 10px;
  background: ${({ theme }) => theme.surface};
  max-height: 200px;
  overflow-y: auto;
  text-align: left;
`;

const SuggestItem = styled.li`
  padding: 0.5rem 0.7rem;
  border-radius: 7px;
  cursor: pointer;
  font-size: 0.9rem;
  color: ${({ theme }) => theme.ink};

  &:hover,
  &[data-active='true'] {
    background: ${({ theme }) => theme.surface2};
  }
`;

const CustomForm = styled.form`
  display: flex;
  gap: 0.5rem;

  @media (max-width: 420px) {
    flex-direction: column;
  }
`;

const SecondaryHead = styled.div`
  margin-bottom: 1.4rem;
`;

const SecondaryCount = styled.p`
  font-size: 0.82rem;
  color: ${({ theme }) => theme.muted};
  margin: 0.4rem 0 0;

  strong {
    color: ${({ theme }) => theme.ink};
  }
`;

const ChipGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.55rem;
  margin-bottom: 1.2rem;
`;

const Chip = styled.button`
  font-size: 0.82rem;
  font-weight: 500;
  padding: 0.5rem 0.9rem;
  border-radius: 10px;
  border: 1px solid ${({ theme, $active }) => ($active ? theme.gold : theme.rule2)};
  background: ${({ theme, $active }) => ($active ? theme.goldSoft : theme.surface)};
  color: ${({ theme, $active }) => ($active ? theme.ink : theme.ink2)};
  cursor: pointer;
  transition: 0.15s ease;
  opacity: ${({ $disabled }) => ($disabled ? 0.4 : 1)};
`;

const buildQuestionCard = (base, overrides) => ({
  id: base.id,
  text: base.text,
  category: null,
  options: [],
  selectedOption: null,
  customOptions: [],
  required: false,
  custom: true,
  included: true,
  ...overrides,
});

const Onboarding = ({ firstName, onComplete, onSkip }) => {
  const [stage, setStage] = useState('welcome');
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [draft, setDraft] = useState('');
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [secondaryPicked, setSecondaryPicked] = useState([]);
  const [secondaryCustom, setSecondaryCustom] = useState([]);
  const [secondaryDraft, setSecondaryDraft] = useState('');

  const currentQ = COMMON_QUESTIONS[qIndex];

  // Only the locality step autocompletes. Matches anywhere in the name, so
  // "nagar" finds Anna Nagar and Kalyan Nagar, not just names starting with it.
  const suggestions =
    currentQ?.id === 'locality' && draft.trim()
      ? LOCALITIES.filter((x) => x.toLowerCase().includes(draft.trim().toLowerCase())).slice(0, 6)
      : [];
  const dealType = answers.dealType;
  const secondaryBank = dealType === 'Buy' ? BUY_QUESTIONS : RENT_QUESTIONS;
  const secondaryTotal = secondaryPicked.length + secondaryCustom.length;

  const stagePct =
    stage === 'welcome'
      ? 4
      : stage === 'questions'
        ? 10 + (qIndex / COMMON_QUESTIONS.length) * 65
        : stage === 'secondary'
          ? 85
          : 100;

  const answerCurrent = (value) => {
    setAnswers((prev) => ({ ...prev, [currentQ.id]: value }));
  };

  const goNextQuestion = () => {
    setDraft('');
    if (qIndex < COMMON_QUESTIONS.length - 1) {
      setQIndex((i) => i + 1);
    } else {
      setStage('secondary');
    }
  };

  const goPrevQuestion = () => {
    setDraft('');
    if (qIndex > 0) setQIndex((i) => i - 1);
    else setStage('welcome');
  };

  const submitCustomAnswer = (e) => {
    e.preventDefault();
    // Enter with a suggestion highlighted takes the suggestion, not the
    // half-typed text underneath it.
    const text = (activeSuggestion >= 0 ? suggestions[activeSuggestion] : draft).trim();
    if (!text) return;
    setActiveSuggestion(-1);
    answerCurrent(text);
    goNextQuestion();
  };

  const chooseSuggestion = (value) => {
    setActiveSuggestion(-1);
    answerCurrent(value);
    goNextQuestion();
  };

  /** Arrow keys move the highlight; Escape dismisses the list. */
  const onSuggestKeyDown = (e) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setActiveSuggestion(-1);
      setDraft('');
    }
  };

  const toggleSecondary = (id) => {
    setSecondaryPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (secondaryTotal >= MAX_SECONDARY_PICKS) return prev;
      return [...prev, id];
    });
  };

  const addSecondaryCustom = (e) => {
    e.preventDefault();
    const text = secondaryDraft.trim();
    if (!text || secondaryTotal >= MAX_SECONDARY_PICKS) return;
    setSecondaryCustom((prev) => [...prev, text]);
    setSecondaryDraft('');
  };

  const finish = () => {
    const commonCards = COMMON_QUESTIONS.map((q) => {
      const answer = answers[q.id] || null;
      const isPreset = answer && q.options.includes(answer);
      return buildQuestionCard(q, {
        category: 'From your setup',
        options: q.options,
        selectedOption: answer,
        customOptions: answer && !isPreset ? [answer] : [],
        custom: false,
      });
    });

    const pickedBankCards = secondaryBank
      .filter((q) => secondaryPicked.includes(q.id))
      .map((q) => buildQuestionCard(q, { category: dealType === 'Buy' ? 'Buying priorities' : 'Renting priorities' }));

    const customCards = secondaryCustom.map((text, i) =>
      buildQuestionCard(
        { id: `onboarding-custom-${i}-${Date.now()}`, text },
        { category: dealType === 'Buy' ? 'Buying priorities' : 'Renting priorities' }
      )
    );

    onComplete([...commonCards, ...pickedBankCards, ...customCards]);
  };

  return (
    <Overlay>
      <ProgressTrack>
        <ProgressFill $pct={stagePct} />
      </ProgressTrack>
      <SkipRow>
        <SkipLink type="button" onClick={onSkip}>
          Skip setup
        </SkipLink>
      </SkipRow>

      <Center>
        <Box>
          {stage === 'welcome' && (
            <>
              <Kicker>Welcome to Khoj</Kicker>
              <Heading>Hey {firstName}, 10 quick questions.</Heading>
              <Sub>
                This is what Khoj checks before it calls a broker. Takes less than 5 minutes — we'll show you
                around the dashboard right after.
              </Sub>
              <Actions>
                <Button arrow={false} onClick={() => setStage('questions')}>
                  Let's go
                </Button>
              </Actions>
            </>
          )}

          {stage === 'questions' && (
            <>
              <QCount>
                Question {qIndex + 1} of {COMMON_QUESTIONS.length}
              </QCount>
              <QCard>
                <QText>{currentQ.text}</QText>

                {currentQ.options.length > 0 && (
                  <OptionGrid>
                    {currentQ.options.map((opt) => (
                      <OptionPill
                        key={opt}
                        type="button"
                        $active={answers[currentQ.id] === opt}
                        onClick={() => {
                          answerCurrent(opt);
                          goNextQuestion();
                        }}
                      >
                        {opt}
                      </OptionPill>
                    ))}
                  </OptionGrid>
                )}

                <CustomForm onSubmit={submitCustomAnswer}>
                  <TextInput
                    placeholder={
                      currentQ.id === 'locality'
                        ? 'Start typing an area…'
                        : currentQ.options.length > 0
                          ? 'Or write your own answer'
                          : 'Type your answer'
                    }
                    value={draft}
                    autoComplete="off"
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setActiveSuggestion(-1);
                    }}
                    onKeyDown={onSuggestKeyDown}
                  />
                  <Button type="submit" size="sm" arrow={false}>
                    Next
                  </Button>
                </CustomForm>
                {suggestions.length > 0 && (
                  <SuggestList>
                    {suggestions.map((name, i) => (
                      <SuggestItem
                        key={name}
                        data-active={i === activeSuggestion}
                        onMouseEnter={() => setActiveSuggestion(i)}
                        // onMouseDown, not onClick: the input blurring first
                        // would unmount the list before the click landed.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          chooseSuggestion(name);
                        }}
                      >
                        {name}
                      </SuggestItem>
                    ))}
                  </SuggestList>
                )}
              </QCard>
              <Actions>
                <SkipLink type="button" onClick={goPrevQuestion}>
                  Back
                </SkipLink>
                <SkipLink type="button" onClick={goNextQuestion}>
                  Skip this one
                </SkipLink>
              </Actions>
            </>
          )}

          {stage === 'secondary' && (
            <>
              <SecondaryHead>
                <Kicker>Almost done</Kicker>
                <Heading>{dealType === 'Buy' ? '5 more, just for buying.' : '5 more, just for renting.'}</Heading>
                <Sub>Pick up to {MAX_SECONDARY_PICKS} — or write your own.</Sub>
                <SecondaryCount>
                  <strong>{secondaryTotal}</strong> of {MAX_SECONDARY_PICKS} selected
                </SecondaryCount>
              </SecondaryHead>

              <ChipGrid>
                {secondaryBank.map((q) => {
                  const active = secondaryPicked.includes(q.id);
                  const disabled = !active && secondaryTotal >= MAX_SECONDARY_PICKS;
                  return (
                    <Chip key={q.id} type="button" $active={active} $disabled={disabled} onClick={() => toggleSecondary(q.id)}>
                      {q.text}
                    </Chip>
                  );
                })}
              </ChipGrid>

              <CustomForm onSubmit={addSecondaryCustom}>
                <TextInput
                  placeholder="Write your own priority"
                  value={secondaryDraft}
                  onChange={(e) => setSecondaryDraft(e.target.value)}
                  disabled={secondaryTotal >= MAX_SECONDARY_PICKS}
                />
                <Button type="submit" size="sm" arrow={false} disabled={secondaryTotal >= MAX_SECONDARY_PICKS}>
                  + Add
                </Button>
              </CustomForm>

              <Actions style={{ marginTop: '1.6rem' }}>
                <Button arrow={false} onClick={finish}>
                  Finish setup
                </Button>
              </Actions>
            </>
          )}
        </Box>
      </Center>
    </Overlay>
  );
};

export default Onboarding;
