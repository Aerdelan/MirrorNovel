const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const serverRoot = path.resolve(__dirname, '..');

const state = {
  novels: new Map(),
  jobs: new Map(),
  nextNovelId: 1,
  nextJobId: 1,
  nextNovelDefaults: null,
  chapterQueue: [],
  planContent: '',
  outlineContent: '隔离测试大纲',
  aiHandler: null,
  endingHookConfirmHandler: null,
  aiCalls: [],
  memoryCalls: [],
  memoryHandler: null,
  postProcessChapter: null,
  useRealPersonaPrompt: false,
  lastSystemPromptArgs: null,
  saveFailureAt: 0,
  saveCount: 0,
  jobError: null,
};

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function resetState() {
  state.novels.clear();
  state.jobs.clear();
  state.nextNovelId = 1;
  state.nextJobId = 1;
  state.nextNovelDefaults = null;
  state.chapterQueue = [];
  state.planContent = '';
  state.outlineContent = '隔离测试大纲';
  state.aiHandler = null;
  state.endingHookConfirmHandler = null;
  state.aiCalls = [];
  state.memoryCalls = [];
  state.memoryHandler = null;
  state.postProcessChapter = null;
  state.useRealPersonaPrompt = false;
  state.lastSystemPromptArgs = null;
  state.saveFailureAt = 0;
  state.saveCount = 0;
  state.jobError = null;
}

class InMemoryNovel {
  constructor(data = {}) {
    const injected = clone(state.nextNovelDefaults || {});
    state.nextNovelDefaults = null;
    Object.assign(this, {
      _id: `novel-${state.nextNovelId++}`,
      userId: 'user-1',
      title: '未命名小说',
      novelTypeId: 'xianxia',
      novelTypeName: '玄幻修仙',
      protagonistName: '',
      worldSetting: '',
      outline: '',
      targetWordCount: 50000,
      currentWordCount: 0,
      status: 'generating',
      generationContext: '',
      batchIndex: 0,
      chapterPlan: '',
      chapterPlanData: { version: 1, chapters: [] },
      foreshadowingDoc: '',
      chapterSummaryDoc: '',
      contextMemory: { version: 1, checkpointChapter: 0, checkpointSummary: '', facts: [], openLoops: [] },
      storyBible: {},
      characterStates: [],
      plotThreads: [],
      foreshadowingLedger: [],
      emotionCurve: [],
      recentEventSignatures: [],
      chapters: [],
      currentChapterIndex: 0,
    }, injected, clone(data));
  }

  async save() {
    state.saveCount += 1;
    if (state.saveCount === state.saveFailureAt) throw new Error('isolated persistence failure');
    state.novels.set(String(this._id), this);
    return this;
  }

  markModified() {}

  toObject() {
    return clone(this);
  }

  static async findOne(query = {}) {
    const novel = query._id != null ? state.novels.get(String(query._id))
      : [...state.novels.values()].find(item => String(item.userId) === String(query.userId) && item.generationRequestId === query.generationRequestId);
    if (!novel) return null;
    if (query.userId != null && String(novel.userId) !== String(query.userId)) return null;
    return novel;
  }

  static async findByIdAndUpdate(id, update = {}) {
    const novel = state.novels.get(String(id));
    if (!novel) return null;
    if (update.$set) Object.assign(novel, clone(update.$set));
    await novel.save();
    return novel;
  }
}

const testUser = {
  _id: 'user-1',
  nickname: '隔离测试用户',
  modelConfig: { provider: 'custom' },
  tokens: { total: 100000, used: 0 },
};

function mockModule(relativePath, exports) {
  const filename = require.resolve(path.join(serverRoot, relativePath));
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
}

function abortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

async function emitText(content, onChunk, signal) {
  const text = String(content || '');
  if (signal?.aborted) throw abortError();
  if (onChunk && text) {
    const size = Math.max(1, Math.ceil(text.length / 3));
    for (let index = 0; index < text.length; index += size) {
      if (signal?.aborted) throw abortError();
      onChunk(text.slice(index, index + size));
    }
  }
  // 模拟服务商在流末尾返回的实际用量：prompt_tokens / completion_tokens /
  // prompt_cache_hit_tokens（DeepSeek 口径）。routes/novel 的 token 账本
  // 必须优先采用这些数字而不是本地估算。
  return {
    content: text,
    tokenCount: text.length,
    inputTokens: text.length * 2,
    usage: {
      prompt_tokens: text.length * 2 + 100,
      completion_tokens: Math.max(1, text.length),
      prompt_cache_hit_tokens: text.length,
    },
  };
}

async function defaultAiHandler(call) {
  if (call.onChunk) {
    const content = state.chapterQueue.shift();
    assert.notEqual(content, undefined, '测试场景没有为正文调用准备输出');
    return emitText(content, call.onChunk, call.signal);
  }
  if (call.systemPrompt.includes('章节规划师')) {
    return emitText(state.planContent, null, call.signal);
  }
  if (call.systemPrompt.includes('大纲策划师')) {
    return emitText(state.outlineContent, null, call.signal);
  }
  return emitText('', null, call.signal);
}

const realAiService = require(path.join(serverRoot, 'services/aiService.js'));
const aiServiceMock = {
  // 捕获系统提示参数：SKU 解析结果（keywords/axes/contract/toneContract）是否真的
  // 传到了提示词构建，只有端到端跑一遍才看得出来。
  buildSystemPrompt: (typeId, gender, persona, resolvedType) => {
    state.lastSystemPromptArgs = { typeId, gender, persona, resolvedType };
    return `SYSTEM:${typeId}`;
  },
  buildInitialPrompt: () => 'INITIAL_PROMPT',
  buildPersonaPrompt: (persona, options) => state.useRealPersonaPrompt ? realAiService.buildPersonaPrompt(persona, options) : '',
  buildContinuePrompt: () => 'CONTINUE_PROMPT',
  buildImportContinuePrompt: () => 'IMPORT_CONTINUE_PROMPT',
  buildOutlinePrompt: () => 'OUTLINE_PROMPT',
  getOutlineRequirements: realAiService.getOutlineRequirements,
  // 章节计划提示词直接用真实实现：它是纯字符串构建函数（无 IO），
  // 每章字数等参数只有经过它才能被端到端验证。
  buildChapterPlan: realAiService.buildChapterPlan,
  buildStoryStateSummary: () => '',
  buildOptimizeAnalysisPrompt: () => '',
  buildOptimizeChapterPrompt: () => '',
  normalizeChapterWordTarget: realAiService.normalizeChapterWordTarget,
  // 路由内 withSkuAxes 需要真实的六轴合并函数（纯逻辑、无 IO），沿用真实实现。
  mergeAxes: realAiService.mergeAxes,
  extractChapterSummary: (content) => String(content || '').slice(-120),
  resolveApiConfig: () => ({ provider: 'isolated-test' }),
  countTokens: (content) => String(content || '').length,
  humanizeRewrite: (content) => content,
  // 联网取材浓缩用的非流式封装：隔离测试下直接回空，不触网。
  completeOnce: async () => '',
  getFriendlyErrorMessage: (error) => error?.message || 'mock error',
  streamGenerate: async (systemPrompt, userPrompt, onChunk, signal, apiConfig, retries, temperature, maxTokens, timeoutMs, onReasoning, options) => {
    const call = { systemPrompt, userPrompt, onChunk, signal, apiConfig, retries, temperature, maxTokens, timeoutMs, onReasoning, options };
    if (['chapter_hook_audit_confirm', 'ending_hook_audit_confirm'].includes(options?.taskType)) {
      if (state.endingHookConfirmHandler) return state.endingHookConfirmHandler(call);
      const checks = [...userPrompt.matchAll(/^H(\d+)｜(?:未解问题|新伏笔)：/gm)];
      return emitText(checks.map(([, number]) => `H${number}=YES`).join('\n'), null, signal);
    }
    // Keep legacy creative-call assertions separate from the newly added
    // memory calls; both still return real-shaped usage into the same ledger.
    if (['chapter_memory', 'chapter_memory_compaction', 'stage_memory'].includes(options?.taskType)) {
      state.memoryCalls.push(call);
      if (state.memoryHandler) return state.memoryHandler(call);
      if (options.taskType === 'chapter_memory_compaction') return emitText(JSON.stringify({ summary: '合并后的本章实际事件：人物采取行动后取得了线索，局面随其选择发生变化，并承接新的后果。' }), null, signal);
      if (options.taskType === 'stage_memory') return emitText(JSON.stringify({ summary: '阶段语义总结：' + userPrompt.split('【新增章节总结】')[1].split('【重要事实索引】')[0].slice(0, 1500), focusFactIds: [], focusLoopIds: [] }), null, signal);
      const source = userPrompt.split('【正文开始】\n')[1].split('\n【正文结束】')[0];
      return emitText(JSON.stringify({ summary: '本章实际发生事件及结果：' + source.slice(0, 100),
        events: [{ text: '本章已发生事件：' + source.slice(0, 60), evidence: source.slice(0, 120) }],
        facts: [], characters: [], openLoops: [], resolvedLoops: [] }), null, signal);
    }
    call.kind = onChunk ? 'chapter' : (systemPrompt.includes('章节规划师') ? 'plan' : (systemPrompt.includes('大纲策划师') ? 'outline' : (systemPrompt.includes('连载审读员') ? 'hookAudit' : 'other')));
    state.aiCalls.push(call);
    return (state.aiHandler || defaultAiHandler)(call);
  },
};

mockModule('middleware/auth.js', (req, _res, next) => {
  req.user = testUser;
  req.userId = testUser._id;
  next();
});
mockModule('models/Novel.js', InMemoryNovel);
mockModule('models/User.js', { findById: async () => testUser });
mockModule('services/aiService.js', aiServiceMock);
// 联网取材服务：隔离测试不触网，统一返回空资料块（gatherResearch 走降级路径）。
mockModule('services/webSearchService.js', {
  gatherResearch: async () => ({ block: '', sources: [], skipped: true, note: 'isolated-test' }),
  searchWeb: async () => [],
  fetchUrlContent: async () => ({ url: '', title: '', text: '' }),
  deriveQueries: () => [],
  normalizeLinks: (l) => (Array.isArray(l) ? l : []),
  extractReadableText: (h) => String(h || ''),
  _clearCache: () => {},
});
mockModule('services/chapterToolchain.js', {
  processChapter: (text, options) => ({ text: state.postProcessChapter ? state.postProcessChapter(text, options) : text, report: { isolated: true } }),
});
mockModule('services/editorialEngine.js', {
  runEditorialPipeline: async () => ({ content: '' }),
  STAGES: [],
});

class LeaseBusyError extends Error {
  constructor(novelId) {
    super(`busy:${novelId}`);
    this.code = 'GENERATION_LEASE_BUSY';
  }
}

function activeJobFor(novelId) {
  return [...state.jobs.values()].find((job) => String(job.novelId) === String(novelId)
    && ['running', 'pause_requested'].includes(job.status)) || null;
}

const generationJobMock = {
  LeaseBusyError,
  resumeGenerationJob: async (input) => {
    if (state.jobError) throw state.jobError;
    const active = activeJobFor(input.novelId);
    if (active) throw new LeaseBusyError(input.novelId);
    let job = [...state.jobs.values()].reverse().find((item) => String(item.novelId) === String(input.novelId)
      && item.kind === input.kind && ['queued', 'paused', 'failed'].includes(item.status));
    if (!job) {
      job = {
        jobId: `job-${state.nextJobId++}`,
        novelId: input.novelId,
        kind: input.kind,
        status: 'queued',
        phase: input.phase || 'queued',
        draftPhase: input.phase || 'queued',
        chapterNumber: input.chapterNumber || 0,
        lastCommittedChapter: input.lastCommittedChapter || 0,
        draft: '',
        draftSeq: 0,
        fencingToken: 0,
        events: [],
        eventSeq: 0,
        attempt: 0,
      };
      state.jobs.set(job.jobId, job);
    }
    job.status = 'running';
    job.phase = input.phase || 'resuming';
    job.leaseOwner = input.leaseOwner;
    job.fencingToken += 1;
    job.attempt += 1;
    job.updatedAt = new Date();
    return job;
  },
  heartbeatGenerationJob: async (input) => {
    const job = state.jobs.get(input.jobId);
    if (!job) throw new Error('stale');
    job.pauseRequested = job.status === 'pause_requested';
    return job;
  },
  requestPauseGenerationJob: async (input) => {
    const job = state.jobs.get(input.jobId);
    if (!job) throw new Error('missing job');
    if (job.status === 'queued' || job.status === 'paused') job.status = 'paused';
    else if (job.status === 'running' || job.status === 'pause_requested') job.status = 'pause_requested';
    else {
      const error = new Error('invalid transition');
      error.code = 'GENERATION_JOB_INVALID_TRANSITION';
      throw error;
    }
    job.pauseRequested = job.status === 'pause_requested';
    return job;
  },
  recoverExpiredLeases: async () => 0,
  checkpointGenerationJob: async (input) => {
    const job = state.jobs.get(input.jobId);
    if (!job) throw new Error('stale');
    if (Number(input.draftSeq) > Number(job.draftSeq || 0)) {
      job.draftSeq = input.draftSeq;
      job.draft = String(input.draft || '');
      if (!job.draft) job.draftReview = null;
      else if (input.draftReview !== undefined) job.draftReview = clone(input.draftReview);
      job.chapterNumber = input.chapterNumber ?? job.chapterNumber;
      job.phase = input.phase || job.phase;
      job.draftPhase = input.phase || job.draftPhase;
      if (input.lastCommittedChapter != null) job.lastCommittedChapter = Math.max(job.lastCommittedChapter || 0, input.lastCommittedChapter);
    }
    return job;
  },
  finalizeGenerationJob: async (input) => {
    const job = state.jobs.get(input.jobId);
    if (!job) throw new Error('stale');
    job.status = input.status;
    job.phase = input.phase || input.status;
    if (input.draft != null) {
      job.draft = String(input.draft);
      if (!job.draft) job.draftReview = null;
    }
    if (input.lastCommittedChapter != null) job.lastCommittedChapter = Math.max(job.lastCommittedChapter || 0, input.lastCommittedChapter);
    delete job.leaseOwner;
    return job;
  },
  releaseGenerationJob: async (input) => {
    const job = state.jobs.get(input.jobId);
    if (!job) throw new Error('stale');
    job.status = input.status || 'paused';
    job.phase = input.phase || job.status;
    delete job.leaseOwner;
    return job;
  },
  getGenerationJob: async (jobId) => state.jobs.get(String(jobId)) || null,
  getActiveJob: async (novelId) => activeJobFor(novelId),
  findLatestResumableJob: async (novelId, kind) => [...state.jobs.values()].reverse().find((job) => String(job.novelId) === String(novelId)
    && (!kind || job.kind === kind) && ['queued', 'paused', 'failed'].includes(job.status)) || null,
  appendGenerationEvent: async (input) => {
    const job = state.jobs.get(input.jobId);
    if (!job) throw new Error('missing job');
    job.eventSeq = (job.eventSeq || 0) + 1;
    job.events.push({ seq: job.eventSeq, type: input.type, payload: clone(input.payload || {}) });
    return job;
  },
  readGenerationEvents: async (jobId, after = 0) => (state.jobs.get(String(jobId))?.events || []).filter((event) => event.seq > Number(after || 0)),
};
mockModule('services/generationJob.js', generationJobMock);
mockModule('config/novelTemplates.js', {
  // 只放一条模板用于验证"旧路径仍会注入"；注入策略用真实实现，避免把被测逻辑复制到 mock 里。
  typeTemplates: [{ name: '二次元', gender: 'male', keywords: ['二次元', '日系', '校园', '日常'], variants: [] }],
  buildTemplatePrompt: () => 'TEMPLATE_POOL',
  shouldInjectTemplates: require(path.join(serverRoot, 'config/novelTemplates.js')).shouldInjectTemplates,
});

