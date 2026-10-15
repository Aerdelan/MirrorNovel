const test = require('node:test');
const assert = require('node:assert/strict');

const { getScriptRequirements, MAX_SCREENPLAY_DURATION_SECONDS, MAX_SCREENPLAY_OUTPUT_TOKENS, getScreenplayOutputTokens, parseJsonObject, assessScreenplayQuality, screenplayText, screenplayMarkdown, screenplayHtml, buildScreenplayPersonaDirective, normalizeConceptExpansion, fillRepairExecutionFields, characterVisualAnchors } = require('../routes/screenplay');
const { buildPersonaPrompt } = require('../services/aiService');

test('1080-second screenplay requirements cover a full short drama episode', () => {
  const requirements = getScriptRequirements(1080);
  assert.equal(requirements.duration, 1080);
  assert.equal(requirements.sceneCount, 24);
  assert.equal(requirements.dialogueLineCount, 155);
  assert.equal(requirements.actionChars, 10800);
  assert.equal(requirements.outputTokens, 34560);
});

test('screenplay requirements clamp malformed or extreme durations', () => {
  assert.equal(getScriptRequirements('not-a-number').duration, 120);
  assert.equal(getScriptRequirements(1).duration, 30);
  assert.equal(getScriptRequirements(99999).duration, MAX_SCREENPLAY_DURATION_SECONDS);
  assert.equal(getScriptRequirements(99999999).outputTokens, MAX_SCREENPLAY_OUTPUT_TOKENS);
});

test('screenplay output budget follows the configured per-second increment', () => {
  assert.equal(getScreenplayOutputTokens(1080, { tokensPerSecond: 20, minimumTokens: 7000 }), 21600);
  assert.equal(getScreenplayOutputTokens(120, { tokensPerSecond: 10, minimumTokens: 7000 }), 7000);
  assert.equal(getScreenplayOutputTokens(50000, { tokensPerSecond: 20, minimumTokens: 7000 }), 700000);
});

