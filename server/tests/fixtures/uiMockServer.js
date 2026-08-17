const express = require('express');
const novelTypes = require('../../config/novelTypes');
const novelTypeData = require('../../config/novelTypeData');

const app = express();
app.use(express.json({ limit: '5mb' }));

const now = new Date().toISOString();
const user = {
  _id: 'user-1',
  email: 'demo@mirrornovel.local',
  nickname: '林间写作者',
  role: 'user',
  availablePoints: 88600,
  points: { version: 1, total: 120000, used: 31400 },
  availableTokens: 88600,
  tokens: { total: 120000, used: 31400 },
  modelConfig: { provider: 'system', routeId: 'normal_1', routeAlias: '普通线路模型一' },
};

const adminUser = {
  ...user,
  _id: 'admin-1',
  email: 'admin@mirrornovel.local',
  nickname: '内容管理员',
  role: 'admin',
};

const chapters = [
  {
    chapterNumber: 1,
    title: '第一章 雨停以前',
    wordCount: 1248,
    content: '雨从旧城的屋檐一线线落下。林舟把没有寄件人的包裹放在桌上，没有急着拆。他先去关窗，回来时才发现封口处粘着半枚褪色邮票。\n\n苏晚在电话里沉默了两秒，只问了一句：别碰里面的钥匙。\n\n可包裹还没有打开。林舟看着那条完好的封蜡，听见楼道里有人停在门外。',
    qualityReport: { score: 92, issues: [], eventSignature: '林舟收到匿名包裹并发现门外有人' },
  },
  {
    chapterNumber: 2,
    title: '第二章 被涂掉的名字',
    wordCount: 1366,
    content: '第二天，林舟和苏晚去了停用多年的邮局。值班表最后一页被墨水涂黑，但纸背留下了压痕。\n\n两人借着窗光辨出一个姓氏。苏晚笑着说自己欠他一顿热面，语气很轻，手却一直按着口袋里的旧钥匙。\n\n离开前，林舟在门缝里找到一张新塞进来的车票。日期正是旧案发生的那一天。',
    qualityReport: { score: 88, issues: ['目标字数略低于计划'], eventSignature: '林舟在旧邮局找到被涂掉的姓名与车票' },
  },
];

const novels = [
  {
    _id: 'novel-1',
    userId: user._id,
    title: '雨停以前',
    novelTypeId: '悬疑',
    novelTypeName: '悬疑',
    protagonistName: '林舟',
    worldSetting: '一座长期阴雨、旧城区即将拆迁的沿江城市。',
    outline: '林舟收到匿名包裹后重查十年前的失踪案，并逐步发现家人与旧案的联系。',
    targetWordCount: 50000,
    currentWordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    currentChapterIndex: 2,
    status: 'paused',
    chapters,
    emotionCurve: [
      { chapterNumber: 1, tension: 7, chapterRole: '主线推进' },
      { chapterNumber: 2, tension: 5, chapterRole: '信息揭示' },
    ],
    foreshadowingLedger: [
      { id: 'FH_1_key', content: '旧钥匙上的裂纹', setChapter: 1, targetChapter: 4, status: 'pending' },
      { id: 'FH_2_ticket', content: '被剪去日期的车票', setChapter: 2, targetChapter: 5, status: 'pending' },
    ],
    createdAt: now,
    updatedAt: now,
  },
];

const references = [
  { _id: 'ref-1', title: '旧城悬疑节奏样本', gender: 'male', mainCategory: '悬疑', subCategory: '推理', qualityScore: 91, tags: ['克制', '双线'] },
  { _id: 'ref-2', title: '温情关系推进样本', gender: 'female', mainCategory: '现代言情', subCategory: '成长', qualityScore: 86, tags: ['对话', '关系'] },
];

const routeAliases = [
  { id: 'normal_1', alias: '普通线路模型一' },
  { id: 'normal_2', alias: '普通线路模型二' },
  { id: 'advanced_1', alias: '高级线路模型一' },
  { id: 'vip', alias: 'VIP线路模型' },
  { id: 'svip', alias: 'SVIP线路模型' },
];