const novelRouter = require('../routes/novel');

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/novels', novelRouter);
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/novels`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() => {
  resetState();
});

function makeChapter(coreEvent, marker) {
  let content = `${coreEvent}。${marker}。`;
  let beat = 1;
  while (content.length < 680) {
    content += `${marker}的第${beat}个现场细节改变了人物的判断，林舟没有解释情绪，只把证据收好并决定承担下一步后果。`;
    beat += 1;
  }
  return content.slice(0, 680);
}

function makePlan(chapters) {
  return JSON.stringify({ version: 1, phases: ['开端', '追查'], chapters });
}

const initialBlueprintBody = { novelTypeId: 'xianxia', protagonistName: '周行舟',
  targetWordCount: 300000, chapterWordTarget: 5000, outline: '河湾夜班：周行舟在顺河货运核对交接证据并承担代价。' };

test('大纲预览：使用放宽预算、持续续写和进度事件，完整后才返回完成事件', async () => {
  state.aiHandler = async call => {
    assert.equal(call.options.continueUntilComplete, true);
    assert.equal(call.options.stitchOnTruncation, true);
    assert.ok(call.maxTokens > 48000);
    call.options.onStitch(9);
    call.onChunk('完整的大纲与终局');
    return { content: '完整的大纲与终局', finishReason: 'stop', stitchedRounds: 9,
      usage: { prompt_tokens: 100, completion_tokens: 200 } };
  };
  const { events } = await postSse('/generate-outline', initialBlueprintBody);
  assert.ok(events.some(event => event.type === 'status' && /第 9 轮/.test(event.message)));
  const done = events.find(event => event.type === 'completed');
  assert.equal(done.outline, '完整的大纲与终局');
  assert.equal(done.tokenUsage.outputTokens, 200);
  assert.ok(!events.some(event => event.type === 'error'));
});

test('大纲预览：接续未完成时保留片段和用量，不能把截断结果标为成功', async () => {
  state.aiHandler = async call => {
    call.onChunk('截断的半句话');
    return { content: '截断的半句话', finishReason: 'length', stitchedRounds: 2,
      usage: { prompt_tokens: 100, completion_tokens: 200 } };
  };
  const { events } = await postSse('/generate-outline', initialBlueprintBody);
  assert.ok(events.some(event => event.type === 'content' && event.content === '截断的半句话'));
  assert.ok(!events.some(event => event.type === 'completed'));
  const error = events.find(event => event.type === 'error');
  assert.equal(error.code, 'OUTLINE_INCOMPLETE');
  assert.equal(error.tokenUsage.outputTokens, 200);
  assert.match(error.message, /尚未完整生成/);
});

test('大纲预览：总截止时间会中止生成并明确提示，不返回完成事件', async () => {
  const { TIMEOUT } = require('../config/timeouts');
  const previous = TIMEOUT.OUTLINE;
  TIMEOUT.OUTLINE = 25;
  try {
    state.aiHandler = call => new Promise((resolve, reject) => {
      call.onChunk('尚未完成的内容');
      call.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const { events } = await postSse('/generate-outline', initialBlueprintBody);
    assert.ok(!events.some(event => event.type === 'completed'));
    assert.match(events.find(event => event.type === 'error').message, /总生成时间上限/);
    assert.equal(state.aiCalls.length, 1);
  } finally { TIMEOUT.OUTLINE = previous; }
});

const blueprintPart = require('./fixtures/blueprintPart');

test('开始生成：旧预览提交的稀疏蓝图有真实剧情但缺少可选数组时仍保留剧情并通过校验', async () => {
  const blueprint = require('./fixtures/initialBlueprint')();
  for (const phase of blueprint.phases) {
    for (const stage of [phase, ...phase.subphases]) {
      stage.goal = '周行舟在核对签收记录时发现日期与车辆出入记录不符，他选择暂停放货并公开原始账目，承担回款延误的代价，让同事重新判断他的立场。';
      for (const field of ['characterBeats', 'requiredScenes', 'forbiddenDrift', 'foreshadowing', 'unresolvedQuestions']) stage[field] = [];
    }
  }
  state.aiHandler = () => { throw new Error('isolated stop after creation'); };
  const result = await postSse('/generate', { ...initialBlueprintBody, mode: 'book', storyBlueprint: blueprint, enableResearch: false });
  assert.equal(result.response.status, 200, result.raw);
  const created = result.events.find(event => event.type === 'novel_created');
  assert.ok(created, result.raw);
  const novel = state.novels.get(created.novelId);
  assert.ok(novel.storyBlueprint.phases[0].planText.includes('公开原始账目'));
  assert.equal(novel.storyBlueprint.phases[0].characterBeats.length, 0, '不伪造人物推进以凑字段');
});

test('开始生成：文本蓝图经过预览、确认、序列化提交后仍能创建作品并保存已编辑剧情', async () => {
  const fixture = require('./fixtures/initialBlueprint')();
  const prosePart = require('./fixtures/blueprintProsePart');
  state.aiHandler = call => emitText(prosePart(call.options.blueprintPart, fixture), call.onChunk, call.signal);
  const preview = await postSse('/generate-blueprint', initialBlueprintBody);
  const blueprint = preview.events.find(event => event.type === 'completed')?.blueprint;
  assert.ok(blueprint, preview.raw);
  const { pathToFileURL } = require('node:url');
  const { formatBlueprintText, parseBlueprintText } = await import(pathToFileURL(path.join(serverRoot, '../client/src/utils/blueprintText.js')).href);
  const text = formatBlueprintText(blueprint);
  const confirmed = parseBlueprintText(text.replace('重新核对现场证据', '当众封存并核对原始证据'), blueprint);
  state.aiHandler = () => { throw new Error('isolated stop after creation'); };
  const started = await postSse('/generate', { ...initialBlueprintBody, mode: 'book', storyBlueprint: confirmed, enableResearch: false });
  assert.equal(started.response.status, 200, started.raw);
  const created = started.events.find(event => event.type === 'novel_created');
  assert.ok(created, started.raw);
  const saved = state.novels.get(created.novelId);
  assert.ok(saved.storyBlueprint.phases[0].planText.includes('当众封存并核对原始证据'));
  assert.equal(saved.storyBlueprint.phases[0].characterBeats.length, 0);
});

test('开始生成：所有剧情字段都是暂无时仍拒绝创建，不能用跳过校验掩盖空蓝图', async () => {
  const blueprint = require('./fixtures/initialBlueprint')();
  for (const phase of blueprint.phases) for (const stage of [phase, ...phase.subphases]) {
    for (const field of ['goal', 'obstacle', 'reversal', 'entryCondition', 'exitCondition']) stage[field] = '暂无';
    for (const field of ['characterBeats', 'requiredScenes', 'forbiddenDrift', 'foreshadowing', 'unresolvedQuestions']) stage[field] = [];
  }
  const result = await postSse('/generate', { ...initialBlueprintBody, mode: 'book', storyBlueprint: blueprint, enableResearch: false });
  assert.equal(result.response.status, 400);
  assert.match(result.raw, /没有具体剧情规划/);
  assert.equal(state.novels.size, 0);
  assert.equal(state.aiCalls.length, 0);
});

test('初始蓝图：默认请求分段文本，63章无需英文键名或小阶段仍能完整生成', async () => {
  const blueprint = require('./fixtures/initialBlueprint')();
  blueprint.phases.at(-1).endChapter = 63;
  blueprint.phases.at(-1).subphases.at(-1).endChapter = 63;
  const prosePart = require('./fixtures/blueprintProsePart');
  state.aiHandler = call => {
    assert.equal(call.options.outputFormat, 'text');
    assert.equal(call.options.jsonMode, undefined);
    assert.match(call.systemPrompt, /不输出JSON/);
    return emitText(prosePart(call.options.blueprintPart, blueprint), call.onChunk, call.signal);
  };
  const outline = `${initialBlueprintBody.outline}\n\n【伏笔与回收表】\n伏笔1：票背双孔\n埋设章：第3章（收票时发现双孔）。\n真实含义：每个孔对应一次更改。\n回收章：第18章（查到打孔工具），第60章（公开更改记录）。`;
  const { events } = await postSse('/generate-blueprint', { ...initialBlueprintBody, targetWordCount: 315000, outline });
  const done = events.find(event => event.type === 'completed');
  assert.ok(done, events.find(event => event.type === 'error')?.message);
  assert.equal(done.validation.valid, true);
  assert.equal(done.blueprint.phases.length, 10);
  assert.equal(done.blueprint.phases.at(-1).endChapter, 63);
  assert.equal(done.blueprint.rollingPlan.chapters.length, 20);
  assert.ok(done.blueprint.phases[2].planText.includes('重新核对现场证据'));
  assert.equal(done.blueprint.outlineForeshadowingImported, true);
  const [hook] = done.blueprint.phases[0].foreshadowing;
  assert.equal(hook.name, '票背双孔');
  assert.equal(hook.setupChapter, 3);
  assert.deepEqual(hook.progressChapters, [18]);
  assert.equal(hook.payoffChapter, 60);
  assert.equal(done.tokenUsage.calls, 3);
  assert.equal(state.novels.size, 0);
});

test('初始蓝图：按3块生成并组装所有层级，通过最终校验', async () => {
  const blueprint = require('./fixtures/initialBlueprint')();
  state.aiHandler = call => emitText(JSON.stringify({ data: blueprintPart(call.options.blueprintPart, blueprint) }), call.onChunk, call.signal);
  const { events } = await postSse('/generate-blueprint', initialBlueprintBody);
  const done = events.find(event => event.type === 'completed');
  assert.ok(done, events.find(event => event.type === 'error')?.message);
  assert.equal(done.blueprint.phases.length, 10);
  assert.equal(done.blueprint.rollingPlan.chapters.length, 20);
  assert.equal(done.validation.valid, true);
  assert.equal(done.tokenUsage.calls, 3);
  assert.equal(events.filter(event => event.type === 'token_usage').length, 3);
  assert.equal(state.aiCalls.length, 3);
  assert.ok(state.aiCalls.every(call => call.options.stitchOnTruncation === true && call.options.outputFormat === 'text' && !call.options.jsonMode));
  assert.equal(state.aiCalls[0].maxTokens, 16000, '概览块预算');
  assert.equal(state.aiCalls[1].maxTokens, 32000, '篇章块预算');
  assert.equal(state.aiCalls[2].maxTokens, 24000, '执行卡块预算');
  assert.ok(events.some(event => event.type === 'status' && /3\/3/.test(event.message)));
  assert.equal(state.novels.size, 0, 'blueprint preview must not create prose or a book');
});

test('初始蓝图：63章概览缺事实且只有1个篇章时分项补齐，全链路计费和校验正确', async () => {
  const blueprint = require('./fixtures/initialBlueprint')();
  const ranges = [[1, 6], [7, 12], [13, 18], [19, 25], [26, 31], [32, 37], [38, 44], [45, 50], [51, 56], [57, 63]];
  blueprint.phases.forEach((phase, i) => {
    const [start, end] = ranges[i];
    Object.assign(phase, { startChapter: start, endChapter: end });
    const middle = Math.floor((start + end) / 2);
    Object.assign(phase.subphases[0], { startChapter: start, endChapter: middle });
    Object.assign(phase.subphases[1], { startChapter: middle + 1, endChapter: end });
  });
  state.aiHandler = call => {
    const name = call.options.blueprintPart;
    let payload = structuredClone(blueprintPart(name, blueprint));
    if (name === '全书概览') { payload.lockedFacts = { malformed: '事实' }; payload.phases = payload.phases.slice(0, 1); }
    return emitText(JSON.stringify(payload), call.onChunk, call.signal);
  };
  const { events } = await postSse('/generate-blueprint', { ...initialBlueprintBody, targetWordCount: 315000 });
  const done = events.find(event => event.type === 'completed');
  assert.ok(done, events.find(event => event.type === 'error')?.message);
  assert.equal(done.validation.valid, true);
  assert.equal(done.blueprint.phases.length, 10);
  assert.equal(done.blueprint.phases.at(-1).endChapter, 63);
  assert.deepEqual(done.blueprint.lockedFacts, ['主角：周行舟', ...blueprint.lockedFacts]);
  assert.equal(done.tokenUsage.calls, 14, '2次概览、1次事实、9个缺失概览篇章、细化篇章、执行卡');
  assert.equal(events.filter(event => event.type === 'token_usage').length, 14);
  assert.equal(state.aiCalls.filter(call => call.options.blueprintPart === '概览篇章第1-6章').length, 0);
  assert.ok(events.some(event => event.type === 'status' && /分项补齐事实与篇章/.test(event.message)));
  assert.equal(state.novels.size, 0);
});

test('初始蓝图：篇章数量不符时拆分当前批次，所有请求计入用量', async () => {
  const blueprint = require('./fixtures/initialBlueprint')();
  let calls = 0;
  state.aiHandler = call => emitText(++calls === 2
    ? '{"phases":[]}'
    : JSON.stringify(blueprintPart(call.options.blueprintPart, blueprint)), call.onChunk, call.signal);
  const { events } = await postSse('/generate-blueprint', initialBlueprintBody);
  const done = events.find(event => event.type === 'completed');
  assert.ok(done, events.find(event => event.type === 'error')?.message);
  assert.equal(calls, 5);
  assert.equal(done.tokenUsage.calls, 5);
  assert.equal(state.aiCalls[2].options.taskType, 'blueprint_initial');
  assert.equal(state.aiCalls[2].options.blueprintPart, '篇章第1-30章');
  assert.equal(state.aiCalls[3].options.blueprintPart, '篇章第31-60章');
  assert.match(state.aiCalls[2].userPrompt, /周行舟/);
  assert.ok(events.some(event => event.type === 'status' && /数量不符.*拆分补齐/.test(event.message)));
});

test('初始蓝图：63章要求10个篇章但每次只返回1个时自动补齐，通过最终校验', async () => {
  const blueprint = require('./fixtures/initialBlueprint')();
  blueprint.phases.at(-1).endChapter = 63;
  blueprint.phases.at(-1).subphases.at(-1).endChapter = 63;
  state.aiHandler = call => {
    const payload = structuredClone(blueprintPart(call.options.blueprintPart, blueprint));
    if (call.options.blueprintPart.startsWith('篇章')) payload.phases = [payload.phases[0]];
    return emitText(JSON.stringify(payload), call.onChunk, call.signal);
  };
  const { events } = await postSse('/generate-blueprint', { ...initialBlueprintBody, targetWordCount: 315000 });
  const done = events.find(event => event.type === 'completed');
  assert.ok(done, events.find(event => event.type === 'error')?.message);
  assert.equal(done.validation.valid, true);
  assert.equal(done.blueprint.phases.length, 10);
  assert.equal(done.blueprint.phases.at(-1).endChapter, 63);
  assert.equal(done.tokenUsage.calls, 12);
  assert.equal(events.filter(event => event.type === 'token_usage').length, 12);
  const phaseCalls = state.aiCalls.filter(call => call.options.blueprintPart.startsWith('篇章'));
  assert.equal(phaseCalls.length, 10);
  assert.equal(phaseCalls[0].options.blueprintPart, '篇章第1-63章');
  assert.equal(phaseCalls[1].options.blueprintPart, '篇章第7-63章');
  assert.ok(events.some(event => event.type === 'status' && /保留1个已校验篇章/.test(event.message)));
  assert.equal(state.novels.size, 0);
});

test('初始蓝图：小阶段漏掉伏笔和未决问题时仅请求字段补齐，重新校验后完成', async () => {
  const blueprint = require('./fixtures/initialBlueprint')();
  state.aiHandler = call => {
    const name = call.options.blueprintPart;
    let payload = structuredClone(blueprintPart(name, blueprint));
    if (name.startsWith('篇章')) {
      if (call.options.taskType === 'blueprint_repair') {
        assert.match(call.userPrompt, /仅补齐缺失字段/);
        payload = { repairs: blueprint.phases.flatMap(phase => phase.subphases.map(stage => ({
          phaseStartChapter: phase.startChapter, subphaseStartChapter: stage.startChapter,
          foreshadowing: stage.foreshadowing, unresolvedQuestions: stage.unresolvedQuestions,
        }))) };
      } else payload.phases.forEach(phase => phase.subphases.forEach(stage => {
        delete stage.foreshadowing; delete stage.unresolvedQuestions;
      }));
    }
    return emitText(JSON.stringify(payload), call.onChunk, call.signal);
  };
  const { events } = await postSse('/generate-blueprint', initialBlueprintBody);
  const done = events.find(event => event.type === 'completed');
  assert.ok(done, events.find(event => event.type === 'error')?.message);
  assert.equal(done.validation.valid, true);
  assert.equal(done.tokenUsage.calls, 4);
  assert.equal(events.filter(event => event.type === 'token_usage').length, 4);
  assert.ok(events.some(event => event.type === 'status' && /仅补齐缺失字段/.test(event.message)));
  assert.equal(done.blueprint.phases[0].title, blueprint.phases[0].title);
  assert.equal(done.blueprint.phases[0].subphases[0].foreshadowing[0].name,
    blueprint.phases[0].subphases[0].foreshadowing[0].name);
  assert.equal(state.novels.size, 0);
});

test('初始蓝图：未分类的上游错误会带出错误类型与分块，不再只给兜底文案', async () => {
  state.aiHandler = () => {
    const failure = new Error('fetch failed');
    failure.name = 'TypeError';
    throw failure;
  };
  const { events } = await postSse('/generate-blueprint', initialBlueprintBody);
  const error = events.find(event => event.type === 'error');
  assert.equal(error.code, 'BLUEPRINT_FAILED');
  assert.equal(error.diagnostics.part, '全书概览');
  assert.equal(error.diagnostics.reason, 'upstream_error');
  assert.match(error.message, /分块“全书概览”调用失败（TypeError）：fetch failed/);
  assert.ok(error.errorId);
});

test('初始蓝图：概览分项补齐仍失败则返回具体分项、编号和完整用量，不补造事实', async () => {
  state.aiHandler = call => emitText('{"mainArc":"河湾夜班","phases":[{}]}', call.onChunk, call.signal);
  const { events } = await postSse('/generate-blueprint', initialBlueprintBody);
  const error = events.find(event => event.type === 'error');
  assert.equal(error.code, 'BLUEPRINT_PART_INVALID');
  assert.equal(error.diagnostics.part, '概览事实');
  assert.equal(error.diagnostics.reason, 'missing_field');
  assert.match(error.message, /概览事实/);
  assert.ok(error.errorId);
  assert.equal(error.tokenUsage.calls, 4);
  assert.equal(state.aiCalls.length, 4);
  assert.equal(events.some(event => event.type === 'completed'), false);
  assert.equal(state.novels.size, 0);
});

test('初始蓝图：分块仍持续截断时最多修复一次，不无限重跑', async () => {
  state.aiHandler = async call => ({ ...await emitText('{"mainArc":"河湾夜班","phases":[', call.onChunk, call.signal),
    finishReason: 'length' });
  const { events } = await postSse('/generate-blueprint', initialBlueprintBody);
  const error = events.find(event => event.type === 'error');
  assert.equal(error.diagnostics.reason, 'output_truncated');
  assert.match(error.message, /输出达到上限/);
  assert.equal(error.diagnostics.finishReason, 'length');
  assert.equal(error.code, 'BLUEPRINT_PART_INVALID');
  assert.equal(error.tokenUsage.calls, 2);
  assert.equal(state.aiCalls.length, 2);
  // 截断优先走一次结构续写（mock 层不实现续写，但选项必须开启），
  // 续写后仍无效才重试整块，最多一次。
  assert.ok(state.aiCalls.every(call => call.options.stitchOnTruncation === true));
});

test('初始蓝图：上游中途失败时仍保留成功分块及失败请求的用量，不创建作品', async () => {
  const blueprint = require('./fixtures/initialBlueprint')();
  state.aiHandler = call => {
    if (state.aiCalls.length === 2) {
      const error = new Error('upstream unavailable');
      error.usage = { prompt_tokens: 13, completion_tokens: 7 };
      throw error;
    }
    return emitText(JSON.stringify(blueprintPart(call.options.blueprintPart, blueprint)), call.onChunk, call.signal);
  };
  const { events } = await postSse('/generate-blueprint', initialBlueprintBody);
  const recorded = events.find(event => event.type === 'token_usage').usage;
  const error = events.find(event => event.type === 'error');
  assert.ok(error.errorId);
  assert.equal(error.diagnostics.part, '篇章第1-60章');
  assert.equal(error.diagnostics.reason, 'upstream_error');
  assert.equal(error.tokenUsage.calls, 2);
  assert.equal(error.tokenUsage.inputTokens, recorded.inputTokens + 13);
  assert.equal(error.tokenUsage.outputTokens, recorded.outputTokens + 7);
  assert.equal(state.aiCalls.length, 2);
  assert.equal(state.novels.size, 0);
  assert.equal(events.some(event => event.type === 'completed'), false);
});

test('初始蓝图：总时间预算到期中止当前分块并返回明确超时，不继续计费请求', async () => {
  const { TIMEOUT } = require('../config/timeouts');
  const previous = TIMEOUT.BLUEPRINT;
  TIMEOUT.BLUEPRINT = 30;
  state.aiHandler = call => new Promise((_resolve, reject) => {
    const fail = () => reject(abortError());
    if (call.signal.aborted) fail();
    else call.signal.addEventListener('abort', fail, { once: true });
  });
  try {
    const { events } = await postSse('/generate-blueprint', initialBlueprintBody);
    const error = events.find(event => event.type === 'error');
    assert.equal(error.code, 'BLUEPRINT_TIMEOUT');
    assert.match(error.message, /时间超过上限/);
    assert.ok(error.errorId);
    assert.equal(state.aiCalls.length, 1);
    assert.equal(state.novels.size, 0);
  } finally { TIMEOUT.BLUEPRINT = previous; }
});

test('初始蓝图：真实HTTP流续写后仍截断则拆分篇章批次，接受无换行尾帧', async () => {
  const http = require('node:http');
  const blueprint = require('./fixtures/initialBlueprint')();
  let currentCall;
  const requestFormats = [];
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const request = JSON.parse(body);
      requestFormats.push(request.response_format);
      const { blueprintPart: name } = currentCall.options;
      const part = blueprintPart(name, blueprint);
      const truncated = name === '篇章第1-60章';
      const continuation = request.messages.at(-1).content.includes('长度限制被截断');
      const content = continuation ? ' ' : truncated ? JSON.stringify(part).slice(0, -1) : JSON.stringify(part);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, -1) } }] })}\n\n`);
      res.end(`data:${JSON.stringify({ choices: [{ delta: { content: content.slice(-1) }, finish_reason: truncated ? 'length' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 200 } })}`);
    });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  try {
    state.aiHandler = call => {
      currentCall = call;
      return realAiService.streamGenerate(call.systemPrompt, call.userPrompt, call.onChunk, call.signal,
      { baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'blueprint-test', disableThinking: true },
      0, call.temperature, call.maxTokens, 10000, call.onReasoning, call.options);
    };
    const { events } = await postSse('/generate-blueprint', initialBlueprintBody);
    const done = events.find(event => event.type === 'completed');
    assert.ok(done, events.find(event => event.type === 'error')?.message);
    assert.equal(done.validation.valid, true);
    assert.equal(done.blueprint.phases[0].title, blueprint.phases[0].title);
    assert.equal(done.tokenUsage.outputTokens, 1400, '截断后续写请求的用量也要计入');
    assert.equal(requestFormats.length, 7);
    assert.ok(requestFormats.every(format => format === undefined));
    assert.deepEqual(state.aiCalls.map(call => call.options.blueprintPart), [
      '全书概览', '篇章第1-60章', '篇章第1-30章', '篇章第31-60章', '执行卡第1-20章',
    ]);
    assert.ok(events.some(event => event.type === 'status' && /2\/3.*拆成两批/.test(event.message)));
  } finally { await new Promise(resolve => upstream.close(resolve)); }
});

async function seedNovel(data) {
  const chapters = clone(data.chapters || []);
  const novel = new InMemoryNovel({
    ...data,
    chapters,
    currentWordCount: data.currentWordCount ?? chapters.reduce((sum, chapter) => sum + Number(chapter.wordCount || 0), 0),
    currentChapterIndex: data.currentChapterIndex ?? chapters.reduce((max, chapter) => Math.max(max, Number(chapter.chapterNumber || 0)), 0),
  });
  await novel.save();
  return novel;
}

function parseSse(raw) {
  const events = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    events.push(JSON.parse(line.slice(5).trim()));
  }
  return events;
}

async function postSse(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer isolated' },
    body: JSON.stringify(body || {}),
  });
  const raw = await response.text();
  return { response, raw, events: parseSse(raw) };
}

function eventIndex(events, type, predicate = () => true) {
  return events.findIndex((event) => event.type === type && predicate(event));
}

test('streaming de-AI rewrite reviews against the original, preserves persona and rejects length drift', async () => {
  state.useRealPersonaPrompt = true;
  const persona = { name: '温暖的叙述者', voice: '允许善意插话，保留书面表达', rules: '事实与人物选择不能改动' };
  const novel = await seedNovel({ status: 'paused', writingPersonaSnapshot: persona });
  const original = '原文：她没有拆开信封，只把它放回了抽屉。'.repeat(8);
  const first = '初稿：她没有拆开信封，只把它放回了抽屉。'.repeat(8);
  state.aiHandler = async call => {
    const result = state.aiCalls.length === 1 ? first : '过短的终稿';
    call.onChunk?.(result);
    return { content: result };
  };
  const result = await postSse('/deslop-stream', { novelId: novel._id, text: original });
  assert.equal(result.response.status, 200);
  assert.equal(state.aiCalls.length, 2);
  assert.equal(state.aiCalls[0].temperature, 0.72);
  assert.equal(state.aiCalls[1].temperature, 0.55);
  assert.ok(state.aiCalls[1].userPrompt.includes(original));
  assert.ok(state.aiCalls[1].userPrompt.includes(first));
  assert.match(state.aiCalls[1].userPrompt, /允许善意插话/);
  assert.doesNotMatch(state.aiCalls[1].userPrompt, /随机插入角色的走神或吐槽|把所有书面化的词换成口语/);
  assert.equal(result.events.find(event => event.type === 'completed').content, first);
  assert.equal(state.novels.get(novel._id).chapters.length, 0, 'preview must not modify the saved work');
});

test('streaming rewrite keeps the original without a second call when the first candidate is truncated', async () => {
  const original = '她没有拆开信封，只把它放回了抽屉。'.repeat(8);
  state.aiHandler = async call => { call.onChunk?.('截断'); return { content: '截断' }; };
  const result = await postSse('/deslop-stream', { text: original });
  assert.equal(result.response.status, 200);
  assert.equal(state.aiCalls.length, 1);
  assert.equal(result.events.find(event => event.type === 'completed').content, original);
});

test('generation stores the original controls and recovers a request even without receiving novel_created', async () => {
  state.chapterQueue = [makeChapter('林舟找到旧信', '初始快照测试')];
  const input = { clientRequestId: 'recovery-request-123456', novelTypeId: 'xianxia', gender: 'female', mode: 'chapter',
    protagonistName: '林舟', worldSetting: '雪后的旧城', targetWordCount: 2000, outline: '最初填写的大纲', expertMode: false, enableResearch: false, researchLinks: ['https://example.test/source'] };
  const result = await postSse('/generate', input);
  const novel = getCreatedNovel(result.events);
  const request = await fetch(`${baseUrl}/generation-request/${input.clientRequestId}`);
  assert.equal((await request.json()).novelId, novel._id);
  novel.outline = '后来生成或修改的大纲';
  const response = await fetch(`${baseUrl}/${novel._id}/generation-input`);
  const restored = await response.json();
  assert.equal(restored.exact, true); assert.equal(restored.input.outline, input.outline);
  assert.equal(restored.input.enableResearch, false); assert.equal(restored.input.gender, 'female');
  assert.deepEqual(restored.input.researchLinks, input.researchLinks);
  const repeated = await postSse('/generate', input);
  assert.equal(repeated.response.status, 409);
  assert.equal(state.novels.size, 1, 'retrying the same creation request must not create another book');
});

