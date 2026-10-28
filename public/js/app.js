import { buildIcs } from './ics.js';
import { renderPlan, renderProgress } from './render.js';

const STORAGE_KEY = 'celebrate.plan.v1';
const MAX_LEAD_DAYS = 3 * 365 - 1; // One day inside the server's limit, to absorb time-zone offsets.
const NETWORK_ERROR = 'Could not reach the planner. Check your connection and try again.';

/** @typedef {{ event: Record<string, string | number>, plan: any, booked: number[] }} SavedPlan */

/** Connects the planner UI to the API. Call once the DOM is ready. */
export function initApp() {
  const planForm = document.getElementById('plan-form');
  const refineForm = document.getElementById('refine-form');
  const results = document.getElementById('results');
  /** @type {SavedPlan | null} */
  let saved = readSaved();

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
    submit(refineForm, { event: saved.event, refine: { plan: saved.plan, feedback } });
  });
  for (const form of [planForm, refineForm]) {
    form.addEventListener('input', (event) => showFieldError(event.target, ''));
  }
  results.addEventListener('change', onVendorToggle);
  results.addEventListener('click', onAction);

  /**
   * Requests a plan and renders it, reporting progress in the form's live regions.
   * @param {HTMLFormElement} form the form that triggered the request
   * @param {{ event: Record<string, string | number>, refine?: object }} body
   */
  async function submit(form, body) {
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
        setStatus(form, { error: payload.error ?? 'Something went wrong. Please try again.' });
        showFieldErrors(form, payload.fields);
        return;
      }
      saved = { event: body.event, plan: payload.plan, booked: [] };
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
    if (!moveFocus) return;
    document.getElementById('plan-title').focus({ preventScroll: true });
    results.scrollIntoView({ block: 'start' }); // Smooth unless the user prefers reduced motion.
  }

  /** @param {Event} event */
  function onVendorToggle(event) {
    const box = event.target;
    if (box.type !== 'checkbox' || !saved) return;
    const index = Number(box.value);
    saved.booked = box.checked ? [...saved.booked, index] : saved.booked.filter((i) => i !== index);
    writeSaved(saved);
    renderProgress(results, saved.booked.length, saved.plan.vendors.length);
  }

  /** @param {MouseEvent} event */
  function onAction(event) {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!saved || !action) return;
    if (action === 'calendar') download('celebration-plan.ics', buildIcs(saved), 'text/calendar');
    if (action === 'print') window.print();
    if (action === 'reset' && window.confirm('Start over? Your current plan will be cleared.')) {
      forget();
      planForm.reset();
      planForm.querySelector('input').focus();
    }
  }

  function forget() {
    saved = null;
    writeSaved(null);
    results.hidden = true;
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
 * Shows server-side validation messages next to the matching fields.
 * @param {HTMLFormElement} form
 * @param {Record<string, string>} [fields]
 */
function showFieldErrors(form, fields = {}) {
  const invalid = Object.entries(fields)
    .map(([name, message]) => showFieldError(form.elements.namedItem(name), message))
    .filter(Boolean);
  invalid[0]?.focus();
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
    return value?.event && value.plan && Array.isArray(value.booked) ? value : null;
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