test('screenplay exports include the bible, episodes, and format-specific wrappers', () => {
  const project = {
    title: '旧城<来信>', sourceType: 'original', productionTarget: 'video',
    screenplayBible: { logline: '一封信', characters: [], locations: [], characterArcs: [{ character: '林舟', arc: '从犹豫到追查' }], subplots: [{ subplot: '失踪线', beat: '留下线索' }], foreshadowing: [{ id: 'F1', setup: '旧表', payoff: '终局回收' }], styleRules: ['冷峻克制'] },
    episodes: [{ episodeNumber: 1, title: '雨夜', durationSeconds: 120, premise: '收到来信', emotionalArc: '压抑→惊疑', continuityState: '旧表仍在手中', characterBeats: [{ character: '林舟', after: '决定追查' }], subplotBeats: [{ subplot: '失踪线', beat: '发现门缝血迹' }], setupPayoff: [{ foreshadowingId: 'F1', detail: '镜头扫过旧表' }], scenePlan: [{ sceneNumber: 1, purpose: '建立疑点' }], scenes: [{ sceneNumber: 1, heading: '办公室', action: '灯光亮起', dialogue: [{ character: '林舟', line: '谁寄的？' }] }] }],
  };
  assert.match(screenplayText(project), /旧城<来信>/);
  assert.match(screenplayText(project), /林舟：谁寄的/);
  assert.match(screenplayMarkdown(project), /^# 旧城<来信>/);
  const html = screenplayHtml(project, { bibleCollapsed: true, episodesCollapsed: false, collapsedEpisodes: [1] });
  assert.match(html, /<style>/);
  assert.match(html, /<details/);
  assert.match(html, /<summary/);
  assert.doesNotMatch(html, /<button\b|@click|生成剧本/);
  assert.match(html, /episode-card/);
  assert.match(html, /人物弧线/);
  assert.match(html, /支线节拍/);
  assert.match(html, /伏笔节拍/);
  assert.match(html, /场次计划/);
});

test('screenplay parser accepts fenced JSON and recovers complete scenes from a truncated response', () => {
  assert.equal(parseJsonObject('```json\n{"scenes":[{"sceneNumber":1}]}\n```').scenes.length, 1);
  const partial = parseJsonObject('{"scenes":[{"sceneNumber":1,"action":"a"},{"sceneNumber":2,"action":"b"}');
  assert.equal(partial.partial, true);
  assert.equal(partial.scenes.length, 2);
});

test('screenplay parser accepts structured original concept expansion JSON', () => {
  const parsed = parseJsonObject('开发结果：\n```json\n{"premise":"旧城来信","characters":[{"name":"林舟"}],"subplots":[{"name":"失踪线"}]}\n```');
  assert.equal(parsed.premise, '旧城来信');
  assert.equal(parsed.characters.length, 1);
  assert.equal(parsed.subplots.length, 1);
});

test('screenplay parser accepts valid objects with arbitrary top-level fields', () => {
  const parsed = parseJsonObject('结果如下： {"idea":"雨夜","items":[1,2]}');
  assert.deepEqual(parsed, { idea: '雨夜', items: [1, 2] });
});

test('screenplay quality assessment catches incomplete dialogue direction fields', () => {
  const requirements = { sceneCount: 1, dialogueLineCount: 1, actionChars: 1 };
  const report = assessScreenplayQuality([{ action: '空间与走位', dialogue: [{ character: '甲', line: '你好' }] }], requirements);
  assert.equal(report.coverage.scenes, true);
  assert.equal(report.coverage.dialogue, true);
  assert.equal(report.coverage.action, true);
  assert.equal(report.coverage.dialogueMetadata, false);
  assert.match(report.issues.join('；'), /对白缺少/);
});

test('screenplay quality assessment checks scene execution fields', () => {
  const requirements = { sceneCount: 1, dialogueLineCount: 0, actionChars: 1 };
  const report = assessScreenplayQuality([{ action: '空间与走位' }], requirements);
  assert.equal(report.coverage.sceneExecution, false);
  assert.match(report.issues.join('；'), /目标、阻力、结果/);
});

test('repair fills omitted scene execution fields from the confirmed blueprint', () => {
  const repaired = fillRepairExecutionFields([{ action: '陈默推开铁门。', productionNotes: '候车室用近景拍手部动作。' }], {
    premise: '陈默寻找录音来源', conflict: '录音制造误导', turn: '挂钟响起',
    scenePlan: [{ purpose: '建立疑点', objective: '找到录音机', obstacle: '候车室无人', exitState: '带走录音机' }],
  }, 'productionNotes 必须包含镜头景别');
  assert.equal(repaired[0].objective, '找到录音机');
  assert.equal(repaired[0].obstacle, '候车室无人');
  assert.equal(repaired[0].result, '带走录音机');
  assert.ok(repaired[0].shotPlan);
  assert.ok(repaired[0].soundDesign);
});

test('screenplay scene prompts preserve the locked writing persona', () => {
  const directive = buildScreenplayPersonaDirective({ name: '冷硬悬疑风', voice: '第三人称限制视角', tone: '短句克制', rules: '不提前解释谜底', vocab: '禁用华丽词' });
  assert.match(directive, /冷硬悬疑风/);
  assert.match(directive, /不要把所有人物写成同一个作者/);
  assert.match(directive, /不提前解释谜底/);
});

test('novel persona prompt defines a stable style signature and precedence', () => {
  const prompt = buildPersonaPrompt({ name: '意识流文艺', voice: '第一人称，贴近意识', tone: '绵延跳切', rules: '意象回响', vocab: '潮湿、余烬' }, { includeDeslop: false });
  assert.match(prompt, /唯一作者声线/);
  assert.match(prompt, /五项声线签名/);
  assert.match(prompt, /声线稳定不等于章末套话稳定/);
  assert.match(prompt, /与人格冲突/);
});

test('original concept expansion normalizes structured branches and optional mainline', () => {
  const expanded = normalizeConceptExpansion({ premise: '设定', mainline: '主线', characters: [{ name: '甲', goal: '查明真相' }], subplots: [{ name: '邻里线', beats: '逐步推进' }], foreshadowing: [{ id: 'F1', payoff: '回收' }] });
  assert.equal(expanded.premise, '设定');
  assert.equal(expanded.characters.length, 1);
  assert.equal(expanded.subplots.length, 1);
  assert.equal(expanded.foreshadowing.length, 1);
});

test('character visual anchors keep appearance facts stable across scene image prompts', () => {
  const anchors = characterVisualAnchors({ characters: [{ name: '林舟', visual: '短黑发，左眉有浅疤，深灰夹克', continuity: '左手旧银戒不可更换' }, { name: '沈岚', visual: '长发，红围巾' }] }, ['林舟']);
  assert.match(anchors, /林舟/);
  assert.match(anchors, /短黑发/);
  assert.match(anchors, /左手旧银戒不可更换/);
  assert.doesNotMatch(anchors, /沈岚/);
});

test('image proxy allows public http/https urls and rejects internal network targets', () => {
  const { isProxyableImageUrl } = require('../routes/screenplay');
  assert.equal(isProxyableImageUrl('http://122.51.1.135:8787/v1/images/file/a.png'), true);
  assert.equal(isProxyableImageUrl('https://relay.example.top/v1/images/file/a.png'), true);
  assert.equal(isProxyableImageUrl('https://any-cdn.net/a.png'), true);
  assert.equal(isProxyableImageUrl('http://192.168.1.1:8080/admin'), false);
  assert.equal(isProxyableImageUrl('http://127.0.0.1:3000/api'), false);
  assert.equal(isProxyableImageUrl('http://10.0.0.5/x.png'), false);
  assert.equal(isProxyableImageUrl('http://172.16.0.9/x.png'), false);
  assert.equal(isProxyableImageUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isProxyableImageUrl('http://localhost:11434/x.png'), false);
  assert.equal(isProxyableImageUrl('ftp://example.com/a.png'), false);
  assert.equal(isProxyableImageUrl('not a url'), false);
  assert.equal(isProxyableImageUrl(''), false);
});
