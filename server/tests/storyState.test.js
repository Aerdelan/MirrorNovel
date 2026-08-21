const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseChapterPlan,
  buildFallbackChapterPlan,
  buildEmotionPlan,
  buildChapterContract,
  checkChapterContinuity,
  updateCreativeState,
  seedPlannedHooks,
  getAdaptiveChapterWordTarget,
  getChapterOutputTokenLimit,
  assessStoryCompletion,
  ensureStoryBlueprint,
  normalizeProposedBlueprint,
  applyStoryBlueprint,
  renderStoryBlueprintForContext,
} = require('../services/storyState');

function makeNovel(overrides = {}) {
  return {
    novelTypeName: '悬疑',
    outline: '主角追查一桩被掩盖多年的旧案。',
    worldSetting: '一座长期阴雨的旧城。',
    targetWordCount: 24000,
    storyBible: {},
    characterStates: [],
    plotThreads: [{
      id: 'main',
      title: '旧案主线',
      type: 'main',
      status: 'active',
      nextMilestone: '找到失踪证人的去向',
      lastChapter: 0,
    }],
    foreshadowingLedger: [],
    emotionCurve: [],
    recentEventSignatures: [],
    ...overrides,
  };
}

test('parseChapterPlan normalizes JSON plans and legacy line plans', () => {
  const jsonPlan = parseChapterPlan(`\`\`\`json
  {
    "version": 2,
    "phases": ["开端", "追查"],
    "chapters": [
      {
        "chapterNumber": 1,
        "wordTarget": 2800,
        "coreEvent": "雨夜收到匿名包裹",
        "setHooks": "铜钥匙,烧焦的照片",
        "characters": ["林舟", "苏晚"],
        "chapterRole": "主线推进",
        "tension": 12
      },
      { "chapterNumber": 2, "coreEvent": "追查包裹来源" },
      { "chapterNumber": 0, "coreEvent": "无效章节" }
    ]
  }
  \`\`\``);

  assert.equal(jsonPlan.version, 2);
  assert.deepEqual(jsonPlan.phases, ['开端', '追查']);
  assert.equal(jsonPlan.chapters.length, 2);
  assert.equal(jsonPlan.chapters[0].tension, 10);
  assert.equal(jsonPlan.chapters[1].tension, 0);
  assert.deepEqual(jsonPlan.chapters[0].setHooks, ['铜钥匙', '烧焦的照片']);

  const legacyPlan = parseChapterPlan([
    '阶段1：开端',
    '第1章（2600字）：雨夜来客 | 埋伏笔：铜钥匙 | 关键角色：林舟、苏晚',
    '第2章（3000字）：追查账本 | 回收伏笔：铜钥匙',
  ].join('\n'));

  assert.equal(legacyPlan.chapters.length, 2);
  assert.equal(legacyPlan.chapters[0].chapterNumber, 1);
  assert.equal(legacyPlan.chapters[0].wordTarget, 2600);
  assert.deepEqual(legacyPlan.chapters[0].setHooks, ['铜钥匙']);
  assert.deepEqual(legacyPlan.chapters[1].resolveHooks, ['铜钥匙']);

  const compactPlan = parseChapterPlan('{"version":1,"chapters":[[1,2400,"收到来信","旧钥匙","","林舟","主线推进",5],[2,2400,"追查来源","","旧钥匙","林舟","信息揭示",6]]}');
  assert.equal(compactPlan.chapters.length, 2);
  assert.equal(compactPlan.chapters[0].wordTarget, 2400);
  assert.deepEqual(compactPlan.chapters[1].resolveHooks, ['旧钥匙']);

  const fallback = buildFallbackChapterPlan(makeNovel({ targetWordCount: 10000 }), { targetWords: 10000 });
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.chapters.length, 4);
  assert.equal(fallback.chapters.at(-1).chapterRole, '收束');
});

test('buildChapterContract selects the current plan and hides future hooks', () => {
  const repeatedEvent = '林舟已经拒绝了旧码头的交易';
  const novel = makeNovel({
    foreshadowingLedger: [
      { id: 'future', content: '四楼窗后的影子', setChapter: 3, status: 'planned' },
      { id: 'planned-past', content: '没有寄件人的邮票', setChapter: 1, status: 'planned' },
      { id: 'pending', content: '铜钥匙上的裂纹', setChapter: 1, status: 'pending' },
    ],
    recentEventSignatures: [repeatedEvent],
  });
  const planData = parseChapterPlan({
    chapters: [{
      chapterNumber: 2,
      wordTarget: 3100,
      coreEvent: '潜入废弃邮局寻找寄件记录',
      setHooks: ['值班表上被涂掉的名字'],
      resolveHooks: ['没有寄件人的邮票'],
      characters: ['林舟', '苏晚'],
      chapterRole: '信息揭示',
      tension: 7,
      phase: '追查阶段',
    }],
  });

  const contract = buildChapterContract({
    novel,
    chapterNumber: 2,
    totalChapters: 8,
    planData,
    currentWords: 2800,
    targetWords: 24000,
    previousChapter: { content: '雨停前，林舟把那枚没有寄件人的邮票夹进了证物袋。' },
  });

  assert.equal(contract.chapterNumber, 2);
  assert.equal(contract.wordTarget, 3100);
  assert.equal(contract.coreEvent, '潜入废弃邮局寻找寄件记录');
  assert.deepEqual(contract.characters, ['林舟', '苏晚']);
  assert.deepEqual(contract.setHooks, ['值班表上被涂掉的名字']);
  assert.deepEqual(contract.resolveHooks, ['没有寄件人的邮票']);
  assert.deepEqual(contract.pendingHooks.map((hook) => hook.id), ['planned-past', 'pending']);
  assert.ok(contract.mustNot.some((rule) => rule.includes(repeatedEvent)));
  assert.ok(contract.previousEnd.includes('证物袋'));
});

