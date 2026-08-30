const test = require('node:test');
const assert = require('node:assert/strict');

const { streamGenerate, resolveApiConfig, MAX_GENERATION_TOKENS, extractProviderMaxTokens, getOutlineRequirements, buildOutlinePrompt, buildChapterPlan, getChapterPlanOutputTokens, buildGenreStyleContract, buildOptimizeAnalysisPrompt, buildOptimizeChapterPrompt, normalizeChapterWordTarget } = require('../services/aiService');

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

test('thinking parameter self-corrects when the model rejects it instead of retrying blindly', async () => {
  const originalFetch = global.fetch;
  const thinkingBodies = [];
  const fullBodies = [];
  try {
    // glm-5.3-flash 场景：服务商返回"当前模型必须开启深度思考"。
    // 第一次带 thinking:{type:'disabled'}，必须被自动改为 enabled，
    // 同时放大输出预算（思考与正文共享 max_tokens）并附加 reasoning_effort。
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      thinkingBodies.push(body.thinking || null);
      fullBodies.push(body);
      if (thinkingBodies.length === 1) {
        return { ok: false, status: 400, text: async () => '{"message":"AI 请求参数有误：当前模型必须开启深度思考"}' };
      }
      // read() 首帧返回数据，之后立即 done，模拟流结束。
      let reads = 0;
      return { ok: true, body: { getReader: () => ({
        read: async () => {
          reads += 1;
          return reads === 1
            ? { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '大纲内容' } }] })}\n\n`) }
            : { done: true, value: undefined };
        },
      }) } };
    };
    const result = await streamGenerate('系统提示', '用户提示', null, null, { baseUrl: 'https://example.test/v1', model: 'glm-5.3-flash', disableThinking: true }, 2, 0.8, 4000);
    assert.equal(result.content, '大纲内容');
    // 第一次 disabled 被拒，第二次修正为 enabled。
    assert.deepEqual(thinkingBodies, [{ type: 'disabled' }, { type: 'enabled' }]);
    // 强制思考线路：预算放大（思考与正文共享 max_tokens），并附 reasoning_effort 限思考。
    assert.equal(fullBodies[1].max_tokens, 16000);
    assert.equal(fullBodies[1].reasoning_effort, 'medium');
  } finally {
    global.fetch = originalFetch;
  }

  // 相反场景：AI_THINKING_DISABLED=true 强制关闭时仍被拒（线路要求开启），
  // 同样自动修正而不是重试三次同样的 400。
  const envForcedBodies = [];
  const originalEnv = process.env.AI_THINKING_DISABLED;
  try {
    process.env.AI_THINKING_DISABLED = 'true';
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      envForcedBodies.push({ thinking: body.thinking || null, max_tokens: body.max_tokens, effort: body.reasoning_effort || null });
      if (envForcedBodies.length === 1) {
        return { ok: false, status: 400, text: async () => '{"message":"AI 请求参数有误：当前模型必须开启深度思考"}' };
      }
      let reads = 0;
      return { ok: true, body: { getReader: () => ({
        read: async () => {
          reads += 1;
          return reads === 1
            ? { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`) }
            : { done: true, value: undefined };
        },
      }) } };
    };
    const result = await streamGenerate('系统提示', '用户提示', null, null, { baseUrl: 'https://example.test/v1', model: 'glm-5.3-flash' }, 2, 0.8, 4000);
    assert.equal(result.content, 'ok');
    assert.deepEqual(envForcedBodies, [
      { thinking: { type: 'disabled' }, max_tokens: 4000, effort: null },
      { thinking: { type: 'enabled' }, max_tokens: 16000, effort: 'medium' },
    ]);
  } finally {
    process.env.AI_THINKING_DISABLED = originalEnv;
    global.fetch = originalFetch;
  }
});

