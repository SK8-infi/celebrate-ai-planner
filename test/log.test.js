import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLogger, log } from '../src/log.js';

describe('log', () => {
  it('writes errors to stderr and everything else to stdout, as JSON lines', (t) => {
    const stderr = t.mock.method(console, 'error', () => {});
    const stdout = t.mock.method(console, 'log', () => {});
    log({ severity: 'ERROR', message: 'boom', requestId: 'abc' });
    log({ severity: 'INFO', message: 'ready' });
    assert.deepEqual(JSON.parse(stderr.mock.calls[0].arguments[0]), {
      severity: 'ERROR',
      message: 'boom',
      requestId: 'abc',
    });
    assert.deepEqual(JSON.parse(stdout.mock.calls[0].arguments[0]), {
      severity: 'INFO',
      message: 'ready',
    });
  });

  it('masks configured secrets and anything shaped like a Google API key', (t) => {
    const stderr = t.mock.method(console, 'error', () => {});
    const secret = 'AQ.secret-key-value-1234567890';
    const googleKey = `AIza${'x'.repeat(35)}`;
    createLogger({ secrets: [secret, ''] })({
      severity: 'ERROR',
      message: `request failed for ${secret}`,
      error: `Error: bad key ${googleKey}\n    at call (planner.js:1:1)`,
      status: 500,
    });
    const line = stderr.mock.calls[0].arguments[0];
    assert.equal(line.includes(secret) || line.includes(googleKey), false);
    assert.deepEqual(JSON.parse(line), {
      severity: 'ERROR',
      message: 'request failed for [redacted]',
      error: 'Error: bad key [redacted]\n    at call (planner.js:1:1)',
      status: 500,
    });
  });
});
