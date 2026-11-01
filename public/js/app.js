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
import { EMPTY, replacePlan, setProgress, undo } from './state.js';
import { readSaved, writeSaved } from './storage.js';

const NETWORK_ERROR = 'Could not reach the planner. Check your connection and try again.';
/** @type {Record<string, import('./state.js').ProgressList>} the list each checkbox updates */
const PROGRESS_LISTS = { vendor: 'booked', task: 'done' };

/**
 * @typedef {import('./state.js').PlanState} PlanState
 * @typedef {import('./form.js').EventDetails} EventDetails
 * @typedef {import('./form.js').Field} Field
 */

/**
 * Connects the planner UI to the API. Call once the DOM is ready. Every change goes through
 * `update`, which saves the new state and renders it.
 */
export function initApp() {
  const planForm = /** @type {HTMLFormElement} */ (document.getElementById('plan-form'));
  const refineForm = /** @type {HTMLFormElement} */ (document.getElementById('refine-form'));
  const results = byId(document, 'results');
  const undoButton = /** @type {HTMLButtonElement} */ (
    results.querySelector('[data-action="undo"]')
  );
  const pageTitle = document.title;
  /** @type {PlanState} */
  let state = { ...EMPTY, current: readSaved() };

  setDateLimits(/** @type {HTMLInputElement} */ (field(planForm, 'date')));
  if (state.current) {
    try {
      fillForm(planForm, state.current.event);
      render(false);
    } catch {
      update(EMPTY); // A plan stored by an older version must never break the page.
    }
  }

  planForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (validate(planForm)) submit(planForm, { event: readEvent(planForm) });
  });
  refineForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const { current } = state;
    if (!current || !validate(refineForm)) return;
    const feedback = /** @type {Field} */ (field(refineForm, 'feedback')).value;
    submit(refineForm, { event: current.event, refine: { plan: current.plan, feedback } });
  });
  for (const form of [planForm, refineForm]) {
    form.addEventListener('input', (event) =>
      showFieldError(/** @type {Field} */ (event.target), ''),
    );
  }
  results.addEventListener('change', onToggle);
  results.addEventListener('click', onAction);

  /**
   * Saves a new state and shows its plan, or hides the results when there is none.
   * @param {PlanState} next
   * @param {boolean} [moveFocus] move focus to the plan (only after a user request)
   */
  function update(next, moveFocus = false) {
    state = next;
    writeSaved(state.current);
    render(moveFocus);
  }

  /** @param {boolean} moveFocus */
  function render(moveFocus) {
    const { current, previous } = state;
    results.hidden = !current;
    if (!current) {
      document.title = pageTitle;
      return;
    }
    renderPlan(results, current);
    undoButton.hidden = !previous; // Replacing a plan is always reversible (WCAG 3.3.6).
    document.title = `${current.plan.title} · Celebrate`;
    if (!moveFocus) return;
    byId(document, 'plan-title').focus({ preventScroll: true });
    results.scrollIntoView({ block: 'start' }); // Smooth unless the user prefers reduced motion.
  }

  /**
   * Requests a plan and shows it, reporting progress in the form's live regions. Refinements
   * keep the user's progress on vendors and tasks that are still in the plan.
   * @param {HTMLFormElement} form the form that triggered the request
   * @param {{ event: EventDetails, refine?: object }} body
   */
  async function submit(form, body) {
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
      if (form === refineForm) form.reset();
      setStatus(form, { message: 'Your plan is ready.' });
      const next = { event: body.event, plan: result.plan };
      update(replacePlan(state, next, { keepProgress: form === refineForm }), true);
    } catch {
      setStatus(form, { error: NETWORK_ERROR });
    }
  }

  /**
   * Records a vendor booked or a task done when its checkbox changes. Only the progress line is
   * re-rendered, so focus stays on the checkbox.
   * @param {Event} event
   */
  function onToggle(event) {
    const box = /** @type {HTMLInputElement} */ (event.target);
    const list = PROGRESS_LISTS[box.name];
    if (!list || !state.current) return;
    const current = setProgress(state.current, list, box.value, box.checked);
    state = { ...state, current };
    writeSaved(current);
    renderProgress(results, current);
  }

  /** @param {MouseEvent} event */
  function onAction(event) {
    const target = /** @type {Element} */ (event.target);
    const action = target.closest('[data-action]')?.getAttribute('data-action');
    const { current } = state;
    if (!current) return;
    switch (action) {
      case 'calendar':
        download('celebration-plan.ics', buildIcs(current), 'text/calendar');
        break;
      case 'print':
        window.print();
        break;
      case 'undo': {
        const restored = state.previous;
        if (!restored) break;
        update(undo(state), true);
        fillForm(planForm, restored.event);
        break;
      }
      case 'reset':
        if (!window.confirm('Start over? Your current plan will be cleared.')) break;
        update(EMPTY);
        planForm.reset();
        /** @type {HTMLInputElement} */ (planForm.querySelector('input')).focus();
        break;
    }
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
