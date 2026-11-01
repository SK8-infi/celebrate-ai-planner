import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { finalizePlan } from '../src/plan.js';
import {
  EventSchema,
  MAX_LEAD_DAYS,
  PLAN_JSON_SCHEMA,
  PlanRequestSchema,
  PlanSchema,
} from '../src/schemas.js';
import { aiPlan, isoDaysFromNow, validEvent } from './helpers.js';

/** @returns {string[]} the first issue message for each invalid input */
const errorsFor = (overrides) =>
  EventSchema.safeParse(validEvent(overrides)).error?.issues.map(({ message }) => message) ?? [];

describe('EventSchema', () => {
  it('accepts a complete event and trims text', () => {
    const event = EventSchema.parse(validEvent({ location: '  Pune  ' }));
    assert.equal(event.location, 'Pune');
  });

  it('fills defaults for optional fields', () => {
    const { name, preferences, language, ...required } = validEvent();
    assert.deepEqual(EventSchema.parse(required), {
      ...required,
      name: '',
      preferences: '',
      language: 'en',
    });
  });

  it('rejects unknown fields, so clients cannot smuggle extra data into the prompt', () => {
    assert.match(errorsFor({ role: 'system' })[0], /Unrecognized key/);
  });

  it('accepts dates from yesterday (time-zone slack) up to three years ahead', () => {
    assert.deepEqual(errorsFor({ date: isoDaysFromNow(-1) }), []);
    assert.deepEqual(errorsFor({ date: isoDaysFromNow(MAX_LEAD_DAYS) }), []);
  });

  it('rejects past, far-future and impossible dates', () => {
    const window = 'Choose a date between today and three years from now.';
    assert.deepEqual(errorsFor({ date: isoDaysFromNow(-2) }), [window]);
    assert.deepEqual(errorsFor({ date: isoDaysFromNow(MAX_LEAD_DAYS + 1) }), [window]);
    assert.equal(errorsFor({ date: '2026-02-30' })[0], 'Enter a valid date.');
  });

  it('validates guest counts and budgets', () => {
    assert.deepEqual(errorsFor({ guests: 0 }), ['At least one guest is needed.']);
    assert.deepEqual(errorsFor({ guests: 12.5 }), ['Enter a whole number of guests.']);
    assert.deepEqual(errorsFor({ guests: 10_001 }), ['Plans support up to 10,000 guests.']);
    assert.deepEqual(errorsFor({ budget: 0 }), ['Enter a budget of at least 1.']);
    assert.deepEqual(errorsFor({ budget: '5000' }), ['Enter your total budget as a number.']);
  });

  it('rejects oversized text and control characters but keeps line breaks', () => {
    assert.deepEqual(errorsFor({ location: 'x' }), ['Enter a city, area or venue.']);
    assert.deepEqual(errorsFor({ name: 'x'.repeat(81) }), ['Use 80 characters or fewer.']);
    assert.deepEqual(errorsFor({ preferences: 'Vegan\u0000' }), [
      'Remove unsupported control characters.',
    ]);
    assert.deepEqual(errorsFor({ preferences: 'Vegan\nNo nuts\tplease' }), []);
  });

  it('rejects bidirectional overrides that disguise text, but keeps emoji sequences', () => {
    const rightToLeftOverride = String.fromCodePoint(0x202e);
    assert.deepEqual(errorsFor({ location: `Pune${rightToLeftOverride}evil` }), [
      'Remove unsupported control characters.',
    ]);
    const family = ['👨', '👩', '👧'].join(String.fromCodePoint(0x200d)); // Joined by ZWJ.
    assert.deepEqual(errorsFor({ preferences: `Family photo ${family}` }), []);
  });

  it('only allows supported enums', () => {
    assert.equal(errorsFor({ type: 'funeral' }).length, 1);
    assert.equal(errorsFor({ currency: 'BTC' }).length, 1);
    assert.equal(errorsFor({ language: 'xx' }).length, 1);
  });
});

describe('PlanSchema', () => {
  it('re-validates a finalised plan for refinement, stripping computed fields', () => {
    const plan = PlanSchema.parse(finalizePlan(aiPlan(), validEvent()));
    assert.equal('total' in plan, false);
    assert.deepEqual(Object.keys(plan.budget[0]).sort(), ['category', 'note', 'percent']);
    assert.deepEqual(Object.keys(plan.timeline[0]).sort(), ['daysBefore', 'task']);
    assert.deepEqual(Object.keys(plan.vendors[0]).sort(), [
      'bookDaysBefore',
      'priority',
      'tip',
      'type',
    ]);
  });

  it('rejects incomplete AI output', () => {
    assert.equal(PlanSchema.safeParse({ ...aiPlan(), ideas: [] }).success, false);
    assert.equal(PlanSchema.safeParse({ ...aiPlan(), title: ' ' }).success, false);
  });
});

describe('PlanRequestSchema', () => {
  it('accepts a refinement with feedback', () => {
    const request = { event: validEvent(), refine: { plan: aiPlan(), feedback: 'Make it vegan' } };
    assert.equal(PlanRequestSchema.safeParse(request).success, true);
  });

  it('requires meaningful feedback when refining', () => {
    const request = { event: validEvent(), refine: { plan: aiPlan(), feedback: ' ok ' } };
    const [issue] = PlanRequestSchema.safeParse(request).error.issues;
    assert.deepEqual(issue.path, ['refine', 'feedback']);
  });
});

describe('PLAN_JSON_SCHEMA', () => {
  const json = JSON.stringify(PLAN_JSON_SCHEMA);

  it('requires every plan section and carries guidance for the model', () => {
    assert.deepEqual(PLAN_JSON_SCHEMA.required, [
      'title',
      'summary',
      'budget',
      'timeline',
      'vendors',
      'ideas',
    ]);
    assert.match(
      PLAN_JSON_SCHEMA.properties.budget.items.properties.percent.description,
      /sum to 100/,
    );
  });

  it('omits numeric bounds and the $schema keyword that Gemini does not need', () => {
    assert.doesNotMatch(json, /"minimum"|"maximum"|\$schema/);
    assert.equal(PLAN_JSON_SCHEMA.properties.timeline.items.properties.daysBefore.type, 'integer');
  });
});
