import { z } from 'zod';
import { daysBetween, today } from './dates.js';

export const EVENT_TYPES = ['wedding', 'birthday', 'community', 'other'];
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'AED'];
export const PRIORITIES = ['essential', 'recommended', 'optional'];
/** Languages a plan can be written in, keyed by BCP 47 tag. */
export const LANGUAGES = {
  en: 'English',
  hi: 'Hindi',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
};
export const MAX_LEAD_DAYS = 3 * 365;

// Control characters other than tab, line feed and carriage return never belong in form input.
const CONTROL_CHAR = /(?![\t\n\r])\p{Cc}/u;

/** @param {number} max */
const userText = (max) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .refine((value) => !CONTROL_CHAR.test(value), 'Remove unsupported control characters.');

/**
 * Accepts today up to MAX_LEAD_DAYS ahead. "Today" is UTC, so one day of slack
 * keeps the current local date valid in time zones behind UTC.
 * @param {string} day ISO calendar day
 */
const inPlanningWindow = (day) => {
  const lead = daysBetween(today(), day);
  return lead >= -1 && lead <= MAX_LEAD_DAYS;
};

/** Event details submitted by the planning form. */
export const EventSchema = z.strictObject({
  type: z.enum(EVENT_TYPES),
  name: userText(80).default(''),
  date: z.iso
    .date('Enter a valid date.')
    .refine(inPlanningWindow, 'Choose a date between today and three years from now.'),
  guests: z
    .int('Enter a whole number of guests.')
    .min(1, 'At least one guest is needed.')
    .max(10_000, 'Plans support up to 10,000 guests.'),
  budget: z
    .number('Enter your total budget as a number.')
    .min(1, 'Enter a budget of at least 1.')
    .max(10_000_000_000, 'Enter a smaller budget.'),
  currency: z.enum(CURRENCIES),
  location: userText(100).min(2, 'Enter a city, area or venue.'),
  preferences: userText(600).default(''),
  language: z.enum(Object.keys(LANGUAGES)).default('en'),
});

/**
 * @param {number} max
 * @param {string} description guidance Gemini sees in the JSON Schema
 */
const aiText = (max, description) => z.string().trim().min(1).max(max).describe(description);

/**
 * The plan Gemini must return. It also validates plans that clients send back for refinement;
 * unknown keys (such as computed amounts and dates) are stripped.
 */
export const PlanSchema = z.object({
  title: aiText(100, 'Short, celebratory title for this plan'),
  summary: aiText(700, 'Two or three sentences on the concept and how to use the budget and time'),
  budget: z
    .array(
      z.object({
        category: aiText(60, 'Spending category, e.g. Venue or Catering'),
        percent: z
          .number()
          .describe(
            'Share of the total budget in percent. Items sum to 100 unless the user asks to spend less; the rest is kept as savings',
          ),
        note: aiText(240, 'What this covers plus one money-saving tip'),
      }),
    )
    .min(3)
    .max(10),
  timeline: z
    .array(
      z.object({
        daysBefore: z.int().describe('Whole days before the event; 0 is the event day'),
        task: aiText(240, 'One concrete action to complete'),
      }),
    )
    .min(3)
    .max(14),
  vendors: z
    .array(
      z.object({
        type: aiText(60, 'Vendor or service to book, e.g. Photographer'),
        priority: z.enum(PRIORITIES),
        bookDaysBefore: z.int().describe('Book at least this many days before the event'),
        tip: aiText(240, 'What to ask or compare before booking'),
      }),
    )
    .min(2)
    .max(10),
  ideas: z
    .array(
      z.object({
        title: aiText(80, 'Catchy name for the idea'),
        description: aiText(400, 'How to bring it to life and why it suits this event'),
      }),
    )
    .min(2)
    .max(6),
});

/** Body of `POST /api/plan`: a new plan, or a refinement of an existing one. */
export const PlanRequestSchema = z.strictObject({
  event: EventSchema,
  refine: z
    .strictObject({
      plan: PlanSchema,
      feedback: userText(400).min(3, 'Describe what you would like to change.'),
    })
    .optional(),
});

/**
 * JSON Schema for Gemini structured output, generated from PlanSchema so the two never drift.
 * Numeric bounds are dropped because they only add decoding complexity (which Gemini may
 * reject); Zod still enforces every constraint when the response is parsed.
 */
export const PLAN_JSON_SCHEMA = z.toJSONSchema(PlanSchema, {
  override: ({ jsonSchema }) => {
    delete jsonSchema.minimum;
    delete jsonSchema.maximum;
  },
});
delete PLAN_JSON_SCHEMA.$schema;

/** @typedef {z.infer<typeof EventSchema>} EventDetails */
/** @typedef {z.infer<typeof PlanSchema>} Plan */
/** @typedef {z.infer<typeof PlanRequestSchema>} PlanRequest */
