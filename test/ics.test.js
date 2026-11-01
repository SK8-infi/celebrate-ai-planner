import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIcs } from '../public/js/ics.js';

const saved = (overrides = {}) => ({
  event: { date: '2026-12-20' },
  plan: {
    title: 'Garden Glow 30th',
    timeline: [{ due: '2026-11-01', task: 'Book venue; confirm date, deposit\\terms' }],
    vendors: [{ due: '2026-11-05', type: 'Caterer' }],
    ...overrides,
  },
});
const NOW = new Date('2026-10-29T08:15:30.123Z');

/** Reverses RFC 5545 line folding. */
const unfold = (ics) => ics.replaceAll('\r\n ', '');

describe('buildIcs', () => {
  it('creates an all-day event for each task, booking deadline and the event itself', () => {
    const ics = buildIcs(saved(), NOW);
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.equal(ics.match(/BEGIN:VEVENT/g).length, 3);
    assert.match(ics, /DTSTAMP:20261029T081530Z/);
    assert.match(ics, /DTSTART;VALUE=DATE:20261105\r\nSUMMARY:Book: Caterer/);
    assert.match(ics, /DTSTART;VALUE=DATE:20261220\r\nSUMMARY:Garden Glow 30th/);
  });

  it('escapes special characters in text', () => {
    assert.match(buildIcs(saved(), NOW), /SUMMARY:Book venue\\; confirm date\\, deposit\\\\terms/);
    for (const newline of ['\n', '\r\n', '\r']) {
      const multiline = buildIcs(saved({ title: `Line one${newline}Line two` }), NOW);
      assert.match(multiline, /SUMMARY:Line one\\nLine two\r\n/, JSON.stringify(newline));
    }
  });

  it('folds long lines at 75 octets without splitting multi-byte characters', () => {
    const title = 'Café 🎉 शादी की योजना '.repeat(8); // 1-, 2-, 3- and 4-byte characters.
    const ics = buildIcs(saved({ title }), NOW);
    const encoder = new TextEncoder();
    for (const line of ics.split('\r\n')) assert.ok(encoder.encode(line).length <= 75, line);
    assert.ok(unfold(ics).includes(`SUMMARY:${title}`));
  });
});
