import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    assert.deepEqual(loadConfig({ GEMINI_API_KEY: 'test-key' }), {
      apiKey: 'test-key',
      models: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
      port: 8080,
      rateLimitPerMinute: 10,
      trustProxy: false,
    });
  });

  it('reads overrides from the environment', () => {
    const config = loadConfig({
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODELS: ' gemini-3.5-flash-lite , gemini-3.6-flash ',
      PORT: '3000',
      RATE_LIMIT_PER_MINUTE: '5',
      TRUST_PROXY: 'true',
    });
    assert.deepEqual(config.models, ['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
    assert.equal(config.port, 3000);
    assert.equal(config.rateLimitPerMinute, 5);
    assert.equal(config.trustProxy, true);
  });

  it('fails fast with a helpful message when misconfigured', () => {
    assert.throws(() => loadConfig({}), /GEMINI_API_KEY is required/);
    assert.throws(() => loadConfig({ GEMINI_API_KEY: 'key', PORT: '99999' }), /PORT/);
    assert.throws(
      () => loadConfig({ GEMINI_API_KEY: 'key', GEMINI_MODELS: ' , ' }),
      /GEMINI_MODELS/,
    );
    assert.throws(() => loadConfig({ GEMINI_API_KEY: 'key', TRUST_PROXY: 'maybe' }), /TRUST_PROXY/);
  });
});
