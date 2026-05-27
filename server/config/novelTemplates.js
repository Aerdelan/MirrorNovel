/**
 * 小说类型模板库 v2 — 灵活池化设计
 *
 * 设计原则：
 * 1. 每个类型有多个 variants（写作变体），生成时随机选其一，避免千篇一律
 * 2. 男频/女频各有独立的叙事池，确保 gender 区分度
 * 3. 共享 plotHooks/openingVariants 池，每次随机组合增加多样性
 * 4. 匹配逻辑：关键词重叠 + 相似度评分，仅作辅助参考
 */

// ==== 共享叙事池（男频/女频各有侧重） ====

const maleStoryPools = {
  // 爽点类型
  satisfactionTypes: [
    '扮猪吃虎打脸流 — 主角隐藏实力，在关键时刻展露碾压级力量，让轻视者震惊',
    '升级打怪刷副本 — 通过不断挑战更强的敌人，获得经验值和装备，稳步变强',
    '科技碾压异界 — 用现代知识和科技在异界/古代降维打击，建立工业帝国',
    '后宫/红颜收集 — 在冒险过程中结识各具特色的女性角色，建立深厚羁绊',
    '争霸天下 — 从微末崛起，招兵买马，攻城略地，最终称王称霸',
    '无敌流 — 开局即满级，看主角如何用碾压级实力在低等世界玩耍',
  ],
  // 节奏建议
  pacingHints: [
    '建议节奏：快节奏开篇，前三章内展现核心金手指，之后保持2-3章一个小高潮的节奏',
    '建议节奏：慢热型，前10章铺陈世界观和人物关系，之后节奏逐渐加快',
    '建议节奏：张弛有度，每章结尾留有悬念钩子，大高潮后安排2章日常过渡',
    '建议节奏：高速升级流，平均每5章一次小突破，每15章一次大突破',
  ],
  // 男频叙事基调
  toneHints: [
    '文风建议：语言简洁有力，动作描写干脆利落，对话推进剧情为主',
    '文风建议：适当的幽默感，主角吐槽和内心戏增加阅读趣味性',
    '文风建议：热血激昂，战斗场面描写要酣畅淋漓，有画面感',
    '文风建议：悬疑感贯穿，层层揭秘，让读者始终保持好奇心',
  ],
}

const femaleStoryPools = {
  satisfactionTypes: [
    '虐渣打脸 — 女主遭受背叛后重生/逆袭，一步步揭露真相、报复仇人、重获幸福',
    '甜宠日常 — 男女主从相识到相守的甜蜜过程，细腻刻画每一个心动瞬间',
    '身份反转 — 女主隐藏真实身份（神医、特工、千金等），在高潮处揭晓震惊全场',
    '双向奔赴 — 男女主都深爱对方，在误会和困难中始终不离不弃',
    '大女主成长 — 女主从柔弱到强大，既能独当一面又能收获美满爱情',
    '救赎治愈 — 女主用温暖和真诚治愈男主的创伤，互相救赎互相成就',
  ],
  pacingHints: [
    '建议节奏：前10章重点刻画初遇和心动过程，中间虐心桥段后接甜宠回温',
    '建议节奏：感情线稳步推进，每5章一次情感升温节点，保持甜蜜和期待的平衡',
    '建议节奏：开篇即冲突（穿书/重生/被甩），快速带入，之后层层反转',
    '建议节奏：日常温馨为主，穿插小冲突和小甜蜜，整体节奏舒缓如流水',
  ],
  toneHints: [
    '文风建议：注重心理描写，细腻刻画女主内心的情感变化和成长历程',
    '文风建议：对话要自然流畅，体现人物性格和关系（亲昵/疏离/暧昧）',
    '文风建议：场景描写要有氛围感，营造浪漫或温馨的氛围',
    '文风建议：适当的虐心桥段后必有甜宠回馈，保持"先苦后甜"的情感节奏',
  ],
}

// 通用开场方式池（男女通用）
const openingVariants = [
  '开场方式A：主角遭遇重大变故（死亡/背叛/穿越）后在新世界醒来，快速交代背景和核心矛盾',
  '开场方式B：从一段日常切入，在平淡中埋下伏笔，渐入佳境',
  '开场方式C：以一场冲突/危机开场，立刻展示主角能力和世界观核心规则',
  '开场方式D：倒叙开场，先展示高潮片段再回到故事起点',
  '开场方式E：从小人物平凡的一天开始，逐步揭示不平凡的世界',
]

