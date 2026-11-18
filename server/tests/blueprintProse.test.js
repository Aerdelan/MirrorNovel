const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBlueprintProse } = require('../services/blueprintProse');
const { generateBlueprintParts } = require('../services/blueprintGeneration');
const { normalizeProposedBlueprint, validateStoryBlueprint, buildChapterContract, renderChapterContract } = require('../services/storyState');
const { buildChapterPlan } = require('../services/aiService');
const fixture = require('./fixtures/initialBlueprint');
const prosePart = require('./fixtures/blueprintProsePart');

test('prose blueprint preserves paragraphs and literal punctuation without requiring optional JSON fields', () => {
  const body = '周行舟找到写着“{待核对}”的旧账本。\n他拒绝把责任推给司机，选择公开账目，并承担由此造成的回款损失。这个职场选择改变了同事对他的判断。';
  const parsed = parseBlueprintProse(`## 篇章 3｜第 13—18 章｜责任表\n${body}`, 'phases', ['职场']).parsed;
  assert.equal(parsed.phases[0].planText, body);
  assert.equal(parsed.phases[0].startChapter, 13);
  assert.equal(parsed.phases[0].entryCondition, undefined);
  assert.equal(parsed.phases[0].subphases, undefined);
  assert.deepEqual(parsed.phases[0].tagCommitments, ['职场']);
});

test('prose blueprint completes all three stages, persists and reaches chapter prompts and contracts', async () => {
  const source = fixture(), calls = [], usages = [];
  const raw = await generateBlueprintParts({ context: '夜班交接大纲', totalChapters: 60, arcCount: 10, rollingEnd: 20,
    requiredTags: ['职场'], outputStyle: 'prose', onUsage: result => usages.push(result),
    request: async call => { calls.push(call); return { content: prosePart(call.name, source), finishReason: 'stop' }; } });
  assert.equal(calls.length, 3);
  assert.equal(usages.length, 3);
  assert.ok(calls.every(call => call.prompt.includes('不输出JSON')));
  const novel = { protagonistName: '周行舟', targetWordCount: 300000, outline: '夜班交接大纲', storyBlueprint: {}, storyBible: {}, plotThreads: [] };
  novel.storyBlueprint = normalizeProposedBlueprint(raw, novel, 60);
  const validation = validateStoryBlueprint(novel.storyBlueprint, 60, { requiredTags: ['职场'] });
  assert.equal(validation.valid, true, validation.errors.join(';'));
  assert.ok(novel.storyBlueprint.phases[0].planText.includes('重新核对现场证据'));
  const Novel = require('../models/Novel');
  const persisted = new Novel({ title: '夜班', userId: '507f1f77bcf86cd799439011', storyBlueprint: novel.storyBlueprint }).toObject();
  assert.equal(persisted.storyBlueprint.phases[0].planText, novel.storyBlueprint.phases[0].planText);
  assert.equal(persisted.storyBlueprint.rollingPlan.chapters[0].planText, novel.storyBlueprint.rollingPlan.chapters[0].planText);
  const contract = buildChapterContract({ novel, chapterNumber: 1, totalChapters: 60, targetWords: 300000 });
  assert.match(renderChapterContract(contract), /重新核对现场证据/);
  assert.match(renderChapterContract(contract), /具体口语回应质疑/);
  assert.match(buildChapterPlan(novel.outline, 300000, '周行舟', '', null, novel.storyBlueprint, 5000), /重新核对现场证据/);
});

test('prose coverage still rejects missing execution chapters and short empty plans', async () => {
  const source = fixture();
  await assert.rejects(generateBlueprintParts({ context: '夜班', totalChapters: 60, arcCount: 10, rollingEnd: 20, outputStyle: 'prose',
    request: async call => ({ content: call.name.startsWith('执行卡') ? '【第1章｜标题】\n继续推进。' : prosePart(call.name, source) }),
  }), error => error.code === 'BLUEPRINT_PART_INVALID' && error.diagnostics.part.startsWith('执行卡'));
  const parsed = parseBlueprintProse('不包含任何篇章或章节标题的一段话', 'phases');
  assert.equal(parsed.parsed, null);
  assert.equal(parsed.reason, 'invalid_text');
});

test('truncated prose is split before it can be marked complete, with usage retained', async () => {
  const source = fixture(), calls = [], usages = [];
  const raw = await generateBlueprintParts({ context: '夜班', totalChapters: 60, arcCount: 10, rollingEnd: 20, outputStyle: 'prose',
    onUsage: result => usages.push(result), request: async call => {
      calls.push(call);
      return { content: prosePart(call.name, source), finishReason: call.name === '篇章第1-60章' ? 'length' : 'stop' };
    } });
  assert.equal(raw.phases.length, 10);
  assert.equal(calls.length, 5);
  assert.equal(usages.length, 5);
  assert.deepEqual(calls.slice(1, 4).map(call => call.name), ['篇章第1-60章', '篇章第1-30章', '篇章第31-60章']);
});
