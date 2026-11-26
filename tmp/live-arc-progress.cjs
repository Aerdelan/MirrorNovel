const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');

const workspace = path.resolve(__dirname, '..');
const runnerFile = path.join(__dirname, 'live-book-runner.cjs');
const runnerSource = fs.readFileSync(runnerFile, 'utf8');
const runnerEnd = runnerSource.indexOf('async function main()');
assert.ok(runnerEnd > 0, 'isolated harness source was not found');
const runner = new Module(runnerFile, module);
runner.filename = runnerFile;
runner.paths = Module._nodeModulePaths(__dirname);
runner._compile(runnerSource.slice(0, runnerEnd)
  .replace('const args = parseArgs({ options: {', 'const args = parseArgs({ args: [], options: {')
  .replace('inputChars: String(prompt || \'\').length,', `inputChars: String(prompt || '').length,
        ...(options?.taskType === 'chapter_progress_review' ? {
          goals: [...String(prompt).matchAll(/^(CHAPTER 本章目标|PHASE 篇章目标)/gm)].map(match => match[1].split(' ')[0]),
          chapter: Number(String(prompt).match(/第(\u005cd+)章当前待提交/)?.[1]),
        } : {}),`)
  .replace('outputChars: String(result.content || \'\').length, usage: result.usage', `outputChars: String(result.content || '').length, usage: result.usage,
          ...(options?.taskType === 'chapter_progress_review' ? { answer: String(result.content || '') } : {})`)
  + '\nmodule.exports = { wireRouter };\n', runnerFile);

const arcTitles = ['灯座漏电', '隔绝旧支线', '夜航试灯', '公开交接'];
const chapterGoals = [
  '修理员顾岚让值班员断开总开关，确认潮湿接线盒造成北港灯塔漏电，并当场挂牌隔离故障盒。',
  '顾岚拆下潮湿的旧支线，把未受损的备用干线接入配电柜，并让值班员复测，确认接地绝缘恢复正常。',
  '顾岚和值班员合闸试灯，灯塔连续运转，海上试航的小艇明确报告在指定浮标位置看到了新的灯光。',
  '顾岚带值班员当面交接维修记录、绝缘数值和维护钥匙，北港灯塔恢复开放，夜班值守有了新规。',
];
const outline = '北港灯塔停电。修理员顾岚与值班员罗实先查出潮湿接线盒漏电，断开并挂牌。随后顾岚用备用干线替换受损旧线，罗实测得绝缘恢复。两人试灯，外海小艇在三号浮标报告灯光清晰。顾岚交接并恢复正常值班，不留下新悬念。';
const planText = chapter => chapterGoals[chapter - 1] + '写出人物的具体操作和仪表或现场反馈，保留人之间的交接，后续步骤应在后续章节出现。';
const blueprint = {
  blueprintLevel: 3, mainArc: outline, lockedFacts: ['北港灯塔由机械和电力维持，无超自然力量。'],
  phases: chapterGoals.map((goal, index) => {
    const chapter = index + 1;
    const stage = { title: arcTitles[index], startChapter: chapter, endChapter: chapter,
      planText: planText(chapter), exitCondition: goal };
    return { ...stage, subphases: [{ ...stage, title: '完成现场工序' }] };
  }),
  rollingPlan: { startChapter: 1, endChapter: 4,
    chapters: chapterGoals.map((purpose, index) => ({ chapterNumber: index + 1, title: arcTitles[index], purpose,
      planText: planText(index + 1) })) },
};
const input = { novelTypeId: 'xianxia', protagonistName: '顾岚', worldSetting: '近代沿海港口、灯塔维修、无超自然。',
  targetChapterCount: 4, targetWordCount: 2800, chapterWordTarget: 700, mode: 'book', enableResearch: false,
  outline, storyBlueprint: blueprint, clientRequestId: randomUUID() };

