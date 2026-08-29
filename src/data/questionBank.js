export const defaultQuestions = [
  { id: 'available', text: 'Is the flat still available?', category: 'Price & availability', options: [] },
  { id: 'rent', text: 'What is the actual monthly rent?', category: 'Price & availability', options: [] },
  { id: 'deposit', text: 'What is the security deposit?', category: 'Price & availability', options: [] },
  { id: 'brokerage', text: 'Is there a brokerage fee, and how much?', category: 'Price & availability', options: [] },
  {
    id: 'food',
    text: 'Any restriction on non-veg food?',
    category: 'Household fit',
    options: ['Veg only', 'Non-veg okay', 'No preference'],
  },
  {
    id: 'tenant',
    text: 'Family-only, or are bachelors okay?',
    category: 'Household fit',
    options: ['Family only', 'Bachelors okay', 'Either'],
  },
  { id: 'floor', text: 'Which floor, and is there a lift?', category: 'Logistics', options: [] },
  { id: 'parking', text: 'Is parking available?', category: 'Logistics', options: ['Must have parking', 'No preference'] },
  { id: 'movein', text: "What's the earliest move-in date?", category: 'Logistics', options: [] },
  { id: 'utilities', text: 'Are utilities included in the rent?', category: 'Logistics', options: [] },
];

export const MAX_CUSTOM_QUESTIONS = 5;
export const MAX_REQUIRED_QUESTIONS = 3;
export const MIN_MATCH_THRESHOLD = 12;
