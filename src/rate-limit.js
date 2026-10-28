import { AppError } from './errors.js';

/**
 * Fixed-window rate limiter middleware. Memory is bounded: a client's window is replaced on
 * its first request after expiry, and the oldest client is evicted once `maxClients` is reached.
 * @param {object} options
 * @param {number} options.limit requests allowed per window
 * @param {number} options.windowMs window length in milliseconds
 * @param {(c: import('hono').Context) => string} options.key identifies the client
 * @param {number} [options.maxClients]
 * @param {() => number} [options.now]
 * @returns {import('hono').MiddlewareHandler}
 */
export function rateLimiter({ limit, windowMs, key, maxClients = 10_000, now = Date.now }) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const buckets = new Map();

  return async (c, next) => {
    const id = key(c);
    const time = now();
    let bucket = buckets.get(id);
    if (!bucket || bucket.resetAt <= time) {
      buckets.delete(id);
      if (buckets.size >= maxClients) buckets.delete(buckets.keys().next().value);
      bucket = { count: 0, resetAt: time + windowMs };
      buckets.set(id, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      const retryAfter = String(Math.ceil((bucket.resetAt - time) / 1000));
      throw new AppError(
        429,
        'Too many plans in a short time. Please wait a minute and try again.',
        {
          headers: { 'Retry-After': retryAfter },
        },
      );
    }
    await next();
  };
}

/**
 * Builds the function that identifies a client for rate limiting. Behind Cloud Run's
 * front end (`trustProxy`), the real client IP is the last X-Forwarded-For entry, which
 * the client cannot forge; otherwise the socket address is used.
 * @param {boolean} trustProxy
 * @returns {(c: import('hono').Context) => string}
 */
export const clientKey = (trustProxy) => (c) => {
  const forwarded = trustProxy ? c.req.header('x-forwarded-for') : undefined;
  return (
    forwarded?.split(',').at(-1)?.trim() || c.env?.incoming?.socket?.remoteAddress || 'unknown'
  );
};
