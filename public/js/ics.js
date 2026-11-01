/**
 * Exports plan dates as an iCalendar (RFC 5545) file, so tasks and booking deadlines can be
 * added to Google Calendar, Outlook or Apple Calendar in one step.
 */

const MAX_LINE_OCTETS = 75;

/**
 * UTF-8 length of one character, computed from its code point instead of encoding it.
 * @param {string} char
 */
const utf8Length = (char) => {
  const code = /** @type {number} */ (char.codePointAt(0)); // char is never empty.
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  return code < 0x10000 ? 3 : 4;
};

/** @param {string} text */
const escapeText = (text) => text.replace(/[\\;,]/g, '\\$&').replace(/\r\n?|\n/g, '\\n');

/**
 * Folds a content line at 75 octets without splitting a multi-byte character (RFC 5545 §3.1).
 * @param {string} line
 */
function fold(line) {
  let folded = '';
  let octets = 0;
  for (const char of line) {
    const size = utf8Length(char);
    if (octets + size > MAX_LINE_OCTETS) {
      folded += '\r\n ';
      octets = 1;
    }
    folded += char;
    octets += size;
  }
  return folded;
}

/**
 * @param {{ event: { date: string }, plan: { title: string, timeline: { due: string, task: string }[], vendors: { due: string, type: string }[] } }} saved
 * @param {Date} [now]
 * @returns {string} iCalendar file contents with all-day events
 */
export function buildIcs({ event, plan }, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]|\.\d+/g, '');
  const entries = [
    ...plan.timeline.map(({ due, task }) => [due, task]),
    ...plan.vendors.map(({ due, type }) => [due, `Book: ${type}`]),
    [event.date, plan.title],
  ];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Celebrate//AI Event Planner//EN',
    'CALSCALE:GREGORIAN',
    ...entries.flatMap(([day, summary], index) => [
      'BEGIN:VEVENT',
      `UID:${stamp}-${index}@celebrate.planner`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day.replaceAll('-', '')}`,
      `SUMMARY:${escapeText(summary)}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
