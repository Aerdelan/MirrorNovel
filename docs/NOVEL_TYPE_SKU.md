# 类型体系与「番茄式多选类型 SKU」

本文档说明 MirrorNovel 的小说类型系统：它如何组织类型、如何被前端选择、如何在后端解析成
风格与关键词、如何喂给 AI 生成链路，以及如何扩充。供维护者新增大类 / 题材 / 标签时参考。

相关代码（唯一真源）：

| 文件 | 职责 |
| --- | --- |
| `server/config/novelTypeSku.js` | SKU 数据（ tones / elements / personas / CATEGORY_TREE ）与解析函数 `resolveTypeSku` / 目录构建 `buildSkuCatalog` |
| `server/config/genreContracts.js` | **题材叙事契约**：契约正文 + 所有 tag 的显式映射（SKU 大类/题材、旧类型 id、老分类名）与统一解析入口 |
| `server/config/novelTypes.js` | 旧的单层 13 类型（带 `axes` 与 `contract`，向后兼容 `generate` 与轻小说等入口） |
| `server/config/novelTypeData.js` | 更早期的大类/子分类浏览数据（`/types/full`），仅作大类名兜底 |
| `server/routes/novel.js` | `resolveTypeContext` / `resolveTypeContextFromNovel` / `withSkuAxes` 辅助、`/types/sku` 端点、三路由接入 |
| `server/services/aiService.js` | `STYLE_AXES` 六轴定义、`normalizeAxes` / `mergeAxes` / `buildStyleProfileBlock`、`renderTypeMetaBlock` |
| `server/models/Novel.js` | `typeSku` 字段（存本书类型 SKU，续写时重算保持跨章一致） |

---

## 1. 设计动机

早期"类型"只是单选一个大类名，前端把大类名当 `novelTypeId` 传给后端，与带风格的
`novelTypes`（仅 13 条）名称失配时会回落到通用模板，导致：

- 类型太少、粒度太粗，子分类不可选；
- 不同"类型"最终落到相近的提示词，成稿风格趋同。

参考番茄小说的分类交互，本书类型不再单选一项，而是 **一个组合 SKU**：
频道 + 大类 + 题材（三者单选、逐级），再叠加 **可多选的标签**（情节元素 / 人设 / 风格基调）与
关系向（单选）。SKU 解析后产出 `keywords / aiWordBank / outlineSeed / axes`，
其中 `axes`（风格六轴）驱动"风格档案系统"，从架构上解决"千文一律"。

---

## 2. 风格六轴（axes）

六轴定义在 `aiService.js` 的 `STYLE_AXES`，每轴取值 **1–5**（1 偏左端、5 偏右端）。
`novelTypeSku.js` 中的 `AXIS_KEYS` 与之同序同键：

`temperature`（叙述温度）、`diction`（语言密度）、`narrator`（叙述者姿态）、
`pacing`（叙事节奏）、`humor`（幽默许可）、`emotion`（情绪表达）。

| 轴 | 左端（1） | 右端（5） |
| --- | --- | --- |
| temperature 叙述温度 | 冷峻克制、留白多、少抒情 | 温热外放、情感直给 |
| diction 语言密度 | 素白简劲、动词优先、少形容 | 浓丽铺陈、意象密集、修饰丰富 |
| narrator 叙述者姿态 | 隐形在场、不介入、不评论 | 介入张扬、可议论/吐槽/与读者互动 |
| pacing 叙事节奏 | 短促紧绷、场景切碎、推进快 | 舒缓绵长、从容铺展、细描慢写 |
| humor 幽默许可 | 正剧无谐、极少玩笑 | 高频谐趣、梗与反差常见 |
| emotion 情绪表达 | 内敛、靠潜台词与动作 | 直抒浓烈、允许情绪外溢 |

`buildStyleProfileBlock(axes)` 会把六轴渲染成 `【本书风格档案】` 块，作为**最高风格权威**
置顶注入，通用写作/去 AI 化指南只在档案许可范围内适用。无 `axes` 时返回空串（向后兼容，
行为退回到"底线 + 工艺指南"）。

> 轴数据在 SKU 里用**稀疏数组** `[temperature, diction, narrator, pacing, humor, emotion]`
> 书写，`null` 位表示"不改动该轴"，由 `axesFromSeed` 转成对象。

### 2.1 风格基调契约（toneContract）

六轴管"文风浓淡"，基调标签（tones）还额外升格为一份**硬承诺**：`resolveTypeSku` 把选中的
基调渲染成 `【风格基调契约】`（`buildToneContract`），紧随风格档案置顶注入系统提示，
要求全篇稳定兑现，防止基调被世界观/剧情默认气氛稀释。

