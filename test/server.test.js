import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { describe, it } from 'node:test';

/** Finds an available TCP port. */
async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

describe('server bootstrap', () => {
  it('boots the server, answers health checks and shuts down cleanly on SIGTERM', async () => {
    const port = await getFreePort();
    const env = {
      ...process.env,
      GEMINI_API_KEY: 'test-bootstrap-key',
      PORT: String(port),
    };

    const child = spawn(process.execPath, ['src/server.js'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try {
      const listening = await new Promise((resolve, reject) => {
        let output = '';
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
          if (output.includes('Celebrate is listening on')) {
            resolve(output);
          }
        });
        child.stderr.on('data', (chunk) => {
          reject(new Error(`Server failed to start:\n${chunk.toString()}`));
        });
        child.on('error', reject);
        child.on('exit', (code, sig) => {
          reject(new Error(`Server exited unexpectedly with code ${code}, signal ${sig}`));
        });
      });

      assert.match(listening, /Celebrate is listening on http:\/\/localhost:\d+/);
      const parsedLog = JSON.parse(listening.trim().split('\n')[0]);
      assert.equal(parsedLog.severity, 'INFO');

      const response = await fetch(`http://localhost:${port}/api/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'ok' });

      // Signal graceful shutdown
      const exitPromise = new Promise((resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
      });

      child.kill('SIGTERM');
      const exitResult = await exitPromise;
      assert.ok(exitResult.code === 0 || exitResult.signal === 'SIGTERM');
    } finally {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
  });
});
