/**
 * Planner state and its transitions. Each transition is a pure function that returns a new
 * state, so the rules (what undo restores, which progress survives a refinement) are testable
 * without a browser, and the UI only saves and renders the result.
 */

/**
 * @typedef {import('./render.js').SavedPlan} SavedPlan
 * @typedef {{ current: SavedPlan | null, previous: SavedPlan | null }} PlanState the shown plan
 *   and the one it replaced, which undo restores
 * @typedef {'booked' | 'done'} ProgressList vendor types booked, or tasks done
 */

/** @type {PlanState} */
export const EMPTY = Object.freeze({ current: null, previous: null });

/**
 * Shows a new plan and remembers the replaced one for undo. When refining, bookings and
 * finished tasks carry over if that vendor or task is still in the new plan.
 * @param {PlanState} state
 * @param {Pick<SavedPlan, 'event' | 'plan'>} next
 * @param {{ keepProgress: boolean }} options
 * @returns {PlanState}
 */
export function replacePlan(state, { event, plan }, { keepProgress }) {
  const from = keepProgress && state.current ? state.current : { booked: [], done: [] };
  const vendors = new Set(plan.vendors.map((vendor) => vendor.type));
  const tasks = new Set(plan.timeline.map((item) => item.task));
  return {
    current: {
      event,
      plan,
      booked: from.booked.filter((type) => vendors.has(type)),
      done: from.done.filter((task) => tasks.has(task)),
    },
    previous: state.current,
  };
}

/**
 * Restores the plan that the last request replaced. Undo is one step deep.
 * @param {PlanState} state
 * @returns {PlanState}
 */
export const undo = (state) => ({ current: state.previous, previous: null });

/**
 * Marks a vendor as booked or a task as done, or clears the mark.
 * @param {SavedPlan} saved
 * @param {ProgressList} list
 * @param {string} value the vendor type or task
 * @param {boolean} checked
 * @returns {SavedPlan}
 */
export function setProgress(saved, list, value, checked) {
  const others = saved[list].filter((item) => item !== value);
  return { ...saved, [list]: checked ? [...others, value] : others };
}