除正文外，基调还会影响两处：`renderTonePlanHint` 把基调写进大纲与章节计划的提示（让阶段
与节点的安排为它留出空间），`storyState.inferStoryWeight` 把基调名并入情绪权重判定
（搞笑/治愈/日常 → light，暗黑/致郁/虐 → heavy），从而改变喘息章与张力基线。

---

## 3. SKU 数据结构

一次生成选择的完整 SKU：

```jsonc
{
  "channel":   "male",              // 频道：male | female（单选）
  "category":  "urban",             // 大类 id（单选）
  "theme":     "urban_naodong",     // 题材 id = 大类下的子类型（单选，可省）
  "elements":  ["xitong", "moshi"], // 情节/世界设定标签 id（多选）
  "personas":  ["fuhei", "banzhu"], // 主角/人物设定标签 id（多选）
  "tones":     ["gaoxiao", "shuang"],// 风格基调标签 id（多选，主要驱动 axes）
  "cp":        "single"             // 关系向 id（单选，前端持久化用）
}
```

- `channel` 当前仅 `male` / `female` 两档，与前端"男频/女频"两个 Tab 对应。
- `theme` 缺省时以 `category` 的基底风格解析。
- `cp` 目前只作为类型元信息随 `Novel.typeSku` 存储（供展示/续写还原），不参与
  `keywords` / `axes` 计算。

### 3.1 四类标签库（`novelTypeSku.js`）

| 常量 | 数量 | 结构 | 作用 |
| --- | --- | --- | --- |
| `TONES` | 12 | `{ name, keywords, axes }` | 风格基调，**直接驱动 axes**（优先级高于题材默认） |
| `ELEMENTS` | 65 | `[name, keywords, aiWordBank?]` | 情节/世界设定，并集进 keywords / aiWordBank |
| `CHARACTERS`（前端字段名 `personas`） | 30 | `[name, keywords]` | 人设标签，并集进 keywords |
| `CATEGORY_TREE` | 21 大类 / 98 题材 | 树（见 3.2） | 频道 → 大类 → 题材（单选层级），给基底 keywords / aiWordBank / axes |

> 命名提醒：SKU 里的 `personas` 指**人设标签**（CHARACTERS），与"写作人格"（WritingPersona）
> 不是一回事；前端选择器状态分别命名为 `skuCharTags`（人设标签）与 `selectedPersonaId`（写作人格），
> 避免混淆。

### 3.2 大类 → 题材树

```js
CATEGORY_TREE = {
  male:   [ { id, name, icon, keywords, aiWordBank, axes, themes: [ { id, name, keywords, axes }, ... ] }, ... ],
  female: [ ... ],
}
```

- male 大类（12）：都市、玄幻、仙侠、历史、武侠、科幻、悬疑灵异、游戏、体育、军事、二次元、现实
- female 大类（9）：现代言情、古代言情、玄幻言情、悬疑言情、青春校园、纯爱、百合、现言脑洞、星光璀璨
- **每个题材手写 `keywords` + 稀疏 `axes`**（覆盖大类基底）；大类给 `aiWordBank` 基底。

---

## 4. 解析：`resolveTypeSku(sku)`

输入 SKU（也接受字符串 id 或仅 `{ category }`，兼容旧 `novelTypeId`），输出：

```js
{ name, channel, category, theme, keywords, aiWordBank, outlineSeed, axes, contract, tones, toneContract }
```

解析步骤：

1. **定位大类与题材**：先按 `theme` 查 `THEME_INDEX` 命中大类；否则按 `category` 定位。
2. **基底 keywords / aiWordBank**：大类的 `keywords` / `aiWordBank` + 题材 `keywords`。
3. **多选标签并集**：`elements` / `personas` / `tones` 的关键词并入 `keywords`，
   `elements` 的 `aiWordBank` 并入 `aiWordBank`（`dedupeJoin` 去重合并）。
4. **axes 合成**（`mergeAxesLoose`，后者逐轴覆盖）：
   `大类基底 < 题材 < tones（按选择顺序）`。
5. **contract**：按 `题材 > 大类` 从 `genreContracts.js` 取叙事契约 key（见 8.1）。
6. `tones` / `toneContract`：多选基调的名字与硬契约文本（见 2.1）。
7. `name` 为 `大类·题材`（无题材时仅大类名）。

### 4.1 axes 最终优先级

```
题材/大类默认  <  tones 标签  <  写作人格 persona.axes
   (resolveTypeSku 内)          (novel.js withSkuAxes 内)
```

