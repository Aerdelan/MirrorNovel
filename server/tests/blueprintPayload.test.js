const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBlueprintPayload, inspectBlueprintPayload, inspectStructuredPayload } = require('../services/blueprintPayload');
const payload = { mainArc: '保留字面文本：,} 和 ,] 以及引号"和括号{不能改写', phases: [{ title: '夜班账', subphases: [{ title: '现场' }] }], rollingPlan: { chapters: [{ chapterNumber: 1 }] } };

test('reads complete blueprint roots through fences, explanations, arrays and nested envelopes', () => {
  for (const value of [payload, { blueprint: payload }, { data: { blueprint: payload } }, { result: { storyBlueprint: payload } }, [{ note: 'metadata' }, payload]]) {
    assert.deepEqual(parseBlueprintPayload('结果：\n```json\n' + JSON.stringify(value) + '\n```'), payload);
  }
});
test('does not return metadata before the actual complete blueprint', () => {
  assert.deepEqual(parseBlueprintPayload('{"status":"ok"}\n' + JSON.stringify(payload)), payload);
});
test('truncated outer JSON cannot masquerade as a complete nested phase', () => {
  const text = '{"mainArc":"夜班账","phases":[{"title":"第一部","subphases":[{"title":"小阶段"}]}],"rollingPlan":';
  assert.equal(parseBlueprintPayload(text), null);
  assert.equal(inspectBlueprintPayload(text).reason, 'invalid_json');
});
test('trailing comma tolerance never edits the literal story strings', () => {
  const text = JSON.stringify(payload).replace(/}$/, ',}');
  assert.deepEqual(parseBlueprintPayload(text), payload);
});
test('reports the actual missing fields instead of a generic structure error', () => {
  assert.deepEqual(inspectBlueprintPayload('{"mainArc":"主线","phases":[{}]}').missingFields, ['rollingPlan']);
  assert.equal(inspectBlueprintPayload('无可用蓝图').reason, 'invalid_json');
});

test('structured parts accept known envelopes but never promote nested fragments', () => {
  const phase = { phase: { title: '本篇章' } };
  assert.deepEqual(inspectStructuredPayload('说明\n' + JSON.stringify({ data: { result: phase } }), 'phase').parsed, phase);
  const truncated = inspectStructuredPayload('{"data":' + JSON.stringify(phase), 'phase');
  assert.equal(truncated.parsed, null);
  assert.equal(truncated.reason, 'invalid_json');
  assert.equal(truncated.documentCount, 0);
  const wrongEnvelope = inspectStructuredPayload(JSON.stringify({ arbitrary: phase }), 'phase');
  assert.equal(wrongEnvelope.parsed, null);
  assert.equal(wrongEnvelope.reason, 'missing_field');
  assert.deepEqual(wrongEnvelope.foundKeys, ['arbitrary']);
  assert.equal(inspectStructuredPayload('{"phase":', 'phase').reason, 'invalid_json');
});

test('a bare phase without subphases is reported as a phase, not a missing envelope', () => {
  const bare = { title: '第一部', startChapter: 1, endChapter: 6, goal: '目标' };
  const { parsed, reason } = inspectStructuredPayload(JSON.stringify(bare), 'phase');
  assert.equal(reason, null);
  assert.deepEqual(parsed, { phase: bare });
  // Story text never leaks into diagnostics: only key names are collected.
  const missing = inspectStructuredPayload(JSON.stringify({ story: '故事正文' }), 'chapters');
  assert.deepEqual(missing.foundKeys, ['story']);
});
