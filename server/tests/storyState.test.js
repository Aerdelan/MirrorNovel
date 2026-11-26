const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODEL_ROLLING_PLAN,
  parseChapterPlan,
  deriveChapterTitle,
  resolveChapterTitle,
  buildFallbackChapterPlan,
  buildEmotionPlan,
  buildChapterContract,
  renderChapterContract,
  checkChapterContinuity,
  updateCreativeState,
  seedPlannedHooks,
  getAdaptiveChapterWordTarget,
  getChapterOutputTokenLimit,
  getClosingWindowStart,
  assessStoryCompletion,
  matchHookResolutionEvidence,
  ensureStoryBlueprint,
  ensureRollingPlanCoverage,
  blueprintRequirements,
  validateStoryBlueprint,
  normalizeProposedBlueprint,
  applyStoryBlueprint,
  renderStoryBlueprintForContext,
  auditChapterForCommit,
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

test('drift guards preserve quoted tag lists and full sentences in plans and contracts', () => {
  const rule = '禁止把所选标签“日系校园、轻松日常、多女主/后宫”稀释成通用网文套路';
  const plan = parseChapterPlan({ chapters: [{ chapterNumber: 3, coreEvent: '招募千鹤', forbiddenDrift: [rule] }] });
  assert.deepEqual(plan.chapters[0].forbiddenDrift, [rule]);
  const novel = makeNovel({ typeSku: { channel: 'male', category: 'acg', theme: 'acg_school', tones: ['richang'], cp: 'multi' } });
  const contract = buildChapterContract({ novel, planData: plan, chapterNumber: 3, targetWordCount: 24000 });
  assert.ok(contract.forbiddenDrift.includes(rule));
  assert.equal(contract.forbiddenDrift.includes('轻松日常'), false);
  assert.match(renderChapterContract(contract), /日系校园、轻松日常、多女主\/后宫/);
});

test('chapter voice profiles keep complete per-character rules and survive a later chapter without beats', () => {
  const sceneVoice = '先问还有谁没到，才说自己害怕；和朋友说话会用反问';
  const novel = makeNovel({
    protagonistName: '傅小满',
    outline: '【人物声音表】\n傅小满：\n句长：遇到急事用短句，平常会慢慢讲。\n沈鹿：\n常用词汇：完了完了、好冷好冷好冷。\n称呼习惯：叫傅小满“小满”。\n陆鸣：\n声线：爱拿船上的事作比方。\n【剧情阶段】',
    storyBlueprint: { phases: [{ startChapter: 1, endChapter: 1, characterBeats: [
      { character: '沈鹿', goal: '找到同伴', change: '愿意求助', voiceGuard: sceneVoice },
    ] }] },
  });
  const planData = parseChapterPlan({ chapters: [
    { chapterNumber: 1, coreEvent: '傅小满听沈鹿说起夜校', characterBeat: '傅小满[目标=找到灯；声线=问完就动手，遇事很少补解释；对朋友也直说]' },
    { chapterNumber: 2, coreEvent: '傅小满和沈鹿一起去找灯' },
  ] });
  const first = buildChapterContract({ novel, planData, chapterNumber: 1, totalChapters: 2 });
  assert.match(first.characterContinuity.find(line => line.startsWith('沈鹿：')), /先问还有谁没到，才说自己害怕；和朋友说话会用反问/);
  assert.match(first.characterContinuity.find(line => line.startsWith('傅小满：')), /问完就动手，遇事很少补解释；对朋友也直说/);
  assert.doesNotMatch(renderChapterContract(first), /好冷好冷好冷/);
  assert.ok(novel.characterBible.find(profile => profile.name === '沈鹿').voiceRules.some(rule => rule.includes('好冷好冷好冷')));
  assert.ok(!first.characterContinuity.some(line => line.startsWith('陆鸣：')));
  updateCreativeState(novel, 1, '沈鹿答应傅小满一起找灯。', first);
  assert.deepEqual(novel.characterBible.map(profile => profile.name).sort(), ['沈鹿', '陆鸣', '傅小满'].sort());

  const reloaded = JSON.parse(JSON.stringify(novel));
  const second = buildChapterContract({ novel: reloaded, planData, chapterNumber: 2, totalChapters: 2 });
  assert.match(renderChapterContract(second), /傅小满：[^\n]+句长：遇到急事用短句/);
  assert.match(renderChapterContract(second), /沈鹿：[^\n]+称呼习惯：叫傅小满“小满”/);
  assert.ok(second.characterContinuity.some(line => line.includes(sceneVoice)));
});

test('campus prose passes both intact and previously fragmented semantic drift guards', () => {
  const content = '白井拓也走过校园，在教室门口等神代千鹤放下书包。'.repeat(50);
  for (const rules of [
    ['禁止把所选标签“日系校园、轻松日常、多女主/后宫”稀释成通用网文套路'],
    ['禁止把所选标签“日系校园', '轻松日常', '多女主/后宫', '日系日常'],
    ['禁止拓也突然变得热血或主动揽责。', '禁止出现校外黑帮或超自然力量介入。'],
  ]) {
    const audit = auditChapterForCommit(content, { wordTarget: 8000, forbiddenDrift: rules });
    assert.equal(audit.passed, true, JSON.stringify(audit.blockers));
  }
});

test('literal word bans and truncated chapter protection still block invalid commits', () => {
  const contract = { wordTarget: 8000, forbiddenDrift: ['禁用词："霸总"、"董事会"'] };
  const valid = '校园里的同学放下书包，走向教室准备值日。'.repeat(50);
  assert.equal(auditChapterForCommit(valid, contract).passed, true);
  assert.match(auditChapterForCommit(valid + '董事会', contract).blockers.join('；'), /明确禁用词：董事会/);
  assert.equal(auditChapterForCommit('内容不足', contract).passed, false);
});

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

