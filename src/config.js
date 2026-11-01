import { readFileSync } from 'node:fs';
import { z } from 'zod';

const EnvSchema = z.object({
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_API_KEY_FILE: z.string().min(1, 'GEMINI_API_KEY_FILE must not be empty').optional(),
  GEMINI_MODELS: z
    .string()
    .default('gemini-3.6-flash,gemini-3.5-flash-lite')
    .transform((list) =>
      list
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string()).min(1, 'GEMINI_MODELS must name at least one model')),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  GLOBAL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  TRUSTED_PROXIES: z.coerce.number().int().min(0).max(5).default(0),
});

/**
 * Visible ASCII other than quotes and backslashes: what real keys contain. Rejecting the rest
 * catches pasted spaces, line breaks and quoted placeholders.
 * @param {string} char
 */
const isKeyChar = (char) => char > ' ' && char <= '~' && char !== '"' && char !== '\\';

/**
 * Google issues keys in more than one format, so this checks shape rather than a prefix.
 * Messages never include the value, so a bad key cannot leak into logs.
 */
const ApiKeySchema = z
  .string(
    'GEMINI_API_KEY or GEMINI_API_KEY_FILE is required: ' +
      'create a key at https://aistudio.google.com/apikey',
  )
  .trim()
  .refine(
    (key) => key.length >= 20 && key.length <= 256 && [...key].every(isKeyChar),
    'The Gemini API key must be 20-256 characters with no spaces',
  );

/** @param {z.ZodError} error */
const invalid = (error) => new Error(`Invalid configuration:\n${z.prettifyError(error)}`);

/**
 * Reads and validates configuration once at startup, so misconfiguration fails fast
 * with a clear message instead of surfacing on the first request. The API key comes from a
 * mounted secret file (GEMINI_API_KEY_FILE, preferred in production) or the environment.
 * @param {Record<string, string | undefined>} [env]
 * @param {(path: string) => string} [readSecret] reads a secret file
 */
export function loadConfig(env = process.env, readSecret = (path) => readFileSync(path, 'utf8')) {
  const result = EnvSchema.safeParse(env);
  if (!result.success) throw invalid(result.error);
  const settings = result.data;
  const key = ApiKeySchema.safeParse(
    settings.GEMINI_API_KEY_FILE
      ? readKeyFile(settings.GEMINI_API_KEY_FILE, readSecret)
      : settings.GEMINI_API_KEY,
  );
  if (!key.success) throw invalid(key.error);
  return {
    apiKey: key.data,
    models: settings.GEMINI_MODELS,
    port: settings.PORT,
    rateLimitPerMinute: settings.RATE_LIMIT_PER_MINUTE,
    globalRateLimitPerMinute: settings.GLOBAL_RATE_LIMIT_PER_MINUTE,
    trustedProxies: settings.TRUSTED_PROXIES,
  };
}

/**
 * @param {string} path
 * @param {(path: string) => string} readSecret
 */
function readKeyFile(path, readSecret) {
  try {
    return readSecret(path);
  } catch (error) {
    throw new Error(`Invalid configuration: cannot read GEMINI_API_KEY_FILE (${path})`, {
      cause: error,
    });
  }
}
