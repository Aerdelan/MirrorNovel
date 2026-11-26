const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const priorHarnessPath = path.join(__dirname, 'live-arc-progress.cjs');
const priorHarness = fs.readFileSync(priorHarnessPath, 'utf8');
const end = priorHarness.indexOf('const arcTitles');
assert.ok(end > 0);
const harness = new Module(priorHarnessPath, module);
harness.filename = priorHarnessPath;
harness.paths = Module._nodeModulePaths(__dirname);
harness._compile(priorHarness.slice(0, end)
  .replace("options?.taskType === 'chapter_progress_review' ? { answer:", "['chapter_progress_review', 'chapter_progress_repair'].includes(options?.taskType) ? { answer:")
  + '\nmodule.exports = { wireRouter: runner.exports.wireRouter };\n', priorHarnessPath);

const goal = '书记员林泉将蓝色法院印章盖在证据保全令上，交给顾岚，原始值班簿因此正式获得保全。';
const draftText = `顾岚跨过法院侧门的石坎，把沾泥的鞋跟在铜条上磕了两下。伞收得匆忙，半边袖子已经湿透。他没有往里甩水，只把伞尖抵进门边的陶罐，抱着值班簿走向最里头的窗。窗口没有铃，玻璃后面亮着一盏偏黄的小灯。林泉看见他手里的布包，先把自己的茶杯挪开。顾岚只报了姓名，把包解开，顺手压平了散开的布角。

林泉把三处编号逐一核对。值班簿的登记日期、证物柜上的红号和申请单的骑缝记号都对得上。他将核对结果抄进保全令，末尾特意给蓝色法院印章留下了方框。方框仍是空的。他把待盖章的保全令摊在掌边，伸手拉开桌子最底层的抽屉。顾岚没有催，只把簿子往他那边推了半寸。

街上传来收伞的声响。门外的茶水摊开始撤桌子，木脚拖过石板，一下一下。顾岚把空布包叠成四折，往怀里一收，手背碰到还带着雨水的领口。他抬头看了看柜台上的灯。骑缝记号抄进纸里时，笔尖最后一横特别淡，拖出一小道毛边，和原始值班簿末行的那横正好相反。他想提醒林泉，抬到一半的手还是落了回去。

门口又有一阵脚步声。顾岚侧身让开，把那把漏水的伞往陶罐里扶正。檐下有水落进铜盆，间隔开始拉长，一滴一滴，中间能听见远处短促的船笛。他把手放回风衣口袋，慢慢沿原路走回台阶。`;

