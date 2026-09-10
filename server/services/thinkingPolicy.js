/**
 * 深度思考模型适配策略
 *
 * 问题背景：思考型模型（GLM-4.x、DeepSeek-R1、Qwen3、Claude extended thinking…）
 * 会在正文之前输出大批 reasoning，而 reasoning 与正文**共享同一个 max_tokens 预算**：
 *   - 思考跑掉数万字 → 正文没预算了，输出被截断甚至为空；
 *   - 前端只看到"卡住"，页面超时、用户以为死机；
 *   - 一次失败的思考尝试动辄数百秒，重试又是同样的长思考（越重试越慢）。
 *
 * 本模块把"要不要思考、思考多少、用什么字段表达"集中成一份策略，供 streamGenerate 使用：
 *   1. 按线路家族选择正确的请求字段（各家的表达方式并不通用）；
 *   2. 预算分离：max_tokens = 正文预算 + 思考预算，思考超支先压缩思考而不是吃正文；
 *   3. 看门狗：思考字数超过上限且正文仍未开始 → 立刻掐断重来，不再干等数万字思考；
 *   4. 逐级降级：字段被拒 → 换下一组；模型要求必须思考 → 自动开启而不是直接报错。
 *
 * 环境变量：
 *   AI_THINKING_MODE=auto|enabled|disabled   默认 auto（按角色策略）
 *   AI_THINKING_BUDGET=<tokens>              统一覆盖各角色的思考预算
 *   AI_THINKING_MAX_CHARS=<chars>            看门狗阈值（思考超过该字数且无正文则掐断重试）
 *   AI_REASONING_EFFORT=low|medium|high      统一覆盖思考强度
 *   AI_THINKING_BUDGET_<ROLE>                按角色覆盖（如 AI_THINKING_BUDGET_WRITING）
 */

const MAX_TOTAL_TOKENS = 700000;
const MIN_CONTENT_TOKENS = 256;

// 各角色的默认思考策略：正文允许少量规划但严格限篇幅（速度优先），
// 大纲/审稿这类"想清楚再写"的任务给更大预算，润色属确定性改写，不需要思考。
const ROLE_THINKING_DEFAULTS = {
  outline: { enabled: true, budgetTokens: 4096, effort: 'medium' },
  writing: { enabled: true, budgetTokens: 2048, effort: 'low' },
  reasoning: { enabled: true, budgetTokens: 4096, effort: 'medium' },
  polish: { enabled: false, budgetTokens: 0, effort: 'low' },
};
const DEFAULT_ROLE_POLICY = { enabled: true, budgetTokens: 3072, effort: 'low' };

function readEnv(key) {
  const value = process.env[key];
  return value === undefined || value === '' ? null : String(value).trim();
}

/** 从 baseUrl 推断线路家族：不同家族表达"思考"的字段完全不同。 */
function detectProviderFamily(baseUrl) {
  const url = String(baseUrl || '').toLowerCase();
  if (!url) return 'unknown';
  if (url.includes('11434') || url.includes('ollama')) return 'ollama';
  if (url.includes('bigmodel') || url.includes('zhipu') || url.includes('glm')) return 'zhipu';
  if (url.includes('dashscope') || url.includes('aliyuncs') || url.includes('qwen')) return 'dashscope';
  if (url.includes('deepseek')) return 'deepseek';
  if (url.includes('anthropic') || url.includes('claude')) return 'anthropic';
  return 'openai_compat';
}

