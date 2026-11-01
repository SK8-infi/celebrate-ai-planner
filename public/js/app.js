import { requestPlan } from './api.js';
import {
  field,
  fillForm,
  readEvent,
  setDateLimits,
  setStatus,
  showFieldError,
  showFieldErrors,
  validate,
} from './form.js';
import { buildIcs } from './ics.js';
import { byId, renderPlan, renderProgress } from './render.js';
import { readSaved, writeSaved } from './storage.js';

const NETWORK_ERROR = 'Could not reach the planner. Check your connection and try again.';
/** @type {Record<string, 'booked' | 'done'>} the progress list each kind of checkbox updates */
const PROGRESS_LISTS = { vendor: 'booked', task: 'done' };

/**
 * @typedef {import('./render.js').SavedPlan} SavedPlan
 * @typedef {import('./form.js').EventDetails} EventDetails
 * @typedef {import('./form.js').Field} Field
 */

/** Connects the planner UI to the API. Call once the DOM is ready. */
export function initApp() {
  const planForm = /** @type {HTMLFormElement} */ (document.getElementById('plan-form'));
  const refineForm = /** @type {HTMLFormElement} */ (document.getElementById('refine-form'));
  const results = byId(document, 'results');
  const undoButton = /** @type {HTMLButtonElement} */ (
    results.querySelector('[data-action="undo"]')
  );
  const pageTitle = document.title;
  /** @type {SavedPlan | null} */
  let saved = readSaved();
  /** @type {SavedPlan | null} the plan the last request replaced, so it can be restored */
  let previous = null;

  setDateLimits(/** @type {HTMLInputElement} */ (field(planForm, 'date')));
  if (saved) {
    try {
      fillForm(planForm, saved.event);
      show(saved, false);
    } catch {
      forget(); // A plan stored by an older version must never break the page.
    }
  }

  planForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (validate(planForm)) submit(planForm, { event: readEvent(planForm) });
  });
  refineForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!saved || !validate(refineForm)) return;
    const feedback = /** @type {Field} */ (field(refineForm, 'feedback')).value;
    const body = { event: saved.event, refine: { plan: saved.plan, feedback } };
    submit(refineForm, body, saved);
  });
  for (const form of [planForm, refineForm]) {
    form.addEventListener('input', (event) =>
      showFieldError(/** @type {Field} */ (event.target), ''),
    );
  }
  results.addEventListener('change', onToggle);
  results.addEventListener('click', onAction);

  /**
   * Requests a plan and renders it, reporting progress in the form's live regions.
   * @param {HTMLFormElement} form the form that triggered the request
   * @param {{ event: EventDetails, refine?: object }} body
   * @param {{ booked: string[], done: string[] }} [progress] progress to keep for vendors and
   *   tasks that are still in the new plan
   */
  async function submit(form, body, progress = { booked: [], done: [] }) {
    if (form.getAttribute('aria-busy') === 'true') return;
    setStatus(form, {
      message: 'Gemini is planning your celebration. This usually takes about 10 seconds…',
      busy: true,
    });
    try {
      const result = await requestPlan(body);
      if (!result.plan) {
        const elsewhere = showFieldErrors(form, result.fields);
        setStatus(form, { error: [result.error, ...elsewhere].join(' ') });
        return;
      }
      const { plan } = result;
      const next = {
        event: body.event,
        plan,
        booked: progress.booked.filter((type) => plan.vendors.some((item) => item.type === type)),
        done: progress.done.filter((task) => plan.timeline.some((item) => item.task === task)),
      };
      previous = saved;
      saved = next;
      writeSaved(next);
      if (form === refineForm) form.reset();
      setStatus(form, { message: 'Your plan is ready.' });
      show(next, true);
    } catch {
      setStatus(form, { error: NETWORK_ERROR });
    }
  }

  /**
   * @param {SavedPlan} current the plan to show
   * @param {boolean} moveFocus whether to move focus to the plan (only after a user request)
   */
  function show(current, moveFocus) {
    renderPlan(results, current);
    results.hidden = false;
    undoButton.hidden = !previous; // Replacing a plan is always reversible (WCAG 3.3.6).
    document.title = `${current.plan.title} · Celebrate`;
    if (!moveFocus) return;
    byId(document, 'plan-title').focus({ preventScroll: true });
    results.scrollIntoView({ block: 'start' }); // Smooth unless the user prefers reduced motion.
  }

  /**
   * Records a vendor booked or a task done when its checkbox changes.
   * @param {Event} event
   */
  function onToggle(event) {
    const box = /** @type {HTMLInputElement} */ (event.target);
    const list = PROGRESS_LISTS[box.name];
    if (!list || !saved) return;
    saved[list] = box.checked
      ? [...saved[list], box.value]
      : saved[list].filter((value) => value !== box.value);
    writeSaved(saved);
    renderProgress(results, saved);
  }

  /** @param {MouseEvent} event */
  function onAction(event) {
    const target = /** @type {Element} */ (event.target);
    const action = target.closest('[data-action]')?.getAttribute('data-action');
    if (!saved || !action) return;
    if (action === 'calendar') download('celebration-plan.ics', buildIcs(saved), 'text/calendar');
    if (action === 'print') window.print();
    if (action === 'undo' && previous) {
      const restored = previous;
      saved = restored;
      previous = null;
      writeSaved(restored);
      fillForm(planForm, restored.event);
      show(restored, true);
    }
    if (action === 'reset' && window.confirm('Start over? Your current plan will be cleared.')) {
      forget();
      planForm.reset();
      /** @type {HTMLInputElement} */ (planForm.querySelector('input')).focus();
    }
  }

  function forget() {
    saved = null;
    previous = null;
    writeSaved(null);
    results.hidden = true;
    document.title = pageTitle;
  }
}

/**
 * Saves text as a file through a temporary object URL.
 * @param {string} filename
 * @param {string} text
 * @param {string} type MIME type
 */
function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url));
}
