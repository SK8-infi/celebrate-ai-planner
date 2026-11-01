/**
 * Renders a plan into the results section. Nodes are built with text content only, never
 * HTML strings, so neither AI nor user text can inject markup (and Trusted Types holds).
 */

// Locale formatters are costly to build, so each is created once and reused for every render.
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
const RELATIVE_FORMAT = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const NUMBER_FORMAT = new Intl.NumberFormat();

const PRIORITY_LABELS = {
  essential: 'Essential',
  recommended: 'Recommended',
  optional: 'Optional',
};

/**
 * Creates an element. Attributes that are null, undefined or false are skipped; `true`
 * sets a boolean attribute. String children become text nodes.
 * @param {string} tag
 * @param {Record<string, string | number | boolean | null | undefined>} [attributes]
 * @param {...(Node | string | null | undefined)} children
 * @returns {HTMLElement}
 */
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value != null && value !== false)
      node.setAttribute(name, value === true ? '' : String(value));
  }
  node.append(...children.filter((child) => child != null));
  return node;
}

/**
 * Fills the results section. AI-written text is tagged with the plan's language so screen
 * readers pronounce it correctly (WCAG 3.1.2); numbers and dates follow the user's locale.
 * @param {HTMLElement} root the results section
 * @param {{ plan: object, event: Record<string, any>, booked: string[], done: string[] }} saved
 *   with the vendor types booked and the tasks done
 */
export function renderPlan(root, { plan, event, booked, done }) {
  const lang = event.language;
  const money = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: plan.currency,
    maximumFractionDigits: 0,
  });
  const time = (day) => el('time', { datetime: day }, DATE_FORMAT.format(toDate(day)));
  const part = (id) => root.querySelector(`#${id}`);

  root.dataset.type = event.type; // Picks the decorative event sticker in CSS.
  part('plan-title').replaceChildren(el('span', { lang }, plan.title));
  part('plan-summary').replaceChildren(el('span', { lang }, plan.summary));
  part('fact-date').textContent =
    `${DATE_FORMAT.format(toDate(event.date))} · ${countdown(toDate(event.date))}`;
  part('fact-guests').textContent = NUMBER_FORMAT.format(event.guests);
  part('fact-budget').textContent = money.format(plan.total);
  part('fact-location').textContent = event.location;
  const spend = plan.budget.reduce((sum, item) => sum + item.amount, 0);
  const saving = plan.total - spend;
  part('budget-caption').textContent =
    `Suggested split of your ${money.format(plan.total)} budget` +
    (saving > 0 ? `, saving ${money.format(saving)}` : '');
  part('budget-total').textContent = money.format(spend);
  part('budget-share').textContent = `${Math.round((spend / plan.total) * 1000) / 10}%`;
  part('budget-rows').replaceChildren(...plan.budget.map((item) => budgetRow(item, money, lang)));
  part('timeline-list').replaceChildren(
    ...plan.timeline.map((task, index) =>
      timelineItem(task, index, done.includes(task.task), time, lang),
    ),
  );
  part('vendor-list').replaceChildren(
    ...plan.vendors.map((vendor, index) =>
      vendorItem(vendor, index, booked.includes(vendor.type), time, lang),
    ),
  );
  part('idea-list').replaceChildren(
    ...plan.ideas.map((idea) =>
      el('li', { lang }, el('h4', {}, idea.title), el('p', {}, idea.description)),
    ),
  );
  renderProgress(root, { plan, booked, done });
}

/** @param {string} day ISO calendar day */
const toDate = (day) => new Date(`${day}T00:00:00Z`);

/**
 * @param {Date} date a calendar day at UTC midnight
 * @returns {string} time until the day, in the user's locale ("in 60 days", "tomorrow", "today")
 */
function countdown(date) {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((date.getTime() - today) / 86_400_000);
  return RELATIVE_FORMAT.format(days, 'day');
}

/**
 * @param {ParentNode} root the results section
 * @param {{ plan: { timeline: { task: string }[], vendors: { type: string }[] }, booked: string[], done: string[] }} saved
 */
export function renderProgress(root, { plan, booked, done }) {
  const count = (items, key, ticked) => items.filter((item) => ticked.includes(item[key])).length;
  root.querySelector('#task-progress').textContent =
    `${count(plan.timeline, 'task', done)} of ${plan.timeline.length} tasks done`;
  root.querySelector('#vendor-progress').textContent =
    `${count(plan.vendors, 'type', booked)} of ${plan.vendors.length} vendors booked`;
}

/**
 * @param {{ category: string, amount: number, percent: number, note: string }} item
 * @param {Intl.NumberFormat} money
 * @param {string} lang
 */
function budgetRow(item, money, lang) {
  const bar = el('span', { class: 'bar', 'aria-hidden': 'true' });
  bar.style.setProperty('--share', `${item.percent}%`); // CSSOM, so no inline style attribute for CSP.
  return el(
    'tr',
    {},
    el('th', { scope: 'row', lang }, item.category, el('span', { class: 'note' }, item.note)),
    el('td', { class: 'num' }, money.format(item.amount)),
    el('td', { class: 'num' }, `${item.percent}%`, bar),
  );
}

/**
 * @param {{ task: string, due: string, overdue: boolean }} task
 * @param {number} index
 * @param {boolean} checked
 * @param {(day: string) => HTMLElement} time
 * @param {string} lang
 */
function timelineItem(task, index, checked, time, lang) {
  const id = `task-${index}`;
  const urgent = task.overdue ? el('strong', { class: 'badge now' }, 'Do now') : null;
  return el(
    'li',
    { class: task.overdue ? 'overdue' : null },
    el('input', { type: 'checkbox', id, name: 'task', value: task.task, checked }),
    el(
      'label',
      { for: id },
      time(task.due),
      el('span', {}, urgent, ' ', el('span', { class: 'task', lang }, task.task)),
    ),
  );
}

/**
 * @param {{ type: string, priority: string, due: string, overdue: boolean, tip: string }} vendor
 * @param {number} index
 * @param {boolean} checked
 * @param {(day: string) => HTMLElement} time
 * @param {string} lang
 */
function vendorItem(vendor, index, checked, time, lang) {
  const id = `vendor-${index}`;
  return el(
    'li',
    {},
    el('input', {
      type: 'checkbox',
      id,
      name: 'vendor',
      value: vendor.type,
      checked,
      'aria-describedby': `${id}-tip`,
    }),
    el(
      'label',
      { for: id },
      el('strong', { lang }, vendor.type),
      el('span', { class: `badge ${vendor.priority}` }, PRIORITY_LABELS[vendor.priority]),
      vendor.overdue
        ? el('span', { class: 'badge now' }, 'Book now')
        : el('span', {}, 'Book by ', time(vendor.due)),
    ),
    el('p', { class: 'tip', id: `${id}-tip`, lang }, vendor.tip),
  );
}
