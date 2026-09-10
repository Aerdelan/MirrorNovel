/**
 * 生成链路本地门控（零 token 预筛）
 *
 * 专家模式与章末自评原本对每章无条件发起模型调用，好章节也要付全价。
 * 这里用本地启发式（qualityScore / 伏笔账本 / 章节契约 / 正文悬念标记）先做
 * 零成本判断，只在真正有风险或需要对账时才调用模型。
 *
 * 设计原则：门控必须"宁漏不误伤"——AI 审稿承担的是连续性与因果判断，
 * 本地启发式无法替代，所以只在证据充分时才省下这次调用；被跳过的章节会把
 * 判断依据写回 qualityReport，事后可审计。
 *
 * 环境变量：
 *   EXPERT_LOCAL_GATE=0            关闭专家审稿门控（默认开启）
 *   EXPERT_LOCAL_GATE_THRESHOLD   本地评分阈值，默认 70（调高更严格，章节更少被跳过）
 *   HOOK_AUDIT_GATE=0              关闭章末自评门控（默认开启）
 */

const { qualityScore } = require('./chapterToolchain');

const DEFAULT_EXPERT_GATE_THRESHOLD = 70;
// 低于此长度的章节本身审稿成本很低，且短章更容易存在结构问题，不做门控。
const EXPERT_GATE_MIN_CHARS = 3000;

/**
 * qualityScore() 的 deductions 数组是"备注"而非纯扣分表：+5 的奖励项
 * （章节充实、对话丰富）与扣分项混在同一个数组里。若直接以"数组为空"作为
 * 通过条件，长章节必然带 '章节充实' 而永远无法通过——恰好把审稿最贵的
 * 长章节全部挡住。因此这里显式分类。
 */
const REWARD_NOTES = new Set(['章节充实', '对话丰富']);
// 长度与对话密度属于"写作方向"观察，AI 审稿（连续性/因果/伏笔一致性）
// 并不会修复它们，也不作为门控阻断项。
const NON_BLOCKING_NOTES = new Set(['章节过短', '章节偏短', '对话偏少']);

function blockingNotes(notes) {
  return (Array.isArray(notes) ? notes : []).filter(
    (note) => !REWARD_NOTES.has(note) && !NON_BLOCKING_NOTES.has(note)
  );
}

function expertLocalGateEnabled() {
  return String(process.env.EXPERT_LOCAL_GATE || '1') !== '0';
}

function hookAuditGateEnabled() {
  return String(process.env.HOOK_AUDIT_GATE || '1') !== '0';
}

function expertGateThreshold() {
  const value = Number(process.env.EXPERT_LOCAL_GATE_THRESHOLD);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_EXPERT_GATE_THRESHOLD;
}

/**
 * 专家审稿门控：本地评分达标且无任何扣分项时才跳过 AI 审稿。
 * 长章节恰恰是审稿最贵的一类，所以"足够长 + 明显干净"的组合收益最高。
 * @returns {{gate: boolean, reason: string, local?: object}}
 */
function localExpertGate(content) {
  try {
    if (!expertLocalGateEnabled()) return { gate: false, reason: '门控已关闭' };
    const text = String(content || '').trim();
    if (text.length < EXPERT_GATE_MIN_CHARS) {
      return { gate: false, reason: `章节长度 ${text.length} < ${EXPERT_GATE_MIN_CHARS}` };
    }
    const local = qualityScore(text);
    if (!local || typeof local.score !== 'number') return { gate: false, reason: '本地评分不可用' };
    const blocked = blockingNotes(local.deductions);
    if (blocked.length) {
      return { gate: false, reason: `本地质检扣分（${blocked.join('、')}）` };
    }
    const threshold = expertGateThreshold();
    if (local.score < threshold) {
      return { gate: false, reason: `本地评分 ${local.score} < 阈值 ${threshold}` };
    }
    return { gate: true, reason: `本地评分 ${local.score}，无风格/格式扣分项`, local };
  } catch (error) {
    // 门控属于优化手段，任何异常都必须降级为"照常审稿"，绝不能打断生成主流程。
    return { gate: false, reason: `门控异常，按未通过处理：${error.message}` };
  }
}

/**
 * 章末自评门控：只有"存在待对账伏笔"或"本章契约要求回收"或"正文尾部出现新悬念"时，
 * 语义级自评才有增量价值；否则启发式结果（updateForeshadowingDoc / updateCreativeState）
 * 已经足够，不必每章都付一次推理调用。
 *
 * 注意 planned 状态的伏笔尚未写入正文，模型无法在本章对其对账，故不计入门控条件——
 * 否则计划型长篇会因 "planned 永远非空" 而永远触发调用，门控形同虚设。
 * @returns {{audit: boolean, reason: string}}
 */
function shouldAuditChapterHooks({ novel, contract, content } = {}) {
  try {
    if (!hookAuditGateEnabled()) return { audit: true, reason: '门控已关闭' };

    const pending = (novel?.foreshadowingLedger || []).filter((item) => item.status === 'pending');
    if (pending.length) return { audit: true, reason: `存在 ${pending.length} 条待回收伏笔` };

    if ((contract?.resolveHooks || []).length) return { audit: true, reason: '本章契约要求回收伏笔' };

    // 与 updateForeshadowingDoc 的伏笔标记词对齐：本地启发式认为"这里可能埋了东西"时，
    // 正是语义级自评最该复核的场景，不能省。
    const tail = String(content || '').slice(-600);
    if (/埋下|悬念|谜团|未解之谜|难道|究竟|突然|意外|秘密|隐藏|不对劲|奇怪|发现/.test(tail)) {
      return { audit: true, reason: '正文尾部出现疑似新悬念' };
    }

    return { audit: false, reason: '无待对账伏笔且正文无新悬念' };
  } catch (error) {
    // 同专家门控：异常时降级为"照常自评"，确保伏笔账本不会因门控缺陷而漏更新。
    return { audit: true, reason: `门控异常，按需要自评处理：${error.message}` };
  }
}

module.exports = {
  localExpertGate,
  shouldAuditChapterHooks,
  expertLocalGateEnabled,
  hookAuditGateEnabled,
  expertGateThreshold,
  blockingNotes,
  EXPERT_GATE_MIN_CHARS,
};
