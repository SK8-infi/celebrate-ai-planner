/** Shared fixtures for the test suite. */

const DAY_MS = 86_400_000;

/** @param {number} days @returns {string} ISO calendar day `days` from now (UTC) */
export const isoDaysFromNow = (days) =>
  new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

/** A valid planning request event, with optional overrides. */
export const validEvent = (overrides = {}) => ({
  type: 'birthday',
  name: 'Maya’s 30th',
  date: isoDaysFromNow(60),
  guests: 40,
  budget: 200_000,
  currency: 'INR',
  location: 'Pune',
  preferences: 'Garden party, vegetarian menu',
  language: 'en',
  ...overrides,
});

/** A plan as Gemini returns it, before amounts and dates are computed. */
export const aiPlan = () => ({
  title: 'Garden Glow 30th',
  summary: 'A relaxed garden party with fairy lights and a vegetarian feast.',
  budget: [
    { category: 'Venue', percent: 30, note: 'Garden hire with seating' },
    { category: 'Catering', percent: 40, note: 'Vegetarian buffet' },
    { category: 'Decor', percent: 20, note: 'Fairy lights and flowers' },
    { category: 'Entertainment', percent: 10, note: 'Acoustic duo' },
  ],
  timeline: [
    { daysBefore: 50, task: 'Book the garden venue' },
    { daysBefore: 30, task: 'Send invitations' },
    { daysBefore: 7, task: 'Confirm the headcount' },
    { daysBefore: 0, task: 'Enjoy the party' },
  ],
  vendors: [
    { type: 'Caterer', priority: 'essential', bookDaysBefore: 45, tip: 'Ask for a tasting' },
    {
      type: 'Photographer',
      priority: 'recommended',
      bookDaysBefore: 30,
      tip: 'Compare portfolios',
    },
    { type: 'Florist', priority: 'optional', bookDaysBefore: 14, tip: 'Choose seasonal flowers' },
  ],
  ideas: [
    { title: 'Memory lane', description: 'Photos from each decade on a string of lights.' },
    { title: 'Seed favours', description: 'Wildflower seed packets as thank-you gifts.' },
  ],
});

/**
 * Test double for the Google Gen AI client that records every request.
 * @param {(params: object) => unknown} [respond] returns (or throws) the SDK response
 */
export function fakeAi(respond = () => ({ text: JSON.stringify(aiPlan()) })) {
  const calls = [];
  return {
    calls,
    models: {
      generateContent: async (params) => {
        calls.push(params);
        return respond(params);
      },
    },
  };
}
