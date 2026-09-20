/**
 * 番茄式「多选类型 SKU」体系（server 唯一真源）
 *
 * 一本小说的类型 = 频道 + 大类 + 题材（单选逐级）
 *                + 情节元素(多选) + 人设(多选) + 风格基调tones(多选) + 关系向cp(单选)
 *
 * resolveTypeSku(sku) 解析出 { name, keywords, aiWordBank, outlineSeed, axes }，
 * 供 aiService 的风格档案系统与大纲/正文生成使用。
 *
 * 六轴顺序恒为 [temperature, diction, narrator, pacing, humor, emotion]（1-5）。
 * 题材给基底 axes，tones 逐轴覆盖；人格 axes 在路由里再叠加（人格 > tones > 题材默认）。
 */

const AXIS_KEYS = ['temperature', 'diction', 'narrator', 'pacing', 'humor', 'emotion'];

function axesFromSeed(seed) {
  if (!seed) return null;
  if (Array.isArray(seed)) {
    const o = {};
    seed.forEach((v, i) => { if (Number.isFinite(v) && AXIS_KEYS[i]) o[AXIS_KEYS[i]] = v; });
    return Object.keys(o).length ? o : null;
  }
  return typeof seed === 'object' ? seed : null;
}

// ===== 风格基调库（多选，直接驱动 axes；优先级高于题材默认） =====
// axes 用稀疏数组：[temperature, diction, narrator, pacing, humor, emotion]，null 位表示不改该轴。
const TONES = {
  shuang:   { name: '爽文/打脸',   keywords: '装逼打脸, 逆袭, 扬眉吐气, 痛快, 碾压', axes: [3, 2, 2, 1, 3, 4] },
  gaoxiao:  { name: '搞笑/无厘头', keywords: '吐槽, 反差, 沙雕, 名场面, 包袱', axes: [4, 2, 5, 2, 5, 4] },
  tianchong:{ name: '甜宠',        keywords: '宠溺, 撒糖, 双向奔赴, 心软, 偏爱', axes: [5, 3, 2, 3, 3, 5] },
  nven:     { name: '虐文/虐恋',   keywords: '误会, 错过, 意难平, 心口不一, 代价', axes: [2, 3, 2, 4, 1, 5] },
  zhiyu:    { name: '治愈/温情',   keywords: '和解, 陪伴, 微光, 烟火气, 慢下来', axes: [5, 3, 2, 4, 3, 4] },
  resurgence:{ name: '热血',       keywords: '燃, 不屈, 并肩, 突破极限, 守护', axes: [4, 2, 2, 1, 2, 5] },
  anhei:    { name: '暗黑/致郁',   keywords: '灰色, 代价, 人性暗面, 冰冷, 无处可逃', axes: [1, 3, 1, 3, 1, 3] },
  zhengju:  { name: '正剧/严谨',   keywords: '考究, 逻辑自洽, 分寸, 群像, 现实感', axes: [2, 4, 1, 4, 1, 2] },
  shaonao:  { name: '烧脑/智斗',   keywords: '博弈, 反转, 布局, 信息差, 抽丝剥茧', axes: [2, 3, 1, 3, 2, 2] },
  richang:  { name: '轻松日常',   keywords: '生活流, 细碎, 小确幸, 松弛, 趣事', axes: [4, 2, 3, 4, 4, 3] },
  epic:     { name: '史诗/庄重',   keywords: '史诗感, 苍凉, 命运, 宏大, 咏叹', axes: [2, 5, 2, 4, 1, 3] },
  dushe:    { name: '毒舌/黑色幽默', keywords: '反讽, 阴阳怪气, 冷幽默, 一针见血, 黑色', axes: [2, 3, 5, 2, 4, 4] },
};