const mockActivities = [{
  _id: 'activity-1',
  id: 'activity-1',
  name: '春日写作周',
  description: '累计创作 2000 字即可领取本期奖励。',
  type: 'writing',
  status: 'active',
  startTime: now,
  endTime: new Date(Date.now() + 86400000 * 7).toISOString(),
  rewardPoints: 500,
  minRewardPoints: 500,
  maxRewardPoints: 500,
  reward: { min: 500, max: 500 },
  probability: 100,
  difficulty: 'medium',
  requirement: { metric: 'word_count', operator: 'gte', threshold: 2000 },
  dailyLimit: 1,
  perUserLimit: 1,
  totalLimit: 500,
  totalPointsBudget: 250000,
  limits: { daily: 1, perUser: 1, total: 500, pointsBudget: 250000 },
  counters: { attempts: 48, winners: 48, pointsAwarded: 24000 },
  enabled: true,
  autoClaim: false,
  canClaim: true,
  eligibility: { eligible: true, metric: 'word_count', value: 2614, threshold: 2000 },
  emailSent: false,
}];

function sendSse(res, events) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  let index = 0;
  const timer = setInterval(() => {
    const event = events[index++];
    if (!event) {
      clearInterval(timer);
      res.end();
      return;
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }, 45);
  res.on('close', () => clearInterval(timer));
}

function generatedText(chapterNumber) {
  return `林舟沿着车票上的站名找到江边废弃候车室。墙上的时刻表停在十年前，玻璃后却夹着一张刚写过的便签。\n\n苏晚把热咖啡递给他，说这地方至少比邮局暖和。两个人短暂笑了一下，随后在便签背面看见同一个姓氏。\n\n这一次，线索没有把他们带回过去，而是指向今晚仍会抵达的一班货车。第${chapterNumber}章的选择已经落下。`;
}

app.get('/api/health', (req, res) => res.json({ ok: true, mock: true }));

app.post('/api/auth/login', (req, res) => {
  const account = String(req.body?.email || '').toLowerCase().includes('admin') ? adminUser : user;
  res.json({ token: `mock-${account.role}-token`, user: account });
});
app.post('/api/auth/register', (req, res) => res.json({ token: 'mock-user-token', user }));
app.post('/api/auth/send-code', (req, res) => res.json({ message: '验证码已发送（Mock）' }));
app.get('/api/auth/profile', (req, res) => res.json({ user }));
app.put('/api/auth/profile', (req, res) => res.json({ user: { ...user, nickname: req.body?.nickname || user.nickname } }));
app.get('/api/auth/tokens', (req, res) => res.json({
  total: 120000,
  used: 31400,
  available: 88600,
  points: { total: 120000, used: 31400, available: 88600 },
  availablePoints: 88600,
}));
app.get('/api/auth/stats', (req, res) => res.json({
  totalNovels: novels.length,
  totalWords: novels.reduce((sum, item) => sum + item.currentWordCount, 0),
  completedNovels: novels.filter((item) => item.status === 'completed').length,
  inProgressNovels: novels.filter((item) => item.status === 'generating' || item.status === 'paused').length,
}));
app.post('/api/auth/purchase', (req, res) => {
  const pointsAmount = Math.floor(Number(req.body?.amount || 0) * 1000);
  res.json({ total: 120000 + pointsAmount, available: 88600 + pointsAmount, pointsAmount });
});
app.post('/api/auth/checkin', (req, res) => res.json({
  message: '签到成功！获得 100 积分',
  reward: 100,
  dayIndex: 5,
  totalDays: 5,
  availableTokens: 89600,
  availablePoints: 89600,
}));
app.get('/api/auth/checkin-status', (req, res) => res.json({ checkedIn: false, dayIndex: 4, totalDays: 4 }));
app.get('/api/auth/invite-info', (req, res) => res.json({
  inviteCode: 'FOREST26',
  inviteCount: 3,
  inviteRewards: 15000,
  inviteLink: 'http://127.0.0.1:5173/register?invite=FOREST26',
}));
app.get('/api/auth/announcement', (req, res) => res.json({ show: false }));
app.post('/api/auth/dismiss-announcement', (req, res) => res.json({ ok: true }));
app.get('/api/auth/model-config', (req, res) => res.json({
  modelConfig: { provider: 'system', routeId: 'normal_1', routeAlias: '普通线路模型一' },
  routes: routeAliases,
}));
app.put('/api/auth/model-config', (req, res) => {
  const route = routeAliases.find((item) => item.id === req.body?.routeId) || routeAliases[0];
  res.json({ modelConfig: { provider: 'system', routeId: route.id, routeAlias: route.alias } });
});

