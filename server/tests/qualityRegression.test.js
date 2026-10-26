const test = require('node:test');
const assert = require('node:assert/strict');
const routeModule = require('../routes/novel');
const { finalizeGeneratedChapter } = routeModule;
const { buildStyleContext, REVISE_PURPOSE_NOTE } = require('../services/styleContext');
const { buildSamplesPrompt, SAMPLE_PROMPT_RULES, SAMPLE_PROMPT_RULES_REVISE } = require('../services/writingSamples');
const { buildPreferenceBlock } = require('../services/writingStyle');
const { personaConstraint } = require('../services/editorialEngine');
const { validateFeedbackInput, MAX_FEEDBACK_TEXT_CHARS } = require('../services/writingStyle');

const sentence = '窗外的雨没有停，他把那封信折好放回抽屉，关门时又停了一会儿，直到楼道的灯亮起来。';
const snapshot = () => ({
  revisionId: 'r1', version: 1,
  samples: [{ sampleId: 's1', title: '雨夜', sceneType: 'action', notes: '', content: sentence }],
  preferences: [{ preferenceId: 'p1', statement: '每章结尾停在未完成的动作上，不做情绪总结。', reason: 'pacing' }],
  sampleBudget: { maxCount: 3, maxCharsPerSample: 240 },
});
const makeNovel = () => ({ novelTypeId: 'test', novelTypeName: '测试', chapters: [] });

test('duplicate chapter writes are blocked and leave the committed chapter untouched (A5 checklist)', () => {
  const novel = { novelTypeId: 'test', novelTypeName: '测试', chapters: [], markModified() {} };
  const first = finalizeGeneratedChapter({ novel, chapterNumber: 3, rawContent: sentence.repeat(4), contract: { chapterNumber: 3, title: '雨夜' }, protagonistName: '林舟' });
  assert.equal(novel.chapters.length, 1);
  assert.equal(novel.chapters[0].chapterNumber, 3);
  assert.equal(first.content, novel.chapters[0].content);
  const committed = novel.chapters[0].content;
  assert.throws(
    () => finalizeGeneratedChapter({ novel, chapterNumber: 3, rawContent: sentence.repeat(6), contract: { chapterNumber: 3, title: '雨夜' }, protagonistName: '林舟' }),
    error => error.message.includes('已阻止重复写入'),
  );
  assert.equal(novel.chapters.length, 1, 'the duplicate must not be appended');
  assert.equal(novel.chapters[0].content, committed, 'the committed chapter must stay byte-identical');
});

test('persona, samples and preferences compose into one prompt with consistent priority statements (A5 checklist)', () => {
  const persona = { name: '冷峻声线', voice: '贴身视角的冷叙述', tone: '短句', rules: '动作先于情绪出现', vocab: '' };
  const prose = buildStyleContext(snapshot(), 'prose', { chapterNumber: 2 });
  const revise = buildStyleContext(snapshot(), 'revise');
  const personaBlock = personaConstraint(persona);
  for (const [label, block] of [['prose', prose.block], ['revise', revise.block]]) {
    const combined = `${personaBlock}${block}`;
    assert.ok(combined.includes('贴身视角的冷叙述'), `${label}: persona voice must survive composition`);
    assert.ok(combined.includes('每章结尾停在未完成的动作上'), `${label}: preference must survive composition`);
    assert.ok(combined.includes('【作者认可的写作样稿】'), `${label}: sample block must survive composition`);
    assert.ok(
      combined.includes('写作人格') && (combined.includes('始终优先') || combined.includes('以后者为准')),
      `${label}: the work-facts-over-style priority must be stated where samples appear`,
    );
  }
  assert.match(prose.block, /不要机械套用样稿的句长/);
  assert.match(revise.block, /原文是唯一的事实基准/);
  assert.ok(!revise.block.includes('不要机械套用样稿的句长'), 'revise context must not reuse the prose boundary');
});

test('input budgets clamp samples, preferences and feedback storage consistently (A5 checklist)', () => {
  const long = sentence.repeat(120);
  const clampedSamples = buildSamplesPrompt([{ title: 'a', sceneType: 'action', notes: '', content: long }], { purpose: 'revise' });
  const payload = JSON.parse(clampedSamples.slice(clampedSamples.indexOf('{')));
  assert.equal(payload.samples[0].content.length, 240);
  const clampedPrefs = buildPreferenceBlock([{ statement: '规则：' + long, reason: 'manual' }]);
  const prefPayload = JSON.parse(clampedPrefs.slice(clampedPrefs.indexOf('{')));
  assert.equal(prefPayload.preferences[0].statement.length, 200);
  const feedback = validateFeedbackInput({ originalText: long, revisedText: long.replace('雨', '雪'), reason: 'pacing' });
  assert.equal(feedback.originalSlice.length, MAX_FEEDBACK_TEXT_CHARS);
  assert.equal(feedback.originalLength, long.length, 'full length is audited even when storage is sliced');
});
