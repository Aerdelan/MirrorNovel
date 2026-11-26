const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');
const { parseArgs } = require('node:util');
const { setTimeout: wait } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const apiBase = 'https://ai.space.opencsg.com/v1';
const model = 'qwen3.8-flash';
const args = parseArgs({ options: {
  out: { type: 'string', default: path.join(__dirname, 'live-book-100') },
  input: { type: 'string' },
  'ending-insert': { type: 'string' },
  'max-resumes': { type: 'string', default: '2' },
  'local-check': { type: 'boolean' },
  'trace-blueprint': { type: 'boolean' },
  'trace-progress': { type: 'boolean' },
} }).values;
const out = path.resolve(args.out);
const checkpointPath = path.join(out, 'checkpoint.json');
const maxResumes = Number(args['max-resumes']);

const defaultInput = {
  novelTypeId: 'lightnovel_fantasy',
  protagonistName: '林见夏',
  worldSetting: '故事暂名《借来的明天》。末日后的环城电车能给幸存者延迟黎明，持灯少女用一段共同记忆换一小时安全。修灯学徒林见夏发现居民被篡改为“从未住过”，与队友追查谁把市民记忆挪作净水配额。前期确立选择与代价，中期完成调查、代价与反转，尾段逐个收回重大线索。四个贯穿线索为票背双孔、空户籍编号、队友哼错的旋律和逆走水表，分别安排不同的揭晓节点；请控制其他贯穿性悬念数量。终局拆除单方抹名权、保住净水供给，公开归还居民名单，写清队友和主角如何生活下去。本书在指定终章收束，无需为续集保留重大悬念。',
  targetChapterCount: 100,
  targetWordCount: 150000,
  chapterWordTarget: 2000,
  mode: 'book',
  enableResearch: false,
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function endingReviewDebt(message) {
  return Number(/^终章尚未核实回收 (\d+) 条伏笔/.exec(message || '')?.[1]) || Infinity;
}

function wireRouter(credential, onModelCall) {
  const testPath = path.join(root, 'server/tests/novelGeneration.integration.test.js');
  const source = fs.readFileSync(testPath, 'utf8');
  const end = source.indexOf("const novelRouter = require('../routes/novel');");
  if (end < 0) throw new Error('无法定位隔离路由测试夹具');
  const harness = new Module(testPath, module);
  harness.filename = testPath;
  harness.paths = Module._nodeModulePaths(path.dirname(testPath));
  harness._compile(source.slice(0, end) + `
module.exports = { state, InMemoryNovel, generationJobMock, realAiService, mockModule, express,
  loadRouter() { return require('../routes/novel'); } };
`, testPath);
  const fixture = harness.exports;
  const config = { provider: 'cloud', cloudBaseUrl: apiBase, cloudApiKey: credential, cloudWritingModel: model };
  const { runWithRequestContext } = require(path.join(root, 'server/services/requestContext.js'));
  fixture.mockModule('middleware/auth.js', (req, _res, next) => {
    req.userId = 'user-1';
    req.user = { _id: req.userId, id: req.userId, nickname: '隔离实跑', tokens: { total: 100000000, used: 0 } };
    req.userModelConfig = config;
    return runWithRequestContext({ userModelConfig: config }, next);
  });
  for (const file of ['services/chapterToolchain.js', 'services/editorialEngine.js', 'config/novelTemplates.js']) {
    delete require.cache[require.resolve(path.join(root, 'server', file))];
  }
  const real = fixture.realAiService;
  function assertRemote(apiConfig) {
    if (!credential || apiConfig?.baseUrl !== apiBase || apiConfig?.model !== model || apiConfig?.apiKey !== credential) {
      throw new Error('测试只允许调用指定的 OpenCSG 云端模型');
    }
  }
  fixture.mockModule('services/aiService.js', {
    ...real,
    resolveApiConfig(_input, role) { return real.resolveApiConfig(config, role); },
    async streamGenerate(...params) {
      const [, prompt, , , apiConfig] = params;
      assertRemote(apiConfig);
      const options = params[10];
      const call = { role: apiConfig.role, task: options?.taskType, part: options?.blueprintPart,
        inputChars: String(prompt || '').length, startTime: new Date().toISOString() };
      onModelCall('start', call);
      const start = Date.now();
      try {
        const result = await real.streamGenerate(...params);
        onModelCall('result', { ...call, ms: Date.now() - start, finishReason: result.finishReason,
          outputChars: String(result.content || '').length, usage: result.usage,
          ...((args['trace-blueprint'] && options?.taskType === 'blueprint_initial')
            || (args['trace-progress'] && options?.taskType === 'chapter_progress_review') ? { content: result.content } : {}) });
        return result;
      } catch (error) {
        onModelCall('error', { ...call, ms: Date.now() - start, message: error.message, usage: error.usage });
        throw error;
      }
    },
  });
  const app = fixture.express();
  app.use(fixture.express.json({ limit: '10mb' }));
  return { ...fixture, app };
}

async function main() {
  if (!Number.isSafeInteger(maxResumes) || maxResumes < 0) throw new Error('max-resumes 必须是非负整数');
  const credential = args['local-check'] ? '' : fs.readFileSync(0, 'utf8').trim();
  if (!args['local-check'] && !credential) throw new Error('通过标准输入提供授权 API 密钥');
  const redact = message => credential ? String(message).replaceAll(credential, '[redacted]') : String(message);
  const { createSSEParser } = await import('../client/src/utils/sseParser.js');
  const { assessStoryCompletion, matchHookResolutionEvidence } = require('../server/services/storyState.js');
  const resumed = !args['local-check'] && fs.existsSync(checkpointPath) ? readJson(checkpointPath) : null;
  const run = resumed?.run || {
    startedAt: new Date().toISOString(), stage: 'outline', requestId: 'live-book-' + randomUUID(),
    input: args.input ? { ...defaultInput, ...readJson(path.resolve(args.input)) } : defaultInput,
  };
  fs.mkdirSync(out, { recursive: true });
  const progressPath = path.join(out, 'progress.json');
  const logPath = path.join(out, 'events.ndjson');
  function log(kind, fields = {}, show = false) {
    const row = redact(JSON.stringify({ at: new Date().toISOString(), stage: run.stage, kind, ...fields }));
    if (!args['local-check']) fs.appendFileSync(logPath, row + '\n');
    if (show) console.log(row);
  }
  const { state, InMemoryNovel, generationJobMock, app, loadRouter } = wireRouter(credential, (type, call) => {
    log(`model_${type}`, call, type === 'start' || type === 'error');
  });
  for (const entry of resumed?.novels || []) {
    const saved = Object.assign(new InMemoryNovel(), entry);
    if (saved.status === 'generating') saved.status = 'paused';
    state.novels.set(String(saved._id), saved);
  }
  for (const job of resumed?.jobs || []) {
    if (['running', 'pause_requested'].includes(job.status)) job.status = 'paused';
    state.jobs.set(String(job.jobId), job);
  }
  state.nextNovelId = Math.max(state.nextNovelId, resumed?.nextNovelId || 1);
  state.nextJobId = Math.max(state.nextJobId, resumed?.nextJobId || 1);

  const latestNovel = () => state.novels.get(run.novelId) || [...state.novels.values()].at(-1);
  const bookIsComplete = () => {
    const novel = latestNovel();
    return novel?.status === 'completed' && assessStoryCompletion(novel, novel.chapterPlanData, novel.targetWordCount,
      { fixedChapterCount: run.input.targetChapterCount, requireEndingVerification: true }).complete;
  };
  const renameWait = new Int32Array(new SharedArrayBuffer(4));
  function writeJson(target, value) {
    const temp = `${target}.${process.pid}.new`;
    fs.writeFileSync(temp, redact(JSON.stringify(value, null, 2)), 'utf8');
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(temp, target);
        return;
      } catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
        // A reader or antivirus can briefly hold the destination on Windows.
        Atomics.wait(renameWait, 0, 0, 20 * (attempt + 1));
      }
    }
  }
  function checkpoint(reason) {
    if (args['local-check']) return;
    const novel = latestNovel();
    if (novel) run.novelId = String(novel._id);
    const plan = novel?.chapterPlanData;
    const chapters = novel?.chapters || [];
    const ledger = novel?.foreshadowingLedger || [];
    const chapterByNumber = new Map(chapters.map(chapter => [Number(chapter.chapterNumber), chapter]));
    const resolved = ledger.filter(hook => ['resolved', 'paid_off'].includes(hook.status) || hook.stage === 'paid_off');
    const evidenced = resolved.filter(hook => matchHookResolutionEvidence(chapterByNumber.get(Number(hook.resolvedChapter))?.content,
      String(hook.resolutionEvidence || '').replaceAll(' … ', '。')));
    const completion = novel && assessStoryCompletion(novel, plan, novel.targetWordCount,
      { fixedChapterCount: run.input.targetChapterCount, requireEndingVerification: true });
    run.updatedAt = new Date().toISOString();
    const progress = { startedAt: run.startedAt, updatedAt: run.updatedAt, stage: run.stage, reason,
      apiBase, model, novelId: run.novelId, targetChapterCount: run.input.targetChapterCount,
      outlineChars: run.outline?.length || 0, blueprintEnd: run.blueprint?.phases?.at(-1)?.endChapter,
      blueprintValidation: run.blueprintValidation, status: novel?.status, chapterCount: chapters.length,
      latestChapter: chapters.at(-1)?.chapterNumber, lastEvent: run.lastEvent,
      smallestEndingDebt: run.smallestEndingDebt,
      endingVerification: chapters.at(-1)?.qualityReport?.endingVerification,
      hookCount: ledger.length, resolvedHooks: resolved.length, evidencedHooks: evidenced.length,
      unconfirmedHooks: ledger.filter(hook => hook.setupStatus === 'unconfirmed').length,
      abandonedHooks: ledger.filter(hook => hook.status === 'abandoned').length,
      completion, tokenUsage: novel?.tokenUsage,
    };
    writeJson(checkpointPath, { run, novels: [...state.novels.values()], jobs: [...state.jobs.values()],
      nextNovelId: state.nextNovelId, nextJobId: state.nextJobId });
    writeJson(progressPath, progress);
    return progress;
  }
  const save = InMemoryNovel.prototype.save;
  InMemoryNovel.prototype.save = async function (...params) {
    const result = await save.apply(this, params);
    checkpoint('saved_novel');
    return result;
  };
  let lastDraftSave = 0;
  for (const name of ['resumeGenerationJob', 'checkpointGenerationJob', 'finalizeGenerationJob', 'releaseGenerationJob']) {
    const original = generationJobMock[name];
    generationJobMock[name] = async function (request) {
      const job = await original(request);
      const ordinaryWriting = name === 'checkpointGenerationJob' && request.phase === 'writing';
      if (!ordinaryWriting || Date.now() - lastDraftSave >= 5000) {
        lastDraftSave = Date.now();
        checkpoint(name);
      }
      return job;
    };
  }

  app.use('/api/novels', loadRouter());
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/novels`;
  async function stream(endpoint, payload) {
    log('request', { endpoint }, true);
    const response = await fetch(base + endpoint, { method: 'POST', body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer isolated' } });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
      return { type: 'error', message: redact((await response.text()).slice(0, 1500)), httpStatus: response.status };
    }
    const parser = createSSEParser({
      onEvent(event) {
        if (['content', 'thinking', 'reasoning', 'token_usage', 'outline', 'blueprint_content'].includes(event.type)) return;
        const { type, chapterNumber, title, message, wordCount, totalWordCount, targetChapterCount, code, errorId } = event;
        const compact = { type, chapterNumber, title, message, wordCount, totalWordCount, targetChapterCount, code, errorId };
        if (event.novelId) run.novelId = event.novelId;
        run.lastEvent = compact;
        log('event', compact, ['status', 'chapter_start', 'chapter_end', 'completed', 'paused', 'error', 'plan_needs_extension'].includes(type));
        if (type === 'chapter_end') {
          const chapters = latestNovel()?.chapters || [];
          fs.writeFileSync(path.join(out, 'manuscript.txt'), redact(chapters.map(chapter => `${chapter.title}\n\n${chapter.content}`).join('\n\n\n') + '\n'), 'utf8');
        }
        if (['status', 'chapter_start', 'chapter_end', 'completed', 'paused', 'error', 'plan_needs_extension'].includes(type)) checkpoint(type);
      },
      onInvalidEvent({ error }) { log('invalid_sse', { message: error.message }, true); },
    });
    const decoder = new TextDecoder();
    for await (const bytes of response.body) parser.push(decoder.decode(bytes, { stream: true }));
    parser.push(decoder.decode());
    parser.finish();
    return parser.getState().terminalEvent || { type: 'error', message: '连接关闭时未收到 SSE 终止事件' };
  }

  try {
    if (args['local-check']) {
      const response = await fetch(base + '/types');
      if (!response.ok || !(await response.json()).length) throw new Error('隔离路由校验失败');
      console.log('LOCAL_ROUTER_OK');
      return;
    }
    checkpoint('start');
    if (args['ending-insert']) {
      const book = latestNovel();
      const ending = book?.chapters?.at(-1);
      const scene = fs.readFileSync(path.resolve(args['ending-insert']), 'utf8').trim();
      const boundary = ending?.content.lastIndexOf('\n\n') ?? -1;
      if (ending?.chapterNumber !== run.input.targetChapterCount || boundary < 1 || !scene || scene.length > 2000) {
        throw new Error('只能在已写完固定章数的测试稿中插入有效的终章片段');
      }
      const content = [ending.content.slice(0, boundary).trimEnd(), scene, ending.content.slice(boundary).trimStart()].join('\n\n');
      const updated = await fetch(base + `/${run.novelId}/chapter/${ending.chapterNumber}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer isolated' }, body: JSON.stringify({ content }),
      });
      if (!updated.ok) throw new Error(`编辑测试稿失败（${updated.status}）`);
      await updated.json();
      log('author_inserted_cloud_scene', { chapterNumber: ending.chapterNumber, sceneChars: scene.length });
    }
    if (!run.outline) {
      run.stage = 'outline';
      checkpoint('outline_start');
      const result = await stream('/generate-outline', run.input);
      if (result.type !== 'completed' || !result.outline) throw new Error(result.message || '大纲生成没有返回完整结果');
      run.outline = result.outline;
      fs.writeFileSync(path.join(out, 'outline.txt'), redact(run.outline), 'utf8');
      checkpoint('outline_ready');
    }
    if (!run.blueprint) {
      run.stage = 'blueprint';
      checkpoint('blueprint_start');
      const result = await stream('/generate-blueprint', { ...run.input, outline: run.outline });
      if (result.type !== 'completed' || !result.blueprint) throw new Error(result.message || '蓝图生成没有返回完整结果');
      run.blueprint = result.blueprint;
      run.blueprintValidation = result.validation;
      writeJson(path.join(out, 'blueprint.json'), run.blueprint);
      checkpoint('blueprint_ready');
    }
    run.stage = 'book';
    const savedDebt = endingReviewDebt(run.lastEvent?.message);
    if (savedDebt < (run.smallestEndingDebt ?? Infinity)) run.smallestEndingDebt = savedDebt;
    let consecutiveResumes = 0;
    let attempt = 0;
    while (!bookIsComplete()) {
      const before = latestNovel()?.chapters?.length || 0;
      const terminal = run.novelId
        ? await stream(`/continue/${run.novelId}`, { mode: 'book' })
        : await stream('/generate', { ...run.input, outline: run.outline, storyBlueprint: run.blueprint, clientRequestId: run.requestId });
      run.lastEvent = { type: terminal.type, message: terminal.message, code: terminal.code, httpStatus: terminal.httpStatus };
      const endingDebt = endingReviewDebt(terminal.message);
      const debtImproved = endingDebt < (run.smallestEndingDebt ?? Infinity);
      if (debtImproved) run.smallestEndingDebt = endingDebt;
      const progress = checkpoint('book_attempt_finished');
      if (terminal.type === 'completed') {
        const book = latestNovel();
        const parts = book.chapters.map(chapter => `${chapter.title}\n\n${chapter.content}`);
        fs.writeFileSync(path.join(out, 'manuscript.txt'), redact(parts.join('\n\n\n') + '\n'), 'utf8');
        run.stage = 'completed';
        console.log(redact(JSON.stringify({ result: 'COMPLETED', ...checkpoint('completion') })));
        if (!progress.completion?.complete) throw new Error('SSE 完成通知与持久化完结检查不一致');
        return;
      }
      if (!run.novelId || terminal.httpStatus === 400 || terminal.httpStatus === 404) break;
      consecutiveResumes = progress.chapterCount > before || debtImproved ? 0 : consecutiveResumes + 1;
      if (consecutiveResumes > maxResumes || attempt >= 20) break;
      attempt++;
      log('resume', { attempt, chapters: progress.chapterCount, message: terminal.message }, true);
      await wait(Math.min(5000 * attempt, 15000));
    }
    if (bookIsComplete()) {
      console.log(redact(JSON.stringify({ result: 'ALREADY_COMPLETED', ...checkpoint('completion') })));
      return;
    }
    console.log(redact(JSON.stringify({ result: 'PAUSED', ...checkpoint('paused') })));
    process.exitCode = 2;
  } catch (error) {
    run.lastEvent = { type: 'error', message: redact(error.message) };
    const snapshot = checkpoint('runner_error');
    console.error(redact(JSON.stringify({ result: 'FAILED', message: error.message, snapshot })));
    process.exitCode = 1;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
