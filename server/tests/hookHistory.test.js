const test = require('node:test');
const assert = require('node:assert/strict');
const { createHookHistorySearch } = require('../services/hookHistory');
const { matchHookResolutionEvidence } = require('../services/storyState');

test('payoff search uses only earlier saved prose written after setup', () => {
  const sharedPassage = '守夜人的铜鹤钥匙打开钟楼底门。';
  const unrelatedProse = '燥热的风沿着没有灯的楼梯往下吹，砖面全是灰尘。'.repeat(38);
  const payoff = `午夜的钟响到第三下，远行人把铜鹤钥匙插进锁孔。底门打开了，他找到了被藏在钟楼的证词。龙叔认出了父亲的笔迹，答应把证词带到庭上。`;
  const content = unrelatedProse + payoff + unrelatedProse;
  const select = createHookHistorySearch([
    { chapterNumber: 7, content: sharedPassage },
    { chapterNumber: 5, content },
    { chapterNumber: 3, title: sharedPassage, content: unrelatedProse },
    { chapterNumber: 2, content: sharedPassage },
    { chapterNumber: 1, content: sharedPassage },
    { chapterNumber: 6, content: sharedPassage },
  ], 6);

  const results = select({ setChapter: 2, content: '铜鹤钥匙能否打开钟楼底门取得证词' });
  assert.deepEqual(results.map(result => result.chapterNumber), [5]);
  assert.ok(results[0].text.includes(payoff));
  assert.ok(content.includes(results[0].text));
  assert.ok(results[0].text.length < content.length);
});

test('payoff search keeps at most four different chapters and omits weak matches', () => {
  const setups = ['黑曜城门', '银羽齿轮', '朱漆刻章', '雨钟密码', '白漆月琴'];
  const chapters = setups.map((setup, i) => ({ chapterNumber: i + 2, content: `旅者找到了${setup}，并交给了城中的守备。` }));
  const select = createHookHistorySearch([
    { chapterNumber: 1, content: '交易人藏起了证物，事发当天没有其他人在场。' },
    ...chapters,
  ], 7);
  const candidates = select({ setChapter: 1, content: setups.join('、') });

  assert.equal(candidates.length, 4);
  assert.equal(new Set(candidates.map(candidate => candidate.chapterNumber)).size, 4);
  for (const { chapterNumber, text } of candidates) {
    assert.equal(text, chapters.find(chapter => chapter.chapterNumber === chapterNumber).content);
  }
  assert.deepEqual(select({ setChapter: 1, content: '找到了走失的邮差' }), []);
  assert.deepEqual(select({ setChapter: 7, content: setups.join('、') }), []);
  assert.deepEqual(select({ content: setups.join('、') }), []);
});

test('payoff search retains strong historical matches and includes late answers', () => {
  const clues = ['银羽齿轮', '朱漆刻章', '雨钟密码', '白漆月琴', '紫铜风铃', '绿釉瓷盘'];
  const passages = new Map([
    [2, clues.slice(0, 4).join('、')],
    [3, clues.slice(0, 3).join('、')],
    [4, clues.slice(0, 2).join('、')],
    [18, '守卫把紫铜风铃交还原主，两人的约定兑现了。'],
    [19, '来客敲碎绿釉瓷盘，取出窑主留下的证词。'],
  ]);
  const chapters = Array.from({ length: 24 }, (_, index) => ({
    chapterNumber: index + 1,
    content: passages.get(index + 1) || '书商在长廊搬运木箱，两个船夫擦肩走过。',
  }));

  const select = createHookHistorySearch(chapters, 25);
  const results = select({ setChapter: 1, content: clues.join('、') });
  assert.deepEqual(results.map(result => result.chapterNumber), [2, 3, 19, 18]);
  assert.equal(results[2].text, passages.get(19));
});

test('payoff search matches case-insensitive terms without changing source text', () => {
  const content = '她解开 KEY-ALPHA17 的锁，取出封存的公证书。';
  const select = createHookHistorySearch([
    { chapterNumber: '1', content: '她发现保险箱刻着一组暗号。' },
    { chapterNumber: '2', content },
  ], '3');
  assert.deepEqual(select({ setChapter: '1', content: 'Key-Alpha17' }), [{ chapterNumber: 2, text: content }]);
});

test('historical proof windows retain adjacent answers and expand short citations', () => {
  const opening = '深夜停电之后，几位守夜人陆续返回调度亭。';
  const caller = '"寄信人——黎齐。收据登记的是北街的邮局。';
  const paper = '她摸到衣袋里的蓝纸。纸角早已起毛。她将它取出来。那是张借契。债主名下写着黎齐两字。';
  const firstSource = opening.repeat(4) + caller + opening.repeat(8);
  const secondSource = opening.repeat(5) + paper + opening.repeat(10);
  const search = createHookHistorySearch([
    { chapterNumber: 1, content: '她发现匿名邮件，还在老宅翻到一张遗落的蓝纸。' },
    { chapterNumber: 2, content: firstSource },
    { chapterNumber: 3, content: secondSource },
  ], 4, { evidenceWindows: true });

  const sender = search({ setChapter: 1, content: '寄信人身份不明，谁将匿名信放在窗口？' })
    .find(source => source.chapterNumber === 2);
  assert.ok(sender.excerpts.some(excerpt => excerpt.includes(caller) && matchHookResolutionEvidence(firstSource, excerpt)));
  assert.ok(!sender.excerpts.includes('"寄信人——黎齐。'));

  const contract = search({ setChapter: 1, content: '她衣袋里的蓝纸是哪份文件，写了谁的名字？' })
    .find(source => source.chapterNumber === 3);
  assert.ok(contract.excerpts.some(excerpt => excerpt.includes(paper) && matchHookResolutionEvidence(secondSource, excerpt)));
  assert.ok(contract.excerpts.every(excerpt => excerpt.length <= 300 && secondSource.includes(excerpt)));
});