function roleDefaults(role) {
  return ROLE_THINKING_DEFAULTS[role] || DEFAULT_ROLE_POLICY;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

/**
 * 解析某个任务的思考策略。
 * @param {Object} params
 * @param {string} params.role - outline | writing | reasoning | polish
 * @param {string} params.baseUrl - 线路地址（用于家族探测）
 * @param {number} params.contentLimitTokens - 调用方期望的正文输出预算
 * @param {number} [params.providerCapTokens] - 已知的线路上限（服务商报错中解析得到）
 * @returns {{role:string, family:string, enabled:boolean, effort:string, thinkingBudget:number,
 *            contentBudget:number, maxTokens:number, maxReasoningChars:number}}
 */
function resolveThinkingPolicy({ role = 'writing', baseUrl = '', contentLimitTokens = 16384, providerCapTokens = null, forceDisabled = false } = {}) {
  const family = detectProviderFamily(baseUrl);
  const defaults = roleDefaults(role);

  // 兼容旧开关：AI_THINKING_DISABLED=true 等价于全局关闭思考。
  const legacyDisabled = String(readEnv('AI_THINKING_DISABLED') || '').toLowerCase() === 'true';
  const modeOverride = (readEnv('AI_THINKING_MODE') || 'auto').toLowerCase();
  let enabled = defaults.enabled;
  if (modeOverride === 'enabled') enabled = true;
  else if (modeOverride === 'disabled') enabled = false;
  // Ollama 本地模型没有这些字段，直接省略思考参数。
  if (family === 'ollama') enabled = false;
  if (legacyDisabled || forceDisabled) enabled = false;

  // AI_THINKING_BUDGET_<ROLE>=0 表示该角色直接关闭思考（追求最快响应）。
  const roleBudgetRaw = readEnv(`AI_THINKING_BUDGET_${String(role).toUpperCase()}`);
  if (roleBudgetRaw === '0') enabled = false;
  if (readEnv('AI_THINKING_BUDGET') === '0') enabled = false;
  const roleBudgetEnv = positiveNumber(roleBudgetRaw);
  const sharedBudgetEnv = positiveNumber(readEnv('AI_THINKING_BUDGET'));
  const budgetTokens = roleBudgetEnv || sharedBudgetEnv || defaults.budgetTokens;

  const effortEnv = (readEnv('AI_REASONING_EFFORT') || '').toLowerCase();
  const effort = ['low', 'medium', 'high'].includes(effortEnv) ? effortEnv : defaults.effort;

  const contentLimit = Math.max(MIN_CONTENT_TOKENS, Math.floor(Number(contentLimitTokens) || 16384));
  const cap = positiveNumber(providerCapTokens) || MAX_TOTAL_TOKENS;

  // 预算分离：思考预算与正文预算相加，而不是从正文里分。
  let thinkingBudget = enabled ? budgetTokens : 0;
  let contentBudget = contentLimit;
  if (contentBudget + thinkingBudget > cap) {
    // 上限不足时优先压缩思考预算，正文预算尽量保住。
    thinkingBudget = Math.max(0, Math.min(thinkingBudget, cap - contentBudget));
    contentBudget = Math.min(contentBudget, Math.max(MIN_CONTENT_TOKENS, cap - thinkingBudget));
  }

  const maxCharsEnv = positiveNumber(readEnv('AI_THINKING_MAX_CHARS'));
  // 中文约 1.5 字/token；给 1.6 倍冗余，避免正常思考被误判为失控。
  const maxReasoningChars = maxCharsEnv || (thinkingBudget > 0 ? Math.max(1500, Math.round(thinkingBudget * 1.6)) : 0);

  return {
    role,
    family,
    enabled,
    effort,
    thinkingBudget,
    contentBudget,
    maxTokens: Math.floor(contentBudget + thinkingBudget),
    maxReasoningChars,
    // 线路是否支持用数字约束思考篇幅。不支持时（如 GLM 只认 enabled/disabled），
    // 上限只能靠提示词和看门狗，调用方应主动注入"简明思考"要求以加快首字响应。
    budgetEnforced: family === 'anthropic' || family === 'dashscope',
  };
}

/**
 * 生成"思考字段"的候选序列（按优先级）。字段被服务商拒绝时逐级换下一组，
 * 最后一组永远是不带任何思考字段，保证请求至少能发出去。
 */
function thinkingFieldCandidates(policy, options = {}) {
  const { family, enabled, effort, thinkingBudget } = policy;
  if (!enabled) {
    return [
      { label: 'thinking:disabled', fields: { thinking: { type: 'disabled' } } },
      { label: 'enable_thinking:false', fields: { enable_thinking: false } },
      { label: 'omit', fields: {} },
    ];
  }
  const explicitEnable = { label: 'thinking:enabled', fields: { thinking: { type: 'enabled' } } };
  const effortField = { label: 'reasoning_effort', fields: { reasoning_effort: effort } };
  const candidates = [];
  if (family === 'zhipu') {
    candidates.push(explicitEnable);
  } else if (family === 'anthropic') {
    candidates.push({ label: 'thinking:budget', fields: { thinking: { type: 'enabled', budget_tokens: thinkingBudget } } });
  } else if (family === 'dashscope') {
    candidates.push({ label: 'enable_thinking', fields: { enable_thinking: true, thinking_budget: thinkingBudget } });
  } else if (options.preferExplicitEnable) {
    // 线路已经明确要求"必须开启思考"：优先用显式开启字段，而不是靠 effort 暗示。
    candidates.push(explicitEnable, effortField);
  } else {
    // DeepSeek 与通用 OpenAI 兼容线路：优先 reasoning_effort，其次 thinking。
    candidates.push(effortField, explicitEnable);
  }
  candidates.push({ label: 'omit', fields: {} });
  return candidates;
}

/** 服务商报"必须开启深度思考/不支持关闭思考"时，改用开启思考的候选序列。 */
function enableThinking(policy) {
  return {
    ...policy,
    enabled: true,
    thinkingBudget: policy.thinkingBudget || roleDefaults(policy.role).budgetTokens,
    maxTokens: Math.floor(policy.contentBudget + (policy.thinkingBudget || roleDefaults(policy.role).budgetTokens)),
    maxReasoningChars: policy.maxReasoningChars || Math.max(1500, Math.round((policy.thinkingBudget || 2048) * 1.6)),
  };
}

/**
 * 看门狗掐断或思考挤空正文后的收紧策略：降低思考预算（必要时直接关闭思考），
 * 正文预算保持不变——绝不能像旧实现那样"放大总预算"，那只会让思考更长。
 */
function tightenThinking(policy, { disableThinking = false } = {}) {
  const stillEnabled = !disableThinking && policy.enabled;
  // 注意：本来就没开思考（policy.thinkingBudget 为 0）时不能凭 || 兜底出一个预算，
  // 否则会在"思考已关闭"的状态下虚增 max_tokens。
  const nextBudget = stillEnabled ? Math.max(512, Math.floor((policy.thinkingBudget || 2048) / 2)) : 0;
  return {
    ...policy,
    enabled: stillEnabled,
    effort: 'low',
    thinkingBudget: nextBudget,
    maxTokens: Math.floor(policy.contentBudget + nextBudget),
    maxReasoningChars: nextBudget > 0 ? Math.max(1200, Math.round(nextBudget * 1.6)) : 0,
  };
}

function describeThinkingPolicy(policy) {
  if (!policy.enabled || policy.thinkingBudget <= 0) {
    return `思考=关闭（${policy.family}，正文预算 ${policy.contentBudget}）`;
  }
  return `思考=开启/${policy.family}/effort=${policy.effort}/思考预算 ${policy.thinkingBudget}/正文预算 ${policy.contentBudget}/看门狗 ${policy.maxReasoningChars} 字`;
}

module.exports = {
  resolveThinkingPolicy,
  thinkingFieldCandidates,
  enableThinking,
  tightenThinking,
  describeThinkingPolicy,
  detectProviderFamily,
  ROLE_THINKING_DEFAULTS,
  MAX_TOTAL_TOKENS,
};
