/**
 * @template T
 * @typedef {{ get(key: string): T | undefined, set(key: string, value: T): void, readonly size: number }} Cache
 */

/**
 * Small in-memory LRU cache with per-entry expiry. Memory stays bounded by `maxEntries`.
 * @template T
 * @param {{ maxEntries?: number, ttlMs?: number, now?: () => number }} [options]
 * @returns {Cache<T>}
 */
export function createCache({ maxEntries = 100, ttlMs = 60 * 60_000, now = Date.now } = {}) {
  /** @type {Map<string, { value: T, expires: number }>} */
  const entries = new Map();

  return {
    /**
     * @param {string} key
     * @returns {T | undefined}
     */
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (entry.expires <= now()) return undefined;
      entries.set(key, entry); // Re-insert to mark as most recently used.
      return entry.value;
    },
    /**
     * @param {string} key
     * @param {T} value
     */
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expires: now() + ttlMs });
      if (entries.size > maxEntries) {
        const [oldest] = entries.keys(); // Maps iterate in insertion order.
        entries.delete(oldest);
      }
    },
    get size() {
      return entries.size;
    },
  };
}