test('non-streaming rewrite also keeps the original when the model returns an incomplete candidate', async () => {
  const original = '她没有拆开信封，只把它放回了抽屉。'.repeat(8);
  state.aiHandler = async () => ({ content: '截断' });
  const response = await fetch(`${baseUrl}/deslop`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer isolated' },
    body: JSON.stringify({ text: original }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).processed, original);
  assert.equal(state.aiCalls.length, 1);
});

test('polish rejects an incomplete second pass and preserves its accepted first pass', async () => {
  const original = '她没有拆开信封，只把它放回了抽屉。'.repeat(15);
  const accepted = original.replace('她没有拆开', '她仍未拆开');
  const novel = await seedNovel({ status: 'paused', styleRevisionSnapshot: { preferences: [{ statement: '修订时保留人物对白原有的留白与试探。' }] } });
  state.aiHandler = async call => {
    const content = state.aiCalls.length === 1 ? accepted : '不完整的去AI味稿';
    call.onChunk?.(content);
    return { content };
  };
  const result = await postSse('/polish', { novelId: novel._id, text: original, doDeslop: true });
  assert.equal(state.aiCalls.length, 2);
  assert.match(state.aiCalls[1].systemPrompt, /保留人物对白原有的留白/);
  assert.equal(result.events.find(event => event.type === 'final_content').content, accepted);
});

function getCreatedNovel(events) {
  const created = events.find((event) => event.type === 'novel_created');
  assert.ok(created, '缺少 novel_created 事件');
  const novel = state.novels.get(String(created.novelId));
  assert.ok(novel, '内存数据库中缺少新建小说');
  return novel;
}

test('创建失败：首次保存失败返回阶段和编号，不调用模型', async () => {
  state.saveFailureAt = 1;
  const response = await fetch(`${baseUrl}/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ novelTypeId: 'xianxia', mode: 'chapter' }),
  });
  const error = await response.json();
  assert.equal(response.status, 500);
  assert.equal(error.phase, 'saving_novel');
  assert.match(error.message, /保存新作品失败/);
  assert.ok(error.message.includes(error.errorId));
  assert.equal(state.novels.size, 0);
  assert.equal(state.aiCalls.length, 0);
});

test('创建失败：任务初始化失败后作品暂停，可以重新续写', async () => {
  state.jobError = new Error('isolated job failure');
  const response = await fetch(`${baseUrl}/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ novelTypeId: 'xianxia', mode: 'chapter' }),
  });
  const error = await response.json();
  assert.equal(error.phase, 'starting_job');
  const novel = [...state.novels.values()][0];
  assert.equal(novel.status, 'paused');
  state.jobError = null;
  state.chapterQueue = [makeChapter('林舟进入邮局找到旧案线索', '恢复创建')];
  const resumed = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.equal(resumed.response.status, 200);
  assert.ok(resumed.events.some((event) => event.type === 'chapter_end'));
});

test('创建失败：SSE 建立后保存大纲失败也会暂停作品并返回阶段', async () => {
  state.saveFailureAt = 2;
  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia', mode: 'book', outline: '已确认的测试大纲', enableResearch: false,
  });
  assert.equal(response.status, 200);
  const error = events.find((event) => event.type === 'error');
  assert.equal(error.phase, 'outline');
  assert.ok(error.message.includes(error.errorId));
  assert.equal(getCreatedNovel(events).status, 'paused');
  assert.equal([...state.jobs.values()][0].status, 'failed');
  assert.equal(state.aiCalls.length, 0);
});

test('180万字、每章8000字及联网取材、专家团可完成创建并进入正文', async () => {
  state.aiHandler = async (call) => {
    if (call.kind === 'chapter') throw abortError(); // Stop before producing a whole book.
    if (call.kind === 'plan' && call.userPrompt.includes('细化未来第1-8章')) {
      return emitText(makePlan(Array.from({ length: 8 }, (_, index) => ({ chapterNumber: index + 1,
        title: `线索${index + 1}`, coreEvent: `林舟找到编号${index + 1}的值班记录并确认相关证人所在位置。` }))), null, call.signal);
    }
    return defaultAiHandler(call);
  };
  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia', outline: '主角追查旧案，在危机中揭开真相。',
    mode: 'book', targetWordCount: 1800000, chapterWordTarget: 8000,
    expertMode: true, enableResearch: true,
    researchLinks: ['https://www.wenku8.net/novel/0/7/index.htm'],
  });
  assert.equal(response.status, 200);
  assert.ok(events.some((event) => event.type === 'research_status'));
  assert.ok(events.some((event) => event.type === 'chapter_start'));
  assert.ok(events.some((event) => event.type === 'paused'));
  assert.equal(events.some((event) => event.type === 'error'), false);
  const novel = getCreatedNovel(events);
  assert.equal(novel.chapterWordTarget, 8000);
  assert.equal(novel.targetWordCount, 1800000);
  assert.equal(novel.expertMode, true);
  assert.equal(novel.chapterPlanData.chapters.length, 225);
});

test('新书单章：SSE、正文、质量状态和创作状态完整落库', async () => {
  const content = makeChapter('林舟决定在雨停前进入旧邮局寻找失踪证人的登记簿', '雨夜邮局');
  state.chapterQueue = [content];
  let chapterFormatting;
  state.postProcessChapter = (text, options) => {
    chapterFormatting = options;
    return text;
  };

  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia',
    protagonistName: '林舟',
    worldSetting: '阴雨旧城中的沉重悬疑故事',
    targetWordCount: 3000,
    mode: 'chapter',
  });

  assert.equal(response.status, 200);
  assert.ok(eventIndex(events, 'novel_created') < eventIndex(events, 'chapter_start'));
  assert.ok(eventIndex(events, 'chapter_start') < eventIndex(events, 'chapter_end'));
  assert.ok(eventIndex(events, 'chapter_end') < eventIndex(events, 'completed'));
  assert.equal(events.filter((event) => event.type === 'content').map((event) => event.content).join(''), content);

  const novel = getCreatedNovel(events);
  assert.equal(novel.status, 'completed');
  assert.deepEqual(novel.chapters.map((chapter) => chapter.chapterNumber), [1]);
  assert.equal(novel.currentWordCount, content.length);
  assert.equal(novel.currentChapterIndex, 1);
  assert.match(novel.chapters[0].title, /^第1章\s+/);
  assert.notEqual(novel.chapters[0].title, '第1章');
  // Without a plan title, the start event has only the chapter number; the
  // finished event supplies the title derived from the actual prose.
  assert.equal(events.find((event) => event.type === 'chapter_start').title, '第1章');
  assert.equal(events.find((event) => event.type === 'chapter_end').title, novel.chapters[0].title);
  assert.equal(typeof novel.chapters[0].qualityReport.score, 'number');
  assert.deepEqual(novel.chapters[0].qualityReport.toolchain, { isolated: true });
  assert.equal(chapterFormatting.doDeAI, false);
  assert.equal(novel.emotionCurve.length, 1);
  assert.equal(novel.recentEventSignatures.length, 1);
  assert.match(novel.chapterSummaryDoc, /第1章/);
  assert.ok(state.aiCalls[0].temperature >= 0.72 && state.aiCalls[0].temperature <= 0.86);
  assert.equal(state.aiCalls[0].temperature, Number(state.aiCalls[0].temperature.toFixed(2)));
});

test('专家团模式：正文后调用推理审稿，审稿失败时保留原稿并正常完成', async () => {
  const content = makeChapter('林舟在雨夜进入旧邮局，发现登记簿上的名字与失踪证人的线索相连', '专家团测试');
  state.chapterQueue = [content];

  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia',
    protagonistName: '林舟',
    worldSetting: '悬疑故事',
    targetWordCount: 3000,
    mode: 'chapter',
    expertMode: true,
  });

  assert.equal(response.status, 200);
  // hookAudit 是每章后的伏笔自评小调用，不属于本断言关心的调用面
  const nonAuditCalls = state.aiCalls.filter((call) => call.kind !== 'hookAudit');
  assert.equal(nonAuditCalls.filter((call) => call.onChunk).length, 1);
  assert.equal(nonAuditCalls.filter((call) => !call.onChunk).length, 1);
  assert.match(state.aiCalls.filter((call) => call.kind !== "hookAudit").at(-1).userPrompt, /连续性与叙事质量审稿专家/);
  assert.ok(events.some((event) => event.type === 'status' && event.message.includes('推理专家')));
  const novel = getCreatedNovel(events);
  assert.equal(novel.status, 'completed');
  assert.equal(novel.chapters[0].content, content);
});

test('新书整本：先落结构化计划，再严格按章生成并回收伏笔', async () => {
  const hook = '铜钥匙上的裂纹';
  state.planContent = makePlan([
    {
      chapterNumber: 1,
      wordTarget: 600,
      coreEvent: '林舟在雨夜收到铜钥匙并决定追查失踪证人',
      setHooks: [hook],
      characters: ['林舟', '苏晚'],
      tension: 7,
    },
    {
      chapterNumber: 2,
      wordTarget: 600,
      coreEvent: '林舟用铜钥匙打开地下室暗门并找到证人',
      resolveHooks: [hook],
      characters: ['林舟', '苏晚'],
      tension: 8,
    },
  ]);
  state.chapterQueue = [
    makeChapter(`林舟决定追查失踪证人，并看清${hook}`, '雨夜钥匙'),
    makeChapter(`林舟发现${hook}对应暗门锁孔，终于找到证人`, '地下暗门'),
  ];
  const payoff = `林舟发现${hook}对应暗门锁孔，终于找到证人。`;
  state.aiHandler = call => call.kind === 'hookAudit' && call.userPrompt.includes('这是全书最后一章')
    ? emitText(JSON.stringify({ hooksResolved: [{ id: 'PLAN_1_' + hook, evidence: payoff }] }), null, call.signal)
    : defaultAiHandler(call);

  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia',
    protagonistName: '林舟',
    worldSetting: '阴雨旧城中的沉重悬疑故事',
    targetWordCount: 1200,
    outline: '林舟追查一名失踪证人，并发现旧案与地下室有关。',
    mode: 'book',
  });

  assert.equal(response.status, 200);
  const firstStart = eventIndex(events, 'chapter_start', (event) => event.chapterNumber === 1);
  const firstEnd = eventIndex(events, 'chapter_end', (event) => event.chapterNumber === 1);
  const secondStart = eventIndex(events, 'chapter_start', (event) => event.chapterNumber === 2);
  const secondEnd = eventIndex(events, 'chapter_end', (event) => event.chapterNumber === 2);
  assert.ok(eventIndex(events, 'novel_created') < eventIndex(events, 'status', (event) => event.message.includes('章节计划')));
  assert.ok(firstStart < firstEnd && firstEnd < secondStart && secondStart < secondEnd);
  assert.ok(secondEnd < eventIndex(events, 'completed'));

  const [firstWriting, secondWriting] = state.aiCalls.filter(call => call.kind === 'chapter');
  const futurePlan = firstWriting.userPrompt.match(/【后续章节计划，供衔接参考】\n([^\n]+)/)?.[1];
  assert.match(futurePlan || '', /^第2章.*林舟用铜钥匙打开地下室暗门并找到证人/);
  assert.match(firstWriting.userPrompt, /唯一核心事件：林舟在雨夜收到铜钥匙并决定追查失踪证人/);
  assert.doesNotMatch(secondWriting.userPrompt, /【后续章节计划，供衔接参考】/);
  assert.match(secondWriting.userPrompt, /本章应回收伏笔：铜钥匙上的裂纹/);
  assert.match(firstWriting.userPrompt, /请直接输出本章正文。$/);

  const novel = getCreatedNovel(events);
  assert.equal(novel.status, 'completed');
  assert.deepEqual(novel.chapterPlanData.chapters.map((chapter) => chapter.chapterNumber), [1, 2]);
  assert.deepEqual(novel.chapters.map((chapter) => chapter.chapterNumber), [1, 2]);
  assert.equal(novel.currentChapterIndex, 2);
  assert.equal(novel.foreshadowingLedger.length, 1);
  assert.equal(novel.foreshadowingLedger[0].status, 'resolved');
  assert.equal(novel.foreshadowingLedger[0].resolvedChapter, 2);
  assert.deepEqual(state.aiCalls.filter((call) => call.kind !== 'hookAudit').map((call) => call.kind), ['plan', 'chapter', 'chapter']);
  assert.match(state.aiCalls.filter((call) => call.kind === "chapter")[1].userPrompt, /本章应回收伏笔：铜钥匙上的裂纹/);
});

test('整本生成从开头和结尾移除旧章片段，补写无回收章号的伏笔后才完结', async () => {
  const oldEnding = require('./fixtures/repeatedWorkplaceEnding');
  const hook = '值班簿被撕去的末页';
  const firstQuote = '值班簿被撕去的末页藏在信封夹层';
  const secondQuote = '原件上的印章证明是仓管员更改了交接时间';
  const evidence = `${firstQuote}。${secondQuote}。`;
  const payoff = `“${firstQuote}。”刘海柱把信封递给同事。“${secondQuote}。”`;
  const first = makeChapter('刘海柱发现值班簿少了一页并把空封套收起来', '仓库旧现场') + '\n\n' + oldEnding;
  const newOpening = '值班员刚把货架门锁上，刘海柱就递出那张出入证。为了让证据留在现场，他请两位同事同时签字，随即在监控下拆开信封。';
  const freshEnding = '值班员把签收表钉进公示栏。退赔款已经打进账上，等了三个月的司机把存根折进上衣口袋，推开玻璃门走了出去。'
    + '刘海柱没去送他，留在柜台前把剩下四份收据核对完。最后一笔的汇款日期没有错，签收人和车辆编号也对得上。他将签字笔帽扣紧，打开仓库边门。'
    + '外面的人正把一叠晚班派车单夹在铁板上。刘海柱拿过第一张，照新规矩让司机当面确认。他第一次不用托人捎话，便能和司机一起把货、车、人都填进同一张表。'
    + '那人从帆布包里翻出一只装着热茶的旧保温杯，拧开盖子放在他的手边。货车驶出院子后，两人把桌椅移到灯下，按签收时间把当天的单子一张张码齐。';
  const body = makeChapter('刘海柱查封仓库后核对责任人，最终公布退款名单', '次日对账现场');
  state.planContent = makePlan([
    { chapterNumber: 1, wordTarget: 600, coreEvent: '查到值班簿缺页', setHooks: [hook] },
    { chapterNumber: 2, wordTarget: 600, coreEvent: '核对责任人并公布退款名单' },
  ]);
  state.chapterQueue = [first, oldEnding + '\n\n' + body + '\n\n' + oldEnding];
  let closureAudits = 0;
  state.aiHandler = call => {
    if (call.options?.taskType === 'targeted_repair') {
      return emitText(call.userPrompt.includes('待替换开头') ? newOpening : freshEnding, null, call.signal);
    }
    if (call.options?.taskType === 'ending_hook_repair') {
      assert.ok(call.userPrompt.includes(hook));
      return emitText([newOpening, body, payoff, freshEnding].join('\n\n'), null, call.signal);
    }
    if (call.kind === 'hookAudit' && call.userPrompt.includes('这是全书最后一章')) {
      assert.equal(call.options.jsonMode, true);
      assert.ok(!call.userPrompt.includes('characterUpdates'));
      closureAudits++;
      return emitText(JSON.stringify({ hooksResolved: [{ id: 'PLAN_1_' + hook, evidence }] }), null, call.signal);
    }
    return defaultAiHandler(call);
  };
  const { events } = await postSse('/generate', {
    novelTypeId: 'xianxia', mode: 'book', targetWordCount: 1200, enableResearch: false,
    outline: '刘海柱核对仓库交接账本，追踪责任证据并让受损司机获得退款。',
  });
  const novel = getCreatedNovel(events);
  assert.equal(novel.status, 'completed', events.find(event => event.type === 'error')?.message);
  assert.equal(closureAudits, 2, 'reject invented quote before rewriting, then verify the updated manuscript');
  assert.equal(novel.chapters.length, 2);
  const final = novel.chapters[1];
  assert.ok(!final.content.includes(oldEnding));
  assert.ok(final.content.includes(payoff));
  assert.ok(!final.content.includes(evidence));
  assert.equal(final.qualityReport.openingRepetition.sourceChapter, 1);
  assert.equal(final.qualityReport.endingRepetition.sourceChapter, 1);
  assert.equal(novel.foreshadowingLedger[0].targetChapter, 0);
  assert.equal(novel.foreshadowingLedger[0].resolutionEvidence, `${firstQuote} … ${secondQuote}`);
  assert.equal(novel.foreshadowingLedger[0].status, 'resolved');
  assert.ok(eventIndex(events, 'chapter_end', event => event.chapterNumber === 2) < eventIndex(events, 'completed'));
});

test('整本续写可以为已完结的旧作品补收伏笔，证据未通过时保留草稿和原结局', async () => {
  const content = makeChapter('林舟将原始档案交给法院保管', '手稿已封存');
  const hook = '档案室备用钥匙的去向';
  const payoff = '失踪的档案室备用钥匙一直在证人保管的铁盒底部，林舟亲手将它交回了登记处。';
  const novel = await seedNovel({ status: 'completed', targetWordCount: 600, chapterWordTarget: 2000,
    outline: '林舟查明旧案真相并封存证据',
    chapters: [{ chapterNumber: 1, content, wordCount: content.length }],
    chapterPlanData: { chapters: [{ chapterNumber: 1, wordTarget: 600, coreEvent: '证据交存' }] },
    foreshadowingLedger: [{ id: 'missing-key', content: hook, setChapter: 1, targetChapter: 0, status: 'pending' }],
  });
  const draft = makeChapter('证人打开了铁盒，把里面的东西放到窗边', '封条换新日期');
  state.chapterQueue = [draft];
  state.aiHandler = call => {
    if (call.kind === 'hookAudit') {
      const fragment = '证人打开了铁盒，把里面的东西放到窗边';
      const later = '封条换新日期的第1个现场细节改变了人物的判断';
      return emitText(JSON.stringify({ hooksResolved: [
        { id: 'missing-key', evidence: `${fragment}。备用钥匙在铁盒底部。` },
        { id: 'missing-key', evidence: `${later}。${fragment}。` },
      ] }), null, call.signal);
    }
    if (call.options?.taskType === 'ending_hook_repair') return emitText(draft, null, call.signal);
    return defaultAiHandler(call);
  };
  const failed = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.match(failed.events.find(event => event.type === 'error')?.message || '', /终章尚未核实回收 1 条伏笔/);
  assert.equal(novel.chapters.length, 1);
  assert.equal(novel.status, 'paused');
  assert.equal(novel.foreshadowingLedger[0].status, 'pending');
  assert.equal(novel.chapterPlanData.chapters.length, 2);
  state.aiHandler = call => {
    if (call.options?.taskType === 'ending_hook_repair') return emitText(draft + '\n\n' + payoff, null, call.signal);
    if (call.kind === 'hookAudit') return emitText(JSON.stringify({ hooksResolved: [{ id: 'missing-key', evidence: payoff }] }), null, call.signal);
    return defaultAiHandler(call);
  };
  const resumed = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.ok(resumed.events.some(event => event.type === 'completed'), resumed.raw);
  assert.equal(novel.chapters[0].content, content);
  assert.equal(novel.chapters.length, 2);
  assert.equal(novel.chapterPlanData.chapters.length, 2);
  assert.equal(novel.foreshadowingLedger[0].resolutionEvidence, payoff);
});

test('新书整本：计划为空时暂停，不进入无约束正文循环', async () => {
  state.planContent = '';

  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia',
    protagonistName: '林舟',
    targetWordCount: 6000,
    outline: '一份已有大纲，但章节规划服务返回空内容。',
    mode: 'book',
  });

  assert.equal(response.status, 200);
  assert.ok(eventIndex(events, 'plan_needs_extension') > eventIndex(events, 'novel_created'));
  assert.equal(eventIndex(events, 'chapter_start'), -1);
  assert.equal(eventIndex(events, 'completed'), -1);
  const novel = getCreatedNovel(events);
  assert.equal(novel.status, 'paused');
  assert.equal(novel.chapters.length, 0);
  assert.deepEqual(state.aiCalls.map((call) => call.kind), ['plan']);
});

test('固定章数从创建到完结：补齐遗漏计划卡，拒绝越界卡，目标字数不足也不追加章节', async () => {
  const conclusionEvidence = '法院当庭确认旧案证据系伪造，撤销了对周宁的指控。';
  const settledStateEvidence = '周宁取回钥匙，六年来第一次用自己的名字打开家门。';
  state.planContent = makePlan([
    { chapterNumber: 1, wordTarget: 600, coreEvent: '周宁取回法庭需要的交接记录' },
    { chapterNumber: 3, wordTarget: 600, coreEvent: '越界事件不能进入正文', setHooks: ['越界的暗号'] },
  ]);
  state.chapterQueue = [makeChapter('周宁取回交接记录', '雨停后的档案馆'),
    makeChapter('法官宣布庭审结论', '法院门外的台阶') + '\n' + conclusionEvidence + settledStateEvidence];
  state.aiHandler = call => {
    if (call.kind === 'hookAudit' && call.userPrompt.includes('这是全书最后一章')) {
      return emitText(JSON.stringify({ hooksResolved: [], ending: { conclusionEvidence, settledStateEvidence } }), null, call.signal);
    }
    return defaultAiHandler(call);
  };
  const { events, raw } = await postSse('/generate', {
    novelTypeId: 'xianxia', mode: 'book', targetChapterCount: 2, targetWordCount: 2200,
    enableResearch: false, outline: '周宁调查伪证并证明自己的清白，取回家门钥匙。',
  });
  const novel = getCreatedNovel(events);
  assert.equal(novel.status, 'completed', raw);
  assert.equal(novel.targetChapterCount, 2);
  assert.equal(novel.generationInput.targetChapterCount, 2);
  assert.deepEqual(novel.chapterPlanData.chapters.map(chapter => chapter.chapterNumber), [1, 2]);
  assert.deepEqual(novel.chapters.map(chapter => chapter.chapterNumber), [1, 2]);
  assert.equal(novel.foreshadowingLedger.length, 0);
  assert.ok(novel.currentWordCount < novel.targetWordCount);
  assert.deepEqual(novel.chapters.at(-1).qualityReport.endingVerification, { conclusionEvidence, settledStateEvidence });
});

