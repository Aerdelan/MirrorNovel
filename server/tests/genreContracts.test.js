/**
 * 题材契约映射的覆盖完整性与行为断言。
 *
 * 这一组用例是"所有 tag 必须独立生效"的闸门：
 * 任何新增的 SKU 大类/题材、旧类型、老分类，如果没有在 config/genreContracts.js
 * 里显式登记契约，这里会直接失败，而不是悄悄退回通用契约（通用契约＝题材不生效）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONTRACTS,
  CONTRACT_KEYS,
  SKU_CATEGORY_CONTRACTS,
  SKU_THEME_CONTRACTS,
  LEGACY_TYPE_CONTRACTS,
  TAXONOMY_NAME_CONTRACTS,
  resolveSkuContractKey,
  resolveGenreContract,
  isContractKey,
} = require('../config/genreContracts');
const { CATEGORY_TREE, resolveTypeSku } = require('../config/novelTypeSku');
const novelTypes = require('../config/novelTypes');
const novelTypeData = require('../config/novelTypeData');
const { buildGenreStyleContract, buildSystemPrompt, buildOutlinePrompt, buildChapterPlan, buildInitialPrompt } = require('../services/aiService');

function allSkuCategories() {
  return [...CATEGORY_TREE.male, ...CATEGORY_TREE.female];
}

test('契约映射完整性：SKU 每个大类都有登记，且不落通用契约', () => {
  for (const cat of allSkuCategories()) {
    const key = SKU_CATEGORY_CONTRACTS[cat.id];
    assert.ok(key, `SKU 大类 ${cat.id}(${cat.name}) 未登记契约`);
    assert.ok(isContractKey(key), `SKU 大类 ${cat.id} 指向未知契约 ${key}`);
    // 每个大类都必须有自己的契约，落到 generic 等于"这个 tag 不生效"
    assert.notEqual(key, 'generic', `SKU 大类 ${cat.id}(${cat.name}) 落到通用契约`);
  }
  // 反向：登记表里不应有已删除的大类
  const ids = new Set(allSkuCategories().map((c) => c.id));
  for (const id of Object.keys(SKU_CATEGORY_CONTRACTS)) {
    assert.ok(ids.has(id), `契约登记表里的 SKU 大类 ${id} 已不存在`);
  }
});

test('契约映射完整性：SKU 每个题材都能解析出有效契约（题材覆盖或继承大类）', () => {
  for (const cat of allSkuCategories()) {
    for (const theme of cat.themes || []) {
      const key = resolveSkuContractKey(cat.id, theme.id);
      assert.ok(isContractKey(key), `SKU 题材 ${theme.id}(${theme.name}) 解析不出契约`);
    }
  }
  for (const themeId of Object.keys(SKU_THEME_CONTRACTS)) {
    const exists = allSkuCategories().some((c) => (c.themes || []).some((t) => t.id === themeId));
    assert.ok(exists, `契约登记表里的 SKU 题材 ${themeId} 已不存在`);
    assert.ok(isContractKey(SKU_THEME_CONTRACTS[themeId]), `SKU 题材 ${themeId} 指向未知契约`);
  }
});

test('契约映射完整性：旧单层类型的每个 id 都登记契约，且与条目上的 contract 一致', () => {
  for (const type of novelTypes) {
    assert.ok(isContractKey(type.contract), `旧类型 ${type.id}(${type.name}) 的 contract 无效：${type.contract}`);
    assert.equal(LEGACY_TYPE_CONTRACTS[type.id], type.contract, `旧类型 ${type.id} 与登记表不一致`);
  }
});

test('契约映射完整性：老分类数据的每个大类名都能取到契约', () => {
  for (const channel of ['male', 'female']) {
    for (const cat of novelTypeData[channel] || []) {
      const key = TAXONOMY_NAME_CONTRACTS[cat.name];
      assert.ok(key, `老分类 ${cat.name} 未登记契约`);
      assert.ok(isContractKey(key), `老分类 ${cat.name} 指向未知契约 ${key}`);
    }
  }
});

test('契约登记表不引用未知 key', () => {
  const tables = [SKU_CATEGORY_CONTRACTS, SKU_THEME_CONTRACTS, LEGACY_TYPE_CONTRACTS, TAXONOMY_NAME_CONTRACTS];
  for (const table of tables) {
    for (const [id, key] of Object.entries(table)) {
      assert.ok(CONTRACT_KEYS.includes(key), `${id} 指向未知契约 ${key}`);
    }
  }
});

test('每个 SKU 大类经 resolveTypeSku 都能拿到自己的契约（选什么 tag 就按什么组织）', () => {
  const seen = new Map();
  for (const cat of allSkuCategories()) {
    const r = resolveTypeSku({ channel: cat.channel || (CATEGORY_TREE.male.includes(cat) ? 'male' : 'female'), category: cat.id });
    assert.ok(isContractKey(r.contract), `${cat.id} resolveTypeSku 未返回契约`);
    assert.notEqual(r.contract, 'generic', `${cat.id} resolveTypeSku 落到通用契约`);
    seen.set(cat.id, r.contract);
  }
  // 抽样校验：不同大类确实分到不同契约，而不是全挤在一条
  assert.equal(seen.get('urban'), 'urban');
  assert.equal(seen.get('acg'), 'acgn');
  assert.equal(seen.get('military'), 'military');
  assert.equal(seen.get('game'), 'game');
  assert.equal(seen.get('sports'), 'game');
  assert.equal(seen.get('xianxia'), 'xuanhuan');
  assert.equal(seen.get('f_mr'), 'romance');
  assert.equal(seen.get('f_star'), 'urban');
});

test('题材可覆盖大类契约（悬疑言情的探险盗墓按悬疑组织）', () => {
  assert.equal(resolveSkuContractKey('f_my', 'fmy_explore'), 'mystery');
  assert.equal(resolveSkuContractKey('f_my', 'fmy_detect'), 'romance');
  assert.equal(resolveSkuContractKey('f_my', null), 'mystery');
});

test('回归：二次元·日系校园 不再被判成言情，旧"校园"正则劫持已修', () => {
  const r = resolveTypeSku({ channel: 'male', category: 'acg', theme: 'acg_school', tones: ['gaoxiao'] });
  assert.equal(r.name, '二次元·日系校园');
  assert.equal(r.contract, 'acgn');

  const type = { id: r.name, name: r.name, keywords: r.keywords, aiWordBank: r.aiWordBank, axes: r.axes, contract: r.contract, toneContract: r.toneContract };
  const contract = buildGenreStyleContract(r.name, type);
  assert.match(contract, /轻小说\/ACGN/);
  assert.doesNotMatch(contract, /言情\/关系/);

  // 全量：任何含"校园"的 SKU 题材都不应被言情劫持（除非它自己登记为言情）
  for (const cat of allSkuCategories()) {
    for (const theme of cat.themes || []) {
      if (!/校园/.test(theme.name)) continue;
      const key = resolveSkuContractKey(cat.id, theme.id);
      const expected = SKU_CATEGORY_CONTRACTS[cat.id];
      assert.equal(key, expected, `${theme.name} 应继承大类契约 ${expected}`);
    }
  }
});

test('自由文本类型名的正则兜底：顺序修正后不再让"校园"吞掉其他题材', () => {
  // 登记表命中
  assert.match(resolveGenreContract({ names: ['青春校园'] }), /言情\/关系/);
  assert.match(resolveGenreContract({ names: ['纯爱（双男主）'] }), /言情\/关系/);
  assert.match(resolveGenreContract({ ids: ['lightnovel_school'] }), /轻小说\/ACGN/);
  // 未登记的自由文本 → 正则兜底
  assert.match(resolveGenreContract({ text: '校园恋爱日常' }), /言情\/关系/);
  assert.match(resolveGenreContract({ text: '二次元同人' }), /轻小说\/ACGN/);
  assert.match(resolveGenreContract({ text: '军旅谍战' }), /军事\/战争/);
  assert.match(resolveGenreContract({ text: '电竞网游' }), /游戏\/竞技/);
  // 完全无法判定 → 通用契约（诚实回落，不硬套某个题材）
  assert.equal(resolveGenreContract({ text: 'zzz 未分类' }), CONTRACTS.generic);
});

test('类型元数据贯穿：大纲/章节计划/单章提示都带上关键词与风格基调', () => {
  const r = resolveTypeSku({ channel: 'male', category: 'acg', theme: 'acg_school', tones: ['gaoxiao'] });
  const type = { id: r.name, name: r.name, keywords: r.keywords, aiWordBank: r.aiWordBank, axes: r.axes, contract: r.contract, toneContract: r.toneContract, toneNames: r.tones, tagContract: r.tagContract, selection: r.selection };

  const outline = buildOutlinePrompt(r.name, '苍太', '日系校园', 50000, null, 3000, type);
  assert.match(outline, /写作类型：二次元·日系校园/);
  assert.match(outline, /日系校园/);
  assert.match(outline, /搞笑\/无厘头/);            // 基调要进策划阶段
  assert.match(outline, /轻小说\/ACGN/);            // 契约按 SKU 取
  assert.match(outline, /【人物声音表】/);
  assert.match(outline, /禁止所有人都冷静、完整、讲逻辑/);

  const plan = buildChapterPlan('大纲正文', 50000, '苍太', '日系校园', null, null, 3000, type);
  assert.match(plan, /写作类型：二次元·日系校园/);
  assert.match(plan, /写作关键词：.*日系校园/);
  assert.match(plan, /搞笑\/无厘头/);
  assert.match(plan, /不同的当场目的与反应方式/);
  assert.match(plan, /不能把所有人的台词统一成冷静、完整、讲逻辑/);

  const initial = buildInitialPrompt(r.name, '苍太', '日系校园', 50000, 'chapter', '大纲正文', null, type);
  assert.match(initial, /请创作一部二次元·日系校园小说/);
  assert.match(initial, /写作关键词：.*部活/);
});

test('未传类型时旧行为不变（策划提示不因新参数而崩或串味）', () => {
  const plan = buildChapterPlan('大纲正文', 50000, '林舟', '旧城', null, null, 3000);
  assert.doesNotMatch(plan, /写作类型：/);
  assert.match(plan, /你是一位专业的小说章节规划师/);
  // 旧形态调用（第 7 位是蓝图对象）仍按旧参数重排，不把蓝图当成字数
  const legacyShape = buildChapterPlan('大纲正文', 100000, '林舟', '旧城', '', null, { phases: [] });
  assert.match(legacyShape, /你是一位专业的小说章节规划师/);
});

test('系统提示：SKU 的基调契约与关键词都进正文提示', () => {
  const r = resolveTypeSku({ channel: 'male', category: 'acg', theme: 'acg_school', tones: ['gaoxiao'] });
  const type = { id: r.name, name: r.name, keywords: r.keywords, aiWordBank: r.aiWordBank, axes: r.axes, contract: r.contract, toneContract: r.toneContract, toneNames: r.tones, tagContract: r.tagContract, selection: r.selection };
  const sys = buildSystemPrompt(r.name, undefined, null, type);
  assert.match(sys, /写作类型：二次元·日系校园/);
  assert.match(sys, /风格基调契约/);
  assert.match(sys, /搞笑\/无厘头/);
  assert.match(sys, /轻小说\/ACGN/);
  assert.match(sys, /标签执行合同/);
  assert.match(sys, /禁止偷渡总裁、豪门继承、商业并购/);
  assert.match(sys, /不能人人少年老成、冷静缜密/);
  assert.match(sys, /成熟的轻小说作者/);
  assert.doesNotMatch(sys, /【节奏紧凑】/);
  assert.doesNotMatch(sys, /言情\/关系/);
});
