/**
 * Writes one structured log entry as a JSON line, the format Cloud Logging and Azure Monitor
 * parse. Errors go to stderr and everything else to stdout.
 * @param {{ severity: 'INFO' | 'ERROR', message: string } & Record<string, unknown>} entry
 */
export function log(entry) {
  const line = JSON.stringify(entry);
  if (entry.severity === 'ERROR') console.error(line);
  else console.log(line);
}