test('固定章数从第一篇章核验实际进度，拒绝整章替换，单章续写在原段后补写', async () => {
  const firstProof = '周宁从柜员手里接过签有日期的交接记录。';
  const phaseProof = '法官签发保全裁定，禁止销毁这份原始记录。';
  const first = `${firstProof}\n\n${makeChapter('周宁辨认柜员手写签名', '锁着的档案柜')}`;
  const opening = makeChapter('周宁带着记录来到法院', '等候区的长凳');
  const waiting = '庭务员把他请到廊下，说法官还在翻那本记录。';
  const ending = '从法院出来时，墙外的玉兰已经落了一地。周宁弯身拾起自己的伞。';
  const draft = [opening, waiting, ending].join('\n\n');
  const revised = [opening, waiting, phaseProof, ending].join('\n\n');
  const laterHook = '交接记录上的第二个签名来自哪里';
  state.chapterQueue = [first, draft];
  state.planContent = makePlan([
    { chapterNumber: 1, wordTarget: 600, coreEvent: '周宁取回有日期的交接记录', raw: '模型分批细化计划' },
    { chapterNumber: 2, wordTarget: 600, coreEvent: '法院裁定保全原始记录' },
    { chapterNumber: 3, wordTarget: 600, coreEvent: '周宁查找记录签署人' },
    { chapterNumber: 4, wordTarget: 600, coreEvent: '周宁当庭呈交证据' },
  ]);
  let canRepair = false;
  state.aiHandler = call => {
    if (call.options?.taskType === 'chapter_progress_repair') {
      assert.match(call.userPrompt, /要插入的一小段正文/);
      assert.match(call.userPrompt, new RegExp(`${waiting}\\n【修订处之后的正文】`));
      return emitText(canRepair ? phaseProof : revised, null, call.signal);
    }
    if (call.options?.taskType === 'chapter_progress_review') {
      const numberOf = quote => call.userPrompt.split('\n').find(line => /^\[\d+\]/.test(line) && line.includes(quote))?.match(/^\[(\d+)\]/)?.[1];
      if (call.userPrompt.includes('PHASE 篇章目标：')) {
        const earlier = numberOf(firstProof);
        assert.ok(earlier, '阶段审核必须包括本阶段已保存正文');
        const finish = numberOf(phaseProof);
        if (finish) {
          assert.ok(call.userPrompt.includes('【本次修订相邻原文】'));
          return emitText(`PHASE=${earlier},${finish}\nCHAPTER=${finish}`, null, call.signal);
        }
        const anchor = numberOf(waiting);
        assert.ok(anchor);
        return emitText(`PHASE=NONE|法官尚未签发保全裁定|${anchor}\nCHAPTER=NONE|本章停在等待裁定`, null, call.signal);
      }
      assert.match(call.userPrompt, /CHAPTER 本章目标：周宁取回有日期的交接记录/);
      return emitText(`CHAPTER=${numberOf(firstProof)}`, null, call.signal);
    }
    return defaultAiHandler(call);
  };
  const started = await postSse('/generate', {
    novelTypeId: 'xianxia', mode: 'book', targetChapterCount: 4, targetWordCount: 4000, enableResearch: false,
    outline: '周宁取得记录，申请保全证据，再追查记录的共同签署人，最后上庭翻案。',
    storyBlueprint: { blueprintLevel: 2, mainArc: '周宁以交接记录证明清白', phases: [
      { title: '保全证据', startChapter: 1, endChapter: 2, exitCondition: '周宁凭交接记录取得法官签发的保全裁定',
        foreshadowing: [{ name: laterHook, setupChapter: 1, payoffChapter: 4, plan: '庭审时辨明另一个签署人的身份。' }] },
      { title: '翻案', startChapter: 3, endChapter: 4, exitCondition: '法院据此推翻原来的判决' },
    ] },
  });
  const novel = getCreatedNovel(started.events);
  assert.equal(novel.status, 'paused', started.raw);
  assert.match(started.events.find(event => event.type === 'error')?.message || '', /保全证据收尾.*保全裁定.*草稿已保留/);
  assert.deepEqual(novel.chapters.map(chapter => chapter.content), [first]);
  assert.equal(novel.chapters[0].qualityReport.progressVerification.passed, true);
  assert.equal(eventIndex(started.events, 'chapter_start', event => event.chapterNumber === 3), -1);
  const job = [...state.jobs.values()].find(job => job.novelId === novel._id && job.status === 'paused');
  assert.equal(job?.draft, draft);
  assert.equal(job?.draftPhase, 'chapter_progress_review');

  canRepair = true;
  const continued = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.ok(continued.events.some(event => event.type === 'draft_restored' && event.content === draft), continued.raw);
  assert.deepEqual(novel.chapters.map(chapter => chapter.content), [first, revised]);
  assert.deepEqual(novel.chapters[1].qualityReport.progressVerification.evidence.map(item => item.chapterNumber), [1, 2]);
  const hook = novel.foreshadowingLedger.find(hook => hook.content === laterHook);
  assert.equal(hook.targetChapter, 4);
  assert.notEqual(hook.status, 'resolved');
  assert.equal(state.aiCalls.filter(call => call.kind === 'chapter').length, 2);
});

test('第100章验收：分批回收、保留未通过的终章修订，恢复后不重写也不生成第101章', async () => {
  const chapters = Array.from({ length: 98 }, (_, index) => ({ chapterNumber: index + 1, content: `档案工作记录 ${index + 1}。`, wordCount: 190 }));
  const plan = chapters.map(chapter => ({ chapterNumber: chapter.chapterNumber, coreEvent: chapter.content, wordTarget: 600 }));
  plan.push({ chapterNumber: 99, title: '仓库回条', coreEvent: '找到被隐藏的仓库回条', wordTarget: 600 },
    { chapterNumber: 100, title: '旧案公判', coreEvent: '法庭撤销伪证判决并公开补偿安排', wordTarget: 600 },
    { chapterNumber: 101, title: '越界续篇', coreEvent: '无效的超额章节', wordTarget: 600 });
  const novel = await seedNovel({ status: 'paused', targetWordCount: 20400, targetChapterCount: 100, outline: '解决旧案并归还家产。',
    chapters, chapterPlanData: { chapters: plan }, foreshadowingLedger: [
      { id: 'receipt', setChapter: 1, targetChapter: 99, status: 'pending', content: '消失的仓库回条' },
      { id: 'stamp', setChapter: 2, targetChapter: 100, status: 'pending', content: '两枚不同的蓝章' },
    ],
  });
  const receipt = '检验员从墙后的铁柜底找到了被藏起来的原始回条。';
  const stamp = '第二枚蓝章是财务处后来补盖的，与原始登记无关。';
  const conclusionEvidence = '法庭依据原件撤销伪证判决，并要求归还周家的房屋。';
  const settledStateEvidence = '周宁把新门锁的三把钥匙分给母亲、弟弟和自己。';
  const draft = makeChapter('陪审团进入旧法庭', '卷宗送审的走廊');
  const revised = draft + '\n\n' + stamp + conclusionEvidence + settledStateEvidence;
  state.chapterQueue = [makeChapter('众人检查仓库', '厂房西门的封条') + '\n' + receipt, draft];
  const finalReview = { hooksResolved: [{ id: 'stamp', evidence: stamp }], ending: { conclusionEvidence, settledStateEvidence } };
  state.aiHandler = call => {
    if (call.options?.taskType === 'ending_hook_repair') return emitText(revised, null, call.signal);
    if (call.kind === 'hookAudit') {
      if (call.userPrompt.includes('收束阶段的一章')) return emitText(JSON.stringify({ hooksResolved: [{ id: 'receipt', evidence: receipt }] }), null, call.signal);
      if (call.userPrompt.includes('这是全书最后一章')) return emitText(JSON.stringify({ hooksResolved: [], ending: null }), null, call.signal);
    }
    return defaultAiHandler(call);
  };
  const failed = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.equal(novel.status, 'paused', failed.raw);
  assert.equal(novel.chapters.length, 99);
  assert.equal(novel.foreshadowingLedger[0].status, 'resolved');
  assert.equal(novel.foreshadowingLedger[0].resolvedChapter, 99);
  assert.match(failed.events.find(event => event.type === 'error')?.message || '', /主线结局/);
  state.aiHandler = call => {
    assert.equal(call.kind, 'hookAudit', '终章断点应复用修订稿，只调用验收');
    assert.ok(call.userPrompt.includes(settledStateEvidence));
    return emitText(JSON.stringify(finalReview), null, call.signal);
  };
  const resumed = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.equal(novel.status, 'completed', resumed.raw);
  assert.equal(novel.chapters.length, 100);
  assert.equal(novel.chapters.at(-1).content, revised);
  assert.deepEqual(novel.chapters.at(-1).qualityReport.endingVerification, { conclusionEvidence, settledStateEvidence });
  assert.ok(novel.foreshadowingLedger.every(hook => hook.status === 'resolved'));
  assert.equal((await postSse(`/continue/${novel._id}`, { mode: 'book' })).response.status, 400);
  assert.equal((await postSse(`/${novel._id}/continue-chapter/101`, {})).response.status, 409);
  assert.equal((await fetch(`${baseUrl}/${novel._id}/chapter/99`, { method: 'DELETE' })).status, 409);
  assert.equal((await fetch(`${baseUrl}/${novel._id}/chapter/100`, { method: 'DELETE' })).status, 200);
  assert.equal(novel.status, 'paused');
  assert.equal(novel.targetChapterCount, 100);
  assert.equal(novel.chapters.at(-1).chapterNumber, 99);
  assert.equal(novel.foreshadowingLedger.find(hook => hook.id === 'stamp').status, 'pending');
});

test('普通章拒绝把调查进展或道具细节记成回收和新伏笔，正文仍可保存', async () => {
  const hook = { id: 'room-status', content: '林见夏的隔间为什么被标为空置', setChapter: 1, targetChapter: 0, status: 'pending' };
  const falseClue = '屏幕跳出一行：该编号无登记记录。不是';
  const sound = '水管发出一阵细碎的敲击声，像有人碰了两下铁栏。';
  const payoff = '管理员当场确认系统误删了租住登记，档案改回在册并补上了林见夏的名字。';
  const second = makeChapter('林见夏调出旧版租赁文件查证', '户籍终端') + `\n\n${falseClue}空置，也不是在住。\n\n${sound}`;
  const third = makeChapter('管理员核对租约后更正了记录', '街西管理所') + '\n\n' + payoff;
  const novel = await seedNovel({ status: 'paused', targetChapterCount: 4, targetWordCount: 3000,
    outline: '林见夏调查租住登记并拿回被误删的记录。',
    chapters: [{ chapterNumber: 1, content: makeChapter('房东说隔间被标成空置', '旧街门口'), wordCount: 500 }],
    chapterPlanData: { chapters: ['收到空置消息', '检查租约', '更正登记', '收束故事'].map((coreEvent, index) => ({
      chapterNumber: index + 1, coreEvent, wordTarget: 750,
    })) },
    foreshadowingLedger: [hook],
  });
  state.chapterQueue = [second, third];
  state.aiHandler = call => {
    if (call.kind !== 'hookAudit') return defaultAiHandler(call);
    const resolved = call.userPrompt.includes(payoff);
    return emitText(JSON.stringify({ hooksResolved: [{ id: hook.id, evidence: resolved ? payoff : falseClue }],
      hooksSet: resolved ? [] : [{ content: '是否有人在水管附近跟踪林见夏', evidence: sound }] }), null, call.signal);
  };
  let confirmations = 0;
  state.endingHookConfirmHandler = call => {
    assert.equal(call.options?.taskType, 'chapter_hook_audit_confirm');
    confirmations++;
    if (call.userPrompt.includes(payoff)) return emitText('H1=YES', null, call.signal);
    assert.match(call.userPrompt, /不是空置，也不是在住/);
    assert.match(call.userPrompt, /新伏笔：是否有人在水管附近跟踪林见夏/);
    return emitText('H1=NO\nH2=NO', null, call.signal);
  };
  const response = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.ok(response.events.some(event => event.type === 'chapter_end' && event.chapterNumber === 2), response.raw);
  assert.equal(novel.foreshadowingLedger.length, 1);
  assert.equal(novel.foreshadowingLedger[0].status, 'pending');
  const resumed = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.ok(resumed.events.some(event => event.type === 'chapter_end' && event.chapterNumber === 3), resumed.raw);
  assert.equal(novel.foreshadowingLedger[0].resolutionEvidence, payoff);
  assert.ok(novel.foreshadowingLedger[0].resolutionVerificationKey);
  assert.equal(confirmations, 2);
});

test('终章回收修订即使有伏笔答案，也不能撤回已保存的权限交接', async () => {
  const hook = { id: 'ledger-paper', content: '失踪账纸的去向', setChapter: 1, targetChapter: 2, status: 'pending' };
  const first = makeChapter('钟离鹤签署了权限交接文件', '调度室桌面')
    + '\n\n钟离鹤签署了权限交接文件，把盖章的原件交到接任者手里。';
  const conclusionEvidence = '新来的调度员把电车恢复到普通的时刻表。';
  const settledStateEvidence = '孩子们背着书包上了去学校的第一班电车。';
  const draft = makeChapter('人们回到恢复运营的站台', '周一清晨') + '\n\n' + conclusionEvidence + '\n\n' + settledStateEvidence;
  const payoff = '收发员从盖章原件的封套里抽出账纸，把它交还给会计。';
  const valid = draft.replace(conclusionEvidence, payoff + '\n\n' + conclusionEvidence);
  const conflicting = valid.replace(payoff, payoff + '\n\n权限没交。钟离鹤说，还得再等四天。');
  const novel = await seedNovel({ status: 'paused', targetChapterCount: 2, targetWordCount: 1600,
    outline: '查清账纸下落，完成权限交接，恢复电车运营。',
    chapters: [{ chapterNumber: 1, content: first, wordCount: first.length }],
    chapterPlanData: { chapters: [{ chapterNumber: 1, coreEvent: '交接权限', wordTarget: 800 },
      { chapterNumber: 2, coreEvent: '归还账纸后恢复正常运营', wordTarget: 800 }] },
    foreshadowingLedger: [hook],
  });
  let retry = false;
  state.chapterQueue = [draft];
  state.aiHandler = call => {
    if (call.options?.taskType === 'ending_hook_repair') return emitText(retry ? valid : conflicting, null, call.signal);
    if (call.kind === 'hookAudit') return emitText(JSON.stringify({
      hooksResolved: call.userPrompt.includes(payoff) ? [{ id: hook.id, evidence: payoff }] : [],
      ending: { conclusionEvidence, settledStateEvidence },
    }), null, call.signal);
    return defaultAiHandler(call);
  };
  const firstTry = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.match(firstTry.events.find(event => event.type === 'error')?.message || '', /权限没交/);
  const job = [...state.jobs.values()].find(item => item.novelId === novel._id);
  assert.equal(job.draft, draft);
  assert.equal(novel.chapters.length, 1);
  assert.equal(novel.foreshadowingLedger[0].status, 'pending');
  retry = true;
  const resumed = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.ok(resumed.events.some(event => event.type === 'completed'), resumed.raw);
  assert.equal(novel.chapters.at(-1).content, valid);
  assert.equal(novel.foreshadowingLedger[0].resolutionEvidence, payoff);
});

test('跨章回收用早期实际来源解释终章动作，无需让终章复述调查', async () => {
  const hookName = '裴远舟哼错的旋律';
  const outline = ['裴远舟认出旧录音，居民在新站台唱回旧歌。', '【伏笔与回收表】', `伏笔1：${hookName}`,
    '埋设章：第1章（裴远舟唱错）', '真实含义：残留自东段集市被改过的户籍录音',
    '回收章：第2章（确认户籍录音来源），第3章（居民唱和）'].join('\n');
  const origin = '温小满播放东段集市户籍录音，裴远舟听出里面的四句和自己哼的是同一首。';
  const end = '站务员按下普通电车的发车按钮，站台恢复通行。';
  const settled = '居民拿着新登记凭单，坐上了回东段的早班车。';
  const payoff = '裴远舟唱准了最后一句，等车的居民抬头，跟着他把后半段唱完。';
  const draft = makeChapter('站务员带着登记凭单打开站台', '早班车的木门') + '\n\n' + payoff + '\n\n' + end + '\n\n' + settled;
  const novel = await seedNovel({ status: 'paused', targetChapterCount: 3, targetWordCount: 2100, outline,
    chapters: [
      { chapterNumber: 1, content: makeChapter('裴远舟哼歌时唱错了一句', '工厂外'), wordCount: 500 },
      { chapterNumber: 2, content: makeChapter('温小满打开被改过的原始录音', '旧档案间') + '\n\n' + origin, wordCount: 550 },
    ],
    chapterPlanData: { chapters: ['裴远舟哼错歌', '认出录音来源', '恢复电车后居民唱和'].map((coreEvent, index) => ({
      chapterNumber: index + 1, coreEvent, wordTarget: 700,
    })) },
  });
  state.chapterQueue = [draft];
  state.aiHandler = call => {
    if (call.kind !== 'hookAudit') return defaultAiHandler(call);
    const hook = novel.foreshadowingLedger.find(item => item.content === hookName);
    return emitText(JSON.stringify({ hooksResolved: [{ id: hook.id, evidence: payoff }],
      ending: { conclusionEvidence: end, settledStateEvidence: settled } }), null, call.signal);
  };
  let verified = false;
  state.endingHookConfirmHandler = call => {
    assert.ok(call.userPrompt.includes('第2章前置进展原文'));
    assert.ok(call.userPrompt.includes(origin));
    assert.ok(call.userPrompt.includes(`第3章所引原文：${payoff}`));
    verified = true;
    return emitText('H1=YES', null, call.signal);
  };
  const response = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.ok(response.events.some(event => event.type === 'completed'), response.raw);
  assert.equal(verified, true);
  assert.ok(!novel.chapters.at(-1).content.includes(origin));
});

test('终章引用只复述未解问题时，独立复核阻止提交，直到正文写出答案', async () => {
  const hook = { id: 'witness-statement', content: '证人是否当庭指认打开地下暗门的人',
    setChapter: 1, targetChapter: 2, status: 'pending' };
  const first = makeChapter('周宁找到愿意出庭的证人', '地下通道的接头记号');
  const conclusionEvidence = '法庭依照交接记录撤销原判，责令归还周家的房产。';
  const settledStateEvidence = '周宁拿到新钥匙，带母亲走进重新归还的老宅。';
  const unresolved = '书记员翻开记录簿，证人尚未指认是谁打开了地下暗门。';
  const payoff = '证人当庭指认，是保管员沈康亲手打开了地下暗门，书记员将证词录入卷宗。';
  const draft = makeChapter('法官请证人走到证人席', '庭审开始前的木槌') + '\n\n'
    + unresolved + '\n\n' + conclusionEvidence + '\n\n' + settledStateEvidence;
  const revised = draft.replace(unresolved, payoff);
  const novel = await seedNovel({ status: 'paused', targetChapterCount: 2, targetWordCount: 1400,
    outline: '周宁追查地下暗门，找到可以说明责任的证人，让法院归还老宅。',
    chapters: [{ chapterNumber: 1, content: first, wordCount: first.length }],
    chapterPlanData: { chapters: [{ chapterNumber: 1, coreEvent: '找到出庭证人', wordTarget: 700 },
      { chapterNumber: 2, coreEvent: '证人当庭指认，法院撤销原判并归还房产', wordTarget: 700 }] },
    foreshadowingLedger: [hook],
  });
  state.chapterQueue = [draft];
  const calls = [];
  state.endingHookConfirmHandler = call => {
    assert.ok(call.userPrompt.includes(hook.content));
    const hasAnswer = call.userPrompt.includes(payoff);
    assert.ok(call.userPrompt.includes(`所引原文：${hasAnswer ? payoff : unresolved}`));
    calls.push(hasAnswer ? 'accept' : 'reject');
    return emitText(hasAnswer ? 'H1=YES' : 'H1=NO', null, call.signal);
  };
  state.aiHandler = call => {
    if (call.kind === 'hookAudit' && call.userPrompt.includes('这是全书最后一章')) {
      const evidence = call.userPrompt.includes(payoff) ? payoff : unresolved;
      assert.ok(call.userPrompt.includes(evidence), 'the first audit selects an exact quote from the draft');
      calls.push(evidence === payoff ? 'cite-payoff' : 'cite-unresolved');
      return emitText(JSON.stringify({ hooksResolved: [{ id: hook.id, evidence }],
        ending: { conclusionEvidence, settledStateEvidence } }), null, call.signal);
    }
    if (call.options?.taskType === 'ending_hook_repair') {
      assert.equal(novel.chapters.length, 1, 'the unverified terminal draft must not be committed');
      assert.equal(novel.foreshadowingLedger[0].status, 'pending');
      assert.ok(call.userPrompt.includes(hook.content));
      calls.push('repair');
      return emitText(revised, null, call.signal);
    }
    return defaultAiHandler(call);
  };

  const { events, raw } = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.ok(events.some(event => event.type === 'completed'), raw);
  assert.deepEqual(calls, ['cite-unresolved', 'reject', 'repair', 'cite-payoff', 'accept']);
  assert.equal(novel.status, 'completed');
  assert.equal(novel.chapters.length, 2);
  assert.equal(novel.chapters[1].content, revised);
  assert.equal(novel.foreshadowingLedger[0].status, 'resolved');
  assert.equal(novel.foreshadowingLedger[0].resolutionEvidence, payoff);
});

