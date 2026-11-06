const test = require('node:test');
const assert = require('node:assert/strict');
const { generateBlueprintParts } = require('../services/blueprintGeneration');
const { validateStoryBlueprint, normalizeProposedBlueprint, blueprintRequirements } = require('../services/storyState');
const fixture = require('./fixtures/initialBlueprint');
const part = require('./fixtures/blueprintPart');

function scenario(override, signal) {
  const blueprint = fixture(), calls = [], failures = [], statuses = [], usages = [];
  const run = () => generateBlueprintParts({
    context: '河湾夜班：周行舟的职场小说；保留口语与自嘲。',
    totalChapters: 60, arcCount: 10, rollingEnd: 20, requiredTags: ['职场'], signal,
    request: async call => {
      calls.push(call);
      const normal = JSON.stringify({ data: { result: part(call.name, blueprint) } });
      return { content: override ? await override(call, normal) : normal, usage: { completion_tokens: 100 } };
    },
    onStatus: status => statuses.push(status), onFailure: error => failures.push(error), onUsage: usage => usages.push(usage),
  });
  return { run, blueprint, calls, failures, statuses, usages };
}

test('分块蓝图：60章拆为15个有界任务，服务端组装完整三级结构', async () => {
  const s = scenario();
  const blueprint = await s.run();
  assert.equal(s.calls.length, 15);
  assert.equal(s.usages.length, 15);
  assert.equal(s.failures.length, 0);
  assert.equal(s.calls[0].maxTokens, 16000, '概览块预算');
  assert.ok(s.calls.slice(1, 11).every(call => call.maxTokens === 32000), '篇章块预算');
  assert.ok(s.calls.slice(11).every(call => call.maxTokens === 24000), '执行卡块预算');
  assert.deepEqual(blueprint.phases, s.blueprint.phases);
  assert.deepEqual(blueprint.rollingPlan.chapters, s.blueprint.rollingPlan.chapters);
  assert.equal(blueprint.rollingPlan.endChapter, 20);
  const normalized = normalizeProposedBlueprint(blueprint, { storyBlueprint: {}, storyBible: {}, plotThreads: [] }, 60);
  const validation = validateStoryBlueprint(normalized, 60, { requiredTags: ['职场'] });
  assert.equal(validation.valid, true, validation.errors.join(';'));
  assert.match(s.statuses.at(-1), /15\/15/);
  assert.match(s.calls[2].prompt, /已完成篇章的衔接约束/);
});

test('分块蓝图：截断只重试当前篇章，保留前面成果和所有调用用量', async () => {
  const s = scenario((call, normal) => call.name === '篇章第13-18章' && call.attempt === 0 ? '{"phase":{"title":"截断"}' : normal);
  const blueprint = await s.run();
  assert.equal(blueprint.phases.length, 10);
  assert.equal(s.calls.length, 16);
  assert.equal(s.usages.length, 16);
  assert.equal(s.calls.filter(call => call.name === '全书概览').length, 1);
  assert.equal(s.calls.filter(call => call.name === '篇章第7-12章').length, 1);
  const retry = s.calls.find(call => call.attempt === 1);
  assert.equal(retry.name, '篇章第13-18章');
  assert.match(retry.prompt, /上次本块校验失败/);
  assert.equal(s.failures.length, 1);
});

test('分块蓝图：空条目不能通过数组检查，修复两次失败后停止，不发后续任务', async () => {
  const s = scenario((call, normal) => call.name === '执行卡第6-10章'
    ? JSON.stringify({ chapters: [null, null, null, null, null] }) : normal);
  await assert.rejects(s.run(), error => error.code === 'BLUEPRINT_PART_INVALID'
    && error.diagnostics.part === '执行卡第6-10章' && error.diagnostics.attempt === 2);
  assert.equal(s.calls.length, 14);
  assert.equal(s.calls.at(-1).name, '执行卡第6-10章');
  assert.equal(s.failures.length, 2);
});

test('分块蓝图：重叠范围、空人物、空伏笔或遗漏标签都在当前块拦截', async () => {
  for (const mutate of [
    value => { value.phase.subphases[1].startChapter = 1; },
    value => { value.phase.characterBeats = [{}]; },
    value => { value.phase.foreshadowing = [null]; },
    value => { value.phase.tagCommitments = ['别的内容']; value.phase.subphases.forEach(stage => { stage.tagCommitments = ['别的内容']; }); },
    value => { value.phase.subphases = [null]; },
  ]) {
    const s = scenario((call, normal) => {
      if (call.name !== '篇章第1-6章') return normal;
      const value = part(call.name, fixture()); mutate(value); return JSON.stringify(value);
    });
    await assert.rejects(s.run(), { code: 'BLUEPRINT_PART_INVALID' });
    assert.equal(s.calls.length, 3);
  }
});

