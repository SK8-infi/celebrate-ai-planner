import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { log } from '../src/log.js';

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
});