test('收束修订较长的跑题草稿时，以新稿正文证据验收', async () => {
  const hook = { id: 'stamp', content: '伪签名的出处', setChapter: 1, targetChapter: 2, status: 'pending' };
  const guide = '核对证物并交代伪签名从何而来';
  const first = makeChapter('周宁得到未经盖章的档案', '库管办公室');
  const draft = makeChapter('周宁到院子里等待', '后院观察') + '\n'
    + Array.from({ length: 45 }, (_, index) => `周宁等到第${index + 1}次整点报时，仍没有人把证物送到院子里。\n`).join('');
  const payoff = '验印师比较纸上的残缺线条，证明伪签名是从旧借阅登记簿拓下来的。';
  const conclusionEvidence = '法庭依据新鉴定，当天撤销了针对周宁的原判。';
  const settledStateEvidence = '在街坊见证下，周宁将归还的房门钥匙交给父亲。';
  const revised = makeChapter('证物送到了法院书记员手中', '法院门前交接') + '\n' + payoff + conclusionEvidence + settledStateEvidence;
  assert.ok(revised.length < draft.length * 0.8);
  const novel = await seedNovel({ status: 'paused', targetChapterCount: 2, targetWordCount: 1400, chapterWordTarget: 700,
    outline: '周宁找出档案伪证来源，取回房门钥匙。',
    chapters: [{ chapterNumber: 1, content: first, wordCount: first.length }],
    chapterPlanData: { chapters: [{ chapterNumber: 1, coreEvent: '寻找伪证', wordTarget: 700 },
      { chapterNumber: 2, coreEvent: guide, wordTarget: 700 }] },
    foreshadowingLedger: [hook],
  });
  state.chapterQueue = [draft];
  state.aiHandler = call => {
    if (call.options?.taskType === 'ending_hook_repair') {
      assert.ok(call.userPrompt.includes(guide));
      assert.equal(call.options.requireTerminal, true);
      return emitText(revised, null, call.signal);
    }
    if (call.kind === 'hookAudit') {
      const audit = call.userPrompt.includes(payoff)
        ? { hooksResolved: [{ id: hook.id, evidence: payoff }], ending: { conclusionEvidence, settledStateEvidence } }
        : { hooksResolved: [], ending: null };
      if (call.userPrompt.includes('只写编号')) return emitText('NONE\nE=NONE', null, call.signal);
      return emitText(JSON.stringify(audit), null, call.signal);
    }
    return defaultAiHandler(call);
  };
  const { events, raw } = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.ok(events.some(event => event.type === 'completed'), raw);
  assert.equal(novel.chapters[1].content, revised);
  assert.equal(novel.foreshadowingLedger[0].resolutionEvidence, payoff);
});

test('终章复核：部分批次返回无效 JSON 时按原文编号重试，合并每批有效证据', async () => {
  const first = makeChapter('姜妍整理积压卷宗并保管交接单', '库房清点实物');
  const evidence = Array.from({ length: 13 }, (_, index) => `姜妍公开第${index + 1}号卷宗，证实相应伪签名出自同一台印章机。`);
  const conclusionEvidence = '审判长当场撤销了所有伪签名涉及的处分。';
  const settledStateEvidence = '档案室恢复了公众查阅，原保管人凭签字收回保管凭证。';
  const final = makeChapter('审判长请当事人进入庭审大厅', '庭审现场记录') + '\n\n'
    + evidence.join('\n') + '\n' + conclusionEvidence + '\n' + settledStateEvidence;
  const ledger = evidence.map((_, index) => ({ id: `archive-${index + 1}`, content: `第${index + 1}号卷宗是谁伪签的`,
    setChapter: 1, targetChapter: 2, status: 'pending' }));
  const novel = await seedNovel({ status: 'paused', targetChapterCount: 2, targetWordCount: 1200,
    outline: '姜妍查清伪签案，让受影响的人收回保管凭证。',
    chapters: [{ chapterNumber: 1, content: first, wordCount: first.length }],
    chapterPlanData: { chapters: [{ chapterNumber: 1, coreEvent: '清点卷宗', wordTarget: 600 },
      { chapterNumber: 2, coreEvent: '公开签名鉴定结果', wordTarget: 600 }] },
    foreshadowingLedger: ledger,
  });
  state.chapterQueue = [final];
  const firstBatch = ledger.slice(0, 12).map((hook, index) => ({ id: hook.id, evidence: evidence[index] }));
  let compactReviews = 0;
  let useValidIndex = false;
  state.aiHandler = call => {
    assert.notEqual(call.options?.taskType, 'ending_hook_repair', 'audit failure alone must not cause a rewrite');
    if (call.kind !== 'hookAudit') return defaultAiHandler(call);
    if (call.userPrompt.includes('只写编号')) {
      compactReviews++;
      assert.equal(call.options.jsonMode, false);
      assert.ok(call.userPrompt.includes(ledger[12].content));
      assert.ok(!call.userPrompt.includes(ledger[0].content));
      const sourceNumber = quote => {
        const excerpt = call.userPrompt.split('\n').find(line => line.endsWith(quote));
        assert.ok(excerpt);
        return excerpt.match(/^\[(\d+)\]/)[1];
      };
      const ending = call.userPrompt.includes('另写一行 E=')
        ? `\nE=${sourceNumber(conclusionEvidence)}|${sourceNumber(settledStateEvidence)}` : '';
      return emitText(useValidIndex ? `H1=${sourceNumber(evidence[12])}${ending}` : 'H1=9999', null, call.signal);
    }
    if (call.userPrompt.includes('id:archive-13')) return emitText('{"hooksResolved":[', null, call.signal);
    return emitText(JSON.stringify({ hooksResolved: firstBatch, ending: { conclusionEvidence, settledStateEvidence } }), null, call.signal);
  };
  const failed = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.match(failed.events.find(event => event.type === 'error')?.message || '', /复核未返回有效结果/);
  assert.equal(novel.chapters.length, 1);
  assert.ok(novel.foreshadowingLedger.every(hook => hook.status === 'pending'));
  useValidIndex = true;
  const resumed = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.ok(resumed.events.some(event => event.type === 'completed'), resumed.raw);
  assert.equal(compactReviews, 2);
  assert.equal(state.aiCalls.filter(call => call.kind === 'chapter').length, 1);
  assert.equal(novel.chapters.at(-1).content, final);
  assert.deepEqual(novel.chapters.at(-1).qualityReport.endingVerification, { conclusionEvidence, settledStateEvidence });
  assert.deepEqual(novel.foreshadowingLedger.map(hook => hook.resolutionEvidence), evidence);
});

test('终章分场景补写可断点续跑，保留已有结尾及原有引文', async () => {
  const ledger = Array.from({ length: 25 }, (_, index) => ({
    id: `seal-${index + 1}`, content: `档案编号${index + 1}的签发人`, setChapter: 1, targetChapter: 2, status: 'pending',
  }));
  const proofs = ledger.map((_, index) => `记录员出示档案编号${index + 1}的签名底稿，确认这份原件由该班的值勤官签发。`);
  const first = makeChapter('周宁保存工厂的盖章清单', '退役仓库的北门');
  const conclusionEvidence = '仲裁庭撤销了克扣职工补偿金的决议。';
  const settledStateEvidence = '周宁把补偿金打进邻居们的账户，大家结伴走回家。';
  const closing = settledStateEvidence + '\n\n村口早餐店刚开门，店主端出一笼热包子。';
  const draft = makeChapter('周宁将证据交给仲裁庭', '肃静的仲裁大厅') + '\n\n'
    + proofs.slice(0, 20).join('\n') + '\n' + conclusionEvidence + '\n\n' + closing;
  const novel = await seedNovel({ status: 'paused', targetChapterCount: 2, targetWordCount: 1800,
    outline: '周宁核实签发记录，工友们拿回补偿金。',
    chapters: [{ chapterNumber: 1, content: first, wordCount: first.length }],
    chapterPlanData: { chapters: [{ chapterNumber: 1, coreEvent: '保存档案', wordTarget: 900 },
      { chapterNumber: 2, coreEvent: '执行仲裁裁决并退回补偿款', wordTarget: 900 }] },
    foreshadowingLedger: ledger,
  });
  let patches = 0;
  let endingOnlyReviews = 0;
  let resume = false;
  state.postProcessChapter = text => text.replaceAll('\n\n', '\n\n　　');
  state.chapterQueue = [draft];
  state.aiHandler = call => {
    assert.notEqual(call.options?.taskType, 'ending_hook_repair');
    if (call.options?.taskType === 'ending_scene_repair') {
      patches++;
      assert.ok(call.userPrompt.includes(closing));
      const selected = ledger.flatMap((hook, index) => call.userPrompt.includes(`：${hook.content}`) ? [proofs[index]] : []);
      assert.equal(selected.length, 4);
      const citations = resume ? selected : selected.slice(0, 1);
      const action = resume ? '拿到最后四份签收的人各自拆开信封。柜台压着他们按过手印的单子，归档前逐份对照。\n'
        : '记录员打开一个收好的铁文件箱，原件整齐地码在里面。他请工作人员扫描以后将原件分别归还，每个信封的位置都必须登记。\n';
      return emitText(action + citations.join('\n'), null, call.signal);
    }
    if (call.kind === 'hookAudit') {
      if (!resume && call.userPrompt.includes(ledger[24].content)) return emitText('{"hooksResolved":[', null, call.signal);
      if (resume) assert.doesNotMatch(call.userPrompt, /id:seal-21 内容/);
      if (call.userPrompt.includes('终局目标与前文场景') && !call.userPrompt.includes('id:seal-')) endingOnlyReviews++;
      const hooksResolved = ledger.flatMap((hook, index) => call.userPrompt.includes(`id:${hook.id} 内容`) && call.userPrompt.includes(proofs[index])
        ? [{ id: hook.id, evidence: proofs[index] }] : []);
      return emitText(JSON.stringify({ hooksResolved, ending: { conclusionEvidence, settledStateEvidence } }), null, call.signal);
    }
    return defaultAiHandler(call);
  };
  const firstAttempt = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.match(firstAttempt.events.find(event => event.type === 'error')?.message || '', /尚未核实回收 4 条伏笔/);
  assert.equal(novel.chapters.length, 1);
  assert.ok(novel.foreshadowingLedger.every(hook => hook.status === 'pending'));
  const pausedJob = [...state.jobs.values()].find(job => job.novelId === novel._id);
  const checkpointed = pausedJob?.draft || '';
  assert.ok(checkpointed.includes(proofs[20]));
  assert.ok(!checkpointed.includes(proofs[21]));
  assert.ok(checkpointed.endsWith(closing));
  assert.ok(pausedJob.draftReview.evidence.some(item => item.id === ledger[20].id && item.evidence === proofs[20]));
  resume = true;
  const { events, raw } = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.ok(events.some(event => event.type === 'completed'), raw);
  assert.equal(patches, 2);
  assert.equal(endingOnlyReviews, 4);
  assert.equal(novel.chapters.length, 2);
  assert.equal(novel.chapters[1].content.endsWith(state.postProcessChapter(closing)), true);
  assert.equal(novel.chapters[1].content.startsWith(state.postProcessChapter(draft.slice(0, draft.indexOf(closing) - 2))), true);
  assert.deepEqual(novel.foreshadowingLedger.map(hook => hook.resolutionEvidence), proofs);
});

test('终局冲突按段落修订，保留已核实的回收原文', async () => {
  const ledger = Array.from({ length: 13 }, (_, index) => ({
    id: `valve-${index + 1}`, content: `阀门${index + 1}的去向`, setChapter: 1, targetChapter: 2, status: 'pending',
  }));
  const proofs = ledger.map((_, index) => `库管员从待交还的清单里找到阀门${index + 1}，给负责人看了签收位置。`);
  const first = makeChapter('周宁在库房核对零件台账', '维修队的仓库');
  const conflict = '这场供水危机才刚刚进入最危险的阶段。';
  const conclusionEvidence = '按响启动铃后，工人亲眼看见主泵重新接通全镇管网。';
  const settledStateEvidence = '周宁走出机房，邻居正接满回家煮饭用的第一桶水。';
  const draft = makeChapter('周宁推开泵房大门', '水务站正式交接') + '\n\n'
    + proofs.join('\n') + '\n\n' + conflict + '\n\n' + settledStateEvidence;
  const novel = await seedNovel({ status: 'paused', targetChapterCount: 2, targetWordCount: 1900,
    outline: '周宁归还备用阀门，维修水泵，恢复镇里的水源。',
    chapters: [{ chapterNumber: 1, content: first, wordCount: first.length }],
    chapterPlanData: { chapters: [{ chapterNumber: 1, coreEvent: '核对阀门台账', wordTarget: 950 },
      { chapterNumber: 2, coreEvent: '重启主水泵并恢复供水', wordTarget: 950 }] },
    foreshadowingLedger: ledger,
  });
  state.chapterQueue = [draft];
  let repairs = 0;
  let acceptRepairedEnding = false;
  state.aiHandler = call => {
    assert.notEqual(call.options?.taskType, 'ending_hook_repair');
    if (call.options?.taskType === 'ending_paragraph_repair') {
      repairs++;
      const paragraph = call.userPrompt.split('\n').find(line => line.endsWith(conflict))?.match(/^\[(\d+)\]/)[1];
      assert.ok(paragraph);
      return emitText(JSON.stringify({ changes: [{ paragraph: Number(paragraph), text: conclusionEvidence }] }), null, call.signal);
    }
    if (call.kind === 'hookAudit') {
      const hooksResolved = ledger.flatMap((hook, index) => call.userPrompt.includes(`id:${hook.id} 内容`)
        ? [{ id: hook.id, evidence: proofs[index] }] : []);
      const repaired = call.userPrompt.includes(conclusionEvidence);
      const ending = repaired && !acceptRepairedEnding ? null : {
        conclusionEvidence: repaired ? conclusionEvidence : conflict, settledStateEvidence,
      };
      return emitText(JSON.stringify({ hooksResolved, ending, endingIssue: ending ? '' : '需要确认供水已经恢复' }), null, call.signal);
    }
    return defaultAiHandler(call);
  };
  const pending = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.match(pending.events.find(event => event.type === 'error')?.message || '', /需要确认供水已经恢复/);
  assert.equal(novel.chapters.length, 1);
  assert.equal([...state.jobs.values()].find(job => job.novelId === novel._id)?.draft, draft.replace(conflict, conclusionEvidence));
  acceptRepairedEnding = true;
  const { events, raw } = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.ok(events.some(event => event.type === 'completed'), raw);
  assert.equal(repairs, 1);
  assert.equal(novel.chapters[1].content, draft.replace(conflict, conclusionEvidence));
  assert.deepEqual(novel.foreshadowingLedger.map(hook => hook.resolutionEvidence), proofs);
});

test('章末复核优先检查正文相关的旧伏笔，避免被近期条目挤出', async () => {
  const chapters = Array.from({ length: 14 }, (_, index) => ({
    chapterNumber: index + 1, content: `配给记录第${index + 1}页已归档。`, wordCount: 16,
  }));
  const hook = { id: 'old', content: '海浪标志的黄铜钥匙', setChapter: 1, status: 'pending' };
  const recentHooks = Array.from({ length: 12 }, (_, index) => ({
    id: `recent-${index}`, content: `第${index}号车载扬声器的故障原因`, setChapter: 13, status: 'pending',
  }));
  const evidence = '海浪标志的黄铜钥匙打开了墙后的铁柜，失踪的回单就放在里面。';
  const next = makeChapter('周宁独自上楼检查铁柜', '柜门里的隔层') + '\n' + evidence;
  const novel = await seedNovel({ status: 'paused', targetChapterCount: 18, targetWordCount: 18000, chapters,
    outline: '周宁用找到的线索查清回单的去向。',
    chapterPlanData: { chapters: [...chapters.map(chapter => ({ chapterNumber: chapter.chapterNumber, coreEvent: chapter.content })),
      { chapterNumber: 15, coreEvent: '打开铁柜找到失踪的回单', wordTarget: 600, title: '铁柜回单' }] },
    foreshadowingLedger: [hook, ...recentHooks],
  });
  state.chapterQueue = [next];
  state.aiHandler = call => {
    if (call.kind === 'hookAudit') {
      assert.match(call.userPrompt, /id:old/);
      assert.equal([...call.userPrompt.matchAll(/id:recent-\d+ 内容/g)].length, 11);
      return emitText(JSON.stringify({ hooksResolved: [{ id: hook.id, evidence }] }), null, call.signal);
    }
    return defaultAiHandler(call);
  };
  const { events, raw } = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.ok(events.some(event => event.type === 'chapter_end'), raw);
  assert.equal(novel.foreshadowingLedger[0].resolvedChapter, 15);
  assert.equal(novel.foreshadowingLedger[0].resolutionEvidence, evidence);
});

test('终章先核对已保存的回收证据，拒绝借用其他伏笔的原文编号', async () => {
  const setupKey = '周宁捡到刻有海浪标志的黄铜钥匙，暂时没有找到对应的锁。';
  const setupEnvelope = '另有一封用蓝蜡封好的信，寄件人故意没有署名。';
  const keyEvidence = '黄铜钥匙的海浪标志和证物柜门相同，他用这把钥匙打开了证物柜。';
  const envelopeMention = '那封蓝蜡封好的信仍在周宁口袋里，封口完好。';
  const envelopeEvidence = '周宁当众打开那封蓝蜡封好的信，认出寄件人就是公开道歉的关队长。';
  const conclusionEvidence = '法庭当场公布了最终裁定，将房屋归还周家。';
  const settledStateEvidence = '周宁和母亲搬回老宅，一起给邻居送上新烤的面包。';
  const first = makeChapter('周宁收拾工坊台面', '潮湿的工坊石阶') + '\n' + setupKey + setupEnvelope;
  const second = makeChapter('同伴走进旧档案馆', '档案馆的走廊') + '\n' + keyEvidence + envelopeMention;
  const final = makeChapter('法官展开最终裁定', '审判大厅的回声') + '\n' + envelopeEvidence + conclusionEvidence + settledStateEvidence;
  const novel = await seedNovel({ status: 'paused', targetChapterCount: 3, targetWordCount: 1800,
    outline: '周宁找到房产权证，让家人搬回旧宅。',
    chapters: [{ chapterNumber: 1, content: first, wordCount: first.length }, { chapterNumber: 2, content: second, wordCount: second.length }],
    chapterPlanData: { chapters: [{ chapterNumber: 1, coreEvent: '找到钥匙和信', wordTarget: 600 },
      { chapterNumber: 2, coreEvent: '打开证物柜取得产权证', wordTarget: 600 },
      { chapterNumber: 3, coreEvent: '公布信件来源与最终裁定', wordTarget: 600 }] },
    foreshadowingLedger: [
      { id: 'key', content: '海浪标志的黄铜钥匙能打开什么', setChapter: 1, setupEvidence: setupKey, status: 'pending' },
      { id: 'envelope', content: '蓝蜡封好的信是谁寄的', setChapter: 1, setupEvidence: setupEnvelope, status: 'pending' },
    ],
  });
  state.chapterQueue = [final];
  let archiveReviews = 0;
  state.aiHandler = call => {
    if (call.options?.taskType === 'historical_hook_audit') {
      archiveReviews++;
      const keyEntry = call.userPrompt.split(/\nH2（/)[0];
      const number = keyEntry.split('\n').find(line => line.endsWith(keyEvidence))?.match(/^\[(\d+)\]/)?.[1];
      const mentionNumber = call.userPrompt.split(/\nH2（/)[1].split('\n')
        .find(line => line.endsWith(envelopeMention))?.match(/^\[(\d+)\]/)?.[1];
      assert.ok(number, '历史章节中的答案应作为可选证据');
      assert.ok(mentionNumber);
      return emitText(`H1=${number}\nH2=${number}\nH2=${mentionNumber}`, null, call.signal);
    }
    if (call.options?.taskType === 'historical_hook_audit_confirm') {
      assert.ok(call.userPrompt.includes(keyEvidence));
      assert.ok(call.userPrompt.includes(envelopeMention));
      assert.equal(call.userPrompt.split('所引原文：').length, 3);
      return emitText('H1=YES\nH2=NO', null, call.signal);
    }
    if (call.kind === 'hookAudit') {
      assert.match(call.userPrompt, /id:envelope/);
      assert.doesNotMatch(call.userPrompt, /id:key/);
      return emitText(JSON.stringify({ hooksResolved: [{ id: 'envelope', evidence: envelopeEvidence }],
        ending: { conclusionEvidence, settledStateEvidence } }), null, call.signal);
    }
    return defaultAiHandler(call);
  };
  const { events, raw } = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.ok(events.some(event => event.type === 'completed'), raw);
  assert.equal(archiveReviews, 1);
  assert.deepEqual(novel.chapters.map(chapter => chapter.content), [first, second, final]);
  assert.deepEqual(novel.foreshadowingLedger.map(hook => [hook.resolvedChapter, hook.resolutionEvidence]),
    [[2, keyEvidence], [3, envelopeEvidence]]);
  const update = content => fetch(`${baseUrl}/${novel._id}/chapter/2`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
  });
  assert.equal((await update(second + '周宁把档案袋放回桌上。')).status, 200);
  assert.equal(novel.status, 'completed');
  assert.equal((await update(second.replace(keyEvidence, '周宁把刻有海浪标志的黄铜钥匙放回包里，只远远看了一眼证物柜。'))).status, 200);
  assert.equal(novel.status, 'paused');
  assert.equal(novel.foreshadowingLedger[0].status, 'pending');
  assert.equal(novel.foreshadowingLedger[0].resolutionEvidence, '');
  assert.equal(novel.foreshadowingLedger[1].status, 'resolved');
  state.aiHandler = call => {
    if (call.options?.taskType === 'historical_hook_audit') {
      archiveReviews++;
      assert.equal(call.signal.aborted, false);
      throw abortError();
    }
    if (call.options?.taskType === 'ending_hook_repair') return emitText(final, null, call.signal);
    if (call.kind === 'hookAudit') {
      if (call.userPrompt.includes('只写编号')) return emitText('NONE', null, call.signal);
      return emitText(JSON.stringify({ hooksResolved: [{ id: 'envelope', evidence: envelopeEvidence }],
        ending: { conclusionEvidence, settledStateEvidence } }), null, call.signal);
    }
    return defaultAiHandler(call);
  };
  const afterEdit = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.equal(archiveReviews, 2);
  assert.match(afterEdit.events.find(event => event.type === 'error')?.message || '', /终章尚未核实回收 1 条伏笔/);
  assert.equal(novel.foreshadowingLedger[0].status, 'pending');
  assert.equal(novel.chapters.length, 3);
});