async function main() {
  const credential = fs.readFileSync(0, 'utf8').trim();
  assert.ok(credential, 'provide authorized credential only through stdin');
  const out = path.join(__dirname, 'live-arc-local-repair-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(out);
  const redact = value => String(value).replaceAll(credential, '[redacted]');
  const events = [];
  const record = event => {
    events.push(event);
    fs.appendFileSync(path.join(out, 'events.ndjson'), redact(JSON.stringify(event)) + '\n');
  };
  const { state, InMemoryNovel, app, loadRouter } = harness.exports.wireRouter(credential,
    (kind, call) => record({ kind: 'model_' + kind, ...call }));
  if (process.argv.includes('--skip-memory')) {
    const ai = require('../server/services/aiService');
    const generate = ai.streamGenerate;
    ai.streamGenerate = (...parameters) => {
      if (parameters[10]?.taskType === 'chapter_memory') {
        record({ kind: 'skipped_optional_memory', reason: 'test ends after verified chapter is saved' });
        return Promise.reject(new Error('isolated smoke skipped post-commit memory'));
      }
      return generate(...parameters);
    };
  }
  const { processChapter } = require('../server/services/chapterToolchain');
  const format = text => processChapter(text, { doDeAI: true, doPunctuation: true, doAutoFormat: true,
    doHumanize: false, doRhythmRandomize: false, genre: 'xianxia' }).text.trim();
  const draft = format(draftText);
  assert.equal(format(draft), draft, 'canonical draft reformatting changed bytes before provider use');
  const first = draft.slice(0, draft.indexOf('\n'));
  const last = draft.slice(draft.lastIndexOf('\n') + 1);
  assert.ok(first.length > 60 && last.length > 60 && first !== last && draft.split('\n').filter(Boolean).length >= 4);
  const next = ['顾岚核对有日期的证人名单', '法庭听取两名证人的陈述', '法庭宣布最终裁判并交付原件'];
  const chapterPlan = [goal, ...next].map((coreEvent, index) => ({ chapterNumber: index + 1, coreEvent,
    raw: '模型分批细化计划', wordTarget: 600, title: ['立下保全', '日期名单', '证人到庭', '原件交付'][index] }));
  const blueprint = { blueprintLevel: 3, mainArc: '顾岚凭原始值班簿找回被遗失的证据，经法院审理获得最终裁判。', phases: [
    { title: '保全原件', startChapter: 1, endChapter: 1, exitCondition: goal },
    { title: '庭审复核', startChapter: 2, endChapter: 4, exitCondition: next.at(-1) },
  ], rollingPlan: { startChapter: 1, endChapter: 4,
    chapters: chapterPlan.map(card => ({ chapterNumber: card.chapterNumber, title: card.title, purpose: card.coreEvent,
      planText: '通过正文里的具体行动实现该章最主要的结果。' + card.coreEvent })) } };
  const novel = new InMemoryNovel({ status: 'paused', targetChapterCount: 4, targetWordCount: 2400,
    chapterWordTarget: 600, novelTypeId: 'xianxia', novelTypeName: '现实短篇测试', protagonistName: '顾岚',
    worldSetting: '沿河小城的法院和码头，人物无超自然力量。', outline: blueprint.mainArc,
    storyBlueprint: blueprint, chapterPlanData: { chapters: chapterPlan }, generationInput: { mode: 'book', targetChapterCount: 4 } });
  await novel.save();
  state.jobs.set('job-local-arc-repair', { jobId: 'job-local-arc-repair', novelId: novel._id, kind: 'novel', status: 'paused',
    phase: 'chapter_progress_review', draftPhase: 'chapter_progress_review', chapterNumber: 1, draft,
    lastCommittedChapter: 0, draftSeq: 1, fencingToken: 1, attempt: 1, events: [], eventSeq: 0 });
  fs.writeFileSync(path.join(out, 'original.txt'), redact(draft));

  const { createSSEParser } = await import('../client/src/utils/sseParser.js');
  app.use('/api/novels', loadRouter());
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  let terminal;
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/novels/continue/${novel._id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer isolated' },
      body: JSON.stringify({ mode: 'chapter' }),
    });
    if (!response.ok) throw new Error(redact((await response.text()).slice(0, 1000)));
    const parser = createSSEParser({ onEvent(event) {
      if (['content', 'thinking', 'reasoning', 'token_usage'].includes(event.type)) return;
      record({ kind: 'event', type: event.type, chapterNumber: event.chapterNumber, message: event.message,
        ...(event.type === 'draft_restored' ? { exactOriginal: event.content === draft } : {}) });
    } });
    const decoder = new TextDecoder();
    for await (const bytes of response.body) parser.push(decoder.decode(bytes, { stream: true }));
    parser.push(decoder.decode());
    parser.finish();
    terminal = parser.getState().terminalEvent;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const saved = novel.chapters[0];
  const final = saved?.content || '';
  if (final) fs.writeFileSync(path.join(out, 'revised.txt'), redact(final));
  const progress = saved?.qualityReport?.progressVerification;
  const reviews = events.filter(item => item.kind === 'model_result' && item.task === 'chapter_progress_review');
  const repairs = events.filter(item => item.kind === 'model_result' && item.task === 'chapter_progress_repair');
  let prefixLength = 0;
  while (prefixLength < Math.min(draft.length, final.length) && draft[prefixLength] === final[prefixLength]) prefixLength++;
  let suffixLength = 0;
  while (suffixLength < Math.min(draft.length, final.length) - prefixLength
    && draft[draft.length - suffixLength - 1] === final[final.length - suffixLength - 1]) suffixLength++;
  const finalParagraphs = final.split('\n').filter(Boolean);
  let lastIndex = -1;
  const originalParagraphs = draft.split('\n').filter(Boolean);
  const intactParagraphs = originalParagraphs.flatMap((paragraph, index) => {
    const match = finalParagraphs.indexOf(paragraph, lastIndex + 1);
    if (match < 0) return [];
    lastIndex = match;
    return [index + 1];
  });
  const summary = { out, terminal: terminal?.type, message: terminal?.message, status: novel.status, count: novel.chapters.length,
    restored: events.some(item => item.type === 'draft_restored' && item.exactOriginal === true),
    initialPassed: !reviews[0]?.answer?.includes('NONE'), repaired: repairs.length === 1, initialLength: draft.length,
    prefixLength, suffixLength, firstParagraphUnchanged: final.startsWith(first + '\n'), lastParagraphUnchanged: final.endsWith('\n' + last),
    intactParagraphs, originalParagraphCount: originalParagraphs.length, finalParagraphCount: finalParagraphs.length,
    removedChars: draft.length - prefixLength - suffixLength, insertedChars: final.length - prefixLength - suffixLength,
    acceptedProof: progress?.passed === true && progress.evidence.every(item => final.includes(item.excerpt)),
    reviews: reviews.map(item => item.answer), proof: progress?.evidence, patch: repairs[0]?.answer,
    newDraftCalls: events.filter(item => item.kind === 'model_start' && item.task === 'chapter_write').length };
  fs.writeFileSync(path.join(out, 'summary.json'), redact(JSON.stringify(summary, null, 2)));
  console.log(redact(JSON.stringify(summary)));
  assert.equal(summary.terminal, 'completed');
  assert.ok(summary.restored && !summary.initialPassed && summary.repaired && summary.acceptedProof);
  assert.ok(summary.firstParagraphUnchanged && summary.lastParagraphUnchanged);
  assert.equal(summary.newDraftCalls, 0);
  assert.equal(summary.removedChars, 0);
  assert.equal(summary.intactParagraphs.length, summary.originalParagraphCount);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
