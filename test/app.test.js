import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import { validEvent } from './helpers.js';

/** The production defaults from src/config.js. */
const LIMITS = { rateLimitPerMinute: 10, globalRateLimitPerMinute: 120, trustedProxies: 0 };

/** Builds the app around a stub planner and records planner calls and log entries. */
function setup({ createPlan = async () => ({ title: 'Plan' }), ...limits } = {}) {
  const calls = [];
  const logs = [];
  const app = createApp({
    planner: {
      createPlan: async (request, options) => {
        calls.push({ request, options });
        return createPlan(request);
      },
    },
    ...LIMITS,
    ...limits,
    log: (entry) => logs.push(entry),
  });
  /** @param {unknown} body @param {Record<string, string>} [headers] */
  const post = (body, headers = { 'content-type': 'application/json' }) =>
    app.request('/api/plan', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { app, calls, logs, post };
}

describe('POST /api/plan', () => {
  it('returns a plan for a valid request', async () => {
    const { calls, post } = setup();
    const response = await post({ event: validEvent({ name: undefined }) });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { plan: { title: 'Plan' } });
    assert.equal(calls[0].request.event.name, '', 'defaults are applied before planning');
    assert.ok(
      calls[0].options.signal instanceof AbortSignal,
      'client disconnects can cancel the AI call',
    );
  });

  it('returns field-level messages for invalid input', async () => {
    const { calls, post } = setup();
    const response = await post({ event: validEvent({ guests: 0, location: '' }) });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Some details need attention.',
      fields: { guests: 'At least one guest is needed.', location: 'Enter a city, area or venue.' },
    });
    assert.equal(calls.length, 0);
  });

  it('rejects malformed JSON, other content types and oversized bodies', async () => {
    const { post } = setup();
    assert.equal((await post('{"event":')).status, 400);
    assert.deepEqual((await (await post([])).json()).fields, {
      request: 'Invalid input: expected object, received array',
    });
    assert.equal(
      (await post('event=1', { 'content-type': 'application/x-www-form-urlencoded' })).status,
      415,
    );
    const huge = await post({ event: validEvent({ preferences: 'x'.repeat(70_000) }) });
    assert.equal(huge.status, 413);
  });

  it('rate-limits each client', async () => {
    const { post } = setup({ rateLimitPerMinute: 1 });
    assert.equal((await post({ event: validEvent() })).status, 200);
    const limited = await post({ event: validEvent() });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });

  it('caps plan requests across all clients to protect the AI quota', async () => {
    const { post } = setup({ globalRateLimitPerMinute: 2, trustedProxies: 1 });
    const from = (ip) => ({ 'content-type': 'application/json', 'x-forwarded-for': ip });
    assert.equal((await post({ event: validEvent() }, from('203.0.113.1'))).status, 200);
    assert.equal((await post({ event: validEvent() }, from('203.0.113.2'))).status, 200);
    assert.equal((await post({ event: validEvent() }, from('203.0.113.3'))).status, 429);
  });

  it('refuses requests that browsers mark as coming from another site', async () => {
    const { calls, post } = setup();
    for (const site of ['cross-site', 'same-site']) {
      const response = await post(
        { event: validEvent() },
        { 'content-type': 'application/json', 'sec-fetch-site': site },
      );
      assert.equal(response.status, 403, site);
    }
    const own = await post(
      { event: validEvent() },
      { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    );
    assert.equal(own.status, 200);
    assert.equal(calls.length, 1);
  });

  it('also refuses foreign origins, for browsers that do not send Sec-Fetch-Site', async () => {
    const { calls, post } = setup();
    for (const origin of ['https://evil.example', 'null', 'not a url', 'http://localhost:8081']) {
      const response = await post(
        { event: validEvent() },
        { 'content-type': 'application/json', origin },
      );
      assert.equal(response.status, 403, origin);
    }
    const own = await post(
      { event: validEvent() },
      { 'content-type': 'application/json', origin: 'http://localhost' },
    );
    assert.equal(own.status, 200);
    assert.equal(calls.length, 1);
  });

  it('keeps plans out of every cache', async () => {
    const response = await setup().post({ event: validEvent() });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  it('rejects prototype-pollution keys instead of copying them', async () => {
    const response = await setup().post(
      `{"event":${JSON.stringify(validEvent())},"__proto__":{"admin":true}}`,
    );
    assert.equal(response.status, 400);
    assert.equal({}.admin, undefined);
  });

  it('passes planner errors through with their safe message', async () => {
    const { logs, post } = setup({
      createPlan: async () => {
        throw new AppError(503, 'The planner is busy right now.', { cause: new Error('quota') });
      },
    });
    const response = await post({ event: validEvent() });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'The planner is busy right now.' });
    assert.equal(logs[0].severity, 'ERROR');
    assert.match(logs[0].error, /quota/);
  });

  it('logs causes that are not Error objects as text', async () => {
    const { logs, post } = setup({
      createPlan: async () => {
        throw new AppError(502, 'The AI planner is unavailable.', { cause: 'socket hang up' });
      },
    });
    const response = await post({ event: validEvent() });
    assert.equal(response.status, 502);
    assert.equal(logs[0].error, 'socket hang up');
  });

  it('hides unexpected errors from clients but logs them with the request ID', async () => {
    const { logs, post } = setup({
      createPlan: async () => {
        throw new Error('database password leaked in message');
      },
    });
    const response = await post({ event: validEvent() });
    const body = await response.text();
    assert.equal(response.status, 500);
    assert.doesNotMatch(body, /password/);
    assert.equal(logs[0].requestId, response.headers.get('x-request-id'));
    assert.match(logs[0].error, /database password/);
  });

  it('logs structured JSON to stderr by default, as Cloud Logging expects', async (t) => {
    const stderr = t.mock.method(console, 'error', () => {});
    const failing = { createPlan: async () => Promise.reject(new Error('boom')) };
    const response = await createApp({ planner: failing, ...LIMITS }).request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: validEvent() }),
    });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(stderr.mock.calls[0].arguments[0]).severity, 'ERROR');
  });
});