test('旧版已写满固定章数：在原终章补回收，保留已核实的结局引文', async () => {
  const first = makeChapter('周宁在仓库找到了旧钥匙', '清晨的铁窗');
  const payoff = '那把钥匙打开了证物柜，柜里存着前任所长藏起来的回执。';
  const conclusionEvidence = '法庭根据新证物撤销了原判，当场宣布周宁无罪。';
  const settledStateEvidence = '周宁吃完家里的热饭，告诉母亲明天陪她去买菜。';
  const draft = makeChapter('法庭宣布当日宣判', '沉默的旁听席');
  const original = draft + '\n\n' + conclusionEvidence + settledStateEvidence;
  const revised = draft + '\n\n' + payoff + conclusionEvidence + settledStateEvidence;
  const novel = await seedNovel({ status: 'completed', targetWordCount: 10000, outline: '周宁用仓库钥匙取得证据并为自己翻案。',
    generationInput: { mode: 'book', storyBlueprint: { blueprintLevel: 3, phases: [{ startChapter: 1, endChapter: 2 }] } },
    chapters: [{ chapterNumber: 1, content: first, wordCount: first.length }, { chapterNumber: 2, content: original, wordCount: original.length }],
    foreshadowingLedger: [{ id: 'key', content: '旧钥匙的用途', setChapter: 1, targetChapter: 2, resolvedChapter: 2, status: 'resolved' }],
  });
  state.aiHandler = call => {
    if (call.options?.taskType === 'ending_hook_repair') return emitText(revised, null, call.signal);
    assert.equal(call.kind, 'hookAudit');
    assert.match(call.userPrompt, /旧钥匙的用途/);
    const hasPayoff = call.userPrompt.includes(payoff);
    return emitText(JSON.stringify(hasPayoff ? {
      hooksResolved: [{ id: 'key', evidence: payoff }], ending: { conclusionEvidence: '引文没有出现在正文里会被拒绝。', settledStateEvidence },
    } : { hooksResolved: [], ending: { conclusionEvidence, settledStateEvidence } }), null, call.signal);
  };
  const { events, raw } = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.equal(novel.status, 'completed', raw);
  assert.equal(novel.targetChapterCount, 2);
  assert.deepEqual(novel.chapters.map(chapter => chapter.content), [first, revised]);
  assert.equal(novel.foreshadowingLedger[0].resolutionEvidence, payoff);
  assert.equal(novel.chapters.at(-1).qualityReport.endingVerification.conclusionEvidence, conclusionEvidence);
  assert.ok(events.some(event => event.type === 'completed'));
  assert.equal(state.memoryCalls.length, 0, '结局修订使用已保存的正文，无需等待记忆整理');
});

test('新书整本：已确认蓝图但计划为空时使用兜底计划直接开始正文', async () => {
  state.planContent = '';
  state.chapterQueue = [makeChapter('林舟在雨夜进入废弃邮局，决定沿着旧案线索继续追查', '兜底计划首章')];

  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia',
    protagonistName: '林舟',
    worldSetting: '阴雨旧城中的沉重悬疑故事',
    targetWordCount: 600,
    outline: '林舟追查旧案，在危机中揭开真相并完成主线收束。',
    mode: 'book',
    storyBlueprint: { mainArc: '追查旧案并完成主线收束', phases: [{ title: '开端', startChapter: 1, endChapter: 1 }] },
  });

  assert.equal(response.status, 200);
  assert.ok(eventIndex(events, 'status', (event) => event.message.includes('自动补全')) > -1);
  assert.ok(eventIndex(events, 'chapter_start') > eventIndex(events, 'novel_created'));
  assert.equal(eventIndex(events, 'plan_needs_extension'), -1);
  assert.equal(getCreatedNovel(events).chapters.length, 1);
  assert.ok(state.aiCalls.some((call) => call.kind === 'chapter'));
  // 思考型线路的章节计划超时已放宽（120s），断言新值防止回退到旧 45s。
  assert.equal(state.aiCalls.find((call) => call.kind === 'plan').timeoutMs, 120000);
});

test('新书整本：已确认蓝图且计划请求被取消时直接使用兜底计划', async () => {
  state.chapterQueue = [makeChapter('林舟在雨夜进入废弃邮局，决定沿着旧案线索继续追查', '取消计划后首章')];
  state.aiHandler = async (call) => {
    if (call.kind === 'plan') throw abortError();
    return defaultAiHandler(call);
  };

  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia',
    protagonistName: '林舟',
    worldSetting: '阴雨旧城中的沉重悬疑故事',
    targetWordCount: 600,
    outline: '林舟追查旧案，在危机中揭开真相并完成主线收束。',
    mode: 'book',
    storyBlueprint: { mainArc: '追查旧案并完成主线收束', phases: [{ title: '开端', startChapter: 1, endChapter: 1 }] },
  });

  assert.equal(response.status, 200);
  assert.ok(eventIndex(events, 'status', (event) => event.message.includes('根据已确认蓝图补全')) > -1);
  assert.ok(eventIndex(events, 'chapter_start') > eventIndex(events, 'novel_created'));
  assert.equal(eventIndex(events, 'plan_needs_extension'), -1);
  assert.equal(getCreatedNovel(events).chapters.length, 1);
});

test('新书长篇：详细计划持续不可解析时暂停，不使用通用卡生成正文', async () => {
  const content = makeChapter('林舟根据旧案线索进入废弃邮局', '长篇兜底计划');
  state.planContent = '';
  state.chapterQueue = [content];

  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia',
    protagonistName: '林舟',
    worldSetting: '阴雨旧城中的沉重悬疑故事',
    outline: '林舟追查旧案，在危机中揭开真相并完成主线收束。',
    targetWordCount: 100000,
    mode: 'book',
  });

  const novel = getCreatedNovel(events);
  assert.equal(response.status, 200);
  assert.ok(novel.chapterPlanData.chapters.length > 0);
  assert.equal(novel.chapterPlanData.fallback, true);
  assert.ok(eventIndex(events, 'status', (event) => event.message.includes('自动补全')) > -1);
  assert.equal(state.aiCalls.some((call) => call.kind === 'chapter'), false);
  assert.equal(novel.status, 'paused');
  assert.equal(novel.chapters.length, 0);
  assert.ok(eventIndex(events, 'plan_needs_extension') > -1);
  assert.equal(state.aiCalls.filter(call => call.kind === 'plan').length, 3);
});

test('新书整本：字数提前达到时仍执行后续计划章节，并为每章传入输出上限', async () => {
  state.planContent = makePlan([
    { chapterNumber: 1, wordTarget: 300, coreEvent: '收到第一条线索' },
    { chapterNumber: 2, wordTarget: 300, coreEvent: '发现线索指向旧码头' },
    { chapterNumber: 3, wordTarget: 300, coreEvent: '在旧码头完成收束' },
  ]);
  state.chapterQueue = [
    makeChapter('林舟收到第一条线索并决定去旧码头', '提前达到测试一'),
    makeChapter('林舟发现线索指向旧码头的仓库', '提前达到测试二'),
    makeChapter('林舟在旧码头完成收束并保存证据', '提前达到测试三'),
  ];

  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia',
    protagonistName: '林舟',
    targetWordCount: 900,
    outline: '林舟从线索追到旧码头并完成收束。',
    mode: 'book',
  });

  assert.equal(response.status, 200);
  const novel = getCreatedNovel(events);
  assert.equal(novel.status, 'completed');
  assert.deepEqual(novel.chapters.map((chapter) => chapter.chapterNumber), [1, 2, 3]);
  assert.ok(novel.currentWordCount > novel.targetWordCount);
  const chapterCalls = state.aiCalls.filter((call) => call.kind === 'chapter');
  assert.equal(chapterCalls.length, 3);
  assert.ok(chapterCalls.every((call) => call.maxTokens >= 2200 && call.maxTokens < 16384));
  assert.match(chapterCalls[2].userPrompt, /即使总字数已经达到目标，也必须完成本章计划/);
});

test('续写单章：每次只追加连续一章，并保持作品可再次续写', async () => {
  const first = makeChapter('林舟决定保存匿名来信并前往旧码头', '匿名来信');
  const second = makeChapter('林舟发现旧码头的值班表被人替换', '码头值班表');
  const third = makeChapter('林舟拒绝交出值班表并带苏晚离开码头', '码头撤离');
  const planData = JSON.parse(makePlan([
    { chapterNumber: 1, wordTarget: 600, coreEvent: '收到匿名来信' },
    { chapterNumber: 2, wordTarget: 600, coreEvent: '调查旧码头值班表', characters: ['林舟', '苏晚'] },
    { chapterNumber: 3, wordTarget: 600, coreEvent: '带走值班表并撤离', characters: ['林舟', '苏晚'] },
  ]));
  const novel = await seedNovel({
    _id: 'continue-single',
    status: 'paused',
    targetWordCount: 4000,
    protagonistName: '林舟',
    generationContext: '旧版声线：林舟说话直接，苏晚说话有分寸。',
    outline: '【人物声音表】\n林舟：\n句长：先问要紧的事，话短。\n苏晚：\n常用词汇：行吧行吧行吧。\n称呼习惯：对陌生人客气，和林舟会开玩笑。\n【剧情阶段】',
    chapters: [{ chapterNumber: 1, title: '第1章', content: first, wordCount: first.length }],
    chapterPlan: JSON.stringify(planData),
    chapterPlanData: planData,
  });
  state.chapterQueue = [second, third];

  const firstRun = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.equal(firstRun.response.status, 200);
  const firstWritingCall = state.aiCalls.find((call) => call.kind === 'chapter');
  assert.match(firstWritingCall.systemPrompt, /旧版声线：林舟说话直接，苏晚说话有分寸。/);
  assert.match(firstWritingCall.systemPrompt, /像平时说话那样/);
  assert.ok(eventIndex(firstRun.events, 'continue_start') < eventIndex(firstRun.events, 'chapter_start'));
  assert.ok(eventIndex(firstRun.events, 'chapter_end') < eventIndex(firstRun.events, 'completed'));
  assert.deepEqual(novel.chapters.map((chapter) => chapter.chapterNumber), [1, 2]);
  assert.equal(novel.status, 'paused');

  const secondRun = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.equal(secondRun.response.status, 200);
  assert.deepEqual(novel.chapters.map((chapter) => chapter.chapterNumber), [1, 2, 3]);
  assert.equal(novel.status, 'paused');
  assert.equal(novel.currentChapterIndex, 3);
  assert.equal(new Set(novel.chapters.map((chapter) => chapter.chapterNumber)).size, 3);
  const writes = state.aiCalls.filter(call => call.kind === 'chapter');
  assert.equal(writes.length, 2);
  for (const { userPrompt } of writes) {
    assert.match(userPrompt, /林舟：[^\n]+句长：先问要紧的事，话短/);
    assert.match(userPrompt, /苏晚：[^\n]+称呼习惯：对陌生人客气，和林舟会开玩笑/);
  }
});

test('书架继续生成：用户报告的日报结尾被定点修订，专家模式关闭时仍生效', async () => {
  const ending = require('./fixtures/repeatedWorkplaceEnding');
  const first = makeChapter('刘海柱在仓库收好货损证据', '昨天的仓库') + '\n' + ending;
  const prefix = makeChapter('刘海柱和司机核对卸货车号', '今天的新调查') + '车号最后一位是乙。\n\n';
  const replacement = makeChapter('刘海柱把卸货签名单交给韩晓梅并指出责任人', '新的卸货签名单');
  const novel = await seedNovel({ _id: 'workplace-ending-repair', status: 'paused', expertMode: false,
    title: '现实·行业职场：刘海柱的传奇', protagonistName: '刘海柱',
    chapters: [{ chapterNumber: 1, content: first, wordCount: first.length }],
    chapterPlanData: { chapters: [{ chapterNumber: 2, wordTarget: 600, coreEvent: '核对卸货车号' }] },
  });
  state.chapterQueue = [prefix + ending];
  state.aiHandler = call => call.options?.taskType === 'targeted_repair'
    ? emitText(replacement, null, call.signal) : defaultAiHandler(call);
  const { events } = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.equal(events.some(event => event.type === 'error'), false);
  assert.equal(novel.chapters.length, 2);
  assert.equal(novel.chapters[0].content, first);
  assert.equal(novel.chapters[1].content, (prefix + replacement).trim());
  assert.equal(novel.chapters[1].qualityReport.endingRepetition.sourceChapter, 1);
  assert.ok(events.some(event => event.type === 'status' && event.message.includes('结尾与第1章重复')));
  assert.ok(events.some(event => event.type === 'expert_revision' && event.content === prefix + replacement));
  assert.equal(state.aiCalls.filter(call => call.options?.taskType === 'targeted_repair').length, 1);
  assert.equal(novel.chapters[1].qualityReport.tokens.calls, 3, 'writing, repair and semantic memory usage must all be included');
  assert.ok(state.aiCalls.find(call => call.kind === 'chapter').userPrompt.includes('章末防重复'));
});

test('书架整本续写：修订仍重复时暂停，保留草稿、不写入坏章、不生成后续章节', async () => {
  const ending = require('./fixtures/repeatedWorkplaceEnding');
  const first = makeChapter('刘海柱检查货损', '前一章现场') + '\n' + ending;
  const draft = makeChapter('刘海柱核对责任人', '下一章现场') + '\n\n' + ending;
  const novel = await seedNovel({ _id: 'workplace-ending-blocked', status: 'paused', expertMode: false,
    chapters: [{ chapterNumber: 1, content: first, wordCount: first.length }],
    chapterPlanData: { chapters: [2, 3].map(chapterNumber => ({ chapterNumber, wordTarget: 600, coreEvent: '核对责任人' })) },
  });
  state.chapterQueue = [draft];
  state.aiHandler = call => call.options?.taskType === 'targeted_repair'
    ? emitText(ending, null, call.signal) : defaultAiHandler(call);
  const { events } = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.match(events.find(event => event.type === 'error').message, /与第1章大段重复/);
  assert.equal(novel.status, 'paused');
  assert.deepEqual(novel.chapters.map(chapter => chapter.content), [first]);
  assert.equal([...state.jobs.values()][0].draft, draft);
  assert.equal(state.aiCalls.filter(call => call.kind === 'chapter').length, 1);
  assert.equal(state.aiCalls.filter(call => call.options?.taskType === 'targeted_repair').length, 1);
});

test('新建整本生成：提交前同样修订重复结尾', async () => {
  const ending = require('./fixtures/repeatedWorkplaceEnding');
  const prefix = makeChapter('刘海柱核对货损的赔付金额', '赔付金额新证据') + '数额签名丙。\n\n';
  const replacement = makeChapter('刘海柱当面交出照片要求重核金额', '金额核验落点');
  state.planContent = makePlan([1, 2].map(chapterNumber => ({ chapterNumber, wordTarget: 600, coreEvent: '核对货损金额' })));
  state.chapterQueue = [makeChapter('刘海柱记录仓库现场', '首章现场') + '\n' + ending, prefix + ending];
  state.aiHandler = call => call.options?.taskType === 'targeted_repair'
    ? emitText(replacement, null, call.signal) : defaultAiHandler(call);
  const { events } = await postSse('/generate', { mode: 'book', novelTypeId: 'xianxia',
    protagonistName: '刘海柱', targetWordCount: 1300, outline: '核对货损金额与责任人', expertMode: false });
  assert.equal(events.some(event => event.type === 'error'), false);
  const novel = [...state.novels.values()][0];
  assert.equal(novel.chapters.length, 2);
  assert.equal(novel.chapters[1].content, (prefix + replacement).trim());
  assert.equal(state.aiCalls.filter(call => call.options?.taskType === 'targeted_repair').length, 1);
});

test('导入续写及指定章节续写：共同拦截重复结尾并保存修订结果', async t => {
  for (const operation of ['import', 'new-chapter', 'append']) {
    await t.test(operation, async () => {
      resetState();
      const ending = require('./fixtures/repeatedWorkplaceEnding');
      const first = makeChapter('刘海柱记录仓库现场', '仓库旧现场') + '\n' + ending;
      const prefix = makeChapter('刘海柱核对新的车号', '新车号调查') + '司机编号丁。\n\n';
      const replacement = makeChapter('刘海柱把车号记入值班表交回', '值班表上的车号');
      const published = makeChapter('刘海柱来到调度室', '已发表第二章');
      const novel = await seedNovel({ _id: `ending-${operation}`, status: 'paused',
        chapters: [{ chapterNumber: 1, content: first, wordCount: first.length },
          ...(operation === 'append' ? [{ chapterNumber: 2, content: published, wordCount: published.length }] : [])] });
      state.chapterQueue = [prefix + ending];
      state.aiHandler = call => call.options?.taskType === 'targeted_repair'
        ? emitText(replacement, null, call.signal) : defaultAiHandler(call);
      const { events } = operation === 'import'
        ? await postSse('/continue-import', { novelId: novel._id, importedText: first, mode: 'chapter', targetWordCount: 600 })
        : await postSse(`/${novel._id}/continue-chapter/2`, { wordCount: 600 });
      assert.equal(events.some(event => event.type === 'error'), false);
      assert.equal(novel.chapters.length, 2);
      assert.equal(novel.chapters[0].content, first);
      assert.equal(novel.chapters[1].content, (operation === 'append' ? published : '') + (prefix + replacement).trim());
      assert.equal(state.aiCalls.filter(call => call.options?.taskType === 'targeted_repair').length, 1);
      assert.equal([...state.jobs.values()][0].draft, '');
    });
  }
});

test('续写整本：从最高章节号继续，按剩余计划完成全书', async () => {
  const first = makeChapter('林舟决定从匿名来信查起', '第一章线索');
  const second = makeChapter('林舟发现旧码头值班表指向地下仓库', '第二章线索');
  const third = makeChapter('林舟进入地下仓库并救出失踪证人', '第三章收束');
  const planData = JSON.parse(makePlan([
    { chapterNumber: 1, wordTarget: 600, coreEvent: '收到匿名来信' },
    { chapterNumber: 2, wordTarget: 600, coreEvent: '调查旧码头值班表' },
    { chapterNumber: 3, wordTarget: 600, coreEvent: '救出失踪证人' },
  ]));
  const novel = await seedNovel({
    _id: 'continue-book',
    status: 'paused',
    targetWordCount: 1800,
    protagonistName: '林舟',
    chapters: [{ chapterNumber: 1, title: '第1章', content: first, wordCount: first.length }],
    chapterPlan: JSON.stringify(planData),
    chapterPlanData: planData,
  });
  state.chapterQueue = [second, third];

  const { response, events } = await postSse(`/continue/${novel._id}`, { mode: 'book' });

  assert.equal(response.status, 200);
  assert.deepEqual(novel.chapters.map((chapter) => chapter.chapterNumber), [1, 2, 3]);
  assert.equal(novel.status, 'completed');
  assert.ok(novel.currentWordCount >= novel.targetWordCount);
  assert.deepEqual(state.aiCalls.filter((call) => call.kind !== 'hookAudit').map((call) => call.kind), ['chapter', 'chapter']);
  assert.ok(eventIndex(events, 'chapter_end', (event) => event.chapterNumber === 2) < eventIndex(events, 'chapter_start', (event) => event.chapterNumber === 3));
  assert.ok(eventIndex(events, 'chapter_end', (event) => event.chapterNumber === 3) < eventIndex(events, 'completed'));
});

test('续写整本：缺少计划时暂停，计划耗尽但未达字数时自动扩展', async (t) => {
  await t.test('缺少计划', async () => {
    const first = makeChapter('林舟决定保存现有证据', '缺少计划');
    const novel = await seedNovel({
      _id: 'missing-plan',
      status: 'paused',
      targetWordCount: 3000,
      chapters: [{ chapterNumber: 1, title: '第1章', content: first, wordCount: first.length }],
    });

    const { response, events } = await postSse(`/continue/${novel._id}`, { mode: 'book' });
    assert.equal(response.status, 200);
    assert.equal(events.at(-1).type, 'plan_needs_extension');
    assert.equal(novel.status, 'paused');
    assert.equal(novel.chapters.length, 1);
    assert.equal(state.aiCalls.length, 0);
  });

  await t.test('计划已耗尽', async () => {
    resetState();
    const first = makeChapter('林舟决定保存现有证据', '计划耗尽');
    const planData = JSON.parse(makePlan([
      { chapterNumber: 1, wordTarget: 600, coreEvent: '保存证据' },
    ]));
    const novel = await seedNovel({
      _id: 'exhausted-plan',
      status: 'paused',
      targetWordCount: 3000,
      chapters: [{ chapterNumber: 1, title: '第1章', content: first, wordCount: first.length }],
      chapterPlan: JSON.stringify(planData),
      chapterPlanData: planData,
    });
    state.chapterQueue = [
      makeChapter('林舟核对证据来源并找到第二名目击者', '自动扩展2'),
      makeChapter('目击者交出被隐藏的值班记录', '自动扩展3'),
      makeChapter('林舟沿值班记录追到旧仓库', '自动扩展4'),
      makeChapter('林舟在旧仓库完成当前主线收束', '自动扩展5'),
    ];

    const { response, events } = await postSse(`/continue/${novel._id}`, { mode: 'book' });
    assert.equal(response.status, 200);
    assert.equal(events.at(-1).type, 'completed');
    assert.equal(eventIndex(events, 'plan_needs_extension'), -1);
    assert.ok(eventIndex(events, 'status', (event) => event.message.includes('自动扩展至第5章')) > -1);
    assert.equal(novel.status, 'completed');
    assert.deepEqual(novel.chapters.map((chapter) => chapter.chapterNumber), [1, 2, 3, 4, 5]);
    assert.ok(novel.currentWordCount >= novel.targetWordCount);
    assert.equal(novel.chapterPlanData.autoExtended, true);
    assert.ok(novel.chapterPlanData.chapters.some((chapter) => chapter.chapterNumber === 5));
    assert.equal(state.aiCalls.filter((call) => call.kind === 'chapter').length, 4);
  });
});

