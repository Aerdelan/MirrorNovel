const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveThinkingPolicy,
  thinkingFieldCandidates,
  enableThinking,
  tightenThinking,
  detectProviderFamily,
  describeThinkingPolicy,
} = require('../services/thinkingPolicy');

const GLM = 'https://open.bigmodel.cn/api/paas/v4';
const DEEPSEEK = 'https://api.deepseek.com/v1';
const DASHSCOPE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const OLLAMA = 'http://localhost:11434';

function withEnv(overrides, fn) {
  const backup = {};
  for (const key of Object.keys(overrides)) backup[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(backup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('按地址识别线路家族，决定"思考"字段的表达方式', () => {
  assert.equal(detectProviderFamily(GLM), 'zhipu');
  assert.equal(detectProviderFamily(DEEPSEEK), 'deepseek');
  assert.equal(detectProviderFamily(DASHSCOPE), 'dashscope');
  assert.equal(detectProviderFamily(OLLAMA), 'ollama');
  assert.equal(detectProviderFamily('https://api.anthropic.com/v1'), 'anthropic');
  assert.equal(detectProviderFamily('https://my-proxy.example.com/v1'), 'openai_compat');
  assert.equal(detectProviderFamily(''), 'unknown');
});

test('预算分离：思考预算叠加在正文预算之上，正文不会被思考挤占', () => {
  const policy = withEnv({ AI_THINKING_MODE: undefined, AI_THINKING_BUDGET: '2000' }, () =>
    resolveThinkingPolicy({ role: 'writing', baseUrl: GLM, contentLimitTokens: 8000 }));
  assert.equal(policy.enabled, true);
  assert.equal(policy.contentBudget, 8000, '正文预算必须保持调用方要求的值');
  assert.equal(policy.thinkingBudget, 2000);
  assert.equal(policy.maxTokens, 10000, '总预算是两者相加，而不是从正文里分');
  assert.ok(policy.maxReasoningChars > 0);
});

test('线路上限不足时优先压缩思考预算，正文预算尽量保住', () => {
  const policy = withEnv({ AI_THINKING_BUDGET: '8000' }, () =>
    resolveThinkingPolicy({ role: 'writing', baseUrl: GLM, contentLimitTokens: 12000, providerCapTokens: 14000 }));
  assert.equal(policy.contentBudget, 12000, '正文预算优先保住');
  assert.equal(policy.thinkingBudget, 2000, '差额全部从思考预算里扣');
  assert.equal(policy.maxTokens, 14000);

  // 极端情况：连正文都放不下，也不允许出现负预算
  const tight = withEnv({ AI_THINKING_BUDGET: '8000' }, () =>
    resolveThinkingPolicy({ role: 'writing', baseUrl: GLM, contentLimitTokens: 30000, providerCapTokens: 8000 }));
  assert.equal(tight.thinkingBudget, 0);
  assert.ok(tight.maxTokens <= 8000);
  assert.ok(tight.contentBudget >= 256);
});

test('各角色默认策略：润色不思考，正文限篇幅，大纲/审稿给更大预算', () => {
  const writing = withEnv({ AI_THINKING_BUDGET: undefined }, () => resolveThinkingPolicy({ role: 'writing', baseUrl: GLM, contentLimitTokens: 4000 }));
  const outline = withEnv({ AI_THINKING_BUDGET: undefined }, () => resolveThinkingPolicy({ role: 'outline', baseUrl: GLM, contentLimitTokens: 4000 }));
  const polish = withEnv({ AI_THINKING_BUDGET: undefined }, () => resolveThinkingPolicy({ role: 'polish', baseUrl: GLM, contentLimitTokens: 4000 }));
  assert.equal(writing.enabled, true);
  assert.equal(outline.enabled, true);
  assert.equal(polish.enabled, false, '润色是确定性改写，思考只会拖慢速度');
  assert.ok(outline.thinkingBudget >= writing.thinkingBudget, '大纲需要更强的规划能力');
  assert.equal(polish.thinkingBudget, 0);
});

test('环境变量可全局/按角色覆盖，非法值回落默认', () => {
  const global = withEnv({ AI_THINKING_BUDGET: '1234' }, () => resolveThinkingPolicy({ role: 'writing', baseUrl: GLM, contentLimitTokens: 4000 }));
  assert.equal(global.thinkingBudget, 1234);

  const perRole = withEnv({ AI_THINKING_BUDGET: '1234', AI_THINKING_BUDGET_WRITING: '777' }, () =>
    resolveThinkingPolicy({ role: 'writing', baseUrl: GLM, contentLimitTokens: 4000 }));
  assert.equal(perRole.thinkingBudget, 777, '按角色覆盖优先于全局覆盖');

  const bad = withEnv({ AI_THINKING_BUDGET: 'abc' }, () => resolveThinkingPolicy({ role: 'writing', baseUrl: GLM, contentLimitTokens: 4000 }));
  assert.equal(bad.thinkingBudget, 2048, '非法值回落到角色默认');

  const forcedOff = withEnv({ AI_THINKING_MODE: 'disabled' }, () => resolveThinkingPolicy({ role: 'outline', baseUrl: GLM, contentLimitTokens: 4000 }));
  assert.equal(forcedOff.enabled, false);

  const legacyOff = withEnv({ AI_THINKING_MODE: undefined, AI_THINKING_DISABLED: 'true' }, () =>
    resolveThinkingPolicy({ role: 'outline', baseUrl: GLM, contentLimitTokens: 4000 }));
  assert.equal(legacyOff.enabled, false, '兼容旧的 AI_THINKING_DISABLED 开关');
});

test('Ollama 与强制关闭场景不携带思考字段', () => {
  const ollama = resolveThinkingPolicy({ role: 'writing', baseUrl: OLLAMA, contentLimitTokens: 4000 });
  assert.equal(ollama.enabled, false);
  assert.equal(ollama.thinkingBudget, 0);
  const forced = resolveThinkingPolicy({ role: 'writing', baseUrl: GLM, contentLimitTokens: 4000, forceDisabled: true });
  assert.equal(forced.enabled, false);
});

test('思考字段候选按家族定制，且始终保留"不带思考字段"的兜底档', () => {
  const zhipu = withEnv({ AI_THINKING_BUDGET: '2000' }, () => resolveThinkingPolicy({ role: 'writing', baseUrl: GLM, contentLimitTokens: 4000 }));
  assert.deepEqual(thinkingFieldCandidates(zhipu).map((c) => c.label), ['thinking:enabled', 'omit']);

  const deepseek = resolveThinkingPolicy({ role: 'writing', baseUrl: DEEPSEEK, contentLimitTokens: 4000 });
  assert.deepEqual(thinkingFieldCandidates(deepseek).map((c) => c.label), ['reasoning_effort', 'thinking:enabled', 'omit']);

  const dashscope = resolveThinkingPolicy({ role: 'writing', baseUrl: DASHSCOPE, contentLimitTokens: 4000 });
  const dashFields = thinkingFieldCandidates(dashscope);
  assert.equal(dashFields[0].label, 'enable_thinking');
  assert.equal(dashFields[0].fields.enable_thinking, true);

  const anthropic = resolveThinkingPolicy({ role: 'writing', baseUrl: 'https://api.anthropic.com/v1', contentLimitTokens: 4000 });
  assert.equal(thinkingFieldCandidates(anthropic)[0].fields.thinking.budget_tokens, anthropic.thinkingBudget);

  // 线路明确要求必须开启思考时，显式开启字段优先
  const preferExplicit = thinkingFieldCandidates(deepseek, { preferExplicitEnable: true });
  assert.equal(preferExplicit[0].label, 'thinking:enabled');

  // 关闭思考时提供两种关闭表达，最后一档不带字段
  const disabled = resolveThinkingPolicy({ role: 'writing', baseUrl: GLM, contentLimitTokens: 4000, forceDisabled: true });
  assert.deepEqual(thinkingFieldCandidates(disabled).map((c) => c.label), ['thinking:disabled', 'enable_thinking:false', 'omit']);
});

test('被要求必须开启思考时启用思考，且正文预算不被削减', () => {
  const disabled = resolveThinkingPolicy({ role: 'writing', baseUrl: GLM, contentLimitTokens: 6000, forceDisabled: true });
  const enabled = enableThinking(disabled);
  assert.equal(enabled.enabled, true);
  assert.ok(enabled.thinkingBudget > 0);
  assert.equal(enabled.contentBudget, 6000, '启用思考不得动正文预算');
  assert.equal(enabled.maxTokens, 6000 + enabled.thinkingBudget);
});

test('收紧策略：压缩思考预算、降低 effort，连续的收紧会关闭思考', () => {
  const policy = resolveThinkingPolicy({ role: 'outline', baseUrl: GLM, contentLimitTokens: 6000 });
  const first = tightenThinking(policy);
  assert.equal(first.enabled, true);
  assert.equal(first.effort, 'low');
  assert.ok(first.thinkingBudget < policy.thinkingBudget, '第一次收紧应压缩思考预算');
  assert.equal(first.contentBudget, 6000, '正文预算保持不变');

  const second = tightenThinking(policy, { disableThinking: true });
  assert.equal(second.enabled, false);
  assert.equal(second.thinkingBudget, 0);
  assert.equal(second.maxTokens, 6000, '关闭思考后总预算等于正文预算');
  assert.equal(second.maxReasoningChars, 0, '关闭思考后不再需要看门狗');
});

test('策略描述可用于日志排障', () => {
  const policy = resolveThinkingPolicy({ role: 'writing', baseUrl: GLM, contentLimitTokens: 4000 });
  assert.match(describeThinkingPolicy(policy), /思考=开启\/zhipu/);
  const off = tightenThinking(policy, { disableThinking: true });
  assert.match(describeThinkingPolicy(off), /思考=关闭/);
});
