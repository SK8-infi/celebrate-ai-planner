import { createHash } from 'node:crypto';
import { ApiError, ThinkingLevel } from '@google/genai';
import { z } from 'zod';
import { createCache } from './cache.js';
import { AppError } from './errors.js';
import { finalizePlan } from './plan.js';
import { buildPrompt, SYSTEM_INSTRUCTION } from './prompt.js';
import { PLAN_JSON_SCHEMA, PlanSchema } from './schemas.js';

/**
 * Creates the planning service: asks Gemini for a schema-constrained plan, validates it,
 * then adds exact budget amounts and calendar dates. When a model is overloaded, too slow or
 * returns an unusable plan, the next model in `models` is tried.
 * @param {object} options
 * @param {{ models: { generateContent: (params: object) => Promise<{ text?: string, promptFeedback?: { blockReason?: string } }> } }} options.ai
 *   Google Gen AI client, or a test double with the same shape
 * @param {string[]} options.models Gemini model IDs in order of preference
 * @param {ReturnType<typeof createCache>} [options.cache] reuses plans for identical prompts
 * @param {() => Date} [options.now]
 */
export function createPlanner({ ai, models, cache = createCache(), now = () => new Date() }) {
  /**
   * @param {string} model
   * @param {string} prompt
   * @param {AbortSignal} [signal]
   * @returns {Promise<import('./schemas.js').Plan>}
   */
  async function ask(model, prompt, signal) {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseJsonSchema: PLAN_JSON_SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: signal,
      },
    });
    if (response.promptFeedback?.blockReason) {
      throw new AppError(
        422,
        'This request could not be planned. Please rephrase your event details.',
      );
    }
    return PlanSchema.parse(JSON.parse(response.text ?? ''));
  }

  /**
   * Tries each model in turn until one returns a valid plan.
   * @param {string} prompt
   * @param {AbortSignal} [signal]
   */
  async function generate(prompt, signal) {
    let failure;
    for (const model of models) {
      try {
        return await ask(model, prompt, signal);
      } catch (error) {
        failure = error;
        if (signal?.aborted || !worthRetrying(error)) break;
      }
    }
    throw toAppError(failure);
  }

  return {
    /**
     * @param {import('./schemas.js').PlanRequest} request a validated plan request
     * @param {{ signal?: AbortSignal }} [options] `signal` cancels the Gemini call, e.g. when the client disconnects
     */
    async createPlan(request, { signal } = {}) {
      const prompt = buildPrompt(request, now());
      const key = createHash('sha256').update(prompt).digest('base64url');
      let plan = cache.get(key);
      if (!plan) {
        plan = await generate(prompt, signal);
        cache.set(key, plan);
      }
      return finalizePlan(plan, request.event, now());
    },
  };
}

/**
 * Whether another model could succeed where this one failed.
 * @param {unknown} error
 */
function worthRetrying(error) {
  if (error instanceof AppError) return false; // A blocked prompt is blocked everywhere.
  if (error instanceof ApiError) return error.status >= 500 || [408, 429].includes(error.status);
  return true; // Timeouts, network errors and unusable output.
}

/**
 * Maps SDK, network and validation failures to safe, user-facing errors. The original
 * error is kept as `cause` for server-side logs.
 * @param {unknown} error
 */
function toAppError(error) {
  if (error instanceof AppError) return error;
  const fail = (status, message) => new AppError(status, message, { cause: error });
  const status = error instanceof ApiError ? error.status : undefined;
  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    return fail(502, 'The AI returned an incomplete plan. Please try again.');
  }
  if ((error instanceof Error && error.name === 'AbortError') || status === 504) {
    return fail(504, 'The AI took too long to respond. Please try again.');
  }
  if (status === 429 || status === 503) {
    return fail(503, 'The planner is busy right now. Please try again in a minute.');
  }
  return fail(502, 'The AI planner is unavailable right now. Please try again shortly.');
}
