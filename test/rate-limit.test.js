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
  const c = context({
    forwardedFor: '6.6.6.6, 203.0.113.9, 35.191.0.1',
    remoteAddress: '10.0.0.1',
  });

  it('counts trusted proxy hops from the right of X-Forwarded-For', () => {
    assert.equal(clientKey(1)(c), '35.191.0.1', 'one proxy, such as Cloud Run alone');
    assert.equal(clientKey(2)(c), '203.0.113.9', 'a load balancer in front of Cloud Run');
  });

  it('never trusts X-Forwarded-For without trusted proxies', () => {
    assert.equal(clientKey(0)(c), '10.0.0.1');
  });

  it('falls back to the socket when the header is shorter than the trusted chain', () => {
    assert.equal(clientKey(5)(c), '10.0.0.1');
    assert.equal(clientKey(1)(context({ remoteAddress: '10.0.0.1' })), '10.0.0.1');
  });

  it('uses a shared key when no address is known', () => {
    assert.equal(clientKey(1)(context()), 'unknown');
  });
});