test('buildEmotionPlan inserts a restrained breathing chapter after sustained pressure', () => {
  const novel = makeNovel({
    novelTypeName: '沉重悬疑',
    emotionCurve: [
      { chapterNumber: 1, tension: 8 },
      { chapterNumber: 2, tension: 7 },
      { chapterNumber: 3, tension: 9 },
    ],
  });

  const emotion = buildEmotionPlan(novel, 4, 10, {
    chapterRole: '主线推进',
    tension: 9,
  });

  assert.equal(emotion.isBreath, true);
  assert.equal(emotion.chapterRole, '喘息推进');
  assert.ok(emotion.tension >= 2 && emotion.tension <= 5);
  assert.ok(emotion.tone.length > 10);
});

test('long-form budget is redistributed across remaining planned chapters', () => {
  const planData = parseChapterPlan({
    chapters: [
      { chapterNumber: 1, wordTarget: 3000, coreEvent: '开场' },
      { chapterNumber: 2, wordTarget: 6000, coreEvent: '转折' },
      { chapterNumber: 3, wordTarget: 3000, coreEvent: '收束' },
    ],
  });

  const first = getAdaptiveChapterWordTarget({ planData, chapterNumber: 1, currentWords: 0, targetWords: 12000, totalChapters: 3 });
  const second = getAdaptiveChapterWordTarget({ planData, chapterNumber: 2, currentWords: first, targetWords: 12000, totalChapters: 3 });
  const endingAfterTarget = getAdaptiveChapterWordTarget({ planData, chapterNumber: 3, currentWords: 13000, targetWords: 12000, totalChapters: 3 });

  assert.ok(second > first, '较重的计划章节应获得更高预算');
  assert.ok(endingAfterTarget >= 1200, '达到目标字数后仍应保留收束章节预算');
  assert.ok(getChapterOutputTokenLimit(first) < 16384);
});

test('story completion requires target words, every plan chapter, and required hook resolution', () => {
  const planData = parseChapterPlan({
    chapters: [
      { chapterNumber: 1, coreEvent: '埋下钥匙线索' },
      { chapterNumber: 2, coreEvent: '回收钥匙线索' },
      { chapterNumber: 3, coreEvent: '完成结局' },
    ],
  });
  const novel = makeNovel({
    targetWordCount: 1800,
    chapters: [
      { chapterNumber: 1, wordCount: 900 },
      { chapterNumber: 2, wordCount: 1000 },
    ],
    foreshadowingLedger: [{ id: 'key', content: '铜钥匙', targetChapter: 2, status: 'pending' }],
  });

  let result = assessStoryCompletion(novel, planData, 1800);
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingChapters, [3]);
  assert.deepEqual(result.unresolvedHooks, ['铜钥匙']);

  novel.chapters.push({ chapterNumber: 3, wordCount: 300 });
  novel.foreshadowingLedger[0].status = 'resolved';
  result = assessStoryCompletion(novel, planData, 1800);
  assert.equal(result.complete, true);
});

