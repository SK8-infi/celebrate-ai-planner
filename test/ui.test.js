import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, it, mock } from 'node:test';
import axe from 'axe-core';
import { JSDOM, VirtualConsole } from 'jsdom';
import { initApp } from '../public/js/app.js';
import { finalizePlan } from '../src/plan.js';
import { CURRENCIES, EVENT_TYPES, LANGUAGES } from '../src/schemas.js';
import { aiPlan, validEvent } from './helpers.js';

const HTML = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const STORAGE_KEY = 'celebrate.plan.v1';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** A minimal fetch Response. */
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

/** A plan as the API returns it, plus the browser-side state around it. */
const savedPlan = (booked = []) => {
  const event = validEvent();
  return { event, plan: finalizePlan(aiPlan(), event), booked };
};

/** Lets the stubbed fetch and the promise chain behind it finish. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Loads index.html in jsdom, exposes its globals to the app module and starts the app.
 * @param {{ fetch?: Function, saved?: object | string }} [options]
 */
function load({ fetch = async () => reply(200, { plan: savedPlan().plan }), saved } = {}) {
  const virtualConsole = new VirtualConsole();
  // jsdom cannot navigate (file downloads); only report real script errors.
  virtualConsole.forwardTo(console, { jsdomErrors: ['unhandled-exception'] });
  const { window } = new JSDOM(HTML, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    virtualConsole,
  });
  if (saved) {
    window.localStorage.setItem(
      STORAGE_KEY,
      typeof saved === 'string' ? saved : JSON.stringify(saved),
    );
  }
  window.HTMLElement.prototype.scrollIntoView = mock.fn(); // Not implemented by jsdom.
  const fetchStub = mock.fn(fetch);
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: window.localStorage,
    FormData: window.FormData,
    fetch: fetchStub,
  });
  initApp();
  return { window, $: (selector) => window.document.querySelector(selector), fetch: fetchStub };
}

/** Fills the planning form with an event's values. */
function fillForm($, event) {
  $(`input[name="type"][value="${event.type}"]`).checked = true;
  for (const [name, value] of Object.entries(event)) {
    if (name !== 'type') $(`#${name}`).value = String(value);
  }
}

