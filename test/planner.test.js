import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError, HarmBlockThreshold, HarmCategory, ThinkingLevel } from '@google/genai';
import { createPlanner } from '../src/planner.js';
import { SYSTEM_INSTRUCTION } from '../src/prompt.js';
import { PLAN_JSON_SCHEMA } from '../src/schemas.js';
import { aiPlan, fakeAi, validEvent } from './helpers.js';

const NOW = new Date('2026-10-29T08:00:00Z');
const request = (overrides = {}) => ({ event: validEvent({ date: '2026-12-28', ...overrides }) });
const planner = (ai, models = ['gemini-test']) => createPlanner({ ai, models, now: () => NOW });

/** Asserts that planning fails with the given HTTP status, keeping the original cause. */
const rejectsWith = (promise, status) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.name, 'AppError');
    assert.equal(error.status, status);
    return true;
  });

describe('createPlanner', () => {
  it('asks Gemini for schema-constrained JSON with low-latency thinking', async () => {
    const ai = fakeAi();
    const signal = new AbortController().signal;
    await planner(ai).createPlan(request(), { signal });

    const [call] = ai.calls;
    assert.equal(call.model, 'gemini-test');
    assert.match(call.contents, /<event>/);
    assert.deepEqual(call.config, {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseJsonSchema: PLAN_JSON_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      safetySettings: [
        HarmCategory.HARM_CATEGORY_HARASSMENT,
        HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      ].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE })),
      abortSignal: signal,
    });
  });

  it('defaults to the real clock', async () => {
    const plan = await createPlanner({ ai: fakeAi(), models: ['gemini-test'] }).createPlan(
      request(),
    );
    assert.ok(plan.timeline.every(({ due }) => /^\d{4}-\d{2}-\d{2}$/.test(due)));
  });

  it('returns the plan with exact amounts and dates', async () => {
    const plan = await planner(fakeAi()).createPlan(request());
    assert.equal(plan.title, aiPlan().title);
    assert.equal(
      plan.budget.reduce((total, { amount }) => total + amount, 0),
      200_000,
    );
    assert.equal(plan.timeline[0].due, '2026-11-08');
  });

  it('reuses the answer for identical requests but not for different ones', async () => {
    const ai = fakeAi();
    const service = planner(ai);
    await service.createPlan(request());
    await service.createPlan(request());
    await service.createPlan(request({ guests: 80 }));
    assert.equal(ai.calls.length, 2);
  });

  it('sends refinement feedback to the model', async () => {
    const ai = fakeAi();
    await planner(ai).createPlan({
      ...request(),
      refine: { plan: aiPlan(), feedback: 'Go vegan' },
    });
    assert.match(ai.calls[0].contents, /<feedback>\n"Go vegan"/);
  });

  it('rejects malformed or incomplete AI output with 502', async () => {
    await rejectsWith(planner(fakeAi(() => ({ text: '{"title":' }))).createPlan(request()), 502);
    await rejectsWith(
      planner(fakeAi(() => ({ text: '{"title":"Only a title"}' }))).createPlan(request()),
      502,
    );
    await rejectsWith(planner(fakeAi(() => ({}))).createPlan(request()), 502);
  });

  it('explains blocked prompts and withheld answers with 422, trying no other model', async () => {
    const blocked = fakeAi(() => ({ promptFeedback: { blockReason: 'SAFETY' } }));
    await rejectsWith(planner(blocked).createPlan(request()), 422);
    const withheld = fakeAi(() => ({ candidates: [{ finishReason: 'SAFETY' }] }));
    await rejectsWith(planner(withheld, ['first', 'second']).createPlan(request()), 422);
    assert.equal(withheld.calls.length, 1);
    const finished = fakeAi(() => ({
      candidates: [{ finishReason: 'STOP' }],
      text: JSON.stringify(aiPlan()),
    }));
    assert.ok(await planner(finished).createPlan(request()));
  });

  it('maps timeouts, overload and outages to clear statuses', async () => {
    const failing = (error) =>
      planner(
        fakeAi(() => {
          throw error;
        }),
      ).createPlan(request());
    await rejectsWith(failing(new DOMException('Timed out', 'AbortError')), 504);
    await rejectsWith(failing(new ApiError({ message: 'Deadline expired', status: 504 })), 504);
    await rejectsWith(failing(new ApiError({ message: 'Quota exceeded', status: 429 })), 503);
    await rejectsWith(failing(new ApiError({ message: 'High demand', status: 503 })), 503);
    await rejectsWith(failing(new ApiError({ message: 'Internal', status: 500 })), 502);
    await rejectsWith(failing(new TypeError('fetch failed')), 502);
  });

  it('does not cache failures', async () => {
    let attempt = 0;
    const ai = fakeAi(() =>
      ++attempt === 1 ? { text: 'oops' } : { text: JSON.stringify(aiPlan()) },
    );
    const service = planner(ai);
    await rejectsWith(service.createPlan(request()), 502);
    assert.equal((await service.createPlan(request())).title, aiPlan().title);
  });
});

describe('model fallback', () => {
  const MODELS = ['primary', 'backup'];

  /** Fake client whose primary model returns or throws `failure` while the backup succeeds. */
  const flakyAi = (failure) =>
    fakeAi(({ model }) => {
      if (model === 'backup') return { text: JSON.stringify(aiPlan()) };
      if (failure instanceof Error) throw failure;
      return failure;
    });

  it('moves to the next model when one is busy, slow or returns an unusable plan', async () => {
    const failures = [
      new ApiError({ message: 'High demand', status: 503 }),
      new ApiError({ message: 'Deadline expired', status: 504 }),
      new ApiError({ message: 'Quota exceeded', status: 429 }),
      new DOMException('Timed out', 'AbortError'),
      { text: '{"title":' },
    ];
    for (const failure of failures) {
      const ai = flakyAi(failure);
      const plan = await planner(ai, MODELS).createPlan(request());
      assert.equal(plan.title, aiPlan().title);
      assert.deepEqual(
        ai.calls.map(({ model }) => model),
        MODELS,
      );
    }
  });

  it('does not retry blocked prompts or requests the API rejects', async () => {
    const cases = [
      [{ promptFeedback: { blockReason: 'SAFETY' } }, 422],
      [new ApiError({ message: 'API key not valid', status: 400 }), 502],
    ];
    for (const [failure, status] of cases) {
      const ai = flakyAi(failure);
      await rejectsWith(planner(ai, MODELS).createPlan(request()), status);
      assert.equal(ai.calls.length, 1);
    }
  });

  it('stops as soon as the client has gone away', async () => {
    const controller = new AbortController();
    const ai = fakeAi(() => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    await rejectsWith(
      planner(ai, MODELS).createPlan(request(), { signal: controller.signal }),
      504,
    );
    assert.equal(ai.calls.length, 1);
  });

  it('reports the last failure when every model fails', async () => {
    const ai = fakeAi(() => {
      throw new ApiError({ message: 'High demand', status: 503 });
    });
    await rejectsWith(planner(ai, MODELS).createPlan(request()), 503);
    assert.equal(ai.calls.length, 2);
  });
});
