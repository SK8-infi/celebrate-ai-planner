import { z } from 'zod';

const EnvSchema = z.object({
  GEMINI_API_KEY: z
    .string('GEMINI_API_KEY is required: create a key at https://aistudio.google.com/apikey')
    .min(1, 'GEMINI_API_KEY must not be empty'),
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
 * Reads and validates configuration once at startup, so misconfiguration fails fast
 * with a clear message instead of surfacing on the first request.
 * @param {Record<string, string | undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  const settings = result.data;
  return {
    apiKey: settings.GEMINI_API_KEY,
    models: settings.GEMINI_MODELS,
    port: settings.PORT,
    rateLimitPerMinute: settings.RATE_LIMIT_PER_MINUTE,
    globalRateLimitPerMinute: settings.GLOBAL_RATE_LIMIT_PER_MINUTE,
    trustedProxies: settings.TRUSTED_PROXIES,
  };
}
