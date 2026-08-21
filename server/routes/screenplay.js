const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Screenplay = require('../models/Screenplay');
const Novel = require('../models/Novel');
const User = require('../models/User');
const { streamGenerate, resolveApiConfig, countTokens } = require('../services/aiService');
const { getPointsSnapshot, isPointsBillingRequired, routeIdForModelConfig, debitPointsForUser } = require('../services/pointsService');

function parseJsonObject(value) {
  const cleaned = String(value || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const candidate = cleaned.match(/\{[\s\S]*\}/);
  if (!candidate) return null;
  try { return JSON.parse(candidate[0]); } catch { return null; }
}

function sanitizeList(value, limit, itemLimit) {
  return (Array.isArray(value) ? value : []).slice(0, limit).map((item) => String(item || '').trim().slice(0, itemLimit)).filter(Boolean);
}

async function chargeScreenplay(req, input, output, modelType, referenceId) {
  if (!isPointsBillingRequired(req.user?.modelConfig)) return;
  const snapshot = getPointsSnapshot(req.user);
  if (snapshot.available <= 0) throw new Error('积分余额不足，请充值后再生成');
  await debitPointsForUser(User, req.userId, {
    routeId: routeIdForModelConfig(req.user?.modelConfig, modelType),
    inputTokens: countTokens(input),
    outputTokens: countTokens(output),
  }, { reason: `screenplay_${modelType}`, referenceId });
}

function screenplaySummary(project) {
  return {
    _id: project._id,
    title: project.title,
    sourceType: project.sourceType,
    productionTarget: project.productionTarget,
    sourceNovelId: project.sourceNovelId,
    episodeCount: project.episodeCount,
    episodeDurationSeconds: project.episodeDurationSeconds,
    status: project.status,
    screenplayBible: project.screenplayBible,
    episodes: project.episodes,
    updatedAt: project.updatedAt,
  };
}

router.get('/projects', auth, async (req, res) => {
  try {
    const projects = await Screenplay.find({ userId: req.userId }).sort({ updatedAt: -1 }).lean();
    res.json(projects.map(screenplaySummary));
  } catch (error) {
    res.status(500).json({ message: '加载剧本项目失败', error: error.message });
  }
});

router.get('/projects/:id', auth, async (req, res) => {
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    res.json(project);
  } catch (error) {
    res.status(500).json({ message: '加载剧本项目失败', error: error.message });
  }
});

router.delete('/projects/:id', auth, async (req, res) => {
  try {
    const result = await Screenplay.deleteOne({ _id: req.params.id, userId: req.userId });
    if (!result.deletedCount) return res.status(404).json({ message: '剧本项目不存在' });
    res.json({ message: '剧本项目已删除' });
  } catch (error) {
    res.status(500).json({ message: '删除剧本项目失败', error: error.message });
  }
});

router.post('/projects', auth, async (req, res) => {
  try {
    const { title, sourceType, productionTarget, sourceNovelId, concept, episodeCount, episodeDurationSeconds } = req.body || {};
    if (!String(title || '').trim()) return res.status(400).json({ message: '请填写剧本名称' });
    if (!['adaptation', 'original'].includes(sourceType)) return res.status(400).json({ message: '请选择剧本来源' });
    if (!['video', 'live_action'].includes(productionTarget)) return res.status(400).json({ message: '请选择交付方式' });

    let sourceSnapshot = {};
    if (sourceType === 'adaptation') {
      if (!sourceNovelId) return res.status(400).json({ message: '请选择要改编的小说' });
      const novel = await Novel.findOne({ _id: sourceNovelId, userId: req.userId });
      if (!novel) return res.status(404).json({ message: '要改编的小说不存在' });
      sourceSnapshot = {
        title: novel.title,
        outline: String(novel.outline || '').slice(0, 12000),
        protagonistName: novel.protagonistName,
        worldSetting: String(novel.worldSetting || '').slice(0, 4000),
        blueprint: novel.storyBlueprint || {},
        chapterSummaries: String(novel.chapterSummaryDoc || '').slice(-10000),
        persona: novel.writingPersonaSnapshot || null,
      };
    }

    const project = await Screenplay.create({
      userId: req.userId,
      title: String(title).trim(),
      sourceType,
      productionTarget,
      sourceNovelId: sourceType === 'adaptation' ? sourceNovelId : null,
      sourceSnapshot,
      concept: String(concept || '').trim(),
      episodeCount: Math.max(1, Math.min(120, Number(episodeCount) || 12)),
      episodeDurationSeconds: Math.max(30, Math.min(1800, Number(episodeDurationSeconds) || 120)),
    });
    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ message: '创建剧本项目失败', error: error.message });
  }
});

