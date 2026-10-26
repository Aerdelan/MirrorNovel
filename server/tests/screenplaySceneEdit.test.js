const test = require('node:test');
const assert = require('node:assert/strict');
const { sceneEditSnapshot, validateSceneEdit } = require('../services/screenplaySceneEdit');
const { cleanupArtifacts, smartDeAIfy, processChapter } = require('../services/chapterToolchain');

test('manual scene edits preserve author wording, dialogue metadata and whitespace without accepting structural fields', () => {
 const edit = validateSceneEdit({ sceneNumber: 99, imagePlan: { prompt: 'injected' }, action: '  她愣住了。\n', dialogue: [{ character: '甲', line: '  原句！  ', delivery: '低声', physicalAction: '抬手', position: '门边', subtext: '担心' }] });
 assert.equal(edit.action, '  她愣住了。\n');
 assert.equal(edit.dialogue[0].line, '  原句！  ');
 assert.equal(edit.dialogue[0].subtext, '担心');
 assert.equal(edit.sceneNumber, undefined); assert.equal(edit.imagePlan, undefined);
});
test('scene comparison is independent of key ordering and schema default values', () => {
 assert.deepEqual(sceneEditSnapshot({ action: '原文', dialogue: [{ line: '台词', character: '甲' }] }), sceneEditSnapshot({ dialogue: [{ character: '甲', line: '台词', subtext: '' }], action: '原文', objective: '' }));
 assert.notDeepEqual(sceneEditSnapshot({ action: '原文', dialogue: [] }), sceneEditSnapshot({ action: '新文', dialogue: [] }));
});
test('invalid scene edit payloads cannot replace content with malformed or empty values', () => {
 for (const value of [null, [], { action: '', dialogue: [] }, { action: {}, dialogue: [] }, { action: 'x', dialogue: {} }, { action: 'x', dialogue: [null] }, { action: 'x', dialogue: [{ line: {} }] }, { action: 'x'.repeat(100001), dialogue: [] }]) assert.throws(() => validateSceneEdit(value), error => error.status === 400);
 assert.equal(validateSceneEdit({ action: '', dialogue: [{ line: '一句台词' }] }).dialogue[0].line, '一句台词');
});
test('ordinary reaction words survive both cleanup and active de-AI postprocessing', () => {
 const text = '她愣住了，站在门边。他没有催促，只把信放在桌上。';
 assert.equal(cleanupArtifacts(text), text);
 assert.equal(smartDeAIfy(text), text);
 const result = processChapter(('与此同时，' + text).repeat(12), { doAutoFormat: false, doPunctuation: false }).text;
 assert.equal((result.match(/她愣住了/g) || []).length, 12);
 assert.doesNotMatch(result, /一呆了|一怔了|呆了呆了/);
});