// 通用反转/悬念池
const twistPool = [
  '可加入的反转：主角的真实身份在关键时刻被揭露（隐藏血脉/前世/身份）',
  '可加入的反转：看似友善的角色实则另有所图',
  '可加入的反转：主角以为的大Boss背后还有更强大的操纵者',
  '可加入的反转：看似无敌的敌人存在致命的弱点等待被发现',
  '可加入的反转：主角的力量来源于一个未被揭示的秘密',
]

// ==== 类型模板（带 variants 和 gender 标记） ====

const typeTemplates = [
  // ======================== 男频 ========================
  {
    gender: 'male',
    name: '都市',
    keywords: ['都市', '城市', '现代', '职场', '商业', '公司', '总裁', '创业', '校园', '大学',
      '异能', '超能力', '隐藏', '觉醒', '医术', '神医', '豪门', '家族', '逆袭', '赘婿', '战神', '兵王'],
    variants: [
      { focus: '都市异能成长', tagline: '隐藏能力者在都市中的逆袭之路', worldElements: '现代都市 + 异能者世界双线并行' },
      { focus: '豪门恩怨与逆袭', tagline: '从底层到巅峰，让所有看不起你的人仰望', worldElements: '商界/豪门/政界势力交错' },
      { focus: '都市兵王回归', tagline: '退役兵王回归都市，低调生活却被卷入纷争', worldElements: '地下势力 + 红颜知己 + 兄弟情义' },
      { focus: '校园异能天才', tagline: '看似普通的学生，实则拥有改变世界的能力', worldElements: '校园日常 + 异能学院 + 隐藏组织' },
    ],
  },
  {
    gender: 'male',
    name: '玄幻',
    keywords: ['玄幻', '异世界', '修炼', '突破', '境界', '斗气', '魔法', '大陆', '宗门', '秘境',
      '废柴', '逆袭', '传承', '神器', '血脉', '觉醒', '穿越', '重生', '系统'],
    variants: [
      { focus: '废柴逆袭热血流', tagline: '被世人轻视的废柴，实则拥有最强天赋', worldElements: '宗门林立 + 秘境探险 + 血脉觉醒' },
      { focus: '重生复仇爽文', tagline: '前世受尽屈辱，重生归来要让所有人付出代价', worldElements: '宗门 + 家族 + 远古战场' },
      { focus: '穿越异界建势力', tagline: '穿越到玄幻世界，用现代思维打造最强势力', worldElements: '异界大陆 + 招兵买马 + 科技融入' },
      { focus: '系统辅助无敌流', tagline: '绑定了最强系统的我，在这个世界没有对手', worldElements: '系统面板 + 数据化升级 + 隐藏任务' },
    ],
  },
  {
    gender: 'male',
    name: '仙侠',
    keywords: ['仙侠', '修仙', '修真', '飞升', '渡劫', '天劫', '仙帝', '仙尊', '洪荒', '封神',
      '上古', '剑修', '法修', '体修', '神通', '飞剑'],
    variants: [
      { focus: '剑修证道', tagline: '一剑破万法，以剑道证长生', worldElements: '剑宗 + 剑意领悟 + 剑道对决' },
      { focus: '仙途漫漫', tagline: '修仙之路漫漫，看主角如何从微末崛起飞升成仙', worldElements: '天地人三界 + 渡劫飞升 + 仙界争锋' },
      { focus: '洪荒秘史', tagline: '在洪荒世界中争夺机缘，成就无上大道', worldElements: '洪荒世界 + 先天至宝 + 圣人博弈' },
      { focus: '重生仙帝归来', tagline: '仙帝重生回少年时代，这一世不再留遗憾', worldElements: '宗门 + 家族 + 秘境试炼' },
    ],
  },
  {
    gender: 'male',
    name: '科幻',
    keywords: ['科幻', '未来', '科技', '星际', '宇宙', '飞船', '机甲', 'AI', '人工智能',
      '末世', '废土', '生存', '末日', '赛博', '黑客', '基因', '改造'],
    variants: [
      { focus: '星际机甲争霸', tagline: '在浩瀚星空中驾驶机甲，为人类文明的存续而战', worldElements: '星际帝国 + 机甲战斗 + 外星文明' },
      { focus: '末世废土求生', tagline: '文明崩溃后的残酷世界，唯有强者才能活下去', worldElements: '废土荒野 + 幸存者基地 + 变异生物' },
      { focus: '赛博黑客觉醒', tagline: '在未来都市中，用代码和义体挑战腐化的系统', worldElements: '赛博都市 + 虚拟网络 + 义体改造' },
      { focus: '末日囤货进化', tagline: '末日来临前囤积物资，在废土中建立起自己的王国', worldElements: '末日降临 + 基地建设 + 异能进化' },
    ],
  },
  {
    gender: 'male',
    name: '历史',
    keywords: ['历史', '古代', '穿越', '帝王', '三国', '大明', '大唐', '争霸', '权谋', '朝堂',
      '科举', '改革', '战争', '架空'],
    variants: [
      { focus: '争霸天下', tagline: '穿越到乱世，用现代知识和战略统一天下', worldElements: '古代战争 + 朝堂权谋 + 科技攀爬' },
      { focus: '权谋朝堂', tagline: '从一介书生到权倾朝野，步步为营的谋略之路', worldElements: '科举入仕 + 朝堂争斗 + 改革变强' },
      { focus: '军事争战', tagline: '穿越成将领，用现代军事思维改变战争格局', worldElements: '冷兵器战争 + 军事改革 + 开疆拓土' },
      { focus: '种田攀科技', tagline: '从零开始建设领地，用科技树碾压古代世界', worldElements: '领地建设 + 科技发展 + 商业贸易' },
    ],
  },
  {
    gender: 'male',
    name: '悬疑灵异',
    keywords: ['悬疑', '推理', '侦探', '案件', '谋杀', '犯罪', '灵异', '鬼怪', '阴阳', '风水',
      '道士', '盗墓', '探险', '古墓'],
    variants: [
      { focus: '悬疑推理破案', tagline: '一个个离奇案件背后，隐藏着惊天阴谋', worldElements: '连环案件 + 侦探搭档 + 心理博弈' },
      { focus: '灵异道士捉鬼', tagline: '身怀道术的主角行走在阴阳两界之间', worldElements: '灵异事件 + 道术符箓 + 阴阳两界' },
      { focus: '盗墓探险', tagline: '深入古墓秘境，探寻被历史掩埋的秘密', worldElements: '古墓探险 + 机关解密 + 诅咒宝物' },
      { focus: '都市灵异办案', tagline: '在现代化都市中处理超自然案件', worldElements: '灵异事件调查组 + 超自然现象 + 科学解释' },
    ],
  },
  {
    gender: 'male',
    name: '游戏',
    keywords: ['游戏', '电竞', '网游', '全息', '虚拟', '竞技', '比赛', '职业选手', '公会', '副本', '装备'],
    variants: [
      { focus: '电竞职业选手', tagline: '从路人王到世界冠军的电竞逐梦之旅', worldElements: '电竞比赛 + 战队成长 + 热血对决' },
      { focus: '游戏穿越异界', tagline: '穿越到游戏世界，把现实套路用在游戏中', worldElements: '游戏世界 + 职业系统 + 公会争霸' },
      { focus: '全息网游', tagline: '在全息网游中建立传说，现实与虚拟的完美融合', worldElements: '全息游戏 + 副本攻略 + 装备打造' },
    ],
  },
  {
    gender: 'male',
    name: '二次元',
    keywords: ['二次元', '动漫', '同人', '综漫', '日系', '校园', '日常', 'cos', '番剧', '漫展'],
    variants: [
      { focus: '综漫穿越', tagline: '穿越到各个动漫世界，和喜欢的角色一起冒险', worldElements: '动漫世界 + 原著剧情 + 改变命运' },
      { focus: '二次元日常', tagline: '在充满二次元色彩的世界中享受青春日常', worldElements: '校园 + 社团 + 漫展活动' },
    ],
  },

  // ======================== 女频 ========================
  {
    gender: 'female',
    name: '现代言情',
    keywords: ['言情', '恋爱', '爱情', '甜蜜', '甜宠', '虐恋', '总裁', '豪门',
      '穿书', '重生', '穿越', '炮灰', '萌宝', '带球跑', '追妻', '先婚后爱', '职场'],
    variants: [
      { focus: '豪门甜宠', tagline: '他外表高冷，却只对她温柔以待', worldElements: '豪门世家 + 契约婚姻 + 先婚后爱' },
      { focus: '穿书逆袭', tagline: '穿成书中的炮灰女配，这次我要改写自己的命运', worldElements: '原著剧情 + 熟知先知 + 逆天改命' },
      { focus: '重生虐渣', tagline: '前世错付真心，今生归来绝不重蹈覆辙', worldElements: '重生复仇 + 商战逆袭 + 遇见真爱' },
      { focus: '职场甜恋', tagline: '在职场上并肩作战，在爱情里双向奔赴', worldElements: '职场竞争 + 办公室恋情 + 共同成长' },
      { focus: '萌宝助攻', tagline: '天才萌宝的神助攻，让傲娇爸妈终成眷属', worldElements: '单亲带娃 + 意外相遇 + 家庭温馨' },
    ],
  },
  {
    gender: 'female',
    name: '古代言情',
    keywords: ['古代', '古言', '宫斗', '宅斗', '嫡庶', '王妃', '皇后', '穿越', '重生',
      '嫡女', '庶女', '医妃', '毒妃', '权谋', '种田', '农家'],
    variants: [
      { focus: '宫斗权谋', tagline: '在后宫和朝堂的刀光剑影中，她一步步走上权力巅峰', worldElements: '宫廷斗争 + 朝堂博弈 + 帝王深情' },
      { focus: '穿越种田', tagline: '穿越到古代农家，靠自己的双手创造幸福生活', worldElements: '田园生活 + 经商致富 + 温馨日常' },
      { focus: '重生嫡女复仇', tagline: '前世被庶妹陷害，重生后步步为营夺回一切', worldElements: '宅斗嫡庶 + 复仇之路 + 遇见良人' },
      { focus: '医妃天下', tagline: '身怀绝世医术的她，在大周朝闯出一片天', worldElements: '古代医术 + 宫闱秘事 + 权贵博弈' },
    ],
  },
  {
    gender: 'female',
    name: '玄幻言情',
    keywords: ['玄幻言情', '修仙', '甜宠', '女强', '魔法', '精灵', '兽世', '兽人'],
    variants: [
      { focus: '修仙师徒恋', tagline: '在修仙路上，他与她并肩而行，共渡劫难', worldElements: '修仙宗门 + 师徒情深 + 渡劫飞升' },
      { focus: '西方奇幻冒险', tagline: '魔法世界中的冒险与爱情，她是最特别的存在', worldElements: '魔法学院 + 精灵王国 + 龙族传说' },
      { focus: '兽世之恋', tagline: '在原始兽世中，她与他跨越种族的羁绊', worldElements: '原始世界 + 兽人部落 + 生存与爱情' },
    ],
  },
  {
    gender: 'female',
    name: '悬疑言情',
    keywords: ['悬疑言情', '推理', '侦探', '破案', '甜宠', '灵异', '鬼怪', '阴阳'],
    variants: [
      { focus: '悬疑搭档破案', tagline: '在破案过程中，他与她由针锋相对到心心相印', worldElements: '刑侦探案 + 欢喜冤家 + 并肩作战' },
      { focus: '灵异阴阳恋', tagline: '她能看到常人看不到的东西，直到遇见他', worldElements: '灵异事件 + 阴阳世家 + 跨越生死' },
    ],
  },
  {
    gender: 'female',
    name: '青春校园',
    keywords: ['校园', '青春', '学霸', '校草', '初恋', '暗恋', '同桌', '学长', '告白', '毕业'],
    variants: [
      { focus: '学霸同桌', tagline: '从相互较劲到不知不觉喜欢上你', worldElements: '校园日常 + 学霸之争 + 青春悸动' },
      { focus: '初恋暗恋', tagline: '藏在心里三年的暗恋，在毕业之前能否说出口', worldElements: '青涩校园 + 暗恋心事 + 成长离别' },
      { focus: '校园甜宠', tagline: '他看似高冷，却只对她一个人好', worldElements: '校园风云 + 校草独宠 + 甜蜜日常' },
    ],
  },
  {
    gender: 'female',
    name: '纯爱（双男主）',
    keywords: ['纯爱', '双男主', 'BL', '耽美', '同性', '兄弟'],
    variants: [
      { focus: '校园纯恋', tagline: '少年时期的相遇相知，是最纯粹的感情', worldElements: '校园 + 青春 + 双向守护' },
      { focus: '职场精英', tagline: '在职场棋逢对手，在生活中惺惺相惜', worldElements: '职场竞争 + 强强联手 + 互相成就' },
    ],
  },
  {
    gender: 'female',
    name: '百合（双女主）',
    keywords: ['百合', '双女主', 'GL', '姬情', '姐妹'],
    variants: [
      { focus: '温柔守护', tagline: '她用温柔抚平她的伤痕，用坚定守护她的梦想', worldElements: '都市 + 治愈 + 双向奔赴' },
      { focus: '古风仙侣', tagline: '在修仙路上结为道侣，相伴千年', worldElements: '修仙 + 古风 + 情感羁绊' },
    ],
  },

  // ======================== 轻小说 ========================
  {
    gender: 'unisex',
    name: '异世界转生',
    keywords: ['异世界', '转生', '穿越', '召唤', '魔法', '勇者', '魔王', '冒险者', '迷宫', '技能'],
    variants: [
      { focus: '常规勇者冒险', tagline: '被召唤到异世界成为勇者，踏上讨伐魔王的旅途', worldElements: '剑与魔法 + 冒险者公会 + 同伴收集' },
      { focus: '转生反派/魔王', tagline: '转生成了魔王，却发现这个世界没有我想象中简单', worldElements: '魔王城 + 四天王 + 勇者来袭' },
      { focus: '异世界悠闲生活', tagline: '在异世界开一家小店，享受慢节奏的冒险生活', worldElements: '异世界小镇 + 经营 + 日常治愈' },
      { focus: '外挂无敌流', tagline: '带着最强外挂穿越到异世界，从此走上人生巅峰', worldElements: '作弊级能力 + 异世界冒险 + 轻松搞笑' },
    ],
  },
  {
    gender: 'unisex',
    name: '校园恋爱',
    keywords: ['校园', '学园', '恋爱', '告白', '青梅竹马', '转校生', '学生会', '社团', '学园祭'],
    variants: [
      { focus: '多角恋喜剧', tagline: '普通的校园生活因为一群不普通的女生变得热闹非凡', worldElements: '学园日常 + 多角关系 + 恋爱喜剧' },
      { focus: '青梅竹马纯爱', tagline: '从小一起长大的我们，距离恋人只差一句告白', worldElements: '青梅竹马 + 日常互动 + 甜蜜升温' },
      { focus: '转校生奇遇', tagline: '转学到新学校的第一天，就卷入了一场意想不到的恋爱风波', worldElements: '转校生 + 社团活动 + 青春群像' },
    ],
  },
  {
    gender: 'unisex',
    name: '日常系',
    keywords: ['日常', '治愈', '温馨', '慢生活', '小镇', '咖啡', '美食', '书店', '猫'],
    variants: [
      { focus: '小镇治愈物语', tagline: '搬来小镇经营一家小店，遇见各种温暖的人和事', worldElements: '小镇生活 + 经营 + 人情温暖' },
      { focus: '美食与爱', tagline: '用美食连接人与人之间的羁绊', worldElements: '美食 + 咖啡厅 + 日常互动' },
      { focus: '猫与青春', tagline: '在学校和猫咖之间，度过最温柔的青春时光', worldElements: '校园 + 宠物 + 好友日常' },
    ],
  },
]

