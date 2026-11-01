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
      if (buckets.size >= maxClients) {
        const [oldest] = buckets.keys(); // Maps iterate in insertion order.
        buckets.delete(oldest);
      }
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
 * Builds the function that identifies a client for rate limiting. Each trusted proxy appends
 * the address it received the request from to X-Forwarded-For, so the client is the entry
 * `trustedProxies` places from the right; anything further left can be forged by the client.
 * Cloud Run alone adds one entry; an external Application Load Balancer in front adds two.
 * With no trusted proxies, or too few entries, the socket address is used.
 * @param {number} trustedProxies proxy hops between the client and this server
 * @returns {(c: import('hono').Context) => string}
 */
export const clientKey = (trustedProxies) => (c) => {
  const hops = (c.req.header('x-forwarded-for') ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  const forwarded = trustedProxies > 0 ? hops.at(-trustedProxies) : undefined;
  return forwarded || c.env?.incoming?.socket?.remoteAddress || 'unknown';
};
