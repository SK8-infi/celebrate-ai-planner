import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { describe, it } from 'node:test';

const KEY = 'AQ.test-bootstrap-key-0123456789';

/** Finds a free TCP port by briefly listening on port 0. */
async function freePort() {
  const probe = createServer().listen(0);
  await once(probe, 'listening');
  const { port } = /** @type {import('node:net').AddressInfo} */ (probe.address());
  probe.close();
  await once(probe, 'close');
  return port;
}

/**
 * Resolves with the first stdout line, or rejects if the process writes to stderr or exits.
 * @param {import('node:child_process').ChildProcess} child
 */
const firstLine = (child) =>
  new Promise((resolve, reject) => {
    child.stdout?.once('data', (chunk) => resolve(String(chunk).split('\n')[0]));
    child.stderr?.once('data', (chunk) => reject(new Error(`Server failed:\n${chunk}`)));
    child.once('exit', (code) => reject(new Error(`Server exited early with code ${code}`)));
  });

describe('server bootstrap', () => {
  it('boots, answers health checks, keeps the key out of logs and stops on SIGTERM', async (t) => {
    const port = await freePort();
    const child = spawn(process.execPath, ['src/server.js'], {
      env: { ...process.env, GEMINI_API_KEY: KEY, PORT: String(port) },
    });
    t.after(() => child.kill('SIGKILL'));

    const line = await firstLine(child);
    assert.deepEqual(JSON.parse(line), {
      severity: 'INFO',
      message: `Celebrate is listening on http://localhost:${port}`,
    });
    assert.equal(line.includes(KEY), false);

    const response = await fetch(`http://localhost:${port}/api/health`);
    assert.deepEqual(await response.json(), { status: 'ok' });

    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const [code, signal] = await exited;
    assert.ok(code === 0 || signal === 'SIGTERM', `exit code ${code}, signal ${signal}`);
  });
});
