import { addDays, today } from './dates.js';

/**
 * Deterministic post-processing of the AI plan. Language models are unreliable at arithmetic,
 * so Gemini proposes percentages and relative lead times while this module computes exact
 * amounts and calendar dates.
 */

/**
 * Allocates `total` across items by their `percent` of it, in whole currency units.
 * Percentages adding up to more than 100 are scaled down so a plan never exceeds the budget;
 * below 100, the rest stays unspent, which is how a plan saves money. The largest-remainder
 * method keeps the amounts summing exactly to the allocated total.
 * @template {{ percent: number }} T
 * @param {T[]} items
 * @param {number} total
 * @returns {(T & { amount: number })[]} items with percents of the total, sorted by amount
 */
export function allocateBudget(items, total) {
  const units = Math.round(total);
  const weights = items.map(({ percent }) =>
    Number.isFinite(percent) && percent > 0 ? percent : 0,
  );
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const shares = weights.map((weight) =>
    weightSum > 0 ? weight / Math.max(weightSum, 100) : 1 / items.length,
  );
  const exact = shares.map((share) => share * units);
  const amounts = exact.map(Math.floor);
  const remainders = exact.map((value, i) => value - amounts[i]);
  const allocated = Math.round(exact.reduce((sum, value) => sum + value, 0));
  const leftover = allocated - amounts.reduce((sum, amount) => sum + amount, 0);
  const byRemainder = remainders.map((_, i) => i).sort((a, b) => remainders[b] - remainders[a]);
  for (const i of byRemainder.slice(0, leftover)) amounts[i] += 1;

  return items
    .map((item, i) => ({ ...item, percent: Math.round(shares[i] * 1000) / 10, amount: amounts[i] }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Converts lead times into due dates, earliest first. Anything already past due is
 * moved to today and flagged so the user knows to act now.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => number} leadDays days before the event that the item is due
 * @param {string} eventDay ISO calendar day of the event
 * @param {string} startDay ISO calendar day the plan starts (today)
 * @returns {(T & { due: string, overdue: boolean })[]}
 */
export function schedule(items, leadDays, eventDay, startDay) {
  return items
    .map((item) => {
      const due = addDays(eventDay, -Math.max(0, leadDays(item)));
      const overdue = due < startDay;
      return { ...item, due: overdue ? startDay : due, overdue };
    })
    .sort((a, b) => a.due.localeCompare(b.due));
}

/**
 * Turns a validated AI plan into the response the UI renders.
 * @param {import('./schemas.js').Plan} plan
 * @param {import('./schemas.js').EventDetails} event
 * @param {Date} [now]
 */
export function finalizePlan(plan, event, now = new Date()) {
  const start = today(now);
  return {
    ...plan,
    currency: event.currency,
    total: Math.round(event.budget),
    budget: allocateBudget(plan.budget, event.budget),
    timeline: schedule(plan.timeline, (task) => task.daysBefore, event.date, start),
    vendors: schedule(plan.vendors, (vendor) => vendor.bookDaysBefore, event.date, start),
  };
}