test('十万字边界：续写第21章前先生成并保存具体计划，不拿开场句当标题', async () => {
  const chapters = Array.from({ length: 20 }, (_, index) => ({ chapterNumber: index + 1,
    title: `第${index + 1}章 已定事件${index + 1}`, content: '已经完成的仓库事件记录。'.repeat(500).slice(0, 4968), wordCount: 4968 }));
  const planData = JSON.parse(makePlan(chapters.map(chapter => ({ chapterNumber: chapter.chapterNumber,
    title: `已定事件${chapter.chapterNumber}`, coreEvent: `完成既定仓库事件${chapter.chapterNumber}`, wordTarget: 1200 }))));
  const novel = await seedNovel({ _id: 'long-book-boundary', status: 'paused', targetWordCount: 100000,
    chapterWordTarget: 1200, outline: '刘海柱拿到签收凭证，厘清货损责任并保住仓库。',
    protagonistName: '刘海柱', chapterPlanData: planData, chapterPlan: JSON.stringify(planData), chapters });
  const previousChapters = clone(novel.chapters);
  let savedPlanBeforeProse = false;
  const save = novel.save.bind(novel);
  novel.save = async () => {
    if (novel.chapterPlanData.chapters.some(chapter => chapter.chapterNumber === 21 && chapter.raw === '模型分批细化计划')) savedPlanBeforeProse = true;
    return save();
  };
  state.chapterQueue = [makeChapter('周四，上午九点，刘海柱拿到外包签收原件，厘清货损责任', '分批规划21')];
  state.aiHandler = async call => {
    if (call.kind === 'plan') return emitText(makePlan([{ chapterNumber: 21, title: '签收原件',
      coreEvent: '刘海柱取得外包签收原件，当面对质后明确货损责任。' }]), null, call.signal);
    if (call.kind === 'chapter') {
      assert.equal(savedPlanBeforeProse, true);
      assert.match(call.userPrompt, /取得外包签收原件/);
    }
    return defaultAiHandler(call);
  };
  const { events } = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.equal(events.at(-1).type, 'completed');
  assert.deepEqual(novel.chapters.slice(0, 20).map(({ memorySummary, ...chapter }) => chapter), previousChapters);
  assert.equal(novel.chapters[20].title, '第21章 签收原件');
  assert.equal(state.aiCalls.filter(call => call.kind === 'plan').length, 1);
  assert.equal(state.aiCalls.filter(call => call.kind === 'chapter').length, 1);
});

test('十万字边界：后续计划无效时暂停并保留前20章，不请求第21章正文', async () => {
  const chapters = Array.from({ length: 20 }, (_, index) => ({ chapterNumber: index + 1,
    title: `第${index + 1}章 原标题`, content: '已经确认的既有情节。'.repeat(500), wordCount: 5000 }));
  const planData = JSON.parse(makePlan(chapters.map(chapter => ({ chapterNumber: chapter.chapterNumber,
    title: `原标题${chapter.chapterNumber}`, coreEvent: `已完成事件${chapter.chapterNumber}`, wordTarget: 5000 }))));
  const novel = await seedNovel({ _id: 'long-book-invalid-plan', status: 'paused', targetWordCount: 900000,
    chapterWordTarget: 5000, outline: '核对签收凭证，厘清货损责任。',
    chapterPlanData: planData, chapterPlan: JSON.stringify(planData), chapters });
  const original = clone(novel.chapters);
  const { events } = await postSse(`/continue/${novel._id}`, { mode: 'book' });
  assert.equal(events.at(-1).type, 'plan_needs_extension');
  assert.equal(novel.status, 'paused');
  assert.deepEqual(novel.chapters.map(({ memorySummary, ...chapter }) => chapter), original);
  assert.equal(state.aiCalls.filter(call => call.kind === 'chapter').length, 0);
  assert.equal(state.aiCalls.filter(call => call.kind === 'plan').length, 2);
});

test('指定章节续写：追加已有章节内容后不误标整本完成', async () => {
  const existing = makeChapter('林舟决定把旧账本留在身边继续核对', '已有章节正文');
  const appended = makeChapter('林舟发现账本夹层里还有一张被撕去日期的车票', '已有章节续写');
  const novel = await seedNovel({
    _id: 'continue-existing-chapter',
    status: 'paused',
    targetWordCount: 10000,
    chapters: [{ chapterNumber: 1, title: '第1章', content: existing, wordCount: existing.length }],
  });
  state.chapterQueue = [appended];

  const { response, events } = await postSse(`/${novel._id}/continue-chapter/1`, {
    wordCount: 600,
    notes: '核对账本夹层的线索',
  });

  assert.equal(response.status, 200);
  assert.ok(eventIndex(events, 'chapter_start') < eventIndex(events, 'chapter_continued'));
  assert.ok(eventIndex(events, 'chapter_continued') < eventIndex(events, 'completed'));
  assert.equal(events.find((event) => event.type === 'chapter_continued').chapterNumber, 1);
  assert.equal(events.find((event) => event.type === 'chapter_continued').addedLength, appended.length);
  assert.deepEqual(novel.chapters.map((chapter) => chapter.chapterNumber), [1]);
  assert.equal(novel.chapters[0].content, existing + appended);
  assert.equal(novel.chapters[0].wordCount, existing.length + appended.length);
  assert.equal(novel.status, 'paused');
  assert.ok(novel.currentWordCount < novel.targetWordCount);
});

test('指定章节续写：创建下一章并保持连续章节号和可续写状态', async () => {
  const first = makeChapter('林舟决定带着账本离开旧邮局', '上一章正文');
  const second = makeChapter('林舟进入车站档案室并找到车票对应的值班记录', '新建第二章');
  const novel = await seedNovel({
    _id: 'continue-new-chapter',
    status: 'paused',
    targetWordCount: 10000,
    chapters: [{ chapterNumber: 1, title: '第1章', content: first, wordCount: first.length }],
  });
  state.chapterQueue = [second];

  const { response, events } = await postSse(`/${novel._id}/continue-chapter/2`, {
    wordCount: 600,
    notes: '进入车站档案室查值班记录',
  });

  assert.equal(response.status, 200);
  assert.equal(events.at(-1).type, 'completed');
  assert.deepEqual(novel.chapters.map((chapter) => chapter.chapterNumber), [1, 2]);
  assert.equal(novel.chapters[1].content, second);
  assert.equal(novel.chapters[1].wordCount, second.length);
  assert.equal(novel.status, 'paused');
  assert.ok(novel.currentWordCount < novel.targetWordCount);
});

test('chapter continuation reuses opted-in reference examples from the saved snapshot without extra model calls', async () => {
  const first = makeChapter('林舟决定带着账本离开旧邮局', '上一章正文');
  const second = makeChapter('林舟进入车站档案室并找到值班记录', '新建第二章');
  const example = '样稿标记雪松：' + '关门之前，她回头望了一眼，灯已经熄了。'.repeat(5);
  const novel = await seedNovel({ _id: 'style-example-continuation', status: 'paused', targetWordCount: 10000,
    referenceStyleSnapshot: [{ title: '已选择参考', styleProfile: '观察与动作留白', keyExcerpts: [example] }],
    chapters: [{ chapterNumber: 1, title: '第1章', content: first, wordCount: first.length }] });
  state.chapterQueue = [second];
  const { events } = await postSse(`/${novel._id}/continue-chapter/2`, { wordCount: 600 });
  assert.equal(events.at(-1).type, 'completed');
  assert.equal(state.aiCalls.filter(call => call.kind === 'chapter').length, 1);
  assert.ok(state.aiCalls.some(call => call.systemPrompt.includes('样稿标记雪松')));
  assert.equal(novel.referenceStyleSnapshot[0].keyExcerpts[0], example);
});

test('断点恢复：已完成的持久化草稿直接提交，不重复调用模型续写', async () => {
  const existing = makeChapter('林舟把旧账本带回办公室逐页核对', '断点原文');
  const durableDraft = makeChapter('林舟从夹页中找到一张没有日期的寄存单', '断点草稿');
  const novel = await seedNovel({
    _id: 'resume-complete-draft',
    status: 'paused',
    targetWordCount: 10000,
    chapters: [{ chapterNumber: 1, title: '第1章', content: existing, wordCount: existing.length }],
  });
  const job = {
    jobId: 'job-draft-complete',
    novelId: novel._id,
    kind: 'novel',
    status: 'paused',
    phase: 'paused',
    draftPhase: 'draft_complete',
    chapterNumber: 1,
    lastCommittedChapter: 0,
    draft: durableDraft,
    draftSeq: 1,
    fencingToken: 1,
    events: [],
    eventSeq: 0,
    attempt: 1,
  };
  state.jobs.set(job.jobId, job);

  const { response, events } = await postSse(`/${novel._id}/continue-chapter/1`, {
    wordCount: 600,
    notes: '提交断点草稿',
  });

  assert.equal(response.status, 200);
  assert.equal(state.aiCalls.filter((call) => call.kind === 'chapter').length, 0);
  assert.ok(events.some((event) => event.type === 'draft_restored' && event.content === durableDraft));
  assert.equal(events.at(-1).type, 'completed');
  assert.equal(novel.chapters[0].content, existing + durableDraft);
  assert.equal(job.draft, '');
  assert.equal(job.status, 'completed');
});

test('校园误判修复：复用失败的第三章草稿，不重写正文或改动前两章', async () => {
  const first = makeChapter('拓也接到班主任的社团通知', '第一章');
  const second = makeChapter('拓也带着申请表走向A班', '第二章');
  const draft = makeChapter('拓也来到校园走廊，与千鹤商量社团报名', '第三章草稿')
    + '千鹤放下笔，把申请表推回桌上，拓也只好站在门边等她重新核对条件。'.repeat(15);
  const novel = await seedNovel({
    _id: 'campus-failed-draft', status: 'paused', chapterWordTarget: 8000, targetWordCount: 1800000,
    novelTypeId: '二次元·日系校园', novelTypeName: '二次元·日系校园',
    typeSku: { channel: 'male', category: 'acg', theme: 'acg_school', tones: ['richang'], cp: 'multi' },
    outline: '拓也在校园中组建社团，与千鹤共同处理委托。',
    chapterPlanData: { chapters: [{ chapterNumber: 3, wordTarget: 8000, coreEvent: '招募千鹤',
      forbiddenDrift: ['禁止把所选标签“日系校园', '轻松日常', '多女主/后宫'] }] },
    chapters: [
      { chapterNumber: 1, title: '第一章', content: first, wordCount: first.length },
      { chapterNumber: 2, title: '第二章', content: second, wordCount: second.length },
    ],
  });
  const job = { jobId: 'campus-third-job', novelId: novel._id, kind: 'novel', status: 'failed',
    phase: 'failed', draftPhase: 'reviewing', chapterNumber: 3, lastCommittedChapter: 2,
    draft, draftSeq: 1, fencingToken: 1, events: [], eventSeq: 0, attempt: 3 };
  state.jobs.set(job.jobId, job);
  const { response, events } = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.equal(response.status, 200);
  assert.equal(events.some((event) => event.type === 'error'), false);
  assert.ok(events.some((event) => event.type === 'draft_restored' && event.content === draft));
  assert.ok(events.some((event) => event.type === 'chapter_end' && event.chapterNumber === 3));
  assert.equal(state.aiCalls.filter((call) => call.kind === 'chapter').length, 0);
  assert.deepEqual(novel.chapters.map((chapter) => chapter.content), [first, second, draft]);
  assert.equal(job.draft, '');
});

test('续写校验失败：明确返回原因，保留草稿并停止提交', async () => {
  const novel = await seedNovel({ _id: 'literal-ban-novel', status: 'paused', chapterWordTarget: 3000,
    chapterPlanData: { chapters: [{ chapterNumber: 1, wordTarget: 3000, forbiddenDrift: ['禁用词：董事会'] }] },
  });
  state.chapterQueue = [makeChapter('董事会命令林舟回收账本', '明确禁词')];
  const { events } = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.match(events.find((event) => event.type === 'error').message, /明确禁用词：董事会/);
  assert.equal(novel.chapters.length, 0);
  assert.ok([...state.jobs.values()][0].draft.includes('董事会'));
});

test('打开旧作品：修正兜底占位标题，保留手动标题和正文', async () => {
  const first = makeChapter('拓也收到班主任的社团通知', '第一章');
  const second = makeChapter('拓也带着申请表走向A班', '第二章');
  const third = makeChapter('拓也来到走廊，与千鹤商量报名', '第三章');
  const novel = await seedNovel({ _id: 'legacy-fallback-titles', status: 'paused',
    chapterPlanData: { chapters: [1, 2, 3].map((chapterNumber) => ({ chapterNumber, title: '开端之变', raw: '本地兜底计划' })) },
    storyBlueprint: { rollingPlan: { startChapter: 1, endChapter: 20, chapters: [
      { chapterNumber: 1, title: '我的灵魂已经在请假了', purpose: '引出社团新规' },
      { chapterNumber: 2, title: '被迫营业的第一天', purpose: '接受部长任命' },
    ] } },
    chapters: [
      { chapterNumber: 1, title: '第1章 开端之变', content: first, wordCount: first.length },
      { chapterNumber: 2, title: '第2章 开端之变', content: second, wordCount: second.length },
      { chapterNumber: 3, title: '第3章 我的手动标题', content: third, wordCount: third.length },
    ],
  });
  const response = await fetch(`${baseUrl}/${novel._id}`);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(data.chapters.map((chapter) => chapter.title), ['第1章 我的灵魂已经在请假了', '第2章 被迫营业的第一天', '第3章 我的手动标题']);
  assert.deepEqual(novel.chapters.map((chapter) => chapter.content), [first, second, third]);
  assert.equal(state.aiCalls.length, 0);
  const saveCount = state.saveCount;
  await fetch(`${baseUrl}/${novel._id}`);
  assert.equal(state.saveCount, saveCount); // Repair is idempotent.
  // Active works get only a repaired response, preventing a read-time save
  // from racing the chapter generation worker.
  novel.status = 'generating';
  novel.chapters[0].title = '第1章 开端之变';
  const activeResponse = await fetch(`${baseUrl}/${novel._id}`);
  const activeData = await activeResponse.json();
  assert.equal(activeData.chapters[0].title, '第1章 我的灵魂已经在请假了');
  assert.equal(novel.chapters[0].title, '第1章 开端之变');
  assert.equal(state.saveCount, saveCount);
});

test('历史重复章：详情修复完全相同的副本，生成中的读取不改写数据库', async () => {
  const rows = [1, 2, 3, 4, 5].map(number => ({ _id: `chapter-${number}`, chapterNumber: number, title: `第${number}章 保留原题`, content: `原始正文${number}`, wordCount: 5 }));
  const novel = await seedNovel({ _id: 'duplicate-chapters', status: 'generating', chapters: [...rows.slice(0, 4), clone(rows[2]), clone(rows[3]), rows[4]], currentWordCount: 35, currentChapterIndex: 5 });
  const saved = state.saveCount;
  const active = await fetch(`${baseUrl}/${novel._id}`);
  const view = await active.json();
  assert.equal(active.status, 200);
  assert.deepEqual(view.chapters.map(chapter => chapter.chapterNumber), [1, 2, 3, 4, 5]);
  assert.equal(view.currentWordCount, 25);
  assert.equal(state.saveCount, saved);
  assert.equal(novel.chapters.length, 7, 'read must not mutate an active worker snapshot');
  novel.status = 'paused';
  const paused = await fetch(`${baseUrl}/${novel._id}`);
  assert.equal(paused.status, 200);
  assert.deepEqual(novel.chapters.map(chapter => chapter.chapterNumber), [1, 2, 3, 4, 5]);
  assert.equal(novel.currentWordCount, 25);
  assert.equal(novel.currentChapterIndex, 5);
  assert.deepEqual(novel.chapters.map(chapter => chapter.content), rows.map(chapter => chapter.content));
  const after = state.saveCount;
  await fetch(`${baseUrl}/${novel._id}`);
  assert.equal(state.saveCount, after, 'repair must be idempotent');
});

test('正文空输出：不保存空章，作品暂停并返回错误事件', async () => {
  state.chapterQueue = [''];

  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia',
    protagonistName: '林舟',
    targetWordCount: 3000,
    mode: 'chapter',
  });

  assert.equal(response.status, 200);
  assert.ok(eventIndex(events, 'chapter_start') > eventIndex(events, 'novel_created'));
  assert.ok(eventIndex(events, 'error') > eventIndex(events, 'chapter_start'));
  assert.equal(eventIndex(events, 'chapter_end'), -1);
  assert.equal(eventIndex(events, 'completed'), -1);
  const novel = getCreatedNovel(events);
  assert.equal(novel.status, 'paused');
  assert.equal(novel.chapters.length, 0);
  assert.equal(novel.currentWordCount, 0);
});

test('重复章保护：异常重试不能覆盖或追加相同章节号', async () => {
  const existing = makeChapter('林舟决定保留旧版本第一章', '原始第一章');
  state.nextNovelDefaults = {
    chapters: [{ chapterNumber: 1, title: '第1章', content: existing, wordCount: existing.length }],
    currentWordCount: existing.length,
    currentChapterIndex: 1,
  };
  state.chapterQueue = [makeChapter('林舟决定生成一个冲突的第一章', '冲突第一章')];

  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia',
    protagonistName: '林舟',
    targetWordCount: 3000,
    mode: 'chapter',
  });

  assert.equal(response.status, 200);
  const novel = getCreatedNovel(events);
  assert.equal(novel.status, 'paused');
  assert.equal(novel.chapters.length, 1);
  assert.equal(novel.chapters[0].content, existing);
  assert.equal(eventIndex(events, 'chapter_end'), -1);
  assert.ok(eventIndex(events, 'error') > eventIndex(events, 'chapter_start'));
});

