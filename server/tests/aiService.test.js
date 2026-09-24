const test = require('node:test');
const assert = require('node:assert/strict');

const { streamGenerate, resolveApiConfig, MAX_GENERATION_TOKENS, extractProviderMaxTokens, getOutlineRequirements, buildOutlinePrompt, buildChapterPlan, getChapterPlanOutputTokens, buildGenreStyleContract, buildOptimizeAnalysisPrompt, buildOptimizeChapterPrompt, normalizeChapterWordTarget, getFriendlyErrorMessage, buildSystemPrompt, mergeAxes, normalizeAxes, buildStyleProfileBlock, completeOnce } = require('../services/aiService');

test('思考/推理参数被上游拒绝时给出可读提示（覆盖各家措辞），且不误判无关 400', () => {
  for (const message of [
    '当前模型不支持该能力：reasoning', // DeepSeek 实际措辞
    'unknown parameter: thinking',
    'reasoning_effort is not supported',
    '不支持该能力：思考',
  ]) {
    const hint = getFriendlyErrorMessage(400, JSON.stringify({ error: { message } }));
    assert.match(hint, /不支持当前思考参数/);
  }
  // max_tokens 参数非法属于另一类问题，不能被当成"思考参数被拒"
  const other = getFriendlyErrorMessage(400, '{"message":"max_tokens参数非法：限制数值范围[1,8000]"}');
  assert.match(other, /AI 请求参数有误/);
});

