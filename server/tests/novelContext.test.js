const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildContextMemoryCheckpoint,
  selectRelevantHistory,
  buildContextFromDocs,
} = require('../services/novelContext');

function chapter(chapterNumber, content) {
  return { chapterNumber, content: `${content}。${'现场细节推动人物判断并留下后果。'.repeat(18)}` };
}

test('context checkpoints preserve facts and open loops without model calls', () => {
  const memory = buildContextMemoryCheckpoint({
    chapters: [chapter(1, '林舟在旧邮局找到铜钥匙'), chapter(2, '苏晚发现钥匙对应地下室')],
    chapterSummaryDoc: '第1章：开篇：林舟进入旧邮局。章末：他收起铜钥匙。\n第2章：开篇：苏晚核对钥匙。关键发展：发现地下室。章末：门后传来声音。',
    storyBible: { theme: '旧案追查', tone: '克制悬疑', worldRules: ['旧城每逢暴雨会停电'] },
    characterStates: [{ name: '林舟', location: '旧邮局', emotionalState: '警惕', goal: '找到失踪证人', lastChapter: 2 }],
    plotThreads: [{ id: 'main', title: '旧案', status: 'active', nextMilestone: '打开地下室' }],
    foreshadowingLedger: [{ content: '铜钥匙上的裂纹', setChapter: 1, status: 'pending' }],
    chapterNumber: 2,
  });

  assert.equal(memory.version, 1);
  assert.equal(memory.checkpointChapter, 2);
  assert.match(memory.checkpointSummary, /第1章/);
  assert.ok(memory.facts.some((fact) => fact.includes('旧城每逢暴雨会停电')));
  assert.ok(memory.openLoops.some((loop) => loop.includes('打开地下室')));
});

test('relevant history retrieves matching old chapters and excludes unrelated prose', () => {
  const chapters = [
    chapter(1, '林舟在旧邮局拿到铜钥匙，决定追查地下室。'),
    chapter(2, '苏晚在车站查找失踪证人的登记记录。'),
    chapter(3, '林舟回到旧邮局，发现铜钥匙的裂纹与地下室门锁吻合。'),
    chapter(4, '两人在河堤休息，讨论明天的天气。'),
  ];
  const selected = selectRelevantHistory(chapters, '铜钥匙 地下室', { currentChapter: 5, maxChapters: 2, maxChars: 1200 });

  assert.equal(selected.length, 2);
  assert.match(selected[0] + selected[1], /第1章|第3章/);
  assert.doesNotMatch(selected.join('\n'), /天气/);
  assert.ok(selected.every((item) => item.length < 500));
});

test('context builder remains backward compatible and applies a hard size limit', () => {
  const output = buildContextFromDocs(
    '第1章：' + '旧案摘要。'.repeat(500),
    '',
    '大纲：林舟追查旧案',
    '',
    2,
    '',
    {
      contextMemory: { checkpointChapter: 1, checkpointSummary: '阶段总结：旧邮局出现铜钥匙', facts: ['林舟目标：找到证人'], openLoops: ['地下室门锁待核对'] },
      relevantHistory: ['第1章（相关历史）：铜钥匙指向地下室'],
      maxChars: 6000,
    }
  );

  assert.ok(output.length <= 6000);
  assert.match(output, /阶段记忆检查点/);
  assert.match(output, /相关历史片段/);
});