test('fallback plan and output budget honor a per-chapter word target for long-form mysteries', () => {
  // 每章 1 万字的大章设定：章数按 1 万字估算，每章 wordTarget 也是 1 万。
  const bigChapterNovel = makeNovel({ targetWordCount: 100000, chapterWordTarget: 10000 });
  const bigFallback = buildFallbackChapterPlan(bigChapterNovel, { targetWords: 100000 });
  assert.equal(bigFallback.chapters.length, 10);
  assert.ok(bigFallback.chapters.every((chapter) => chapter.wordTarget === 10000));

  // 未设置时维持旧口径 3000。
  const defaultFallback = buildFallbackChapterPlan(makeNovel({ targetWordCount: 100000 }), { targetWords: 100000 });
  assert.equal(defaultFallback.chapters.length, 34);
  assert.ok(defaultFallback.chapters.every((chapter) => chapter.wordTarget === 3000));

  // options 显式传入时优先于小说字段。
  const overridden = buildFallbackChapterPlan(bigChapterNovel, { targetWords: 100000, chapterWordTarget: 5000 });
  assert.equal(overridden.chapters.length, 20);
  assert.ok(overridden.chapters.every((chapter) => chapter.wordTarget === 5000));

  // 输出 token 上限按每章字数放大：1 万字章节约 1.35 万 token，
  // 不会被旧的 7600 上限截断；小章节仍保持旧上限。
  assert.equal(getChapterOutputTokenLimit(10000), 13500);
  assert.equal(getChapterOutputTokenLimit(3000), 4051);
  assert.equal(getChapterOutputTokenLimit(1200), 2200);
  assert.equal(getChapterOutputTokenLimit(999999), 24000);

  // 自适应字数分配尊重大章计划的尺度：10 章每章 1 万字的计划，
  // 首章目标字数不应被压回 5200 旧上限。
  const planData = { version: 1, chapters: Array.from({ length: 10 }, (_, index) => ({
    chapterNumber: index + 1, wordTarget: 10000, coreEvent: `推进第${index + 1}步`,
  })) };
  const firstTarget = getAdaptiveChapterWordTarget({ planData, chapterNumber: 1, currentWords: 0, targetWords: 100000 });
  assert.ok(firstTarget >= 8000, `大章计划的字数目标被截短了：${firstTarget}`);
});

test('fallback plans cover exactly the requested chapter range in a fixed-length book', () => {
  const novel = makeNovel({ targetWordCount: 900000, chapterWordTarget: 2000 });
  const tail = buildFallbackChapterPlan(novel, { startChapter: 96, totalChapters: 100 });
  assert.deepEqual(tail.chapters.map(chapter => chapter.chapterNumber), [96, 97, 98, 99, 100]);
  assert.equal(tail.chapters.at(-1).chapterRole, '收束');
  assert.deepEqual(buildFallbackChapterPlan(novel, { startChapter: 101, totalChapters: 100 }).chapters, []);
});

test('late fallback chapters inherit SKU style tags and active blueprint voice constraints', () => {
  const novel = makeNovel({
    novelTypeName: '二次元·日系校园',
    targetWordCount: 180000,
    chapterWordTarget: 3000,
    typeSku: {
      channel: 'male', category: 'acg', theme: 'acg_school',
      elements: ['xiaoguo'], personas: ['aojiao'], tones: ['gaoxiao'], cp: 'single',
    },
    storyBlueprint: {
      version: 2,
      mainArc: '学生会与社团共同筹备学园祭',
      phases: [{
        title: '学园祭冲刺', startChapter: 21, endChapter: 60,
        tagCommitments: ['部活协作', '性格错位喜剧'],
        characterBeats: [{ character: '苍太', goal: '守住社团摊位', conflict: '怕丢脸却总出错', change: '学会求助', voiceGuard: '慌乱时长句跑题' }],
        requiredScenes: ['放学后的部室'],
        forbiddenDrift: ['禁止霸总化', '禁止学生像董事会一样汇报'],
        subphases: [],
      }],
      rollingPlan: { startChapter: 1, endChapter: 20, chapters: [] },
    },
  });

  const fallback = buildFallbackChapterPlan(novel, { targetWords: 180000, startChapter: 41 });
  const late = fallback.chapters.find((chapter) => chapter.chapterNumber === 45);
  assert.ok(late);
  assert.ok(late.tagCommitments.includes('日系校园'));
  assert.ok(late.tagCommitments.includes('搞笑/无厘头'));
  assert.ok(late.tagCommitments.includes('部活协作'));
  assert.match(late.characterBeat, /慌乱时长句跑题/);
  assert.ok(late.requiredScenes.includes('放学后的部室'));
  assert.ok(late.forbiddenDrift.includes('禁止霸总化'));

  const contract = buildChapterContract({ novel, chapterNumber: 45, totalChapters: 60, planData: fallback });
  assert.ok(contract.styleCommitments.includes('日系校园'));
  assert.ok(contract.styleCommitments.includes('搞笑/无厘头'));
  assert.match(contract.characterBeat, /慌乱时长句跑题/);
  assert.match(renderChapterContract(contract), /全书风格\/题材标签（每章持续生效）/);
});

test('chapter plans retain authored short titles and safely derive legacy titles', () => {
  const plan = parseChapterPlan({
    chapters: [[1, 2600, '林舟在旧花店收到无名钥匙', '', '', '林舟', '主线推进', 5, '予地以花']],
  });
  assert.equal(plan.chapters[0].title, '予地以花');
  assert.equal(deriveChapterTitle(plan.chapters[0]), '予地以花');
  assert.equal(deriveChapterTitle({ coreEvent: '林舟在旧花店收到无名钥匙，并决定追查寄件人' }), '林舟在旧花店收到无名钥匙');
});

test('fallback plans and contracts use the approved rolling chapter titles and events', () => {
  const novel = makeNovel({ targetWordCount: 1800000, chapterWordTarget: 8000,
    storyBlueprint: { rollingPlan: { startChapter: 1, endChapter: 20, chapters: [
      { chapterNumber: 1, title: '我的灵魂已经在请假了', purpose: '介绍拓也的生活，引出社团新规' },
      { chapterNumber: 2, title: '被迫营业的第一天', purpose: '拒绝任命失败，拓也接受部长任命' },
    ] } },
  });
  const plan = buildFallbackChapterPlan(novel);
  assert.equal(plan.chapters[0].title, '我的灵魂已经在请假了');
  assert.equal(plan.chapters[1].title, '被迫营业的第一天');
  assert.equal(plan.chapters[1].coreEvent, '拒绝任命失败，拓也接受部长任命');
  assert.equal(plan.chapters.some((chapter) => chapter.title === '开端之变'), false);
  const legacyPlan = { chapters: [{ chapterNumber: 2, title: '开端之变', raw: '本地兜底计划' }] };
  const contract = buildChapterContract({ novel, planData: legacyPlan, chapterNumber: 2, totalChapters: 225 });
  assert.equal(contract.title, '被迫营业的第一天');
});

test('titles preserve authored choices and use prose only when no specific title exists', () => {
  const novel = makeNovel();
  assert.equal(resolveChapterTitle({ novel, chapterNumber: 1, planChapter: { title: '开端之变' } }), '开端之变');
  const planChapter = { title: '开端之变', raw: '本地兜底计划' };
  assert.equal(resolveChapterTitle({ novel, chapterNumber: 1, planChapter, content: '林舟收到匿名包裹。里面放着一枚钥匙。' }), '林舟收到匿名包裹');
  assert.equal(resolveChapterTitle({ novel, chapterNumber: 2, planChapter, content: '苏晚推开旧花店的门。门后有人。' }), '苏晚推开旧花店的门');
  assert.equal(resolveChapterTitle({ novel, chapterNumber: 3, planChapter }), '');
  const synthetic = makeNovel({ storyBlueprint: { rollingPlan: { startChapter: 1, endChapter: 20,
    chapters: [{ chapterNumber: 1, title: '当前主线阶段·第1章', purpose: '建立人物处境（第1章，严格承接前章结果）' }] } } });
  assert.equal(resolveChapterTitle({ novel: synthetic, chapterNumber: 1, planChapter }), '');
});