test('上游返回 U+FFFD 时原样继续产出，不中止也不重试', async () => {
  const originalFetch = global.fetch;
  let requestCount = 0;
  let displayed = '';
  try {
    global.fetch = async () => {
      requestCount += 1;
      const chunks = ['正常前缀', '损坏�字符', '后续仍然继续'];
      let index = 0;
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              if (index >= chunks.length) return { done: true, value: undefined };
              const content = chunks[index++];
              const data = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
              return { done: false, value: new TextEncoder().encode(data) };
            },
            cancel: async () => {},
          }),
        },
      };
    };

    const result = await streamGenerate(
      '系统', '用户',
      (chunk) => { displayed += chunk; },
      null,
      { baseUrl: 'https://encoding.test/v1', model: 'test', disableThinking: true },
      2, 0.2, 4000, 60000,
    );

    assert.equal(requestCount, 1);
    assert.equal(result.content, '正常前缀损坏�字符后续仍然继续');
    assert.equal(displayed, result.content);
    assert.match(displayed, /�/);
  } finally {
    global.fetch = originalFetch;
  }
});

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
  assert.equal(extractProviderMaxTokens('{"error":{"message":"max_tokens is too large: 700000. This model supports at most 131072 completion tokens"}}'), 131072);
  const originalFetch = global.fetch;
  const requested = [];
  try {
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      requested.push(body.max_tokens);
      if (requested.length === 1) {
        return { ok: false, status: 400, text: async () => '{"error":{"message":"max_tokens is too large: 700000. This model supports at most 131072 completion tokens"}}' };
      }
      return { ok: true, body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) } };
    };
    await streamGenerate('system', 'prompt', null, null, { baseUrl: 'https://example.test/v1', model: 'glm-4.7' }, 0, 0.2, 700000);
    assert.deepEqual(requested, [700000, 131072]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('截断自动续写：轮数不被夹在 2，且续写轮预算与首轮同级', async () => {
  const originalFetch = global.fetch;
  const budgets = [];
  try {
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      budgets.push(body.max_tokens);
      // 每一轮都回“仍被截断”：模拟服务商单轮输出上限低于大纲总预算的常见情形。
      const text = `第${budgets.length}段大纲内容，包含阶段与支线。`.repeat(16);
      let reads = 0;
      return { ok: true, body: { getReader: () => ({
        read: async () => {
          reads += 1;
          return reads === 1
            ? { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'length' }] })}\n\n`) }
            : { done: true, value: undefined };
        },
      }) } };
    };
    const config = { baseUrl: 'https://stitch-cache.test/v1', model: 'glm-4.7', disableThinking: true };
    const result = await streamGenerate('系统', '用户', null, null, config, 0, 0.5, 20000, 60000, null, { stitchOnTruncation: true, maxStitchRounds: 6 });
    assert.equal(result.stitchedRounds, 6, `应续写满 6 轮，实际 ${result.stitchedRounds}`);
    assert.equal(budgets.length, 7); // 首轮 + 6 轮续写
    // 续写轮不得再被打折：以前只给首轮一半预算，续写自己先截断，轮数就成了摆设。
    assert.ok(budgets.slice(1).every((v) => v >= budgets[0]), `续写轮预算应不低于首轮：${budgets.join(',')}`);
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
  assert.ok(long.coreCharacterCount <= 12);
  assert.ok(long.coreCharacterCount < long.characterCount);
  assert.ok(long.subplotCount > short.subplotCount);
  assert.ok(long.outlineChars > short.outlineChars);
  assert.ok(long.outputTokens > short.outputTokens);
  // 预算放开到 4.8 万 token：要求 12 阶段/24 支线却只给写不完的预算，
  // 那不是省 token 而是废大纲；单轮超出线路上限时由服务商报错自动收缩预算。
  assert.ok(long.outputTokens <= 48000);
  assert.match(buildOutlinePrompt('urban', '林舟', '旧城', 1000000), /严格写12个阶段/);
  assert.match(buildOutlinePrompt('urban', '林舟', '旧城', 1000000), /至少24条支线/);
  assert.match(buildOutlinePrompt('urban', '林舟', '旧城', 2800000), /12名核心常驻角色、全书约40名/);
  assert.match(buildOutlinePrompt('urban', '林舟', '旧城', 2800000), /不得为了凑数量一次性罗列姓名/);
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
    tagChecklist: ['日系校园', '搞笑'],
    phases: [{ title: '关系裂变', startChapter: 5, endChapter: 12, goal: '信任崩塌', threads: ['苏晚的隐瞒'], tagCommitments: ['搞笑：误会型笑点'], characterBeats: [{ character: '苏晚', voiceGuard: '短句，不解释感受' }], requiredScenes: ['社团教室'], forbiddenDrift: ['禁止霸总化'], subphases: [{ title: '误会加深', startChapter: 5, endChapter: 8, tagCommitments: ['日系校园'] }] }],
    rollingPlan: { startChapter: 1, endChapter: 2, chapters: [{ chapterNumber: 1, purpose: '建立社团关系', tagCommitments: ['搞笑'] }] },
  });
  assert.match(prompt, /用户已确认的故事蓝图/);
  assert.match(prompt, /苏晚的隐瞒/);
  assert.match(prompt, /禁止霸总化/);
  assert.match(prompt, /滚动执行蓝图/);
  assert.match(prompt, /标签兑现/);
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

test('请求上下文兜底：内部调用漏传用户配置时，自动使用本次请求生效的配置', () => {
  const { runWithRequestContext } = require('../services/requestContext');
  const cloudConfig = {
    provider: 'cloud',
    cloudBaseUrl: 'https://own.example.com/v1',
    cloudApiKey: 'sk-own',
    cloudWritingModel: 'own-model',
  };

  // 漏传配置的内部调用（去AI化/编辑引擎/写作 agent 等）从上下文取到用户配置
  const inContext = runWithRequestContext({ userModelConfig: cloudConfig }, () => resolveApiConfig(null, 'writing'));
  assert.equal(inContext.baseUrl, 'https://own.example.com/v1');
  assert.equal(inContext.model, 'own-model');

  // 显式传入的配置优先于上下文
  const explicit = runWithRequestContext({ userModelConfig: cloudConfig }, () =>
    resolveApiConfig({ provider: 'cloud', cloudBaseUrl: 'https://other.example.com/v1', cloudApiKey: 'k2', cloudWritingModel: 'm2' }, 'writing'));
  assert.equal(explicit.baseUrl, 'https://other.example.com/v1');

  // 调用方显式传了"系统线路"（provider=system）时，只要上下文里有用户自备模型，
  // 也优先用自备模型——绝不在某一环悄悄落到服务器默认线路
  const overrideSystem = runWithRequestContext({ userModelConfig: cloudConfig }, () =>
    resolveApiConfig({ provider: 'system', routeId: 'normal_1' }, 'writing'));
  assert.equal(overrideSystem.baseUrl, 'https://own.example.com/v1');
  assert.equal(overrideSystem.model, 'own-model');

  // 不在请求上下文内时保持原行为：不抛错、返回配置对象（具体 baseUrl 取决于
  // 环境里是否配置了默认线路，不做环境相关断言）
  const fallback = resolveApiConfig(null, 'writing');
  assert.ok(fallback && typeof fallback === 'object');
});

test('provider 字段丢失时的容错：只要自备地址还在，就按自定义模型走，不落到系统线路', () => {
  // 历史保存方式可能没带上 provider，但地址/密钥/模型都在
  const noProvider = { cloudBaseUrl: 'https://own.example.com/v1', cloudApiKey: 'sk-own', cloudWritingModel: 'own-model' };
  const cfg = resolveApiConfig(noProvider, 'writing');
  assert.equal(cfg.baseUrl, 'https://own.example.com/v1');
  assert.equal(cfg.model, 'own-model');
  assert.equal(cfg.apiKey, 'sk-own');

  // 只有 ollama 字段时同样能推导
  const ollama = resolveApiConfig({ ollamaWritingModel: 'qwen2.5', ollamaBaseUrl: 'http://localhost:11434' }, 'writing');
  assert.equal(ollama.baseUrl, 'http://localhost:11434');
  assert.equal(ollama.model, 'qwen2.5');
});

// ===== 风格光谱六轴 / 风格档案系统 =====
test('normalizeAxes 规范化为 1-5 整数、无有效值返回 null', () => {
  assert.equal(normalizeAxes(null), null);
  assert.equal(normalizeAxes({}), null);
  assert.equal(normalizeAxes({ temperature: 'x' }), null);
  const n = normalizeAxes({ temperature: 6, humor: 0.4, diction: 3 });
  assert.equal(n.temperature, 5);   // 上限夹到 5
  assert.equal(n.diction, 3);
  assert.equal(n.humor, 1);         // 下限夹到 1
});

test('mergeAxes 靠后来源逐轴覆盖', () => {
  const merged = mergeAxes({ temperature: 2, humor: 2 }, { humor: 5 });
  assert.equal(merged.temperature, 2); // 前者保留
  assert.equal(merged.humor, 5);       // 后者覆盖
});

test('风格档案：高幽默+介入叙述者时授权发力，且不含冷调强制', () => {
  const persona = {
    voice: '紧贴主角', rules: '1. 放飞',
    axes: { humor: 5, narrator: 5, temperature: 4 },
  };
  const prompt = buildSystemPrompt('urban', 'male', persona);
  // 档案块作为最高风格权威置顶
  assert.match(prompt, /【本书风格档案 — 最高风格权威】/);
  assert.ok(prompt.indexOf('【本书风格档案') < prompt.indexOf('【写作规则】') || prompt.indexOf('【本书风格档案') < prompt.indexOf('核心写作要求'),
    '风格档案应优先于工艺/写作指南出现');
  // 高幽默 / 介入叙述者被明确授权（取右端描述，偏高 5/5）
  assert.match(prompt, /高频谐趣、梗与反差常见（偏高，5\/5）/);
  assert.match(prompt, /介入张扬、可议论\/吐槽\/与读者互动（偏高，5\/5）/);
  // 不再把文本拉回统一克制冷静腔
  assert.doesNotMatch(prompt, /禁止随机走神、无关观察、强行吐槽/);
  assert.match(prompt, /拉回与本档案相反/);
});

test('向后兼容：人格与类型都无 axes 时不注入风格档案块', () => {
  // 用一个不存在的类型 id（无法带 axes）+ 无 axes 人格 → 无档案块
  const prompt = buildSystemPrompt('no_such_type_zzz', 'male', { voice: 'x', tone: 'y', rules: 'z' });
  assert.doesNotMatch(prompt, /【本书风格档案/);
});

test('风格基调契约：resolvedType 携带 toneContract 时作为硬承诺置顶注入（无 persona 与有 persona 两条路径）', () => {
  const resolvedType = {
    name: '都市·都市脑洞', keywords: '系统, 吐槽', outline: '', aiWordBank: '',
    axes: { humor: 5, narrator: 5 },
    toneContract: '【风格基调契约 — 与读者的类型约定，必须在全篇稳定兑现】\n本书锁定的风格基调：「搞笑/无厘头」。',
  };
  const plain = buildSystemPrompt('urban', 'male', null, resolvedType);
  assert.match(plain, /【风格基调契约/);
  assert.match(plain, /搞笑\/无厘头/);
  // 契约应出现在正文写作要求之前（置顶）
  assert.ok(plain.indexOf('风格基调契约') < plain.indexOf('核心写作要求'), '基调契约需置顶');
  // persona 分支同样注入
  const withPersona = buildSystemPrompt('urban', 'male', { voice: 'x', rules: 'y' }, resolvedType);
  assert.match(withPersona, /【风格基调契约/);
  // 旧路径（无 toneContract）不注入，向后兼容
  const legacy = buildSystemPrompt('urban', 'male', null, { name: '都市', keywords: '', outline: '', aiWordBank: '' });
  assert.doesNotMatch(legacy, /【风格基调契约/);
});

test('大纲提示词：传入 researchBlock 时把联网取材事实并入；不传时保持原样（向后兼容）', () => {
  const research = '【联网取材参考】\n- 唐代长安城采用里坊制（来源1）';
  const withResearch = buildOutlinePrompt('historical', '林舟', '盛唐', 500000, null, 5000, null, research);
  assert.match(withResearch, /联网取材得到的事实参考资料/);
  assert.match(withResearch, /里坊制/);
  // 资料段应位于大纲结构要求之前，确保大纲能用上事实
  assert.ok(withResearch.indexOf('联网取材') < withResearch.indexOf('请按以下格式输出大纲'), '取材需先于输出格式要求');
  // 未取材时不注入资料段
  const plain = buildOutlinePrompt('historical', '林舟', '盛唐', 500000, null, 5000);
  assert.doesNotMatch(plain, /联网取材得到的事实参考资料/);
});

test('completeOnce：非流式封装复用 streamGenerate，返回完整 content', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.stream, true, '底层仍走 SSE 通道');
      const chunks = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: '第一段' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: '第二段' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ];
      let reads = 0;
      return { ok: true, body: { getReader: () => ({
        read: async () => (reads < chunks.length
          ? { done: false, value: new TextEncoder().encode(chunks[reads++]) }
          : { done: true, value: undefined }),
      }) } };
    };
    const config = { baseUrl: 'https://example.test/v1', model: 'glm-4.7', disableThinking: true };
    const text = await completeOnce('系统', '用户', config, { temperature: 0.3, maxTokens: 1024, timeoutMs: 30000 });
    assert.equal(text, '第一段第二段');
  } finally {
    global.fetch = originalFetch;
  }
});
