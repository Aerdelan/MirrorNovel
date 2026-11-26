const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewChapterProgress } = require('../services/chapterProgress');
const { VERSION, hash } = require('../services/semanticMemory');

const archive = '黎周撬开档案柜，把证词的原件递给了听证员。';
const departure = '听证员确认原件有效。黎周带着姐姐离开法院。';
const checkpoint = { title: '找回证词', startChapter: 2, endChapter: 4, chapterGoal: '黎周带姐姐离开法院', phaseGoal: '交出原始证词' };
const chapters = [{ chapterNumber: 1, content: '上一篇章的证据单。' }, { chapterNumber: 2, content: archive }];

test('uses the current chapter for its goal and an earlier in-arc chapter for the phase result', async () => {
  const result = await reviewChapterProgress({ checkpoint, chapters, chapterNumber: 4, content: departure,
    request: async prompt => {
      assert.doesNotMatch(prompt, /上一篇章的证据单/);
      assert.match(prompt, /【第2章已保存】\n\[1\] 黎周/);
      assert.match(prompt, /【第4章当前待提交】\n\[2\] 听证员/);
      return { content: 'PHASE=1\nCHAPTER=2', finishReason: 'stop' };
    } });
  assert.deepEqual(result, { passed: true, evidence: [
    { chapterNumber: 2, excerpt: archive }, { chapterNumber: 4, excerpt: departure },
  ] });
});

test('distinguishes a narrated milestone gap from invalid, out-of-scope and truncated proof', async () => {
  const review = (output, finishReason = 'stop') => reviewChapterProgress({ checkpoint, chapters, chapterNumber: 4, content: departure,
    request: async () => ({ content: output, finishReason }) });
  assert.deepEqual(await review('CHAPTER=2\nPHASE=NONE|仍未交出证词'), {
    passed: false, issue: '篇章目标未达成（仍未交出证词）', evidence: [{ chapterNumber: 4, excerpt: departure }],
  });
  assert.equal((await review('CHAPTER=1\nPHASE=1')).invalid, true);
  assert.equal((await review('CHAPTER=2\nPHASE=99')).invalid, true);
  assert.equal((await review('CHAPTER=2\nCHAPTER=2')).invalid, true);
  assert.equal((await review('CHAPTER=2\nPHASE=1', 'length')).invalid, true);
});

test('retries unusable formatting once and accepts brackets around correctly scoped evidence numbers', async () => {
  const requests = [];
  const result = await reviewChapterProgress({ checkpoint, chapters, chapterNumber: 4, content: `${departure}\n两人走下台阶。`,
    request: async prompt => {
      requests.push(prompt);
      return { content: requests.length === 1 ? 'CHAPTER=1\nPHASE=999' : '- **PHASE：[1]**\n- `CHAPTER=[2,3]`' };
    } });
  assert.equal(requests.length, 2);
  assert.match(requests[1], /上次未返回能定位的编号/);
  assert.deepEqual(result.evidence.map(row => row.chapterNumber), [2, 4, 4]);
});

