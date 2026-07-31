/**
 * 编辑规则 DSL (Domain Specific Language) — 小说职业编辑引擎配置
 *
 * 本文件定义了七阶段编辑引擎的所有可配置规则。
 * 引擎会根据此 DSL 自动生成每阶段的 Prompt，适配不同模型。
 *
 * 七阶段流水线：
 *   原稿 → ① AI特征分析 → ② 删除AI痕迹 → ③ 节奏重构 → ④ 人物重塑
 *        → ⑤ 风格润色 → ⑥ 字数压缩 → ⑦ 全文一致性检查 → 最终稿
 */

module.exports = {

  version: '1.0',

  // ====== 目标设定 ======
  target: {
    preservePlot: true,          // 保留剧情
    preserveForeshadowing: true, // 保留伏笔
    preserveWorld: true,         // 保留世界观
    preserveCharacters: true,    // 保留人物关系
    preserveConflict: true,      // 保留冲突
  },

  // ====== 风格设定 ======
  style: {
    genre: 'general',      // 体裁：general/cyberpunk/xianxia/urban 等
    pacing: 'fast',         // 节奏：fast/medium/slow
    narration: 'third_person', // 叙事视角
    dialogueRatio: 0.28,    // 对话占比目标
  },

  // ====== 压缩设定（第6阶段） ======
  compression: {
    ratio: 0.7,            // 目标压缩至原文 70%
    remove: [
      'repeated_environment',      // 重复环境描写
      'repeated_inner_monologue',  // 重复心理
      'repeated_actions',          // 重复动作
      'exposition',                // 作者解释
      'redundant_transitions',     // 冗余过渡
      'summary_endings',           // 总结式结尾
    ],
    keep: [
      'climax',           // 高潮
      'foreshadowing',    // 伏笔
      'conflict',         // 冲突
      'character_dev',    // 人物发展
      'plot_twists',      // 剧情转折
      'battle_climax',    // 战斗高潮
      'ending',           // 结尾
    ],
  },

  // ====== 人味化设定 ======
  humanization: {
    sentenceMix: true,             // 长短句交替
    reduceTransitionWords: true,    // 减少 AI 连接词
    showNotTell: true,              // 展示而非讲述
    addCharacterVoice: true,        // 添加角色个人语言
    addMicroActions: true,          // 添加微动作
    addIdleDetails: true,           // 添加无功能细节
    randomizeParagraphLength: true, // 随机化段落长度
    addImperfections: true,         // 添加不完美性
    addStuttering: true,            // 添加口误/思考中断
    addSarcasm: true,               // 添加吐槽
  },

  // ====== 禁用词/句式 ======
  forbidden: [
    // AI 连接词
    '值得注意的是', '不可否认', '综上所述', '与此同时', '总而言之', '众所周知',
    '进一步来说', '从这个角度来看', '基于以上分析', '显而易见',
    // AI 假深度句
    '他终于明白', '她这才意识到', '这一刻终于', '命运如此安排',
    '生活就是这样', '时间会给出答案', '或许这就是',
    // AI 模板化动作
    '他心中一惊', '倒吸一口凉气', '心跳漏了一拍', '心头一震',
    '眼中闪过', '嘴角勾起', '心中一动', '瞳孔微缩',
    // AI 常用修饰词
    '仿佛', '好像', '不禁', '微微', '轻轻', '淡淡',
    '一丝', '一抹', '些许', '几分', '隐约',
    // AI 时间过渡词
    '就在这时', '紧接着', '与此同时', '下一秒', '随后',
    // AI 解释句式
    '在这个世界', '这是', '意味着', '换句话说',
  ],

  // ====== AI 特征分析维度（第1阶段） ======
  analysisDimensions: [
    { id: 'explain',       name: '解释型语言',     desc: '过多解释而非展示' },
    { id: 'sentence',      name: '平均句式',       desc: '句式过于均匀，缺乏长短变化' },
    { id: 'repeat',        name: '重复结构',       desc: '段落结构重复' },
    { id: 'flow',          name: '流水账描写',     desc: '缺乏冲突的纯堆砌描写' },
    { id: 'dialogue',      name: '人物语言模板化',  desc: '不同角色说话方式雷同' },
    { id: 'environment',   name: '环境描写重复',    desc: '环境描写套路化' },
    { id: 'transition',    name: 'AI连接词',       desc: '使用AI典型连接词' },
    { id: 'summary',       name: '总结式结尾',     desc: '段尾升华/总结/感悟' },
    { id: 'worldbuilding', name: '世界观说明过多',  desc: '大段设定说明而非自然带出' },
    { id: 'psychology',    name: '人物心理单一',    desc: '心理描写模式化' },
  ],

  // ====== 角色声音原型（第4阶段） ======
  characterVoices: {
    reckless: {
      name: '莽撞型',
      traits: '说话直来直去，句子短，很少绕弯子',
      patterns: ['少用"但是""不过"等转折', '对话结束干脆，不加修饰', '偶尔蹦出粗口或自嘲'],
      speechSpeed: 'fast',
      educationLevel: 'low',
    },
    calm: {
      name: '冷静型',
      traits: '说话慢条斯理，习惯性停顿',
      patterns: ['多用"嗯""……"停顿', '回答前会有短暂沉默', '喜欢反问或设问'],
      speechSpeed: 'slow',
      educationLevel: 'medium',
    },
    cheerful: {
      name: '活泼型',
      traits: '说话节奏快，经常打断自己，语气词多',
      patterns: ['对话中穿插"啊""吧""啦""嘛"', '经常说一半改口', '喜欢用叠词'],
      speechSpeed: 'fast',
      educationLevel: 'medium',
    },
    cold: {
      name: '冷漠型',
      traits: '话极少，一个字一个字往外蹦',
      patterns: ['每句话不超过10字', '能用一个字不用两个字', '从不用语气词'],
      speechSpeed: 'very_slow',
      educationLevel: 'high',
    },
    sarcastic: {
      name: '毒舌型',
      traits: '说话带刺，喜欢反问，夹带阴阳怪气',
      patterns: ['多用反问句', '说反话', '"呵""啧"开头的短句'],
      speechSpeed: 'medium',
      educationLevel: 'high',
    },
    scholarly: {
      name: '学者型',
      traits: '用词书面化，逻辑性强，偶尔引经据典',
      patterns: ['句子完整但不过长', '习惯使用学术性连接', '偶尔会用文言表达'],
      speechSpeed: 'slow',
      educationLevel: 'very_high',
    },
  },

  // ====== 编辑规则（第2阶段核心规则） ======
  editorialRules: [
    '禁止连续三个完整长句。必须长短句交替。',
    '禁止连续使用"就在这时""紧接着""与此同时""下一秒""随后"。改成自然停顿。',
    '不要解释世界观。只能通过人物行为体现。',
    '不要解释人物。通过对白体现。',
    '每300字必须出现：动作、对白、心理、环境四者之一。',
    '删除所有"他心中一惊""倒吸一口凉气""心跳漏了一拍"这种模板句。改成动作：握紧拳头、停顿、咬牙、瞳孔收缩、脚步停住等。',
    '人物对白必须符合身份。拾荒者不能像教授。总裁不能像高中生。',
    '禁止作者解释。例如"这是……""意味着……""在这个世界……"全部删除。',
    '每段只表达一个重点。禁止一个段落讲五件事情。',
    '所有环境描写必须服务剧情。不能为了描写而描写。',
  ],

  // ====== 节奏重构规则（第3阶段） ======
  rhythmRules: {
    shortParagraphRatio: { min: 0.30, max: 0.45 },  // 短段占比
    mediumParagraphRatio: { min: 0.30, max: 0.40 }, // 中段占比
    longParagraphRatio: { min: 0.20, max: 0.35 },  // 长段占比
    ultraShortSentenceRate: '每200字一句极短句（3-8字）',
    forbidConsecutiveSameLength: true,  // 禁止连续3段长度相近
    hardCutTransitions: true,           // 允许硬切过渡
  },

  // ====== 人味注入素材（第4-5阶段使用） ======
  humanizationMaterials: {
    // 无功能细节示例
    idleDetails: [
      '墙上有块污渍，形状像只猫',
      '远处传来不知道谁的狗叫',
      '桌上那个杯子缺了个口',
      '风把什么东西吹倒了，咣当一声',
    ],
    // 口误/思考中断示例
    interruptions: [
      '他本来想——算了，不想了',
      '他走了大概有——不对，是跑了——几百米',
      '话说回来……他刚才说什么来着？',
    ],
    // 碎片化短句
    fragments: [
      '完了。', '不对。', '谁？', '行吧。', '妈的。', '有意思。',
      '就这？', '来不及了。', '假的吧。', '然后呢。',
    ],
    // 口语过渡
    colloquialTransitions: [
      '话说回来', '对了', '哦对', '算了', '说穿了', '反正',
    ],
  },

  // ====== 一致性检查规则（第7阶段） ======
  consistencyRules: [
    '人物性格是否前后一致',
    '世界观设定是否有矛盾',
    '伏笔是否被意外删除',
    '人物关系是否被改变',
    '故事时间线是否连贯',
    '人物称呼是否一致',
    '场景描写是否有矛盾',
  ],

  // ====== 流水线阶段开关 ======
  stages: {
    analysis: true,       // ① AI特征分析
    deAI: true,           // ② 删除AI痕迹
    rhythm: true,         // ③ 节奏重构
    character: true,      // ④ 人物重塑
    style: true,          // ⑤ 风格润色
    compression: true,    // ⑥ 字数压缩
    consistency: true,    // ⑦ 全文一致性检查
  },

  // ====== 阶段间延迟（毫秒，避免API限流） ======
  interStageDelay: 5000,  // 5秒，避免 429 限流

}
