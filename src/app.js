import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { AppError } from './errors.js';
import { clientKey, rateLimiter } from './rate-limit.js';
import { PlanRequestSchema } from './schemas.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;

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
  xFrameOptions: 'DENY',
  permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] },
};

/**
 * Builds the HTTP app. Collaborators are injected so tests can substitute fakes.
 * @param {object} deps
 * @param {{ createPlan: (request: import('./schemas.js').PlanRequest, options?: { signal?: AbortSignal }) => Promise<object> }} deps.planner
 * @param {number} [deps.rateLimitPerMinute] plan requests allowed per client per minute
 * @param {boolean} [deps.trustProxy] trust the X-Forwarded-For entry added by Cloud Run
 * @param {(entry: Record<string, unknown>) => void} [deps.log] structured (Cloud Logging) logger
 */
export function createApp({
  planner,
  rateLimitPerMinute = 10,
  trustProxy = false,
  log = (entry) => console.error(JSON.stringify(entry)),
}) {
  const app = new Hono();
  app.use(requestId(), secureHeaders(SECURITY_HEADERS), compress());

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.post(
    '/api/plan',
    rateLimiter({ limit: rateLimitPerMinute, windowMs: 60_000, key: clientKey(trustProxy) }),
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw new AppError(413, 'That request is too large.');
      },
    }),
    async (c) => {
      const parsed = PlanRequestSchema.safeParse(await readJson(c));
      if (!parsed.success) {
        throw new AppError(400, 'Some details need attention.', {
          fields: fieldErrors(parsed.error),
        });
      }
      const plan = await planner.createPlan(parsed.data, { signal: c.req.raw.signal });
      return c.json({ plan });
    },
  );
  app.all('/api/plan', () => {
    throw new AppError(405, 'Use POST to request a plan.', { headers: { Allow: 'POST' } });
  });

  app.all('/api/*', () => {
    throw new AppError(404, 'Not found.');
  });
  // Static assets are small and unversioned: browsers revalidate each time and get a 304 via ETag.
  app.use('*', etag(), revalidate, staticEtag, serveStatic({ root: PUBLIC_DIR }));

  app.onError((error, c) => {
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
  });

  return app;
}

/** @type {import('hono').MiddlewareHandler} */
async function revalidate(c, next) {
  c.header('Cache-Control', 'no-cache');
  c.header('Vary', 'Accept-Encoding', { append: true });
  await next();
}

/**
 * Assigns an ETag from file metadata so etag() never needs to clone and read the file stream.
 * @type {import('hono').MiddlewareHandler}
 */
async function staticEtag(c, next) {
  await next();
  const res = c.res;
  if (!res.ok || res.headers.get('ETag')) return;
  const mtime = res.headers.get('Last-Modified');
  const size = res.headers.get('Content-Length');
  if (mtime && size) {
    res.headers.set('ETag', `"${Number(size).toString(16)}-${Date.parse(mtime).toString(16)}"`);
  }
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
  const fields = {};
  for (const { path, message } of error.issues)
    fields[String(path.at(-1) ?? 'request')] ??= message;
  return fields;
}
