const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFallbackChapterPlan, buildChapterContract } = require('../services/storyState');
const { constrainChapterPlan, planningWindow, validateDetailedPlan, ensureDetailedLongFormPlan } = require('../services/longFormPlanning');
const { VERSION, hash } = require('../services/semanticMemory');

function fixture() {
  const novel = {
    targetWordCount: 900000, chapterWordTarget: 5000, currentWordCount: 100000,
    outline: '刘海柱核对货损账目、查明外包责任，终局保住仓库并离开虚职。',
    chapters: Array.from({ length: 20 }, (_, index) => ({ chapterNumber: index + 1, title: `旧章${index + 1}`, content: `已写事实${index + 1}，签收记录已经交给刘海柱。` })),
    chapterSummaryDoc: '第20章：关键发展：确认外包伪造签名。章末：刘海柱约外包负责人当面对质。',
    storyBlueprint: { mainArc: '查明仓库账目与签收责任', lockedFacts: ['伪造签名来自外包'], phases: [] },
    markModified() {},
  };
  const planData = buildFallbackChapterPlan(novel);
  for (const chapter of planData.chapters.slice(0, 20)) Object.assign(chapter, { raw: '', title: `旧计划${chapter.chapterNumber}`, coreEvent: `已确定事件${chapter.chapterNumber}` });
  novel.chapterPlanData = planData;
  novel.chapterPlan = JSON.stringify(planData);
  return { novel, planData };
}

function result(numbers) {
  return { content: JSON.stringify({ chapters: numbers.map(number => ({ chapterNumber: number,
    title: `签收疑点${number}`, coreEvent: `刘海柱核对编号${number}的签收单，找到对应责任人并取得口供。`,
  })) }) };
}

