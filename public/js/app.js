import { buildIcs } from './ics.js';
import { byId, renderPlan, renderProgress } from './render.js';

const STORAGE_KEY = 'celebrate.plan.v2';
const MAX_LEAD_DAYS = 3 * 365 - 1; // One day inside the server's limit, to absorb time-zone offsets.
const NETWORK_ERROR = 'Could not reach the planner. Check your connection and try again.';
const SERVER_ERROR = 'Something went wrong. Please try again.';
/** @type {Record<string, 'booked' | 'done'>} the progress list each kind of checkbox updates */
const PROGRESS_LISTS = { vendor: 'booked', task: 'done' };

/**
 * A plan with its request, the vendor types the user has booked and the tasks they have done.
 * @typedef {import('./render.js').SavedPlan} SavedPlan
 * @typedef {import('../../src/schemas.js').EventDetails} EventDetails
 * @typedef {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} Field
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
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      /** @type {{ plan?: SavedPlan['plan'], error?: string, fields?: Record<string, string> }} */
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.plan) {
        const elsewhere = showFieldErrors(form, payload.fields);
        setStatus(form, { error: [payload.error ?? SERVER_ERROR, ...elsewhere].join(' ') });
        return;
      }
      const { plan } = payload;
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
 * @param {HTMLFormElement} form
 * @param {string} name
 * @returns {Field | RadioNodeList | null} the named control (a RadioNodeList for radio groups)
 */
const field = (form, name) =>
  /** @type {Field | RadioNodeList | null} */ (form.elements.namedItem(name));

/**
 * Validates with the browser's constraint API and shows its (localised) messages inline,
 * focusing the first invalid field.
 * @param {HTMLFormElement} form
 * @returns {boolean} whether the form is valid
 */
function validate(form) {
  const fields = /** @type {Field[]} */ ([...form.elements]).filter((item) => item.willValidate);
  for (const item of fields) {
    showFieldError(
      item,
      item.validity.valid ? '' : item.validationMessage || 'Please check this field.',
    );
  }
  const firstInvalid = fields.find((item) => !item.validity.valid);
  firstInvalid?.focus();
  return !firstInvalid;
}

/**
 * Shows server-side validation messages next to the matching fields and focuses the first.
 * @param {HTMLFormElement} form
 * @param {Record<string, string>} [fields]
 * @returns {string[]} messages for fields this form cannot show, to report in its alert
 */
function showFieldErrors(form, fields = {}) {
  const elsewhere = [];
  let first;
  for (const [name, message] of Object.entries(fields)) {
    const shown = showFieldError(field(form, name), message);
    if (shown) first ??= shown;
    else elsewhere.push(message);
  }
  first?.focus();
  return elsewhere;
}

/**
 * Shows, or clears with an empty message, a field's inline error. The error element is
 * already referenced by the field's aria-describedby, so screen readers read it on focus.
 * @param {Field | RadioNodeList | null} control
 * @param {string} message
 * @returns {Field | null} the field, when an error is shown
 */
function showFieldError(control, message) {
  const item = control && 'id' in control ? control : null; // Radio groups have no error slot.
  const slot = item && document.getElementById(`${item.id}-error`);
  if (!item || !slot) return null;
  slot.textContent = message;
  if (message) item.setAttribute('aria-invalid', 'true');
  else item.removeAttribute('aria-invalid');
  return message ? item : null;
}

/**
 * @param {HTMLFormElement} form
 * @param {{ message?: string, error?: string, busy?: boolean }} status
 */
function setStatus(form, { message = '', error = '', busy = false }) {
  const part = (/** @type {string} */ selector) =>
    /** @type {HTMLElement} */ (form.querySelector(selector));
  form.setAttribute('aria-busy', String(busy));
  part('[type="submit"]').setAttribute('aria-disabled', String(busy));
  part('[role="status"]').textContent = message;
  part('[role="alert"]').textContent = error;
}

/**
 * Reads the plan form. The server validates every value, so the shape is only asserted here.
 * @param {HTMLFormElement} form
 * @returns {EventDetails}
 */
function readEvent(form) {
  const data = Object.fromEntries(new FormData(form));
  return /** @type {EventDetails} */ ({
    ...data,
    guests: Number(data.guests),
    budget: Number(data.budget),
  });
}

/**
 * @param {HTMLFormElement} form
 * @param {Record<string, string | number>} values
 */
function fillForm(form, values) {
  for (const [name, value] of Object.entries(values)) {
    const control = field(form, name);
    if (control) control.value = String(value);
  }
}

/**
 * Limits the date picker to the window the server accepts, in the user's local time.
 * @param {HTMLInputElement} input
 */
function setDateLimits(input) {
  const now = new Date();
  /** @param {Date} date */
  const iso = (date) =>
    [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((n) => String(n).padStart(2, '0'))
      .join('-');
  input.min = iso(now);
  input.max = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + MAX_LEAD_DAYS));
}

/**
 * @param {string} filename
 * @param {string} text
 * @param {string} type MIME type
 */
function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url));
}

/** @returns {SavedPlan | null} */
function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!value?.event || !value.plan || !Array.isArray(value.booked)) return null;
    return { ...value, done: Array.isArray(value.done) ? value.done : [] }; // Older plans had no tasks done.
  } catch {
    return null;
  }
}

/** @param {SavedPlan | null} value */
function writeSaved(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private browsing, quota); the plan still works this visit.
  }
}