// ===== 情节元素库（多选，并集进 keywords / aiWordBank） =====
// 每项：[name, keywords, aiWordBank(可省)]
const ELEMENTS = {
  chongsheng: ['重生', '重生, 重来, 先知, 改写命运, 前世记忆', '重活一世, 未雨绸缪'],
  chuanyue:   ['穿越', '穿越, 魂穿, 身穿, 古今错位, 现代知识', '穿越时空, 借尸还魂'],
  kuaichuan:  ['快穿', '快穿, 世界, 任务, 系统, 宿主, 攻略'],
  chuanshu:   ['穿书', '穿书, 剧情, 炮灰, 主角, 原书, 崩坏'],
  xitong:     ['系统', '系统, 面板, 任务, 奖励, 宿主, 兑换', '叮, 系统提示'],
  qiandao:    ['签到', '签到, 打卡, 奖励, 新手大礼包'],
  mianban:    ['面板', '属性面板, 数值, 等级, 技能栏'],
  kongjian:   ['空间', '空间, 随身空间, 灵田, 储物资'],
  tunhuo:     ['囤货', '囤货, 物资, 零元购, 抢先机, 末世准备'],
  moshi:      ['末世', '末世, 丧尸, 幸存, 秩序崩塌, 变异', '末日求生, 人性考验'],
  xingji:     ['星际', '星际, 星舰, 联邦, 光脑, 虫族, 跃迁'],
  ji:     ['机甲', '机甲, 驾驶舱, 神经连接, 光脑, 星战'],
  lingyi:     ['灵异', '灵异, 鬼怪, 阴阳眼, 镇魂, 阴差'],
  daomu:      ['盗墓', '盗墓, 古墓, 粽子, 明器, 机关, 风水'],
  tuili:      ['推理', '推理, 线索, 密室, 不在场证明, 演绎'],
  dianjing:   ['电竞', '电竞, 战队, 上分, 职业赛, 冠军, 操作'],
  honghuang:  ['洪荒', '洪荒, 圣人, 女娲, 巫妖, 不周山, 先天灵宝'],
  fengshen:   ['封神', '封神, 天庭, 阐截, 法宝, 封神榜'],
  xiyou:      ['西游', '西游, 取经, 神仙, 妖怪, 大圣, 天条'],
  zhutian:    ['诸天无限', '诸天, 副本, 世界穿梭, 主神空间, 轮回'],
  zongman:    ['综漫', '综漫, 动漫世界, 能力, 副本, 剧情人物'],
  zhongtian:  ['种田', '种田, 经营, 庄稼, 家常, 发家致富, 慢生活'],
  meishi:     ['美食', '美食, 厨艺, 食材, 开店, 饕餮, 治愈系味道'],
  zhibo:      ['直播', '直播, 弹幕, 打赏, 榜一大哥, 连麦, 流量'],
  yulequan:   ['娱乐圈', '娱乐圈, 星, 通告, 综艺, 经纪人, 顶流, 黑料'],
  shengji:    ['升级', '升级, 突破, 境界, 经验, 变强'],
  wudi:       ['无敌', '无敌, 碾压, 不出手则已, 天下无双'],
  fuchou:     ['复仇', '复仇, 血债, 隐忍, 反杀, 清算'],
  majia:      ['马甲', '马甲, 隐藏身份, 大佬, 掉马, 双重身份'],
  mengbao:    ['萌宝', '萌宝, 带娃, 龙凤胎, 认亲, 团宠'],
  zhuixu:     ['赘婿', '赘婿, 上门女婿, 逆袭, 打脸岳家'],
  zhanshen:   ['战神', '战神, 兵王, 归来, 护妻, 沙场'],
  shenyi:     ['神医', '神医, 针灸, 悬壶, 起死回生, 医毒双绝'],
  jianbao:    ['鉴宝', '鉴宝, 古玩, 捡漏, 掌眼, 真赝'],
  gongdou:    ['宫斗', '宫斗, 后宫, 位分, 皇嗣, 争宠, 步步惊心'],
  quanmou:   ['权谋', '权谋, 布局, 朝堂, 谋士, 博弈, 心机'],
  zhengba:    ['争霸', '争霸, 逐鹿, 王图霸业, 铁骑, 天下'],
  junli:      ['军旅', '军旅, 特种兵, 演习, 战友情, 利刃'],
  diedian:    ['谍战', '谍战, 潜伏, 情报, 双面, 信仰, 暗战'],
  feichai:    ['废柴逆袭', '废柴, 退婚, 莫欺少年穷, 觉醒, 逆袭'],
  banzhuhuchi:['扮猪吃虎', '扮猪吃虎, 藏拙, 深藏不露, 一鸣惊人'],
  longgaotian:['龙傲天', '龙傲天, 天命, 气运, 一路横推'],
  nvqiang:    ['女强', '女强, 不输须眉, 掌权, 自立'],
  nishinong:  ['锦鲤/团宠', '锦鲤, 好运, 团宠, 福气, 被偏爱'],
  shekong:    ['社恐/咸鱼', '社恐, 摆烂, 咸鱼, 只想躺平, 被迫营业'],
  liuhan:     ['流汗文学/沙雕', '沙雕, 抽象, 离谱, 名场面, 整活'],
  xuanyi:     ['玄学', '玄学, 风水, 相术, 命格, 气运, 道观'],
  zhuibushi:  ['追妻火葬场', '追妻, 火葬场, 悔过, 破镜重圆'],
  xiaoguo:    ['校园', '校园, 同桌, 社团, 联考, 青春期, 白衬衫'],
  zhichang:   ['职场', '职场, KPI, 办公室, 项目, 内卷, 同事'],
  niandai:    ['年代', '年代, 七零八零, 大院, 粮票, 恢复高考'],
  xiandou:    ['仙斗/宗门', '宗门, 斗法, 天骄, 秘境, 大比'],
  youling:    ['幽界/灵异探险', '冥婚, 阴宅, 符箓, 镇压, 驱邪'],
  keji:       ['黑科技', '黑科技, 专利, 实验室, 卡脖子, 国产替代'],
  xuzhi:      ['虚拟游戏', '全息, 网游, 副本, 公会, 排行榜, NPC'],
  manju:      ['漫改/同人', '同人, OOC, 原作剧情, 意难平, 补完'],
  riben:      ['日系日常', '日系, 便利店, 部活, 祭典, 樱花, 通勤'],
  mofa:       ['魔法', '魔法, 魔杖, 咒语, 魔法学院, 元素'],
  shouchong:  ['守成/基建', '基建, 攀科技, 招贤纳士, 屯田, 根据地'],
  chuai:      ['穿成反派/炮灰', '反派, 炮灰, 抱大腿, 剧情崩坏, 自救'],
  xuanxue:    ['国术/武道', '国术, 内劲, 明暗劲, 宗师, 练皮练骨'],
  congshen:   ['成神/证道', '证道, 渡劫, 飞升, 大罗, 果位'],
  yishou:     ['异兽/御兽', '契约兽, 灵兽, 进化石, 御兽师'],
  haijun:     ['航海/海洋', '海图, 灯塔, 深海, 海怪, 远洋'],
  guojia:     ['家国/建设', '报国, 工业, 强军, 民族复兴, 大国'],
};

