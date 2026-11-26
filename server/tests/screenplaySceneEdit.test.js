const test = require('node:test');
const assert = require('node:assert/strict');
const { sceneEditSnapshot, validateSceneEdit } = require('../services/screenplaySceneEdit');
const { cleanupArtifacts, smartDeAIfy, processChapter, fixPunctuation } = require('../services/chapterToolchain');

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

test('chapter punctuation cleanup preserves long dialogue and its original paragraph boundaries', () => {
 const paragraphs = [
  '　　「你先别关门。我昨晚是看见周姨出去了,可我没看见她往哪边走。她拎着那个掉漆的桶，外套也没穿，就在门口站了一会儿。你问我她有没有说话，我真记不清。当时收音机开着，我妈在厨房里找电池，隔着一堵墙喊了我两遍。等我回来，门就只剩一条缝了。我还以为她下楼倒水，一会儿就上来。你要去找她，我陪你去。鞋在楼梯口，我给你拿。」',
  '　　楼道灯坏了两天。小满摸到扶手，手上蹭到一块干掉的油漆。她知道自己可以转身去开屋里的灯，等隔壁的人把狗牵进屋，等楼下有人经过。偏偏就在这会儿，底下响起两下敲门声，不重，第二下比第一下近。她把钥匙捏在掌心，让身边的人先别动。收音机还在桌上响，主持人念完明天的天气预报，又从头念了一遍。',
  '　　「鞋先放着。」她贴着门说，「你刚才还听见什么了？」',
 ];
 const source = paragraphs.join('\r\n\r\n');
 assert.ok(source.length > 300);
 const expected = paragraphs.join('\n\n').replace('出去了,可', '出去了，可');
 assert.equal(fixPunctuation(source), expected.replace(/\n/g, '\r\n'));
 assert.equal(processChapter(source, { doDeAI: false }).text, expected);
});
