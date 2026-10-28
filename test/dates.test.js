import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, daysBetween, today } from '../src/dates.js';

describe('dates', () => {
  it('reads the current UTC calendar day', () => {
    assert.equal(today(new Date('2026-10-29T23:30:00Z')), '2026-10-29');
  });

  it('adds days across month and leap-year boundaries', () => {
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });

  it('counts whole days in either direction, unaffected by daylight saving', () => {
    assert.equal(daysBetween('2026-03-01', '2026-04-01'), 31);
    assert.equal(daysBetween('2026-04-01', '2026-03-01'), -31);
    assert.ok(Number.isNaN(daysBetween('2026-03-01', 'not-a-date')));
  });
});
