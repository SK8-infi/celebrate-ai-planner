import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMPTY, replacePlan, setProgress, undo } from '../public/js/state.js';
import { finalizePlan } from '../src/plan.js';
import { aiPlan, validEvent } from './helpers.js';

const event = validEvent();
const plan = finalizePlan(aiPlan(), event);
const saved = { event, plan, booked: ['Caterer', 'Florist'], done: ['Send invitations'] };
const NEW_PLAN = { keepProgress: false };
const REFINEMENT = { keepProgress: true };

describe('replacePlan', () => {
  it('shows a new plan with no progress and remembers the old one for undo', () => {
    const state = replacePlan({ current: saved, previous: null }, { event, plan }, NEW_PLAN);
    assert.deepEqual(state.current, { event, plan, booked: [], done: [] });
    assert.equal(state.previous, saved);
  });

  it('keeps progress on refinement only for vendors and tasks still in the plan', () => {
    const refined = {
      ...plan,
      vendors: plan.vendors.filter((vendor) => vendor.type !== 'Florist'),
    };
    const state = replacePlan(
      { current: saved, previous: null },
      { event, plan: refined },
      REFINEMENT,
    );
    assert.deepEqual(state.current?.booked, ['Caterer']);
    assert.deepEqual(state.current?.done, ['Send invitations']);
  });

  it('starts from empty progress when there is no plan yet', () => {
    const state = replacePlan(EMPTY, { event, plan }, REFINEMENT);
    assert.deepEqual([state.current?.booked, state.current?.done, state.previous], [[], [], null]);
  });
});

describe('undo', () => {
  it('restores the replaced plan, one step deep', () => {
    const replaced = replacePlan({ current: saved, previous: null }, { event, plan }, NEW_PLAN);
    assert.deepEqual(undo(replaced), { current: saved, previous: null });
  });
});

describe('setProgress', () => {
  it('adds and removes marks without changing the original plan', () => {
    const booked = setProgress(saved, 'booked', 'Photographer', true);
    assert.deepEqual(booked.booked, ['Caterer', 'Florist', 'Photographer']);
    assert.deepEqual(setProgress(booked, 'booked', 'Caterer', false).booked, [
      'Florist',
      'Photographer',
    ]);
    assert.deepEqual(setProgress(saved, 'done', 'Send invitations', true).done, [
      'Send invitations',
    ]);
    assert.deepEqual(saved.booked, ['Caterer', 'Florist'], 'the input is not mutated');
  });
});
