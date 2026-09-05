export const ONBOARDING_DONE_KEY = 'khoj-onboarding-done';
export const ONBOARDING_RESULT_KEY = 'khoj-onboarding-result';

/**
 * Where the city and locality are kept.
 *
 * Separate from the questionnaire result, which is a list of display cards. The
 * search needs these two as fields — the portal URL is built from the city —
 * and digging them back out of rendered card text would be guesswork.
 */
export const LOCATION_KEY = 'khoj-location';
export const TOUR_DONE_KEY = 'khoj-tour-done';
export const MAX_SECONDARY_PICKS = 5;

export const TOUR_STEPS = [
  {
    id: 'overview',
    title: 'Overview',
    desc: 'Your home base — recent calls, match stats, and quick shortcuts to everything else.',
  },
  {
    id: 'questions',
    title: 'Questions',
    desc: 'What Khoj checks before it ever dials a broker. Pick, star, or write your own.',
  },
  {
    id: 'sources',
    title: 'Sources',
    desc: 'Where listings come from — our defaults, or any site you add yourself.',
  },
  {
    id: 'results',
    title: 'Results',
    desc: 'Every call Khoj makes, with the transcript, match score, and broker contact.',
  },
];

export const COMMON_QUESTIONS = [
  { id: 'food', text: 'Food preference?', options: ['Veg', 'Non-veg', 'Egg'] },
  { id: 'dealType', text: 'Are you renting or buying?', options: ['Rent', 'Buy'] },
  { id: 'budget', text: "What's your budget?", options: ['Under ₹25,000', 'Under ₹35,000', 'Under ₹50,000'] },
  { id: 'bhk', text: 'How many bedrooms?', options: ['1 BHK', '2 BHK', '3 BHK', '4+ BHK'] },
  { id: 'city', text: 'Which city?', options: ['Hyderabad', 'Bengaluru', 'Mumbai', 'Pune', 'Delhi NCR', 'Chennai'] },
  { id: 'locality', text: 'Preferred locality, town, or neighbourhood?', options: [] },
  { id: 'movein', text: 'When do you need to move in?', options: ['Immediately', 'Within a month', 'Flexible'] },
  { id: 'household', text: "Who's this home for?", options: ['Family', 'Bachelor', 'Couple'] },
  { id: 'parking', text: 'Do you need parking?', options: ['Yes', 'No', "Doesn't matter"] },
  { id: 'floor', text: 'Any floor preference?', options: ['Ground floor', 'Low floor', 'High floor', "Doesn't matter"] },
  { id: 'pets', text: 'Do you have pets?', options: ['Yes', 'No'] },
];

export const BUY_QUESTIONS = [
  { id: 'buy-schools', text: 'Distance from good schools' },
  { id: 'buy-safety', text: 'Safe neighbourhood for kids' },
  { id: 'buy-play', text: 'Play area or park nearby' },
  { id: 'buy-gated', text: 'Gated community with security' },
  { id: 'buy-resale', text: 'Good resale value' },
  { id: 'buy-age', text: 'Age of the building / new construction' },
  { id: 'buy-legal', text: 'Clear legal title and papers' },
  { id: 'buy-maintenance', text: 'Low maintenance or HOA charges' },
  { id: 'buy-loan', text: 'Home loan assistance available' },
  { id: 'buy-amenities', text: 'Gym, pool, or clubhouse on site' },
];

export const RENT_QUESTIONS = [
  { id: 'rent-brokerage', text: 'No or low brokerage fee' },
  { id: 'rent-lockin', text: 'Short lease lock-in period' },
  { id: 'rent-notice', text: 'Short notice period to vacate' },
  { id: 'rent-furnishing', text: 'Furnished or semi-furnished' },
  { id: 'rent-maintenance', text: 'Maintenance included in rent' },
  { id: 'rent-water', text: '24x7 water supply' },
  { id: 'rent-powerbackup', text: 'Power backup available' },
  { id: 'rent-society', text: 'Flexible society rules' },
  { id: 'rent-transit', text: 'Close to public transport' },
  { id: 'rent-internet', text: 'Broadband / internet ready' },
];

/**
 * Localities, grouped by the city they belong to.
 *
 * This used to be one flat list with Bengaluru first, so somebody searching in
 * Hyderabad was offered Yelahanka and Koramangala — suggestions that are not
 * merely unhelpful but wrong, and which produce a search the portal cannot
 * answer. Suggestions are now filtered to the chosen city.
 *
 * Typing something not on a list is still accepted. These are suggestions, not
 * a whitelist: no list of Indian neighbourhoods is ever complete.
 */
export const CITIES = ['Hyderabad', 'Bengaluru', 'Mumbai', 'Pune', 'Delhi NCR', 'Chennai'];

export const LOCALITIES_BY_CITY = {
  Hyderabad: [
    'Kondapur', 'Gachibowli', 'Madhapur', 'HITEC City', 'Kukatpally',
    'Banjara Hills', 'Jubilee Hills', 'Miyapur', 'Manikonda', 'Begumpet',
    'Ameerpet', 'Secunderabad', 'Nallagandla', 'Narsingi', 'Kompally',
  ],
  Bengaluru: [
    'Indiranagar', 'Koramangala', 'HSR Layout', 'Whitefield', 'Marathahalli',
    'Jayanagar', 'JP Nagar', 'Bellandur', 'Sarjapur Road', 'Electronic City',
    'Hebbal', 'Yelahanka', 'Rajajinagar', 'Malleshwaram', 'Banashankari',
    'BTM Layout', 'Basavanagudi', 'Domlur', 'Ulsoor', 'Kalyan Nagar',
  ],
  Mumbai: [
    'Andheri', 'Powai', 'Bandra', 'Borivali', 'Thane', 'Malad', 'Goregaon',
    'Chembur', 'Dadar', 'Navi Mumbai', 'Vashi', 'Kurla',
  ],
  Pune: [
    'Kothrud', 'Baner', 'Hinjewadi', 'Viman Nagar', 'Wakad', 'Kharadi',
    'Aundh', 'Magarpatta', 'Hadapsar', 'Balewadi',
  ],
  'Delhi NCR': [
    'Gurgaon Sector 56', 'Noida Sector 62', 'Dwarka', 'Saket', 'Rohini',
    'Indirapuram', 'Vasant Kunj', 'Greater Kailash', 'Lajpat Nagar',
  ],
  Chennai: [
    'Adyar', 'Velachery', 'Anna Nagar', 'T Nagar', 'OMR', 'Porur', 'Guindy',
    'Nungambakkam', 'Perungudi', 'Sholinganallur',
  ],
};

/**
 * Suggestions for one city.
 *
 * An unrecognised city — someone typed "Kochi" — returns nothing rather than
 * falling back to every locality in the country. Offering Bengaluru suburbs to
 * a Kochi search is worse than offering none.
 */
export function localitiesFor(city) {
  return LOCALITIES_BY_CITY[(city || '').trim()] || [];
}

/** Every locality, for the rare caller that has no city yet. */
export const LOCALITIES = Object.values(LOCALITIES_BY_CITY).flat();
