/**
 * 题材叙事契约（genre contract）——**所有类型体系的唯一映射源**
 *
 * 背景：项目里同时存在三套类型体系（见 docs/NOVEL_TYPE_SKU.md）：
 *   1. 番茄式多选 SKU（config/novelTypeSku.js）——大类 + 题材 + 情节/人设/基调标签；
 *   2. 旧单层类型（config/novelTypes.js）——13 条，仍服务轻小说入口与老作品；
 *   3. 更早期的大类浏览数据（config/novelTypeData.js）——仅作大类名兜底。
 *
 * 这三套里的每一个 tag 都必须能独立、正确地映射到一份叙事契约。此前这件事是靠
 * 在 aiService 里对类型名做正则（/悬疑|言情|校园|…/）猜的，于是"二次元·日系校园"
 * 被"校园"二字劫持成言情契约、"纯爱""现言脑洞""游戏""军事"全部落到通用契约——
 * 用户选了什么 tag，成稿的叙事组织方式却不由它决定，这就是"tag 不生效"的根因之一。
 *
 * 现在改为**显式登记**：
 *   - SKU 大类 → 契约：SKU_CATEGORY_CONTRACTS
 *   - SKU 题材 → 契约：SKU_THEME_CONTRACTS（只在题材的叙事核心不属于大类时才登记）
 *   - 旧类型 id → 契约：LEGACY_TYPE_CONTRACTS
 *   - 老分类名 → 契约：TAXONOMY_NAME_CONTRACTS
 *   - 以上都未命中（例如老作品存的是自由文本类型名）才走 FALLBACK_RULES 正则兜底
 *
 * 新增类型 / 题材时必须同步登记，否则 tests/genreContracts.test.js 的覆盖完整性
 * 用例会直接失败——这是防止"新 tag 悄悄退回通用契约"的闸门。
 */

// ===== 契约正文（按 key 索引；正文改动会直接影响提示词，务必保持写法导向、可执行） =====
const CONTRACTS = {
  mystery: `【题材叙事契约：悬疑/惊悚】
以受限信息和可验证线索组织阅读体验：先给可观察事实，再给解释冲突，重要真相要通过行为、证据和视角偏差逐层释放。场景优先写声音、光线、物证、空间死角和人物反应；对白允许回避、试探和不完整回答。不要用全知旁白提前解释谜底，不要每段都用夸张形容词制造恐怖。`,

  romance: `【题材叙事契约：言情/关系】
以关系变化而非事件清单组织章节：每次相处都要改变信任、边界、误解或选择。把情绪放进动作、距离、礼物、沉默和未说出口的判断里；对白保留双方目标差异，不用旁白反复宣布“心动/虐/甜”。日常段落可以完整展开，但必须留下关系或记忆的不可逆变化。`,

  wuxia: `【题材叙事契约：武侠/江湖】
以选择、恩义、规矩和代价塑造人物，不把江湖写成连续升级表。动作场面交代地形、兵器、节奏和判断，决斗结果必须由先前立场与代价积累而来。留出赶路、饮酒、疗伤、守约等低压段，让人物的江湖关系和失去的东西沉淀下来。`,

  xuanhuan: `【题材叙事契约：玄幻/修仙】
让力量体系服务于人物选择、世界规则和代价，不用境界名词替代戏剧。场景重点是感知变化、资源限制、仪式和人与天地/宗门的关系；突破必须改变责任或风险。阶段之间保留修行、行旅、同伴相处和规则观察，使世界有生活纹理而非只剩任务与战斗。`,

  scifi: `【题材叙事契约：科幻/未来】
以技术后果、制度约束和陌生环境改变人物选择，不用术语堆砌未来感。优先写界面、设备、身体感受、空间尺度和信息不对称；解释世界观时让人物通过工作、故障、交易或日常使用发现规则。关键段落之间允许安静的观察和共同生活，让宏大设定落到人的损失与愿望。`,

  history: `【题材叙事契约：历史/权谋】
以身份、制度、利益和礼法塑造冲突，避免现代口吻直接替代时代人物。信息通过奏报、账册、宴席、军令、流言和沉默的站位流动；每次谋略都要有资源与政治代价。安排具有时代生活质感的间歇场景，让人物关系和权力变化在低声交谈、劳作或仪式中沉淀。`,

  acgn: `【题材叙事契约：轻小说/ACGN】
以角色关系、具体处境和轻重反差形成节奏，不依赖统一吐槽、口头禅或模板化萌反应。冒险、校园、社团和共同生活都必须推进关系、信息或规则理解；重大情绪前允许轻松段落积累记忆，避免每章都用相同的笑点和收尾方式。`,

  urban: `【题材叙事契约：都市/现实】
以职业、行业规则、人情往来与现实约束组织冲突：钱、时间、关系网和信息差都要有具体来源，收益与代价同时落地。场景优先写合同条款、办公室博弈、通勤与家庭负担这类可验证的日常细节，让人物的专业能力在具体工序里体现。爽点（打脸/逆袭/收获）必须建立在前面已交代的资源、人脉或专业积累上，不做无来由的碾压，也不用旁白替人物宣布成功。`,

  game: `【题材叙事契约：游戏/竞技】
以规则、成长曲线与对抗节奏组织阅读体验：赛制、版本、数据、体能与训练量都要具体，胜负必须由准备、判断和临场选择决定。场景写清队友分工、教练意图、观众压力与身体极限；关键对局要有可复盘的过程，而不是只报比分。阶段之间保留训练、复盘、队内摩擦与生活片段，让"变强"有代价、有痕迹。`,

  military: `【题材叙事契约：军事/战争】
以任务、纪律、装备限制与战友关系塑造冲突：命令链条、情报真伪、后勤与伤亡都要有分量，行动结果由准备程度与临场判断决定。场景写清口令、地形、装备状态和队伍默契；战斗段落交代目标、代价与后续影响，不把战争写成单人无双。任务之间保留驻训、休整、家书与军属生活，让牺牲与荣誉落到具体的人和关系上。`,

  generic: `【题材叙事契约】
从当前题材、世界规则、人物关系和大纲中提炼本书独有的叙事特征（叙事距离、信息释放速度、感官重点、对白密度、低压场景形态），并在全文保持这一组特征。具体调到冷峻还是温热、克制还是外放、素白还是浓丽，一律以上方本书风格档案为准，本契约不把本书预设成某一种统一文风。`,
};

