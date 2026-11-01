/** Client for the planning API. */

import { isPlan } from './shape.js';

const SERVER_ERROR = 'Something went wrong. Please try again.';

/**
 * @typedef {import('../../src/plan.js').FinalPlan} FinalPlan
 * @typedef {{ plan: FinalPlan } | { plan?: undefined, error: string, fields?: Record<string, string> }} PlanResult
 */

/**
 * Requests a new or refined plan. Rejects only when the server cannot be reached.
 * @param {{ event: import('../../src/schemas.js').EventDetails, refine?: object }} body
 * @returns {Promise<PlanResult>} the plan, or a user-facing error with per-field messages
 */
export async function requestPlan(body) {
  const response = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  /** @type {{ plan?: FinalPlan, error?: string, fields?: Record<string, string> }} */
  const payload = await response.json().catch(() => ({}));
  if (response.ok && isPlan(payload.plan)) return { plan: payload.plan };
  return { error: payload.error ?? SERVER_ERROR, fields: payload.fields };
}
