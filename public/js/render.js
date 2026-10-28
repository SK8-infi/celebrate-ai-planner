/**
 * Renders a plan into the results section. Nodes are built with text content only, never
 * HTML strings, so neither AI nor user text can inject markup (and Trusted Types holds).
 */

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
 * @param {ParentNode} root the results section
 * @param {{ plan: object, event: { language: string }, booked: number[] }} saved
 */
export function renderPlan(root, { plan, event, booked }) {
  const lang = event.language;
  const money = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: plan.currency,
    maximumFractionDigits: 0,
  });
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
  const time = (day) =>
    el('time', { datetime: day }, dateFormat.format(new Date(`${day}T00:00:00Z`)));
  const part = (id) => root.querySelector(`#${id}`);

  part('plan-title').replaceChildren(el('span', { lang }, plan.title));
  part('plan-summary').replaceChildren(el('span', { lang }, plan.summary));
  const spend = plan.budget.reduce((sum, item) => sum + item.amount, 0);
  const saving = plan.total - spend;
  part('budget-caption').textContent =
    `Suggested split of your ${money.format(plan.total)} budget` +
    (saving > 0 ? `, saving ${money.format(saving)}` : '');
  part('budget-total').textContent = money.format(spend);
  part('budget-share').textContent = `${Math.round((spend / plan.total) * 1000) / 10}%`;
  part('budget-rows').replaceChildren(...plan.budget.map((item) => budgetRow(item, money, lang)));
  part('timeline-list').replaceChildren(
    ...plan.timeline.map((task) => timelineItem(task, time, lang)),
  );
  part('vendor-list').replaceChildren(
    ...plan.vendors.map((vendor, index) =>
      vendorItem(vendor, index, booked.includes(index), time, lang),
    ),
  );
  part('idea-list').replaceChildren(
    ...plan.ideas.map((idea) =>
      el('li', { lang }, el('h4', {}, idea.title), el('p', {}, idea.description)),
    ),
  );
  renderProgress(root, booked.length, plan.vendors.length);
}

/**
 * @param {ParentNode} root the results section
 * @param {number} done vendors marked as booked
 * @param {number} total vendors in the plan
 */
export function renderProgress(root, done, total) {
  root.querySelector('#vendor-progress').textContent = `${done} of ${total} vendors booked`;
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
 * @param {(day: string) => HTMLElement} time
 * @param {string} lang
 */
function timelineItem(task, time, lang) {
  const urgent = task.overdue ? el('strong', { class: 'badge now' }, 'Do now') : null;
  return el(
    'li',
    { class: task.overdue ? 'overdue' : null },
    time(task.due),
    el('span', {}, urgent, ' ', el('span', { lang }, task.task)),
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
    el('input', { type: 'checkbox', id, value: index, checked, 'aria-describedby': `${id}-tip` }),
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
