import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clientKey, rateLimiter } from '../src/rate-limit.js';

/** Minimal Hono-like context for the key function. */
const context = ({ forwardedFor, remoteAddress } = {}) => ({
  req: { header: (name) => (name === 'x-forwarded-for' ? forwardedFor : undefined) },
  env: remoteAddress ? { incoming: { socket: { remoteAddress } } } : undefined,
});

describe('rateLimiter', () => {
  const setup = (options = {}) => {
    const clock = { time: 0 };
    const limiter = rateLimiter({
      limit: 2,
      windowMs: 60_000,
      key: (c) => c.id,
      now: () => clock.time,
      ...options,
    });
    const passed = [];
    const hit = (id = 'a') => limiter({ id }, async () => passed.push(id));
    return { clock, hit, passed };
  };

  it('allows the limit, then rejects with 429 and Retry-After', async () => {
    const { clock, hit, passed } = setup();
    await hit();
    await hit();
    clock.time = 15_000;
    await assert.rejects(hit(), (error) => {
      assert.equal(error.status, 429);
      assert.deepEqual(error.headers, { 'Retry-After': '45' });
      return true;
    });
    assert.equal(passed.length, 2);
  });

  it('starts a fresh window once the old one expires', async () => {
    const { clock, hit, passed } = setup();
    await hit();
    await hit();
    clock.time = 60_000;
    await hit();
    assert.equal(passed.length, 3);
  });

  it('counts each client separately', async () => {
    const { hit, passed } = setup({ limit: 1 });
    await hit('a');
    await hit('b');
    assert.deepEqual(passed, ['a', 'b']);
  });

  it('bounds memory by evicting the oldest client', async () => {
    const { hit, passed } = setup({ limit: 1, maxClients: 1 });
    await hit('a');
    await hit('b'); // Evicts "a", so "a" gets a fresh window.
    await hit('a');
    assert.deepEqual(passed, ['a', 'b', 'a']);
  });
});

describe('clientKey', () => {
  it('uses the proxy-appended (last) X-Forwarded-For entry when the proxy is trusted', () => {
    const c = context({ forwardedFor: '6.6.6.6, 203.0.113.9', remoteAddress: '10.0.0.1' });
    assert.equal(clientKey(true)(c), '203.0.113.9');
  });

  it('ignores X-Forwarded-For unless the proxy is trusted', () => {
    const c = context({ forwardedFor: '6.6.6.6', remoteAddress: '10.0.0.1' });
    assert.equal(clientKey(false)(c), '10.0.0.1');
  });

  it('falls back to a shared key when no address is known', () => {
    assert.equal(clientKey(true)(context()), 'unknown');
  });
});
