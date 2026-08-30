const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const serverRoot = path.resolve(__dirname, '..');

const state = {
  novels: new Map(),
  nextNovelId: 1,
  nextNovelDefaults: null,
  chapterQueue: [],
  planContent: '',
  outlineContent: '隔离测试大纲',
  aiHandler: null,
  aiCalls: [],
};

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function resetState() {
  state.novels.clear();
  state.nextNovelId = 1;
  state.nextNovelDefaults = null;
  state.chapterQueue = [];
  state.planContent = '';
  state.outlineContent = '隔离测试大纲';
  state.aiHandler = null;
  state.aiCalls = [];
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
    state.novels.set(String(this._id), this);
    return this;
  }

  markModified() {}

  toObject() {
    return clone(this);
  }

  static async findOne(query = {}) {
    const novel = state.novels.get(String(query._id));
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
  buildSystemPrompt: (type) => `SYSTEM:${type}`,
  buildInitialPrompt: () => 'INITIAL_PROMPT',
  buildContinuePrompt: () => 'CONTINUE_PROMPT',
  buildImportContinuePrompt: () => 'IMPORT_CONTINUE_PROMPT',
  buildOutlinePrompt: () => 'OUTLINE_PROMPT',
  // 章节计划提示词直接用真实实现：它是纯字符串构建函数（无 IO），
  // 每章字数等参数只有经过它才能被端到端验证。
  buildChapterPlan: realAiService.buildChapterPlan,
  buildStoryStateSummary: () => '',
  buildOptimizeAnalysisPrompt: () => '',
  buildOptimizeChapterPrompt: () => '',
  normalizeChapterWordTarget: realAiService.normalizeChapterWordTarget,
  extractChapterSummary: (content) => String(content || '').slice(-120),
  resolveApiConfig: () => ({ provider: 'isolated-test' }),
  countTokens: (content) => String(content || '').length,
  humanizeRewrite: (content) => content,
  getFriendlyErrorMessage: (error) => error?.message || 'mock error',
  streamGenerate: async (systemPrompt, userPrompt, onChunk, signal, apiConfig, retries, temperature, maxTokens, timeoutMs) => {
    const call = { systemPrompt, userPrompt, onChunk, signal, apiConfig, retries, temperature, maxTokens, timeoutMs };
    call.kind = onChunk ? 'chapter' : (systemPrompt.includes('章节规划师') ? 'plan' : (systemPrompt.includes('大纲策划师') ? 'outline' : 'other'));
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
mockModule('services/chapterToolchain.js', {
  processChapter: (text) => ({ text, report: { isolated: true } }),
});
mockModule('services/editorialEngine.js', {
  runEditorialPipeline: async () => ({ content: '' }),
  STAGES: [],
});
mockModule('config/novelTemplates.js', {
  typeTemplates: [],
  buildTemplatePrompt: () => '',
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

function getCreatedNovel(events) {
  const created = events.find((event) => event.type === 'novel_created');
  assert.ok(created, '缺少 novel_created 事件');
  const novel = state.novels.get(String(created.novelId));
  assert.ok(novel, '内存数据库中缺少新建小说');
  return novel;
}

test('新书单章：SSE、正文、质量状态和创作状态完整落库', async () => {
  const content = makeChapter('林舟决定在雨停前进入旧邮局寻找失踪证人的登记簿', '雨夜邮局');
  state.chapterQueue = [content];

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
  assert.equal(events.find((event) => event.type === 'chapter_start').title, novel.chapters[0].title);
  assert.equal(typeof novel.chapters[0].qualityReport.score, 'number');
  assert.deepEqual(novel.chapters[0].qualityReport.toolchain, { isolated: true });
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
  assert.equal(state.aiCalls.filter((call) => call.onChunk).length, 1);
  assert.equal(state.aiCalls.filter((call) => !call.onChunk).length, 1);
  assert.match(state.aiCalls.at(-1).userPrompt, /连续性与叙事质量审稿专家/);
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

  const novel = getCreatedNovel(events);
  assert.equal(novel.status, 'completed');
  assert.deepEqual(novel.chapterPlanData.chapters.map((chapter) => chapter.chapterNumber), [1, 2]);
  assert.deepEqual(novel.chapters.map((chapter) => chapter.chapterNumber), [1, 2]);
  assert.equal(novel.currentChapterIndex, 2);
  assert.equal(novel.foreshadowingLedger.length, 1);
  assert.equal(novel.foreshadowingLedger[0].status, 'resolved');
  assert.equal(novel.foreshadowingLedger[0].resolvedChapter, 2);
  assert.deepEqual(state.aiCalls.map((call) => call.kind), ['plan', 'chapter', 'chapter']);
  assert.match(state.aiCalls[2].userPrompt, /本章应回收伏笔：铜钥匙上的裂纹/);
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

test('新书长篇：大纲存在但计划不可解析时自动补全执行计划', async () => {
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
  assert.ok(state.aiCalls.some((call) => call.kind === 'chapter'));
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
    { chapterNumber: 2, wordTarget: 600, coreEvent: '调查旧码头值班表' },
    { chapterNumber: 3, wordTarget: 600, coreEvent: '带走值班表并撤离' },
  ]));
  const novel = await seedNovel({
    _id: 'continue-single',
    status: 'paused',
    targetWordCount: 4000,
    protagonistName: '林舟',
    chapters: [{ chapterNumber: 1, title: '第1章', content: first, wordCount: first.length }],
    chapterPlan: JSON.stringify(planData),
    chapterPlanData: planData,
  });
  state.chapterQueue = [second, third];

  const firstRun = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.equal(firstRun.response.status, 200);
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
  assert.deepEqual(state.aiCalls.map((call) => call.kind), ['chapter', 'chapter']);
  assert.ok(eventIndex(events, 'chapter_end', (event) => event.chapterNumber === 2) < eventIndex(events, 'chapter_start', (event) => event.chapterNumber === 3));
  assert.ok(eventIndex(events, 'chapter_end', (event) => event.chapterNumber === 3) < eventIndex(events, 'completed'));
});

test('续写整本：缺少计划或计划已耗尽时均暂停并请求扩展', async (t) => {
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

    const { response, events } = await postSse(`/continue/${novel._id}`, { mode: 'book' });
    assert.equal(response.status, 200);
    assert.equal(events.at(-1).type, 'plan_needs_extension');
    assert.equal(novel.status, 'paused');
    assert.equal(novel.chapters.length, 1);
    assert.equal(state.aiCalls.length, 0);
  });
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

  state.aiHandler = null;
  state.chapterQueue = [makeChapter('林舟重新检查证据并决定继续追查', '暂停后续写')];
  const resumed = await postSse(`/continue/${novel._id}`, { mode: 'chapter' });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.events.at(-1).type, 'completed');
  assert.deepEqual(novel.chapters.map((chapter) => chapter.chapterNumber), [1, 2]);
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
    assert.equal(tokens.inputTokens, chapter.content.length * 2 + 100);
    assert.equal(tokens.outputTokens, chapter.content.length);
    assert.equal(tokens.cacheSavedTokens, chapter.content.length);
    assert.equal(tokens.byRole.writing.calls, 1);
    // 合计 = 各角色之和
    assert.equal(tokens.inputTokens, tokens.byRole.writing.inputTokens);
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
  assert.equal(tokens.inputTokens, second.length * 2 + 100);
  assert.equal(tokens.byRole.writing.calls, 1);
});
