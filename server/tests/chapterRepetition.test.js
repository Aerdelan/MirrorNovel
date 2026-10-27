const test = require('node:test');
const assert = require('node:assert/strict');
const { detectRepeatedEnding, assertDistinctEnding, repairRepeatedEnding, buildEndingHistory } = require('../services/chapterRepetition');

const ending = [
  '他终于把那封信放回抽屉，窗外的雨仍旧没有停。楼下传来清洁车的声音，车轮碾过井盖，发出一声短促的碰撞。他伸手按住抽屉边沿，想起信封上没有寄件人的地址。',
  '走廊的灯忽然熄了，门缝里最后一点光也暗下去。他没有起身，只将桌上的录音机拨回起点。磁带转动起来，里面的人先咳了一声，随即准确说出了他此刻坐着的位置。',
  '他拔掉插头。声音却没有停。那不是从录音机里传来的，而是隔着一扇门，有人在等他答话。',
].join('\n\n');
const fresh = '林舟把值班表递给老周，指着签名下方新添的两笔。老周没有接，先把门带上，才从口袋里摸出一张车票。票面上的日期比失踪案早了三天，他说那晚的末班车根本没有进站。林舟抬起头，候车室的广播正在重复报出那趟车的班次。老周攥着车票的手慢慢收紧，纸上的折痕压过那个被墨水涂去的站名。';
const chapters = [{ chapterNumber: 1, content: '首章独有正文。'.repeat(400) + ending }];
const workplaceEnding = require('./fixtures/repeatedWorkplaceEnding');

test('reproduces the reported workplace novel: several hundred copied characters at chapter end', () => {
  const previous = { chapterNumber: 10, content: '仓库昨天发生了另一件事。'.repeat(400) + workplaceEnding };
  const content = '今天的调查有完全不同的进展。'.repeat(400) + workplaceEnding;
  const match = detectRepeatedEnding(content, [previous], 11);
  assert.equal(match.chapterNumber, 10);
  assert.ok(match.matchedChars >= 350);
  assert.match(match.excerpt, /日子还长，慢慢熬吧/);
});

test('detects a small copied ending inside otherwise different long chapters', () => {
  const content = '完全不同的新章内容。'.repeat(500) + ending;
  const match = detectRepeatedEnding(content, chapters, 2);
  assert.equal(match.chapterNumber, 1);
  assert.ok(match.matchedChars >= 150);
  assert.equal(content.slice(match.start, match.end), match.excerpt);
  assert.throws(() => assertDistinctEnding(content, chapters, 2), { code: 'CHAPTER_ENDING_REPEATED' });
});

test('ignores punctuation/paragraph changes and detects copied text before a new closing line', () => {
  const changed = ending.replace(/[，。]/g, ' ').replace(/\n/g, '');
  assert.ok(detectRepeatedEnding('独有内容。'.repeat(300) + changed + '\n忽然，一辆汽车停在楼下。', chapters, 2));
});

test('checks nonadjacent chapters but never compares against self or future chapters', () => {
  const history = [...chapters, { chapterNumber: 2, content: fresh.repeat(4) }, { chapterNumber: 3, content: ending }];
  assert.equal(detectRepeatedEnding(ending, history, 3).chapterNumber, 1);
  assert.equal(detectRepeatedEnding(fresh.repeat(4), history, 2), null);
  assert.equal(detectRepeatedEnding(ending, history, 1), null);
});

test('short recurring dialogue and shared names alone do not block a chapter', () => {
  assert.equal(detectRepeatedEnding(fresh + '\n“明天见。”', [{ chapterNumber: 1, content: ending + '\n“明天见。”' }], 2), null);
  assert.equal(detectRepeatedEnding('林舟。'.repeat(20), chapters, 2), null);
});

test('clean chapters do not call the model; ending history has a fixed input budget', async () => {
  const result = await repairRepeatedEnding({ content: fresh, chapters, chapterNumber: 2, generate() { assert.fail('unexpected model call'); } });
  assert.equal(result.content, fresh);
  assert.equal(result.report, null);
  const history = buildEndingHistory(Array.from({ length: 200 }, (_, index) => ({ chapterNumber: index + 1, content: ending.repeat(20) })), 200);
  assert.ok(history.length < 1800);
  assert.match(history, /第199章/);
  assert.doesNotMatch(history, /第200章/);
});

test('one bounded repair replaces only the tail and preserves the prefix byte-for-byte', async () => {
  const prefix = '本章独有的前部正文。'.repeat(250) + '保留本行序号甲。\n\n';
  let calls = 0;
  const result = await repairRepeatedEnding({ content: prefix + ending, chapters, chapterNumber: 2,
    generate: async prompt => { calls++; assert.match(prompt, /禁止复用/); return { content: fresh }; } });
  assert.equal(calls, 1);
  assert.equal(result.content, prefix + fresh);
  assert.equal(result.report.sourceChapter, 1);
});

test('repeated, truncated, empty and failed repairs are rejected without a retry loop', async t => {
  for (const [label, generate] of [
    ['repeated', async () => ({ content: ending })],
    ['truncated', async () => ({ content: fresh, finishReason: 'length' })],
    ['empty', async () => ({ content: '' })],
    ['failed', async () => { throw new Error('provider unavailable'); }],
  ]) {
    await t.test(label, async () => {
      let calls = 0;
      await assert.rejects(repairRepeatedEnding({ content: ending, chapters, chapterNumber: 2,
        generate: async (...args) => { calls++; return generate(...args); } }), { code: 'CHAPTER_ENDING_REPEATED' });
      assert.equal(calls, 1);
    });
  }
});

test('repairing a continuation cannot rewrite already published prose', async () => {
  const original = fresh + '\n';
  const result = await repairRepeatedEnding({ content: original + ending, chapters, chapterNumber: 2,
    minRewriteStart: original.length, generate: async () => ({ content: fresh }) });
  assert.ok(result.content.startsWith(original));
});

test('cancellation during a repair stays a pause rather than a repetition error', async () => {
  const controller = new AbortController();
  await assert.rejects(repairRepeatedEnding({ content: ending, chapters, chapterNumber: 2, signal: controller.signal,
    generate: async () => { controller.abort(); return { content: fresh }; } }), { name: 'AbortError' });
});

test('a clean addition can extend an old chapter whose published ending already repeats', async () => {
  const original = ending + '\n';
  const result = await repairRepeatedEnding({ content: original + fresh, chapters, chapterNumber: 2,
    minRewriteStart: original.length, generate() { assert.fail('must not rewrite published prose'); } });
  assert.equal(result.content, original + fresh);
  assert.equal(result.report, null);
});
