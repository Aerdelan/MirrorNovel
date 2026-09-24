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

test('细分标签形成可执行合同：日系校园搞笑不会退化成霸总换皮，角色声音必须分化', () => {
  const r = resolveTypeSku({
    channel: 'male',
    category: 'acg',
    theme: 'acg_school',
    elements: ['riben', 'xiaoguo'],
    personas: ['aojiao', 'jiweng'],
    tones: ['gaoxiao', 'richang'],
    cp: 'single',
  });

  assert.equal(r.selection.theme, '日系校园');
  assert.deepEqual(r.selection.characters.map((item) => item.name), ['傲娇', '机灵/毒舌']);
  assert.equal(r.selection.cp.name, '单女主/单男主');
  assert.match(r.tagContract, /至少把三个锚点转化为会约束人物选择的规则、场所或日常流程/);
  assert.match(r.tagContract, /班级与座位、通学路线、部活分工/);
  assert.match(r.tagContract, /禁止偷渡总裁、豪门继承、商业并购/);
  assert.match(r.tagContract, /当前为原创模式/);
  assert.match(r.tagContract, /禁止直接使用、改一两个字使用、拆分拼接任何已存在的动漫/);
  assert.match(r.tagContract, /人设原型「傲娇」/);
  assert.match(r.tagContract, /人设原型「机灵\/毒舌」/);
  assert.match(r.tagContract, /禁止所有人都冷静分析、正确沟通/);
  assert.match(r.tagContract, /关系向规则：单女主\/单男主/);
});

test('同人模式只放行目标原作，不允许从无关作品拼角色名单', () => {
  const r = resolveTypeSku({ category: 'acg', theme: 'acg_doujin', elements: ['manju'] });
  assert.match(r.tagContract, /用户明确选择的同人\/综漫模式/);
  assert.match(r.tagContract, /不得从无关动漫、轻小说、游戏中拼接角色姓名/);
  assert.doesNotMatch(r.tagContract, /当前为原创模式/);
});

test('全量题材都生成可执行锚点，不能只把细分 tag 拼进关键词', () => {
  for (const [channel, categories] of Object.entries(CATEGORY_TREE)) {
    for (const category of categories) {
      for (const theme of category.themes) {
        const r = resolveTypeSku({ channel, category: category.id, theme: theme.id });
        assert.match(r.tagContract, /【题材锚点】/, `${theme.id} 缺少题材锚点`);
        assert.ok(r.tagContract.includes(`题材「${theme.name}」`), `${theme.id} 未保留精确题材名`);
        assert.match(r.tagContract, /主线矛盾、主要场景与角色职业\/身份必须从这些锚点生长/);
      }
    }
  }
});

test('全量情节、人设与基调 tag 都进入逐项执行合同', () => {
  for (const [id, value] of Object.entries(ELEMENTS)) {
    const r = resolveTypeSku({ category: 'acg', theme: 'acg_school', elements: [id] });
    assert.ok(r.tagContract.includes(`情节元素「${value[0]}」`), `情节 tag ${id} 未落地`);
  }
  for (const [id, value] of Object.entries(CHARACTERS)) {
    const r = resolveTypeSku({ category: 'acg', theme: 'acg_school', personas: [id] });
    assert.ok(r.tagContract.includes(`人设原型「${value[0]}」`), `人设 tag ${id} 未落地`);
  }
  for (const [id, value] of Object.entries(TONES)) {
    const r = resolveTypeSku({ category: 'acg', theme: 'acg_school', tones: [id] });
    assert.ok(r.tagContract.includes(`基调「${value.name}」`), `基调 tag ${id} 未落地`);
  }
});