app.get('/api/billing/routes', (req, res) => res.json({ routes: routeAliases }));
app.get('/api/billing/account', (req, res) => res.json({
  unit: 'points',
  account: { total: 120000, used: 31400, available: 88600 },
  ledger: [
    { type: 'credit', points: 1000, balanceAfter: 120000, reason: 'daily_checkin', createdAt: now },
    { type: 'debit', points: 400, balanceAfter: 88600, routeId: 'normal_1', routeAlias: '普通线路模型一', reason: 'novel_generation', createdAt: now },
  ],
}));

app.get('/api/activities', (req, res) => res.json({ activities: mockActivities }));
app.get('/api/activities/catalog', (req, res) => res.json({
  types: [
    { type: 'checkin', label: '每日签到阶梯' },
    { type: 'writing', label: '写作字数挑战' },
    { type: 'invite', label: '邀请好友奖励' },
    { type: 'lottery', label: '幸运抽奖' },
  ],
}));
app.post('/api/activities/:id/claim', (req, res) => {
  const activity = mockActivities.find((item) => item.id === req.params.id);
  if (!activity) return res.status(404).json({ message: '活动不存在' });
  activity.canClaim = false;
  activity.eligibility = { eligible: false, reason: '已达到本活动参与次数上限' };
  res.json({
    won: true,
    points: 500,
    message: '恭喜获得 500 积分',
    balance: { total: 120500, used: 31400, available: 89100 },
    activity,
  });
});

app.get('/api/novel/types', (req, res) => res.json(novelTypes));
app.get('/api/reference/categories', (req, res) => res.json(novelTypeData));
app.get('/api/reference/list', (req, res) => res.json(references));
app.get('/api/reference/list-by-type', (req, res) => res.json(references.filter((item) => !req.query.type || item.mainCategory === req.query.type)));
let mockFanqieCookie = '';
app.get('/api/reference/fanqie-cookie-status', (req, res) => res.json({
  configured: Boolean(mockFanqieCookie),
  length: mockFanqieCookie.length,
  preview: mockFanqieCookie ? `${mockFanqieCookie.slice(0, 8)}...` : null,
}));
app.post('/api/reference/fanqie-cookie', (req, res) => {
  mockFanqieCookie = String(req.body?.cookie || '');
  res.json({ status: { configured: Boolean(mockFanqieCookie), length: mockFanqieCookie.length, preview: mockFanqieCookie ? `${mockFanqieCookie.slice(0, 8)}...` : null } });
});
app.delete('/api/reference/fanqie-cookie', (req, res) => {
  mockFanqieCookie = '';
  res.json({ status: { configured: false, length: 0, preview: null } });
});
app.get('/api/reference/fanqie-preview', (req, res) => res.json({
  bookId: req.query.bookId,
  title: '雨城来信',
  genre: '悬疑灵异',
  labels: ['悬疑灵异', '推理', '群像'],
  chapterCount: 68,
}));
app.post('/api/reference/fanqie-import', (req, res) => res.json({
  message: '《雨城来信》已导入并完成风格提取',
  novel: { _id: 'ref-fanqie', title: '雨城来信', bookId: req.body?.bookId },
}));
app.post('/api/reference/upload', (req, res) => res.json({ message: '本地小说已上传并完成风格提取' }));
app.get('/api/reference/fanqie-download', (req, res) => {
  res.type('text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="fanqie-mock.txt"');
  res.send('第一章 雨夜\n\n这是用于界面链路验证的番茄小说下载内容。');
});
app.get('/api/reference/:id', (req, res) => res.json(references.find((item) => item._id === req.params.id) || references[0]));
app.delete('/api/reference/:id', (req, res) => res.json({ ok: true }));