// ===== 人设库（多选，并集进 keywords） =====
// 每项：[name, keywords]
const CHARACTERS = {
  fuhei:    ['腹黑', '腹黑, 笑面虎, 算无遗策, 白切黑'],
  bingjiao: ['病娇', '病娇, 偏执, 占有, 黑化, 疯批美人'],
  aojiao:   ['傲娇', '傲娇, 口是心非, 嘴硬, 反差萌'],
  longlt:   ['龙傲天', '霸气, 天命主角, 唯我独尊'],
  yuleot:   ['咸鱼主角', '咸鱼, 摆烂, 被迫营业, 大智若愚'],
  tiancai:  ['天才', '天才, 妖孽, 举一反三, 年少成名'],
  xueba:    ['学霸', '学霸, 满分, 竞赛, 保送, 学神'],
  daliao:   ['隐藏大佬', '大佬, 深藏不露, 马甲, 降维打击'],
  nvzhuren: ['大女主', '大女主, 掌局, 不恋爱脑, 自立自强'],
  yujie:    ['御姐', '御姐, 成熟, 气场, 从容'],
  luoli:    ['萌系', '软萌, 治愈, 天真, 团宠'],
  shekongg: ['社恐', '社恐, 慢热, 内心戏多, 被迫社交'],
  baiyueguang:['白月光', '白月光, 意难平, 朱砂痣, 求不得'],
  fengpi:   ['疯批', '疯批, 亦正亦邪, 偏执, 高危魅力'],
  zhongquan:['忠犬', '忠犬, 守护, 一根筋, 认定不放'],
  zhujiao:  ['反派洗白', '反派, 复杂, 亦正亦邪, 洗白'],
  nuzhu:    ['独立女性', '清醒, 边界感, 搞事业, 不依附'],
  nanizhu:  ['万人迷', '万人迷, 苏, 撩, 众星捧月'],
  jiweng:   ['机灵/毒舌', '伶牙俐齿, 贫嘴, 怼人, 反应快'],
  yinxiu:   ['隐忍强者', '隐忍, 藏锋, 待时而动, 一鸣惊人'],
  lesgong:  ['乐坛/文娱天才', '金嗓子, 创作, 惊艳, 舞台'],
  jiazu:    ['家族继承人', '继承人, 家业, 内斗, 上位'],
  xidi:     ['接地气压抑者', '小人物, 坚韧, 不服输, 草根'],
  zhuishah: ['偏执追凶', '执念, 追凶, 亦正亦邪, 孤勇'],
  tansuo:   ['探险家', '胆大心细, 见多识广, 临危不乱'],
  yxtian:   ['天才少年', '少年老成, 天赋, 早熟, 逆龄压制'],
  qiangzhe: ['权臣/枭雄', '权倾, 城府, 结党, 搅弄风云'],
  cihang:   ['慈悲/佛性', '悲悯, 渡人, 放下, 慧根'],
  lvye:     ['绿野/自然系', '亲和自然, 灵兽缘, 治愈, 山野'],
  fanxiang: ['反差萌', '人前高冷人后黏人, 反差, 破防'],
};

// ===== 频道 → 大类 → 题材树 =====
// 每个题材：{ id, name, keywords, axes(稀疏,覆盖大类), note(outlineSeed, 可省) }
// 大类：{ channel, name, icon, keywords(基底), aiWordBank(基底), axes(基底), themes:[] }