test('accepts all valid citations in the observed seven-number review without dropping scope checks', async () => {
  const paragraphs = Array.from({ length: 35 }, (_, index) => `本章第${index + 1}段的实际情节。`);
  const requestReview = output => reviewChapterProgress({ checkpoint: { ...checkpoint, phaseGoal: '' },
    chapters, chapterNumber: 4, content: paragraphs.join('\n'), request: async () => ({ content: output, finishReason: 'stop' }) });
  const result = await requestReview('CHAPTER=3, [5],[9],[11],[15],[22],[24]');
  assert.equal(result.passed, true);
  assert.deepEqual(result.evidence.map(row => row.excerpt), [3, 5, 9, 11, 15, 22, 24].map(id => paragraphs[id - 1]));
  const prefixed = await requestReview('CHAPTER=4|[3][5][9][11][15][22][24]');
  assert.deepEqual(prefixed, result);
  const ranged = await requestReview('CHAPTER=[3-5],[21–22],24');
  assert.deepEqual(ranged.evidence.map(row => row.excerpt), [3, 4, 5, 21, 22, 24].map(id => paragraphs[id - 1]));
  const mixed = await requestReview('CHAPTER=34，[3][5][9][11][15][22][24]');
  assert.deepEqual(mixed.evidence.map(row => row.excerpt), [34, 3, 5, 9, 11, 15, 22, 24].map(id => paragraphs[id - 1]));
  const withChapterLabel = await reviewChapterProgress({ checkpoint: { ...checkpoint, phaseGoal: '' },
    chapters, chapterNumber: 45, content: paragraphs.join('\n'),
    request: async () => ({ content: 'CHAPTER=45，[14]-[17],[19]-[23]', finishReason: 'stop' }) });
  assert.deepEqual(withChapterLabel.evidence.map(row => row.excerpt), [14, 15, 16, 17, 19, 20, 21, 22, 23].map(id => paragraphs[id - 1]));
  assert.equal((await requestReview('CHAPTER=3|[3],[5]')).invalid, true);
  assert.equal((await requestReview('CHAPTER=4|REPLACE:3,5')).invalid, true);
  assert.equal((await requestReview('CHAPTER=3，8,9,10,11,15,36')).invalid, true);
  assert.equal((await requestReview('CHAPTER=[3-36]')).invalid, true);
});

test('can suggest an exact scene to repair while ignoring stale or out-of-range suggestions', async () => {
  const review = output => reviewChapterProgress({ checkpoint, chapters, chapterNumber: 4, content: departure,
    request: async () => ({ content: output }) });
  assert.deepEqual(await review('CHAPTER=NONE|需要交代黎周带姐姐走的决定|[2]\nPHASE=1'), {
    passed: false,
    issue: '本章目标未达成（需要交代黎周带姐姐走的决定）',
    evidence: [{ chapterNumber: 2, excerpt: archive }],
    repairAnchors: [{ chapterNumber: 4, excerpt: departure }],
  });
  const expected = { passed: false, issue: '本章目标未达成（缺少选择）', evidence: [{ chapterNumber: 2, excerpt: archive }] };
  assert.deepEqual(await review('CHAPTER=NONE|缺少选择|1\nPHASE=1'), expected);
  assert.deepEqual(await review('CHAPTER=NONE|缺少选择|999\nPHASE=1'), expected);
  assert.deepEqual(await review('CHAPTER=NONE|缺少选择|REPLACE:1\nPHASE=1'), expected);
  assert.deepEqual(await review('CHAPTER=NONE|缺少选择|REPLACE:[2]\nPHASE=1'), {
    ...expected, repairAnchors: [{ chapterNumber: 4, excerpt: departure, replace: true }],
  });
});

test('reviews the local repair joins without adding another required response field or citation source', async () => {
  const review = await reviewChapterProgress({ checkpoint, chapters, chapterNumber: 4, content: departure,
    repairContext: { before: '听证员取出封存卷宗。', revised: '黎周带她转身离开。', after: '两人走下台阶。' },
    request: async prompt => {
      assert.match(prompt, /【本次修订相邻原文】\n前文末尾：听证员取出封存卷宗。\n修订内容：黎周带她转身离开。\n后文开头：两人走下台阶。/);
      assert.doesNotMatch(prompt.split('【正文证据】')[1], /听证员取出封存卷宗/);
      return { content: 'PHASE=1\nCHAPTER=2' };
    } });
  assert.equal(review.passed, true);
});

