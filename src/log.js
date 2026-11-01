/**
 * @typedef {{ severity: 'INFO' | 'ERROR', message: string } & Record<string, unknown>} LogEntry
 * @typedef {(entry: LogEntry) => void} Logger
 */

/** The classic Google API key shape, masked even when the key is not known to the logger. */
const GOOGLE_API_KEY = /AIza[\w-]{35}/g;
const MASK = '[redacted]';

/**
 * Creates a structured logger that writes one JSON line per entry, the format Cloud Logging and
 * Azure Monitor parse. Errors go to stderr and everything else to stdout. Every string field is
 * masked first, so a secret such as the API key can never reach the logs, even inside an error.
 * @param {{ secrets?: string[] }} [options] values to mask, such as the configured API key
 * @returns {Logger}
 */
export function createLogger({ secrets = [] } = {}) {
  const known = secrets.filter(Boolean);
  /** @param {string} text */
  const mask = (text) =>
    known
      .reduce((masked, secret) => masked.replaceAll(secret, MASK), text)
      .replace(GOOGLE_API_KEY, MASK);
  return (entry) => {
    const line = JSON.stringify(entry, (_, value) =>
      typeof value === 'string' ? mask(value) : value,
    );
    if (entry.severity === 'ERROR') console.error(line);
    else console.log(line);
  };
}

/** A logger with no configured secrets, for code that has no configuration to hand. */
export const log = createLogger();
