const test = require('node:test');
const assert = require('node:assert/strict');

const { streamGenerate, resolveApiConfig, MAX_GENERATION_TOKENS, extractProviderMaxTokens, getOutlineRequirements, buildOutlinePrompt, buildChapterPlan, getChapterPlanOutputTokens, buildGenreStyleContract, buildOptimizeAnalysisPrompt, buildOptimizeChapterPrompt, normalizeChapterWordTarget } = require('../services/aiService');

test('generation output budget allows the configured 700k token ceiling', () => {
  assert.equal(MAX_GENERATION_TOKENS, 700000);
});

test('线路 max_tokens 上限被记住：后续调用不再重复付一次超限往返', async () => {
  const originalFetch = global.fetch;
  const requested = [];
  try {
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      requested.push(body.max_tokens);
      if (body.max_tokens > 8000) {
        return { ok: false, status: 400, text: async () => '{"message":"max_tokens参数非法：限制数值范围[1,8000]"}' };
      }
      return { ok: true, body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) } };
    };
    const config = { baseUrl: 'https://cap-cache.example.test/v1', model: 'glm-4.7', disableThinking: true };
    await streamGenerate('system', 'prompt', null, null, config, 0, 0.2, 20000);
    const firstRoundCount = requested.length;
    await streamGenerate('system', 'prompt', null, null, config, 0, 0.2, 20000);
    // 第二轮的第一个请求就应该已落在上限内（否则每章都要白付一次 400 往返）
    assert.ok(requested[firstRoundCount] <= 8000, `第二轮首个请求应已在限额内，实际 ${requested[firstRoundCount]}`);
  } finally {
    global.fetch = originalFetch;
  }
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

