const test = require('node:test');
const assert = require('node:assert/strict');

const {
  localExpertGate,
  shouldAuditChapterHooks,
  blockingNotes,
} = require('../services/generationGates');

// 真实感样本：段落长短不一、含对话、总长 >5000 —— 本地评分 70 且无风格扣分项。
const REAL_CHAPTER_POOL = [
  '“你终于来了。”他把窗户推开，风卷起桌上散落的稿纸。',
  '她没回答，只是把伞靠在门边，抖了抖袖口的水珠，屋里的暖气让镜片蒙上一层雾。她摘下眼镜，用衣角慢慢擦着，动作比平时慢很多，像是在等一个合适的开口时机。',
  '“我以为你不会来。”他说。',
  '“路上堵。”她说，“三环封了半条道，司机绕了很远。我在车上睡了一会儿，梦见我们在旧地址找那扇门，门开着，里面全是空的。”',
  '他沉默了几秒，把茶杯推到她面前。茶水已经凉了，杯壁上留着一圈浅褐色的痕。',
  '“门早就拆了。去年冬天，你走之后第二个月。”',
  '她握着杯子的手停住。窗外有人在楼下喊外卖，声音穿过玻璃变得模糊。她忽然想起那串钥匙还挂在老家厨房的钉子上。',
  '“拆的时候是谁签的字。”她问。',
  '“我。”他说，“字是我签的。钥匙我一直留着，铜的那把，齿有点钝了，去年配过一次新的，没用上。”',
  '她笑了一下，很短。那笑意没到眼睛里，但也没有别的意思，只是把这件事放下了。',
  '雨开始下大，敲在窗框上，节奏乱得很。她把凉茶喝完了，杯底压住一张旧照片的一角。',
];

function realisticChapter(minChars = 5200) {
  let text = '';
  let i = 0;
  while (text.length < minChars) { text += REAL_CHAPTER_POOL[i % REAL_CHAPTER_POOL.length] + '\n'; i++; }
  return text;
}

// 段落长度高度均匀（60 段 × 51 字）→ 触发 '段落长度过于均匀(AI特征)' 风格扣分
function uniformParagraphChapter() {
  const para = '他在原地站了很久，看着窗外的云慢慢移过去，心里想着那些说不清的事情，然后又低下头继续往前走，路很长。';
  return Array.from({ length: 60 }, () => para).join('\n');
}

test('干净的长章节通过专家门控（跳过 AI 审稿，省下最贵的一次调用）', () => {
  const gate = localExpertGate(realisticChapter());
  assert.equal(gate.gate, true, `期望通过门控，实际：${gate.reason}`);
  assert.ok(gate.local.score >= 70);
});

test('短章节不做门控：审稿成本本来就低，且短章更易有结构问题', () => {
  const gate = localExpertGate('他推门进来，屋里没人。'.repeat(60));
  assert.equal(gate.gate, false);
  assert.match(gate.reason, /章节长度/);
});

test('存在风格/格式扣分时必须进入 AI 审稿', () => {
  const gate = localExpertGate(uniformParagraphChapter());
  assert.equal(gate.gate, false);
  assert.match(gate.reason, /扣分/);
  assert.match(gate.reason, /段落长度过于均匀/);
});

test('奖励项与长度/对话观察不得阻断门控（防止长章节永远无法通过）', () => {
  // qualityScore 的 deductions 混装 +5 奖励项（章节充实/对话丰富）与
  // 写作方向观察（章节偏短/对话偏少），它们都不是风格缺陷。
  assert.deepEqual(blockingNotes(['章节充实', '对话丰富']), []);
  assert.deepEqual(blockingNotes(['章节偏短', '对话偏少']), []);
  assert.deepEqual(blockingNotes(['章节充实', 'AI味过重']), ['AI味过重']);
  assert.deepEqual(blockingNotes(undefined), []);
});

test('阈值可通过环境变量调整，且非法值回落默认', () => {
  const content = realisticChapter();
  const original = process.env.EXPERT_LOCAL_GATE_THRESHOLD;
  try {
    process.env.EXPERT_LOCAL_GATE_THRESHOLD = '101';
    assert.equal(localExpertGate(content).gate, false, '阈值高于满分时不应通过');
    assert.match(localExpertGate(content).reason, /阈值/);
    process.env.EXPERT_LOCAL_GATE_THRESHOLD = 'abc';
    assert.equal(localExpertGate(content).gate, true, '非法阈值应回落默认值');
  } finally {
    if (original === undefined) delete process.env.EXPERT_LOCAL_GATE_THRESHOLD;
    else process.env.EXPERT_LOCAL_GATE_THRESHOLD = original;
  }
});

