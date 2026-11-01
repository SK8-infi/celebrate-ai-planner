import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { loadAssets, serveAssets } from './assets.js';
import { AppError } from './errors.js';
import { log as structuredLog } from './log.js';
import { clientKey, rateLimiter } from './rate-limit.js';
import { PlanRequestSchema } from './schemas.js';

// Read and compressed once per process, so serving a file costs no disk access or CPU.
const ASSETS = loadAssets(fileURLToPath(new URL('../public', import.meta.url)));
const MAX_BODY_BYTES = 64 * 1024;
const MINUTE_MS = 60_000;
/** Rate-limit key shared by every client, for the global cap on AI requests. */
const ALL_CLIENTS = () => 'all-clients';

/** Browser features the app never uses, denied so that no injected or framed code can use them. */
const DENIED_FEATURES = [
  'accelerometer',
  'bluetooth',
  'browsingTopics',
  'camera',
  'displayCapture',
  'geolocation',
  'gyroscope',
  'hid',
  'idleDetection',
  'localFonts',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'publickeyCredentialsGet',
  'screenWakeLock',
  'serial',
  'usb',
  'xrSpatialTracking',
];

/** Strict same-origin policy. Trusted Types forbids DOM-XSS sinks such as innerHTML outright. */
const SECURITY_HEADERS = {
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    requireTrustedTypesFor: ["'script'"],
    trustedTypes: ["'none'"],
  },
  crossOriginEmbedderPolicy: 'require-corp',
  strictTransportSecurity: 'max-age=63072000; includeSubDomains',
  xFrameOptions: 'DENY',
  permissionsPolicy: Object.fromEntries(DENIED_FEATURES.map((feature) => [feature, []])),
};

/**
 * Builds the HTTP app. Collaborators are injected so tests can substitute fakes; limits come
 * from the validated configuration (src/config.js), which owns their defaults.
 * @param {object} deps
 * @param {{ createPlan: (request: import('./schemas.js').PlanRequest, options?: { signal?: AbortSignal }) => Promise<object> }} deps.planner
 * @param {number} deps.rateLimitPerMinute plan requests allowed per client per minute
 * @param {number} deps.globalRateLimitPerMinute plan requests allowed per minute in total, which
 *   caps AI spending even when requests come from many addresses
 * @param {number} deps.trustedProxies proxy hops (such as Cloud Run) in front of the server
 * @param {import('./log.js').Logger} [deps.log] structured logger
 */
export function createApp({
  planner,
  rateLimitPerMinute,
  globalRateLimitPerMinute,
  trustedProxies,
  log = structuredLog,
}) {
  const app = new Hono();
  app.use(secureHeaders(SECURITY_HEADERS));
  app.use('/api/*', requestId(), compress(), apiGuard);

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.post(
    '/api/plan',
    rateLimiter({ limit: rateLimitPerMinute, windowMs: MINUTE_MS, key: clientKey(trustedProxies) }),
    rateLimiter({ limit: globalRateLimitPerMinute, windowMs: MINUTE_MS, key: ALL_CLIENTS }),
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw new AppError(413, 'That request is too large.');
      },
    }),
    planHandler(planner),
  );
  app.all('/api/plan', () => {
    throw new AppError(405, 'Use POST to request a plan.', { headers: { Allow: 'POST' } });
  });

  app.all('/api/*', () => {
    throw new AppError(404, 'Not found.');
  });
  app.use('*', serveAssets(ASSETS));

  app.onError(errorHandler(log));

  return app;
}

/**
 * Validates a plan request and asks the planner for a plan. The planner call is cancelled if
 * the client disconnects.
 * @param {Parameters<typeof createApp>[0]['planner']} planner
 * @returns {import('hono').Handler}
 */
function planHandler(planner) {
  return async (c) => {
    const parsed = PlanRequestSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw new AppError(400, 'Some details need attention.', {
        fields: fieldErrors(parsed.error),
      });
    }
    const plan = await planner.createPlan(parsed.data, { signal: c.req.raw.signal });
    return c.json({ plan });
  };
}

/**
 * Turns any error into a JSON response with a safe message. Unexpected errors become 500s, and
 * server-side failures are logged with the request ID and the original cause.
 * @param {import('./log.js').Logger} log
 * @returns {import('hono').ErrorHandler}
 */
function errorHandler(log) {
  return (error, c) => {
    const failure =
      error instanceof AppError
        ? error
        : new AppError(500, 'Something went wrong. Please try again.', { cause: error });
    if (failure.status >= 500) {
      const { cause } = failure;
      log({
        severity: 'ERROR',
        message: failure.message,
        requestId: c.get('requestId'),
        error: cause instanceof Error ? cause.stack : String(cause),
      });
    }
    for (const [name, value] of Object.entries(failure.headers ?? {})) c.header(name, value);
    return c.json({ error: failure.message, fields: failure.fields }, failure.status);
  };
}

/**
 * Hardens every API response: plans are personal data, so no cache may store them, and the API
 * only serves this site's own pages, so browsers sending a request from another site are refused.
 * @type {import('hono').MiddlewareHandler}
 */
async function apiGuard(c, next) {
  c.header('Cache-Control', 'no-store');
  if (fromAnotherSite(c)) throw new AppError(403, 'Requests from other sites are not allowed.');
  await next();
}

/**
 * Whether a browser marked the request as coming from another site. Current browsers send
 * Sec-Fetch-Site; the Origin header also covers older ones. Non-browser clients send neither.
 * @param {import('hono').Context} c
 */
function fromAnotherSite(c) {
  const site = c.req.header('Sec-Fetch-Site');
  const origin = c.req.header('Origin');
  const foreignOrigin = origin !== undefined && URL.parse(origin)?.host !== new URL(c.req.url).host;
  return site === 'cross-site' || site === 'same-site' || foreignOrigin;
}

/**
 * @param {import('hono').Context} c
 * @returns {Promise<unknown>}
 */
async function readJson(c) {
  if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new AppError(415, 'Send the request as JSON.');
  }
  try {
    return await c.req.json();
  } catch {
    throw new AppError(400, 'The request body is not valid JSON.');
  }
}

/**
 * Keeps the first message per field, keyed by the name the form control uses.
 * @param {import('zod').ZodError} error
 */
function fieldErrors(error) {
  /** @type {Record<string, string>} */
  const fields = Object.create(null); // No prototype, so no key can reach Object.prototype.
  for (const { path, message } of error.issues)
    fields[String(path.at(-1) ?? 'request')] ??= message;
  return fields;
}