async function main() {
  const credential = fs.readFileSync(0, 'utf8').trim();
  assert.ok(credential, 'provide the authorized cloud API credential through stdin');
  const out = path.join(__dirname, 'live-arc-progress-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(out);
  const redact = value => String(value).replaceAll(credential, '[redacted]');
  const eventPath = path.join(out, 'events.ndjson');
  const events = [];
  function record(row) {
    events.push(row);
    fs.appendFileSync(eventPath, redact(JSON.stringify(row)) + '\n');
  }
  const { state, InMemoryNovel, app, loadRouter } = runner.exports.wireRouter(credential,
    (kind, call) => record({ kind: 'model_' + kind, ...call }));
  const { createSSEParser } = await import('../client/src/utils/sseParser.js');
  app.use('/api/novels', loadRouter());
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/novels`;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer isolated' };
  async function post(endpoint, body) {
    record({ kind: 'request', endpoint });
    return fetch(base + endpoint, { method: 'POST', body: JSON.stringify(body), headers });
  }
  let novelId;
  let pause;
  async function stream(endpoint, body, pauseAt) {
    const response = await post(endpoint, body);
    if (!response.ok) throw new Error(redact((await response.text()).slice(0, 1200)));
    const parser = createSSEParser({ onEvent(event) {
      if (event.novelId) novelId = event.novelId;
      if (['content', 'thinking', 'reasoning', 'token_usage'].includes(event.type)) return;
      const { type, chapterNumber, message, code, phase } = event;
      record({ kind: 'event', type, chapterNumber, message, code, phase });
      if (type === 'chapter_end' && chapterNumber === pauseAt) {
        pause ||= post(`/pause/${novelId}`, {}).then(async result => {
          const body = await result.json();
          record({ kind: 'pause', status: result.status, result: body.job?.status || body.status });
        });
      }
    } });
    const decoder = new TextDecoder();
    for await (const bytes of response.body) parser.push(decoder.decode(bytes, { stream: true }));
    parser.push(decoder.decode());
    parser.finish();
    await pause;
    return parser.getState().terminalEvent;
  }
  let initial;
  let resumed;
  try {
    if (process.argv[2]) {
      const prior = path.resolve(process.argv[2]);
      const original = fs.readFileSync(path.join(prior, 'manuscript.txt'), 'utf8');
      const start = original.indexOf('\n\n');
      const content = original.slice(start + 2);
      const progressVerification = JSON.parse(fs.readFileSync(path.join(prior, 'summary.json'), 'utf8')).reviews[0];
      const stored = new InMemoryNovel({ ...input, status: 'paused', generationInput: input,
        chapters: [{ chapterNumber: 1, title: original.slice(0, start), content, wordCount: content.length,
          qualityReport: { progressVerification } }],
        chapterPlanData: { chapters: chapterGoals.map((coreEvent, index) => ({ chapterNumber: index + 1,
          title: arcTitles[index], wordTarget: 700, coreEvent })) },
      });
      await stored.save();
      novelId = stored._id;
      initial = { type: 'first_live_run' };
    } else {
      initial = await stream('/generate', input, 1);
    }
    assert.ok(novelId, 'normal create did not return an isolated novel ID');
    const novel = state.novels.get(novelId);
    const prefix = novel.chapters.map(chapter => chapter.content);
    if (novel.chapters.length < 2) resumed = await stream(`/continue/${novelId}`, { mode: 'chapter' });
    assert.deepEqual(novel.chapters.slice(0, prefix.length).map(chapter => chapter.content), prefix, 'continuation changed saved prose');
    const reviewed = novel.chapters.slice(0, 2).map(chapter => {
      const review = chapter.qualityReport?.progressVerification;
      const evidence = (review?.evidence || []).map(item => ({ ...item, located: String(novel.chapters
        .find(source => source.chapterNumber === item.chapterNumber)?.content || '').replace(/\s/g, '').includes(item.excerpt.replace(/\s/g, '')) }));
      return { number: chapter.chapterNumber, passed: review?.passed === true, evidence };
    });
    const calls = events.filter(row => row.kind === 'model_start' && row.task === 'chapter_progress_review');
    const summary = { out, saved: novel.chapters.map(chapter => chapter.chapterNumber), status: novel.status,
      reviews: reviewed, calls, resumed: Boolean(resumed), initial: initial?.type, continuation: resumed?.type,
      errors: events.filter(row => row.kind === 'event' && row.type === 'error'), modelCalls: events.filter(row => row.kind === 'model_start').length };
    fs.writeFileSync(path.join(out, 'summary.json'), redact(JSON.stringify(summary, null, 2)));
    fs.writeFileSync(path.join(out, 'manuscript.txt'), redact(novel.chapters.map(chapter => chapter.title + '\n\n' + chapter.content).join('\n\n')));
    const failedDraft = [...state.jobs.values()].find(job => job.draft && job.chapterNumber === 2)?.draft;
    if (failedDraft) fs.writeFileSync(path.join(out, 'chapter-2-draft.txt'), redact(failedDraft));
    console.log(redact(JSON.stringify(summary)));
    assert.ok(resumed, 'normal continue was not exercised');
    assert.equal(reviewed.length, 2);
    assert.ok(reviewed.every(review => review.passed && review.evidence.length && review.evidence.every(item => item.located)));
    assert.ok(calls.some(call => call.goals.includes('PHASE')), 'expected real phase evidence review');
  } catch (error) {
    console.error(redact(error.message));
    process.exitCode = 1;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