app.get('/api/novel/bookshelf', (req, res) => res.json(novels));
app.get('/api/novel/:id', (req, res, next) => {
  if (['types', 'bookshelf'].includes(req.params.id)) return next();
  const novel = novels.find((item) => item._id === req.params.id);
  if (!novel) return res.status(404).json({ message: '小说不存在' });
  res.json(novel);
});
app.post('/api/novel/match-templates', (req, res) => res.json({ matched: [{ name: '旧城追查', score: 82 }] }));
app.post('/api/novel/generate-outline', (req, res) => res.json({ outline: '【故事主线】匿名包裹牵出旧案。\n【核心冲突】真相会伤害仍在身边的人。\n【剧情阶段】收到线索、追查旧城、关系动摇、揭露真相。\n【结局方向】主角作出有代价的公开选择。' }));
app.post('/api/novel/analyze-structure', (req, res) => res.json({ structure: '【冲突结构】线索推进与关系压力并行\n【章节节奏】两章高压后安排一章关系推进\n【伏笔策略】物件伏笔在中后段回收' }));

app.post('/api/novel/generate', (req, res) => {
  const content = generatedText(1);
  sendSse(res, [
    { type: 'novel_created', novelId: 'novel-generated' },
    { type: 'status', message: '章节计划已确认，开始写作' },
    { type: 'chapter_start', chapterNumber: 1, title: '第1章' },
    { type: 'content', content: content.slice(0, 95) },
    { type: 'content', content: content.slice(95) },
    { type: 'quality_notice', chapterNumber: 1, report: { score: 90, issues: [] } },
    { type: 'chapter_end', chapterNumber: 1, wordCount: content.length },
    { type: 'completed', novelId: 'novel-generated', totalWordCount: content.length },
  ]);
});

app.post('/api/novel/continue/:id', (req, res) => {
  const novel = novels.find((item) => item._id === req.params.id) || novels[0];
  const chapterNumber = novel.chapters.length + 1;
  const content = generatedText(chapterNumber);
  novel.chapters.push({ chapterNumber, title: `第${chapterNumber}章`, content, wordCount: content.length, qualityReport: { score: 90, issues: [] } });
  novel.currentChapterIndex = chapterNumber;
  novel.currentWordCount += content.length;
  novel.status = 'paused';
  sendSse(res, [
    { type: 'chapter_start', chapterNumber, title: `第${chapterNumber}章` },
    { type: 'content', content: content.slice(0, 90) },
    { type: 'content', content: content.slice(90) },
    { type: 'chapter_end', chapterNumber, wordCount: content.length },
    { type: 'completed', novelId: novel._id, totalWordCount: novel.currentWordCount },
  ]);
});