test('分块蓝图：错误概览不会带着断层或缺失标签进入篇章生成', async () => {
  for (const phases of [[null], fixture().phases.map(phase => ({ ...phase, tagCommitments: [] }))]) {
    const s = scenario(() => JSON.stringify({ mainArc: '主线', lockedFacts: ['设定'], phases }));
    await assert.rejects(s.run(), error => error.code === 'BLUEPRINT_PART_INVALID' && error.diagnostics.part === '全书概览');
    assert.equal(s.calls.length, 2);
  }
});

test('分块蓝图：取消后不继续请求，已返回用量仍记录', async () => {
  const controller = new AbortController();
  const s = scenario((_call, normal) => { controller.abort(); return normal; }, controller.signal);
  await assert.rejects(s.run(), { name: 'AbortError' });
  assert.equal(s.calls.length, 1);
  assert.equal(s.usages.length, 1);
});

test('分块蓝图：缺字段的错误文案定位到具体小阶段与键，不改变拦截强度', async () => {
  const s = scenario((call, normal) => {
    if (call.name !== '篇章第1-6章') return normal;
    const value = part(call.name, fixture());
    value.phase.subphases[1].requiredScenes = [];
    value.phase.subphases[0].characterBeats = [{ character: '周行舟', goal: '减少返工' }];
    return JSON.stringify(value);
  });
  await assert.rejects(s.run(), error => {
    assert.equal(error.code, 'BLUEPRINT_PART_INVALID');
    assert.ok(error.diagnostics.errors.some(item => item.includes('小阶段2缺少requiredScenes')), error.diagnostics.errors.join(';'));
    assert.ok(error.diagnostics.errors.some(item => item.includes('小阶段1的characterBeats不完整') && item.includes('conflict')), error.diagnostics.errors.join(';'));
    assert.match(error.message, /原因：part_invalid/);
    return true;
  });
  assert.equal(s.calls.length, 3);
});

test('分块蓝图：缺顶层字段时记录模型实际返回的键名，不记录故事正文', async () => {
  const s = scenario((call, normal) => call.name === '执行卡第1-5章'
    ? JSON.stringify({ cards: [{ chapterNumber: 1 }] }) : normal);
  await assert.rejects(s.run(), error => {
    assert.equal(error.diagnostics.reason, 'missing_field');
    assert.equal(error.diagnostics.expectedField, 'chapters');
    assert.deepEqual(error.diagnostics.foundKeys, ['cards']);
    assert.match(error.diagnostics.errors[0], /没有顶层字段“chapters”/);
    return true;
  });
});

test('分块蓝图：未选任何标签时允许省略 tagCommitments，其余字段仍严格', async () => {
  const blueprint = fixture();
  const result = await generateBlueprintParts({
    context: '未选择任何 SKU 标签的旧类型路径', totalChapters: 60, arcCount: 10, rollingEnd: 20, requiredTags: [],
    request: async call => {
      const payload = part(call.name, blueprint);
      if (payload.phase) {
        delete payload.phase.tagCommitments;
        payload.phase.subphases.forEach(subphase => { delete subphase.tagCommitments; });
      }
      if (payload.chapters) payload.chapters.forEach(card => { delete card.tagCommitments; });
      return { content: JSON.stringify(payload) };
    },
  });
  const normalized = normalizeProposedBlueprint(result, { storyBlueprint: {}, storyBible: {}, plotThreads: [] }, 60);
  const validation = validateStoryBlueprint(normalized, 60);
  assert.equal(validation.valid, true, validation.errors.join(';'));
});

test('分块蓝图：短篇与超长篇均完整覆盖，最后一批执行卡允许不足5章', async () => {
  for (const totalChapters of [1, 7, 23, 400]) {
    const { arcCount, rollingChapterCount: rollingEnd } = blueprintRequirements(totalChapters);
    const blueprint = fixture(), source = blueprint.phases[0];
    blueprint.phases = Array.from({ length: arcCount }, (_, i) => {
      const startChapter = Math.floor(i * totalChapters / arcCount) + 1;
      const endChapter = Math.floor((i + 1) * totalChapters / arcCount);
      const stage = { ...source, startChapter, endChapter };
      return { ...stage, subphases: [{ ...stage, subphases: undefined }] };
    });
    blueprint.rollingPlan.chapters = blueprint.rollingPlan.chapters.slice(0, rollingEnd);
    let calls = 0;
    const result = await generateBlueprintParts({ context: '书籍大纲', totalChapters, arcCount, rollingEnd,
      request: async call => { calls++; return { content: JSON.stringify(part(call.name, blueprint)) }; } });
    const validation = validateStoryBlueprint(result, totalChapters);
    assert.equal(validation.valid, true, validation.errors.join(';'));
    assert.equal(calls, 1 + arcCount + Math.ceil(rollingEnd / 5));
    assert.equal(result.phases.at(-1).endChapter, totalChapters);
    assert.equal(result.rollingPlan.chapters.at(-1).chapterNumber, rollingEnd);
  }
});
