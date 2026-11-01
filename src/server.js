import { GoogleGenAI } from '@google/genai';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPlanner } from './planner.js';

const config = loadConfig();

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
});

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(
    JSON.stringify({
      severity: 'INFO',
      message: `Celebrate is listening on http://localhost:${port}`,
    }),
  );
});

// Cloud Run sends SIGTERM before stopping an instance: finish in-flight requests, then exit.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