// 导出：模板 + 共享池 + 工具函数
module.exports = {
  typeTemplates,
  maleStoryPools,
  femaleStoryPools,
  openingVariants,
  twistPool,

  /** 根据 gender 获取对应的叙事池 */
  getPools(gender) {
    return gender === 'female' ? femaleStoryPools : maleStoryPools
  },

  /** 随机选择数组中的一个元素 */
  pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)]
  },

  /** 随机选择 n 个不重复元素 */
  pickRandomN(arr, n) {
    const shuffled = [...arr].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, Math.min(n, arr.length))
  },

  /** 构建动态类型提示（每次调用结果不同） */
  buildTemplatePrompt(matchedTemplates, gender) {
    const pools = this.getPools(gender || 'male')
    const parts = []

    // 1. 加入开场方式（随机）
    parts.push(`【开场方式参考】\n${this.pickRandom(openingVariants)}`)

    // 2. 加入类型特定 variant（随机选匹配的）
    for (const mt of matchedTemplates) {
      const tmpl = typeTemplates.find(t => t.name === mt.name && t.gender === (gender || 'male'))
      if (tmpl && tmpl.variants && tmpl.variants.length > 0) {
        const v = this.pickRandom(tmpl.variants)
        parts.push(`【${tmpl.name} 写法变体】\n焦点：${v.focus}\n主题：${v.tagline}\n世界元素：${v.worldElements}`)
      }
    }

    // 3. 加入爽点/看点类型（随机选2个）
    const sats = this.pickRandomN(pools.satisfactionTypes, 2)
    parts.push(`【建议看点】\n${sats.map((s, i) => `${i + 1}. ${s}`).join('\n')}`)

    // 4. 加入节奏建议（随机选1个）
    parts.push(`【节奏建议】\n${this.pickRandom(pools.pacingHints)}`)

    // 5. 加入文风建议（随机选1个）
    parts.push(`【文风建议】\n${this.pickRandom(pools.toneHints)}`)

    // 6. 加入反转/悬念（随机选1个，50%概率）
    if (Math.random() > 0.5) {
      parts.push(`【可选反转】\n${this.pickRandom(twistPool)}`)
    }

    return parts.join('\n\n')
  },
}