test('a fixed plan fills internal gaps and ends exactly at the requested chapter', () => {
  const { novel, planData } = fixture();
  const authored = { chapterNumber: 37, title: '原始账本', coreEvent: '刘海柱读到被隐瞒的交接时间' };
  const earlyDraft = { chapterNumber: 100, setHooks: ['以后再解答的悬念'], resolveHooks: ['缺页账本'] };
  planData.chapters = [...planData.chapters.slice(0, 20), authored, { chapterNumber: 101 }, { chapterNumber: 30.5 }, { ...authored }, earlyDraft];
  const fixed = constrainChapterPlan(novel, planData, 100);
  assert.deepEqual(fixed.chapters.map(chapter => chapter.chapterNumber), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.deepEqual(fixed.chapters.slice(0, 20), planData.chapters.slice(0, 20));
  assert.equal(fixed.chapters[36], authored);
  assert.equal(fixed.chapters[20].raw, '本地兜底计划');
  assert.deepEqual(fixed.chapters.at(-1), { chapterNumber: 100, chapterRole: '收束', setHooks: [], resolveHooks: ['缺页账本'] });
  assert.deepEqual(earlyDraft.setHooks, ['以后再解答的悬念']);
  const single = constrainChapterPlan({ outline: '旧案解决', chapterWordTarget: 2000 }, { chapters: [] }, 1);
  assert.equal(single.chapters.length, 1);
  assert.equal(single.chapters[0].chapterRole, '收束');
});

test('the last fixed planning window hands remaining hooks and closing scenes to the planner', async () => {
  const { novel, planData } = fixture();
  Object.assign(novel, { targetWordCount: 99000, targetChapterCount: 100,
    foreshadowingLedger: [{ id: 'case', content: '签收页背面的日期', setChapter: 19, targetChapter: 96, status: 'pending' }] });
  await ensureDetailedLongFormPlan({ novel, planData, chapterNumber: 96, totalChapters: 100,
    requestPlan: async prompt => {
      assert.match(prompt, /第86至100章是终局/);
      assert.match(prompt, /签收页背面的日期（原定第96章）/);
      assert.match(prompt, /在第100章明确全书结局/);
      const plan = JSON.parse(result([96, 97, 98, 99, 100]).content);
      plan.chapters[0].setHooks = ['全新的谜题'];
      return { content: JSON.stringify(plan) };
    },
  });
  assert.deepEqual(planData.chapters[95].setHooks, []);
  assert.equal(planData.chapters[99].chapterRole, '收束');
});

test('an early planning batch preserves confirmed payoff chapters when the planner omits or moves them', async () => {
  const { novel, planData } = fixture();
  novel.storyBlueprint.phases = [{ startChapter: 21, endChapter: 25, exitCondition: '仓库签收责任已查清' }];
  novel.foreshadowingLedger = [
    { id: 'receipt', content: '签收联上的改签痕迹', setChapter: 19, targetChapter: 22, payoffPlan: '拿原始联对照笔迹', status: 'pending' },
    { id: 'amended', content: '外包修改过的账目', setChapter: 20, targetChapter: 23, status: 'pending' },
    { id: 'later', content: '等候查验的货损档案', setChapter: 36, targetChapter: 40, status: 'planned' },
    { id: 'proposal', content: '模型猜测的丢失印章', setChapter: 20, targetChapter: 24, status: 'planned', setupStatus: 'unconfirmed' },
  ];
  const savedEarlier = structuredClone(planData.chapters.slice(0, 20));
  await ensureDetailedLongFormPlan({ novel, planData, chapterNumber: 21, totalChapters: 180,
    requestPlan: async prompt => {
      assert.match(prompt, /签收联上的改签痕迹（原定第22章）：拿原始联对照笔迹/);
      assert.match(prompt, /外包修改过的账目（原定第23章）/);
      assert.match(prompt, /离开条件：仓库签收责任已查清/);
      assert.doesNotMatch(prompt, /等候查验的货损档案|模型猜测的丢失印章/);
      const plan = JSON.parse(result([21, 22, 23, 24, 25]).content);
      plan.chapters[0].resolveHooks = ['签收联上的 改签痕迹', '等候查验的货损档案'];
      return { content: JSON.stringify(plan) };
    },
  });
  assert.deepEqual(planData.chapters.slice(0, 20), savedEarlier);
  assert.deepEqual(planData.chapters[20].resolveHooks, []);
  assert.deepEqual(planData.chapters[21].resolveHooks, ['签收联上的改签痕迹']);
  assert.deepEqual(planData.chapters[22].resolveHooks, ['外包修改过的账目']);
});

test('detailed plans are requested at exhaustion, not at a fixed written word count', () => {
  const { novel, planData } = fixture();
  assert.deepEqual(planningWindow(novel, planData, 20, 180), []);
  assert.deepEqual(planningWindow(novel, planData, 21, 180), [21, 22, 23, 24, 25, 26, 27, 28]);
  novel.currentWordCount = 40000;
  assert.equal(planningWindow(novel, planData, 21, 180).length, 8);
  novel.targetWordCount = 50000;
  assert.deepEqual(planningWindow(novel, planData, 21, 30), []);
});

test('batches stop before authored future chapters and honor the final chapter', () => {
  const { novel, planData } = fixture();
  Object.assign(planData.chapters[22], { raw: '', title: '已定转折', coreEvent: '外包负责人交出原始签收单' });
  assert.deepEqual(planningWindow(novel, planData, 21, 180), [21, 22]);
  assert.deepEqual(planningWindow(novel, planData, 21, 21), [21]);
});

test('invalid numbering, truncation, generic events and duplicate titles are rejected', () => {
  assert.throws(() => validateDetailedPlan('{"chapters":[', [21, 22]));
  assert.throws(() => validateDetailedPlan(result([21, 21]).content, [21, 22]));
  assert.throws(() => validateDetailedPlan(result([21, 23]).content, [21, 22]));
  const rows = JSON.parse(result([21, 22]).content);
  rows.chapters[1].coreEvent = '沿主线调查，逐步扩大代价（第22章，严格承接前章结果）';
  assert.throws(() => validateDetailedPlan(JSON.stringify(rows), [21, 22]));
  rows.chapters[1] = { ...rows.chapters[0], chapterNumber: 22 };
  assert.throws(() => validateDetailedPlan(JSON.stringify(rows), [21, 22]));
});

test('fresh batches require authored titles and cannot repeat the previous batch verbatim', () => {
  const chapter = JSON.parse(result([21]).content).chapters[0];
  assert.throws(() => validateDetailedPlan(JSON.stringify({ chapters: [{ ...chapter, title: '' }] }), [21]));
  assert.throws(() => validateDetailedPlan(JSON.stringify({ chapters: [chapter] }), [21], [{ ...chapter, chapterNumber: 20 }]));
});

test('refinement preserves committed chapters, authored plans, inherited constraints and target lengths', async () => {
  const { novel, planData } = fixture();
  const committed = structuredClone(novel.chapters);
  const oldPlan = structuredClone(planData.chapters.slice(0, 20));
  planData.chapters[20].forbiddenDrift = ['禁止变成系统升级故事'];
  let usage = 0;
  let prompt;
  assert.equal(await ensureDetailedLongFormPlan({ novel, planData, chapterNumber: 21, totalChapters: 180,
    requestPlan: async input => { prompt = input; return result([21, 22, 23, 24, 25, 26, 27, 28]); }, onUsage: () => usage++,
  }), true);
  assert.match(prompt, /已写事实20/);
  assert.match(prompt, /外包伪造签名/);
  assert.deepEqual(novel.chapters, committed);
  assert.deepEqual(planData.chapters.slice(0, 20), oldPlan);
  assert.deepEqual(planData.chapters[20].forbiddenDrift, ['禁止变成系统升级故事']);
  assert.equal(planData.chapters[20].wordTarget, 5000);
  assert.equal(usage, 1);
  assert.equal(JSON.parse(novel.chapterPlan).chapters[20].title, '签收疑点21');
  const contract = buildChapterContract({ novel, planData, chapterNumber: 21, totalChapters: 180 });
  assert.equal(contract.title, '签收疑点21');
  assert.match(contract.coreEvent, /找到对应责任人/);
  await ensureDetailedLongFormPlan({ novel, planData, chapterNumber: 21, totalChapters: 180,
    requestPlan: async () => assert.fail('resume must reuse the saved plan'),
  });
});

test('bad output is retried once without persisting a partial plan', async () => {
  const { novel, planData } = fixture();
  const before = JSON.stringify(planData);
  let calls = 0;
  await assert.rejects(ensureDetailedLongFormPlan({ novel, planData, chapterNumber: 21, totalChapters: 180,
    requestPlan: async () => { calls++; return result([21]); },
  }), /详细计划校验失败/);
  assert.equal(calls, 2);
  assert.equal(JSON.stringify(planData), before);
});

test('a corrected retry is used and both model attempts are charged to usage', async () => {
  const { novel, planData } = fixture();
  let calls = 0;
  let usage = 0;
  await ensureDetailedLongFormPlan({ novel, planData, chapterNumber: 21, totalChapters: 21,
    requestPlan: async prompt => { calls++; if (calls === 2) assert.match(prompt, /上次结构校验失败/); return calls === 1 ? { content: '' } : result([21]); },
    onUsage: () => usage++,
  });
  assert.equal(usage, 2);
  assert.equal(planData.chapters[20].title, '签收疑点21');
});

test('planning a resumed chapter is constrained by its existing draft', async () => {
  const { novel, planData } = fixture();
  await ensureDetailedLongFormPlan({ novel, planData, chapterNumber: 21, totalChapters: 21,
    draft: '刘海柱已从档案柜取出签收原件，正准备与外包负责人核对。',
    requestPlan: async prompt => {
      assert.match(prompt, /已有待恢复草稿/);
      assert.match(prompt, /已从档案柜取出签收原件/);
      assert.match(prompt, /不得另起情节或推翻草稿/);
      return result([21]);
    },
  });
});

test('rolling refinement receives bounded raw event and handoff evidence from valid recent chapter memory', async () => {
  const { novel, planData } = fixture();
  const saved = novel.chapters[18];
  const recovered = '操作手鞋舌里滑出B-7铁门钥匙。';
  const custody = '贺兰青将钥匙揣进自己的口袋。';
  saved.content = `走廊铺着地砖。\n${recovered}\n\n${custody}\n\n${'众人离开走廊。'.repeat(160)}`;
  saved.memorySummary = { version: VERSION, chapterNumber: 19, sourceHash: hash(saved.content), summary: '交接',
    events: [{ text: '正文里没有的供词。', evidence: '正文里没有的证词。' }, { text: '发现钥匙', evidence: recovered }] };
  const edited = novel.chapters[19];
  const stale = '作废的旧记录表明钥匙已经归还。';
  edited.content = `${stale}\n${'开庭前屋里很安静。'.repeat(120)}`;
  edited.memorySummary = { version: VERSION, chapterNumber: 20, sourceHash: hash('编辑前正文'), summary: '过期的交接',
    events: [{ text: '过期的交接', evidence: stale }] };
  let calls = 0;
  await ensureDetailedLongFormPlan({ novel, planData, chapterNumber: 21, totalChapters: 21,
    requestPlan: async prompt => {
      calls++;
      const section = prompt.split('【已完成章节的关键动作原文】\n')[1].split('【阶段记忆】')[0];
      assert.ok(section.includes(`${recovered}\n\n${custody}`));
      assert.doesNotMatch(section, /作废的旧记录|正文里没有/);
      assert.ok(section.length <= 420);
      return result([21]);
    },
  });
  assert.equal(calls, 1);
});

test('approved concrete cards are reused without spending a planning call or rewriting the blueprint', async () => {
  const { novel, planData } = fixture();
  novel.storyBlueprint.rollingPlan = { startChapter: 21, endChapter: 28, chapters: [{ chapterNumber: 21,
    title: '签收原件', purpose: '外包交出原始签收单，刘海柱确定货损责任人。' }] };
  const card = structuredClone(novel.storyBlueprint.rollingPlan.chapters[0]);
  await ensureDetailedLongFormPlan({ novel, planData, chapterNumber: 21, totalChapters: 180,
    requestPlan: async () => assert.fail('approved execution card must be reused'),
  });
  assert.equal(planData.chapters[20].title, '签收原件');
  assert.equal(planData.chapters[20].coreEvent, card.purpose);
  assert.deepEqual(novel.storyBlueprint.rollingPlan.chapters[0], card);
});

test('local refinement stays inside the active approved subphase', () => {
  const { novel, planData } = fixture();
  novel.storyBlueprint.phases = [{ startChapter: 1, endChapter: 80,
    subphases: [{ startChapter: 21, endChapter: 23 }, { startChapter: 24, endChapter: 50 }] }];
  assert.deepEqual(planningWindow(novel, planData, 21, 180), [21, 22, 23]);
});

test('long outlines supply the requested chapter ranges without adding planning calls', async () => {
  const { novel, planData } = fixture();
  novel.outline = [
    '全书背景：外包责任与仓库存续',
    '前段细节'.repeat(4000),
    '## 第301章至第304章',
    '刘海柱在董事会上出示原始签收联。',
    '**第305章** 决定辞去虚职。',
    '第309章：下一阶段秘密',
    '过渡内容'.repeat(3000),
    '全书终局：主角保住仓库',
  ].join('\n');

  let calls = 0;
  await ensureDetailedLongFormPlan({ novel, planData, chapterNumber: 301, totalChapters: 400,
    requestPlan: async prompt => {
      calls++;
      const excerpt = prompt.split('【原始大纲】\n')[1].split('【三级动态故事蓝图')[0];
      assert.match(excerpt, /全书背景：外包责任与仓库存续/);
      assert.match(excerpt, /第301章至第304章\n刘海柱在董事会上出示原始签收联/);
      assert.match(excerpt, /第305章\*\* 决定辞去虚职/);
      assert.doesNotMatch(excerpt, /下一阶段秘密/);
      assert.match(excerpt, /全书终局：主角保住仓库/);
      assert.ok(excerpt.length <= 14000);
      return result([301, 302, 303, 304, 305, 306, 307, 308]);
    },
  });
  assert.equal(calls, 1);
});

test('long outlines without matching chapter headings retain the original context fallback', async () => {
  const { novel, planData } = fixture();
  novel.outline = `原始背景${'无章号的正文'.repeat(3000)}终局约束`;
  await ensureDetailedLongFormPlan({ novel, planData, chapterNumber: 21, totalChapters: 21,
    requestPlan: async prompt => {
      assert.match(prompt, /原始背景/);
      assert.match(prompt, /大纲中段由已确认篇章约束承载/);
      assert.match(prompt, /终局约束/);
      return result([21]);
    },
  });
});

test('multiple batches keep chapters 21-60 concrete and preserve all earlier plans', async () => {
  const { novel, planData } = fixture();
  const original = structuredClone(planData.chapters.slice(0, 20));
  let calls = 0;
  for (let number = 21; number <= 60; number++) {
    await ensureDetailedLongFormPlan({ novel, planData, chapterNumber: number, totalChapters: 60,
      requestPlan: async prompt => {
        calls++;
        const [, start, end] = prompt.match(/细化未来第(\d+)-(\d+)章/);
        return result(Array.from({ length: Number(end) - Number(start) + 1 }, (_, index) => Number(start) + index));
      },
    });
    assert.match(planData.chapters[number - 1].coreEvent, /对应责任人/);
    assert.equal(planData.chapters[number - 1].raw, '模型分批细化计划');
  }
  assert.equal(calls, 5);
  assert.deepEqual(planData.chapters.slice(0, 20), original);
});