test('线路要求必须开启深度思考时自动开启思考并继续生成（不再直接报错）', async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  try {
    // glm-5.3-flash 场景：请求带 thinking:{type:'disabled'}，服务商返回
    // "当前模型必须开启深度思考"。深度思考模型现在是受支持的一等公民：
    // 识别后自动改为显式开启思考（预算已与正文分离），而不是让用户换模型。
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      bodies.push({ thinking: body.thinking || null, maxTokens: body.max_tokens });
      if (bodies.length === 1) {
        return { ok: false, status: 400, text: async () => '{"message":"AI 请求参数有误：当前模型必须开启深度思考"}' };
      }
      let reads = 0;
      return { ok: true, body: { getReader: () => ({
        read: async () => {
          reads += 1;
          return reads === 1
            ? { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '正文内容' } }] })}\n\n`) }
            : { done: true, value: undefined };
        },
      }) } };
    };
    const result = await streamGenerate('系统提示', '用户提示', null, null, { baseUrl: 'https://example.test/v1', model: 'glm-5.3-flash', disableThinking: true }, 2, 0.8, 4000);
    assert.equal(result.content, '正文内容');
    // 第一次请求"禁用思考"被拒；第二次改为显式开启思考。
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0].thinking, { type: 'disabled' });
    assert.deepEqual(bodies[1].thinking, { type: 'enabled' });
    // 开启思考后总预算 = 正文预算 + 思考预算，正文预算 4000 不被侵占。
    assert.ok(bodies[1].maxTokens > 4000, `思考预算应与正文预算相加，实际 ${bodies[1].maxTokens}`);
    assert.ok(result.thinkingPolicy.enabled === true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('思考吃满预算导致空正文时：压缩/关闭思考，绝不放大总预算', async () => {
  const originalFetch = global.fetch;
  const requested = [];
  try {
    // 旧实现遇到"只有 reasoning、finish=length、正文为空"会把 max_tokens 放大 2.5 倍，
    // 结果下一次思考更长更慢（越重试越糟）。新策略：思考让位，正文预算保持不变。
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      requested.push({ max_tokens: body.max_tokens, thinking: body.thinking || null });
      if (requested.length === 1) {
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
    assert.equal(requested.length, 2);
    // 关键断言：第二次的 max_tokens 不得放大（正文预算 4000 保持不变）。
    assert.deepEqual(requested.map((r) => r.max_tokens), [4000, 4000]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('思考字段被线路拒绝时逐级降级，最终退化为不带思考字段', async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  const envBackup = { mode: process.env.AI_THINKING_MODE, effort: process.env.AI_REASONING_EFFORT };
  delete process.env.AI_THINKING_MODE;
  delete process.env.AI_REASONING_EFFORT;
  try {
    // 各线路对"思考"的字段支持不一：通用线路优先 reasoning_effort，
    // 被拒后换 thinking，再被拒则完全不带思考字段，绝不把 400 当最终失败。
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      bodies.push({ thinking: body.thinking || null, effort: body.reasoning_effort || null });
      if (bodies.length === 1) {
        return { ok: false, status: 400, text: async () => '{"code":"UNKNOWN_FIELD","message":"未知请求字段：reasoning_effort","data":{"field":"reasoning_effort"}}' };
      }
      if (bodies.length === 2) {
        return { ok: false, status: 400, text: async () => '{"code":"UNKNOWN_FIELD","message":"未知请求字段：thinking","data":{"field":"thinking"}}' };
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
    const result = await streamGenerate('系统提示', '用户提示', null, null, { baseUrl: 'https://example.test/v1', model: 'deepseek-chat' }, 1, 0.8, 4000);
    assert.equal(result.content, 'ok');
    assert.deepEqual(bodies, [
      { thinking: null, effort: 'low' },              // 默认：reasoning_effort 优先
      { thinking: { type: 'enabled' }, effort: null }, // 被拒 → 换 thinking
      { thinking: null, effort: null },               // 又被拒 → 不带思考字段
    ]);
    assert.equal(result.thinkingDowngrades, 2);
  } finally {
    if (envBackup.mode === undefined) delete process.env.AI_THINKING_MODE; else process.env.AI_THINKING_MODE = envBackup.mode;
    if (envBackup.effort === undefined) delete process.env.AI_REASONING_EFFORT; else process.env.AI_REASONING_EFFORT = envBackup.effort;
    global.fetch = originalFetch;
  }
});

test('思考失控看门狗：正文开始前思考超限即掐断重试，不再等模型写完数万字思考', async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  const originalMaxChars = process.env.AI_THINKING_MAX_CHARS;
  let firstAttemptReads = 0;
  process.env.AI_THINKING_MAX_CHARS = '50'; // 便于触发：50 字即判定失控
  try {
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      bodies.push({ thinking: body.thinking || null, maxTokens: body.max_tokens });
      if (bodies.length === 1) {
        // 无限思考、永不输出正文：看门狗必须在阈值处掐断。
        return { ok: true, body: { getReader: () => ({
          read: async () => {
            firstAttemptReads += 1;
            return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '思考内容'.repeat(3) } }] })}\n\n`) };
          },
        }) } };
      }
      let reads = 0;
      return { ok: true, body: { getReader: () => ({
        read: async () => {
          reads += 1;
          return reads === 1
            ? { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '第一章正文' } }] })}\n\n`) }
            : { done: true, value: undefined };
        },
      }) } };
    };
    const result = await streamGenerate('系统提示', '用户提示', null, null, { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7' }, 2, 0.8, 4000);
    assert.equal(result.content, '第一章正文');
    assert.equal(bodies.length, 2, '应掐断后重试一次');
    // 掐断发生在阈值附近，而不是把整个（无限）思考流读完。
    assert.ok(firstAttemptReads <= 8, `首次尝试应被早早掐断，实际读取 ${firstAttemptReads} 片`);
    assert.equal(result.reasoningChars > 0, true);
  } finally {
    if (originalMaxChars === undefined) delete process.env.AI_THINKING_MAX_CHARS; else process.env.AI_THINKING_MAX_CHARS = originalMaxChars;
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

test('各角色默认交给思考策略决定，且携带角色信息用于差异化思考预算', () => {
  const writing = resolveApiConfig({ provider: 'system', routeId: 'normal_1' }, 'writing');
  const polish = resolveApiConfig({ provider: 'system', routeId: 'normal_1' }, 'polish');
  const reasoning = resolveApiConfig({ provider: 'system', routeId: 'normal_1' }, 'reasoning');
  const outline = resolveApiConfig({ provider: 'system', routeId: 'normal_1' }, 'outline');

  // 预算已分离（思考不吃正文预算），因此不再全局强制关闭思考；
  // 是否思考由 thinkingPolicy 按角色/线路决定。
  assert.equal(writing.disableThinking, false);
  assert.equal(polish.disableThinking, false);
  assert.equal(reasoning.disableThinking, false);
  assert.equal(outline.disableThinking, false);

  // 角色必须透传，否则无法按角色区分思考预算。
  assert.equal(writing.role, 'writing');
  assert.equal(polish.role, 'polish');
  assert.equal(reasoning.role, 'reasoning');
  assert.equal(outline.role, 'outline');
});
