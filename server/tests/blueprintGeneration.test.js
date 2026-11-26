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

function phaseRepairs(blueprint) {
  return { repairs: blueprint.phases.flatMap(phase => phase.subphases.map(stage => ({
    phaseStartChapter: phase.startChapter, subphaseStartChapter: stage.startChapter,
    foreshadowing: stage.foreshadowing, unresolvedQuestions: stage.unresolvedQuestions,
  }))) };
}

test('蓝图为终局预留篇幅并允许最后一个篇章和小阶段收清问题', async () => {
  const s = scenario((call, normal) => {
    assert.match(call.prompt, /第52至60章处理终局/);
    if (!call.name.startsWith('篇章')) return normal;
    const payload = JSON.parse(normal).data.result;
    payload.phases.at(-1).unresolvedQuestions = [];
    payload.phases.at(-1).subphases.at(-1).unresolvedQuestions = [];
    return JSON.stringify(payload);
  });
  const result = await s.run();
  assert.equal(s.calls.length, 3);
  assert.deepEqual(result.phases.at(-1).unresolvedQuestions, []);
  assert.deepEqual(result.phases.at(-1).subphases.at(-1).unresolvedQuestions, []);
  assert.equal(validateStoryBlueprint(result, 60, { requiredTags: ['职场'] }).valid, true);
});

test('分块蓝图：概览事实格式错误且篇章不足时分项补齐，严格组装完整蓝图', async () => {
  const s = scenario((call, normal) => call.name === '全书概览'
    ? JSON.stringify({ mainArc: '保留原先主线', lockedFacts: { invalid: '不能当作事实' }, phases: [] }) : normal);
  const result = await s.run();
  assert.equal(result.mainArc, '保留原先主线');
  assert.deepEqual(result.lockedFacts, s.blueprint.lockedFacts);
  assert.equal(result.phases.length, 10);
  assert.equal(s.calls.filter(call => call.name === '概览事实').length, 1);
  assert.equal(s.calls.filter(call => call.name.startsWith('概览篇章')).length, 10);
  assert.equal(s.calls.length, 15);
  assert.equal(s.usages.length, 15);
  assert.ok(s.statuses.some(status => /分项补齐事实与篇章/.test(status)));
  assert.equal(validateStoryBlueprint(result, 60, { requiredTags: ['职场'] }).valid, true);
  assert.match(s.calls.find(call => call.name === '概览事实').prompt, /禁止编造事实/);
});

test('分块蓝图：只缺事实时保留完整篇章，模型显式返回空事实数组可通过', async () => {
  const s = scenario((call, normal) => {
    if (call.name === '概览事实') return '{"lockedFacts":[]}';
    if (call.name !== '全书概览') return normal;
    const payload = JSON.parse(normal).data.result;
    delete payload.lockedFacts;
    return JSON.stringify(payload);
  });
  const result = await s.run();
  assert.deepEqual(result.lockedFacts, []);
  assert.deepEqual(result.phases, s.blueprint.phases);
  assert.deepEqual(s.calls.map(call => call.name), ['全书概览', '全书概览', '概览事实', '篇章第1-60章', '执行卡第1-20章']);
});

test('分块蓝图：概览重试退化时仍保留前次有效主线与篇章和后次有效事实', async () => {
  const s = scenario((call, normal) => {
    if (call.name !== '全书概览') return normal;
    const payload = JSON.parse(normal).data.result;
    if (!call.attempt) delete payload.lockedFacts;
    else { payload.mainArc = ''; payload.lockedFacts = []; payload.phases = payload.phases.slice(0, 1); }
    return JSON.stringify(payload);
  });
  const result = await s.run();
  assert.equal(result.mainArc, s.blueprint.mainArc);
  assert.deepEqual(result.lockedFacts, []);
  assert.deepEqual(result.phases, s.blueprint.phases);
  assert.equal(s.calls.length, 4, '保留跨尝试的有效字段，不重复请求事实和篇章');
});

test('分块蓝图：概览事实缺失不改变已有效分配到后续篇章的标签', async () => {
  const s = scenario((call, normal) => {
    if (call.name !== '全书概览') return normal;
    const payload = JSON.parse(normal).data.result;
    delete payload.lockedFacts;
    payload.phases.slice(0, -1).forEach(phase => { phase.tagCommitments = []; });
    return JSON.stringify(payload);
  });
  await s.run();
  assert.equal(s.calls.filter(call => call.name.startsWith('概览篇章')).length, 0);
  assert.match(s.calls.find(call => call.name.startsWith('篇章')).prompt, /"title":"篇章10"/);
});