/** 契约 key 集合（覆盖完整性用例据此校验，避免登记了不存在的 key） */
const CONTRACT_KEYS = Object.keys(CONTRACTS);

// ===== SKU 大类 id → 契约 key =====
// 规则：大类定契约；只有题材的叙事核心明显不属于本大类时，才在 SKU_THEME_CONTRACTS 里改判。
const SKU_CATEGORY_CONTRACTS = {
  // 男频
  urban: 'urban',            // 都市
  xuanhuan: 'xuanhuan',      // 玄幻
  xianxia: 'xuanhuan',       // 仙侠（同属修仙谱系）
  lishi: 'history',          // 历史
  wuxia: 'wuxia',            // 武侠
  scifi: 'scifi',            // 科幻
  mystery: 'mystery',        // 悬疑灵异
  game: 'game',              // 游戏
  sports: 'game',            // 体育（同属竞技）
  military: 'military',      // 军事
  acg: 'acgn',               // 二次元
  reality: 'urban',          // 现实（当代背景/行业/人情，与都市同一契约）
  // 女频
  f_mr: 'romance',           // 现代言情
  f_ar: 'romance',           // 古代言情
  f_xh: 'romance',           // 玄幻言情
  f_my: 'mystery',           // 悬疑言情（悬疑是结构核心，甜宠题材单独改判）
  f_sc: 'romance',           // 青春校园
  f_bl: 'romance',           // 纯爱
  f_gl: 'romance',           // 百合
  f_fantasy_brain: 'romance',// 现言脑洞
  f_star: 'urban',           // 星光璀璨（娱乐圈/行业线，与都市同一契约）
};

// ===== SKU 题材 id → 契约 key（覆盖大类；未登记的题材继承大类契约） =====
const SKU_THEME_CONTRACTS = {
  fmy_detect: 'romance',   // 推理甜宠：甜宠/关系是核心，推理只作调味
  fmy_lingyi: 'romance',   // 灵异言情：关系线为主
  fmy_explore: 'mystery',  // 探险盗墓：无感情核心，按悬疑/探险组织
};

// ===== 旧单层类型 id → 契约 key（config/novelTypes.js 的 13 条） =====
const LEGACY_TYPE_CONTRACTS = {
  xianxia: 'xuanhuan',
  urban: 'urban',
  scifi: 'scifi',
  wuxia: 'wuxia',
  mystery: 'mystery',
  romance: 'romance',
  historical: 'history',
  lightnovel_isekai: 'acgn',
  lightnovel_school: 'acgn',    // 轻小说入口，按 ACGN 契约（旧正则靠"校园"误判成言情）
  lightnovel_fantasy: 'acgn',
  lightnovel_slice: 'acgn',
  lightnovel_battle: 'acgn',
  lightnovel_scifi: 'acgn',     // 轻小说引擎的科幻未来，仍按 ACGN 组织（风格由轻小说分支决定）
};

// ===== 老分类名（config/novelTypeData.js 的大类名）→ 契约 key =====
// 该文件只在大类名兜底时被用到，按名字登记，避免再次退回正则猜测。
const TAXONOMY_NAME_CONTRACTS = {
  都市: 'urban',
  玄幻: 'xuanhuan',
  仙侠: 'xuanhuan',
  历史: 'history',
  武侠: 'wuxia',
  科幻: 'scifi',
  悬疑灵异: 'mystery',
  游戏: 'game',
  体育: 'game',
  军事: 'military',
  二次元: 'acgn',
  现实: 'urban',
  现代言情: 'romance',
  古代言情: 'romance',
  玄幻言情: 'romance',
  悬疑言情: 'mystery',
  青春校园: 'romance',
  '纯爱（双男主）': 'romance',
  '百合（双女主）': 'romance',
  现言脑洞: 'romance',
  星光璀璨: 'urban',
};

