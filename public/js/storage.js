/** Keeps the current plan in the browser, so it survives a reload. Nothing is stored on a server. */

const STORAGE_KEY = 'celebrate.plan.v2';

/** @typedef {import('./render.js').SavedPlan} SavedPlan */

/** @returns {SavedPlan | null} */
export function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!value?.event || !value.plan || !Array.isArray(value.booked)) return null;
    return { ...value, done: Array.isArray(value.done) ? value.done : [] }; // Older plans had no tasks done.
  } catch {
    return null;
  }
}

/** @param {SavedPlan | null} value */
export function writeSaved(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private browsing, quota); the plan still works this visit.
  }
}