router.post('/projects/:id/develop', auth, async (req, res) => {
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    const source = project.sourceType === 'adaptation'
      ? `【改编小说】\n标题：${project.sourceSnapshot?.title || ''}\n大纲：${project.sourceSnapshot?.outline || ''}\n世界观：${project.sourceSnapshot?.worldSetting || ''}\n已写剧情摘要：${project.sourceSnapshot?.chapterSummaries || ''}\n动态蓝图：${JSON.stringify(project.sourceSnapshot?.blueprint || {})}\n原作人格：${JSON.stringify(project.sourceSnapshot?.persona || {})}`
      : `【原创设定】\n${project.concept || '请先构建一个具有明确人物关系和连续冲突的短剧设定。'}`;
    const productionRule = project.productionTarget === 'video'
      ? '交付给视频生成工具：场景必须可视化、单场地点明确，productionNotes 写镜头景别、主体动作、画面重点和转场，不写无法呈现的抽象说明。'
      : '交付给实拍团队：场景必须可执行，productionNotes 写布景重点、人物走位、必要道具和声音提示，避免无法拍摄的内容。';
    const prompt = `请作为连续短剧总编剧，为下列项目建立“剧本圣经”和${project.episodeCount}集分集大纲。短剧要在有限时长内快速建立冲突，每集都推进人物关系或谜团，并以明确的悬念收尾。\n\n${source}\n\n【每集时长】约${project.episodeDurationSeconds}秒\n【制作方式】${productionRule}\n\n只输出 JSON，不要 markdown：\n{\n  "bible": {\n    "logline": "一句话故事",\n    "genre": "类型",\n    "visualTone": "可见的整体视觉气质",\n    "adaptationBoundary": "改编作品时必须保留/允许重排的边界；原创则写原创约束",\n    "characters": [{"name":"姓名","visual":"外貌、服装、年龄段、气质","objective":"本剧阶段目标","relationship":"关键关系","continuity":"不得前后改变的身份、物件或状态"}],\n    "locations": [{"name":"地点","visual":"空间布局、光线、色调和核心道具","storyFunction":"这个场景承载的冲突","continuity":"需要持续保持的空间事实"}],\n    "continuityRules": ["跨集必须保持的事实"]\n  },\n  "episodes": [{"episodeNumber":1,"title":"标题","durationSeconds":${project.episodeDurationSeconds},"premise":"本集开场与目标","conflict":"核心冲突","turn":"本集反转","cliffhanger":"结尾钩子"}]\n}`;
    const result = await streamGenerate(
      '你是一位重视人物动机、空间调度与跨集连续性的短剧总编剧。输出必须可直接进入剧本制作流程。',
      prompt,
      null,
      null,
      resolveApiConfig(req.user?.modelConfig, 'reasoning'),
      0,
      0.35,
      7000,
      90000
    );
    await chargeScreenplay(req, prompt, result.content, 'reasoning', project._id);
    const parsed = parseJsonObject(result.content);
    if (!parsed || !parsed.bible || !Array.isArray(parsed.episodes)) return res.status(502).json({ message: '剧本圣经返回格式无效，请重试' });

    project.screenplayBible = {
      logline: String(parsed.bible.logline || '').slice(0, 800),
      genre: String(parsed.bible.genre || '').slice(0, 120),
      visualTone: String(parsed.bible.visualTone || '').slice(0, 800),
      adaptationBoundary: String(parsed.bible.adaptationBoundary || '').slice(0, 1200),
      characters: (Array.isArray(parsed.bible.characters) ? parsed.bible.characters : []).slice(0, 30),
      locations: (Array.isArray(parsed.bible.locations) ? parsed.bible.locations : []).slice(0, 30),
      continuityRules: sanitizeList(parsed.bible.continuityRules, 30, 500),
    };
    project.episodes = parsed.episodes.slice(0, project.episodeCount).map((episode, index) => ({
      episodeNumber: index + 1,
      title: String(episode.title || `第${index + 1}集`).slice(0, 120),
      durationSeconds: Math.max(30, Math.min(1800, Number(episode.durationSeconds) || project.episodeDurationSeconds)),
      premise: String(episode.premise || '').slice(0, 1000),
      conflict: String(episode.conflict || '').slice(0, 1000),
      turn: String(episode.turn || '').slice(0, 1000),
      cliffhanger: String(episode.cliffhanger || '').slice(0, 1000),
    }));
    project.status = 'developed';
    await project.save();
    res.json(project);
  } catch (error) {
    res.status(500).json({ message: error.message === 'TOKEN_EXHAUSTED' || error.message.includes('积分余额不足') ? '积分余额不足，请充值后再生成' : '生成剧本圣经失败', error: error.message });
  }
});

