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
    deslop.systemDeslopPrompt,
    deslop.deslopSystemPrompt,
    deslop.humanizeRewritePrompt,
  ];

  for (const prompt of prompts) assertNoLegacyNoise(prompt);

  assert.match(deslop.systemDeslopPrompt, /叙事人称、视角人物、叙事距离/);
  assert.match(deslop.systemDeslopPrompt, /背景、教育、目标、情绪及双方关系/);
  assert.match(deslop.systemDeslopPrompt, /句长、段落长度和留白服从信息量与情绪压力/);
  assert.match(deslop.systemDeslopPrompt, /推进关系、信息或伏笔/);
  assert.match(deslop.systemDeslopPrompt, /禁止随机走神/);

  assert.match(deslop.deslopSystemPrompt, /不可改动的基准/);
  assert.match(deslop.deslopSystemPrompt, /不要以规避检测器为目标制造文本噪声/);
  assert.match(deslop.humanizeRewritePrompt, /保真合同/);
  assert.match(deslop.humanizeRewritePrompt, /不得新增冲突、秘密、回忆、笑点或设定/);
  assert.match(deslop.humanizeRewritePrompt, /80%-120%/);
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
  assert.match(webNovel, /段落和句长由场景决定/);
  assert.match(lightNovel, /笑点必须从人物处境和关系摩擦中自然产生/);
  assert.match(lightNovel, /轻松片段必须同时推进关系、信息或伏笔/);
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