test('分块蓝图：缺失主线时单独补齐，保留已有效的事实和篇章', async () => {
  const s = scenario((call, normal) => {
    if (call.name !== '全书概览') return normal;
    const payload = JSON.parse(normal).data.result;
    payload.mainArc = null;
    return JSON.stringify(payload);
  });
  const result = await s.run();
  assert.equal(result.mainArc, s.blueprint.mainArc);
  assert.deepEqual(result.lockedFacts, s.blueprint.lockedFacts);
  assert.deepEqual(s.calls.map(call => call.name), ['全书概览', '全书概览', '概览主线', '篇章第1-60章', '执行卡第1-20章']);
});

test('分块蓝图：概览事实分项补齐仍返回错误类型时停止，不静默替换为空数组', async () => {
  for (const lockedFacts of [null, '不合法的事实', { fact: '不是数组' }, [{}]]) {
    const s = scenario((call, normal) => {
      if (call.name === '全书概览') return JSON.stringify({ mainArc: '主线', lockedFacts, phases: [] });
      if (call.name === '概览事实') return JSON.stringify({ lockedFacts });
      return normal;
    });
    await assert.rejects(s.run(), error => error.code === 'BLUEPRINT_PART_INVALID'
      && error.diagnostics.part === '概览事实' && error.diagnostics.attempt === 2);
    assert.equal(s.calls.length, 4);
  }
});

test('分块蓝图：概览单篇章仍越界时停止，不生成空壳篇章或继续正文计划', async () => {
  const s = scenario((call, normal) => {
    if (call.name === '全书概览') return JSON.stringify({ mainArc: '主线', lockedFacts: [], phases: [] });
    if (call.name.startsWith('概览篇章')) return JSON.stringify({ phase: { title: '越界篇章', goal: '目标', startChapter: 1, endChapter: 60 } });
    return normal;
  });
  await assert.rejects(s.run(), error => error.code === 'BLUEPRINT_PART_INVALID'
    && error.diagnostics.part === '概览篇章第1-6章');
  assert.equal(s.calls.length, 4);
});

test('分块蓝图：概览分项补齐取消后不发后续请求，已返回用量仍入账', async () => {
  const controller = new AbortController();
  const s = scenario((call, normal) => {
    if (call.name === '全书概览') return JSON.stringify({ mainArc: '主线', lockedFacts: null, phases: [] });
    controller.abort();
    return normal;
  }, controller.signal);
  await assert.rejects(s.run(), { name: 'AbortError' });
  assert.equal(s.calls.length, 3);
  assert.equal(s.usages.length, 3);
});

test('分块蓝图：63章小阶段遗漏伏笔和未决问题时只补字段，完整覆盖超过12条错误的目标', async () => {
  const blueprint = fixture();
  const last = blueprint.phases.at(-1);
  last.endChapter = 63;
  last.subphases.at(-1).endChapter = 63;
  const calls = [], statuses = [], usages = [];
  const result = await generateBlueprintParts({ context: '原始大纲：河湾夜班', totalChapters: 63,
    arcCount: 10, rollingEnd: 20, requiredTags: ['职场'],
    onStatus: status => statuses.push(status), onUsage: usage => usages.push(usage),
    request: async call => {
      calls.push(call);
      if (call.name === '篇章第1-63章' && call.attempt) {
        assert.match(call.prompt, /仅补齐缺失字段，不重写篇章/);
        assert.match(call.prompt, /"subphaseStartChapter":58/);
        assert.match(call.prompt, /原始大纲：河湾夜班/);
        assert.doesNotMatch(call.prompt, /从头返回本块/);
        return { content: JSON.stringify(phaseRepairs(blueprint)) };
      }
      const payload = structuredClone(part(call.name, blueprint));
      if (call.name.startsWith('篇章')) payload.phases.forEach(phase => phase.subphases.forEach(stage => {
        delete stage.foreshadowing; delete stage.unresolvedQuestions;
      }));
      return { content: JSON.stringify(payload) };
    },
  });
  assert.equal(calls.length, 4);
  assert.equal(usages.length, 4);
  assert.ok(statuses.some(status => /仅补齐缺失字段/.test(status)));
  assert.equal(result.phases.length, 10);
  assert.equal(result.phases[0].title, blueprint.phases[0].title);
  assert.equal(result.phases[0].subphases[0].goal, blueprint.phases[0].subphases[0].goal);
  assert.deepEqual(result.phases, blueprint.phases);
  const validation = validateStoryBlueprint(result, 63, { requiredTags: ['职场'] });
  assert.equal(validation.valid, true, validation.errors.join('；'));
});

