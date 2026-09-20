const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveTypeSku,
  buildSkuCatalog,
  TONES,
  ELEMENTS,
  CHARACTERS,
  CATEGORY_TREE,
  AXIS_KEYS,
} = require('../config/novelTypeSku');

test('buildSkuCatalog 输出前端选择器所需的全量目录', () => {
  const cat = buildSkuCatalog();
  assert.deepEqual(cat.axisKeys, AXIS_KEYS);
  assert.deepEqual(cat.channels, ['male', 'female']);
  // 四大库规模（对照番茄扩充，阈值防回退）
  assert.ok(cat.tones.length >= 12, 'tones 至少 12');
  assert.ok(cat.elements.length >= 60, 'elements 至少 60');
  assert.ok(cat.personas.length >= 30, 'personas 至少 30');
  const cats = cat.tree.male.concat(cat.tree.female);
  assert.ok(cats.length >= 20, '大类至少 20');
  const themes = cats.reduce((n, c) => n + c.themes.length, 0);
  assert.ok(themes >= 90, '题材至少 90');
  // 目录仅暴露 id/name（+大类 icon），不泄漏内部 keywords/axes
  assert.ok(cat.tones.every(t => typeof t.id === 'string' && typeof t.name === 'string'));
  assert.ok(cat.tree.male.every(c => Array.isArray(c.themes) && c.themes.every(t => t.id && t.name)));
});

test('resolveTypeSku：题材给基底、tones 覆盖共享轴、多选标签并集进 keywords', () => {
  const sku = {
    channel: 'male',
    category: 'urban',
    theme: 'urban_naodong',        // 都市脑洞
    elements: ['xitong'],          // 系统
    personas: [],
    tones: ['gaoxiao'],            // 搞笑/无厘头：humor 5
    cp: 'single',
  };
  const r = resolveTypeSku(sku);
  assert.equal(r.name, '都市·都市脑洞');
  assert.equal(r.channel, 'male');
  assert.equal(r.category, 'urban');
  assert.equal(r.theme, 'urban_naodong');
  // keywords 同时含题材基底、元素、tone 关键词
  assert.match(r.keywords, /系统/);
  assert.match(r.keywords, /吐槽/);
  // axes：gaoxiao 的 humor=5 覆盖题材默认；六轴对象
  assert.ok(r.axes && typeof r.axes === 'object');
  assert.equal(r.axes.humor, 5);
});

test('resolveTypeSku 兼容：字符串 id / 仅 category 也能解析，不抛错', () => {
  const byString = resolveTypeSku('urban');
  assert.match(byString.name, /都市/);
  const byCategoryOnly = resolveTypeSku({ category: 'xuanhuan' });
  assert.equal(byCategoryOnly.theme, null);
  assert.match(byCategoryOnly.name, /玄幻/);
  const empty = resolveTypeSku({});
  assert.ok(empty && typeof empty.name === 'string'); // 兜底 '未分类'
});

test('axes 优先级：tones 逐轴覆盖题材默认（mergeAxesLoose 后者胜）', () => {
  // 题材 urban_naodong 基底 axes=[4,2,4,2,4,3] → narrator=4；gaoxiao axes=[4,2,5,2,5,4] → narrator=5
  const noTone = resolveTypeSku({ category: 'urban', theme: 'urban_naodong' });
  const withTone = resolveTypeSku({ category: 'urban', theme: 'urban_naodong', tones: ['gaoxiao'] });
  assert.equal(noTone.axes.narrator, 4);                 // 题材默认
  assert.equal(withTone.axes.narrator, TONES.gaoxiao.axes[2]); // tone 覆盖为 5
  assert.equal(withTone.axes.narrator, 5);
});

test('resolveTypeSku：风格基调(tones)升格为硬契约 toneContract，未选基调时为空', () => {
  const r = resolveTypeSku({ channel: 'male', category: 'urban', theme: 'urban_naodong', tones: ['gaoxiao', 'richang'] });
  assert.deepEqual(r.tones, ['搞笑/无厘头', '轻松日常']);
  assert.match(r.toneContract, /风格基调契约/);
  assert.match(r.toneContract, /搞笑\/无厘头/);
  assert.match(r.toneContract, /轻松日常/);
  assert.match(r.toneContract, /必须在全篇稳定兑现/); // 防基调被世界观稀释的硬承诺
  // 未选 tones → 无契约（向后兼容旧数据）
  const noTone = resolveTypeSku({ category: 'urban', theme: 'urban_naodong' });
  assert.equal(noTone.toneContract, '');
  assert.deepEqual(noTone.tones, []);
});