app.post('/api/novel/continue-import', (req, res) => sendSse(res, [
  { type: 'chapter_start', chapterNumber: 1, title: '续写第1章' },
  { type: 'content', content: generatedText(1) },
  { type: 'chapter_end', chapterNumber: 1, wordCount: generatedText(1).length },
  { type: 'completed', novelId: 'imported-novel', totalWordCount: generatedText(1).length },
]));
app.post('/api/novel/:id/continue-chapter/:number', (req, res) => {
  const novel = novels.find((item) => item._id === req.params.id);
  if (!novel) return res.status(404).json({ message: '小说不存在' });
  const chapterNumber = Number(req.params.number);
  const addition = generatedText(chapterNumber);
  let chapter = novel.chapters.find((item) => item.chapterNumber === chapterNumber);
  if (!chapter) {
    chapter = { chapterNumber, title: `第${chapterNumber}章`, content: '', wordCount: 0 };
    novel.chapters.push(chapter);
  }
  chapter.content += addition;
  chapter.wordCount = chapter.content.length;
  novel.currentChapterIndex = Math.max(novel.currentChapterIndex, chapterNumber);
  novel.currentWordCount = novel.chapters.reduce((sum, item) => sum + item.wordCount, 0);
  novel.status = 'paused';
  sendSse(res, [
    { type: 'chapter_start', chapterNumber, title: chapter.title },
    { type: 'content', content: addition.slice(0, 90) },
    { type: 'content', content: addition.slice(90) },
    { type: 'chapter_continued', chapterNumber, addedLength: addition.length },
    { type: 'completed' },
  ]);
});
app.post('/api/novel/pause/:id', (req, res) => res.json({ status: 'paused' }));
app.delete('/api/novel/:id', (req, res) => res.json({ ok: true }));
app.put('/api/novel/:id/outline', (req, res) => res.json({ outline: req.body?.outline || '' }));
app.put('/api/novel/:id/chapter/:number', (req, res) => {
  const novel = novels.find((item) => item._id === req.params.id);
  const chapter = novel?.chapters.find((item) => item.chapterNumber === Number(req.params.number));
  if (!chapter) return res.status(404).json({ message: '章节不存在' });
  chapter.content = String(req.body?.content || '');
  chapter.wordCount = chapter.content.length;
  novel.currentWordCount = novel.chapters.reduce((sum, item) => sum + item.wordCount, 0);
  res.json({ ok: true, content: chapter.content });
});
app.delete('/api/novel/:id/chapter/:number', (req, res) => {
  const novel = novels.find((item) => item._id === req.params.id);
  if (!novel) return res.status(404).json({ message: '小说不存在' });
  novel.chapters = novel.chapters.filter((item) => item.chapterNumber !== Number(req.params.number));
  novel.currentChapterIndex = novel.chapters.length;
  novel.currentWordCount = novel.chapters.reduce((sum, item) => sum + item.wordCount, 0);
  res.json({ ok: true });
});
app.post('/api/novel/deslop', (req, res) => res.json({ processed: String(req.body?.text || '').replace(/仿佛/g, '像') }));
app.post('/api/novel/chapter-keywords/:id/:number', (req, res) => res.json({
  characterKeywords: '林舟，克制，深色风衣；苏晚，冷静，旧钥匙',
  sceneKeywords: '沿江旧城，雨夜，废弃邮局，暖黄路灯，潮湿石阶',
}));
app.post('/api/novel/optimize/:id', (req, res) => res.json({ message: '优化任务已创建' }));
app.post('/api/novel/optimize-status/:id', (req, res) => res.json({
  task: { status: 'completed', progress: '全部章节已检查', optimizedCount: 2 },
}));
app.post('/api/novel/editorial-book/:id', (req, res) => res.json({ message: '编辑任务已创建' }));
app.post('/api/novel/editorial-status/:id', (req, res) => res.json({
  task: { status: 'completed', progress: '已完成', processedCount: 2 },
}));
app.post('/api/novel/polish', (req, res) => sendSse(res, [
  { type: 'status', message: '正在保真润色' },
  { type: 'content', content: '雨声贴着窗沿落下，房间里只剩钟表的轻响。' },
  { type: 'completed' },
]));
app.post('/api/novel/deslop-stream', (req, res) => sendSse(res, [
  { type: 'status', message: '正在检查模板化表达' },
  { type: 'content', content: '林舟把杯子放回桌面，没有替自己的沉默找解释。' },
  { type: 'completed', content: '林舟把杯子放回桌面，没有替自己的沉默找解释。' },
]));

