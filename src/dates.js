/**
 * Calendar-day helpers. Days are ISO `YYYY-MM-DD` strings read as UTC midnight,
 * so arithmetic never drifts with time zones or daylight-saving changes.
 */

const DAY_MS = 86_400_000;

/** @param {string} day ISO calendar day */
const toTime = (day) => Date.parse(`${day}T00:00:00Z`);

/** @param {number} time epoch milliseconds */
const toDay = (time) => new Date(time).toISOString().slice(0, 10);

/**
 * @param {Date} [now]
 * @returns {string} the current UTC calendar day
 */
export const today = (now = new Date()) => toDay(now.getTime());

/**
 * @param {string} day ISO calendar day
 * @param {number} days whole days to add (negative to go back)
 * @returns {string} the shifted ISO calendar day
 */
export const addDays = (day, days) => toDay(toTime(day) + days * DAY_MS);

/**
 * @param {string} from ISO calendar day
 * @param {string} to ISO calendar day
 * @returns {number} whole days from `from` until `to` (negative when `to` is earlier, NaN when invalid)
 */
export const daysBetween = (from, to) => Math.round((toTime(to) - toTime(from)) / DAY_MS);