test('门控可用 EXPERT_LOCAL_GATE=0 关闭', () => {
  const original = process.env.EXPERT_LOCAL_GATE;
  try {
    process.env.EXPERT_LOCAL_GATE = '0';
    const gate = localExpertGate(realisticChapter());
    assert.equal(gate.gate, false);
    assert.match(gate.reason, /门控已关闭/);
  } finally {
    if (original === undefined) delete process.env.EXPERT_LOCAL_GATE;
    else process.env.EXPERT_LOCAL_GATE = original;
  }
});

test('存在待回收伏笔时必须自评（需要对账）', () => {
  const result = shouldAuditChapterHooks({
    novel: { foreshadowingLedger: [{ id: 'FH_1_a', status: 'pending', content: '铜钥匙' }] },
    contract: {},
    content: realisticChapter(400),
  });
  assert.equal(result.audit, true);
  assert.match(result.reason, /待回收伏笔/);
});

test('仅 planned 伏笔不触发自评：尚未写入正文，模型无法对账', () => {
  const result = shouldAuditChapterHooks({
    novel: { foreshadowingLedger: [{ id: 'FH_20_b', status: 'planned', content: '未来的伏笔' }] },
    contract: {},
    content: realisticChapter(400),
  });
  assert.equal(result.audit, false, result.reason);
});

test('契约要求回收伏笔时必须自评', () => {
  const result = shouldAuditChapterHooks({
    novel: { foreshadowingLedger: [] },
    contract: { resolveHooks: ['铜钥匙的来源'] },
    content: realisticChapter(400),
  });
  assert.equal(result.audit, true);
  assert.match(result.reason, /契约要求回收/);
});

test('正文尾部出现新悬念时必须自评（可能补录计划外伏笔）', () => {
  const result = shouldAuditChapterHooks({
    novel: { foreshadowingLedger: [] },
    contract: {},
    content: `${realisticChapter(400)}\n他忽然发现，那扇门后似乎还站着另一个人。`,
  });
  assert.equal(result.audit, true);
  assert.match(result.reason, /新悬念/);
});

test('无可对账伏笔且正文无悬念时跳过自评', () => {
  const result = shouldAuditChapterHooks({
    novel: { foreshadowingLedger: [{ id: 'FH_1_a', status: 'resolved', content: '已回收' }] },
    contract: { setHooks: ['本章计划埋设'], resolveHooks: [] },
    content: '他和她在窗边坐了很久，茶凉了又热，谁都没有提起昨天的事。',
  });
  assert.equal(result.audit, false, result.reason);
  assert.match(result.reason, /无待对账伏笔/);
});

test('自评门控可用 HOOK_AUDIT_GATE=0 关闭', () => {
  const original = process.env.HOOK_AUDIT_GATE;
  try {
    process.env.HOOK_AUDIT_GATE = '0';
    const result = shouldAuditChapterHooks({ novel: {}, contract: {}, content: '无关正文' });
    assert.equal(result.audit, true);
    assert.match(result.reason, /门控已关闭/);
  } finally {
    if (original === undefined) delete process.env.HOOK_AUDIT_GATE;
    else process.env.HOOK_AUDIT_GATE = original;
  }
});

test('门控对缺失输入保持安全默认（不抛异常，缺输入视为无可对账内容）', () => {
  assert.equal(localExpertGate(undefined).gate, false);
  assert.equal(localExpertGate(null).gate, false);
  // 真实调用点始终传入 novel/contract；缺失时按"账本为空、无契约要求"处理，
  // 即无可对账内容 → 不发起自评，同时绝不因字段缺失而抛异常打断生成。
  assert.equal(shouldAuditChapterHooks().audit, false);
  assert.equal(shouldAuditChapterHooks({ novel: { foreshadowingLedger: [] } }).audit, false);
});

test('门控内部异常时朝"不跳过"降级，绝不中断生成主流程', () => {
  // 专家门控：异常 → 不跳过（照常审稿）
  const throwingContent = { toString() { throw new Error('boom'); } };
  const expertResult = localExpertGate(throwingContent);
  assert.equal(expertResult.gate, false);
  assert.match(expertResult.reason, /门控异常/);

  // 自评门控：异常 → 照常自评（保证伏笔账本不漏更新）
  const brokenNovel = { get foreshadowingLedger() { throw new Error('ledger boom'); } };
  const auditResult = shouldAuditChapterHooks({ novel: brokenNovel, contract: {}, content: '正文' });
  assert.equal(auditResult.audit, true);
  assert.match(auditResult.reason, /门控异常/);
});
