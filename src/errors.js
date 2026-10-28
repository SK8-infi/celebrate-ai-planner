/** An error whose message is safe to show to API clients. */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message user-facing explanation
   * @param {{ cause?: unknown, fields?: Record<string, string>, headers?: Record<string, string> }} [options]
   *   `fields` holds per-field validation messages; `headers` are added to the error response
   */
  constructor(status, message, { cause, fields, headers } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.status = status;
    this.fields = fields;
    this.headers = headers;
  }
}