/** @returns {Promise<string[]>} axe violations as "rule: selectors" strings */
async function axeViolations(window) {
  window.eval(axe.source);
  const { violations } = await window.axe.run(window.document, {
    runOnly: { type: 'tag', values: AXE_TAGS },
  });
  // Spread into a Node array: arrays from the jsdom realm fail strict deep-equality checks.
  return [...violations].map(
    ({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target).join(', ')}`,
  );
}

afterEach(() => mock.restoreAll());

describe('planning form', () => {
  it('has no WCAG 2.2 AA or best-practice violations', async () => {
    const { window } = load();
    assert.deepEqual(await axeViolations(window), []);
  });

  it('offers exactly the options the API accepts', () => {
    const { window } = load();
    const values = (selector) =>
      [...window.document.querySelectorAll(selector)].map(({ value }) => value);
    assert.deepEqual(values('input[name="type"]'), EVENT_TYPES);
    assert.deepEqual(values('#currency option'), CURRENCIES);
    assert.deepEqual(values('#language option'), Object.keys(LANGUAGES));
  });

  it('limits the date picker to the planning window', () => {
    const { $ } = load();
    const now = new Date();
    const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((part) => String(part).padStart(2, '0'))
      .join('-');
    assert.equal($('#date').min, today);
    assert.ok($('#date').max > today);
  });

  it('flags each invalid field inline, focuses the first and clears errors on input', () => {
    const { $, window, fetch } = load();
    $('#plan-form').requestSubmit();

    for (const id of ['date', 'guests', 'budget', 'location']) {
      assert.equal($(`#${id}`).getAttribute('aria-invalid'), 'true', id);
      assert.notEqual($(`#${id}-error`).textContent, '', id);
    }
    assert.equal(window.document.activeElement, $('#date'));
    assert.equal(fetch.mock.callCount(), 0);

    $('#date').dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal($('#date').hasAttribute('aria-invalid'), false);
    assert.equal($('#date-error').textContent, '');
  });

  it('sends the event, renders an accessible plan and saves it', async () => {
    const { $, window, fetch } = load();
    const event = validEvent({ type: 'wedding', language: 'hi' });
    fillForm($, event);
    $('#plan-form').requestSubmit();
    await settle();

    const [url, init] = fetch.mock.calls[0].arguments;
    assert.equal(url, '/api/plan');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { event });

    assert.equal($('#results').hidden, false);
    assert.equal(window.document.activeElement, $('#plan-title'), 'focus moves to the new plan');
    const { scrollIntoView } = window.HTMLElement.prototype;
    assert.deepEqual(scrollIntoView.mock.calls[0].arguments, [{ block: 'start' }]);
    assert.equal(scrollIntoView.mock.calls[0].this, $('#results'));
    assert.equal($('#plan-form [role="status"]').textContent, 'Your plan is ready.');
    assert.equal($('#plan-title').textContent, 'Garden Glow 30th');
    assert.equal($('#plan-title span').lang, 'hi', 'AI text is marked with its language');
    assert.equal($('#budget-rows').children.length, 4);
    const total = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    });
    assert.equal(
      $('#budget-caption').textContent,
      `Suggested split of your ${total.format(200_000)} budget`,
    );
    assert.equal($('#budget-rows .bar').getAttribute('aria-hidden'), 'true');
    assert.equal($('#budget-share').textContent, '100%');
    assert.match($('#timeline-list time').getAttribute('datetime'), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal($('#vendor-0').getAttribute('aria-describedby'), 'vendor-0-tip');
    assert.equal($('#vendor-progress').textContent, '0 of 3 vendors booked');
    assert.equal($('#idea-list h4').textContent, 'Memory lane');
    assert.equal(JSON.parse(localStorage.getItem(STORAGE_KEY)).event.language, 'hi');
    assert.deepEqual(await axeViolations(window), []);
  });

  it('shows server validation messages next to the matching fields', async () => {
    const fields = { location: 'Enter a city, area or venue.', type: 'Invalid option' };
    const { $, window } = load({
      fetch: async () => reply(400, { error: 'Please check the highlighted details.', fields }),
    });
    fillForm($, validEvent());
    $('#plan-form').requestSubmit();
    await settle();

    assert.equal(
      $('#plan-form [role="alert"]').textContent,
      'Please check the highlighted details.',
    );
    assert.equal($('#location-error').textContent, 'Enter a city, area or venue.');
    assert.equal(window.document.activeElement, $('#location'));
    assert.equal($('#plan-form').getAttribute('aria-busy'), 'false');
  });

  it('explains failures without a JSON body and network errors', async () => {
    const failures = [
      [
        async () => ({ ok: false, status: 502, json: async () => JSON.parse('<html>') }),
        'Something went wrong. Please try again.',
      ],
      [
        async () => Promise.reject(new TypeError('Failed to fetch')),
        'Could not reach the planner. Check your connection and try again.',
      ],
    ];
    for (const [fetch, message] of failures) {
      const { $ } = load({ fetch });
      fillForm($, validEvent());
      $('#plan-form').requestSubmit();
      await settle();
      assert.equal($('#plan-form [role="alert"]').textContent, message);
      assert.equal($('#results').hidden, true);
    }
  });

  it('ignores repeat submissions while a plan is being generated', async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = () => resolve(reply(200, { plan: savedPlan().plan }));
    });
    const { $, fetch } = load({ fetch: () => pending });
    fillForm($, validEvent());
    $('#plan-form').requestSubmit();
    $('#plan-form').requestSubmit();

    assert.equal(fetch.mock.callCount(), 1);
    assert.equal($('#plan-form').getAttribute('aria-busy'), 'true');
    assert.equal($('#plan-form [type="submit"]').getAttribute('aria-disabled'), 'true');
    release();
    await settle();
    assert.equal($('#plan-form').getAttribute('aria-busy'), 'false');
  });

  it('keeps working when browser storage is unavailable', async () => {
    const { $ } = load();
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    fillForm($, validEvent());
    $('#plan-form').requestSubmit();
    await settle();
    assert.equal($('#results').hidden, false);
  });
});