const CATEGORY_TREE = {
  male: [
    {
      id: 'urban', name: '都市', icon: '🏙️',
      keywords: '都市, 现代, 职场, 商战, 人情世故, 灯红酒绿',
      aiWordBank: '龙潜都市, 深藏不露, 一鸣惊人, 各方势力, 暗流涌动, 步步为营',
      axes: [3, 2, 2, 2, 3, 3],
      themes: [
        { id: 'urban_neng', name: '都市异能', keywords: '超能力, 觉醒, 异能者, 隐藏实力', axes: [3, 2, 2, 1, 3, 4] },
        { id: 'urban_xiuzhen', name: '都市修真', keywords: '修真, 都市修仙, 灵气复苏, 大能', axes: [3, 3, 2, 2, 2, 3] },
        { id: 'urban_gaowu', name: '都市高武', keywords: '高武, 武道, 气血, 宗师, 擂台', axes: [3, 2, 2, 1, 2, 4] },
        { id: 'urban_naodong', name: '都市脑洞', keywords: '系统, 脑洞, 金手指, 反套路', axes: [4, 2, 4, 2, 4, 3] },
        { id: 'urban_zhuixu', name: '赘婿战神', keywords: '赘婿, 上门女婿, 战神, 逆袭打脸', axes: [3, 2, 2, 1, 3, 4] },
        { id: 'urban_shenyi', name: '神医圣手', keywords: '神医, 针灸, 悬壶, 起死回生', axes: [3, 3, 2, 2, 2, 3] },
        { id: 'urban_jianbao', name: '鉴宝捡漏', keywords: '鉴宝, 古玩, 掌眼, 真赝, 捡漏', axes: [3, 3, 2, 3, 2, 3] },
        { id: 'urban_shangzhan', name: '商战职场', keywords: '商战, 并购, 办公室, 内卷, 博弈', axes: [2, 3, 2, 2, 2, 3] },
        { id: 'urban_haomen', name: '豪门逆袭', keywords: '豪门, 富二代, 家产, 逆袭, 恩怨', axes: [3, 3, 2, 2, 2, 4] },
        { id: 'urban_zhongtian', name: '都市种田', keywords: '回乡, 乡村, 种植养殖, 发家', axes: [4, 2, 2, 4, 3, 3] },
        { id: 'urban_yule', name: '娱乐圈文', keywords: '娱乐圈, 顶流, 综艺, 通告, 黑料', axes: [4, 2, 3, 2, 4, 3] },
      ],
    },
    {
      id: 'xuanhuan', name: '玄幻', icon: '🔮',
      keywords: '玄幻, 异世, 功法, 斗气, 境界, 天才, 秘境, 大宗门',
      aiWordBank: '逆天改命, 斗气化马, 破境, 天骄, 秘藏, 觉醒血脉',
      axes: [3, 4, 2, 1, 2, 4],
      themes: [
        { id: 'xh_trad', name: '传统玄幻', keywords: '升级流, 废柴, 退婚, 打脸, 斗气', axes: [3, 4, 2, 1, 2, 4] },
        { id: 'xh_east', name: '东方玄幻', keywords: '异世大陆, 血脉, 宗门, 神兽', axes: [3, 4, 2, 2, 2, 4] },
        { id: 'xh_naodong', name: '玄幻脑洞', keywords: '系统, 面板, 反套路, 沙雕', axes: [4, 2, 4, 1, 5, 3] },
        { id: 'xh_feichai', name: '废柴逆袭', keywords: '废柴, 莫欺少年穷, 扮猪吃虎, 觉醒', axes: [3, 3, 2, 1, 3, 4] },
        { id: 'xh_wudi', name: '无敌流', keywords: '无敌, 横推, 碾压, 天命', axes: [3, 3, 3, 1, 3, 4] },
        { id: 'xh_race', name: '种族文', keywords: '兽人, 精灵, 龙族, 异族崛起', axes: [3, 4, 2, 2, 2, 4] },
      ],
    },
    {
      id: 'xianxia', name: '仙侠', icon: '☯️',
      keywords: '修仙, 灵气, 渡劫, 飞升, 法宝, 丹药, 宗门, 剑修',
      aiWordBank: '天道轮回, 剑气纵横, 灵力涌动, 天劫降临, 破而后立',
      axes: [3, 4, 2, 2, 2, 3],
      themes: [
        { id: 'xx_east', name: '东方仙侠', keywords: '修真, 剑仙, 道心, 洞天', axes: [3, 4, 2, 3, 2, 3] },
        { id: 'xx_feisheng', name: '修仙飞升', keywords: '渡劫, 飞升, 元婴, 化神', axes: [3, 4, 2, 2, 1, 3] },
        { id: 'xx_xianzun', name: '仙尊重生', keywords: '仙尊, 重生, 碾压前世, 道侣', axes: [3, 4, 2, 2, 2, 4] },
        { id: 'xx_honghuang', name: '洪荒封神', keywords: '洪荒, 圣人, 巫妖, 封神榜', axes: [2, 5, 2, 3, 1, 3] },
        { id: 'xx_chat', name: '修真聊天群', keywords: '都市修仙, 群聊, 反套路, 轻松', axes: [4, 2, 4, 2, 5, 3] },
      ],
    },
    {
      id: 'lishi', name: '历史', icon: '🏛️',
      keywords: '历史, 朝堂, 权谋, 征战, 典章, 考据, 兴革',
      aiWordBank: '运筹帷幄, 决胜千里, 权倾朝野, 合纵连横, 风云变幻',
      axes: [2, 4, 1, 3, 1, 3],
      themes: [
        { id: 'ls_strict', name: '历史正剧', keywords: '严谨, 考据, 正史, 群像', axes: [2, 4, 1, 4, 1, 2] },
        { id: 'ls_naodong', name: '历史脑洞', keywords: '穿越, 系统, 基建, 攀科技', axes: [3, 3, 3, 2, 4, 3] },
        { id: 'ls_sanguo', name: '断代争雄', keywords: '三国, 隋唐, 大明, 晚清', axes: [2, 4, 2, 2, 1, 4] },
        { id: 'ls_zhengba', name: '争霸权谋', keywords: '争霸, 逐鹿, 朝堂, 谋士', axes: [2, 4, 1, 2, 1, 4] },
        { id: 'ls_keju', name: '科举寒门', keywords: '科举, 寒门, 上岸, 耕读', axes: [3, 3, 2, 3, 2, 3] },
        { id: 'ls_jiagong', name: '架空历史', keywords: '架空, 开挂, 改革, 强国', axes: [2, 4, 2, 3, 2, 3] },
      ],
    },
    {
      id: 'wuxia', name: '武侠', icon: '⚔️',
      keywords: '江湖, 武林, 秘籍, 门派, 侠客, 恩义, 内功, 轻功',
      aiWordBank: '快意恩仇, 笑傲江湖, 刀光剑影, 侠之大者, 踏雪无痕',
      axes: [3, 4, 2, 2, 2, 3],
      themes: [
        { id: 'wx_trad', name: '传统武侠', keywords: '门派, 武功, 江湖, 侠义', axes: [3, 4, 2, 2, 2, 3] },
        { id: 'wx_modern', name: '古武现代', keywords: '古武, 都市武学, 内劲, 国术', axes: [3, 3, 2, 1, 2, 3] },
        { id: 'wx_revenge', name: '恩怨复仇', keywords: '血仇, 复仇, 江湖恩怨, 正邪', axes: [2, 4, 2, 2, 1, 4] },
      ],
    },
    {
      id: 'scifi', name: '科幻', icon: '🚀',
      keywords: '科幻, 星际, 机甲, 人工智能, 未来, 末世, 黑科技, 进化',
      aiWordBank: '星际穿越, 量子跃迁, 人工智能觉醒, 维度打击, 星辰大海',
      axes: [2, 3, 1, 2, 2, 3],
      themes: [
        { id: 'sf_moe', name: '末世废土', keywords: '末世, 丧尸, 废土, 求生, 囤货', axes: [2, 3, 1, 1, 2, 4] },
        { id: 'sf_star', name: '星际宇宙', keywords: '星舰, 联邦, 跃迁, 虫族', axes: [2, 4, 1, 3, 1, 3] },
        { id: 'sf_mecha', name: '机甲赛博', keywords: '机甲, 赛博朋克, 改造人, 义体', axes: [2, 3, 1, 1, 2, 3] },
        { id: 'sf_hard', name: '硬核科幻', keywords: '硬科幻, 物理, 黑科技, 科研', axes: [2, 4, 1, 3, 1, 2] },
        { id: 'sf_jinhua', name: '末日进化', keywords: '进化, 异能, 副本, 全球数据化', axes: [3, 3, 1, 1, 2, 4] },
      ],
    },
    {
      id: 'mystery', name: '悬疑灵异', icon: '🔍',
      keywords: '悬疑, 推理, 案件, 线索, 反转, 灵异, 法医, 心理',
      aiWordBank: '细思极恐, 抽丝剥茧, 扑朔迷离, 反转, 真相',
      axes: [1, 3, 1, 2, 1, 2],
      themes: [
        { id: 'my_detect', name: '推理烧脑', keywords: '推理, 神探, 密室, 演绎', axes: [1, 3, 1, 2, 2, 2] },
        { id: 'my_lingyi', name: '灵异阴阳', keywords: '灵异, 鬼怪, 阴阳眼, 镇魂', axes: [1, 3, 2, 3, 2, 3] },
        { id: 'my_daomu', name: '盗墓探险', keywords: '盗墓, 古墓, 机关, 粽子, 探险', axes: [2, 3, 1, 2, 2, 3] },
        { id: 'my_fengshui', name: '风水秘术', keywords: '风水, 相术, 民俗, 玄学', axes: [2, 3, 2, 3, 1, 3] },
        { id: 'my_horror', name: '惊悚恐怖', keywords: '惊悚, 悬疑, 压迫, 逃生', axes: [1, 3, 1, 1, 1, 4] },
      ],
    },
    {
      id: 'game', name: '游戏', icon: '🎮',
      keywords: '游戏, 电竞, 全息, 副本, 公会, 职业, 排行榜',
      aiWordBank: '操作拉满, 极限反杀, 首杀, 上分, 冠军',
      axes: [3, 2, 2, 1, 3, 3],
      themes: [
        { id: 'gm_otherworld', name: '游戏异界', keywords: '穿越游戏, 副本, NPC, 世界观', axes: [3, 3, 2, 2, 2, 3] },
        { id: 'gm_esports', name: '电竞', keywords: '电竞, 战队, 职业赛, 冠军, 操作', axes: [3, 2, 2, 1, 3, 4] },
        { id: 'gm_vr', name: '虚拟网游', keywords: '全息, 网游, 公会, 排行榜', axes: [3, 2, 2, 1, 3, 3] },
      ],
    },
    {
      id: 'sports', name: '体育', icon: '🏀',
      keywords: '体育, 竞技, 训练, 比赛, 汗水, 突破, 冠军, 团队',
      aiWordBank: '绝杀, 逆转, 打破纪录, 全力以赴, 登顶',
      axes: [4, 2, 1, 1, 2, 4],
      themes: [
        { id: 'sp_qiu', name: '球类竞技', keywords: '篮球, 足球, 网球, 联赛', axes: [4, 2, 1, 1, 2, 4] },
        { id: 'sp_ge', name: '格斗健身', keywords: '格斗, 拳击, 健身, 擂台', axes: [3, 2, 1, 1, 2, 4] },
        { id: 'sp_school', name: '运动校园', keywords: '校园, 体育生, 校队, 联赛', axes: [4, 2, 2, 2, 3, 4] },
      ],
    },
    {
      id: 'military', name: '军事', icon: '🎖️',
      keywords: '军旅, 特种, 演习, 战争, 铁血, 战友情, 使命, 装备',
      aiWordBank: '利刃出鞘, 百炼成钢, 使命必达, 向死而生',
      axes: [2, 3, 1, 1, 1, 4],
      themes: [
        { id: 'mil_army', name: '特种兵兵王', keywords: '兵王, 特种兵, 归来, 护国', axes: [2, 3, 1, 1, 2, 4] },
        { id: 'mil_war', name: '战争抗战', keywords: '抗战, 会战, 铁血, 家国', axes: [2, 3, 1, 2, 1, 4] },
        { id: 'mil_spy', name: '谍战', keywords: '潜伏, 情报, 双面, 信仰', axes: [1, 3, 1, 3, 1, 3] },
      ],
    },
    {
      id: 'acg', name: '二次元', icon: '🎭',
      keywords: '二次元, 动漫, 同人, 综漫, 日系, 轻小说, 异世界',
      aiWordBank: '名场面, 破防, 爷青回, 中二, 觉醒',
      axes: [4, 2, 3, 2, 4, 3],
      themes: [
        { id: 'acg_doujin', name: '同人', keywords: '同人, 原作人物, 补完, 意难平', axes: [4, 2, 3, 3, 3, 4] },
        { id: 'acg_zongman', name: '综漫', keywords: '综漫, 世界穿梭, 副本, 能力', axes: [3, 2, 3, 1, 4, 3] },
        { id: 'acg_school', name: '日系校园', keywords: '日系校园, 部活, 学园祭, 通勤', axes: [4, 2, 3, 3, 4, 4] },
        { id: 'acg_isekai', name: '异世界转生', keywords: '异世界, 转生, 外挂, 勇者, 魔王', axes: [4, 2, 3, 2, 4, 3] },
        { id: 'acg_mecha', name: '机战番', keywords: '机甲, 驾驶, 羁绊, 热血', axes: [3, 3, 2, 1, 3, 4] },
        { id: 'acg_mahou', name: '魔法少女', keywords: '魔法, 变身, 契约, 守护', axes: [4, 3, 3, 3, 3, 4] },
        { id: 'acg_moe', name: '萌系日常', keywords: '萌, 治愈, 日常, 贴贴', axes: [5, 2, 3, 4, 4, 4] },
        { id: 'acg_battle', name: '战斗热血', keywords: '战斗, 觉醒, 极限, 燃', axes: [3, 2, 2, 1, 2, 5] },
        { id: 'acg_river', name: '废土萌系', keywords: '废土, 反差萌, 求生, 暖心', axes: [3, 3, 2, 3, 3, 4] },
      ],
    },
    {
      id: 'reality', name: '现实', icon: '🌆',
      keywords: '现实, 生活, 奋斗, 时代, 人情, 理想, 成长',
      aiWordBank: '烟火人间, 时代洪流, 平凡英雄, 冷暖自知',
      axes: [3, 3, 1, 3, 2, 3],
      themes: [
        { id: 'rl_life', name: '现实人生', keywords: '人生, 奋斗, 理想, 抉择', axes: [3, 3, 1, 3, 2, 4] },
        { id: 'rl_industry', name: '行业职场', keywords: '行业, 职场, 匠人, 浮世绘', axes: [3, 3, 1, 3, 2, 3] },
        { id: 'rl_zhifu', name: '治愈生活', keywords: '治愈, 温情, 小店, 慢生活', axes: [5, 2, 2, 4, 3, 4] },
      ],
    },
  ],

  female: [
    {
      id: 'f_mr', name: '现代言情', icon: '💕',
      keywords: '言情, 恋爱, 总裁, 豪门, 甜宠, 婚恋, 都市情感',
      aiWordBank: '怦然心动, 命中注定, 霸道柔情, 宠溺, 双向奔赴',
      axes: [4, 3, 2, 3, 3, 4],
      themes: [
        { id: 'fm_boss', name: '霸总豪门', keywords: '总裁, 豪门, 契约, 先婚后爱', axes: [4, 3, 2, 3, 3, 4] },
        { id: 'fm_majia', name: '马甲逆袭', keywords: '马甲, 隐藏身份, 掉马, 逆袭', axes: [4, 2, 3, 2, 4, 4] },
        { id: 'fm_mengbao', name: '萌宝团宠', keywords: '萌宝, 带娃, 团宠, 认亲', axes: [5, 2, 2, 3, 4, 4] },
        { id: 'fm_zhichang', name: '职场婚恋', keywords: '职场, 势均力敌, 成年人的恋爱', axes: [3, 3, 2, 3, 2, 4] },
        { id: 'fm_niandai', name: '年代文', keywords: '七零八零, 大院, 家长里短, 发家', axes: [4, 3, 2, 3, 3, 4] },
        { id: 'fm_chuanshu', name: '穿书炮灰', keywords: '穿书, 炮灰, 抱大腿, 剧情崩坏', axes: [4, 2, 4, 2, 4, 4] },
        { id: 'fm_chasing', name: '追妻火葬场', keywords: '悔过, 破镜重圆, 虐渣, 追妻', axes: [3, 3, 2, 3, 2, 5] },
        { id: 'fm_tian', name: '无虐小甜文', keywords: '甜宠, 撒糖, 双向奔赴, 治愈', axes: [5, 2, 2, 3, 4, 5] },
        { id: 'fm_haomentia', name: '豪门爽文', keywords: '豪门, 打脸, 逆袭, 爽', axes: [4, 2, 3, 2, 4, 4] },
      ],
    },
    {
      id: 'f_ar', name: '古代言情', icon: '👘',
      keywords: '古言, 宅斗, 宫斗, 权谋, 嫡庶, 王妃, 世情',
      aiWordBank: '步步惊心, 母仪天下, 机关算尽, 一生一世一双人',
      axes: [3, 4, 2, 3, 2, 4],
      themes: [
        { id: 'fa_gongdou', name: '宫斗宅斗', keywords: '宫斗, 后院, 嫡庶, 争宠', axes: [2, 4, 2, 3, 1, 4] },
        { id: 'fa_shiqing', name: '古风世情', keywords: '世情, 大女主, 经营, 家风', axes: [3, 4, 1, 3, 2, 3] },
        { id: 'fa_naodong', name: '古言脑洞', keywords: '穿越, 系统, 反套路, 轻松', axes: [4, 2, 4, 2, 5, 3] },
        { id: 'fa_shenyi', name: '神医毒妃', keywords: '医妃, 毒术, 打脸, 双强', axes: [3, 4, 2, 2, 2, 4] },
        { id: 'fa_fuchou', name: '重生嫡女', keywords: '重生, 复仇, 嫡女, 清算', axes: [2, 4, 2, 2, 1, 5] },
        { id: 'fa_wangfei', name: '王妃皇后', keywords: '王妃, 摄政, 凤仪, 帝后', axes: [3, 4, 2, 3, 2, 4] },
        { id: 'fa_zhongtian', name: '种田农家', keywords: '种田, 农家, 发家, 家长里短', axes: [4, 2, 2, 4, 3, 3] },
      ],
    },
    {
      id: 'f_xh', name: '玄幻言情', icon: '✨',
      keywords: '玄幻言情, 修仙, 女强, 奇幻, 甜宠, 兽世',
      aiWordBank: '逆天, 证道, 天骄, 一生一世, 并肩',
      axes: [4, 4, 2, 2, 2, 4],
      themes: [
        { id: 'fx_east', name: '东方玄幻言情', keywords: '修仙甜宠, 道侣, 双修, 飞升', axes: [4, 4, 2, 3, 2, 4] },
        { id: 'fx_west', name: '西方奇幻', keywords: '魔法, 精灵, 骑士, 龙族', axes: [3, 4, 2, 3, 2, 4] },
        { id: 'fx_beast', name: '穿越兽世', keywords: '兽人, 兽世, 结侣, 甜宠', axes: [4, 3, 2, 3, 3, 4] },
        { id: 'fx_nvqiang', name: '女强爽文', keywords: '女强, 逆袭, 打脸, 不输须眉', axes: [3, 3, 2, 1, 3, 4] },
      ],
    },
    {
      id: 'f_my', name: '悬疑言情', icon: '🔎',
      keywords: '悬疑恋爱, 推理, 灵异, 探险, 破案, 并肩',
      aiWordBank: '抽丝剥茧, 反转, 势均力敌, 生死与共',
      axes: [2, 3, 1, 2, 2, 3],
      themes: [
        { id: 'fmy_detect', name: '推理甜宠', keywords: '破案, 神探, 强强, 甜宠', axes: [3, 3, 1, 2, 3, 4] },
        { id: 'fmy_lingyi', name: '灵异言情', keywords: '阴阳, 灵异, 命格, 守护', axes: [2, 3, 2, 3, 2, 4] },
        { id: 'fmy_explore', name: '探险盗墓', keywords: '探险, 古墓, 机关, 生死', axes: [2, 3, 1, 2, 2, 4] },
      ],
    },
    {
      id: 'f_sc', name: '青春校园', icon: '🏫',
      keywords: '校园, 初恋, 暗恋, 同桌, 学霸, 青春, 成长',
      aiWordBank: '怦然心动, 年少欢喜, 并肩成长, 白月光',
      axes: [4, 2, 2, 3, 4, 4],
      themes: [
        { id: 'sc_sweet', name: '校园甜宠', keywords: '初恋, 暗恋, 双向奔赴, 甜', axes: [5, 2, 2, 3, 4, 4] },
        { id: 'sc_xueba', name: '学霸逆袭', keywords: '学霸, 竞赛, 逆袭, 一同上岸', axes: [4, 2, 2, 2, 3, 4] },
        { id: 'sc_heal', name: '青春治愈', keywords: '治愈, 成长, 和解, 遗憾', axes: [4, 3, 2, 4, 2, 5] },
      ],
    },
    {
      id: 'f_bl', name: '纯爱', icon: '🌈',
      keywords: '纯爱, 双男主, 现代, 古风, 电竞, 娱乐圈',
      aiWordBank: '双向奔赴, 唯一, 救赎, 并肩',
      axes: [4, 3, 2, 3, 3, 5],
      themes: [
        { id: 'bl_modern', name: '现代纯爱', keywords: '都市, 职场, 校园, 破镜重圆', axes: [4, 3, 2, 3, 3, 5] },
        { id: 'bl_ancient', name: '古风纯爱', keywords: '权谋, 仙侠, 江湖, 师徒', axes: [3, 4, 2, 3, 2, 5] },
        { id: 'bl_esports', name: '文娱纯爱', keywords: '电竞, 娱乐圈, 追梦, 并肩', axes: [4, 2, 2, 2, 4, 4] },
      ],
    },
    {
      id: 'f_gl', name: '百合', icon: '🌸',
      keywords: '百合, 双女主, 现代, 古风, 校园, 职场',
      aiWordBank: '心动, 救赎, 细腻, 双向',
      axes: [4, 3, 2, 3, 3, 5],
      themes: [
        { id: 'gl_modern', name: '现代百合', keywords: '都市, 校园, 职场, 细腻', axes: [4, 3, 2, 3, 3, 5] },
        { id: 'gl_ancient', name: '古风百合', keywords: '宫斗, 仙侠, 江湖, 宅斗', axes: [3, 4, 2, 3, 2, 5] },
      ],
    },
    {
      id: 'f_fantasy_brain', name: '现言脑洞', icon: '💡',
      keywords: '现言脑洞, 设定, 反套路, 奇幻恋爱, 系统',
      aiWordBank: '脑洞大开, 反套路, 甜爽, 名场面',
      axes: [4, 2, 3, 2, 4, 4],
      themes: [
        { id: 'fb_system', name: '系统甜宠', keywords: '系统, 攻略, 恋爱值, 反套路', axes: [4, 2, 4, 2, 5, 4] },
        { id: 'fb_hudun', name: '奇幻恋爱', keywords: '奇幻, 人设反差, 设定流, 甜', axes: [4, 3, 3, 3, 3, 4] },
      ],
    },
    {
      id: 'f_star', name: '星光璀璨', icon: '🌟',
      keywords: '娱乐圈, 星光, 顶流, 综艺, 追梦, 舞台',
      aiWordBank: '惊艳全场, 顶流, 出圈, 舞台, 星光',
      axes: [4, 2, 3, 2, 4, 4],
      themes: [
        { id: 'st_singer', name: '歌坛文抄', keywords: '歌手, 作曲, 惊艳, 出圈', axes: [4, 2, 3, 2, 4, 4] },
        { id: 'st_actress', name: '影后之路', keywords: '演员, 试镜, 红毯, 逆袭', axes: [3, 3, 3, 2, 3, 4] },
        { id: 'st_variety', name: '综艺爆笑', keywords: '综艺, 名场面, 吐槽, 沙雕', axes: [4, 2, 4, 2, 5, 3] },
      ],
    },
  ],
};

