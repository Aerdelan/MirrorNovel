const test = require('node:test');
const assert = require('node:assert/strict');

const deslop = require('../config/deslop');
const {
  buildSystemPrompt,
  humanizeRewrite,
} = require('../services/aiService');

const legacyNoiseDirectives = [
  /角色突然想到无关的事/,
  /以下特征是人类写作独有的/,
  /必须刻意加入/,
  /每200字必须/,
  /30%的段落只有/,
  /段落之间可以硬切/,
  /让任何检测工具都无法分辨/,
];

function assertNoLegacyNoise(prompt) {
  for (const pattern of legacyNoiseDirectives) {
    assert.doesNotMatch(prompt, pattern);
  }
}

function createSseResponse(content) {
  const encoder = new TextEncoder();
  const event = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
  let sent = false;

  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: encoder.encode(event) };
          },
        };
      },
    },
  };
}

test('active writing prompts prioritize voice, causality and scene-driven rhythm', () => {
  const prompts = [
    deslop.styleFloorPrompt,
    deslop.craftGuidePrompt,
    deslop.systemDeslopPrompt,
    deslop.deslopSystemPrompt,
    deslop.humanizeRewritePrompt,
  ];

  for (const prompt of prompts) assertNoLegacyNoise(prompt);

  // 去AI味底线：只放真正的 AI 特征，不掺杂风格强制
  assert.match(deslop.styleFloorPrompt, /去AI味底线/);
  assert.match(deslop.styleFloorPrompt, /升华句与事后总结/);

  // 工艺指南：从属风格档案，叙述者与幽默改为条件式，不得再有一刀切禁令
  assert.match(deslop.craftGuidePrompt, /叙事工艺指南/);
  assert.match(deslop.craftGuidePrompt, /风格档案/);
  assert.doesNotMatch(deslop.craftGuidePrompt, /禁止随机走神、无关观察、强行吐槽/);
  assert.doesNotMatch(deslop.craftGuidePrompt, /叙述者插科打诨/);

  // systemDeslopPrompt（getter）= 从属声明 + 工艺指南 + 去AI味底线
  assert.match(deslop.systemDeslopPrompt, /从属于本书的风格档案/);
  assert.match(deslop.systemDeslopPrompt, /叙事工艺指南/);
  assert.match(deslop.systemDeslopPrompt, /去AI味底线/);

  assert.match(deslop.deslopSystemPrompt, /不可改动的基准/);
  assert.match(deslop.deslopSystemPrompt, /不要以规避检测器为目标制造文本噪声/);
  assert.match(deslop.humanizeRewritePrompt, /保真合同/);
  assert.match(deslop.humanizeRewritePrompt, /不得新增冲突、秘密、回忆、笑点或设定/);
  assert.match(deslop.humanizeRewritePrompt, /80%-120%/);
});

test('去AI味底线含“结构复沓”硬约束（抑制 不是A是B/连续明喻/单句成段 刷屏）', () => {
  // 新的 AI 腔不是旧词表，而是同构修辞刷屏；底线必须约束其密度
  assert.match(deslop.styleFloorPrompt, /同构句式/);
  assert.match(deslop.styleFloorPrompt, /复沓刷屏/);
  assert.match(deslop.styleFloorPrompt, /不是A，是B/);
  assert.match(deslop.styleFloorPrompt, /明喻/);
  assert.match(deslop.styleFloorPrompt, /单句独立成段/);
  // 经 systemDeslopPrompt 拼接，对所有正文生成路径恒用
  assert.match(deslop.systemDeslopPrompt, /复沓刷屏/);
});

test('genre system prompts keep the shared narrative contract', () => {
  const fallback = buildSystemPrompt('missing-type');
  const webNovel = buildSystemPrompt('urban', 'male');
  const lightNovel = buildSystemPrompt('lightnovel_school');

  for (const prompt of [fallback, webNovel, lightNovel]) {
    assert.match(prompt, /作者声线/);
    assert.match(prompt, /场景/);
    assertNoLegacyNoise(prompt);
  }

  assert.match(webNovel, /不要求每段都安排爽点/);
  assert.match(webNovel, /段落和句长由场景与风格档案决定/);
  assert.match(lightNovel, /笑点必须从人物处境和关系摩擦中自然产生/);
  assert.match(lightNovel, /轻松片段必须同时推进关系、信息或伏笔/);
});

test('style profile renders from persona axes and outranks the craft guide', () => {
  const persona = {
    name: '无厘头逗比',
    voice: '贫嘴、爱抖机灵',
    axes: { temperature: 5, humor: 5, narrator: 5, emotion: 5, diction: 2, pacing: 5 },
  };
  const withPersona = buildSystemPrompt('urban', 'male', persona);
  // 风格档案块被渲染，且位于通用工艺指南之前（风格权威高于工艺指南）
  assert.match(withPersona, /【本书风格档案/);
  assert.ok(withPersona.indexOf('本书风格档案') < withPersona.indexOf('叙事工艺指南'));
  // 高幽默/介入叙述者被授权，不再被旧的绝对禁令压制
  assert.doesNotMatch(withPersona, /禁止随机走神、无关观察、强行吐槽/);

  // 无 axes（旧人格且类型不带 axes）时不注入档案块，向后兼容
  // 注：'urban' 等新类型已自带默认 axes，会用类型默认渲染档案；故用无轴类型验证“双无”分支。
  const plain = buildSystemPrompt('no_axes_type_zzz', 'male', null);
  assert.doesNotMatch(plain, /【本书风格档案 — 最高风格权威】/);
});

test('humanizeRewrite uses a conservative fidelity pass followed by an original-backed review', async (t) => {
  const source = '甲'.repeat(240);
  const pass1 = '乙'.repeat(240);
  const pass2 = '丙'.repeat(240);
  const requests = [];
  const originalFetch = global.fetch;

  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return createSseResponse(requests.length === 1 ? pass1 : pass2);
  };

  const result = await humanizeRewrite(source, {
    baseUrl: 'http://prompt-test.local/v1',
    apiKey: 'test-key',
    model: 'test-model',
  });

  assert.equal(result, pass2);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].temperature, 0.72);
  assert.equal(requests[1].temperature, 0.55);
  assert.match(requests[0].messages[0].content, /事实、情节、视角、作者声线和篇幅/);
  assert.match(requests[1].messages[1].content, /原文是唯一的事实基准/);
  assert.match(requests[1].messages[1].content, /【原文：事实与叙事基准】/);
  assert.match(requests[1].messages[1].content, /【第一轮候选稿】/);
  assert.ok(requests[1].messages[1].content.includes(source));
  assert.ok(requests[1].messages[1].content.includes(pass1));
  assertNoLegacyNoise(requests[1].messages[1].content);
});