test('主动暂停：中断 AI 信号、阻止并发续写，并允许之后重新续写', async () => {
  const first = makeChapter('林舟决定先封存第一章的证据', '暂停前状态');
  const planData = JSON.parse(makePlan([
    { chapterNumber: 1, wordTarget: 600, coreEvent: '封存证据' },
    { chapterNumber: 2, wordTarget: 600, coreEvent: '重新检查证据' },
  ]));
  const novel = await seedNovel({
    _id: 'pause-flow',
    status: 'paused',
    targetWordCount: 2000,
    chapters: [{ chapterNumber: 1, title: '第1章', content: first, wordCount: first.length }],
    chapterPlan: JSON.stringify(planData),
    chapterPlanData: planData,
  });

  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  state.aiHandler = async (call) => {
    assert.equal(call.kind, 'chapter');
    call.onChunk('林舟开始重新检查证据，但这一分片不会被保存。');
    markStarted();
    await new Promise((resolve, reject) => {
      const stop = () => reject(abortError());
      if (call.signal.aborted) return stop();
      call.signal.addEventListener('abort', stop, { once: true });
    });
  };

  const generationFetch = fetch(`${baseUrl}/continue/${novel._id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer isolated' },
    body: JSON.stringify({ mode: 'book' }),
  });
  await started;

  const conflict = await fetch(`${baseUrl}/continue/${novel._id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer isolated' },
    body: JSON.stringify({ mode: 'chapter' }),
  });
  assert.equal(conflict.status, 409);
  assert.match((await conflict.json()).message, /正在生成/);

  const pauseResponse = await fetch(`${baseUrl}/pause/${novel._id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer isolated' },
    body: '{}',
  });
  assert.equal(pauseResponse.status, 200);

  const generationResponse = await generationFetch;
  const pausedEvents = parseSse(await generationResponse.text());
  assert.equal(pausedEvents.at(-1).type, 'paused');
  assert.equal(novel.status, 'paused');
  assert.deepEqual(novel.chapters.map((chapter) => chapter.chapterNumber), [1]);
  const pausedJob = [...state.jobs.values()].find((job) => String(job.novelId) === String(novel._id));
  assert.equal(pausedJob.status, 'paused');
  assert.match(pausedJob.draft, /开始重新检查证据/);
  assert.equal(pausedJob.chapterNumber, 2);

  state.aiHandler = null;
  state.chapterQueue = [makeChapter('林舟重新检查证据并决定继续追查', '暂停后续写')];
  const resumed = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.events.at(-1).type, 'completed');
  assert.ok(resumed.events.some((event) => event.type === 'draft_restored' && /开始重新检查证据/.test(event.content)));
  assert.deepEqual(novel.chapters.map((chapter) => chapter.chapterNumber), [1, 2]);
  assert.match(novel.chapters[1].content, /开始重新检查证据/);
  assert.equal(pausedJob.draft, '');
  assert.equal(pausedJob.status, 'completed');
  assert.equal(novel.status, 'paused');
});

test('token 账本：每章把服务商口径用量写进 qualityReport.tokens，整本累计进 novel.tokenUsage', async () => {
  state.planContent = makePlan([
    { chapterNumber: 1, wordTarget: 600, coreEvent: '收到匿名来信' },
    { chapterNumber: 2, wordTarget: 600, coreEvent: '调查旧码头' },
  ]);
  const first = makeChapter('林舟收到匿名来信并决定追查旧案', 'token账本一');
  const second = makeChapter('林舟在旧码头发现新的证据', 'token账本二');
  state.chapterQueue = [first, second];

  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia',
    protagonistName: '林舟',
    targetWordCount: 1200,
    outline: '林舟追查旧案并完成收束。',
    mode: 'book',
  });

  assert.equal(response.status, 200);
  const novel = getCreatedNovel(events);
  assert.equal(novel.chapters.length, 2);

  // 每章的 qualityReport.tokens：服务商口径优先（prompt_tokens 而非本地估算）。
  for (const chapter of novel.chapters) {
    const tokens = chapter.qualityReport?.tokens;
    assert.ok(tokens, `第${chapter.chapterNumber}章缺少 qualityReport.tokens`);
    assert.equal(tokens.byRole.writing.inputTokens, chapter.content.length * 2 + 100);
    assert.equal(tokens.byRole.writing.outputTokens, chapter.content.length);
    assert.equal(tokens.byRole.writing.cacheSavedTokens, chapter.content.length);
    assert.equal(tokens.byRole.writing.calls, 1);
    // 合计 = 各角色之和
    assert.equal(tokens.byRole.reasoning.calls, 1);
    assert.equal(tokens.inputTokens, tokens.byRole.writing.inputTokens + tokens.byRole.reasoning.inputTokens);
  }

  // 整本累计：两章 writing 调用 + 计划/大纲等其它角色调用都计入 novel.tokenUsage。
  const ledger = novel.tokenUsage;
  assert.ok(ledger.calls >= 2);
  assert.equal(ledger.byRole.writing.calls, 2);
  assert.equal(
    ledger.byRole.writing.inputTokens,
    novel.chapters.reduce((sum, chapter) => sum + chapter.qualityReport.tokens.byRole.writing.inputTokens, 0),
  );
  assert.equal(ledger.inputTokens >= ledger.byRole.writing.inputTokens, true);

  // SSE 必须持续披露 token_usage 事件，前端据此显示累计消耗。
  const tokenEvents = events.filter((event) => event.type === 'token_usage');
  assert.ok(tokenEvents.length >= 2);
  assert.ok(tokenEvents.every((event) => event.usage && event.usage.inputTokens > 0));
});

test('记忆整理失败不打断跨章生成，下一章自动补齐且不重写已提交正文', async () => {
  state.planContent = makePlan([
    { chapterNumber: 1, title: '取得原件', coreEvent: '林舟取得原始签收单并交给苏晚保管。', wordTarget: 600 },
    { chapterNumber: 2, title: '查明责任', coreEvent: '林舟核对签名并找到责任人。', wordTarget: 600 },
  ]);
  const first = makeChapter('林舟取得原始签收单并交给苏晚保管', '语义记忆断点');
  state.chapterQueue = [first, makeChapter('林舟核对签名并找到责任人', '恢复记忆后第二章')];
  state.memoryHandler = async call => {
    if (state.memoryCalls.length === 1) {
      assert.equal(call.signal.aborted, false);
      throw abortError();
    }
    state.memoryHandler = null;
    const source = call.userPrompt.split('【正文开始】\n')[1].split('\n【正文结束】')[0];
    return emitText(JSON.stringify({ summary: '本章实际发生事件及结果：' + source.slice(0, 100),
      events: [{ text: '林舟保留签收单并继续调查', evidence: source.slice(0, 80) }], facts: [], characters: [], openLoops: [], resolvedLoops: [] }), null, call.signal);
  };
  const { events } = await postSse('/generate', { novelTypeId: 'xianxia', outline: '林舟核对签收原件，明确责任。', protagonistName: '林舟', targetWordCount: 1200, mode: 'book' });
  const book = getCreatedNovel(events);
  assert.equal(book.status, 'completed');
  assert.equal(events.at(-1).type, 'completed');
  assert.equal(book.chapters.length, 2);
  assert.ok(events.some(event => event.type === 'status' && /记忆整理暂不可用/.test(event.message)));
  assert.equal(state.aiCalls.filter(call => call.kind === 'chapter').length, 2);
  assert.equal(state.memoryCalls.length, 3);
  assert.equal(book.chapters[0].content, first);
  assert.ok(book.chapters.every(chapter => chapter.memorySummary?.sourceHash));
  const secondCall = state.aiCalls.filter(call => call.kind === 'chapter')[1];
  assert.match(secondCall.userPrompt, /已保存正文摘录/);
  assert.match(secondCall.userPrompt, /语义记忆断点/);
});

test('旧书继续前补齐逐章总结与阶段记忆，正文提示词使用两层记忆', async () => {
  const chapters = Array.from({ length: 7 }, (_, index) => ({ chapterNumber: index + 1, title: `第${index + 1}章 旧章`, content: makeChapter(`林舟核对第${index + 1}份签收证据`, `旧章${index + 1}`), wordCount: 680 }));
  const planData = JSON.parse(makePlan([...chapters.map(chapter => ({ chapterNumber: chapter.chapterNumber, title: chapter.title, coreEvent: `核对证据${chapter.chapterNumber}`, wordTarget: 600 })), { chapterNumber: 8, title: '对质', coreEvent: '林舟拿到签收单与外包负责人当面对质。', wordTarget: 600 }]));
  const book = await seedNovel({ _id: 'semantic-legacy-upgrade', status: 'paused', targetWordCount: 5400, chapters, outline: '查明签收责任。', chapterPlanData: planData, chapterPlan: JSON.stringify(planData) });
  state.chapterQueue = [makeChapter('林舟拿签收单与负责人当面对质', '新章8')];
  const { events } = await postSse(`/continue/${book._id}`, { mode: 'chapter' });
  assert.equal(events.at(-1).type, 'completed');
  assert.ok(book.chapters.every(chapter => chapter.memorySummary?.version === 2));
  assert.equal(book.contextMemory.checkpointChapter, 6);
  assert.equal(state.memoryCalls.filter(call => call.options.taskType === 'stage_memory').length, 1);
  // The fixture's legacy buildContinuePrompt is deliberately a stub; direct
  // context compilation below exercises the actual two-layer prompt builder.
  const execution = require('../services/novelContext').compileChapterExecutionPackage({ chapters: book.chapters, contextMemory: book.contextMemory, currentChapter: 9 });
  assert.match(execution.stableContext, /截至第6章/);
  assert.match(execution.dynamicContext, /第7章/);
  assert.match(execution.dynamicContext, /第8章/);
  assert.ok(book.tokenUsage.byRole.reasoning.calls >= 9);
});

test('指定章节正文已提交后总结失败不伪报追加失败，下次仍以已保存正文续写', async () => {
  const original = makeChapter('林舟找到签收单', '单章追加原文');
  const book = await seedNovel({ _id: 'append-memory-pending', status: 'paused', targetWordCount: 20000,
    chapters: [{ chapterNumber: 1, title: '第1章 原件', content: original, wordCount: original.length }] });
  state.chapterQueue = [makeChapter('林舟找到原件背面的签名', '本次追加')];
  state.memoryHandler = async call => {
    if (book.chapters[0].content !== original) return emitText('not json', null, call.signal);
    const source = call.userPrompt.split('【正文开始】\n')[1].split('\n【正文结束】')[0];
    return emitText(JSON.stringify({ summary: '林舟在原件核对过程中取得签收单，决定继续查验其真实性及关联责任人。', events: [{ text: '林舟取得签收单', evidence: source.slice(0, 100) }], facts: [], characters: [], openLoops: [], resolvedLoops: [] }), null, call.signal);
  };
  const result = await postSse(`/${book._id}/continue-chapter/1`, { wordCount: 600, notes: '核对签名' });
  assert.equal(result.events.at(-1).type, 'completed');
  assert.ok(result.events.some(event => event.type === 'status' && event.message.includes('下次续写前会自动补齐')));
  assert.ok(book.chapters[0].content.length > original.length);
  const before = book.chapters[0].content;
  state.chapterQueue = [makeChapter('签名对应的负责人到场对质', '第二次追加')];
  state.memoryHandler = async () => ({ content: 'invalid' });
  const next = await postSse(`/${book._id}/continue-chapter/1`, { wordCount: 600, notes: '负责人到场' });
  assert.equal(next.events.at(-1).type, 'completed');
  assert.ok(book.chapters[0].content.startsWith(before));
  assert.equal(state.aiCalls.filter(call => call.kind === 'chapter').length, 2);
  assert.match(state.aiCalls.filter(call => call.kind === 'chapter')[1].userPrompt, /已保存正文摘录/);
});

test('记忆接口失败时已返回的服务商用量仍记入整本账本', async () => {
  state.planContent = makePlan([{ chapterNumber: 1, title: '取得原件', coreEvent: '林舟取得原始签收单并保留证据。', wordTarget: 600 }]);
  state.chapterQueue = [makeChapter('林舟取得原始签收单并保留证据', '失败用量')];
  state.memoryHandler = async () => {
    throw Object.assign(new Error('isolated memory provider failure'), { usage: { prompt_tokens: 137, completion_tokens: 19 } });
  };
  const { events } = await postSse('/generate', { novelTypeId: 'xianxia', outline: '查明签收责任。', targetWordCount: 600, mode: 'book' });
  const book = getCreatedNovel(events);
  assert.equal(book.status, 'completed');
  assert.equal(book.chapters.length, 1);
  assert.ok(book.tokenUsage.byRole.reasoning.inputTokens >= 137);
  assert.equal(book.chapters[0].qualityReport.tokens.byRole.reasoning.inputTokens, 137);
});

test('开始创作：短篇只返回一章计划时自动补足并连续写完，而非第一章后暂停', async () => {
  state.planContent = makePlan([{ chapterNumber: 1, title: '收到来信', coreEvent: '林舟收到匿名来信并决定追查失踪证人。', wordTarget: 1200 }]);
  state.chapterQueue = [makeChapter('林舟收到匿名来信并决定追查失踪证人', '第一章').repeat(2), makeChapter('林舟核对码头记录并找到证人', '第二章').repeat(2)];
  const { events } = await postSse('/generate', { novelTypeId: 'xianxia', outline: '林舟追查来信来源，在码头找到证人。',
    targetWordCount: 2300, chapterWordTarget: 2000, mode: 'book' });
  const book = getCreatedNovel(events);
  assert.equal(events.at(-1).type, 'completed');
  assert.equal(book.status, 'completed');
  assert.deepEqual(book.chapters.map(c => c.chapterNumber), [1, 2]);
  assert.ok(events.some(e => e.type === 'status' && /自动扩展/.test(e.message)));
  assert.equal(book.chapterPlanData.chapters[0].coreEvent, '林舟收到匿名来信并决定追查失踪证人。');
});

test('章节实际字数偏短：执行完计划后自动补充，达到目标后停止', async () => {
  state.planContent = makePlan([{ chapterNumber: 1, title: '收到来信', coreEvent: '林舟收到匿名来信并决定追查。', wordTarget: 3000 }]);
  state.chapterQueue = [makeChapter('林舟收到匿名来信并决定追查', '不足目标首章'), makeChapter('林舟核对线索并找到证人', '自动补充第二章')];
  const { events } = await postSse('/generate', { novelTypeId: 'xianxia', outline: '调查匿名来信并核对真相。', targetWordCount: 1200, mode: 'book' });
  const book = getCreatedNovel(events);
  assert.equal(events.at(-1).type, 'completed');
  assert.deepEqual(book.chapters.map(c => c.chapterNumber), [1, 2]);
  assert.ok(events.some(e => e.type === 'status' && /按实际章节字数自动补充/.test(e.message)));
  assert.equal(state.aiCalls.filter(c => c.kind === 'chapter').length, 2);
});

test('真实 HTTP 正文流提前关闭：整本生成恢复时去掉重发草稿，下一章从独立偏移开始', async t => {
  const content = makeChapter('林舟拿到原件并决定核对签名', '自动断点续接');
  const next = makeChapter('苏晚走进车站，把寄存单换成出站记录', '月台调查');
  state.planContent = makePlan([
    { chapterNumber: 1, wordTarget: 600, coreEvent: '核对签名' },
    { chapterNumber: 2, wordTarget: 600, coreEvent: '调查出站记录' },
  ]);
  const http = require('node:http');
  let requests = 0;
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const round = ++requests;
      const chunks = round === 1 ? [content.slice(0, 330)]
        : round === 2 ? [content.slice(0, 200), content.slice(200)] : [next];
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const text of chunks) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      }
      if (round > 1) res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  let writes = 0;
  state.aiHandler = async call => {
    if (call.kind !== 'chapter') return defaultAiHandler(call);
    writes++;
    if (writes === 2) {
      assert.match(call.userPrompt, /【断点续写】/);
      assert.ok(call.userPrompt.includes(content.slice(0, 330)));
      assert.ok([...state.jobs.values()].some(job => job.draft === content.slice(0, 330)));
    }
    if (writes === 3) assert.doesNotMatch(call.userPrompt, /【断点续写】/);
    return realAiService.streamGenerate(call.systemPrompt, call.userPrompt, call.onChunk, call.signal,
      { baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'chapter-test', disableThinking: true },
      0, call.temperature, call.maxTokens, 10000, call.onReasoning, call.options);
  };
  const { events } = await postSse('/generate', { novelTypeId: 'xianxia', targetWordCount: 1200,
    mode: 'book', outline: '林舟调查失踪案并核对签名，苏晚从车站找到新的证词。', enableResearch: false });
  const book = getCreatedNovel(events);
  assert.equal(events.at(-1).type, 'completed', events.at(-1).message);
  assert.deepEqual(book.chapters.map(chapter => chapter.content), [content, next]);
  const first = events.filter(e => e.type === 'content' && e.chapterNumber === 1);
  const second = events.filter(e => e.type === 'content' && e.chapterNumber === 2);
  assert.equal(first.map(e => e.content).join(''), content);
  assert.equal(first[1].offset, 330);
  assert.equal(second[0].offset, 0);
  assert.equal(second.map(e => e.content).join(''), next);
  assert.deepEqual(events.filter(e => e.type === 'chapter_end').map(e => e.content), [content, next]);
  assert.equal(writes, 3);
  assert.ok(events.some(e => e.type === 'status' && /从断点自动续接/.test(e.message)));
  assert.ok(book.tokenUsage.byRole.writing.calls >= 3);
});

test('记忆持久化失败必须停止，不能误当附加模型失败继续下一章', async () => {
  state.planContent = makePlan([{ chapterNumber: 1, title: '来信', coreEvent: '林舟收到来信。', wordTarget: 600 },
    { chapterNumber: 2, title: '调查', coreEvent: '林舟找到证人。', wordTarget: 600 }]);
  state.chapterQueue = [makeChapter('林舟收到来信', '保存失败首章')];
  state.memoryHandler = async call => {
    state.saveFailureAt = state.saveCount + 1;
    const source = call.userPrompt.split('【正文开始】\n')[1].split('\n【正文结束】')[0];
    return emitText(JSON.stringify({ summary: '林舟收到匿名来信后决定采取行动并继续追查失踪证人，原件被妥善保留。',
      events: [{ text: '林舟收到来信', evidence: source.slice(0, 60) }] }), null, call.signal);
  };
  const { events } = await postSse('/generate', { novelTypeId: 'xianxia', outline: '调查失踪证人。', targetWordCount: 1200, mode: 'book' });
  assert.equal(getCreatedNovel(events).status, 'paused');
  assert.equal(state.aiCalls.filter(c => c.kind === 'chapter').length, 1);
  assert.equal(events.at(-1).type, 'error');
});

test('整本生成：每章字数设置贯穿大纲/计划提示词并落库', async () => {
  // 大章设定：50 万字每章 1 万字 → 章节计划提示词按 50 章规划、
  // 每章输出预算放大、小说字段持久化。buildChapterPlan 用的是真实实现
  // （在模块加载时注入 mock 导出，端到端验证参数传递）。
  state.planContent = makePlan([
    { chapterNumber: 1, wordTarget: 9800, coreEvent: '收到匿名委托并勘察案发现场' },
  ]);
  state.chapterQueue = [makeChapter('林舟勘察案发现场并发现矛盾线索', '每章字数一')];

  const { response, events } = await postSse('/generate', {
    novelTypeId: 'xianxia',
    protagonistName: '林舟',
    worldSetting: '维多利亚时代的连环悬案',
    targetWordCount: 500000,
    chapterWordTarget: 10000,
    outline: '林舟受托调查连环悬案，在证据矛盾中逼近真凶并完成收束。',
    mode: 'book',
  });

  assert.equal(response.status, 200);
  const novel = getCreatedNovel(events);
  // 设定持久化到小说字段，续写/兜底计划都能沿用。
  assert.equal(novel.chapterWordTarget, 10000);

  // 大纲/计划提示词按每章 1 万字估算章数。
  const planCall = state.aiCalls.find((call) => call.kind === 'plan');
  assert.ok(planCall, '缺少章节计划调用');
  assert.match(planCall.userPrompt, /预计50章（每章约10000字）/);
  assert.match(planCall.userPrompt, /每章目标字数 6700-14000/);
  // 大章模式必须包含完整信息链的节奏指导。
  assert.match(planCall.userPrompt, /属于大章/);
  // 章节正文的输出预算必须按 1 万字目标放大（约 1.35 万 token）。
  const chapterCall = state.aiCalls.find((call) => call.kind === 'chapter');
  assert.ok(chapterCall, '缺少正文调用');
  assert.ok(chapterCall.maxTokens >= 13000, `大章输出预算被截断：${chapterCall.maxTokens}`);
});

test('续写单章：新章节同样落库 token 标注', async () => {
  const first = makeChapter('林舟决定保存匿名来信并前往旧码头', 'token续写一');
  const second = makeChapter('林舟发现旧码头的值班表被人替换', 'token续写二');
  const planData = JSON.parse(makePlan([
    { chapterNumber: 1, wordTarget: 600, coreEvent: '收到匿名来信' },
    { chapterNumber: 2, wordTarget: 600, coreEvent: '调查旧码头值班表' },
  ]));
  const novel = await seedNovel({
    _id: 'continue-token',
    status: 'paused',
    targetWordCount: 4000,
    protagonistName: '林舟',
    chapters: [{ chapterNumber: 1, title: '第1章', content: first, wordCount: first.length, qualityReport: {} }],
    chapterPlan: JSON.stringify(planData),
    chapterPlanData: planData,
  });
  state.chapterQueue = [second];

  const { response } = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.equal(response.status, 200);
  assert.equal(novel.chapters.length, 2);

  const tokens = novel.chapters[1].qualityReport?.tokens;
  assert.ok(tokens, '续写章节缺少 qualityReport.tokens');
  assert.equal(tokens.byRole.writing.inputTokens, second.length * 2 + 100);
  assert.equal(tokens.byRole.reasoning.calls, 1);
  assert.equal(tokens.byRole.writing.calls, 1);
});

// ===== SKU（番茄式多选类型）与旧类型模板池的边界 =====

test('SKU 书：类型解析结果（关键词/契约/基调）进入提示词，且不注入旧的男频模板池', async () => {
  const content = makeChapter('苍太在文艺部室门口撞见抱着纸箱的部长', 'SKU回归');
  state.chapterQueue = [content];

  const { response, events } = await postSse('/generate', {
    novelTypeId: '二次元·日系校园',
    typeSku: { channel: 'male', category: 'acg', theme: 'acg_school', tones: ['gaoxiao'] },
    protagonistName: '苍太',
    worldSetting: '日系校园，文艺部与学园祭',
    targetWordCount: 3000,
    mode: 'chapter',
  });

  assert.equal(response.status, 200);
  assert.ok(eventIndex(events, 'completed') > -1);

  // 1) 解析后的类型（含 contract / toneContract / keywords）确实传给了提示词构建
  const args = state.lastSystemPromptArgs;
  assert.ok(args && args.resolvedType, '系统提示未收到解析后的类型');
  assert.equal(args.resolvedType.name, '二次元·日系校园');
  assert.equal(args.resolvedType.contract, 'acgn');
  assert.match(args.resolvedType.keywords, /日系校园/);
  assert.match(args.resolvedType.toneContract, /搞笑\/无厘头/);

  // 2) SKU 书不得再注入旧的类型模板池（它就是"选二次元却写出男频爽文"的来源）
  const allPrompts = state.aiCalls.map((call) => call.systemPrompt).join('\n');
  assert.doesNotMatch(allPrompts, /【类型模板参考/);
  assert.doesNotMatch(allPrompts, /TEMPLATE_POOL/);

  // 3) typeSku 落库，续写时能还原同一套类型上下文
  const novel = getCreatedNovel(events);
  assert.deepEqual(novel.typeSku, { channel: 'male', category: 'acg', theme: 'acg_school', tones: ['gaoxiao'] });
});

test('旧路径（无 typeSku）：类型模板池照旧注入，行为不回归', async () => {
  const content = makeChapter('林舟在旧城邮局找到被替换的值班表', '旧路径');
  state.chapterQueue = [content];

  const { response } = await postSse('/generate', {
    novelTypeId: '二次元',
    protagonistName: '林舟',
    worldSetting: '日系校园，社团活动',
    targetWordCount: 3000,
    mode: 'chapter',
  });

  assert.equal(response.status, 200);
  const allPrompts = state.aiCalls.map((call) => call.systemPrompt).join('\n');
  assert.match(allPrompts, /【类型模板参考（男频 · 二次元/);
});

test('match-templates 预览与注入保持一致：SKU 书返回空列表', async () => {
  const skuPreview = await fetch(`${baseUrl}/match-templates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer isolated' },
    body: JSON.stringify({
      worldSetting: '日系校园，社团活动',
      novelTypeId: '二次元·日系校园',
      typeSku: { channel: 'male', category: 'acg', theme: 'acg_school' },
    }),
  });
  const skuBody = await skuPreview.json();
  assert.deepEqual(skuBody.matched, []);
  assert.equal(skuBody.skuBased, true);

  const legacyPreview = await fetch(`${baseUrl}/match-templates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer isolated' },
    body: JSON.stringify({ worldSetting: '日系校园，社团活动', novelTypeId: '二次元' }),
  });
  const legacyBody = await legacyPreview.json();
  assert.ok(legacyBody.matched.length > 0, '旧路径仍应给出模板预览');
});
