const test = require('node:test');
const assert = require('node:assert/strict');
const { readOutlineForeshadowing } = require('../services/outlineForeshadowing');

test('reads the declared hook schedule and preserves payoff milestones and wording', () => {
  const outline = `【伏笔与回收表】
伏笔1：票背双孔
埋设章：第3章（林见夏捡起一张旧车票，在第4章才提到上面的污迹）。
表面解释：乘客把票穿线绑东西。
真实含义：双孔对应记忆段落编码。
回收章：第58章（还原制造工序），第96章（名单公示后新票不再打孔）。

伏笔2：哼错的旋律
埋设章：第2章（队友哼错调子）。
推进章：第60章。
回收章：第52章（辨认来源），第85章（改对调子），第100章（哼对了歌）。

【结局方向】
伏笔3：主角回家的路线
埋设章：第99章。
回收章：第100章。`;
  const hooks = readOutlineForeshadowing(outline, 100);
  assert.deepEqual(hooks.map(({ name, setupChapter, progressChapters, payoffChapter }) => [name, setupChapter, progressChapters, payoffChapter]), [
    ['票背双孔', 3, [58], 96],
    ['哼错的旋律', 2, [52, 60, 85], 100],
  ]);
  assert.match(hooks[0].plan, /双孔对应记忆段落编码/);
  assert.match(hooks[0].plan, /第96章（名单公示后新票不再打孔）/);
});

test('reads marked prose and Markdown tables while keeping only explicit chapter endpoints', () => {
  const outline = `## 伏笔回收表
### 伏笔一：空号
- **埋设章**：第3至第5章。
- **回收章**：第62、94—96章。

## 伏笔回收表
| 伏笔名称 | 铺设章节 | 回收章号 | 真实含义 |
| :--- | --- | ---: | --- |
| 水表 | 10 | 第40章（找到管线），第93章（恢复正转） | 设备被暗中用于抽水 |
| 小钥匙 | 第20章 | 以后 | 无明确回收章 |

## 下一部分
| 伏笔名称 | 埋设章 | 回收章 |
| --- | --- | --- |
| 新主线 | 15 | 20 |`;
  const hooks = readOutlineForeshadowing(outline, 100);
  assert.deepEqual(hooks.map(({ name, setupChapter, progressChapters, payoffChapter }) => [name, setupChapter, progressChapters, payoffChapter]), [
    ['空号', 3, [5, 62, 94], 96],
    ['水表', 10, [40], 93],
  ]);
});

test('deduplicates equal schedules and omits contradictory, reversed, out-of-book and incomplete rows', () => {
  const outline = `【伏笔与回收表】
伏笔1：投票纸
埋设章：第2章
回收章：第20章
伏笔2：调度椅
埋设章：第8章
回收章：第22章
伏笔3：逆序
埋设章：第10章
回收章：第6章
伏笔4：超出正文
埋设章：第11章
回收章：第18章、第31章
伏笔5：缺少章号
埋设章：第5章
真实含义：主角后来补齐记录。

【伏笔与回收表】
伏笔1：投票纸
埋设章：第2章
回收章：第20章
伏笔2：调度椅
埋设章：第8章
回收章：第27章`;
  assert.deepEqual(readOutlineForeshadowing(outline, 30).map(hook => hook.name), ['投票纸']);
  assert.deepEqual(readOutlineForeshadowing('伏笔1：投票纸\n埋设章：2\n回收章：20', 30), []);
});