describe('other routes', () => {
  it('reports health', async () => {
    const response = await setup().app.request('/api/health');
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.ok(response.headers.get('x-request-id'), 'API responses carry a request ID for logs');
  });

  it('answers other methods on the plan endpoint with 405 and the allowed method', async () => {
    const response = await setup().app.request('/api/plan');
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
    assert.deepEqual(await response.json(), { error: 'Use POST to request a plan.' });
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const response = await setup().app.request('/api/unknown');
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Not found.' });
  });

  it('serves the app with strict security headers', async () => {
    const response = await setup().app.request('/');
    const header = (name) => response.headers.get(name);

    assert.equal(response.status, 200);
    assert.match(header('content-type'), /text\/html/);
    assert.match(await response.text(), /<html lang="en">/);
    assert.equal(
      header('content-security-policy'),
      "default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'",
    );
    assert.equal(header('x-frame-options'), 'DENY');
    assert.equal(header('x-content-type-options'), 'nosniff');
    assert.equal(header('referrer-policy'), 'no-referrer');
    assert.equal(header('cross-origin-embedder-policy'), 'require-corp');
    assert.equal(
      header('permissions-policy'),
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    assert.equal(header('strict-transport-security'), 'max-age=63072000; includeSubDomains');
  });

  it('lets browsers revalidate static files cheaply', async () => {
    const { app } = setup();
    const first = await app.request('/styles.css');
    assert.equal(first.headers.get('cache-control'), 'no-cache');
    const etag = first.headers.get('etag');
    const second = await app.request('/styles.css', { headers: { 'if-none-match': etag } });
    assert.equal(second.status, 304);
  });

  it('compresses text responses', async () => {
    const response = await setup().app.request('/js/app.js', {
      headers: { 'accept-encoding': 'gzip' },
    });
    assert.equal(response.headers.get('content-encoding'), 'gzip');
  });

  it('never serves files outside the public folder', async () => {
    const { app } = setup();
    for (const path of ['/../src/config.js', '/%2e%2e/package.json', '/..%2fpackage.json']) {
      const response = await app.request(path);
      assert.equal(response.status, 404, path);
    }
  });
});
