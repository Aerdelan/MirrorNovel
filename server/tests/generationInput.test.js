const test = require('node:test');
const assert = require('node:assert/strict');
const { captureGenerationInput, readGenerationInput } = require('../services/generationInput');

test('creation inputs retain controls and independent blueprint/SKU copies without retaining model credentials', () => {
  const body = { novelTypeId: 'mystery', gender: 'female', mode: 'chapter', targetWordCount: 7000, chapterWordTarget: 5000,
    protagonistName: '林舟', worldSetting: '雨夜旧城', outline: '原始大纲', expertMode: true, personaId: 'persona',
    typeSku: { channel: 'female', category: 'mystery', elements: ['case'], tones: ['warm'], apiKey: 'secret' },
    referenceIds: ['ref1'], referenceExamplesEnabled: true, structurePattern: '冲突、选择',
    enableResearch: false, researchLinks: ['https://example.test/source'], storyBlueprint: { mainArc: '原蓝图', phases: [{ goal: '找到信' }] },
    modelConfig: { apiKey: 'secret' }, headers: { authorization: 'secret' } };
  const snapshot = captureGenerationInput(body);
  assert.equal(snapshot.mode, 'chapter'); assert.equal(snapshot.gender, 'female');
  assert.equal(snapshot.enableResearch, false); assert.equal(snapshot.expertMode, true);
  assert.deepEqual(snapshot.referenceIds, ['ref1']); assert.deepEqual(snapshot.researchLinks, body.researchLinks);
  body.storyBlueprint.phases[0].goal = '后来改的'; body.typeSku.elements.push('later');
  assert.equal(snapshot.storyBlueprint.phases[0].goal, '找到信');
  assert.deepEqual(snapshot.typeSku.elements, ['case']);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|authorization|modelConfig/);
  const restored = readGenerationInput({ generationInput: snapshot, outline: '生成后的大纲' });
  assert.equal(restored.exact, true); assert.equal(restored.input.outline, '原始大纲');
});

test('older books return an explicit partial restoration instead of claiming an original snapshot', () => {
  const restored = readGenerationInput({ novelTypeId: 'urban', protagonistName: '旧人物', outline: '现有大纲', targetWordCount: 900000, chapterWordTarget: 5000,
    referenceStyleSnapshot: [{ referenceId: 'r1', keyExcerpts: ['示例'] }], writingPersonaId: 'p1' });
  assert.equal(restored.exact, false);
  assert.equal(restored.input.targetWordCount, 900000); assert.equal(restored.input.chapterWordTarget, 5000);
  assert.equal(restored.input.personaId, 'p1'); assert.deepEqual(restored.input.referenceIds, ['r1']);
});
