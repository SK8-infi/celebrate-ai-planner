/**
 * Form helpers: inline validation, error and status messages, and reading or filling values.
 * Errors are tied to fields with aria-describedby, so screen readers announce them on focus.
 */

// One day inside the server's limit, to absorb time-zone offsets.
const MAX_LEAD_DAYS = 3 * 365 - 1;

/**
 * @typedef {import('../../src/schemas.js').EventDetails} EventDetails
 * @typedef {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} Field
 */

/**
 * @param {HTMLFormElement} form
 * @param {string} name
 * @returns {Field | RadioNodeList | null} the named control (a RadioNodeList for radio groups)
 */
export const field = (form, name) =>
  /** @type {Field | RadioNodeList | null} */ (form.elements.namedItem(name));

/**
 * Validates with the browser's constraint API and shows its (localised) messages inline,
 * focusing the first invalid field.
 * @param {HTMLFormElement} form
 * @returns {boolean} whether the form is valid
 */
export function validate(form) {
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
export function showFieldErrors(form, fields = {}) {
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
export function showFieldError(control, message) {
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
export function setStatus(form, { message = '', error = '', busy = false }) {
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
export function readEvent(form) {
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
export function fillForm(form, values) {
  for (const [name, value] of Object.entries(values)) {
    const control = field(form, name);
    if (control) control.value = String(value);
  }
}

/**
 * Limits the date picker to the window the server accepts, in the user's local time.
 * @param {HTMLInputElement} input
 */
export function setDateLimits(input) {
  const now = new Date();
  /** @param {Date} date */
  const iso = (date) =>
    [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((n) => String(n).padStart(2, '0'))
      .join('-');
  input.min = iso(now);
  input.max = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + MAX_LEAD_DAYS));
}