test('includes only valid historical memory quotes still present in the saved prose', async () => {
  const content = '旁白陈述。'.repeat(900) + archive + '风声扫过街道。'.repeat(900);
  const history = { chapterNumber: 2, content, memorySummary: {
    version: VERSION, chapterNumber: 2, summary: '证词交接', sourceHash: hash(content),
    events: [{ evidence: archive }, { evidence: '版本中不存在的早期原句。' }],
  } };
  const review = historicalChapter => reviewChapterProgress({ checkpoint, chapters: [historicalChapter], chapterNumber: 4, content: departure,
    request: async prompt => {
      assert.doesNotMatch(prompt, /版本中不存在的早期原句/);
      const source = prompt.split('\n').find(line => line.endsWith(archive));
      if (!source) return { content: 'CHAPTER=NONE|缺章\nPHASE=NONE|未找到历史证据' };
      const phaseId = source.match(/^\[(\d+)\]/)[1];
      const chapterId = prompt.split('\n').at(-1).match(/^\[(\d+)\]/)[1];
      return { content: `CHAPTER=${chapterId}\nPHASE=${phaseId}` };
    } });
  assert.equal((await review(history)).passed, true);
  const edited = { ...history, content: content.replace(archive, '黎周经过法院门口。') };
  assert.equal((await review(edited)).passed, false);
});

test('blocks a contradictory object handoff with prior and current prose and replaces only the disputed passage', async () => {
  const recovered = '贺兰青从操作手鞋舌里取出B-7铁门钥匙，揣进自己的口袋。';
  const offered = '操作手又从左脚鞋舌取出B-7铁门钥匙，放到仲裁桌上。';
  const testimony = '操作手在仲裁庭承认签过确认回执。';
  const saved = [
    { chapterNumber: 88, content: '不必核对的早先段落。' },
    { chapterNumber: 89, content: `远处汽笛响了。`.repeat(280) + '\n' + recovered + '\n' + `夜色遮住了栏杆。`.repeat(280) },
    { chapterNumber: 90, content: '押送途中，操作手提到钥匙是工单附带的。' },
    { chapterNumber: 91, content: '仲裁室布置妥当。' },
  ];
  const result = await reviewChapterProgress({
    checkpoint: { title: '核对供词', startChapter: 91, endChapter: 94, chapterGoal: '操作手提供供词' },
    chapters: saved, chapterNumber: 92, content: `${offered}\n${testimony}`,
    request: async prompt => {
      assert.doesNotMatch(prompt, /不必核对的早先段落/);
      assert.match(prompt, /【第89章已保存】/);
      assert.match(prompt, /允许自然接续、明确的回忆或转述/);
      const earlier = prompt.split('\n').find(line => line.endsWith(recovered)).match(/^\[(\d+)\]/)[1];
      return { content: `CHAPTER=1,2\nCONTINUITY=[${earlier}]|[1]|钥匙已被收走，未交还却又从操作手鞋中取出` };
    },
  });
  assert.deepEqual(result, {
    passed: false,
    issue: '第89章已发生事实与本章冲突（钥匙已被收走，未交还却又从操作手鞋中取出）',
    evidence: [{ chapterNumber: 92, excerpt: testimony }],
    repairAnchors: [{ chapterNumber: 92, excerpt: offered, replace: true }],
    continuityConflict: {
      past: { chapterNumber: 89, excerpt: recovered },
      current: { chapterNumber: 92, excerpt: offered },
      issue: '钥匙已被收走，未交还却又从操作手鞋中取出',
    },
  });
});

test('does not block a callback without a valid earlier/current citation pair', async () => {
  const saved = '守卫取走了钥匙。';
  const callback = '守卫把钥匙摆到桌上，嫌疑人说起了藏钥匙的经过。';
  const review = output => reviewChapterProgress({
    checkpoint: { title: '供词', chapterGoal: '解释钥匙来源' },
    chapters: [{ chapterNumber: 2, content: saved }], chapterNumber: 3, content: callback,
    request: async () => ({ content: output }),
  });
  const expected = { passed: true, evidence: [{ chapterNumber: 3, excerpt: callback }] };
  assert.deepEqual(await review('CHAPTER=1'), expected);
  assert.deepEqual(await review('CHAPTER=1\nCONTINUITY=1|2|证据章号写反'), expected);
  assert.deepEqual(await review('CHAPTER=1\nCONTINUITY=99|1|前文证据不存在'), expected);
  assert.deepEqual(await review('CHAPTER=1\nCONTINUITY=2|2|两处都来自旧章'), expected);
});
