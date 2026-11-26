const test = require('node:test');
const assert = require('node:assert/strict');
const { readOutlineCharacterVoices, stripOutlineCharacterVoices } = require('../services/outlineCharacterVoices');

test('reads separate voices from a short outline and excludes the scene example', () => {
  const outline = `【主要角色】
傅小满：见习守灯人。

【人物声音表】

傅小满：
常用词汇：港、灯、潮、闸、没事、我来、等一下。
句长：短句为主，紧张时变成半句话。
称呼礼貌：叫周棠"周老师"，叫陆鸣"陆叔"。
遇到冲突时会说："我知道了。""我去。"
刻意不说："我想她。""我害怕。"
情绪失控后：句子突然变长，开始讲"其实"。

沈鹿：
句长：长，一口气能堆三四句，中间用"然后""而且"连接。
称呼礼貌：叫傅小满"小满"，叫周棠"周老师"。

同场对话差异示例（第2章，沈鹿在门口等）：
傅小满："我看不出来。"
沈鹿："小满你好了吗？"
钟伯：
句长：示例并不是新的角色规则。

【剧情阶段】
陆鸣：
句长：阶段规划也不写进声音表。`;

  const voices = readOutlineCharacterVoices(outline);
  assert.deepEqual(voices.map(item => item.name), ['傅小满', '沈鹿']);
  assert.equal(voices[0].voiceRules.length, 6);
  assert.equal(voices[0].voiceRules[2], '称呼礼貌：叫周棠"周老师"，叫陆鸣"陆叔"。');
  assert.equal(voices[1].voiceRules[0], '句长：长，一口气能堆三四句，中间用"然后""而且"连接。');
  const storyContext = stripOutlineCharacterVoices(outline);
  assert.match(storyContext, /【主要角色】\n傅小满：见习守灯人。/);
  assert.match(storyContext, /【剧情阶段】\n陆鸣/);
  assert.doesNotMatch(storyContext, /人物声音表|同场对话差异示例|小满你好了吗/);
});

test('keeps reading later profiles after an inline example in a long outline', () => {
  const outline = `【人物声音表】

林见夏：
常用词汇范围：机械部件名（灯丝、触片、镇流器）、"你听"。
句子长短：中等偏长，偶尔会突然极短（"不对。""再来。"）。
礼貌/称呼习惯：对年长者用"您"，对同伴直接叫名字。
同场差异示例见下方。

纪鸢：
常用词汇范围：极简，"嗯"、"行"、"你修你的"。
同场差异示例：林见夏"这俩孔你见过没有"→纪鸢"没有。"

裴远舟：
刻意不说：不主动提自己哼错旋律的事，除非被直接问。
情绪失控后：突然安静，然后哼一首完整的、正确的歌。

【剧情阶段】
苏棠：
声线：在另一个章节，不能写入声音表。`;

  const voices = readOutlineCharacterVoices(outline);
  assert.deepEqual(voices.map(item => [item.name, item.voiceRules.length]), [['林见夏', 3], ['纪鸢', 1], ['裴远舟', 2]]);
  assert.match(voices[0].voiceRules[2], /^礼貌\/称呼习惯：/);
  assert.doesNotMatch(JSON.stringify(voices), /这俩孔你见过没有/);
});

test('supports markdown names and labels without reading outside the explicit section', () => {
  const outline = `## 主要角色
### 不应入表
- 声线：正文人物介绍。
## **人物声音表**
### **罗莎·林**
- **称呼习惯：** 叫乔唯"队长"。
- **冲突反应**：先问清楚；确认后只说一句。
- 没有声线字段：
## 其他安排
### 不应入表
- 声线：已越过声音表。`;

  assert.deepEqual(readOutlineCharacterVoices(outline), [{
    name: '罗莎·林',
    voiceRules: ['称呼习惯：叫乔唯"队长"。', '冲突反应：先问清楚；确认后只说一句。'],
  }]);
  assert.deepEqual(readOutlineCharacterVoices('罗莎·林：\n声线：短句。'), []);
});

test('bounds the number and length of imported voice rules', () => {
  const profiles = Array.from({ length: 30 }, (_, index) => [
    `角色${index + 1}：`,
    ...Array.from({ length: 10 }, (_, rule) => `声线：${rule}${'一句话。'.repeat(100)}`),
  ].join('\n'));
  const voices = readOutlineCharacterVoices(['【人物声音表】', ...profiles].join('\n'));

  assert.equal(voices.length, 24);
  assert.ok(voices.every(item => item.voiceRules.length === 8 && item.voiceRules.every(rule => rule.length === 180)));
});