test('分块蓝图：支持只补一个字段及篇章本身，已有字段保持原值', async () => {
  const baseline = fixture();
  const s = scenario((call, normal) => {
    if (!call.name.startsWith('篇章')) return normal;
    if (call.attempt) return JSON.stringify({ repairs: [
      { phaseStartChapter: 1, subphaseStartChapter: null, foreshadowing: baseline.phases[0].foreshadowing },
      { phaseStartChapter: 1, subphaseStartChapter: 1, unresolvedQuestions: baseline.phases[0].subphases[0].unresolvedQuestions,
        foreshadowing: [{ name: '不应覆盖', plan: '不应覆盖' }] },
    ] });
    const payload = part(call.name, fixture());
    delete payload.phases[0].foreshadowing;
    delete payload.phases[0].subphases[0].unresolvedQuestions;
    return JSON.stringify(payload);
  });
  const result = await s.run();
  assert.deepEqual(result.phases, baseline.phases);
});

test('分块蓝图：字段补齐不能篡改已通过的剧情和章节范围', async () => {
  const s = scenario((call, normal) => {
    if (!call.name.startsWith('篇章')) return normal;
    if (call.attempt) {
      const patch = phaseRepairs(fixture());
      patch.repairs.forEach(item => { item.title = '篡改标题'; item.endChapter = 999; });
      return JSON.stringify(patch);
    }
    const payload = part(call.name, fixture());
    payload.phases.forEach(phase => phase.subphases.forEach(stage => {
      delete stage.foreshadowing; delete stage.unresolvedQuestions;
    }));
    return JSON.stringify(payload);
  });
  const result = await s.run();
  assert.deepEqual(result.phases, s.blueprint.phases);
  assert.equal(s.calls.length, 4);
});

test('分块蓝图：字段补齐遇到空内容、重复或未知目标仍严格拒绝且不无限重试', async () => {
  for (const mutate of [
    patch => { patch.repairs[0].foreshadowing = []; },
    patch => { patch.repairs[0].unresolvedQuestions = []; },
    patch => { patch.repairs[0].foreshadowing = [{ name: '伏笔' }]; },
    patch => { patch.repairs[0].subphaseStartChapter = 999; },
    patch => { patch.repairs[1] = patch.repairs[0]; },
    patch => { patch.repairs.pop(); },
  ]) {
    const s = scenario((call, normal) => {
      if (!call.name.startsWith('篇章')) return normal;
      if (call.attempt) {
        const patch = phaseRepairs(fixture()); mutate(patch);
        return JSON.stringify(patch);
      }
      const payload = part(call.name, fixture());
      payload.phases.forEach(phase => phase.subphases.forEach(stage => {
        delete stage.foreshadowing; delete stage.unresolvedQuestions;
      }));
      return JSON.stringify(payload);
    });
    await assert.rejects(s.run(), error => error.code === 'BLUEPRINT_PART_INVALID'
      && error.diagnostics.expectedField === 'repairs');
    assert.equal(s.calls.length, 3);
    assert.equal(s.usages.length, 3);
  }
});

test('分块蓝图：60章通过3个任务组装完整三级结构', async () => {
  const s = scenario();
  const blueprint = await s.run();
  assert.deepEqual(s.calls.map(call => call.name), ['全书概览', '篇章第1-60章', '执行卡第1-20章']);
  assert.equal(s.usages.length, 3);
  assert.equal(s.failures.length, 0);
  assert.equal(s.calls[0].maxTokens, 16000, '概览块预算');
  assert.equal(s.calls[1].maxTokens, 32000, '篇章块预算');
  assert.equal(s.calls[2].maxTokens, 24000, '执行卡块预算');
  assert.deepEqual(blueprint.phases, s.blueprint.phases);
  assert.deepEqual(blueprint.rollingPlan.chapters, s.blueprint.rollingPlan.chapters);
  assert.equal(blueprint.rollingPlan.endChapter, 20);
  const normalized = normalizeProposedBlueprint(blueprint, { storyBlueprint: {}, storyBible: {}, plotThreads: [] }, 60);
  const validation = validateStoryBlueprint(normalized, 60, { requiredTags: ['职场'] });
  assert.equal(validation.valid, true, validation.errors.join(';'));
  assert.match(s.statuses.at(-1), /3\/3/);
  assert.ok(s.calls[1].prompt.includes(s.blueprint.mainArc));
  assert.match(s.calls[1].prompt, /reversal标明关键选择发生在第几章及其结果/);
  assert.match(s.calls[2].prompt, /篇章转折和伏笔按已定章号兑现/);
  assert.ok(s.calls[2].prompt.includes(s.blueprint.phases[0].exitCondition));
});

