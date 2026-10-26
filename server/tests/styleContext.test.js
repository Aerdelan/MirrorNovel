const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStyleContext, REVISE_PURPOSE_NOTE } = require('../services/styleContext');
const { buildSamplesPrompt, SAMPLE_PROMPT_RULES_REVISE, SAMPLE_PROMPT_RULES } = require('../services/writingSamples');
const { personaConstraint } = require('../services/editorialEngine');

const sentence = '窗外的雨没有停，他把那封信折好放回抽屉，关门时又停了一会儿，直到楼道的灯亮起来。';
const snapshot = () => ({
  revisionId: 'r1', version: 3,
  samples: [
    { sampleId: 's1', title: '雨夜', sceneType: 'action', notes: '', content: sentence },
    { sampleId: 's2', title: '对峙', sceneType: 'dialogue', notes: '', content: sentence + '他先看了四周。' },
  ],
  preferences: [
    { preferenceId: 'p1', statement: '每章结尾停在未完成的动作上，不做情绪总结。', reason: 'pacing' },
  ],
  sampleBudget: { maxCount: 3, maxCharsPerSample: 240 },
});

test('prose purpose delegates to the per-chapter rotation and is stable per chapter', () => {
  const a = buildStyleContext(snapshot(), 'prose', { chapterNumber: 4 });
  const b = buildStyleContext(snapshot(), 'prose', { chapterNumber: 4 });
  const c = buildStyleContext(snapshot(), 'prose', { chapterNumber: 5 });
  assert.ok(a.block.includes('【作者认可的写作样稿】'));
  assert.ok(a.block.includes('【作者确认的写作偏好】'));
  assert.equal(a.block, b.block, 'same chapter must be byte-identical');
  assert.notEqual(a.block, c.block, 'chapters rotate');
  assert.equal(a.record.version, 3);
  assert.ok(a.record.sampleIds.length >= 1);
});

test('revise purpose swaps in the revision boundary and adds the discipline note', () => {
  const { block, record } = buildStyleContext(snapshot(), 'revise');
  assert.ok(block.includes('【作者确认的写作偏好】'));
  assert.ok(block.includes('【作者认可的写作样稿】'));
  assert.ok(block.includes('原文是唯一的事实基准'), 'revision-flavored sample boundary');
  assert.ok(!block.includes('本章任务始终优先；不要机械套用样稿的句长'), 'prose boundary must not leak into revise context');
  assert.ok(block.includes('【修订纪律】'));
  assert.ok(block.includes(REVISE_PURPOSE_NOTE.slice(0, 20)));
  assert.equal(record.purpose, 'revise');
  assert.deepEqual(record.sampleIds, ['s1', 's2']);
  assert.deepEqual(record.preferenceIds, ['p1']);
});

test('plan purpose and missing snapshots inject nothing; unknown purpose is rejected', () => {
  for (const [snap, purpose] of [[snapshot(), 'plan'], [null, 'plan'], [null, 'revise'], [null, 'prose'], [undefined, 'revise']]) {
    const { block, record } = buildStyleContext(snap, purpose, { chapterNumber: 2 });
    assert.equal(block, '');
    assert.equal(record, null);
  }
  assert.throws(() => buildStyleContext(snapshot(), 'polish'), error => error.status === 400);
});

test('revise context never shows samples or preferences that are not in the frozen snapshot', () => {
  const { block } = buildStyleContext(snapshot(), 'revise');
  assert.ok(!block.includes('未冻结的规则'));
  assert.ok(!block.includes('未冻结样稿'));
  assert.ok(block.includes('每章结尾停在未完成的动作上'));
  assert.ok(block.includes('雨夜'));
});

test('samples prompt switches boundary text by purpose without changing the data rows', () => {
  const rows = [{ title: 'a', sceneType: 'action', notes: '', content: sentence }];
  const revise = buildSamplesPrompt(rows, { purpose: 'revise' });
  const prose = buildSamplesPrompt(rows, { purpose: 'prose' });
  assert.match(revise, /原文是唯一的事实基准/);
  assert.match(prose, /本章任务始终优先/);
  assert.equal(JSON.parse(revise.slice(revise.indexOf('{'))).samples.length, 1);
  assert.equal(SAMPLE_PROMPT_RULES_REVISE.length > 40, true);
  assert.notEqual(SAMPLE_PROMPT_RULES_REVISE, SAMPLE_PROMPT_RULES);
});

test('personaConstraint injects the real voice and never fabricates an author', () => {
  const real = { voice: '贴身视角的冷叙述', tone: '短句', rules: '动作先于情绪', vocab: '' };
  const withReal = personaConstraint(real);
  assert.match(withReal, /用户指定作者人格/);
  assert.match(withReal, /贴身视角的冷叙述/);
  const empty = personaConstraint(null);
  assert.equal(empty, '', 'no persona means no fabricated author');
  // 旧版本地人格（无 voice/tone/rules）保持旧行为兼容，但流水线不再生成它。
  const legacy = personaConstraint({ habit: ['喜欢短句'], flaws: ['偶尔跑题'], education: '高中' });
  assert.match(legacy, /作者人格约束/);
});