router.post('/projects/:id/episodes/:episodeNumber/generate', auth, async (req, res) => {
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    const episodeNumber = Number(req.params.episodeNumber);
    const episode = project.episodes.find((item) => item.episodeNumber === episodeNumber);
    if (!episode) return res.status(404).json({ message: '分集大纲不存在，请先生成剧本圣经' });
    const previous = project.episodes.find((item) => item.episodeNumber === episodeNumber - 1);
    const productionRule = project.productionTarget === 'video'
      ? 'productionNotes 必须包含镜头景别、可见主体、动作、画面重点与转场建议。'
      : 'productionNotes 必须包含布景、走位、核心道具、声音或拍摄执行提示。';
    const prompt = `请按短剧工业剧本格式写第${episodeNumber}集。不能改变剧本圣经的角色外观、关系、地点空间与连续性规则；只能使用分集大纲允许的推进。\n\n【剧本圣经】${JSON.stringify(project.screenplayBible)}\n【上一集结尾】${previous?.cliffhanger || '这是第一集'}\n【本集】${JSON.stringify(episode)}\n【制作方式】${productionRule}\n\n只输出 JSON，不要 markdown：\n{"scenes":[{"sceneNumber":1,"heading":"场次标题","interiorExterior":"INT 或 EXT","timeOfDay":"时间","location":"地点","characters":["人物"],"action":"可见动作、人物走位、空间关系与情绪变化","dialogue":[{"character":"人物","line":"对白"}],"productionNotes":"制作提示"}]}\n动作和对白必须共同推进冲突；不要在对白里解释已知信息；最后一场必须兑现本集 cliffhanger。`;
    const result = await streamGenerate(
      '你是一位擅长人物调度、场景连续性和简洁对白的短剧编剧。',
      prompt,
      null,
      null,
      resolveApiConfig(req.user?.modelConfig, 'writing'),
      0,
      0.65,
      6000,
      90000
    );
    await chargeScreenplay(req, prompt, result.content, 'writing', project._id);
    const parsed = parseJsonObject(result.content);
    if (!parsed || !Array.isArray(parsed.scenes) || !parsed.scenes.length) return res.status(502).json({ message: '单集剧本返回格式无效，请重试' });
    episode.scenes = parsed.scenes.slice(0, 30).map((scene, index) => ({
      sceneNumber: index + 1,
      heading: String(scene.heading || `场${index + 1}`).slice(0, 160),
      interiorExterior: ['INT', 'EXT', 'INT_EXT'].includes(scene.interiorExterior) ? scene.interiorExterior : 'INT',
      timeOfDay: String(scene.timeOfDay || '').slice(0, 80),
      location: String(scene.location || '').slice(0, 160),
      characters: sanitizeList(scene.characters, 12, 80),
      action: String(scene.action || '').slice(0, 5000),
      dialogue: (Array.isArray(scene.dialogue) ? scene.dialogue : []).slice(0, 80).map((line) => ({ character: String(line.character || '').slice(0, 80), line: String(line.line || '').slice(0, 1000) })),
      productionNotes: String(scene.productionNotes || '').slice(0, 2000),
    }));
    episode.generatedAt = new Date();
    project.markModified('episodes');
    await project.save();
    res.json({ episode });
  } catch (error) {
    res.status(500).json({ message: error.message === 'TOKEN_EXHAUSTED' || error.message.includes('积分余额不足') ? '积分余额不足，请充值后再生成' : '生成单集剧本失败', error: error.message });
  }
});

module.exports = router;