test('分块蓝图：每次只返回一个完整篇章时逐批补齐，保留已完成篇章且不重复请求', async () => {
  const s = scenario((call, normal) => {
    if (!call.name.startsWith('篇章')) return normal;
    const payload = JSON.parse(normal).data.result;
    payload.phases = [payload.phases[0]];
    return JSON.stringify(payload);
  });
  const blueprint = await s.run();
  assert.deepEqual(blueprint.phases, s.blueprint.phases);
  assert.equal(s.calls.length, 12, '概览、10次篇章请求、执行卡');
  assert.deepEqual(s.calls.filter(call => call.name.startsWith('篇章')).map(call => call.name),
    Array.from({ length: 10 }, (_, i) => `篇章第${i * 6 + 1}-60章`));
  assert.equal(s.usages.length, 12);
  assert.match(s.calls[2].prompt, /上一批最后一个篇章的衔接约束/);
  assert.ok(s.statuses.some(status => /数量不符，保留1个已校验篇章/.test(status)));
});

test('分块蓝图：只返回跨全书的错误篇章时递归缩小到单篇章，保持原定范围', async () => {
  const s = scenario((call, normal) => {
    if (!call.name.startsWith('篇章')) return normal;
    const payload = JSON.parse(normal).data.result;
    if (payload.phases.length > 1) {
      payload.phases = [{ ...payload.phases[0], endChapter: payload.phases.at(-1).endChapter }];
    }
    return JSON.stringify(payload);
  });
  const blueprint = await s.run();
  assert.deepEqual(blueprint.phases, s.blueprint.phases);
  assert.equal(s.calls.length, 21, '10个叶子篇章、9个拆分节点、概览和执行卡');
  assert.equal(s.calls.filter(call => call.name === '篇章第1-60章').length, 1);
});

test('分块蓝图：保留后面的有效篇章，补前面的缺项时传递其进入条件', async () => {
  const s = scenario((call, normal) => {
    if (call.name !== '篇章第1-60章') return normal;
    const payload = JSON.parse(normal).data.result;
    return JSON.stringify({ phases: [payload.phases.at(-1)] });
  });
  const result = await s.run();
  assert.deepEqual(result.phases, s.blueprint.phases);
  assert.deepEqual(s.calls.map(call => call.name), ['全书概览', '篇章第1-60章', '篇章第1-54章', '执行卡第1-20章']);
  assert.match(s.calls[2].prompt, /下一已确定篇章的衔接约束/);
  assert.ok(s.calls[2].prompt.includes(s.blueprint.phases.at(-1).entryCondition));
});

test('分块蓝图：数量不符时不保留重复或缺字段的篇章，取消后不继续补齐', async () => {
  const controller = new AbortController();
  const s = scenario((call, normal) => {
    if (!call.name.startsWith('篇章')) return normal;
    if (call.name !== '篇章第1-60章') { controller.abort(); return normal; }
    const payload = JSON.parse(normal).data.result;
    return JSON.stringify({ phases: [payload.phases[0], payload.phases[0], { ...payload.phases[1], characterBeats: [] }] });
  }, controller.signal);
  await assert.rejects(s.run(), { name: 'AbortError' });
  assert.equal(s.calls.length, 3);
  assert.equal(s.usages.length, 3);
  assert.ok(s.statuses.some(status => /保留0个已校验篇章/.test(status)));
  assert.equal(s.calls.at(-1).name, '篇章第1-30章');
});

test('分块蓝图：单篇章仍持续返回空列表时只重试一次并停止，不能无限拆分', async () => {
  const s = scenario((call, normal) => call.name.startsWith('篇章') ? '{"phases":[]}' : normal);
  await assert.rejects(s.run(), error => error.code === 'BLUEPRINT_PART_INVALID'
    && error.diagnostics.part === '篇章第1-6章' && error.diagnostics.attempt === 2);
  assert.deepEqual(s.calls.map(call => call.name), [
    '全书概览', '篇章第1-60章', '篇章第1-30章', '篇章第1-18章', '篇章第1-12章', '篇章第1-6章', '篇章第1-6章',
  ]);
});