`resolveTypeSku` 内部合成出"类型轴"，随后在 `novel.js` 的 `withSkuAxes(persona, skuAxes)`
里做 `mergeAxes(skuAxes, persona.axes)` —— **人格最后覆盖，优先级最高**。

---

## 5. 后端接入（`server/routes/novel.js`）

- **`resolveTypeContext(body)`**：读 `body.typeSku` / `body.novelTypeId`，返回
  `{ type, skuAxes, resolvedName }`。`type` 是可直接喂给 `buildSystemPrompt` /
  `buildOutlinePrompt` / `buildChapterPlan` 的预解析类型对象
  （含 `axes` / `keywords` / `aiWordBank` / `contract` / `toneContract` / `toneNames`）。
  - 有 `typeSku`：走 `resolveTypeSku`。
  - 否则兼容旧路径：`novelTypes.find(id || name)`，miss 时回落 `novelTypeData` 大类名
    （按名字取 `contract`，不再留给下游正则猜）。
- **`resolveTypeContextFromNovel(novel)`**：续写/去 AI 味/润色等已落库场景用它还原类型上下文
  （新作品按 `typeSku`，旧作品回落 `novelTypeId`），这些链路此前一律传 `null` 契约，
  等于用类型名字符串重新猜一次题材。
- **`/types/sku`**（GET）：返回 `buildSkuCatalog()`，即前端选择器所需的全量目录：
  `{ axisKeys, tones:[{id,name}], elements:[{id,name}], personas:[{id,name}], channels, tree:{male,female:[{id,name,icon,themes:[{id,name}]}]} }`
- **三路由** `generate` / `generate-outline` / `generate-blueprint` 以及两处续写
  （章节流水线、`continue-chapter`）均：
  1. `const { type, skuAxes } = resolveTypeContext(...)`
  2. `persona = withSkuAxes(persona, skuAxes)`
  3. 把 `type` 传入 `buildSystemPrompt` / `buildOutlinePrompt` / `buildChapterPlan` /
     `buildInitialPrompt`（`renderTypeMetaBlock` 与基调提示由这些函数统一渲染，
     策划阶段与正文阶段看到的是同一份类型信息）。
- **`Novel.typeSku`**：创建作品时持久化；续写时用 `{ typeSku: novel.typeSku, novelTypeId }`
  重算，保证同一本书跨章风格一致（旧作品 `typeSku` 为 null，回落 `novelTypeId`）。

---

## 6. 前端接入（`client/src/views/GeneratePage.vue`，桌面端 alias 复用）

- **状态**：`skuCatalog` / `skuCategory` / `skuTheme` / `skuElements` / `skuCharTags` /
  `skuTones` / `skuCp`；`SKU_CP_OPTIONS` 为关系向常量。
- **选择器**：频道（男频/女频 Tab → `gender`）→ 大类 chips（单选）→ 题材 chips（单选可省）
  → 风格基调 / 情节元素 / 人设 三组多选 chips → 关系向（单选，再点取消）。
- **`buildTypeSku()`**：未选大类返回 `undefined`（后端回落 `novelTypeId`）；否则组装完整 SKU。
  三个生成入口（大纲 / 蓝图 / 整本）的 payload 均带 `novelTypeId: selectedType.value` 与
  `typeSku: buildTypeSku()`。`selectedType` 同步为"大类·题材"名，供旧展示与匹配逻辑使用。
- **目录加载**：`onMounted` 调 `novelStore.fetchSkuCatalog()`（`client/src/stores/novel.js`，
  带缓存，GET `/novel/types/sku`）。
- **人格六轴编辑器**：人格表单新增 `axesEnabled` 勾选 + 六条 range 滑条（1–5），读写
  `personaForm.axes`；保存时 `axes = axesEnabled ? {...} : null`（不勾选则从类型默认继承，
  避免强制中值抹平类型风格）。系统预置人格的轴只读（随 `isSystem` 禁用）。

### 6.1 i18n

- 新增 UI 文案：`generate.skuCategory/skuTheme/skuTones/skuElements/skuPersonas/skuCp/skuMultiHint`、
  `generate.personaAxesTitle/personaAxesHint`、`generate.axis.<key>.name/low/high`（zh.js / en.js）。
- 类型名翻译：大类/题材走 `$tn`（`typeNames` 表 + 中文兜底），标签（tone/element/persona/cp）
  走 `$tt`（`tagNames` 表 + 中文兜底）。高频大类与全部 tone/cp 已补双语；长尾题材/元素标签走
  **原始中文兜底**，缺 key 不会显空白。

---

## 7. 旧数据兼容规则

- 请求只带 `novelTypeId`（旧单层类型 id 或大类名）：`resolveTypeContext` 走兼容分支，
  `typeSku` 缺省不影响。
