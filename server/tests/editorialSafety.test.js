const test = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../services/aiService');
const dsl = require('../config/editorialRules');

async function pipelineWith(t, handler) {
  const delay = dsl.interStageDelay;
  dsl.interStageDelay = 0;
  t.mock.method(ai, 'streamGenerate', handler);
  const path = require.resolve('../services/editorialEngine');
  delete require.cache[path];
  t.after(() => { dsl.interStageDelay = delay; delete require.cache[path]; });
  return require(path).runEditorialPipeline;
}

test('editorial stages reject truncation and expansion without losing the original or claiming success', async t => {
  const original = '原稿事实。'.repeat(200);
  const requests = [];
  const outputs = [original.slice(0, 400), original.repeat(2), original.slice(0, 650)];
  const run = await pipelineWith(t, async (system, prompt) => {
    requests.push({ system, prompt });
    return { content: outputs.shift() };
  });
  const result = await run(original, { apiConfig: {}, styleContext: '\n冻结的风格资料' });
  assert.equal(result.content, original);
  assert.equal(requests.length, 3);
  assert.ok(result.stageResults.filter(row => row.stage !== 'persona').every(row => row.success === false));
  for (const { system, prompt } of requests) {
    assert.match(system, /冻结的风格资料/);
    assert.doesNotMatch(prompt, /注入废信息|角色走神|句长随机化|每200字一句|对抗 Entropy|叙述口语化，不用书面语/);
  }
});

test('editorial retry includes the full ending and final review compares the candidate with the original', async t => {
  const original = '甲'.repeat(8990) + '原稿结尾不能丢';
  const candidate = '乙'.repeat(original.length - 7) + '候选结尾不能丢';
  const requests = [];
  const outputs = ['', original, candidate, candidate];
  const run = await pipelineWith(t, async (system, prompt) => {
    requests.push({ system, prompt });
    return { content: outputs.shift() };
  });
  const result = await run(original, { apiConfig: {}, persona: { voice: '冷峻声线' }, styleContext: '\n冻结的风格资料' });
  assert.equal(requests.length, 4, 'only an empty stage adds a retry');
  assert.ok(requests[1].prompt.includes(original));
  assert.match(requests[1].system, /冷峻声线/);
  assert.match(requests[1].system, /冻结的风格资料/);
  assert.ok(requests[3].prompt.includes(original));
  assert.ok(requests[3].prompt.includes(candidate));
  assert.equal(result.content, candidate);
});