// ===== 最后兜底：仅当上面全部未命中（老作品存的是自由文本类型名）才走这里 =====
// 顺序即优先级：
//   - 结构性强的题材（悬疑/ACGN/武侠/玄幻/科幻/历史/军事/游戏）在前；
//   - 言情在都市之前——"都市言情""校园恋爱"这类应以关系线为准；
//   - 都市放最后，"职场/商战/娱乐圈"这类纯当代行业词才落到它。
// 注意不要把"日常""现代"这类泛词放进都市规则：它们会把"校园恋爱日常"抢走。
const FALLBACK_RULES = [
  [/mystery|detective|suspense|horror|thriller|悬疑|推理|灵异|惊悚|盗墓|民俗/, 'mystery'],
  [/lightnovel|isekai|轻小说|异世界|二次元|acg|综漫|同人|番剧|漫展/, 'acgn'],
  [/wuxia|martial|jianghu|武侠|江湖|古武/, 'wuxia'],
  [/xianxia|xuanhuan|修仙|仙侠|玄幻|洪荒|封神|修真/, 'xuanhuan'],
  [/scifi|science|科幻|未来|星际|末世|废土|机甲|赛博/, 'scifi'],
  [/historical|history|古代|历史|宫斗|权谋|朝堂|架空|穿越/, 'history'],
  [/military|战争|抗战|谍战|军旅|特种兵|兵王/, 'military'],
  [/game|游戏|电竞|网游|体育|竞技|球类/, 'game'],
  [/romance|love|言情|恋爱|甜宠|婚恋|纯爱|百合|校园|青春/, 'romance'],
  [/都市|现实|职场|商战|娱乐圈|年代|行业/, 'urban'],
];

/** SKU 大类 + 题材 → 契约 key（题材未登记时继承大类） */
function resolveSkuContractKey(categoryId, themeId) {
  if (themeId && SKU_THEME_CONTRACTS[themeId]) return SKU_THEME_CONTRACTS[themeId];
  if (categoryId && SKU_CATEGORY_CONTRACTS[categoryId]) return SKU_CATEGORY_CONTRACTS[categoryId];
  return '';
}

/** 旧类型 id → 契约 key */
function resolveLegacyTypeContractKey(typeId) {
  return (typeId && LEGACY_TYPE_CONTRACTS[typeId]) || '';
}

/** 老分类名 → 契约 key */
function resolveTaxonomyContractKey(name) {
  return (name && TAXONOMY_NAME_CONTRACTS[name]) || '';
}

function matchFallbackRule(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return '';
  for (const [re, key] of FALLBACK_RULES) if (re.test(s)) return key;
  return '';
}

/**
 * 统一入口：拿到最终契约正文。
 *
 * 解析优先级（每一步都显式，不再由正则猜）：
 *   1. explicit —— 调用方已解析好的契约 key（SKU 解析结果 / 旧类型条目 / 分类表都走这条）
 *   2. 旧类型 id 登记表
 *   3. 老分类名登记表
 *   4. 正则兜底（自由文本类型名）
 *   5. generic
 *
 * @param {{ explicit?:string, ids?:string[], names?:string[], text?:string }} input
 * @returns {string} 契约正文
 */
function resolveGenreContract(input = {}) {
  const { explicit, ids = [], names = [], text } = input;
  const clean = (v) => String(v || '').trim();

  if (explicit && CONTRACTS[explicit]) return CONTRACTS[explicit];

  for (const id of ids) {
    const key = resolveLegacyTypeContractKey(clean(id)) || resolveTaxonomyContractKey(clean(id));
    if (key && CONTRACTS[key]) return CONTRACTS[key];
  }
  for (const name of names) {
    const key = resolveTaxonomyContractKey(clean(name));
    if (key && CONTRACTS[key]) return CONTRACTS[key];
  }

  const candidates = [...ids, ...names, text].map(clean).filter(Boolean);
  for (const candidate of candidates) {
    const key = matchFallbackRule(candidate);
    if (key && CONTRACTS[key]) return CONTRACTS[key];
  }
  return CONTRACTS.generic;
}

/** 契约 key 是否有效（测试与调用方自检用） */
function isContractKey(key) {
  return !!CONTRACTS[key];
}

module.exports = {
  CONTRACTS,
  CONTRACT_KEYS,
  SKU_CATEGORY_CONTRACTS,
  SKU_THEME_CONTRACTS,
  LEGACY_TYPE_CONTRACTS,
  TAXONOMY_NAME_CONTRACTS,
  FALLBACK_RULES,
  resolveSkuContractKey,
  resolveLegacyTypeContractKey,
  resolveTaxonomyContractKey,
  resolveGenreContract,
  isContractKey,
};