// 扁平索引：themeId -> { category, theme, channel }
const THEME_INDEX = (() => {
  const idx = {};
  for (const channel of Object.keys(CATEGORY_TREE)) {
    for (const cat of CATEGORY_TREE[channel]) {
      for (const th of (cat.themes || [])) {
        idx[th.id] = { channel, category: cat, theme: th };
      }
      // 大类自身也可被解析（无题材时）
      if (cat.id && !idx[cat.id]) idx[`cat:${cat.id}`] = { channel, category: cat, theme: null };
    }
  }
  return idx;
})();

function lookupCategory(nameOrId) {
  if (!nameOrId) return null;
  const key = String(nameOrId);
  for (const channel of Object.keys(CATEGORY_TREE)) {
    for (const cat of CATEGORY_TREE[channel]) {
      if (cat.id === key || cat.name === key) return { channel, category: cat, theme: null };
    }
  }
  return null;
}

/**
 * 解析类型 SKU → { name, keywords, aiWordBank, outlineSeed, axes, channel, category, theme }
 * sku: { channel, category, theme, elements:[], personas:[], tones:[], cp }
 * 也接受仅传 { category: '都市' } 或字符串 'urban'（兼容旧 novelTypeId）。
 */
function resolveTypeSku(sku) {
  const s = typeof sku === 'string' ? { theme: sku, category: sku } : (sku || {});

  // 1) 定位大类与题材
  let cat = null, theme = null, channel = s.channel || null;
  const themeHit = s.theme ? THEME_INDEX[s.theme] : null;
  if (themeHit) { cat = themeHit.category; theme = themeHit.theme; channel = themeHit.channel; }
  else {
    const catHit = (s.category && (THEME_INDEX[`cat:${s.category}`] || lookupCategory(s.category)))
      || (s.theme && lookupCategory(s.theme));
    if (catHit) { cat = catHit.category; channel = catHit.channel; }
  }

  // 2) 基底 keywords / aiWordBank
  const keywordParts = [];
  const wordParts = [];
  if (cat) { keywordParts.push(cat.keywords); if (cat.aiWordBank) wordParts.push(cat.aiWordBank); }
  if (theme) keywordParts.push(theme.keywords);

  // 3) 多选标签并集
  const toneObjs = (s.tones || []).map((tId) => TONES[tId]).filter(Boolean);
  for (const eId of (s.elements || [])) { const e = ELEMENTS[eId]; if (e) { keywordParts.push(e[1]); if (e[2]) wordParts.push(e[2]); } }
  for (const pId of (s.personas || [])) { const p = CHARACTERS[pId]; if (p) keywordParts.push(p[1]); }
  for (const t of toneObjs) { keywordParts.push(t.keywords); }

  // 4) axes 合成：题材默认 < 大类基底 < tones（按选择顺序，后者覆盖已定义轴）
  const axesSources = [];
  if (cat) axesSources.push(axesFromSeed(cat.axes));
  if (theme) axesSources.push(axesFromSeed(theme.axes));
  for (const t of toneObjs) { if (t.axes) axesSources.push(axesFromSeed(t.axes)); }
  const axes = mergeAxesLoose(axesSources);

  const name = theme ? `${cat ? cat.name : ''}·${theme.name}` : (cat ? cat.name : (s.theme || '未分类'));
  const outlineSeed = theme ? '' : '';

  return {
    name,
    channel,
    category: cat ? cat.id : null,
    theme: theme ? theme.id : null,
    keywords: dedupeJoin(keywordParts),
    aiWordBank: dedupeJoin(wordParts),
    outlineSeed,
    axes,
    tones: toneObjs.map((t) => t.name),
    toneContract: buildToneContract(toneObjs),
  };
}

