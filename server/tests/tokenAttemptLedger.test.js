const test = require('node:test');
const assert = require('node:assert/strict');

const { streamGenerate } = require('../services/aiService');
const { recordTokenUsage } = require('../services/tokenUsage');

function sseResponse(frames) {
  const encoded = frames.map((frame) => new TextEncoder().encode(
    `data: ${JSON.stringify(frame)}\n\n`,
  ));
  let index = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => (index < encoded.length
          ? { done: false, value: encoded[index++] }
          : { done: true, value: undefined }),
        cancel: async () => {},
      }),
    },
  };
}

test('streamGenerate requests include_usage, records fallback attempt, and caches unsupported capability', async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  let calls = 0;
  try {
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: { message: 'unknown parameter: stream_options.include_usage' } }),
        };
      }
      return sseResponse([
        { choices: [{ delta: { content: '正文' }, finish_reason: 'stop' }] },
        { choices: [{ delta: {} }], usage: { prompt_tokens: 40, completion_tokens: 8 } },
      ]);
    };

    const config = { baseUrl: 'https://usage-capability.test/v1', model: 'legacy', role: 'outline', routeId: 'user-route', disableThinking: true };
    const first = await streamGenerate('系统', '用户', null, null, config, 0, 0.8, 4096, 90000, null, { taskType: 'global_outline' });
    assert.deepEqual(bodies[0].stream_options, { include_usage: true });
    assert.equal(bodies[1].stream_options, undefined);
    assert.equal(first.attempts.length, 2);
    assert.equal(first.attempts[0].retryReason, 'usage_stream_unsupported');
    assert.equal(first.attempts[0].discarded, true);
    assert.equal(first.attempts[1].role, 'outline');
    assert.equal(first.attempts[1].taskType, 'global_outline');
    assert.equal(first.attempts[1].model, 'legacy');
    assert.equal(first.attempts[1].routeId, 'user-route');
    assert.equal(first.attempts[1].providerHost, 'usage-capability.test');
    assert.equal(first.attempts[1].statusCode, 200);
    assert.equal(first.attempts[1].accepted, true);
    assert.ok(first.usage.prompt_tokens > 40, 'failed capability probe must remain visible in cumulative usage');

    await streamGenerate('系统', '第二次', null, null, config, 0);
    assert.equal(bodies[2].stream_options, undefined, 'capability rejection should be cached per route/model');
  } finally {
    global.fetch = originalFetch;
  }
});

test('streamGenerate aggregates provider usage across truncation continuation calls', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  try {
    global.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return sseResponse([
          { choices: [{ delta: { content: '第一段正文。'.repeat(50) }, finish_reason: 'length' }] },
          { choices: [{ delta: {} }], usage: { prompt_tokens: 100, completion_tokens: 50, prompt_cache_hit_tokens: 20 } },
        ]);
      }
      return sseResponse([
        { choices: [{ delta: { content: '接续内容。'.repeat(20) }, finish_reason: 'stop' }] },
        { choices: [{ delta: {} }], usage: { prompt_tokens: 80, completion_tokens: 30, prompt_cache_hit_tokens: 10 } },
      ]);
    };

    const result = await streamGenerate(
      '系统', '用户', null, null,
      { baseUrl: 'https://usage-stitch.test/v1', model: 'test', role: 'writing', disableThinking: true },
      0, 0.5, 4000, 60000, null,
      { stitchOnTruncation: true, maxStitchRounds: 1 },
    );

    assert.equal(calls, 2);
    assert.equal(result.attempts.length, 2);
    assert.deepEqual(result.attempts.map((item) => item.attempt), [1, 2]);
    assert.ok(result.attempts.every((item) => item.accepted && !item.discarded));
    assert.equal(result.usage.prompt_tokens, 180);
    assert.equal(result.usage.completion_tokens, 80);
    assert.equal(result.usage.prompt_cache_hit_tokens, 30);
    assert.equal(result.inputTokens, 180);
  } finally {
    global.fetch = originalFetch;
  }
});

test('streamGenerate never restarts the original prompt after partial output', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  try {
    global.fetch = async () => {
      calls += 1;
      let readCount = 0;
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              readCount += 1;
              if (readCount === 1) {
                return {
                  done: false,
                  value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '已经写出的唯一开头。' } }] })}\n\n`),
                };
              }
              throw new Error('socket reset');
            },
          }),
        },
      };
    };

    await assert.rejects(
      () => streamGenerate(
        '系统', '用户', null, null,
        { baseUrl: 'https://partial-stream.test/v1', model: 'test', role: 'writing', disableThinking: true },
        3,
      ),
      (error) => {
        assert.equal(error.partial, true);
        assert.equal(error.resumable, true);
        assert.equal(error.partialContent, '已经写出的唯一开头。');
        assert.equal(error.attempts.length, 1);
        assert.equal(error.attempts[0].accepted, true);
        assert.equal(error.attempts[0].retryReason, 'partial_output_requires_resume');
        return true;
      },
    );
    assert.equal(calls, 1, 'a partial stream must not be retried from the beginning');
  } finally {
    global.fetch = originalFetch;
  }
});

test('recordTokenUsage persists bounded per-attempt attribution and physical call counts', () => {
  const novel = {};
  recordTokenUsage(novel, 'writing', {
    usage: {
      prompt_tokens: 55,
      completion_tokens: 32,
      reasoning_tokens: 5,
      prompt_cache_hit_tokens: 10,
    },
    attempts: [
      {
        role: 'writing', attempt: 1, accepted: false, discarded: true,
        taskType: 'chapter_write', model: 'writer-v1', routeId: 'normal_1', providerHost: 'provider.test',
        inputTokens: 15, outputTokens: 12, reasoningTokens: 5,
        error: 'temporary failure', retryReason: 'transient_error', estimated: true,
        startedAt: '2026-09-26T10:00:00.000Z', durationMs: 1234, statusCode: 503,
      },
      {
        role: 'writing', attempt: 2, accepted: true, discarded: false,
        inputTokens: 40, outputTokens: 20, cacheSavedTokens: 10, estimated: false,
      },
    ],
  });

  assert.equal(novel.tokenUsage.calls, 2);
  assert.equal(novel.tokenUsage.logicalCalls, 1);
  assert.equal(novel.tokenUsage.failedCalls, 1);
  assert.equal(novel.tokenUsage.estimatedCalls, 1);
  assert.equal(novel.tokenUsage.discardedTokens, 12);
  assert.equal(novel.tokenUsage.reasoningTokens, 5);
  assert.equal(novel.tokenUsage.attempts.length, 2);
  assert.equal(novel.tokenUsage.attempts[0].retryReason, 'transient_error');
  assert.equal(novel.tokenUsage.attempts[0].taskType, 'chapter_write');
  assert.equal(novel.tokenUsage.attempts[0].model, 'writer-v1');
  assert.equal(novel.tokenUsage.attempts[0].providerHost, 'provider.test');
  assert.equal(novel.tokenUsage.attempts[0].durationMs, 1234);
  assert.equal(novel.tokenUsage.attempts[0].statusCode, 503);
});
