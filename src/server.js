import { GoogleGenAI } from '@google/genai';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './log.js';
import { createPlanner } from './planner.js';

const config = loadConfig();
// The key now lives only in the Gemini client: drop it from the environment so no dependency,
// child process or crash report can read it there, and mask it in every log line.
delete process.env.GEMINI_API_KEY;
const log = createLogger({ secrets: [config.apiKey] });

const ai = new GoogleGenAI({
  apiKey: config.apiKey,
  // Per-attempt deadline, also sent to Gemini so it stops work that would arrive too late.
  // Failures are retried on the next configured model rather than on the same one.
  httpOptions: { timeout: 30_000 },
});

const app = createApp({
  planner: createPlanner({ ai, models: config.models }),
  rateLimitPerMinute: config.rateLimitPerMinute,
  globalRateLimitPerMinute: config.globalRateLimitPerMinute,
  trustedProxies: config.trustedProxies,
  log,
});

// Bound how long a client may take to send a request, so slow senders cannot hold connections
// open (slowloris). Plan generation happens after the request arrives, so it is unaffected.
const serverOptions = { headersTimeout: 15_000, requestTimeout: 30_000 };

const server = serve({ fetch: app.fetch, port: config.port, serverOptions }, ({ port }) => {
  log({ severity: 'INFO', message: `Celebrate is listening on http://localhost:${port}` });
});

// Cloud Run sends SIGTERM before stopping an instance: finish in-flight requests, then exit.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
