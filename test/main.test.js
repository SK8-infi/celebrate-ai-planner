import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, it, mock } from 'node:test';
import { JSDOM } from 'jsdom';

const HTML = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

describe('client entrypoint (main.js)', () => {
  const originalGlobals = new Map();
  const trackedGlobals = ['window', 'document', 'localStorage', 'FormData', 'fetch'];
  for (const prop of trackedGlobals) {
    if (Reflect.has(globalThis, prop)) {
      originalGlobals.set(prop, Reflect.get(globalThis, prop));
    }
  }

  afterEach(() => {
    mock.restoreAll();
    for (const prop of trackedGlobals) {
      if (originalGlobals.has(prop)) {
        globalThis[prop] = originalGlobals.get(prop);
      } else {
        delete globalThis[prop];
      }
    }
  });

  it('initialises the application on import', async () => {
    const { window } = new JSDOM(HTML, { url: 'http://localhost/' });
    Object.assign(globalThis, {
      window,
      document: window.document,
      localStorage: window.localStorage,
      FormData: window.FormData,
      fetch: mock.fn(),
    });

    await import('../public/js/main.js');

    const dateInput = window.document.querySelector('input[name="date"]');
    assert.ok(dateInput.min, 'date input min is set by initApp()');
    assert.ok(dateInput.max, 'date input max is set by initApp()');
  });
});
