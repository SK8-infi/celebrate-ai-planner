import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';

const KEY = 'AQ.test-key-0123456789abcdef';

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    assert.deepEqual(loadConfig({ GEMINI_API_KEY: KEY }), {
      apiKey: KEY,
      models: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
      port: 8080,
      rateLimitPerMinute: 10,
      globalRateLimitPerMinute: 120,
      trustedProxies: 0,
    });
  });

  it('reads overrides from the environment', () => {
    const config = loadConfig({
      GEMINI_API_KEY: KEY,
      GEMINI_MODELS: ' gemini-3.5-flash-lite , gemini-3.6-flash ',
      PORT: '3000',
      RATE_LIMIT_PER_MINUTE: '5',
      GLOBAL_RATE_LIMIT_PER_MINUTE: '60',
      TRUSTED_PROXIES: '2',
    });
    assert.deepEqual(config.models, ['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
    assert.equal(config.port, 3000);
    assert.equal(config.rateLimitPerMinute, 5);
    assert.equal(config.globalRateLimitPerMinute, 60);
    assert.equal(config.trustedProxies, 2);
  });

  it('prefers a mounted secret file, trimming the trailing newline', () => {
    const read = (path) => (path === '/run/secrets/gemini' ? `${KEY}\n` : '');
    const env = {
      GEMINI_API_KEY: 'AIza-ignored-when-a-file-is-set',
      GEMINI_API_KEY_FILE: '/run/secrets/gemini',
    };
    assert.equal(loadConfig(env, read).apiKey, KEY);
  });

  it('reads the secret file from disk by default', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'celebrate-secret-'));
    t.after(() => rmSync(dir, { recursive: true }));
    const file = join(dir, 'gemini-api-key');
    writeFileSync(file, `${KEY}\n`);
    assert.equal(loadConfig({ GEMINI_API_KEY_FILE: file }).apiKey, KEY);
  });

  it('fails fast with a helpful message when misconfigured', () => {
    assert.throws(() => loadConfig({}), /GEMINI_API_KEY or GEMINI_API_KEY_FILE is required/);
    assert.throws(() => loadConfig({ GEMINI_API_KEY: KEY, PORT: '99999' }), /PORT/);
    assert.throws(() => loadConfig({ GEMINI_API_KEY: KEY, GEMINI_MODELS: ' , ' }), /GEMINI_MODELS/);
    assert.throws(
      () => loadConfig({ GEMINI_API_KEY: KEY, TRUSTED_PROXIES: '9' }),
      /TRUSTED_PROXIES/,
    );
    assert.throws(
      () =>
        loadConfig({ GEMINI_API_KEY_FILE: '/missing' }, () => {
          throw new Error('ENOENT');
        }),
      /cannot read GEMINI_API_KEY_FILE \(\/missing\)/,
    );
  });

  it('rejects malformed keys without repeating them in the error', () => {
    const malformed = [
      'short',
      'has a space inside the key value',
      'your-key-here"quoted"x',
      'back\\slash-0123456789abcdef',
      'line\nbreak-0123456789abcdef',
      'x'.repeat(257),
    ];
    for (const key of malformed) {
      assert.throws(
        () => loadConfig({ GEMINI_API_KEY: key }),
        (error) =>
          /20-256 characters with no spaces/.test(error.message) && !error.message.includes(key),
        key,
      );
    }
  });
});
