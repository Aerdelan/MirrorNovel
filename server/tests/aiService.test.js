const test = require('node:test');
const assert = require('node:assert/strict');

const { streamGenerate, resolveApiConfig, MAX_GENERATION_TOKENS, extractProviderMaxTokens, getOutlineRequirements, buildOutlinePrompt, buildChapterPlan, getChapterPlanOutputTokens, buildGenreStyleContract, buildOptimizeAnalysisPrompt, buildOptimizeChapterPrompt } = require('../services/aiService');

test('generation output budget allows the configured 700k token ceiling', () => {
  assert.equal(MAX_GENERATION_TOKENS, 700000);
});

test('provider max_tokens validation is parsed and retried within the hard limit', async () => {
  assert.equal(extractProviderMaxTokens('{"message":"max_tokens参数非法：限制数值范围[1,131072]"}'), 131072);
  const originalFetch = global.fetch;
  const requested = [];
  try {
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      requested.push(body.max_tokens);
      if (requested.length === 1) {
        return { ok: false, status: 400, text: async () => '{"message":"max_tokens参数非法：限制数值范围[1,131072]"}' };
      }
      return { ok: true, body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) } };
    };
    await streamGenerate('system', 'prompt', null, null, { baseUrl: 'https://example.test/v1', model: 'glm-4.7' }, 0, 0.2, 700000);
    assert.deepEqual(requested, [700000, 131072]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('outline requirements scale stages, cast, branches, nodes and output budget with target size', () => {
  const short = getOutlineRequirements(100000);
  const long = getOutlineRequirements(1000000);
  assert.ok(long.phaseCount > short.phaseCount);
  assert.ok(long.nodeCount > short.nodeCount);
  assert.ok(long.characterCount > short.characterCount);
  assert.ok(long.subplotCount > short.subplotCount);
  assert.ok(long.outlineChars > short.outlineChars);
  assert.ok(long.outputTokens > short.outputTokens);
  assert.match(buildOutlinePrompt('urban', '林舟', '旧城', 1000000), /严格写12个阶段/);
  assert.match(buildOutlinePrompt('urban', '林舟', '旧城', 1000000), /至少24条支线/);
});

test('chapter plans receive the confirmed blueprint and flexible breathing guidance', () => {
  const prompt = buildChapterPlan('主角追查旧案', 100000, '林舟', '旧城', '', null, {
    mainArc: '追查旧案并面对关系代价',
    lockedFacts: ['主角是记者'],
    phases: [{ title: '关系裂变', startChapter: 5, endChapter: 12, goal: '信任崩塌', threads: ['苏晚的隐瞒'] }],
  });
  assert.match(prompt, /用户已确认的故事蓝图/);
  assert.match(prompt, /苏晚的隐瞒/);
  assert.match(prompt, /缓冲功能/);
  assert.match(prompt, /禁止固定每隔 N 章/);
  assert.ok(getChapterPlanOutputTokens(1000000) > getChapterPlanOutputTokens(100000));
});

test('genre contracts differentiate deep narrative behavior', () => {
  assert.match(buildGenreStyleContract('mystery'), /受限信息和可验证线索/);
  assert.match(buildGenreStyleContract('romance'), /关系变化而非事件清单/);
  assert.notEqual(buildGenreStyleContract('mystery'), buildGenreStyleContract('romance'));
});

test('optimization prompts retain the selected genre contract', () => {
  const chapters = [{ chapterNumber: 1, wordCount: 1000, content: '旧城的雨落在铁门上。' }];
  assert.match(buildOptimizeAnalysisPrompt(chapters, '主线', '林舟', '旧城', null, 'mystery'), /受限信息和可验证线索/);
  assert.match(buildOptimizeChapterPrompt(chapters[0], 1, '节奏建议', '主线', null, 'romance'), /关系变化而非事件清单/);
});

test('streamGenerate reports an unconfigured route before making a request', async () => {
  await assert.rejects(
    () => streamGenerate('system', 'prompt', null, null, { baseUrl: '', model: '' }),
    (error) => error.isApiError === true && error.message.includes('尚未配置')
  );
});

test('streamGenerate does not retry after its caller cancels the request', async () => {
  const originalFetch = global.fetch;
  const controller = new AbortController();
  let calls = 0;
  try {
    global.fetch = async () => {
      calls += 1;
      controller.abort();
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    };
    await assert.rejects(
      () => streamGenerate('system', 'prompt', null, controller.signal, { baseUrl: 'https://example.test/v1', model: 'test' }, 2),
      /已取消/
    );
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('managed route selection uses the configured task role override', () => {
  const config = resolveApiConfig({
    provider: 'system',
    routeId: 'normal_1',
    roleRoutes: { outline: 'vip', polish: 'svip' },
  }, 'polish');
  assert.equal(config.routeId, 'svip');
});

test('writing and polish routes disable deep thinking while reasoning keeps it', () => {
  const writing = resolveApiConfig({ provider: 'system', routeId: 'normal_1' }, 'writing');
  const polish = resolveApiConfig({ provider: 'system', routeId: 'normal_1' }, 'polish');
  const reasoning = resolveApiConfig({ provider: 'system', routeId: 'normal_1' }, 'reasoning');
  assert.equal(writing.disableThinking, true);
  assert.equal(polish.disableThinking, true);
  assert.equal(reasoning.disableThinking, false);
});
