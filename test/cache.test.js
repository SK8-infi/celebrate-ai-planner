import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCache } from '../src/cache.js';

describe('createCache', () => {
  it('returns stored values until they expire', () => {
    let time = 0;
    const cache = createCache({ ttlMs: 100, now: () => time });
    cache.set('plan', 1);
    time = 99;
    assert.equal(cache.get('plan'), 1);
    time = 200;
    assert.equal(cache.get('plan'), undefined);
    assert.equal(cache.size, 0);
  });

  it('evicts the least recently used entry when full', () => {
    const cache = createCache({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // "b" is now the least recently used.
    cache.set('c', 3);
    assert.deepEqual(
      ['a', 'b', 'c'].map((key) => cache.get(key)),
      [1, undefined, 3],
    );
    assert.equal(cache.size, 2);
  });

  it('replaces existing keys without growing', () => {
    const cache = createCache({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('a', 2);
    assert.equal(cache.get('a'), 2);
    assert.equal(cache.size, 1);
  });
});
