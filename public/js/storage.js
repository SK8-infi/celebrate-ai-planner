/** Keeps the current plan in the browser so it survives a reload. Nothing is stored on a server. */

import { isSavedPlan } from './shape.js';

const STORAGE_KEY = 'celebrate.plan.v2';

/** @typedef {import('./render.js').SavedPlan} SavedPlan */

/**
 * Reads the saved plan, discarding anything that is not a plan this version can show.
 * @returns {SavedPlan | null}
 */
export function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (isSavedPlan(value)) return { ...value, done: value.done ?? [] };
    if (value !== null) localStorage.removeItem(STORAGE_KEY);
    return null;
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