/**
 * 风格基调硬契约：把用户多选的风格基调(tones)升格为与读者的类型约定，
 * 要求全篇稳定体现，防止基调被世界观/剧情默认气氛稀释（“tag 不符”）。
 * 只约束“怎么写”（语气/节奏/幽默与情绪浓度），不改写事件与因果。
 */
function buildToneContract(toneObjs) {
  if (!toneObjs || !toneObjs.length) return '';
  const list = toneObjs.map((t) => `「${t.name}」（${t.keywords}）`).join('、');
  return `【风格基调契约 — 与读者的类型约定，必须在全篇稳定兑现】
本书锁定的风格基调：${list}。
这些基调是硬性类型承诺，优先级高于世界观的默认气氛：即便设定/剧情偏沉重，也必须通过叙述腔调、人物互动、对白节奏与措辞稳定体现上述基调（如「搞笑/无厘头」要求叙述与对白保持谐趣与反差、把荒诞处境写出喜剧张力；「甜宠」要求关系互动持续发糖；「热血」要求情绪上扬有燃点；「暗黑/致郁」要求冷峻压抑贯穿……依此类推），不得把成稿写成与所选基调相反的、统一的克制严肃腔。
基调只约束“怎么写”（语气、节奏、幽默与情绪浓度），不改写已确定的事件、因果、人物选择与世界观事实。`;
}

