import { buildIcs } from './ics.js';
import { renderPlan, renderProgress } from './render.js';

const STORAGE_KEY = 'celebrate.plan.v2';
const MAX_LEAD_DAYS = 3 * 365 - 1; // One day inside the server's limit, to absorb time-zone offsets.
const NETWORK_ERROR = 'Could not reach the planner. Check your connection and try again.';

/**
 * A plan with its request, the vendor types the user has booked and the tasks they have done.
 * @typedef {{ event: Record<string, string | number>, plan: any, booked: string[], done: string[] }} SavedPlan
 */

/** Connects the planner UI to the API. Call once the DOM is ready. */
export function initApp() {
  const planForm = document.getElementById('plan-form');
  const refineForm = document.getElementById('refine-form');
  const results = document.getElementById('results');
  const undoButton = results.querySelector('[data-action="undo"]');
  const pageTitle = document.title;
  /** @type {SavedPlan | null} */
  let saved = readSaved();
  /** @type {SavedPlan | null} the plan the last request replaced, so it can be restored */
  let previous = null;

  setDateLimits(planForm.elements.namedItem('date'));
  if (saved) {
    try {
      fillForm(planForm, saved.event);
      show(false);
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
    const feedback = refineForm.elements.namedItem('feedback').value;
    const body = { event: saved.event, refine: { plan: saved.plan, feedback } };
    submit(refineForm, body, saved);
  });
  for (const form of [planForm, refineForm]) {
    form.addEventListener('input', (event) => showFieldError(event.target, ''));
  }
  results.addEventListener('change', onToggle);
  results.addEventListener('click', onAction);

  /**
   * Requests a plan and renders it, reporting progress in the form's live regions.
   * @param {HTMLFormElement} form the form that triggered the request
   * @param {{ event: Record<string, string | number>, refine?: object }} body
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
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const elsewhere = showFieldErrors(form, payload.fields);
        const error = payload.error ?? 'Something went wrong. Please try again.';
        setStatus(form, { error: [error, ...elsewhere].join(' ') });
        return;
      }
      const { timeline, vendors } = payload.plan;
      previous = saved;
      saved = {
        event: body.event,
        plan: payload.plan,
        booked: progress.booked.filter((type) => vendors.some((vendor) => vendor.type === type)),
        done: progress.done.filter((task) => timeline.some((item) => item.task === task)),
      };
      writeSaved(saved);
      if (form === refineForm) form.reset();
      setStatus(form, { message: 'Your plan is ready.' });
      show(true);
    } catch {
      setStatus(form, { error: NETWORK_ERROR });
    }
  }

  /** @param {boolean} moveFocus whether to move focus to the plan (only after a user request) */
  function show(moveFocus) {
    renderPlan(results, saved);
    results.hidden = false;
    undoButton.hidden = !previous; // Replacing a plan is always reversible (WCAG 3.3.6).
    document.title = `${saved.plan.title} · Celebrate`;
    if (!moveFocus) return;
    document.getElementById('plan-title').focus({ preventScroll: true });
    results.scrollIntoView({ block: 'start' }); // Smooth unless the user prefers reduced motion.
  }

  /**
   * Records a vendor booked or a task done when its checkbox changes.
   * @param {Event} event
   */
  function onToggle(event) {
    const box = event.target;
    const list = { vendor: 'booked', task: 'done' }[box.name];
    if (box.type !== 'checkbox' || !list || !saved) return;
    saved[list] = box.checked
      ? [...saved[list], box.value]
      : saved[list].filter((value) => value !== box.value);
    writeSaved(saved);
    renderProgress(results, saved);
  }

  /** @param {MouseEvent} event */
  function onAction(event) {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!saved || !action) return;
    if (action === 'calendar') download('celebration-plan.ics', buildIcs(saved), 'text/calendar');
    if (action === 'print') window.print();
    if (action === 'undo' && previous) {
      saved = previous;
      previous = null;
      writeSaved(saved);
      fillForm(planForm, saved.event);
      show(true);
    }
    if (action === 'reset' && window.confirm('Start over? Your current plan will be cleared.')) {
      forget();
      planForm.reset();
      planForm.querySelector('input').focus();
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
 * Validates with the browser's constraint API and shows its (localised) messages inline,
 * focusing the first invalid field.
 * @param {HTMLFormElement} form
 * @returns {boolean} whether the form is valid
 */
function validate(form) {
  const fields = [...form.elements].filter((field) => field.willValidate);
  for (const field of fields) {
    showFieldError(
      field,
      field.validity.valid ? '' : field.validationMessage || 'Please check this field.',
    );
  }
  const firstInvalid = fields.find((field) => !field.validity.valid);
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
    const field = showFieldError(form.elements.namedItem(name), message);
    if (field) first ??= field;
    else elsewhere.push(message);
  }
  first?.focus();
  return elsewhere;
}

/**
 * Shows, or clears with an empty message, a field's inline error. The error element is
 * already referenced by the field's aria-describedby, so screen readers read it on focus.
 * @param {Element | RadioNodeList | null} field
 * @param {string} message
 * @returns {Element | null} the field, when an error is shown
 */
function showFieldError(field, message) {
  const slot = field?.id ? document.getElementById(`${field.id}-error`) : null;
  if (!slot) return null;
  slot.textContent = message;
  if (message) field.setAttribute('aria-invalid', 'true');
  else field.removeAttribute('aria-invalid');
  return message ? field : null;
}

/**
 * @param {HTMLFormElement} form
 * @param {{ message?: string, error?: string, busy?: boolean }} status
 */
function setStatus(form, { message = '', error = '', busy = false }) {
  form.setAttribute('aria-busy', String(busy));
  form.querySelector('[type="submit"]').setAttribute('aria-disabled', String(busy));
  form.querySelector('[role="status"]').textContent = message;
  form.querySelector('[role="alert"]').textContent = error;
}

/** @param {HTMLFormElement} form */
function readEvent(form) {
  const data = Object.fromEntries(new FormData(form));
  return { ...data, guests: Number(data.guests), budget: Number(data.budget) };
}

/**
 * @param {HTMLFormElement} form
 * @param {Record<string, string | number>} values
 */
function fillForm(form, values) {
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements.namedItem(name);
    if (field) field.value = String(value);
  }
}

/**
 * Limits the date picker to the window the server accepts, in the user's local time.
 * @param {HTMLInputElement} input
 */
function setDateLimits(input) {
  const now = new Date();
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