describe('saved plan', () => {
  it('is restored with vendor progress, without moving focus', () => {
    const { $, window } = load({ saved: savedPlan([1]) });
    assert.equal($('#results').hidden, false);
    assert.equal($('#location').value, 'Pune');
    assert.equal($('#vendor-1').checked, true);
    assert.equal($('#vendor-progress').textContent, '1 of 3 vendors booked');
    assert.notEqual(window.document.activeElement, $('#plan-title'));
  });

  it('highlights tasks and bookings that are already overdue', () => {
    const saved = savedPlan();
    saved.plan.timeline[0].overdue = true;
    saved.plan.vendors[0].overdue = true;
    const { $ } = load({ saved });
    assert.equal($('#timeline-list li').className, 'overdue');
    assert.equal($('#timeline-list .badge').textContent, 'Do now');
    assert.match($('#vendor-list li').textContent, /Book now/);
    assert.match($('#vendor-list li:nth-child(2)').textContent, /Book by/);
  });

  it('shows the planned spend and the saving when a plan uses less than the budget', () => {
    const saved = savedPlan();
    saved.plan.budget = saved.plan.budget.map((item) => ({ ...item, amount: item.amount * 0.8 }));
    const { $ } = load({ saved });
    const money = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    });
    assert.equal(
      $('#budget-caption').textContent,
      `Suggested split of your ${money.format(200_000)} budget, saving ${money.format(40_000)}`,
    );
    assert.equal($('#budget-total').textContent, money.format(160_000));
    assert.equal($('#budget-share').textContent, '80%');
  });

  it('tracks vendor bookings as they are checked', () => {
    const { $, window } = load({ saved: savedPlan() });
    const booked = () => JSON.parse(localStorage.getItem(STORAGE_KEY)).booked;
    $('#vendor-0').click();
    $('#vendor-2').click();
    assert.equal($('#vendor-progress').textContent, '2 of 3 vendors booked');
    assert.deepEqual(booked(), [0, 2]);
    $('#vendor-0').click();
    assert.deepEqual(booked(), [2]);

    $('#feedback').dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.deepEqual(booked(), [2], 'other form changes do not affect bookings');
  });

  it('ignores corrupted data and forgets plans it cannot render', () => {
    assert.equal(load({ saved: '{not json' }).$('#results').hidden, true);
    const { $ } = load({ saved: { event: {}, plan: {}, booked: [] } });
    assert.equal($('#results').hidden, true);
    assert.equal(localStorage.getItem(STORAGE_KEY), null);
  });

  it('refines the plan with the user’s feedback', async () => {
    const saved = savedPlan();
    const refined = { ...saved.plan, title: 'Greener Garden Glow' };
    const { $, fetch } = load({ saved, fetch: async () => reply(200, { plan: refined }) });
    $('#feedback').value = 'Make it zero-waste';
    $('#refine-form').requestSubmit();
    await settle();

    const body = JSON.parse(fetch.mock.calls[0].arguments[1].body);
    assert.deepEqual(body, {
      event: saved.event,
      refine: { plan: saved.plan, feedback: 'Make it zero-waste' },
    });
    assert.equal($('#plan-title').textContent, 'Greener Garden Glow');
    assert.equal($('#feedback').value, '', 'the feedback box is cleared for the next round');
    assert.equal($('#refine-form [role="status"]').textContent, 'Your plan is ready.');
  });

  it('requires feedback before refining', () => {
    const { $, fetch } = load({ saved: savedPlan() });
    $('#refine-form').requestSubmit();
    assert.equal($('#feedback').getAttribute('aria-invalid'), 'true');
    assert.equal(fetch.mock.callCount(), 0);
  });

  it('downloads a calendar file, prints and starts over after confirmation', async () => {
    const { $, window } = load({ saved: savedPlan() });
    const createObjectURL = mock.method(URL, 'createObjectURL', () => 'blob:plan');
    mock.method(URL, 'revokeObjectURL', () => {});
    window.print = mock.fn();

    $('[data-action="calendar"]').click();
    const file = createObjectURL.mock.calls[0].arguments[0];
    assert.equal(file.type, 'text/calendar');
    assert.match(await file.text(), /^BEGIN:VCALENDAR/);

    $('[data-action="print"]').click();
    assert.equal(window.print.mock.callCount(), 1);

    $('#plan-summary').click(); // Clicks outside the action buttons do nothing.
    window.confirm = () => false;
    $('[data-action="reset"]').click();
    assert.equal($('#results').hidden, false, 'cancelling keeps the plan');

    window.confirm = () => true;
    $('[data-action="reset"]').click();
    assert.equal($('#results').hidden, true);
    assert.equal(localStorage.getItem(STORAGE_KEY), null);
    assert.equal(window.document.activeElement, $('#plan-form input'));
  });
});
