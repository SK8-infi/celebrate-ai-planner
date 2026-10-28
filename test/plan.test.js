import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocateBudget, finalizePlan, schedule } from '../src/plan.js';
import { aiPlan, validEvent } from './helpers.js';

const sum = (items) => items.reduce((total, { amount }) => total + amount, 0);
const item = (category, percent) => ({ category, percent, note: '' });

describe('allocateBudget', () => {
  it('splits the total exactly, giving leftover units to the largest remainders', () => {
    const result = allocateBudget([item('A', 33.4), item('B', 33.3), item('C', 33.3)], 100);
    assert.deepEqual(
      result.map(({ amount }) => amount),
      [34, 33, 33],
    );
    assert.equal(sum(result), 100);
  });

  it('scales percentages above 100 down so a plan never overspends', () => {
    const result = allocateBudget([item('A', 50), item('B', 50), item('C', 50)], 9_000);
    assert.deepEqual(
      result.map(({ percent, amount }) => [percent, amount]),
      [
        [33.3, 3_000],
        [33.3, 3_000],
        [33.3, 3_000],
      ],
    );
  });

  it('keeps the unallocated share as savings when percentages add up to less than 100', () => {
    const result = allocateBudget([item('Venue', 50), item('Food', 30.5)], 1_000);
    assert.deepEqual(
      result.map(({ percent, amount }) => [percent, amount]),
      [
        [50, 500],
        [30.5, 305],
      ],
    );
  });

  it('treats zero, negative and non-numeric weights as no share', () => {
    const result = allocateBudget([item('A', 100), item('B', -5), item('C', Number.NaN)], 1_000);
    assert.deepEqual(
      result.map(({ category, amount }) => [category, amount]),
      [
        ['A', 1_000],
        ['B', 0],
        ['C', 0],
      ],
    );
  });

  it('splits evenly when the model gives no usable weights', () => {
    const result = allocateBudget([item('A', 0), item('B', 0)], 101);
    assert.deepEqual(
      result.map(({ amount }) => amount),
      [51, 50],
    );
  });

  it('rounds fractional budgets to whole units and sorts by amount', () => {
    const result = allocateBudget([item('Small', 10), item('Big', 90)], 1_000.6);
    assert.deepEqual(
      result.map(({ category }) => category),
      ['Big', 'Small'],
    );
    assert.equal(sum(result), 1_001);
  });
});

describe('schedule', () => {
  const lead = (task) => task.daysBefore;

  it('turns lead times into due dates, earliest first', () => {
    const tasks = [
      { daysBefore: 0, task: 'Party' },
      { daysBefore: 10, task: 'Invite' },
    ];
    assert.deepEqual(schedule(tasks, lead, '2026-12-20', '2026-11-01'), [
      { daysBefore: 10, task: 'Invite', due: '2026-12-10', overdue: false },
      { daysBefore: 0, task: 'Party', due: '2026-12-20', overdue: false },
    ]);
  });

  it('moves past-due items to today and flags them', () => {
    const [task] = schedule(
      [{ daysBefore: 90, task: 'Book venue' }],
      lead,
      '2026-12-20',
      '2026-12-01',
    );
    assert.equal(task.due, '2026-12-01');
    assert.equal(task.overdue, true);
  });

  it('treats negative lead times as the event day', () => {
    const [task] = schedule(
      [{ daysBefore: -3, task: 'Thank-you notes' }],
      lead,
      '2026-12-20',
      '2026-12-01',
    );
    assert.equal(task.due, '2026-12-20');
  });
});

describe('finalizePlan', () => {
  it('adds currency, exact amounts and calendar dates for the event', () => {
    const event = validEvent({ date: '2026-12-20', budget: 200_000.4 });
    const plan = finalizePlan(aiPlan(), event, new Date('2026-10-29T10:00:00Z'));

    assert.equal(plan.currency, 'INR');
    assert.equal(plan.total, 200_000);
    assert.equal(sum(plan.budget), 200_000);
    assert.equal(plan.timeline[0].due, '2026-10-31');
    assert.equal(plan.timeline.at(-1).due, '2026-12-20');
    assert.deepEqual(
      plan.vendors.map(({ due }) => due),
      ['2026-11-05', '2026-11-20', '2026-12-06'],
    );
    assert.equal(plan.ideas.length, 2);
  });
});