test('advancing the rolling window retains old authored titles in the durable chapter plan', () => {
  const novel = makeNovel({ storyBlueprint: { rollingPlan: { startChapter: 1, endChapter: 20,
    chapters: [{ chapterNumber: 1, title: '我的灵魂已经在请假了', purpose: '引出社团新规' }] } } });
  const plan = parseChapterPlan({ chapters: [1, 2, 3].map((chapterNumber) => ({ chapterNumber,
    title: chapterNumber === 2 ? '用户选择的标题' : '开端之变', raw: '本地兜底计划' })) });
  ensureRollingPlanCoverage(novel, 3, 10, plan);
  assert.equal(plan.chapters[0].title, '我的灵魂已经在请假了');
  assert.equal(plan.chapters[0].coreEvent, '引出社团新规');
  assert.equal(plan.chapters[1].title, '用户选择的标题');
  assert.equal(resolveChapterTitle({ novel, planChapter: plan.chapters[0], chapterNumber: 1 }), '我的灵魂已经在请假了');
  assert.equal(novel.storyBlueprint.rollingPlan.chapters.some((card) => card.chapterNumber === 1), false);
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

test('a fixed-length book completes at chapter 100 only with every chapter and evidenced ending', () => {
  const conclusionEvidence = '林舟当众交出原始账册，旧案随即获准重审。';
  const settledStateEvidence = '仓库改用公开登记，受害的司机终于领回赔款。';
  const finalChapter = { chapterNumber: 100, wordCount: 200, content: `${conclusionEvidence}\n\n${settledStateEvidence}`, qualityReport: {} };
  const novel = makeNovel({
    targetWordCount: 300000,
    chapters: [...Array.from({ length: 99 }, (_, index) => ({ chapterNumber: index + 1, wordCount: 200 })), finalChapter],
  });
  const plan = { chapters: [] };
  const options = { fixedChapterCount: 100, requireEndingVerification: true };
  const assess = () => assessStoryCompletion(novel, plan, undefined, options);
  assert.equal(assess().complete, false);
  finalChapter.qualityReport.endingVerification = { conclusionEvidence, settledStateEvidence: '正文里从未出现过的结局证据。' };
  assert.equal(assess().endingVerified, false);
  finalChapter.qualityReport.endingVerification.settledStateEvidence = settledStateEvidence;
  assert.equal(assess().wordTargetReached, false);
  assert.equal(assess().complete, true);
  novel.foreshadowingLedger.push({ id: 'terminal-setup', content: '本应在第一百章兑现的新线索', setChapter: 100, status: 'planned' });
  assert.deepEqual(assess().unresolvedHooks, ['本应在第一百章兑现的新线索']);
  assert.equal(assess().complete, false);
  novel.foreshadowingLedger.pop();
  novel.chapters.splice(50, 1, { chapterNumber: 101, wordCount: 200 });
  assert.deepEqual(assess().missingChapters, [51]);
  assert.deepEqual(assess().unexpectedChapters, [101]);
  assert.equal(assess().complete, false);
});

test('the closing window distributes old payoffs before the final chapter', () => {
  const novel = makeNovel({
    storyBlueprint: { mainArc: '调查港口旧案', phases: [{ startChapter: 1, endChapter: 100,
      exitCondition: '货运赔偿制度公开执行', unresolvedQuestions: ['仍需续写的港口新案'] }],
    rollingPlan: { startChapter: 99, endChapter: 100, chapters: [
      { chapterNumber: 100, purpose: '收到最后一份赔款回执', exitHook: '一名陌生人留下下一桩案子的委托书' },
    ] } },
    foreshadowingLedger: Array.from({ length: 28 }, (_, index) => ({
      id: `hook-${index}`, content: `伏笔${index}`, setChapter: index + 1, targetChapter: index % 2 ? 100 : 0, status: 'pending',
    })),
  });
  const build = chapterNumber => buildChapterContract({ novel, chapterNumber, totalChapters: 100,
    closingBook: true, requireEndingVerification: true });
  assert.equal(getClosingWindowStart(100), 86);
  assert.deepEqual(build(85).mandatoryResolutionHooks, []);
  for (let chapterNumber = 86; chapterNumber < 100; chapterNumber++) {
    const contract = build(chapterNumber);
    assert.equal(contract.requireEndingVerification, false);
    assert.equal(contract.endingStyle.label, '兑现阶段后果');
    assert.deepEqual(contract.mandatoryResolutionHooks, []);
    assert.ok(contract.suggestedResolutionHooks.length <= 2);
    for (const hook of contract.suggestedResolutionHooks) {
      assert.ok(contract.resolveHooks.includes(hook.content));
      hook.status = 'resolved';
    }
  }
  const ending = build(100);
  assert.equal(ending.requireEndingVerification, true);
  assert.ok(ending.mandatoryResolutionHooks.length <= 2);
  assert.deepEqual(ending.setHooks, []);
  assert.equal(ending.endingRequirements.finalState, '货运赔偿制度公开执行');
  assert.doesNotMatch(renderChapterContract(ending), /仍需续写的港口新案|下一桩案子的委托书/);
  assert.doesNotMatch(renderStoryBlueprintForContext(novel, 100, 100), /仍需续写的港口新案|下一桩案子的委托书/);
  const finalState = '港口赔款按新制度到账，工友回到码头继续生活';
  const detailed = buildChapterContract({ novel, chapterNumber: 100, totalChapters: 100, closingBook: true,
    requireEndingVerification: true, planData: { chapters: [{ chapterNumber: 100, coreEvent: finalState,
      raw: MODEL_ROLLING_PLAN }] } });
  assert.equal(detailed.endingRequirements.finalState, finalState);
  assert.equal(detailed.blueprintExitHook, finalState);
  assert.equal(detailed.blueprintExitCondition, '');
  assert.doesNotMatch(renderChapterContract(detailed), /终局须落到的局面：货运赔偿制度公开执行/);
});

test('timed blueprint hooks enter the ledger, retain distinct IDs, and follow a revised payoff deadline', () => {
  const shared = '港口调度室里的两张日期完全相同的值班记录';
  const hooks = ['甲', '乙'].map(letter => ({ name: `${shared}${letter}`, setupChapter: 2, payoffChapter: 16 }));
  const novel = makeNovel({ storyBlueprint: { phases: [{ startChapter: 1, endChapter: 20,
    foreshadowing: hooks, subphases: [{ startChapter: 1, endChapter: 10, foreshadowing: hooks }] }] } });
  const plan = { chapters: [] };
  seedPlannedHooks(novel, plan);
  seedPlannedHooks(novel, plan);
  assert.equal(novel.foreshadowingLedger.length, 2);
  assert.equal(new Set(novel.foreshadowingLedger.map(hook => hook.id)).size, 2);
  const contract = buildChapterContract({ novel, chapterNumber: 2, totalChapters: 20, planData: plan });
  assert.deepEqual(contract.setHooks, hooks.map(hook => hook.name));
  updateCreativeState(novel, 2, '两张值班记录把同一位调度员放在了相距二十里的两个值班室。', contract, {});
  assert.ok(novel.foreshadowingLedger.every(hook => hook.status === 'pending'));
  hooks[0].payoffChapter = 18;
  seedPlannedHooks(novel, plan);
  assert.equal(novel.foreshadowingLedger[0].targetChapter, 18);
});

test('confirmed outline payoffs keep their final deadline and runtime additions need source evidence', () => {
  const { applyHookAudit, importOutlineForeshadowing } = require('../services/storyState');
  const contractOutline = '【伏笔与回收表】\n伏笔1：票背双孔\n埋设章：第3章（发现一张奇怪车票）\n回收章：第58章（还原原因），第96章（撤销打孔流程）';
  const novel = makeNovel({ targetChapterCount: 100, storyBlueprint: { phases: [{ startChapter: 1, endChapter: 100 }] } });
  assert.equal(importOutlineForeshadowing(novel.storyBlueprint, contractOutline, 100), true);
  seedPlannedHooks(novel, parseChapterPlan({ chapters: [
    { chapterNumber: 3, setHooks: ['票背双孔'] }, { chapterNumber: 58, resolveHooks: ['票背双孔'] },
  ] }));
  const [hook] = novel.foreshadowingLedger;
  const evidence = '林见夏当众拆掉打孔器，宣布所有旧车票都可公开复查。';
  assert.equal(hook.targetChapter, 96);
  assert.equal(applyHookAudit(novel, 58, { hooksResolved: [{ id: hook.id, evidence }] }, evidence).resolved, 0);
  assert.equal(applyHookAudit(novel, 96, { hooksResolved: [{ id: hook.id, evidence }] }, evidence).resolved, 1);
  assert.equal(applyHookAudit(novel, 96, { hooksSet: [{ content: '没有证据的补录', evidence: '正文不存在的引文' }] }, evidence).added, 0);
  assert.equal(importOutlineForeshadowing(novel.storyBlueprint, contractOutline, 100), false);
});

test('the approved outline replaces quoted variants without moving the original payoff deadline', () => {
  const { importOutlineForeshadowing } = require('../services/storyState');
  const name = '林见夏的隔间被标记为"空置"';
  const outline = `【伏笔与回收表】\n伏笔1：${name}\n埋设章：第11章（租房登记异常）\n回收章：第96章（公示名单恢复林见夏的名字）`;
  const novel = makeNovel({ targetChapterCount: 100, outline, storyBlueprint: {
    phases: [{ startChapter: 1, endChapter: 100, subphases: [{ startChapter: 11, endChapter: 20,
      foreshadowing: [{ name: '林见夏的隔间被标记为“空置”', setupChapter: 11, payoffChapter: 19 }] }] }],
  } });
  assert.equal(importOutlineForeshadowing(novel.storyBlueprint, outline, 100), true);
  assert.deepEqual(novel.storyBlueprint.phases[0].subphases[0].foreshadowing, []);

  const plan = parseChapterPlan({ chapters: [
    { chapterNumber: 11, setHooks: ['林见夏的隔间被标记为空置'] },
    { chapterNumber: 19, resolveHooks: ['林见夏的隔间被标记为「空置」'] },
  ] });
  seedPlannedHooks(novel, plan);
  assert.equal(novel.foreshadowingLedger.length, 1);
  assert.equal(novel.foreshadowingLedger[0].content, name);
  assert.equal(novel.foreshadowingLedger[0].targetChapter, 96);
  const build = chapterNumber => buildChapterContract({ novel, chapterNumber, totalChapters: 100, planData: plan,
    closingBook: true, requireEndingVerification: true });
  assert.deepEqual(build(11).setHooks, [name]);
  assert.deepEqual(build(19).resolveHooks, []);
  assert.deepEqual(build(96).mandatoryResolutionHooks.map(hook => hook.content), [name]);
});

test('legacy early credits for quote aliases preserve setup and progress without paying the canonical hook', () => {
  const { openStoryHooks } = require('../services/storyState');
  const apartment = '林见夏的隔间被标记为"空置"';
  const lamp = '第七号站台灯具被“用他的手法”重新损坏';
  const setup = '房东翻过租客登记本，指给林见夏看那一栏空置标记。';
  const novel = makeNovel({ targetChapterCount: 100, chapters: [{ chapterNumber: 11, content: setup }],
    storyBlueprint: { phases: [{ startChapter: 1, endChapter: 100, foreshadowing: [
      { name: apartment, setupChapter: 11, payoffChapter: 96, plan: '公示名单恢复林见夏的名字。' },
      { name: lamp, setupChapter: 14, payoffChapter: 85, plan: '找出系统借维护者完成抹名确认的机制。' },
    ] }] }, foreshadowingLedger: [
      { id: 'old-apartment', content: '林见夏的隔间被标记为空置', setChapter: 11, targetChapter: 0,
        status: 'resolved', stage: 'paid_off', resolvedChapter: 12, setupEvidence: setup,
        progressEvidence: ['他带来两年前的租约。'], resolutionEvidence: '该编号无登记记录。' },
      { id: 'canonical-apartment', content: apartment, setChapter: 11, targetChapter: 96,
        payoffPlan: '公示名单恢复林见夏的名字。', status: 'planned', stage: 'planned' },
      { id: 'old-lamp', content: '第七号站台灯具被用他的手法重新损坏', setChapter: 14, targetChapter: 0,
        status: 'resolved', stage: 'paid_off', resolvedChapter: 26, setupEvidence: '灯坏的位置和他的拆装痕迹吻合。',
        resolutionEvidence: '换了七号侧灯的保险丝。', resolutionVerificationKey: 'obsolete' },
    ] });
  const plan = { chapters: [] };
  seedPlannedHooks(novel, plan);
  seedPlannedHooks(novel, plan);
  assert.deepEqual(novel.foreshadowingLedger.map(hook => hook.id), ['canonical-apartment', 'old-lamp']);
  assert.deepEqual(openStoryHooks(novel.foreshadowingLedger, 30).map(hook => hook.targetChapter), [96, 85]);
  const [room, station] = novel.foreshadowingLedger;
  assert.equal(room.setupEvidence, setup);
  assert.deepEqual(room.progressEvidence, ['他带来两年前的租约。']);
  assert.notEqual(room.status, 'resolved');
  assert.equal(station.content, lamp);
  assert.equal(station.status, 'pending');
  assert.equal(station.resolutionEvidence, '');
  assert.equal(station.resolutionVerificationKey, undefined);
});

test('middle chapters suggest mature evidenced carryover without making it a chapter gate', () => {
  const novel = makeNovel({ chapters: [{ chapterNumber: 4, content: '档案盒里滑出旧码头的编号单。' }],
    foreshadowingLedger: [
      { id: 'old', content: '旧码头编号', setChapter: 4, status: 'pending', stage: 'reinforced', setupEvidence: '档案盒里滑出旧码头的编号单。' },
      { id: 'rumor', content: '尚无证据的传闻', setChapter: 4, status: 'pending', setupStatus: 'unconfirmed' },
      { id: 'future', content: '调度员的录音', setChapter: 4, targetChapter: 90, status: 'pending', payoffPlan: '在仲裁上公布原录音。' },
    ] });
  const planData = { chapters: [{ chapterNumber: 35, coreEvent: '核对旧码头编号', resolveHooks: ['调度员的“录音”'] }] };
  const contract = buildChapterContract({ novel, chapterNumber: 35, totalChapters: 100, planData,
    closingBook: true, requireEndingVerification: true });
  assert.deepEqual(contract.suggestedResolutionHooks.map(hook => hook.id), ['old']);
  assert.deepEqual(contract.mandatoryResolutionHooks, []);
  assert.doesNotMatch(renderChapterContract(contract), /本章应回收伏笔：旧码头编号/);
  assert.match(renderChapterContract(contract), /有自然衔接的场景，可顺势回收：旧码头编号/);
  assert.equal(contract.resolveHooks.some(hook => hook.includes('录音')), false);
  assert.equal(novel.foreshadowingLedger[2].targetChapter, 90);
});

test('hook verification keys are persisted only for trusted decisions and bound to exact source and plan', () => {
  const { applyHookAudit, hookResolutionVerificationKey } = require('../services/storyState');
  const evidence = '钟离鹤在众人注视下签字，把单方授权移交给仲裁席。';
  const source = `${evidence}\n他把椅子推回桌边。`;
  const makeHook = () => ({ id: 'authority', content: '转椅', setChapter: 50, targetChapter: 99, status: 'pending', payoffPlan: '交出权限。' });
  const audit = { hooksResolved: [{ id: 'authority', evidence, resolutionVerificationKey: 'model-forged' }] };
  const verified = makeNovel({ targetChapterCount: 100, foreshadowingLedger: [makeHook()] });
  applyHookAudit(verified, 99, audit, source, { verified: true });
  const [saved] = verified.foreshadowingLedger;
  assert.equal(saved.resolutionVerificationKey, hookResolutionVerificationKey(saved, 99, evidence, source));
  assert.match(saved.resolutionVerificationKey, /^[a-f0-9]{64}$/);
  assert.notEqual(saved.resolutionVerificationKey, hookResolutionVerificationKey(saved, 99, evidence, source + '灯熄了。'));
  assert.notEqual(saved.resolutionVerificationKey, hookResolutionVerificationKey({ ...saved, payoffPlan: '保留权限。' }, 99, evidence, source));
  const unverified = makeNovel({ targetChapterCount: 100, foreshadowingLedger: [makeHook()] });
  applyHookAudit(unverified, 99, audit, source);
  assert.equal(unverified.foreshadowingLedger[0].resolutionVerificationKey, undefined);
});

test('stored discontiguous hook evidence revalidates in exact manuscript order', () => {
  const first = '林见夏在票背找到档案柜编号B7';
  const second = '旧车票归还给了原来的乘客';
  const source = `${first}。她叫车站管理员过来作证。${second}。`;
  const stored = matchHookResolutionEvidence(source, `${first}。${second}。`);

  assert.equal(stored, `${first} … ${second}`);
  assert.equal(matchHookResolutionEvidence(source, stored), stored);
  assert.equal(matchHookResolutionEvidence(source, `${second} … ${first}`), '');
  assert.equal(matchHookResolutionEvidence(source, stored.replace('B7', 'b7')), '');
  assert.equal(matchHookResolutionEvidence(source, stored.replace('乘客', '管理员')), '');
  assert.equal(matchHookResolutionEvidence(source, stored.replace(' … ', '...')), '');
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

test('fixed-book rolling plans preserve unscheduled proposals without creating completion blockers', () => {
  const { applyHookAudit, extractEventSignature, MODEL_ROLLING_PLAN, openStoryHooks, unconfirmedStoryHooks } = require('../services/storyState');
  const setup = '许岚把封套翻过来，封口下压着一枚刻了陌生姓氏的钥匙。';
  const novel = makeNovel({ targetChapterCount: 4, chapters: [{ chapterNumber: 2, content: setup }],
    foreshadowingLedger: [{ id: 'PLAN_2_封套', content: '封套里为什么藏着钥匙', setChapter: 2, targetChapter: 0,
      status: 'pending', stage: 'seeded', setupEvidence: extractEventSignature(setup).slice(0, 160) }] });
  const plan = parseChapterPlan({ chapters: [
    { chapterNumber: 2, raw: MODEL_ROLLING_PLAN, setHooks: ['封套里为什么藏着钥匙', '档案室更换值班人', '作者保留的线索', '已有回收章的线索'],
      modelHookProposals: ['封套里为什么藏着钥匙', '档案室更换值班人', '已有回收章的线索'] },
    { chapterNumber: 4, resolveHooks: ['已有回收章的线索'] },
  ] });
  seedPlannedHooks(novel, plan);
  assert.equal(novel.foreshadowingLedger.length, 4);
  const proposals = unconfirmedStoryHooks(novel.foreshadowingLedger, 2);
  assert.deepEqual(proposals.map(item => item.content), ['封套里为什么藏着钥匙', '档案室更换值班人']);
  assert.deepEqual(openStoryHooks(novel.foreshadowingLedger, 4).map(item => item.content), ['作者保留的线索', '已有回收章的线索']);
  const [key] = proposals;
  assert.equal(applyHookAudit(novel, 2, { hooksSet: [{ id: key.id, content: key.content, evidence: '正文从来没出现过这个证据' }] }, setup).added, 0);
  assert.equal(applyHookAudit(novel, 2, { hooksResolved: [{ id: key.id, evidence: setup }] }, setup).resolved, 0);
  assert.equal(applyHookAudit(novel, 2, { hooksSet: [{ id: key.id, content: key.content, evidence: setup }] }, setup).added, 1);
  seedPlannedHooks(novel, plan);
  assert.equal(key.setupStatus, 'confirmed');
  assert.equal(key.setupEvidence, setup);
  assert.equal(openStoryHooks(novel.foreshadowingLedger, 4).includes(key), true);
});

test('chapter contracts keep whole hook labels and review only proven legacy rolling fragments', () => {
  const { extractEventSignature, MODEL_ROLLING_PLAN, openStoryHooks } = require('../services/storyState');
  const setup = '许岚把旧册翻开，纸边有一道很深的折痕。她把封套举到灯下，看见背面有一枚陌生的水印。';
  const signature = extractEventSignature(setup).slice(0, 160);
  const fullLabel = '旧册折痕，封套水印、邮票号码；旧名单';
  const plan = parseChapterPlan({ chapters: [
    { chapterNumber: 2, raw: MODEL_ROLLING_PLAN, setHooks: [fullLabel] },
    { chapterNumber: 4, resolveHooks: [fullLabel] },
  ] });
  const makeBook = fixed => makeNovel({ targetChapterCount: fixed ? 4 : null,
    chapters: [{ chapterNumber: 2, content: setup }], foreshadowingLedger: [
      { id: 'FH_2_fragment', content: '旧册折痕', setChapter: 2, status: 'pending', setupEvidence: signature },
      { id: 'FH_2_specific', content: '封套水印', setChapter: 2, status: 'pending', setupEvidence: '她把封套举到灯下，看见背面有一枚陌生的水印。' },
      { id: 'FH_2_timed', content: '邮票号码', setChapter: 2, targetChapter: 4, status: 'pending', setupEvidence: signature },
      { id: 'FH_2_paid', content: '旧名单', setChapter: 2, status: 'resolved', setupEvidence: signature, resolutionEvidence: setup },
    ] });
  const linked = makeBook(true);
  seedPlannedHooks(linked, plan);
  const [fragment, evidenced, scheduled, paid] = linked.foreshadowingLedger;
  assert.equal(fragment.setupStatus, 'unconfirmed');
  assert.equal(fragment.status, 'pending');
  assert.equal(fragment.setupEvidence, signature);
  assert.equal(openStoryHooks(linked.foreshadowingLedger, 4).includes(fragment), false);
  assert.equal(evidenced.setupStatus, undefined);
  assert.equal(scheduled.setupStatus, undefined);
  assert.equal(paid.resolutionEvidence, setup);
  assert.deepEqual(buildChapterContract({ novel: linked, chapterNumber: 2, totalChapters: 4, planData: plan }).setHooks, [fullLabel]);
  assert.equal(buildChapterContract({ novel: linked, chapterNumber: 4, totalChapters: 4, planData: plan }).resolveHooks.includes(fullLabel), true);
  const nonfixed = makeBook(false);
  seedPlannedHooks(nonfixed, plan);
  assert.equal(nonfixed.foreshadowingLedger[0].setupStatus, undefined);
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

test('blueprint normalization merges excess phases and inherits missing subphase constraints', () => {
  const makeStage = (title, startChapter, endChapter) => ({
    title, startChapter, endChapter,
    goal: '推进主线并改变关系', obstacle: '信息被刻意隐瞒', reversal: '角色选择公开真相',
    threads: ['旧案线'], tagCommitments: ['日系校园：部活与值日'],
    characterBeats: [{ character: '林舟', goal: '查清线索', conflict: '害怕牵连同伴', change: '主动求助', voiceGuard: '慌乱时短句跑题' }],
    requiredScenes: ['放学后的部室'], forbiddenDrift: ['禁止霸总化'],
    entryCondition: '上一阶段结果成立', exitCondition: '关系发生可验收变化',
    foreshadowing: [{ name: '旧钥匙', setupChapter: startChapter, payoffChapter: endChapter, plan: '逐步指向旧档案' }],
    unresolvedQuestions: ['匿名信来自谁'],
  });
  const phases = Array.from({ length: 12 }, (_, index) => {
    const start = index * 20 + 1;
    const end = start + 19;
    const phase = makeStage(`篇章${index + 1}`, start, end);
    phase.subphases = [{
      ...phase,
      title: `小阶段${index + 1}`,
      characterBeats: [],
      forbiddenDrift: [],
      foreshadowing: [],
    }];
    return phase;
  });
  const normalized = normalizeProposedBlueprint({
    mainArc: '追查旧案并完成关系选择',
    phases,
    rollingPlan: {
      startChapter: 1,
      endChapter: 20,
      objective: '建立调查关系',
      chapters: Array.from({ length: 20 }, (_, index) => ({
        chapterNumber: index + 1,
        purpose: '造成具体状态变化',
        tagCommitments: ['日系校园'],
        characterBeats: [{ character: '林舟', goal: '推进调查' }],
      })),
    },
  }, makeNovel({ targetWordCount: 720000 }), 240);

  assert.equal(normalized.phases.length, 10);
  assert.equal(normalized.phases[0].startChapter, 1);
  assert.equal(normalized.phases.at(-1).endChapter, 240);
  normalized.phases.slice(1).forEach((phase, index) => {
    assert.equal(phase.startChapter, normalized.phases[index].endChapter + 1);
  });
  const firstSubphase = normalized.phases[0].subphases[0];
  assert.ok(firstSubphase.characterBeats.length);
  assert.ok(firstSubphase.forbiddenDrift.length);
  assert.ok(firstSubphase.foreshadowing.length);

  const validation = validateStoryBlueprint(normalized, 240, {
    expectedArcCount: 10,
    requiredTags: ['日系校园'],
  });
  assert.equal(validation.valid, true, validation.errors.join('；'));
});

test('three-level blueprint validates arc coverage, subphases, tags and rolling chapters', () => {
  const makeStage = (title, startChapter, endChapter) => ({
    title, startChapter, endChapter, goal: '推进关系与主线', obstacle: '误解', reversal: '立场变化', threads: ['社团线'],
    tagCommitments: ['日系校园：部活与值日', '搞笑：性格错位'],
    characterBeats: [{ character: '林舟', goal: '融入班级', conflict: '嘴硬', change: '开始求助', voiceGuard: '短句，慌乱时跑题' }],
    requiredScenes: ['午休教室'], forbiddenDrift: ['禁止霸总化'], entryCondition: '前一阶段结果成立', exitCondition: '关系发生可验收变化',
    foreshadowing: [{ name: '旧钥匙', setupChapter: startChapter, progressChapters: [], payoffChapter: endChapter, plan: '阶段末回收' }],
    unresolvedQuestions: ['匿名信来源'],
  });
  const phases = Array.from({ length: 10 }, (_, index) => {
    const start = index * 10 + 1;
    const end = start + 9;
    const phase = makeStage(`篇章${index + 1}`, start, end);
    phase.subphases = [makeStage('前半', start, start + 4), makeStage('后半', start + 5, end)];
    return phase;
  });
  const blueprint = {
    blueprintLevel: 3, mainArc: '学生们在校园事件中建立各自的关系与选择', lockedFacts: ['主角是学生'], tagChecklist: ['日系校园', '搞笑'], phases,
    rollingPlan: {
      startChapter: 1, endChapter: 20, objective: '建立班级与社团关系', tagCommitments: ['日系校园'], forbiddenDrift: ['禁止霸总化'],
      chapters: Array.from({ length: 20 }, (_, index) => ({
        chapterNumber: index + 1, title: `第${index + 1}章执行卡`, purpose: '造成具体状态变化', tagCommitments: ['搞笑'],
        characterBeats: [{ character: '林舟', goal: '完成值日', conflict: '怕尴尬', change: '愿意开口', voiceGuard: '慌乱时跑题' }],
        requiredScenes: ['教室'], relationshipChange: '同学关系推进', foreshadowingActions: ['推进旧钥匙'], exitHook: '留下新问题',
      })),
    },
  };
  assert.deepEqual(blueprintRequirements(100), { arcCount: 10, rollingChapterCount: 20 });
  blueprint.phases.at(-1).unresolvedQuestions = [];
  blueprint.phases.at(-1).subphases.at(-1).unresolvedQuestions = [];
  const valid = validateStoryBlueprint(blueprint, 100, { requiredTags: ['日系校园', '搞笑'] });
  assert.equal(valid.valid, true, valid.errors.join('；'));
  const broken = structuredClone(blueprint);
  broken.phases[1].startChapter = 15;
  const invalid = validateStoryBlueprint(broken, 100, { requiredTags: ['日系校园', '搞笑'] });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((message) => message.includes('空档或重叠')));
});

test('rolling execution coverage fills missing future cards and chapter contracts retain blueprint constraints', () => {
  const novel = makeNovel({
    tagLedger: [],
    storyBlueprint: {
      version: 2,
      mainArc: '校园社团在学园祭前解决旧钥匙谜团',
      lockedFacts: ['主角必须保留旧钥匙'],
      tagChecklist: ['日系校园', '搞笑'],
      phases: [{
        title: '学园祭准备', startChapter: 1, endChapter: 5,
        goal: '让社团在冲突中形成合作', obstacle: '时间不足', reversal: '钥匙指向校方旧档案',
        threads: ['社团线'], tagCommitments: ['日系校园'],
        characterBeats: [{ character: '林舟', goal: '查清钥匙', conflict: '害怕求助', change: '主动开口', voiceGuard: '慌乱时跑题' }],
        requiredScenes: ['放学后的部室'], forbiddenDrift: ['禁止霸总化'],
        entryCondition: '社团接下学园祭任务', exitCondition: '社团决定共同查档案',
        foreshadowing: [{ name: '旧钥匙', setupChapter: 1, payoffChapter: 5, plan: '逐步指向旧档案' }],
        unresolvedQuestions: ['钥匙来自谁'], subphases: [],
      }],
      rollingPlan: { startChapter: 1, endChapter: 2, objective: '建立社团合作', chapters: [{ chapterNumber: 1, purpose: '接下任务', tagCommitments: ['搞笑'], characterBeats: [{ character: '林舟', goal: '接任务' }] }] },
    },
  });
  const planData = parseChapterPlan({ chapters: [
    { chapterNumber: 1, coreEvent: '接下学园祭任务', tagCommitments: ['搞笑'] },
    { chapterNumber: 2, coreEvent: '在部室发现旧钥匙', setHooks: ['旧钥匙'] },
    { chapterNumber: 3, coreEvent: '追查钥匙来源' },
    { chapterNumber: 4, coreEvent: '社团决定共同查档案' },
    { chapterNumber: 5, coreEvent: '打开旧档案完成阶段转折' },
  ] });
  const rolling = ensureRollingPlanCoverage(novel, 1, 5, planData);
  assert.equal(rolling.startChapter, 1);
  assert.equal(rolling.endChapter, 5);
  assert.equal(rolling.chapters.length, 5);
  assert.equal(rolling.chapters.find((card) => card.chapterNumber === 2).purpose, '在部室发现旧钥匙');

  const contract = buildChapterContract({ novel, chapterNumber: 2, totalChapters: 5, planData });
  assert.equal(contract.blueprintStageTitle, '学园祭准备');
  assert.match(contract.blueprintStageGoal, /社团/);
  assert.match(contract.blueprintEntryCondition, /接下学园祭/);
  assert.ok(contract.blueprintForeshadowing.some((item) => item.includes('旧钥匙')));
  assert.ok(contract.tagCommitments.includes('日系校园'));
  assert.ok(contract.lockedFacts.includes('主角必须保留旧钥匙'));
  assert.match(renderChapterContract(contract), /本章执行卡目的/);
  assert.match(renderChapterContract(contract), /不可改写事实/);
});

test('compressPreviousChapter keeps beginning, turning point and ending instead of tail only', () => {
  const { compressPreviousChapter } = require('../services/storyState');
  const filler = '这是用来填充长度的普通句子。';
  const content = `清晨的雨落在旧城屋檐上。${filler.repeat(40)}但是林舟在抽屉深处发现了那枚黄铜钥匙。${filler.repeat(40)}夜色渐深，他握紧钥匙走向了地下室。`;
  const compressed = compressPreviousChapter(content);
  assert.ok(compressed.length < content.length, '压缩后应短于原文');
  assert.ok(compressed.startsWith('本章开端：'), '应保留本章开端');
  assert.ok(compressed.includes('关键转折'), '应提取关键转折句');
  assert.ok(compressed.includes('走向了地下室'), '必须保留章末状态');
  // 短章节原样返回
  assert.equal(compressPreviousChapter('短内容。'), '短内容。');
  assert.equal(compressPreviousChapter(''), '');
});

test('hook resolution tolerates reworded prose via 2-gram coverage', () => {
  const { updateCreativeState, buildChapterContract } = require('../services/storyState');
  const novel = { foreshadowingLedger: [], recentEventSignatures: [], emotionCurve: [], plotThreads: [], characterStates: [] };
  const contract = buildChapterContract({ novel, chapterNumber: 2, totalChapters: 10 });
  // 契约先埋设
  contract.setHooks = ['铜钥匙的下落'];
  updateCreativeState(novel, 1, '林舟捡到一把铜钥匙，决定查清它的来历。', { ...contract, chapterNumber: 1 }, {});
  assert.ok(novel.foreshadowingLedger.some((h) => h.status === 'pending'), '第1章应埋设 pending 伏笔');
  // 第2章措辞部分改写地回收：不出现完整字面，但保留核心词序（启发式管中度改写，重度改写由模型自评兜底）
  const reworded = "他终于弄明白了，那把黄铜钥匙正是通向地下室的下落所在，秘密就此揭开。";
  updateCreativeState(novel, 2, reworded, { ...contract, chapterNumber: 2, resolveHooks: ['铜钥匙的下落'] }, {});
  const hook = novel.foreshadowingLedger.find((h) => h.status === 'resolved');
  assert.ok(hook, '措辞改写后的回收应被 2-gram 覆盖率识别');
  assert.equal(hook.resolvedChapter, 2);
});

test('applyHookAudit patches missed resolutions, adds unplanned hooks and updates characters', () => {
  const { applyHookAudit, updateCreativeState, buildChapterContract } = require('../services/storyState');
  const novel = { foreshadowingLedger: [], recentEventSignatures: [], emotionCurve: [], plotThreads: [], characterStates: [] };
  const contract = buildChapterContract({ novel, chapterNumber: 1, totalChapters: 10 });
  contract.setHooks = ['老照片背后的秘密'];
  updateCreativeState(novel, 1, '林舟翻出老照片，背面写着一个陌生的名字。', { ...contract, chapterNumber: 1 }, {});
  const pending = novel.foreshadowingLedger.find((h) => h.status === 'pending');
  assert.ok(pending, '前置：伏笔应处于 pending');

  const audit = {
    hooksResolved: [{ content: '老照片背后的秘密', evidence: '他终于认出照片背面正是父亲的名字。' }],
    hooksSet: ['父亲名字与档案库编号的关联'],
    characterUpdates: [{ name: '林舟', location: '阁楼书房', emotionalState: '震惊而克制', goal: '查清父亲与档案库的关系' }],
  };
  const applied = applyHookAudit(novel, 2, audit);
  assert.equal(applied.resolved, 1);
  assert.equal(applied.added, 1);
  assert.equal(applied.characters, 1);
  assert.equal(pending.status, 'resolved');
  assert.equal(pending.resolvedChapter, 2);
  assert.ok(novel.foreshadowingLedger.some((h) => h.status === 'pending' && h.content.includes('档案库')), '计划外伏笔应补录');
  const state = novel.characterStates.find((c) => c.name === '林舟');
  assert.equal(state.location, '阁楼书房');
  assert.equal(state.lastChapter, 2);
  // 幂等：重复应用不再重复计数
  const again = applyHookAudit(novel, 2, audit);
  assert.equal(again.resolved, 0);
  assert.equal(again.added, 0);
});

test('applyHookAudit persists character bible fields and explicit tag evidence', () => {
  const { applyHookAudit } = require('../services/storyState');
  const novel = {
    foreshadowingLedger: [{ id: 'h1', content: '旧钥匙', status: 'due', stage: 'due', setChapter: 1 }],
    characterStates: [], characterBible: [], tagLedger: [], storyBible: {},
  };
  applyHookAudit(novel, 4, {
    hooksResolved: [{ id: 'h1', evidence: '林舟用旧钥匙打开了档案柜。' }],
    characterUpdates: [{
      name: '林舟', location: '档案室', goal: '确认旧案真相',
      knownFacts: ['钥匙来自校方档案室'], unknownFacts: ['不知道钥匙是谁留下的'],
      knowledgeBoundary: '不能知道幕后人尚未透露的动机',
      voiceRules: ['紧张时会先否认再追问'], background: '曾经错过一次关键证词',
      stressResponse: '压力下反复确认手边证据',
    }],
    tagEvidence: [{ tag: '日系校园', evidence: '放学后的部室里，社团成员争论学园祭分工。' }],
  }, '林舟在放学后的部室里，和社团成员争论学园祭分工。林舟用旧钥匙打开了档案柜。');
  assert.equal(novel.foreshadowingLedger[0].status, 'resolved');
  assert.equal(novel.foreshadowingLedger[0].stage, 'paid_off');
  assert.match(novel.foreshadowingLedger[0].resolutionEvidence, /旧钥匙/);
  assert.equal(novel.characterBible[0].knowledgeBoundary, '不能知道幕后人尚未透露的动机');
  assert.ok(novel.characterBible[0].voiceRules.includes('紧张时会先否认再追问'));
  assert.equal(novel.characterStates[0].lastChapter, 4);
  assert.equal(novel.tagLedger[0].status, 'covered');
  assert.match(novel.tagLedger[0].lastEvidence, /部室/);
});

test('章末防同构：收尾形式逐章轮换，近期实际收尾进入负面清单', () => {
  const novelWithChapters = {
    chapters: [1, 2, 3].map((n) => ({
      chapterNumber: n,
      content: `第${n}章推进了主线并留下新的问题，人物关系出现变化。`.repeat(3) + '林舟望着夜色，握紧了手中的铜钥匙。',
    })),
  };
  const contract4 = buildChapterContract({ novel: novelWithChapters, chapterNumber: 4, totalChapters: 12, wordTarget: 2000 });
  assert.ok(contract4.endingStyle && contract4.endingStyle.label, '契约必须指定本章收尾形式');
  assert.equal(contract4.recentEndings.length, 3);
  assert.ok(contract4.mustNot.some((rule) => rule.includes('不得复用该句式或同构套路')));
  const rendered = renderChapterContract(contract4);
  assert.match(rendered, /收尾要求：本章以【.+】收尾/);
  assert.match(rendered, /已用过的收尾（禁止同构）/);
  // 第 1 章无历史：不出现负面清单，也不产生相关 mustNot
  const contract1 = buildChapterContract({ novel: { chapters: [] }, chapterNumber: 1, totalChapters: 12, wordTarget: 2000 });
  assert.equal(contract1.recentEndings.length, 0);
  assert.ok(!renderChapterContract(contract1).includes('已用过的收尾'));
  // 确定性轮换：连续 8 章应覆盖多种收尾形式
  const styles = new Set();
  for (let ch = 1; ch <= 8; ch++) {
    styles.add(buildChapterContract({ novel: novelWithChapters, chapterNumber: ch, totalChapters: 20, wordTarget: 2000 }).endingStyle.key);
  }
  assert.ok(styles.size >= 3, `连续 8 章应覆盖至少 3 种收尾形式，实际 ${styles.size}`);
});

test('SKU 风格基调参与情绪权重：暗黑→克制基调，搞笑/治愈→轻松基调', () => {
  // 同一个题材名，只有 typeSku 里的基调标签不同，情绪规划就应给出不同的基调要求
  const base = {
    novelTypeName: '二次元·日系校园',
    outline: '社团与学园祭的日常。',
    worldSetting: '樱丘高中',
    targetWordCount: 24000,
    currentChapterIndex: 4,
  };
  const dark = buildEmotionPlan(
    makeNovel({ ...base, typeSku: { channel: 'male', category: 'acg', theme: 'acg_school', tones: ['anhei'] } }),
    5, 10, { chapterRole: '主线推进', tension: 5 },
  );
  const light = buildEmotionPlan(
    makeNovel({ ...base, typeSku: { channel: 'male', category: 'acg', theme: 'acg_school', tones: ['gaoxiao'] } }),
    5, 10, { chapterRole: '主线推进', tension: 5 },
  );
  assert.match(dark.tone, /克制具体/);
  assert.match(light.tone, /随场景自然变化/);

  // 没有 typeSku 的旧作品仍按类型名/大纲文本判定（回归：不受新逻辑影响）
  const legacyHeavy = buildEmotionPlan(makeNovel({ ...base, novelTypeName: '沉重悬疑', outline: '一场复仇与凶案。' }), 5, 10, { chapterRole: '主线推进', tension: 5 });
  assert.match(legacyHeavy.tone, /克制具体/);
});
