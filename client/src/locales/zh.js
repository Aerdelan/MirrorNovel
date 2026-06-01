export default {
  // 小说类型名称翻译（自身映射，保持中文）
  typeNames: {
    '都市':'都市','玄幻':'玄幻','仙侠':'仙侠','历史':'历史','武侠':'武侠','科幻':'科幻','悬疑灵异':'悬疑灵异','游戏':'游戏','体育':'体育','军事':'军事','二次元':'二次元',
    '现代言情':'现代言情','古代言情':'古代言情','玄幻言情':'玄幻言情','悬疑言情':'悬疑言情','青春校园':'青春校园','纯爱（双男主）':'纯爱（双男主）','百合（双女主）':'百合（双女主）',
    '异世界转生':'异世界转生','校园恋爱':'校园恋爱','奇幻冒险':'奇幻冒险','日常系':'日常系','战斗异能':'战斗异能','科幻未来':'科幻未来',
  },
  // 标签翻译
  tagNames: {
    '重生':'重生','穿越':'穿越','快穿':'快穿','穿书':'穿书','系统':'系统','签到':'签到','面板':'面板','空间':'空间',
    '种田':'种田','末世':'末世','星际':'星际','娱乐圈':'娱乐圈','直播':'直播','美食':'美食','推理':'推理','灵异':'灵异','盗墓':'盗墓',
    '爽文':'爽文','打脸':'打脸','逆袭':'逆袭','无敌':'无敌','甜宠':'甜宠','虐文':'虐文','治愈':'治愈','搞笑':'搞笑',
    '腹黑':'腹黑','病娇':'病娇','团宠':'团宠','女强':'女强','学霸':'学霸','天才':'天才','战神':'战神','赘婿':'赘婿','萌宝':'萌宝',
    '傲娇':'傲娇','天然呆':'天然呆','元气':'元气','热血':'热血','高冷':'高冷','神秘':'神秘','活泼':'活泼','冷静':'冷静','温柔':'温柔',
    '冷酷':'冷酷','暧昧':'暧昧','异世界':'异世界','学园':'学园','奇幻':'奇幻','日常':'日常','战斗':'战斗','冒险':'冒险',
    '穿越异世界 / 转生':'穿越异世界 / 转生','迷宫探索 / 冒险者':'迷宫探索 / 冒险者','魔王 / 勇者':'魔王 / 勇者','龙族 / 精灵':'龙族 / 精灵',
    '青梅竹马 / 天降':'青梅竹马 / 天降','学生会 / 社团':'学生会 / 社团','学园祭 / 修学旅行':'学园祭 / 修学旅行','转校生 / 同桌':'转校生 / 同桌',
    '剑与魔法':'剑与魔法','魔法学院':'魔法学院','骑士 / 王国':'骑士 / 王国','精灵 / 矮人 / 兽人':'精灵 / 矮人 / 兽人',
    '治愈日常':'治愈日常','小镇生活':'小镇生活','美食 / 咖啡':'美食 / 咖啡','猫与书店':'猫与书店',
    '能力觉醒':'能力觉醒','学园战斗':'学园战斗','排名赛':'排名赛','异能组织':'异能组织',
    '未来都市 / 赛博':'未来都市 / 赛博','AI / 机器人':'AI / 机器人','星际 / 宇宙':'星际 / 宇宙','虚拟现实':'虚拟现实',
  },
  // 通用
  app: { title: 'MirrorNovel生成', slogan: 'AI 小说创作平台', group: '官方群：1019601998' },
  common: { confirm: '确定', cancel: '取消', save: '保存', delete: '删除', edit: '编辑', close: '关闭', loading: '加载中...', yes: '是', no: '否', all: '全部' },
  auth: { login: '登录', register: '注册', logout: '退出登录', email: '邮箱', password: '密码', nickname: '昵称', verifyCode: '验证码', getCode: '获取验证码', sending: '发送中', placeholderEmail: '请输入邮箱', placeholderPwd: '请输入密码', placeholderNick: '给自己起个昵称', placeholderPwdConfirm: '至少6位密码', placeholderCode: '输入验证码', needAccount: '还没有账号？', hasAccount: '已有账号？', loginSuccess: '登录后继续使用', fillAll: '请填写完整信息', invalidEmail: '请输入有效的邮箱地址', codeSent: '验证码已发送到邮箱，请注意查收', codeFail: '发送验证码失败', pwdMinLen: '密码至少6位', pwdMismatch: '两次密码输入不一致', loginFail: '登录失败', registerFail: '注册失败', backHome: '返回首页' },
  tab: { generate: '生成', polish: '润色', profile: '我的', bookshelf: '书架', distill: '蒸馏' },

  // 公告弹窗
  announcement: { title: '🎉 欢迎使用MirrorNovel生成', desc: '加官方QQ群 1019601998 联系管理员', claim: '免费领取 5,000 Token', tip1: '📌 进群后发送：我的用户名 {email}', tip2: '📌 Token 自动到账，可用于系统模型生成', tip3: '📌 1 Token ≈ 1 字输出，5000 Token 可生成约 5000 字', gotIt: '我知道了' },

  // 生成页
  generate: {
    tabGen: '✍️ 生成小说', tabLN: '🌸 轻小说',
    stepType: '选择小说类型', stepChar: '主角设定', stepWorld: '世界观设定', stepOutline: '创作大纲', stepMode: '生成模式 & 字数设定',
    maleFreq: '👨 男频', femaleFreq: '👩 女频',
    placeholderName: '故事主角名字', placeholderWorld: '描述故事的世界观、背景设定、特殊规则等（可选）', placeholderOutline: '可选，不填则由AI自动生成大纲',
    modeBook: '📚 生成整本', modeChapter: '📄 生成一章',
    unitWord: '字', btnGenerate: '🚀 开始创作', btnGenerating: '⏳ 生成中...',
    statusGenerating: '大纲生成中...', statusDone: '✅ 生成完成！', statusPaused: '⏸️ 已暂停', statusExhausted: '⚠️ Token 已用完，请充值',
    selectedType: '✅ 已选择：{name}',
    // 轻小说
    lnStepType: '选择轻小说类型', lnStepChar: '角色设定', lnStepWorld: '世界观 / 背景设定', lnStepMode: '生成模式 & 字数设定',
    lnPlaceholderName: '主角名字（日式风格，如：佐藤悠真）', lnPlaceholderWorld: '描述故事发生的世界背景（可选）',
    lnCharTrait: '角色属性', lnBtnGenerate: '🌸 开始创作轻小说',
    // 参考匹配
    refMatch: '📖 参考风格匹配', refAutoMatched: '已自动匹配 {count} 部「{type}」风格参考', refEmpty: '蒸馏库中暂无匹配「{type}」的参考数据', refSelectType: '请先选择小说类型，系统将自动匹配蒸馏库中的参考风格', refSelected: '已选 {count} 部', refNoLN: '蒸馏库中暂无轻小说参考数据，请先在「蒸馏」页面导入轻小说',
    wordShort: '字',
    // 大纲弹窗
    outlinePreview: '📋 AI 大纲预览', outlineDesc: '以下是大纲，你可以直接编辑修改，确认无误后点击"确定开始"生成正文',
    outlineConfirm: '确定开始',
    outlineGenerating: '🤖 AI 正在构思大纲...',
    // 模板匹配
    tmplMatched: '📋 已匹配类型模板', tmplMatch: '匹配', tmplHint: '以上模板仅为参考，实际创作以你的世界观设定为主',
  },

  // 润色页
  polish: {
    title: '✨ 润色文本', subtitle: '对小说文本进行润色优化，支持自定义润色方案和去AI味处理',
    stepInput: '选择输入方式（二选一）', stepText: '输入需要润色的文本', stepFile: '上传需要润色的 .txt 文件', stepScheme: '润色方案', stepOption: '附加选项',
    modeText: '⌨️ 输入文本', modeFile: '📄 上传文件',
    placeholderText: '粘贴需要润色的小说文本...', placeholderCustom: '自定义润色要求...',
    labelDoDeslop: '润色完成后同步执行去AI味处理',
    btnPolish: '✨ 开始润色', btnPolishing: '⏳ 润色中...',
    hintText: '请在上方输入需要润色的文本', hintFile: '请上传一个 .txt 文件',
    statusPolishing: '正在润色...', statusDeslop: '正在执行去AI味处理...', statusDone: '✅ 润色完成！共 {count} 字',
    presets: { default: '默认润色', concise: '精简文风', ornate: '华丽文风', colloquial: '口语化' },
    download: '📥 下载为 .txt 文件',
  },

  // 我的
  profile: {
    title: '👤 我的', loginFirst: '登录后解锁全部功能',
    tokenBalance: '💰 Token 余额', available: '可用 Token', total: '总额', used: '已用',
    getToken: '💬 加群联系群主获取 Token', tokenDesc: 'Token 用完或需要更多 Token，请加 QQ 群联系群主：', groupNum: '群号：1019601998', groupNote: '加群时请备注"MirrorNovel"',
    stats: '创作统计', totalWorks: '总作品', totalWords: '总字数', completed: '已完成', inProgress: '进行中',
    editNick: '修改昵称', placeholderNick: '输入新昵称',
    aiConfig: 'AI 模型配置', aiConfigDesc: '可为 大纲/写作/润色/推理 分别指定不同模型',
    modelProvider: '模型来源', providerDefault: '默认（系统配置）', providerSystem: '系统代购（按 Token 计费 ¥15/百万）', providerOllama: '本地 Ollama', providerCloud: '云端自定义',
    systemDesc: '使用系统提供的高性能模型，按实际输出 Token 计费', rate: '费率：15 元 / 100万 Token', balance: '当前余额：', buyToken: '购买 Token 请加 QQ 群 1019601998',
    modelOutline: '大纲模型', modelWriting: '写作模型', modelPolish: '润色模型', modelReasoning: '推理模型',
    refreshModels: '🔄 刷新模型列表',
    saveConfig: '💾 保存配置', saved: '✅ 配置已保存', nickUpdated: '昵称已更新', nickFail: '更新失败：',
    // 语言切换
    langSwitch: '🌐 语言', langZh: '中文', langEn: 'English',
  },

  // 书架
  bookshelf: {
    title: '📚 我的书架', batchExport: '📦 批量导出', cancel: '✕ 取消', selectAll: '全选', selected: '已选 {count} 本',
    exportSelected: '📥 导出选中', exportAll: '📥 导出全部',
    empty: '📖 书架空空如也', emptyHint: '去生成你的第一本小说吧', goGenerate: '✍️ 去生成',
    defaultTitle: '未命名小说', pause: '⏸ 暂停', resume: '▶ 继续生成', write: '📝 续写', outline: '📋 大纲', export: '📥 导出',
    editOutline: '📋 编辑大纲 -', placeholderOutline: '输入创作大纲...', saveOutline: '💾 保存大纲',
    writeMode: '📝 续写方式 -', progress: '当前进度：{current} / {target} 字',
    continueBook: '继续生成整本', continueBookDesc: '自动续写到目标字数（{count}字）',
    continueChapter: '续写一章', continueChapterDesc: '跳转到续写页面，可自定义续写方向',
    aiWriting: '🤖 AI 正在续写中...', currentChapter: '当前：第{num}章', generated: '已生成 {words} 字',
    statusGenerating: '生成中', statusPaused: '已暂停', statusCompleted: '已完成', statusError: '出错了',
    justNow: '刚刚', minAgo: '{m}分钟前', hourAgo: '{h}小时前',
    deleteConfirm: '确定要删除《{title}》吗？',
  },

  // 续写
  continue: {
    title: '📄 导入小说', uploadFile: '📂 上传 .txt 文件', pasteText: '或在此粘贴小说内容（至少50字）...',
    charsInput: '已输入 {count} 字', minChars: '（至少需要50字）',
    novelInfo: '📋 小说信息', novelName: '小说名称（可选）', placeholderTitle: '留空自动生成',
    styleType: '小说风格类型', selectStyle: '请选择风格（选填）', otherStyle: '其他风格',
    writeRequest: '✍️ 续写要求', placeholderRequest: '描述你想要的续写方向（如：主角觉醒隐藏力量、揭开身世之谜等）',
    requestHint: '留空则AI自动续写',
    modeBook: '📚 续写整本', modeChapter: '📄 续写一章',
    wordCount: '目标字数', btnWrite: '🚀 开始续写', btnWriting: '⏳ 续写中...',
    chapter: '第{num}章', chapterGenerating: '正在生成 第{num}章...',
  },

  // 小说详情
  novelDetail: {
    unknown: '未知', freeSetting: '自由发挥', outOf: '{current}/{target} 字',
    chapter: '章', btnEdit: '✏️ 编辑', btnContinue: '继续生成', btnSave: '💾 保存',
    placeholderEdit: '编辑章节内容...', editChapter: '编辑 第{num}章',
    completed: '已完成', generating: '生成中', paused: '已暂停',
  },

  // 蒸馏页
  distill: {
    title: '📚 风格参考库', myLib: '📖 我的库',
    stepDistillType: '选择蒸馏类型', normalNovel: '📖 普通小说', lightNovel: '🌸 轻小说', lnHint: '日式ACGN风格小说提取，分析角色萌属性、对话风格、动画感描写等',
    stepCategory: '选择{type}类型', stepCookie: '🔑 番茄小说 Cookie 设置',
    stepFanqieImport: '从番茄小说导入', fanqieDesc: '输入番茄小说的 Book ID，自动获取书名和类型',
    fanqieDownload: '下载番茄小说（纯下载，不蒸馏）', fanqieDownloadDesc: '输入 Book ID 和章节数，下载为 .txt 文件',
    stepUpload: '或上传本地的 .txt 文件', uploadHint: '支持 UTF-8 编码，最大 10MB',
    uploadName: '小说名称', placeholderName: '输入小说名称',
    btnUpload: '🚀 上传并提取风格', btnUploading: '⏳ 分析中...',
    cookieHelp: '❓如何获取', cookiePlaceholder: '粘贴 document.cookie 内容',
    cookieSave: '💾 保存', cookieConfigured: '✅ Cookie 已配置（{len} 字符）', cookieNotConfigured: '⚠️ 未配置 Cookie，锁定章节无法下载',
    cookieTips: ['Chrome 打开 fanqienovel.com 并登录', '按 F12 → Application → Cookies → fanqienovel.com', '右键任意 cookie → "显示以 URL 编码"', '全选复制所有 cookie 文本，粘贴到下方输入框', '或：刷新页面 → 控制台输入 document.cookie → 复制结果'],
    searchPlaceholder: '搜索分类或标签...',
    subCategory: '二级题材（可选）', tags: '标签（可选）',
    downloadBtn: '📥 下载', downloadChapter: '章数(0=全本)',
  },

  // 参考库列表
  refList: {
    title: '📖 风格参考库', upload: '➕ 上传', total: '共 {count} 部', analyzed: '已分析 {count} 部',
    analyzedBadge: '已分析', notAnalyzed: '未分析', general: '通用',
    noData: '还没有上传参考小说', uploadFirst: '📄 上传第一部',
    deleteConfirm: '确定删除《{title}》吗？',
    qualityScore: '质量分', styleDesc: '📋 风格描述（{len}字）', writingFeatures: '✍️ 写作特点',
    excerpts: '📝 精选片段（{count}段）', excerptLabel: '片段 {num}',
    vocab: '🏷️ 特色词汇（{count}个）', chapterStruct: '📐 章节结构',
    lnBadge: '轻小说',
    // 详情弹窗
    detailCategory: '分类：{cat} / {sub}', detailGender: '性别：{gender}', detailWords: '字数：{count}', detailTags: '标签：{tags}',
    genderMale: '男频', genderFemale: '女频',
  },

  // 错误提示
  error: {
    network: '网络错误', server: '服务器错误', unknown: '未知错误',
    notFound: '页面不存在', noAuth: '请先登录', noPermission: '无权限访问',
    tokenExpired: '登录已过期，请重新登录',
  },

  // 番茄相关
  fanqie: {
    previewTitle: '书名', previewTags: '标签', previewChapters: '章节', notFound: '未获取到',
    chapters: '{count} 章',
  },
}