test('分块蓝图：输出不完整时仅拆分当前批次，保留此前成果和所有调用用量', async () => {
  const s = scenario((call, normal) => ['篇章第1-60章', '执行卡第1-20章'].includes(call.name) ? '{"截断":' : normal);
  const blueprint = await s.run();
  assert.deepEqual(blueprint.phases, s.blueprint.phases);
  assert.deepEqual(blueprint.rollingPlan.chapters, s.blueprint.rollingPlan.chapters);
  assert.deepEqual(s.calls.map(call => call.name), [
    '全书概览', '篇章第1-60章', '篇章第1-30章', '篇章第31-60章',
    '执行卡第1-20章', '执行卡第1-10章', '执行卡第11-20章',
  ]);
  assert.equal(s.usages.length, 7);
  assert.match(s.calls[3].prompt, /上一批最后一个篇章的衔接约束：\{"title":"篇章5","endChapter":30/);
  assert.ok(s.calls[6].prompt.includes(s.blueprint.rollingPlan.chapters[9].title));
  assert.ok(s.statuses.some(status => /2\/3.*拆成两批/.test(status)));
  assert.equal(s.failures.length, 2);
});

test('分块蓝图：拆分后的批次继续截断时仅修复一次，停止后续调用', async () => {
  const s = scenario((call, normal) => call.name.startsWith('篇章') ? '{"phases":' : normal);
  await assert.rejects(s.run(), { code: 'BLUEPRINT_PART_INVALID' });
  assert.deepEqual(s.calls.map(call => call.name), ['全书概览', '篇章第1-60章', '篇章第1-30章', '篇章第1-30章']);
});

test('分块蓝图：空执行卡不能通过数组检查，一次修复失败后停止', async () => {
  const s = scenario((call, normal) => call.name === '执行卡第1-20章'
    ? JSON.stringify({ chapters: Array(20).fill(null) }) : normal);
  await assert.rejects(s.run(), error => error.code === 'BLUEPRINT_PART_INVALID'
    && error.diagnostics.part === '执行卡第1-20章' && error.diagnostics.attempt === 2);
  assert.equal(s.calls.length, 4);
  assert.equal(s.calls.at(-1).name, '执行卡第1-20章');
  assert.equal(s.failures.length, 2);
});

test('分块蓝图：重叠范围、空人物、空伏笔或遗漏标签都在当前块拦截', async () => {
  for (const mutate of [
    phase => { phase.subphases[1].startChapter = 1; },
    phase => { phase.characterBeats = [{}]; },
    phase => { phase.foreshadowing = [null]; },
    phase => { phase.tagCommitments = ['别的内容']; phase.subphases.forEach(stage => { stage.tagCommitments = ['别的内容']; }); },
    phase => { phase.subphases = [null]; },
    phase => { phase.subphases = '错误类型'; },
  ]) {
    const s = scenario((call, normal) => {
      if (call.name !== '篇章第1-60章') return normal;
      const value = part(call.name, fixture());
      mutate(value.phases[0]);
      return JSON.stringify(value);
    });
    await assert.rejects(s.run(), { code: 'BLUEPRINT_PART_INVALID' });
    assert.equal(s.calls.length, 3);
  }
});

test('分块蓝图：错误概览不会带着断层或缺失标签进入篇章生成', async () => {
  for (const phases of [[null], fixture().phases.map(phase => ({ ...phase, tagCommitments: [] }))]) {
    const s = scenario(() => JSON.stringify({ mainArc: '主线', lockedFacts: ['设定'], phases }));
    await assert.rejects(s.run(), error => error.code === 'BLUEPRINT_PART_INVALID' && error.diagnostics.part === '概览篇章第1-6章');
    assert.equal(s.calls.length, 4);
    assert.ok(!s.calls.some(call => call.name.startsWith('篇章') || call.name.startsWith('执行卡')));
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
    if (call.name !== '篇章第1-60章') return normal;
    const value = part(call.name, fixture());
    value.phases[0].subphases[1].requiredScenes = [];
    value.phases[0].subphases[0].characterBeats = [{ character: '周行舟', goal: '减少返工' }];
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
  const s = scenario((call, normal) => call.name === '执行卡第1-20章'
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
      if (call.name.startsWith('篇章')) {
        for (const phase of payload.phases) {
          delete phase.tagCommitments;
          phase.subphases.forEach(subphase => { delete subphase.tagCommitments; });
        }
      }
      if (payload.chapters) payload.chapters.forEach(card => { delete card.tagCommitments; });
      return { content: JSON.stringify(payload) };
    },
  });
  const normalized = normalizeProposedBlueprint(result, { storyBlueprint: {}, storyBible: {}, plotThreads: [] }, 60);
  const validation = validateStoryBlueprint(normalized, 60);
  assert.equal(validation.valid, true, validation.errors.join(';'));
});

test('分块蓝图：短篇与超长篇均按三块完整覆盖', async () => {
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
    assert.equal(calls, 3);
    assert.equal(result.phases.at(-1).endChapter, totalChapters);
    assert.equal(result.rollingPlan.chapters.at(-1).chapterNumber, rollingEnd);
  }
});