// 本地 loose merge（避免与 aiService 循环依赖）：后者逐轴覆盖
function mergeAxesLoose(list) {
  const out = {};
  for (const src of list) { if (!src) continue; for (const k of AXIS_KEYS) { if (Number.isFinite(src[k])) out[k] = src[k]; } }
  return Object.keys(out).length ? out : null;
}

function dedupeJoin(parts) {
  const seen = new Set();
  const items = [];
  for (const p of parts) {
    if (!p) continue;
    for (const seg of String(p).split(/[,\uff0c]/)) {
      const t = seg.trim();
      if (t && !seen.has(t)) { seen.add(t); items.push(t); }
    }
  }
  return items.join(', ');
}

// 供前端拉取的完整目录（含标签库与树）
function buildSkuCatalog() {
  return {
    axisKeys: AXIS_KEYS,
    tones: mapLib(TONES, (v) => ({ name: v.name })),
    elements: mapLib(ELEMENTS, (v) => ({ name: v[0] })),
    personas: mapLib(CHARACTERS, (v) => ({ name: v[0] })),
    channels: ['male', 'female'],
    tree: {
      male: CATEGORY_TREE.male.map(serializeCat),
      female: CATEGORY_TREE.female.map(serializeCat),
    },
  };
}

function serializeCat(cat) {
  return {
    id: cat.id, name: cat.name, icon: cat.icon, channel: undefined,
    themes: (cat.themes || []).map((t) => ({ id: t.id, name: t.name })),
  };
}

function mapLib(lib, pick) {
  return Object.keys(lib).map((id) => ({ id, ...pick(lib[id]) }));
}

module.exports = {
  AXIS_KEYS,
  TONES,
  ELEMENTS,
  CHARACTERS,
  CATEGORY_TREE,
  resolveTypeSku,
  buildSkuCatalog,
  axesFromSeed,
};
