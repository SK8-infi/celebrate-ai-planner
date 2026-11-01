/**
 * Runtime shape checks for data the browser did not create: API responses and saved plans.
 * The server validates everything with Zod; these guards stop a misbehaving proxy, an older
 * version or a tampered browser storage entry from feeding the UI data it cannot render.
 */

/**
 * @typedef {import('../../src/plan.js').FinalPlan} FinalPlan
 * @typedef {import('./render.js').SavedPlan} SavedPlan
 */

/** @param {unknown} value */
const isText = (value) => typeof value === 'string';
/** @param {unknown} value */
const isNumber = (value) => Number.isFinite(value);
/** @param {unknown} value */
const isDay = (value) => isText(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * @param {unknown} value
 * @param {(item: Record<string, unknown>) => boolean} check applied to every item
 */
const isListOf = (value, check) =>
  Array.isArray(value) && value.every((item) => typeof item === 'object' && item && check(item));

/**
 * @param {any} value parsed JSON of unknown shape
 * @returns {value is FinalPlan}
 */
export function isPlan(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    isText(value.title) &&
    isText(value.summary) &&
    isText(value.currency) &&
    isNumber(value.total) &&
    isListOf(value.budget, (item) => isText(item.category) && isNumber(item.amount)) &&
    isListOf(value.timeline, (item) => isText(item.task) && isDay(item.due)) &&
    isListOf(value.vendors, (item) => isText(item.type) && isDay(item.due)) &&
    isListOf(value.ideas, (item) => isText(item.title) && isText(item.description))
  );
}

/**
 * Accepts saved plans from this version and the previous one, which had no `done` list.
 * @param {any} value parsed JSON of unknown shape
 * @returns {value is SavedPlan}
 */
export function isSavedPlan(value) {
  const isTextList = (/** @type {unknown} */ list) => Array.isArray(list) && list.every(isText);
  return (
    typeof value === 'object' &&
    value !== null &&
    isPlan(value.plan) &&
    typeof value.event === 'object' &&
    value.event !== null &&
    isDay(value.event.date) &&
    isText(value.event.location) &&
    isTextList(value.booked) &&
    (value.done === undefined || isTextList(value.done))
  );
}