- `Novel.typeSku === null`：续写时回落 `novelTypeId`，不迁移历史数据。
- 人格无 `axes`：`withSkuAxes` 只带类型轴；类型也无轴（如旧通用类型）：
  `buildStyleProfileBlock` 返回空串，行为等同重构前（底线 + 工艺指南）。

---

## 8. 扩充指引（如何新增大类 / 题材 / 标签）

全部改动集中在 `server/config/novelTypeSku.js`，改完前端选择器与 `/types/sku` 自动生效。
**另外必须同步登记叙事契约**（见 8.1），否则该 tag 在成稿里不会生效。

**新增风格基调（tone）** — 会直接影响 axes：

```js
TONES.mytone = { name: '我的基调', keywords: '词1, 词2, 词3', axes: [null, null, 4, 2, null, null] };
// axes 用稀疏数组：只填想覆盖的轴，null 位保留题材默认
```

**新增情节元素 / 人设标签：**

```js
ELEMENTS.myel = ['我的元素', '关键词, 关键词, 关键词', '可选AI语汇, 另一个语汇'];
CHARACTERS.mychar = ['我的人设', '关键词, 关键词'];
```

**新增大类 / 题材：**

```js
// 在 CATEGORY_TREE.male（或 female）数组里加/改：
{
  id: 'newcat', name: '新大类', icon: '✨',
  keywords: '基底, 关键词', aiWordBank: '基底语汇',
  axes: [3, 3, 2, 2, 3, 3],
  themes: [
    { id: 'newcat_t1', name: '新题材', keywords: '题材关键词', axes: [4, null, null, 1, null, 4] },
  ],
}
```

注意事项：

- `id` 必须全局唯一（题材 id 亦需唯一，`THEME_INDEX` 以 theme id 建索引）。
- 若个别标签风格难以独立定义，把其 `axes` 稀疏位留 `null`（并入最接近的大类/题材基底），不要留空整项。
- 需要英文显示时，在 `client/src/locales/en.js` 的 `tagNames`（标签）/ `typeNames`（大类·题材）
  补对应 key；不补也能中文兜底显示。
- 改完建议校验：`node -e "require('./config/novelTypeSku').buildSkuCatalog()"`（在 `server/` 下）
  确认无语法/结构错误；`/types/sku` 能正常返回即前端可见。

### 8.1 叙事契约：每个 tag 必须独立登记（否则 tag 不生效）

每个大类/题材除了风格轴，还要决定**成稿按哪种叙事方式组织**（悬疑按线索、言情按关系、
军事按任务与代价……），这份文本叫「题材叙事契约」，统一登记在
`server/config/genreContracts.js`：

| 登记表 | 用途 |
| --- | --- |
| `SKU_CATEGORY_CONTRACTS` | SKU 大类 id → 契约 key（每个大类都必须有一条） |
| `SKU_THEME_CONTRACTS` | SKU 题材 id → 契约 key（只在题材叙事核心不属于本大类时登记） |
| `LEGACY_TYPE_CONTRACTS` | 旧单层类型 id（`novelTypes.js` 的 13 条）→ 契约 key |
| `TAXONOMY_NAME_CONTRACTS` | 老分类名（`novelTypeData.js` 的大类名）→ 契约 key |
| `CONTRACTS` | 契约 key → 正文（可扩充新契约，如 urban / game / military 就是新增的） |

可用 key：`mystery` / `romance` / `wuxia` / `xuanhuan` / `scifi` / `history` / `acgn` /
`urban` / `game` / `military` / `generic`。解析优先级为
`显式 contract → 旧类型 id 表 → 老分类名表 → 正则兜底 → generic`。

**硬性要求**：新增大类或题材后，必须在对应登记表里加一行。`tests/genreContracts.test.js`
会遍历 `CATEGORY_TREE` / `novelTypes` / `novelTypeData` 校验覆盖完整性——漏登记、或指向
不存在的 key，测试会直接失败。这条闸门的存在，是因为历史上一度靠"对类型名做正则猜题材"，
结果「二次元·日系校园」被"校园"二字判成言情契约、游戏/军事/纯爱全部落到通用契约，
用户选了 tag 成稿却不由它决定。

### 8.2 旧类型模板池与 SKU 的边界

`server/config/novelTemplates.js` 的模板池（建议看点/开场方式/节奏建议，按"类型名 +
世界观文本"匹配，男/女频通用爽文池）**只服务旧路径**。判断入口是
`novelTemplates.shouldInjectTemplates(typeSku)`：带 `typeSku`（选了频道/大类/题材）的作品
一律不注入，`/match-templates` 预览同步返回空列表，避免界面显示一个不生效的匹配。