test('planned foreshadowing cannot resolve before its target chapter', () => {
  const hookText = '铜钥匙上的裂纹';
  const planData = parseChapterPlan({
    chapters: [
      { chapterNumber: 2, coreEvent: '主角拿到钥匙', setHooks: [hookText], tension: 6 },
      { chapterNumber: 3, coreEvent: '主角核对旧照片', tension: 6 },
      { chapterNumber: 4, coreEvent: '裂纹对应地下室门锁', resolveHooks: [hookText], tension: 8 },
    ],
  });
  const novel = makeNovel();
  seedPlannedHooks(novel, planData);

  const hook = novel.foreshadowingLedger[0];
  assert.equal(hook.status, 'planned');
  assert.equal(hook.setChapter, 2);
  assert.equal(hook.targetChapter, 4);

  const chapterOne = buildChapterContract({ novel, chapterNumber: 1, totalChapters: 6, planData });
  assert.equal(chapterOne.pendingHooks.some((item) => item.content === hookText), false);

  const chapterTwo = buildChapterContract({ novel, chapterNumber: 2, totalChapters: 6, planData });
  updateCreativeState(
    novel,
    2,
    `林舟拿起那把旧钥匙，第一次看清${hookText}，但他还不知道它意味着什么。`,
    chapterTwo,
    { eventSignature: '林舟拿到旧钥匙' }
  );
  assert.equal(hook.status, 'pending');

  const chapterThree = buildChapterContract({ novel, chapterNumber: 3, totalChapters: 6, planData });
  updateCreativeState(
    novel,
    3,
    `照片里也能看见${hookText}，这只能证明钥匙曾经出现过，答案仍然未知。`,
    chapterThree,
    { eventSignature: '林舟核对旧照片' }
  );
  assert.equal(hook.status, 'pending');

  const chapterFour = buildChapterContract({ novel, chapterNumber: 4, totalChapters: 6, planData });
  updateCreativeState(
    novel,
    4,
    `林舟终于发现${hookText}正好对应地下室门锁的缺口，并据此打开了暗门。`,
    chapterFour,
    { eventSignature: '林舟打开地下室暗门' }
  );
  assert.equal(hook.status, 'resolved');
  assert.equal(hook.resolvedChapter, 4);
});

test('checkChapterContinuity reports repeated events and produces a deterministic quality report', () => {
  const repeated = '林舟决定返回旧码头寻找失踪证人，却发现仓库门口留下了一串新鲜脚印。';
  const longRepeated = Array.from({ length: 24 }, () => repeated).join('');
  const repetitionReport = checkChapterContinuity(
    longRepeated,
    { content: longRepeated },
    { wordTarget: 1200, coreEvent: '' }
  );

  assert.equal(repetitionReport.issues.length, 1);
  assert.equal(repetitionReport.score, 80);
  assert.ok(repetitionReport.eventSignature.length > 0);

  const weakText = '仿佛一切都没有发生。好像雨声也停了。不禁让人迟疑。微微一笑。一双眼中闪过冷光。嘴角勾起弧度。';
  const qualityReport = checkChapterContinuity(weakText, null, {
    wordTarget: 2000,
    coreEvent: '找到失踪档案，揭露旧案真相',
  });

  assert.equal(qualityReport.issues.length, 3);
  assert.equal(qualityReport.score, 40);
  assert.equal(typeof qualityReport.eventSignature, 'string');
});

test('updateCreativeState updates signatures, emotion and hooks without duplicates', () => {
  const novel = makeNovel();
  const contract = {
    chapterNumber: 1,
    totalChapters: 8,
    setHooks: ['一张被剪去日期的车票'],
    resolveHooks: [],
    emotion: {
      tension: 6,
      tone: '克制而紧张',
      chapterRole: '主线推进',
      isBreath: false,
    },
  };
  const content = '林舟决定收起那张被剪去日期的车票，先去车站查清它的来源。';
  const continuity = { eventSignature: '林舟决定去车站追查车票' };

  updateCreativeState(novel, 1, content, contract, continuity);
  updateCreativeState(novel, 1, content, contract, continuity);

  assert.deepEqual(novel.recentEventSignatures, ['林舟决定去车站追查车票']);
  assert.equal(novel.emotionCurve.length, 1);
  assert.deepEqual(novel.emotionCurve[0], {
    chapterNumber: 1,
    tension: 6,
    tone: '克制而紧张',
    chapterRole: '主线推进',
  });
  assert.equal(novel.foreshadowingLedger.length, 1);
  assert.equal(novel.foreshadowingLedger[0].status, 'pending');
  assert.equal(novel.foreshadowingLedger[0].setChapter, 1);
});

test('story blueprint stays conservative until a proposal is explicitly applied', () => {
  const novel = makeNovel({ protagonistName: '林舟', worldSetting: '旧城', targetWordCount: 30000 });
  const initial = ensureStoryBlueprint(novel, 10);
  assert.equal(initial.version, 1);
  assert.ok(initial.mainArc.includes('主角追查'));
  assert.equal(initial.phases.length, 1);
  assert.ok(renderStoryBlueprintForContext(novel, 1, 10).includes('已确认版本 1'));

  const proposed = normalizeProposedBlueprint({
    mainArc: '追查旧案并发现真正的幕后交易',
    phases: [{ title: '反转追查', startChapter: 5, endChapter: 10, goal: '从证人转向幕后交易', threads: ['苏晚的隐瞒'] }],
  }, novel, 10);
  assert.equal(proposed.version, 2);
  assert.equal(novel.storyBlueprint.version, 1);

  applyStoryBlueprint(novel, proposed, 10);
  assert.equal(novel.storyBlueprint.version, 2);
  assert.equal(novel.storyBlueprint.phases[0].title, '反转追查');
  assert.ok(novel.plotThreads.some((thread) => thread.title === '苏晚的隐瞒'));
});