test('thinking starves the content budget: empty output with finish=length escalates max_tokens', async () => {
  const originalFetch = global.fetch;
  const requested = [];
  try {
    // glm-5.3-flash 强制思考场景：修正为 enabled 后，思考吃满 max_tokens，
    // 流以 finish_reason=length 结束且正文为空。重试必须放大预算并收紧
    // reasoning_effort，否则同预算重试必然再次空输出。
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      requested.push({ max_tokens: body.max_tokens, effort: body.reasoning_effort || null });
      if (requested.length === 1) {
        return { ok: false, status: 400, text: async () => '{"message":"当前模型必须开启深度思考"}' };
      }
      if (requested.length === 2) {
        // 只有 reasoning，没有正文，思考吃满预算被截断。
        const chunks = [
          `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '推理'.repeat(200) } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`,
          'data: [DONE]\n\n',
        ];
        let reads = 0;
        return { ok: true, body: { getReader: () => ({
          read: async () => {
            if (reads < chunks.length) { const v = chunks[reads]; reads += 1; return { done: false, value: new TextEncoder().encode(v) }; }
            return { done: true, value: undefined };
          },
        }) } };
      }
      // 第二次（放大预算后）正常返回正文。
      let reads = 0;
      return { ok: true, body: { getReader: () => ({
        read: async () => {
          reads += 1;
          return reads === 1
            ? { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '大纲正文' } }] })}\n\n`) }
            : { done: true, value: undefined };
        },
      }) } };
    };
    const result = await streamGenerate('系统提示', '用户提示', null, null, { baseUrl: 'https://example.test/v1', model: 'glm-5.3-flash', disableThinking: true }, 2, 0.8, 4000);
    assert.equal(result.content, '大纲正文');
    assert.deepEqual(requested, [
      { max_tokens: 4000, effort: null },        // 初始 disabled
      { max_tokens: 16000, effort: 'medium' },   // 修正 enabled + 放大预算
      { max_tokens: 40000, effort: 'low' },      // 空输出 → 再放大并收紧 effort
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('reasoning_effort is dropped automatically when the route rejects the field', async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  try {
    // 修正思考后附带 reasoning_effort，部分线路不认识该字段（UNKNOWN_FIELD），
    // 必须自动去除并免费重试，而不是把 400 当作最终失败。
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      bodies.push({ thinking: body.thinking || null, effort: body.reasoning_effort || null });
      if (bodies.length === 1) {
        return { ok: false, status: 400, text: async () => '{"message":"当前模型必须开启深度思考"}' };
      }
      if (bodies.length === 2) {
        return { ok: false, status: 400, text: async () => '{"code":"UNKNOWN_FIELD","message":"未知请求字段：reasoning_effort","data":{"field":"reasoning_effort"}}' };
      }
      let reads = 0;
      return { ok: true, body: { getReader: () => ({
        read: async () => {
          reads += 1;
          return reads === 1
            ? { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`) }
            : { done: true, value: undefined };
        },
      }) } };
    };
    const result = await streamGenerate('系统提示', '用户提示', null, null, { baseUrl: 'https://example.test/v1', model: 'glm-5.3-flash', disableThinking: true }, 0, 0.8, 4000);
    assert.equal(result.content, 'ok');
    assert.deepEqual(bodies, [
      { thinking: { type: 'disabled' }, effort: null },
      { thinking: { type: 'enabled' }, effort: 'medium' },
      { thinking: { type: 'enabled' }, effort: null },
    ]);
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
  // 输出预算收紧后，最大目标也不允许回到旧版 12 万 token 的量级。
  assert.ok(long.outputTokens <= 16000);
  assert.match(buildOutlinePrompt('urban', '林舟', '旧城', 1000000), /严格写12个阶段/);
  assert.match(buildOutlinePrompt('urban', '林舟', '旧城', 1000000), /至少24条支线/);
});

test('outline prompt demands information density instead of word-count minimums', () => {
  const prompt = buildOutlinePrompt('urban', '林舟', '旧城', 1000000);
  // 字数下限已删除：长度是结构要求的涌现结果，不再是独立约束。
  assert.doesNotMatch(prompt, /不少于\d+字/);
  assert.match(prompt, /信息密度优先/);
  // 反重复条款：直接封堵"数字升级换皮"式凑节点。
  assert.match(prompt, /数字升级/);
  assert.match(prompt, /宁可短而具体/);
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

test('per-chapter word target scales outline and plan prompts for long-form mysteries', () => {
  // 未传时维持旧口径 3000 字/章，不会改变现有提示词行为。
  assert.equal(normalizeChapterWordTarget(), 3000);
  assert.equal(normalizeChapterWordTarget(undefined), 3000);
  assert.equal(normalizeChapterWordTarget(null), 3000);
  // 福尔摩斯式大章：10000 合法，越界值夹回 [2000, 20000]。
  assert.equal(normalizeChapterWordTarget(10000), 10000);
  assert.equal(normalizeChapterWordTarget(500), 2000);
  assert.equal(normalizeChapterWordTarget(999999), 20000);

  // 大章模式下大纲按新章数估规模，并给出大章节奏指导。
  const defaultReq = getOutlineRequirements(500000);
  const longChapterReq = getOutlineRequirements(500000, 10000);
  assert.equal(defaultReq.chapterWords, 3000);
  assert.equal(defaultReq.estChapters, Math.ceil(500000 / 3000));
  assert.equal(longChapterReq.chapterWords, 10000);
  assert.equal(longChapterReq.estChapters, Math.ceil(500000 / 10000));

  const outlinePrompt = buildOutlinePrompt('mystery', '林舟', '旧城', 500000, null, 10000);
  assert.match(outlinePrompt, /每章约10000字/);
  assert.match(outlinePrompt, /预计需要50章/);
  assert.match(outlinePrompt, /大章节奏/);
  // 默认口径的大纲提示词不带大章节奏段。
  assert.doesNotMatch(buildOutlinePrompt('mystery', '林舟', '旧城', 500000, null), /大章节奏/);

  // 章节计划：章数按每章字数估算，字数带宽按比例放宽。
  const planPrompt = buildChapterPlan('主角追查旧案', 500000, '林舟', '旧城', null, null, 10000);
  assert.match(planPrompt, /预计50章（每章约10000字）/);
  assert.match(planPrompt, /每章目标字数 6700-14000/);
  assert.match(planPrompt, /属于大章/);

  const defaultPlan = buildChapterPlan('主角追查旧案', 500000, '林舟', '旧城', null, null);
  assert.match(defaultPlan, /预计167章（每章约3000字）/);
  assert.match(defaultPlan, /每章目标字数 2010-4200/);
  assert.doesNotMatch(defaultPlan, /属于大章/);

  // 计划输出预算也按每章字数缩放：50 章大章计划的 token 上限低于 167 章默认计划。
  assert.ok(getChapterPlanOutputTokens(500000, 10000) < getChapterPlanOutputTokens(500000, 3000));
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