app.get('/api/admin/dashboard', (req, res) => res.json({ totalUsers: 128, totalNovels: 346, totalPoints: 4280000, usedPoints: 2714000, totalTokens: 4280000, usedTokens: 2714000, completedNovels: 214, generatingNovels: 19, recentRegistrations: 23 }));
app.get('/api/admin/users', (req, res) => res.json({ users: [adminUser, user] }));
app.get('/api/admin/users/simple', (req, res) => res.json([adminUser, user]));
app.get('/api/admin/users/:id/invited-users', (req, res) => res.json([user]));
app.put('/api/admin/users/:id', (req, res) => res.json({ ok: true }));
app.post('/api/admin/users/:id/group-reward', (req, res) => res.json({ ok: true }));
app.get('/api/admin/novels', (req, res) => res.json({ novels }));
app.get('/api/admin/distillations', (req, res) => res.json({ distillations: references.map((item) => ({ ...item, originalLength: 86000, aiProcessed: true, createdAt: now, downloadStats: { downloadedChapters: 38, totalChapters: 40 } })) }));
app.get('/api/admin/distillations/:id', (req, res) => res.json(references[0]));
app.put('/api/admin/distillations/:id', (req, res) => res.json({ ok: true }));
app.delete('/api/admin/distillations/:id', (req, res) => res.json({ ok: true }));
app.get('/api/admin/models', (req, res) => res.json({
  formula: { pointsPerRmb: 1000, fixedPoints: 1000, fixedTokens: 20000, paidMarkupMultiplier: 8 },
  routes: routeAliases.map((route) => ({
    ...route,
    pricingMode: ['vip', 'svip'].includes(route.id) ? 'cost' : 'fixed',
    baseUrl: 'https://provider.example/v1',
    model: route.id === 'vip' ? 'provider-vip-model' : route.id === 'svip' ? 'provider-svip-model' : 'provider-standard-model',
    apiKeyConfigured: true,
    pointsPerBlock: ['vip', 'svip'].includes(route.id) ? undefined : 1000,
    tokensPerBlock: ['vip', 'svip'].includes(route.id) ? undefined : 20000,
    inputRmbPerMillion: ['vip', 'svip'].includes(route.id) ? 1.5 : undefined,
    outputRmbPerMillion: ['vip', 'svip'].includes(route.id) ? 6 : undefined,
    costMarkupMultiplier: ['vip', 'svip'].includes(route.id) ? 8 : undefined,
    pointsPerRmb: ['vip', 'svip'].includes(route.id) ? 1000 : undefined,
    configured: true,
  })),
}));
app.put('/api/admin/models', (req, res) => res.json({ message: '线路与积分计价已保存并即时生效', routes: req.body?.routes || [] }));
app.post('/api/admin/restart', (req, res) => res.json({ ok: true }));
app.get('/api/admin/templates', (req, res) => res.json({ templates: [{ name: '旧城追查', keywords: ['旧城', '失踪', '匿名信'], contextPrompt: '强调物证、关系压力和城市空间。' }] }));
app.put('/api/admin/templates', (req, res) => res.json({ ok: true }));
app.get('/api/admin/activities', (req, res) => res.json({ activities: mockActivities }));
app.post('/api/admin/activities', (req, res) => res.status(201).json({ message: '活动已创建', activity: { _id: `activity-${Date.now()}`, ...req.body, status: 'pending', counters: { attempts: 0, winners: 0, pointsAwarded: 0 } } }));
app.put('/api/admin/activities/:id', (req, res) => res.json({ message: '活动已更新', activity: { ...mockActivities[0], ...req.body } }));
app.delete('/api/admin/activities/:id', (req, res) => res.json({ message: '活动已停用' }));
app.get('/api/admin/activities/:id/stats', (req, res) => res.json({ participatingUsers: 48, attempts: 48, winners: 48, totalPointsGiven: 24000 }));
app.post('/api/admin/activities/:id/send-email', (req, res) => res.json({ message: 'Mock 邮件发送完成' }));

const port = Number(process.env.PORT || 3001);
app.listen(port, '127.0.0.1', () => {
  console.log(`MirrorNovel UI mock API listening on http://127.0.0.1:${port}`);
});
