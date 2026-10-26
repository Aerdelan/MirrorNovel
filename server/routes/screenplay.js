const express = require('express');
const fs = require('fs');
const os = require('os');
const http = require('http');
const net = require('net');
const router = express.Router();
const auth = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const generationRateLimit = createRateLimiter({ windowMs: 60 * 1000, max: 60, keyFn: (req) => req.userId || req.ip });
const Screenplay = require('../models/Screenplay');
const Novel = require('../models/Novel');
const WritingPersona = require('../models/WritingPersona');
const { streamGenerate: generateText, resolveApiConfig, countTokens } = require('../services/aiService');
const { creativeOperation, runCreativeLease, getCreativeSignal, isCreativeBusy, isScreenplayBusy, assertCreativeLease } = require('../services/creativeLease');
const { redactError } = require('../services/generationError');
const streamGenerate = async (...args) => { args[3] ||= getCreativeSignal(); await assertCreativeLease(); const result = await generateText(...args).catch(error => { error.message = redactError(error.message); throw error; }); await assertCreativeLease(); return result; };
const { callUsageStats } = require('../services/tokenUsage');
const { prepareReferenceContext, buildReferencePrompt } = require('../services/referenceContext');
const { beginTask, updateTask, completeTask, failTask, getLatestTask } = require('../services/generationTaskService');
const {
  MAX_SCREENPLAY_OUTPUT_TOKENS,
  DEFAULT_SCREENPLAY_GENERATION,
  normalizeScreenplayGeneration,
  getScreenplayOutputTokens,
} = require('../config/screenplayGeneration');
const SysConfig = require('../models/SysConfig');
const { normalizeImageGeneration } = require('../config/imageGeneration');
const { chooseImageModel, generateImage } = require('../services/imageService');
const { sceneEditSnapshot, validateSceneEdit } = require('../services/screenplaySceneEdit');

const MAX_SCREENPLAY_DURATION_SECONDS = 86400;
const SCREENPLAY_GENERATION_CONFIG_KEY = 'screenplay_generation';
const IMAGE_GENERATION_CONFIG_KEY = 'image_generation';
const activeBatchWorkers = new Map();
const activeEpisodeWorkers = new Map();

router.get('/image-config', auth, async (req, res) => {
  try {
    const stored = await SysConfig.findOne({ key: IMAGE_GENERATION_CONFIG_KEY }).lean();
    const config = normalizeImageGeneration(stored?.value);
    res.json({ minIntervalMs: config.minIntervalMs, models: config.models.map((model) => ({ id: model.id, alias: model.alias, configured: Boolean(model.baseUrl && model.model && model.apiKey) })) });
  } catch (error) { res.status(500).json({ message: '读取生图配置失败', error: redactError(error.message) }); }
});

function parseJsonObject(value) {
  const cleaned = String(value || '').replace(/^\uFEFF/, '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  // 修复1：模型偶发的"值缺左引号"（如 "pressure":确保事故发生" ——值以文字开头、
  // 引号结尾）。只在直接解析失败后尝试；排除 数字/true/false/null/对象/数组。
  try {
    let repaired = cleaned.replace(/:\s*([^"\d{\[\s][^"\n]*")/g, ': "$1');
    // 修复2：值内部未转义的英文引号（"turn": "陈工提到"今天很重要"" 之类），
    // 按 "键": "值" 形态逐行转义值中段的引号。
    repaired = repaired.split('\n').map((line) => {
      const m = line.match(/^(\s*"[^"]+"\s*:\s*")(.*)(",?\s*)$/);
      if (m) return m[1] + m[2].replace(/"/g, '\\"') + m[3];
      return line;
    }).join('\n');
    return JSON.parse(repaired);
  } catch {}
  // Locate a balanced JSON object instead of using a greedy regex. This keeps
  // valid responses usable when the provider adds a short preface/suffix.
  for (let start = 0; start < cleaned.length; start += 1) {
    if (cleaned[start] !== '{') continue;
    let depth = 0; let inString = false; let escaped = false;
    for (let index = start; index < cleaned.length; index += 1) {
      const char = cleaned[index];
      if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
      if (char === '"') { inString = true; continue; }
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(cleaned.slice(start, index + 1).replace(/,\s*([}\]])/g, '$1'));
            // Return any valid object here. Each endpoint performs its own
            // shape validation (screen scenes, bible/episodes, or concept
            // expansion), so a shared parser must not reject legitimate
            // payloads merely because their field set differs.
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              // A truncated screenplay's inner scene object may itself be
              // balanced; leave it for the scene-array recovery pass below.
              && !(parsed.sceneNumber !== undefined && !Array.isArray(parsed.scenes))) return parsed;
          } catch { /* Continue scanning for the enclosing response object. */ }
          break;
        }
      }
    }
  }
  // A long script can be cut off at the provider's output ceiling. Recover
  // complete scene objects already emitted before the truncation so the user
  // can continue/retry instead of losing the entire response.
  const sceneStart = cleaned.indexOf('"scenes"');
  const arrayStart = sceneStart >= 0 ? cleaned.indexOf('[', sceneStart) : -1;
  if (arrayStart >= 0) {
    const scenes = [];
    for (let index = arrayStart + 1; index < cleaned.length; index += 1) {
      if (cleaned[index] !== '{') continue;
      let depth = 0; let inString = false; let escaped = false;
      for (let end = index; end < cleaned.length; end += 1) {
        const char = cleaned[end];
        if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
        if (char === '"') { inString = true; continue; }
        if (char === '{') depth += 1;
        else if (char === '}') {
          depth -= 1;
          if (depth === 0) {
            try { scenes.push(JSON.parse(cleaned.slice(index, end + 1).replace(/,\s*([}\]])/g, '$1'))); } catch {}
            index = end;
            break;
          }
        }
      }
    }
    if (scenes.length) return { scenes, partial: true };
  }
  return null;
}

function normalizeDevelopmentPayload(value) {
  if (!value || typeof value !== 'object') return null;
  const queue = [{ value, depth: 0 }];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    const candidate = current.value;
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate) || current.depth > 3) continue;
    seen.add(candidate);
    const bible = candidate.bible || candidate.storyBible || candidate.screenplayBible;
    const episodes = candidate.episodes || candidate.episodeOutlines || candidate.outlines || candidate.episode_outline;
    if (bible && typeof bible === 'object' && Array.isArray(episodes)) return { bible, episodes };
    Object.values(candidate).forEach((child) => {
      if (child && typeof child === 'object') queue.push({ value: child, depth: current.depth + 1 });
    });
  }
  return null;
}

function sanitizeList(value, limit, itemLimit) {
  return (Array.isArray(value) ? value : []).slice(0, limit).map((item) => String(item || '').trim().slice(0, itemLimit)).filter(Boolean);
}

function normalizeBlueprintItems(value, limit = 24) {
  return (Array.isArray(value) ? value : []).slice(0, limit).map((item) => {
    if (typeof item === 'string') return item.trim().slice(0, 1000);
    if (!item || typeof item !== 'object') return null;
    return Object.fromEntries(Object.entries(item).slice(0, 12).map(([key, entry]) => [
      String(key).slice(0, 60), typeof entry === 'object'
        ? JSON.stringify(entry).slice(0, 1200)
        : String(entry ?? '').slice(0, 1200),
    ]));
  }).filter(Boolean);
}

function normalizeConceptExpansion(value) {
  if (!value || typeof value !== 'object') return null;
  const text = (entry, max = 1800) => String(entry || '').trim().slice(0, max);
  return {
    premise: text(value.premise, 1800),
    mainline: text(value.mainline, 6000),
    characters: normalizeBlueprintItems(value.characters, 30),
    locations: normalizeBlueprintItems(value.locations, 24),
    subplots: normalizeBlueprintItems(value.subplots, 24),
    foreshadowing: normalizeBlueprintItems(value.foreshadowing, 30),
    episodeBeats: normalizeBlueprintItems(value.episodeBeats, 120),
    details: normalizeBlueprintItems(value.details, 30),
  };
}

function conceptExpansionText(expansion) {
  return expansion ? JSON.stringify(expansion) : '';
}

function getScriptRequirements(durationSeconds, generationConfig = DEFAULT_SCREENPLAY_GENERATION) {
  const duration = Math.max(30, Math.min(MAX_SCREENPLAY_DURATION_SECONDS, Number(durationSeconds) || 120));
  // A short-drama script needs enough visual beats to cover its runtime. The
  // limits are deliberately bounded so a malformed duration cannot create an
  // unbounded prompt or database document.
  const sceneCount = Math.max(4, Math.min(2000, Math.ceil(duration / 45)));
  const dialogueLineCount = Math.max(18, Math.min(14000, Math.ceil(duration / 7)));
  const actionChars = Math.max(1200, Math.min(700000, Math.ceil(duration * 10)));
  const outputTokens = getScreenplayOutputTokens(duration, generationConfig);
  return { duration, sceneCount, dialogueLineCount, actionChars, outputTokens };
}

function assessScreenplayQuality(scenes, requirements) {
  const list = Array.isArray(scenes) ? scenes : [];
  const dialogueLineCount = list.reduce((sum, scene) => sum + (Array.isArray(scene.dialogue) ? scene.dialogue.length : 0), 0);
  const actionChars = list.reduce((sum, scene) => sum + String(scene.action || '').length, 0);
  const dialogueLines = list.flatMap((scene) => Array.isArray(scene.dialogue) ? scene.dialogue : []);
  const metadataComplete = dialogueLines.filter((line) => (
    String(line.character || '').trim() && String(line.line || '').trim()
    && String(line.delivery || '').trim() && String(line.physicalAction || '').trim()
    && String(line.position || '').trim()
  )).length;
  const executionComplete = list.filter((scene) => (
    String(scene.objective || '').trim()
    && String(scene.obstacle || '').trim()
    && String(scene.result || '').trim()
    && String(scene.shotPlan || '').trim()
    && String(scene.soundDesign || '').trim()
  )).length;
  const coverage = {
    scenes: list.length >= Math.ceil(requirements.sceneCount * 0.7),
    dialogue: dialogueLineCount >= Math.ceil(requirements.dialogueLineCount * 0.65),
    action: actionChars >= Math.ceil(requirements.actionChars * 0.55),
    dialogueMetadata: dialogueLines.length === 0 || metadataComplete >= Math.ceil(dialogueLines.length * 0.7),
    sceneExecution: list.length === 0 || executionComplete >= Math.ceil(list.length * 0.7),
  };
  const issues = [];
  if (!coverage.scenes) issues.push(`场次数量不足，当前 ${list.length} 场，目标约 ${requirements.sceneCount} 场`);
  if (!coverage.dialogue) issues.push(`对白密度不足，当前 ${dialogueLineCount} 条，目标至少 ${requirements.dialogueLineCount} 条`);
  if (!coverage.action) issues.push(`动作/空间描写不足，当前 ${actionChars} 字，目标至少 ${requirements.actionChars} 字`);
  if (!coverage.dialogueMetadata) issues.push(`对白缺少语气、神态、姿势或站位信息，完整率 ${metadataComplete}/${dialogueLines.length}`);
  if (!coverage.sceneExecution) issues.push(`场次缺少目标、阻力、结果或镜头/声音执行信息，完整率 ${executionComplete}/${list.length}`);
  return { sceneCount: list.length, dialogueLineCount, actionChars, coverage, issues, metadataComplete, executionComplete };
}

function episodeNeedsRepair(episode) {
  const report = episode?.generationReport || {};
  return Boolean(
    report.status === 'failed'
    || report.status === 'generating'
    || report.status === 'partial'
    || (episode?.scenes?.length && (
      report.coverage?.scenes === false
      || report.coverage?.dialogue === false
      || report.coverage?.action === false
      || report.coverage?.dialogueMetadata === false
      || report.coverage?.sceneExecution === false
      || report.issues?.length
    ))
  );
}

function episodeIsUnfinished(episode) {
  return !Array.isArray(episode?.scenes) || episode.scenes.length === 0 || ['failed', 'generating'].includes(episode?.generationReport?.status);
}

function compactScreenplayBible(bible) {
  const source = bible && typeof bible === 'object' ? bible : {};
  return {
    logline: String(source.logline || '').slice(0, 800),
    genre: String(source.genre || '').slice(0, 160),
    visualTone: String(source.visualTone || '').slice(0, 1000),
    adaptationBoundary: String(source.adaptationBoundary || '').slice(0, 1200),
    characters: (Array.isArray(source.characters) ? source.characters : []).slice(0, 20).map((item) => ({
      name: String(item?.name || '').slice(0, 80),
      visual: String(item?.visual || '').slice(0, 500),
      objective: String(item?.objective || '').slice(0, 500),
      relationship: String(item?.relationship || '').slice(0, 500),
      continuity: String(item?.continuity || '').slice(0, 500),
    })),
    locations: (Array.isArray(source.locations) ? source.locations : []).slice(0, 20).map((item) => ({
      name: String(item?.name || '').slice(0, 80),
      visual: String(item?.visual || '').slice(0, 700),
      storyFunction: String(item?.storyFunction || '').slice(0, 500),
      continuity: String(item?.continuity || '').slice(0, 500),
    })),
    continuityRules: sanitizeList(source.continuityRules, 30, 500),
    characterArcs: normalizeBlueprintItems(source.characterArcs, 30),
    subplots: normalizeBlueprintItems(source.subplots, 30),
    foreshadowing: normalizeBlueprintItems(source.foreshadowing, 40),
    styleRules: sanitizeList(source.styleRules, 30, 500),
  };
}

// 剧本不能只满足“字段完整”，还要有属于本项目的说话方式和不规整的生活质感。
// 这里把类型、视觉气质和圣经中的风格规则转成生成阶段的写作契约，避免所有项目
// 都被同一套“漂亮、完整、解释充分”的模型腔覆盖。
function buildScreenplayStyleDirective(bible, productionTarget = 'video') {
  const source = bible && typeof bible === 'object' ? bible : {};
  const genre = String(source.genre || '').toLowerCase();
  const tone = String(source.visualTone || '').slice(0, 700);
  const rules = sanitizeList(source.styleRules, 12, 240);
  let genreRule = '以人物处境和关系为中心，语言克制，避免所有人都用同一种句式。';
  if (/悬疑|推理|犯罪|惊悚|灵异/.test(genre)) genreRule = '悬疑靠不完整信息、犹豫、错认和行动后果推进；对白允许绕开问题、答非所问和突然停住，不要把谜底解释给观众。';
  else if (/言情|爱情|情感|甜/.test(genre)) genreRule = '情感靠关系中的分寸、误会和未说出口的选择推进；对白不要句句表白，允许试探、嘴硬、改口和生活化打岔。';
  else if (/喜剧|喜|搞笑/.test(genre)) genreRule = '笑点来自人物目标冲突和尴尬后果；允许接话失败、误解和不合时宜的停顿，不写整齐的段子。';
  else if (/古装|历史|权谋/.test(genre)) genreRule = '保留时代身份和礼法差异，但不要人人出口成章；不同阶层使用不同称谓、句长和回避方式。';
  else if (/科幻|末世|灾难/.test(genre)) genreRule = '让设定通过操作、故障、资源和选择显现；少用宏大抒情，多写可验证的细节和不完整的判断。';
  else if (/动作|战争|热血|玄幻|仙侠/.test(genre)) genreRule = '冲突通过身体代价、环境阻力和选择推进；动作句可短促，人物疲惫或犹豫时不要强行写成宣言。';
  return `【本项目独有的文风契约】
类型倾向：${genreRule}
视觉气质只作为可见线索使用：${tone || '由场景事实决定，不要反复形容氛围'}
${rules.length ? `圣经规则：${rules.join('；')}` : ''}
1. 禁止把动作写成连续的精致比喻、金句或情绪总结；优先使用具体但不完美的动词、物件和反应。
2. 旁白允许有粗粝、停顿、重复、未完成句和信息缺口，但不能故意制造错字或病句。
3. 每个主要人物必须有可辨识的句长、词汇、回避方式和情绪外露程度；不要让所有人都“低声、缓缓、目光深邃”。
4. 对白首先像人在当下说话，其次才是交代剧情；可以打断、改口、答非所问，但每次偏离都要有关系或信息上的作用。
5. 镜头、声音和制作说明只写执行信息，不写广告文案或文学化赞美。${productionTarget === 'live_action' ? '实拍优先考虑演员能完成的细小动作和现场声音。' : '视频生成优先考虑单一可视动作、明确构图和可识别的运动变化。'}`;
}

// 人格必须独立于剧本圣经存在。圣经负责“写什么”，人格负责“怎么写”；
// 分场和动作扩写都直接携带该快照，避免圣经生成不完整时回退到统一剧本腔。
function buildScreenplayPersonaDirective(persona) {
  if (!persona || typeof persona !== 'object') return '';
  const blocks = [
    persona.name ? `名称：${String(persona.name).slice(0, 100)}` : '',
    persona.voice ? `作者声线：${String(persona.voice).slice(0, 1800)}` : '',
    persona.tone ? `语气与节奏：${String(persona.tone).slice(0, 1400)}` : '',
    persona.rules ? `写作规则：${String(persona.rules).slice(0, 2600)}` : '',
    persona.vocab ? `用词偏好：${String(persona.vocab).slice(0, 1200)}` : '',
    persona.styleAxes ? `风格轴：${Object.entries(persona.styleAxes).filter(([, value]) => value).map(([key, value]) => `${key}：${String(value).slice(0, 300)}`).join('；')}` : '',
  ].filter(Boolean);
  if (!blocks.length) return '';
  return `【本项目锁定的写作人格】\n${blocks.join('\n')}\n人格优先级高于默认剧本腔和通用“电影感”措辞。必须把它落实到叙述视角、句长、对白长度、停顿、动作取舍和人物反应；不要把所有人物写成同一个作者。${persona.overrideDeslop ? '\n该人格自带去AI化规则，优先遵循其写作规则，不得另套统一去AI模板。' : ''}`;
}

function compactPreviousEpisodeContext(episode) {
  if (!episode) return '这是第一集。';
  const scenes = (Array.isArray(episode.scenes) ? episode.scenes : []).slice(-2).map((scene) => ({
    location: String(scene.location || '').slice(0, 160),
    timeOfDay: String(scene.timeOfDay || '').slice(0, 80),
    characters: sanitizeList(scene.characters, 12, 80),
    action: String(scene.action || '').slice(-1400),
    dialogue: (Array.isArray(scene.dialogue) ? scene.dialogue : []).slice(-8).map((line) => ({
      character: String(line.character || '').slice(0, 80),
      line: String(line.line || '').slice(0, 500),
      position: String(line.position || '').slice(0, 240),
    })),
  }));
  return JSON.stringify({ title: episode.title || '', cliffhanger: String(episode.cliffhanger || '').slice(0, 1200), endingScenes: scenes });
}

function compactEpisodeForRepair(episode) {
  const scenes = (Array.isArray(episode?.scenes) ? episode.scenes : []).slice(0, 80).map((scene, index) => ({
    sceneNumber: index + 1,
    heading: String(scene.heading || '').slice(0, 160),
    location: String(scene.location || '').slice(0, 160),
    action: String(scene.action || '').slice(0, 900),
    dialogue: (Array.isArray(scene.dialogue) ? scene.dialogue : []).slice(0, 8).map((line) => ({
      character: String(line.character || '').slice(0, 80),
      line: String(line.line || '').slice(0, 400),
      delivery: String(line.delivery || '').slice(0, 180),
      physicalAction: String(line.physicalAction || '').slice(0, 240),
      position: String(line.position || '').slice(0, 180),
    })),
  }));
  return JSON.stringify({ sceneCount: scenes.length, scenes });
}

async function expandScreenplaySceneAction({ apiConfig, scene, episode, minimumLength, persona }) {
  const personaDirective = buildScreenplayPersonaDirective(persona);
  const prompt = `把下方短剧场次的“动作与空间描写”扩写成 ${minimumLength} 到 ${minimumLength + 180} 个汉字的可拍摄正文。只写扩写后的动作与空间描写，不要标题、JSON、对白或解释。必须补足空间布局、人物初始位置与走位、视线关系、道具、光线/声音和动作造成的可见后果；不得改变人物、地点、时段和剧情事实。\n\n${personaDirective}\n\n【本集】${episode.episodeNumber} ${episode.title || ''}\n【场次】${JSON.stringify({ heading: scene.heading, interiorExterior: scene.interiorExterior, timeOfDay: scene.timeOfDay, location: scene.location, characters: scene.characters, existingAction: scene.action })}`;
  const result = await streamGenerate(
    `你是影视剧本动作指导。只交付具体、连续、可拍摄的动作与空间描写，不写对白，不复述要求。${personaDirective ? `\n${personaDirective}` : ''}`,
    prompt,
    null,
    null,
    apiConfig,
    1,
    0.45,
    1800,
    2 * 60 * 1000,
  );
  return String(result.content || '').replace(/```[\s\S]*?```/g, '').trim();
}

async function generateScreenplaySceneSegment({ apiConfig, bible, persona, previousContext, episode, productionRule, startNumber, count, perSceneDialogue, perSceneAction, precedingScene }) {
  const styleDirective = buildScreenplayStyleDirective(bible);
  const personaDirective = buildScreenplayPersonaDirective(persona);
  const blueprint = JSON.stringify({ emotionalArc: episode.emotionalArc, characterBeats: episode.characterBeats, subplotBeats: episode.subplotBeats, setupPayoff: episode.setupPayoff, scenePlan: episode.scenePlan, continuityState: episode.continuityState });
  const continuation = precedingScene ? JSON.stringify({
    location: precedingScene.location,
    characters: precedingScene.characters,
    action: String(precedingScene.action || '').slice(-900),
    dialogue: (precedingScene.dialogue || []).slice(-4).map((line) => ({ character: line.character, line: line.line, position: line.position })),
  }) : previousContext;
  const endNumber = startNumber + count - 1;
  const prompt = `请写连续短剧第${episode.episodeNumber}集的第${startNumber}-${endNumber}场。只写这 ${count} 个场次，不要提前写后续场次。\n\n${personaDirective}\n\n${styleDirective}\n\n【压缩剧本圣经】${JSON.stringify(bible)}\n【前序衔接】${continuation}\n【本集大纲】${JSON.stringify({ title: episode.title, premise: episode.premise, conflict: episode.conflict, turn: episode.turn, cliffhanger: episode.cliffhanger })}\n【本集分集蓝图】${blueprint}\n【制作方式】${productionRule}\n\n每个场次必须有可拍摄的空间布局、人物初始位置、走位、道具、光线声音和动作后果。每场严格写 ${perSceneDialogue} 至 ${perSceneDialogue + 1} 条完整对白，每条对白必须有 character、line、delivery、physicalAction、position，必要时有 subtext。每场 action 写 ${perSceneAction} 至 ${perSceneAction + 180} 个汉字。每场还必须填写 objective、obstacle、result、shotPlan、soundDesign，使场次推进人物弧线、支线或伏笔。动作和对白都必须推进本集冲突，不能用概述、同上或省略；不要额外增加重复对白或过长独白。\n\n只输出 JSON：{"scenes":[{"sceneNumber":${startNumber},"heading":"场次标题","interiorExterior":"INT","timeOfDay":"时间","location":"地点","characters":["人物"],"objective":"人物想得到什么","obstacle":"什么阻碍","result":"场内变化和离场状态","action":"不少于 ${perSceneAction} 字的动作与空间描写","dialogue":[{"character":"人物","line":"完整对白","delivery":"语气与节奏","physicalAction":"神态动作","position":"站位和距离","subtext":"潜台词"}],"productionNotes":"镜头与转场","shotPlan":"景别、机位、主体动作与转场","soundDesign":"现场声、音乐和静音节点"}]}`;
  const promptWithBlueprint = `${prompt}\n\n【本集分集蓝图】${blueprint}\n每个场次必须填写 objective、obstacle、result、shotPlan、soundDesign，使场次推进人物弧线、支线或伏笔。`;
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await streamGenerate(
      `你是连续短剧的分场编剧。必须交付足量、完整、可执行的场景 JSON；不允许把场景压缩成梗概。${personaDirective}\n${styleDirective}`,
      attempt ? `${promptWithBlueprint}\n\n【重试】上次场次数量、动作篇幅或对白元数据不达标。请完整重写这 ${count} 场并严格满足所有数字约束。` : promptWithBlueprint,
      null,
      null,
      apiConfig,
      1,
      0.6,
      // Keep each request close to the actual scene budget. This prevents a
      // provider from expanding a single scene into an unnecessary essay.
      Math.min(6000, Math.max(3000, count * 2500)),
      10 * 60 * 1000,
    );
    const parsed = parseJsonObject(result.content);
    const scenes = normalizeScenes(parsed?.scenes || []).slice(0, count);
    for (const scene of scenes) {
      if (scene.action.length >= perSceneAction) continue;
      const expandedAction = await expandScreenplaySceneAction({ apiConfig, scene, episode, minimumLength: perSceneAction, persona });
      if (expandedAction.length > scene.action.length) scene.action = expandedAction.slice(0, 5000);
    }
    const dialogueCount = scenes.reduce((sum, scene) => sum + scene.dialogue.length, 0);
    const actionCount = scenes.reduce((sum, scene) => sum + scene.action.length, 0);
    const metadataCount = scenes.reduce((sum, scene) => sum + scene.dialogue.filter((line) => line.character && line.line && line.delivery && line.physicalAction && line.position).length, 0);
    const executionCount = scenes.filter((scene) => scene.objective && scene.obstacle && scene.result && scene.shotPlan && scene.soundDesign).length;
    const expectedDialogue = count * perSceneDialogue;
    const expectedAction = count * perSceneAction;
    if (scenes.length === count && dialogueCount >= expectedDialogue && actionCount >= expectedAction && metadataCount >= expectedDialogue && executionCount === count) {
      return scenes.map((scene, index) => ({ ...scene, sceneNumber: startNumber + index }));
    }
    lastError = `第${startNumber}-${endNumber}场不完整：${scenes.length}/${count}场，${dialogueCount}/${expectedDialogue}条对白，${actionCount}/${expectedAction}字动作，${executionCount}/${count}场执行字段`;
  }
  throw new Error(lastError || `第${startNumber}-${endNumber}场生成失败`);
}

function normalizeScenes(scenes) {
  return (Array.isArray(scenes) ? scenes : []).map((scene, index) => ({
    sceneNumber: index + 1,
    heading: String(scene.heading || `场${index + 1}`).slice(0, 160),
    interiorExterior: ['INT', 'EXT', 'INT_EXT'].includes(scene.interiorExterior) ? scene.interiorExterior : 'INT',
    timeOfDay: String(scene.timeOfDay || '').slice(0, 80),
    location: String(scene.location || '').slice(0, 160),
    characters: sanitizeList(scene.characters, 12, 80),
    action: String(scene.action || '').slice(0, 5000),
    objective: String(scene.objective || '').slice(0, 500),
    obstacle: String(scene.obstacle || '').slice(0, 500),
    result: String(scene.result || '').slice(0, 500),
    dialogue: (Array.isArray(scene.dialogue) ? scene.dialogue : []).slice(0, 120).map((line) => ({
      character: String(line.character || '').slice(0, 80),
      line: String(line.line || '').slice(0, 1600),
      delivery: String(line.delivery || '').slice(0, 500),
      physicalAction: String(line.physicalAction || '').slice(0, 800),
      position: String(line.position || '').slice(0, 500),
      subtext: String(line.subtext || '').slice(0, 600),
    })),
    productionNotes: String(scene.productionNotes || '').slice(0, 2000),
    shotPlan: String(scene.shotPlan || '').slice(0, 2000),
    soundDesign: String(scene.soundDesign || '').slice(0, 1200),
    imagePlan: scene.imagePlan && typeof scene.imagePlan === 'object' ? {
      prompt: String(scene.imagePlan.prompt || scene.imagePlan.imagePrompt || '').slice(0, 6000),
      size: String(scene.imagePlan.size || '').slice(0, 20),
      count: Math.max(1, Math.min(4, Number(scene.imagePlan.count || scene.imagePlan.n) || 1)),
    } : {},
  }));
}

// 模型重写时偶尔会保留正文，却遗漏结构化执行字段。修复模式下可从
// 已确认的分集蓝图和制作说明补齐这些字段，避免同一问题反复提示。
function fillRepairExecutionFields(scenes, episode, productionRule) {
  const plans = Array.isArray(episode?.scenePlan) ? episode.scenePlan : [];
  return scenes.map((scene, index) => {
    const plan = plans[index] || {};
    const action = String(scene.action || '').trim();
    const notes = String(scene.productionNotes || '').trim();
    return {
      ...scene,
      objective: scene.objective || String(plan.objective || plan.purpose || episode?.premise || '推动本集冲突并改变人物处境').slice(0, 500),
      obstacle: scene.obstacle || String(plan.obstacle || episode?.conflict || '现场条件与人物目标发生阻力').slice(0, 500),
      result: scene.result || String(plan.exitState || plan.turn || episode?.turn || '场景结束时留下新的行动后果').slice(0, 500),
      shotPlan: scene.shotPlan || notes || `以可见动作和人物位置变化呈现本场转折；${productionRule}`.slice(0, 2000),
      soundDesign: scene.soundDesign || '保留现场环境声，并用关键动作声或停顿强调本场变化。',
      action: action || scene.action,
    };
  });
}

async function loadScreenplayGenerationConfig() {
  try {
    const SysConfig = require('../models/SysConfig');
    const stored = await SysConfig.findOne({ key: SCREENPLAY_GENERATION_CONFIG_KEY }).lean();
    return normalizeScreenplayGeneration(stored?.value);
  } catch (error) {
    console.warn('[Screenplay] 无法读取动态 token 配置，使用默认值:', error.message);
    return DEFAULT_SCREENPLAY_GENERATION;
  }
}

async function loadImageGenerationConfig() {
  try {
    const stored = await SysConfig.findOne({ key: IMAGE_GENERATION_CONFIG_KEY }).lean();
    return normalizeImageGeneration(stored?.value);
  } catch (error) {
    console.warn('[Screenplay] 无法读取生图配置，使用默认值:', error.message);
    return normalizeImageGeneration();
  }
}

function normalizeImageOptions(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const enabled = Boolean(source.enabled);
  const options = {
    enabled,
    modelId: String(source.modelId || 'image_1').slice(0, 40),
    characterPortraits: Boolean(source.characterPortraits),
    relationshipChart: Boolean(source.relationshipChart),
    transitionBoards: Boolean(source.transitionBoards),
    assets: Array.isArray(source.assets) ? source.assets.slice(-200) : [],
    status: enabled ? 'queued' : 'idle',
    lastError: '',
  };
  if (!enabled) {
    options.characterPortraits = false;
    options.relationshipChart = false;
    options.transitionBoards = false;
    options.status = 'idle';
  }
  return options;
}

function imageHost(baseUrl) {
  try { return new URL(baseUrl).host; } catch { return ''; }
}

// 图片代理白名单判断：只代理公网 http/https 图片，一律拒绝内网/环回地址
// （防 SSRF）。不能用“主机必须等于生图线路所配主机”做白名单——中转型生图
// 服务常见“API 在域名、文件在源站 IP”的组合，按线路主机匹配会误伤正常图片。
function isInternalImageUrlHost(hostname) {
  const value = String(hostname || '').toLowerCase();
  if (!value || value === 'localhost' || value.endsWith('.local') || value === '::1') return true;
  const ipVersion = net.isIP(value);
  if (ipVersion === 6) {
    // loopback, unspecified, link-local, unique-local and IPv4-mapped private
    // addresses must not be reachable through the image proxy.
    if (value === '::' || value === '::1' || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('fc') || value.startsWith('fd')) return true;
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isInternalImageUrlHost(mapped[1]);
    return false;
  }
  const match = value.match(/^(\d{1,3})(?:\.(\d{1,3}))?(?:\.(\d{1,3}))?(?:\.(\d{1,3}))?$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2] ?? 0);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isProxyableImageUrl(target) {
  let parsed;
  try { parsed = new URL(String(target || '')); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  return !isInternalImageUrlHost(parsed.hostname);
}

async function persistImageState(project) {
  const patch = {};
  for (const [key, value] of Object.entries(project.imageGeneration || {})) {
    if (key !== 'assets') patch[`imageGeneration.${key}`] = value;
  }
  const result = await Screenplay.updateOne({ _id: project._id, userId: project.userId }, { $set: patch });
  if (!result.matchedCount) throw new Error('剧本项目已不存在');
}

async function appendImageAsset(project, asset) {
  const current = project.imageGeneration && typeof project.imageGeneration === 'object'
    ? project.imageGeneration
    : normalizeImageOptions({ enabled: true });
  const saved = await Screenplay.findOneAndUpdate(
    { _id: project._id, userId: project.userId },
    { $push: { 'imageGeneration.assets': { $each: [asset], $slice: -200 } } },
    { new: true },
  ).select('imageGeneration');
  if (!saved) throw new Error('剧本项目已不存在');
  current.assets = saved.imageGeneration.assets;
  project.imageGeneration = current;
}

// 生图模型不会自动记住前一集的画面。将剧本圣经中的外观与不可变事实
// 作为“视觉锁定卡”重复注入每次场景请求，避免同一人物跨集换脸、换装或
// 改变关键道具。只带入当前场景人物，控制提示词长度。
function characterVisualAnchors(bible, names = []) {
  const characters = Array.isArray(bible?.characters) ? bible.characters : [];
  const wanted = new Set((Array.isArray(names) ? names : []).map((name) => String(name || '').trim()).filter(Boolean));
  const matched = wanted.size ? characters.filter((item) => wanted.has(String(item?.name || '').trim())) : characters;
  const selected = (matched.length ? matched : characters).slice(0, 20);
  if (!selected.length) return '未提供角色视觉卡；不得擅自添加与剧本不符的人物外观。';
  return selected.map((item) => {
    const name = String(item?.name || '人物').slice(0, 80);
    const visual = String(item?.visual || '').slice(0, 700);
    const continuity = String(item?.continuity || '').slice(0, 500);
    return `【${name}】外观：${visual || '按剧本圣经既定外观'}；连续性事实：${continuity || '本剧后续保持外观、年龄段、发型、服装主色和关键道具一致'}`;
  }).join('\n');
}

async function generateProjectImageAssets(project, req, scope = 'bible', scenes = [], episodeNumber = null) {
  const options = normalizeImageOptions(project.imageGeneration);
  if (!options.enabled) return;
  const config = await loadImageGenerationConfig();
  const imageModel = chooseImageModel(config, options.modelId);
  if (!imageModel?.baseUrl || !imageModel?.apiKey) {
    project.imageGeneration = { ...options, status: 'failed', lastError: '已开启生图，但所选生图线路尚未配置完整' };
    await persistImageState(project);
    return;
  }
  project.imageGeneration = { ...options, status: 'running', lastError: '' };
  await persistImageState(project);
  const bible = project.screenplayBible || {};
  const jobs = [];
  if (scope === 'bible' && options.characterPortraits && Array.isArray(bible.characters) && bible.characters.length) {
    // 每个角色单独请求，避免 n=4 时模型在同一批次内混淆身份、发型和服装。
    for (const character of bible.characters.slice(0, 4)) {
      const name = String(character?.name || '人物').slice(0, 80);
      jobs.push({
        type: 'character_portrait',
        label: `人物画像：${name}`,
        characterName: name,
        prompt: `连续短剧角色视觉锁定卡。只生成【${name}】一名角色的半身人物设定画像，写实影视概念设计，正面与三分之二侧面特征清晰，固定发型、脸部特征、年龄段、服装主色和关键道具；后续所有集必须严格复用这张视觉设定，不得换脸、换年龄、换发型或改变服装主色。不要其他人物、可读文字、水印。\n${characterVisualAnchors(bible, [name])}`,
        size: '1024x1024',
        n: 1,
      });
    }
  }
  if (scope === 'bible' && options.relationshipChart && Array.isArray(bible.characters) && bible.characters.length) {
    const relationships = bible.characters.slice(0, 12).map((item) => `${item.name || '人物'}：${item.relationship || ''}`).join('；');
    jobs.push({ type: 'relationship_chart', label: '人物关系图', prompt: `连续短剧人物关系视觉图。以清晰的节点、连线、箭头和视觉符号表达关系，不生成可读文字标签，不添加无关人物。人物：${relationships}`, size: '1024x1024', n: 1 });
  }
  if (scope === 'bible' && options.transitionBoards && Array.isArray(bible.locations)) {
    for (const location of bible.locations.slice(0, 40)) {
      jobs.push({ type: 'scene_board', label: `场景空间：${location.name || '场景'}`, prompt: `连续短剧场景空间设定图：${location.name || ''}。${location.visual || ''}。展示完整空间布局、出入口、主要道具、光线层次和可供人物站位的区域，不生成文字、水印或人物。`, size: project.productionTarget === 'video' ? '1280x720' : '1152x768', n: 1, locationName: location.name });
    }
  }
  if (scope === 'episodes' && options.transitionBoards) {
    for (const scene of (Array.isArray(scenes) ? scenes : []).slice(0, 200)) {
      const plan = scene.imagePlan && typeof scene.imagePlan === 'object' ? scene.imagePlan : {};
      const size = ['720x1280', '1280x720', '768x1152', '1152x768', '1024x1024'].includes(plan.size)
        ? plan.size
        : (project.productionTarget === 'video' ? '1280x720' : '1152x768');
      jobs.push({
        type: 'transition_board',
        label: `第${scene.sceneNumber || '?'}场转场画面`,
        prompt: `${String(plan.prompt || `连续短剧场景转场画面：${scene.heading || scene.location || ''}。${scene.action || ''}。突出人物站位、空间布局、光线和下一动作的视觉关系，不生成文字。`).slice(0, 5000)}\n\n【角色视觉锁定卡，必须严格遵守】\n${characterVisualAnchors(bible, scene.characters)}\n不得自行改变上述人物的脸型、发型、年龄段、服装主色、体态或关键道具；同一人物在所有集保持一致。`,
        size,
        n: Math.max(1, Math.min(4, Number(plan.count) || 1)),
        sceneNumber: scene.sceneNumber,
        episodeNumber,
      });
    }
  }
  for (const job of jobs) {
    // 修复 P4：生图上游偶发"图片转存失败"等瞬时错误——同一任务自动重试 2 次（退避 4s/8s），
    // 成功或最终失败后保存视觉资产及其状态。
    let result = null;
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 4000));
        result = await generateImage({ model: imageModel, prompt: job.prompt, size: job.size, n: job.n, minIntervalMs: config.minIntervalMs });
        lastError = '';
        break;
      } catch (error) {
        lastError = error.message;
        console.warn(`[Screenplay] 生图任务 ${job.label} 第 ${attempt + 1} 次失败: ${error.message}`);
      }
    }
    if (result) {
      try {
        await appendImageAsset(project, { type: job.type, label: job.label, characterName: job.characterName || '', episodeNumber: job.episodeNumber || null, sceneNumber: job.sceneNumber || null, locationName: job.locationName || '', size: result.size, n: job.n, urls: result.urls, prompt: job.prompt, modelId: imageModel.id, status: 'completed', createdAt: new Date() });
        await persistImageState(project);
      } catch (error) {
        await appendImageAsset(project, { type: job.type, label: job.label, characterName: job.characterName || '', episodeNumber: job.episodeNumber || null, sceneNumber: job.sceneNumber || null, locationName: job.locationName || '', size: job.size, n: job.n, urls: result.urls, prompt: job.prompt, modelId: imageModel.id, status: 'failed', error: `保存失败：${error.message}`, createdAt: new Date() });
        project.imageGeneration = { ...project.imageGeneration, status: 'partial', lastError: error.message };
        await persistImageState(project);
      }
    } else {
      await appendImageAsset(project, { type: job.type, label: job.label, characterName: job.characterName || '', episodeNumber: job.episodeNumber || null, sceneNumber: job.sceneNumber || null, locationName: job.locationName || '', size: job.size, n: job.n, urls: [], prompt: job.prompt, modelId: imageModel.id, status: 'failed', error: `${lastError}（已重试 3 次）`, createdAt: new Date() });
      project.imageGeneration = { ...project.imageGeneration, status: 'partial', lastError: lastError };
      await persistImageState(project);
    }
  }
  const status = (project.imageGeneration.assets || []).some((asset) => asset.status === 'failed') ? 'partial' : 'completed';
  project.imageGeneration = { ...project.imageGeneration, status, lastError: status === 'completed' ? '' : project.imageGeneration.lastError };
  await persistImageState(project);
}

// 图片代理：生图服务商常返回 http:// 图片地址，站点切到 https 后浏览器会按
// “混合内容”拦截，导致整套视觉资产加载失败；且 img 标签无法携带鉴权头。
// 统一经本接口同源代理（token 走查询参数），前端 img 直接可用。
router.get('/image-proxy', auth, async (req, res) => {
  try {
    const target = String(req.query.url || '');
    if (!isProxyableImageUrl(target)) {
      return res.status(403).json({ message: '仅允许代理公网 http/https 图片地址' });
    }
    const config = await loadImageGenerationConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    // 若生图服务的文件接口要求鉴权，附带所配线路的密钥回源
    const targetHost = imageHost(target);
    const sourceModel = (Array.isArray(config.models) ? config.models : [])
      .find((model) => imageHost(model.baseUrl) === targetHost);
    const upstreamHeaders = { Accept: 'image/*' };
    if (sourceModel?.apiKey) upstreamHeaders.Authorization = `Bearer ${require('../services/secretBox').open(sourceModel.apiKey)}`;
    let upstream;
    try {
      let currentUrl = target;
      for (let hop = 0; hop < 3; hop += 1) {
        if (!isProxyableImageUrl(currentUrl)) throw new Error('重定向目标不是公网图片地址');
        const addresses = await require('dns').promises.lookup(new URL(currentUrl).hostname, { all: true });
        if (!addresses.length || addresses.some(item => isInternalImageUrlHost(item.address))) throw new Error('图片域名指向内部网络');
        upstream = await fetch(currentUrl, { signal: controller.signal, headers: new URL(currentUrl).origin === new URL(target).origin ? upstreamHeaders : { Accept: 'image/*' }, redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
        const location = upstream.headers.get('location');
        if (!location) throw new Error('图片源重定向缺少目标');
        currentUrl = new URL(location, currentUrl).toString();
      }
      if ([301, 302, 303, 307, 308].includes(upstream?.status)) throw new Error('图片源重定向次数过多');
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) {
      console.warn(`[Screenplay][image-proxy] 上游 ${targetHost} 返回 ${upstream.status}：${target.slice(0, 120)}`);
      return res.status(502).json({ message: `图片源返回 ${upstream.status}` });
    }
    const contentType = String(upstream.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.startsWith('image/')) return res.status(415).json({ message: '图片源返回的不是图片' });
    const contentLength = Number(upstream.headers.get('content-length') || 0);
    if (contentLength > 15 * 1024 * 1024) return res.status(413).json({ message: '图片文件过大' });
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length > 15 * 1024 * 1024) return res.status(413).json({ message: '图片文件过大' });
    res.setHeader('Content-Type', contentType || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(body);
  } catch (error) {
    res.status(502).json({ message: '图片代理失败', error: redactError(error.message) });
  }
});

// Retry one failed visual asset without rerunning the text generation.
router.post('/projects/:id/image-assets/:assetIndex/retry', auth, async (req, res) => {
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    const index = Number(req.params.assetIndex);
    const assets = Array.isArray(project.imageGeneration?.assets) ? project.imageGeneration.assets : [];
    const asset = assets[index];
    if (!asset) return res.status(404).json({ message: '视觉资产不存在' });
    if (asset.status !== 'failed') return res.status(400).json({ message: '该视觉资产无需重试' });
    const config = await loadImageGenerationConfig();
    const model = chooseImageModel(config, asset.modelId || project.imageGeneration?.modelId);
    const result = await generateImage({ model, prompt: asset.prompt, size: asset.size, n: asset.n || asset.urls?.length || 1, minIntervalMs: config.minIntervalMs });
    const replacement = { ...asset.toObject?.() || asset, urls: result.urls, size: result.size, status: 'completed', error: '', retriedAt: new Date() };
    const saved = await Screenplay.findOneAndUpdate(
      { _id: project._id, userId: req.userId, [`imageGeneration.assets.${index}.status`]: 'failed', [`imageGeneration.assets.${index}.createdAt`]: asset.createdAt },
      { $set: { [`imageGeneration.assets.${index}`]: replacement } }, { new: true },
    );
    if (!saved) return res.status(409).json({ message: '视觉资产已更新，请刷新后重试' });
    saved.imageGeneration.lastError = '';
    if (saved.imageGeneration.status !== 'running') saved.imageGeneration.status = saved.imageGeneration.assets.some(item => item.status === 'failed') ? 'partial' : 'completed';
    await persistImageState(saved);
    res.json({ project: saved });
  } catch (error) {
    res.status(502).json({ message: '图片重试失败', error: redactError(error.message) });
  }
});

async function recordScreenplayUsage(req, input, output, modelType, referenceId, idempotencyKey = '', usage = null) {
  const stats = callUsageStats({ usage, inputTokens: countTokens(input), tokenCount: countTokens(output) });
  if (referenceId) await Screenplay.updateOne({ _id: referenceId, userId: req.userId }, { $inc: {
    'tokenUsage.inputTokens': stats.inputTokens, 'tokenUsage.outputTokens': stats.outputTokens,
    'tokenUsage.cacheSavedTokens': stats.cacheSavedTokens, 'tokenUsage.calls': 1,
  } });
  return { usage: stats };
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function safeFileName(value) {
  return String(value || '剧本').replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
}

// Episode generation can run alongside progress polling or a resumed batch
// worker. Updating the whole Screenplay document with save() makes Mongoose's
// array version check reject otherwise independent episode updates. Replace
// only the targeted array element so concurrent episodes do not conflict or
// overwrite one another.
async function persistScreenplayEpisode(project, episodeNumber, episode) {
  await assertCreativeLease();
  const payload = typeof episode?.toObject === 'function' ? episode.toObject({ depopulate: true }) : { ...episode };
  const result = await Screenplay.updateOne(
    { _id: project._id, userId: project.userId, 'episodes.episodeNumber': Number(episodeNumber) },
    { $set: { 'episodes.$[episode]': payload } },
    { arrayFilters: [{ 'episode.episodeNumber': Number(episodeNumber) }] },
  );
  if (!result.matchedCount) throw new Error('剧本项目或分集已不存在');
  return payload;
}

function requestScreenplayEpisode({ projectId, episodeNumber, authorization, modelHeader, mode, timeoutMs = 25 * 60 * 1000 }) {
  const payload = JSON.stringify({ mode });
  const port = Number(process.env.PORT || 3000);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: `/api/screenplay/projects/${projectId}/episodes/${episodeNumber}/generate`,
      method: 'POST',
      headers: {
        Authorization: authorization || '',
        ...(modelHeader ? { 'x-mn-model-config': modelHeader } : {}),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: response.statusCode || 500, ok: (response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300, body, text });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('单集生成超时')));
    request.once('error', reject);
    request.end(payload);
  });
}

// 批量 worker 的单集 HTTP 超时必须覆盖逐场生成的最坏耗时：sceneCount>10 时
// 每场独立调用且每场最长 10 分钟，固定 25 分钟会在长集上提前掐断请求——
// worker 随后重试，而服务端 handler 仍在跑，造成同集并发重复生成、重复扣费。
async function estimateEpisodeRequestTimeoutMs(projectId, userId, episodeNumber) {
  try {
    const project = await Screenplay.findOne({ _id: projectId, userId }).select('episodeDurationSeconds episodes').lean();
    const episode = (project?.episodes || []).find((item) => item.episodeNumber === Number(episodeNumber));
    const requirements = getScriptRequirements(
      Number(episode?.durationSeconds) || Number(project?.episodeDurationSeconds) || 120,
      await loadScreenplayGenerationConfig()
    );
    if (requirements.sceneCount > 10) {
      return requirements.sceneCount * 10 * 60 * 1000 + 10 * 60 * 1000;
    }
    return Math.max(25 * 60 * 1000, requirements.sceneCount * 10 * 60 * 1000);
  } catch {
    return 25 * 60 * 1000;
  }
}

// 请求超时不代表服务端已停止：单集 handler 仍持有锁继续生成并最终落库。
// 轮询等待其结果（completed 视为成功），而不是盲目重试——重试只会 409，
// 还会把实际已完成的集误标为失败。
async function waitForEpisodeOutcome({ projectId, userId, episodeNumber, maxWaitMs }) {
  const pollIntervalMs = 30 * 1000;
  const deadline = Date.now() + Math.max(pollIntervalMs, Number(maxWaitMs) || 0);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    try {
      const project = await Screenplay.findOne({ _id: projectId, userId })
        .select('episodes.episodeNumber episodes.generationReport')
        .lean();
      const episode = (project?.episodes || []).find((item) => item.episodeNumber === Number(episodeNumber));
      const status = episode?.generationReport?.status;
      if (status === 'completed') return true;
      if (status === 'partial' || status === 'failed') return false;
    } catch {}
  }
  return false;
}

async function runScreenplayBatchWorker(task, authorization, modelHeader) {
  if (!task?._id) return;
  try { return await runCreativeLease({ userId: task.userId, key: 'screenplay:' + task.resourceId + ':batch', kind: 'screenplay_batch' }, async () => {
  const taskId = String(task?._id || '');
  if (!taskId || activeBatchWorkers.has(taskId)) return;
  activeBatchWorkers.set(taskId, true);
  try {
    const numbers = Array.isArray(task.metadata?.episodeNumbers) ? task.metadata.episodeNumbers : [];
    const mode = task.metadata?.mode === 'quality_repair' ? 'quality_repair' : 'generate';
    for (const episodeNumber of numbers) {
      const current = await getLatestTask({ userId: task.userId, resourceId: task.resourceId, kind: 'screenplay_batch' });
      if (!current || current.cancellationRequested || current.status === 'paused') break;
      const completed = current.metadata?.completedEpisodes || [];
      const failed = current.metadata?.failedEpisodes || [];
      if (completed.includes(episodeNumber) || failed.includes(episodeNumber)) continue;
      await updateTask(current._id, { status: 'running', stage: 'episode_start', progress: `正在生成第 ${episodeNumber} 集`, currentUnit: completed.length + failed.length, metadata: { ...current.metadata, currentEpisode: episodeNumber } });
      let success = false;
      let failureReason = '';
      const episodeTimeoutMs = await estimateEpisodeRequestTimeoutMs(current.resourceId, task.userId, episodeNumber);
      try {
        for (let attempt = 0; attempt < 3 && !success; attempt += 1) {
          try {
            const response = await requestScreenplayEpisode({ projectId: current.resourceId, episodeNumber, authorization, modelHeader, mode, timeoutMs: episodeTimeoutMs });
            const responsePayload = response.body;
            failureReason = responsePayload?.message || responsePayload?.error || response.text.slice(0, 500) || `HTTP ${response.status}`;
            if (response.ok) {
              const report = responsePayload?.episode?.generationReport || {};
              const qualityPassed = report.status !== 'partial' && !(report.issues || []).length;
              if (mode !== 'quality_repair' || qualityPassed) {
                success = true;
                break;
              }
              failureReason = report.lastError || '修复后仍有质量问题';
            }
            if (response.status === 409 && /正在生成|后台生成/.test(failureReason)) {
              await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 5000));
              continue;
            }
            if (response.status < 500 && response.status !== 429) break;
          } catch (error) {
            failureReason = error.name === 'AbortError' ? '单集生成超时' : error.message || '批量请求失败';
            if (error.name === 'AbortError' || /超时/.test(failureReason)) {
              // 服务端可能仍在生成并最终落库，先轮询对账再决定是否重试
              const reconciled = await waitForEpisodeOutcome({
                projectId: current.resourceId,
                userId: task.userId,
                episodeNumber,
                maxWaitMs: episodeTimeoutMs,
              });
              if (reconciled) {
                success = true;
                break;
              }
            }
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 2000));
          }
        }
        if (!success) console.warn(`[ScreenplayBatch] 第${episodeNumber}集生成失败: ${failureReason}`);
      } catch (error) {
        failureReason = error.message || '批量请求失败';
        console.warn(`[ScreenplayBatch] 第${episodeNumber}集请求失败:`, failureReason);
      }
      const latest = await getLatestTask({ userId: task.userId, resourceId: task.resourceId, kind: 'screenplay_batch' });
      if (!latest) break;
      const completedEpisodes = [...new Set([...(latest.metadata?.completedEpisodes || []), ...(success ? [episodeNumber] : [])])];
      const failedEpisodes = [...new Set([...(latest.metadata?.failedEpisodes || []), ...(!success ? [episodeNumber] : [])])];
      const failedDetails = [...(latest.metadata?.failedDetails || [])].filter((item) => Number(item?.episodeNumber) !== episodeNumber);
      if (!success) failedDetails.push({ episodeNumber, error: String(failureReason || '生成失败').slice(0, 1000) });
      if (latest.cancellationRequested || latest.status === 'paused') {
        await updateTask(latest._id, { status: 'paused', progress: '已保存当前集，批量生成已暂停', metadata: { ...latest.metadata, completedEpisodes, failedEpisodes, failedDetails, currentEpisode: episodeNumber } });
        break;
      }
      const done = completedEpisodes.length + failedEpisodes.length >= numbers.length;
      if (done) {
        await completeTask(latest._id, { progress: `批量生成完成：成功 ${completedEpisodes.length} 集，失败 ${failedEpisodes.length} 集`, currentUnit: numbers.length, metadata: { ...latest.metadata, mode, completedEpisodes, failedEpisodes, failedDetails, currentEpisode: episodeNumber } });
      } else {
        await updateTask(latest._id, { status: 'running', stage: success ? 'episode_saved' : 'episode_failed', progress: `已处理 ${completedEpisodes.length + failedEpisodes.length}/${numbers.length} 集`, currentUnit: completedEpisodes.length + failedEpisodes.length, metadata: { ...latest.metadata, mode, completedEpisodes, failedEpisodes, failedDetails, currentEpisode: episodeNumber } });
      }
    }
  } catch (error) {
    await failTask(taskId, error.message);
  } finally {
    activeBatchWorkers.delete(taskId);
  }
  }); }
  catch (error) { if (error.code !== 'GENERATION_LEASE_BUSY') await failTask(task._id, redactError(error.message)); }
}

function screenplayText(project) {
  const bible = project.screenplayBible || {};
  let output = `${project.title}\n${'='.repeat(60)}\n来源：${project.sourceType === 'adaptation' ? '小说改编' : '原创短剧'}\n交付方式：${project.productionTarget === 'video' ? '视频生成' : '实拍制作'}\n\n`;
  output += `【剧本圣经】\n一句话故事：${bible.logline || ''}\n类型：${bible.genre || ''}\n视觉气质：${bible.visualTone || ''}\n改编边界：${bible.adaptationBoundary || ''}\n`;
  for (const character of bible.characters || []) output += `\n角色：${character.name || ''}\n外观与气质：${character.visual || ''}\n目标与关系：${character.objective || ''}；${character.relationship || ''}\n连续性：${character.continuity || ''}\n`;
  for (const location of bible.locations || []) output += `\n场景：${location.name || ''}\n空间：${location.visual || ''}\n功能：${location.storyFunction || ''}\n连续性：${location.continuity || ''}\n`;
  if (Array.isArray(bible.continuityRules) && bible.continuityRules.length) output += `\n连续性规则：\n${bible.continuityRules.map((item) => `- ${item}`).join('\n')}\n`;
  for (const arc of bible.characterArcs || []) output += `\n人物弧线：${arc.character || arc.name || ''}\n起点：${arc.startState || arc.start || ''}\n转折：${arc.turningPoints || arc.turn || ''}\n终点：${arc.endState || arc.end || ''}\n`;
  for (const subplot of bible.subplots || []) output += `\n支线：${subplot.name || subplot.subplot || ''}\n作用：${subplot.purpose || ''}\n推进：${subplot.beats || subplot.progression || ''}\n`;
  for (const hook of bible.foreshadowing || []) output += `\n伏笔${hook.id || ''}：${hook.setup || ''}\n回收：${hook.payoff || ''}；目标集：${hook.targetEpisodes || ''}\n`;
  for (const episode of project.episodes || []) {
    output += `\n\n${'='.repeat(60)}\n第${episode.episodeNumber}集 ${episode.title || ''}（${episode.durationSeconds || 0}秒）\n${'='.repeat(60)}\n开场：${episode.premise || ''}\n冲突：${episode.conflict || ''}\n转折：${episode.turn || ''}\n结尾钩子：${episode.cliffhanger || ''}\n`;
    if (episode.emotionalArc) output += `情绪曲线：${episode.emotionalArc}\n`;
    if (episode.continuityState) output += `连续性状态：${episode.continuityState}\n`;
    for (const scene of episode.scenes || []) {
      output += `\n${scene.sceneNumber}. ${scene.interiorExterior || ''} · ${scene.timeOfDay || ''} · ${scene.location || ''}\n人物：${(scene.characters || []).join('、')}\n动作与空间：${scene.action || ''}\n`;
      if (scene.objective || scene.obstacle || scene.result) output += `目标：${scene.objective || ''}\n阻力：${scene.obstacle || ''}\n结果：${scene.result || ''}\n`;
      for (const line of scene.dialogue || []) {
        output += `${line.character || ''}：${line.line || ''}`;
        const notes = [line.delivery, line.physicalAction, line.position, line.subtext ? `潜台词：${line.subtext}` : ''].filter(Boolean);
        if (notes.length) output += `（${notes.join('；')}）`;
        output += '\n';
      }
      if (scene.productionNotes) output += `制作备注：${scene.productionNotes}\n`;
      if (scene.shotPlan) output += `镜头计划：${scene.shotPlan}\n`;
      if (scene.soundDesign) output += `声音设计：${scene.soundDesign}\n`;
    }
  }
  return output;
}

function screenplayMarkdown(project) {
  const bible = project.screenplayBible || {};
  let output = `# ${project.title}\n\n- 来源：${project.sourceType === 'adaptation' ? '小说改编' : '原创短剧'}\n- 交付方式：${project.productionTarget === 'video' ? '视频生成' : '实拍制作'}\n\n## 剧本圣经\n\n**一句话故事：** ${bible.logline || ''}\n\n**类型：** ${bible.genre || ''}\n\n**视觉气质：** ${bible.visualTone || ''}\n\n`;
  if (bible.adaptationBoundary) output += `**改编边界：** ${bible.adaptationBoundary}\n\n`;
  if (bible.characters?.length) output += `### 角色连续性\n\n${bible.characters.map((c) => `- **${c.name || ''}**：${c.visual || ''}；目标：${c.objective || ''}；关系：${c.relationship || ''}；连续性：${c.continuity || ''}`).join('\n')}\n\n`;
  if (bible.locations?.length) output += `### 场景空间\n\n${bible.locations.map((l) => `- **${l.name || ''}**：${l.visual || ''}；功能：${l.storyFunction || ''}；连续性：${l.continuity || ''}`).join('\n')}\n\n`;
  if (bible.characterArcs?.length) output += `### 人物弧线\n\n${bible.characterArcs.map((a) => `- **${a.character || a.name || ''}**：${a.startState || a.start || ''} → ${a.endState || a.end || ''}；转折：${a.turningPoints || a.turn || ''}`).join('\n')}\n\n`;
  if (bible.subplots?.length) output += `### 支线规划\n\n${bible.subplots.map((s) => `- **${s.name || s.subplot || ''}**：${s.purpose || ''}；推进：${s.beats || s.progression || ''}`).join('\n')}\n\n`;
  if (bible.foreshadowing?.length) output += `### 伏笔与回收\n\n${bible.foreshadowing.map((f) => `- **${f.id || ''}**：${f.setup || ''}；回收：${f.payoff || ''}；目标集：${f.targetEpisodes || ''}`).join('\n')}\n\n`;
  for (const episode of project.episodes || []) {
    output += `## 第${episode.episodeNumber}集 ${episode.title || ''}\n\n**开场：** ${episode.premise || ''}\n\n**冲突：** ${episode.conflict || ''}\n\n**转折：** ${episode.turn || ''}\n\n**结尾钩子：** ${episode.cliffhanger || ''}\n\n`;
    if (episode.emotionalArc) output += `**情绪曲线：** ${episode.emotionalArc}\n\n`;
    if (episode.continuityState) output += `**连续性状态：** ${episode.continuityState}\n\n`;
    for (const scene of episode.scenes || []) {
      output += `### ${scene.sceneNumber}. ${scene.interiorExterior || ''} · ${scene.timeOfDay || ''} · ${scene.location || ''}\n\n${scene.action || ''}\n\n`;
      if (scene.objective || scene.obstacle || scene.result) output += `**目标：** ${scene.objective || ''}  **阻力：** ${scene.obstacle || ''}  **结果：** ${scene.result || ''}\n\n`;
      for (const line of scene.dialogue || []) output += `**${line.character || ''}：** ${line.line || ''}\n\n> ${[line.delivery, line.physicalAction, line.position, line.subtext ? `潜台词：${line.subtext}` : ''].filter(Boolean).join('；')}\n\n`;
      if (scene.productionNotes) output += `> 制作备注：${scene.productionNotes}\n\n`;
      if (scene.shotPlan) output += `> 镜头计划：${scene.shotPlan}\n\n`;
      if (scene.soundDesign) output += `> 声音设计：${scene.soundDesign}\n\n`;
    }
  }
  return output;
}

function screenplayHtml(project, viewState = {}) {
  const bible = project.screenplayBible || {};
  const bibleOpen = viewState.bibleCollapsed !== true;
  const episodesOpen = viewState.episodesCollapsed !== true;
  const collapsedEpisodes = new Set(Array.isArray(viewState.collapsedEpisodes) ? viewState.collapsedEpisodes.map(Number) : []);
  const sourceLabel = project.sourceType === 'adaptation' ? '小说改编' : '原创短剧';
  const targetLabel = project.productionTarget === 'video' ? '视频生成' : '实拍制作';
  const renderFact = (label, value) => value ? `<div class="fact-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>` : '';
  const renderBibleItems = (title, items, renderItem) => {
    const rendered = !items?.length ? '' : `<div class="bible-block"><h3>${escapeHtml(title)}</h3>${items.map(renderItem).join('')}</div>`;
    return rendered || (title === '场景空间' ? renderBiblePlanning() : '');
  };
  const renderCharacter = (item) => `<div class="bible-item"><div class="bible-item-head"><strong>${escapeHtml(item.name)}</strong></div><div class="bible-item-visual">${escapeHtml(item.visual)}</div><div class="bible-item-meta">${escapeHtml([item.objective, item.relationship].filter(Boolean).join(' · '))}</div><div class="bible-item-continuity">${escapeHtml(item.continuity)}</div></div>`;
  const renderLocation = (item) => `<div class="bible-item"><div class="bible-item-head"><strong>${escapeHtml(item.name)}</strong></div><div class="bible-item-visual">${escapeHtml(item.visual)}</div><div class="bible-item-meta">${escapeHtml(item.storyFunction)}</div><div class="bible-item-continuity">${escapeHtml(item.continuity)}</div></div>`;
  const visualAssets = Array.isArray(project.imageGeneration?.assets) ? project.imageGeneration.assets : [];
  const renderAsset = (asset) => {
    if (!asset || asset.status === 'failed' || !Array.isArray(asset.urls) || !asset.urls.length) return '';
    return `<div class="image-asset-card"><div class="image-asset-title">${escapeHtml(asset.label || '视觉资产')} · ${escapeHtml(asset.size || '')}</div><div class="image-asset-grid">${asset.urls.map((url) => `<img src="${escapeHtml(url)}" alt="${escapeHtml(asset.label || '视觉资产')}" loading="lazy">`).join('')}</div></div>`;
  };
  const renderAssetsBlock = (assets, title = '配套视觉资产') => {
    const rendered = (assets || []).map(renderAsset).join('');
    return rendered ? `<div class="bible-block image-assets-block"><h3>${escapeHtml(title)}</h3><div class="image-assets-grid">${rendered}</div></div>` : '';
  };
  const renderDialogue = (line) => `<div class="dialogue"><strong class="dialogue-character">${escapeHtml(line.character)}</strong><span class="dialogue-line"><span>${escapeHtml(line.line)}</span>${[line.delivery, line.physicalAction, line.position].filter(Boolean).length ? `<small>${escapeHtml([line.delivery, line.physicalAction, line.position].filter(Boolean).join('；'))}</small>` : ''}${line.subtext ? `<em>潜台词：${escapeHtml(line.subtext)}</em>` : ''}</span></div>`;
  const renderScene = (scene, episodeNumber = null) => { const sceneAssets = visualAssets.filter((asset) => asset.type === 'transition_board' && (asset.episodeNumber == null || Number(asset.episodeNumber) === Number(episodeNumber)) && Number(asset.sceneNumber) === Number(scene.sceneNumber)); return `<article class="scene"><div class="scene-heading">${escapeHtml(`${scene.sceneNumber}. ${scene.interiorExterior || ''} · ${scene.timeOfDay || ''} · ${scene.location || ''}`)}</div><div class="scene-characters">${escapeHtml((scene.characters || []).join('、'))}</div>${[scene.objective, scene.obstacle, scene.result].some(Boolean) ? `<div class="scene-facts">${renderFact('目标', scene.objective)}${renderFact('阻力', scene.obstacle)}${renderFact('结果', scene.result)}</div>` : ''}<p class="scene-action">${escapeHtml(scene.action)}</p>${scene.dialogue?.length ? `<div class="dialogue-list">${scene.dialogue.map(renderDialogue).join('')}</div>` : ''}${renderAssetsBlock(sceneAssets, '转场站位图')}${scene.productionNotes ? `<div class="scene-notes">${escapeHtml(scene.productionNotes)}</div>` : ''}${scene.shotPlan ? `<div class="scene-notes">镜头：${escapeHtml(scene.shotPlan)}</div>` : ''}${scene.soundDesign ? `<div class="scene-notes">声音：${escapeHtml(scene.soundDesign)}</div>` : ''}</article>`; };
  const renderBlueprintList = (label, items, formatter = (item) => item) => {
    if (!Array.isArray(items) || !items.length) return '';
    return '<div class="fact-row"><span>' + escapeHtml(label) + '</span><strong>'
      + items.map((item) => escapeHtml(formatter(item))).join('；')
      + '</strong></div>';
  };
  const renderBiblePlanning = () => [
    renderBibleItems('人物弧线', bible.characterArcs, (item) => '<div class="bible-item"><div class="bible-item-visual">'
      + escapeHtml(typeof item === 'string' ? item : Object.values(item || {}).join(' · ')) + '</div></div>'),
    renderBibleItems('支线规划', bible.subplots, (item) => '<div class="bible-item"><div class="bible-item-visual">'
      + escapeHtml(typeof item === 'string' ? item : Object.values(item || {}).join(' · ')) + '</div></div>'),
    renderBibleItems('伏笔与回收', bible.foreshadowing, (item) => '<div class="bible-item"><div class="bible-item-visual">'
      + escapeHtml(typeof item === 'string' ? item : Object.values(item || {}).join(' · ')) + '</div></div>'),
    renderBibleItems('风格规则', bible.styleRules, (item) => '<div class="bible-item"><div class="bible-item-visual">'
      + escapeHtml(item) + '</div></div>'),
  ].join('');
  const renderEpisode = (episode) => {
    const report = episode.generationReport || {};
    const reportItems = [];
    if (report.status === 'generating') reportItems.push('后台仍在生成，请稍后刷新查看');
    if (report.status === 'failed') reportItems.push(`上次生成未完成：${report.lastError || '请重试'}`);
    if (report.status === 'partial') reportItems.push('仅恢复了部分场景，建议重生成补全');
    if (report.sceneCount || report.dialogueLineCount || report.actionChars) reportItems.push(`已生成 ${report.sceneCount || 0} 场`, `${report.dialogueLineCount || 0} 条对白`, `${report.actionChars || 0} 字动作/空间描写`);
    if (Array.isArray(report.issues)) reportItems.push(...report.issues);
    const open = !collapsedEpisodes.has(Number(episode.episodeNumber));
    return `<details class="card episode-card"${open ? ' open' : ''}><summary class="episode-header"><div class="episode-header-info"><span class="episode-no">第${escapeHtml(episode.episodeNumber)}集 · ${escapeHtml(episode.durationSeconds)}秒</span><h3>${escapeHtml(episode.title)}</h3></div></summary><div class="episode-body"><p class="episode-premise">${escapeHtml(episode.premise)}</p><div class="episode-facts">${renderFact('冲突', episode.conflict)}${renderFact('转折', episode.turn)}${renderFact('钩子', episode.cliffhanger)}${renderBlueprint(episode)}</div>${reportItems.length ? `<div class="generation-report">${reportItems.map((item) => `<span class="${/不足|失败|警告|生成/.test(item) ? 'report-warning' : ''}">${escapeHtml(item)}</span>`).join('')}</div>` : ''}${episode.scenes?.length ? `<div class="scenes">${episode.scenes.map((scene) => renderScene(scene, episode.episodeNumber)).join('')}</div>` : ''}</div></details>`;
  };
  const renderBlueprint = (episode) => [
    episode.emotionalArc ? `<div class="fact-row"><span>情绪曲线</span><strong>${escapeHtml(episode.emotionalArc)}</strong></div>` : '',
    episode.continuityState ? `<div class="fact-row"><span>连续性状态</span><strong>${escapeHtml(episode.continuityState)}</strong></div>` : '',
    renderBlueprintList('人物节拍', episode.characterBeats, (item) => typeof item === 'string' ? item : Object.values(item || {}).join('：')),
    renderBlueprintList('支线节拍', episode.subplotBeats, (item) => typeof item === 'string' ? item : Object.values(item || {}).join('：')),
    renderBlueprintList('伏笔节拍', episode.setupPayoff, (item) => typeof item === 'string' ? item : Object.values(item || {}).join('：')),
    renderBlueprintList('场次计划', episode.scenePlan, (item) => typeof item === 'string' ? item : Object.values(item || {}).join('：')),
  ].join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(project.title)}</title><style>
:root{--primary:#3f7d5a;--primary-light:#eaf4ed;--warning:#c97824;--bg:#f3f7f2;--card:#fffdf9;--card-border:#dbe7dc;--text:#20352a;--text-secondary:#50645a;--text-light:#8a9b91;--bg-secondary:#e6efe7}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.6}.screenplay-page{width:min(100%,1180px);margin:0 auto;padding:0 clamp(16px,4vw,42px) 72px}.page-header{margin:0 calc(clamp(16px,4vw,42px)*-1) 18px;padding:14px clamp(16px,4vw,42px);background:rgba(255,253,249,.88);border-bottom:1px solid var(--card-border);font-weight:600}.project-topline{display:flex;align-items:flex-start;gap:12px;padding:18px 0}.project-topline-title{flex:1;min-width:0}.project-topline h1{margin:0 0 6px;font-size:20px}.project-topline p{margin:0;color:var(--text-secondary);font-size:13px}.card{background:var(--card);border:1px solid var(--card-border);border-radius:10px;padding:clamp(16px,2.4vw,24px);margin:0 0 16px;box-shadow:0 8px 24px rgba(35,63,45,.05)}.project-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-bottom:16px}.summary-item{display:grid;gap:4px}.summary-item span,.fact-row span,.episode-no{color:var(--text-light);font-size:12px}.summary-item strong,.fact-row strong{font-size:13px;font-weight:500;line-height:1.55}.section-heading,.episode-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.bible-card h2,.episode-list-heading h2{margin:0;font-size:20px}.bible-card summary,.episode-card summary{cursor:pointer;list-style:none}.bible-card summary::-webkit-details-marker,.episode-card summary::-webkit-details-marker{display:none}.bible-card summary:after,.episode-card summary:after{content:'＋';color:var(--primary);font-size:20px;line-height:1}.bible-card[open] summary:after,.episode-card[open] summary:after{content:'－'}.logline{font-size:14px;line-height:1.7;margin:14px 0;color:var(--text)}.fact-row{display:grid;grid-template-columns:80px 1fr;gap:8px;padding:8px 0;border-top:1px solid var(--card-border);align-items:start}.bible-block{margin-top:16px;border-top:1px solid var(--card-border);padding-top:14px}.bible-block h3{margin:0 0 10px;font-size:13px;color:var(--text-secondary)}.bible-item{padding:12px 0;border-bottom:1px solid var(--card-border)}.bible-item:last-child{border-bottom:0;padding-bottom:0}.bible-item:first-child{padding-top:0}.bible-item-head{margin-bottom:6px}.bible-item-head strong{font-size:14px}.bible-item-visual{font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:4px}.bible-item-meta{font-size:12px;color:var(--text-light);line-height:1.55;margin-bottom:4px}.bible-item-continuity{font-size:12px;color:var(--primary);line-height:1.55;padding-left:8px;border-left:2px solid var(--primary)}.episode-list{margin-top:16px}.episode-list-heading{margin:0 0 14px;align-items:center}.episode-card{margin-bottom:12px}.episode-header h3{margin:4px 0 0;font-size:15px}.episode-header-info{flex:1;min-width:0}.episode-body{margin-top:10px}.episode-premise{color:var(--text-secondary);font-size:13px;line-height:1.65;margin:10px 0}.episode-facts{display:grid;gap:8px;margin:10px 0 0;padding:10px 0 0;border-top:1px solid var(--card-border)}.episode-fact{display:grid;grid-template-columns:40px 1fr;gap:8px}.episode-fact span{color:var(--text-secondary);font-size:12px;line-height:1.55}.generation-report{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:10px;padding:8px 0;border-top:1px solid var(--card-border);color:var(--text-light);font-size:11px}.report-warning{color:var(--warning)}.scenes{border-top:1px solid var(--card-border);margin-top:12px;padding-top:10px}.scene{padding:12px 0;border-bottom:1px solid var(--card-border)}.scene:last-child{border-bottom:0;padding-bottom:0}.scene:first-child{padding-top:0}.scene-heading{color:var(--primary);font-size:12px;font-weight:600;line-height:1.5}.scene-characters{color:var(--text-light);font-size:12px;margin-top:4px}.scene-action{white-space:pre-wrap;color:var(--text-secondary);font-size:13px;line-height:1.72;margin:8px 0}.dialogue-list{margin:8px 0 0;padding-left:10px;border-left:2px solid var(--card-border)}.dialogue{display:grid;grid-template-columns:60px 1fr;gap:8px;padding:5px 0;font-size:13px;line-height:1.6}.dialogue-character{color:var(--primary);font-weight:600}.dialogue-line{color:var(--text)}.dialogue-line small,.dialogue-line em{display:block;margin-top:3px;color:var(--text-secondary);font-size:12px;line-height:1.55;font-style:normal}.dialogue-line em{color:var(--primary)}.scene-notes{margin-top:8px;padding:8px 10px;background:var(--bg-secondary);border-radius:6px;color:var(--text-light);font-size:12px;line-height:1.55}@media(max-width:640px){.screenplay-page{padding-left:12px;padding-right:12px}.page-header{margin-left:-12px;margin-right:-12px;padding-left:12px;padding-right:12px}.project-summary{grid-template-columns:1fr;gap:0}.project-summary .summary-item+ .summary-item{padding-top:12px;border-top:1px solid var(--card-border)}.fact-row{grid-template-columns:68px 1fr}.dialogue{grid-template-columns:52px 1fr}}
</style></head><body><main class="screenplay-page"><div class="page-header">AI剧本</div><div class="project-topline"><div class="project-topline-title"><h1>${escapeHtml(project.title)}</h1><p>${escapeHtml(sourceLabel)} · ${escapeHtml(targetLabel)} · ${escapeHtml(project.episodeCount || project.episodes?.length || 0)}集</p></div></div><section class="card project-summary"><div class="summary-item"><span>交付规范</span><strong>${escapeHtml(targetLabel === '视频生成' ? '镜头、画面重点与转场' : '布景、走位、道具与执行提示')}</strong></div>${project.sourceType === 'adaptation' ? `<div class="summary-item"><span>改编来源</span><strong>${escapeHtml(project.sourceSnapshot?.title || '已选小说')}</strong></div>` : ''}</section><details class="card bible-card"${bibleOpen ? ' open' : ''}><summary class="section-heading"><h2>剧本圣经</h2></summary><div class="bible-content"><p class="logline">${escapeHtml(bible.logline)}</p><div class="bible-facts">${renderFact('类型', bible.genre)}${renderFact('视觉气质', bible.visualTone)}${renderFact('改编边界', bible.adaptationBoundary)}</div>${renderBibleItems('角色连续性', bible.characters, renderCharacter)}${renderBibleItems('场景空间', bible.locations, renderLocation)}</div></details><section class="episode-list"><details class="episode-list-details"${episodesOpen ? ' open' : ''}><summary class="section-heading episode-list-heading"><h2>分集剧本</h2></summary><div class="episode-list-content">${(project.episodes || []).map(renderEpisode).join('')}</div></details></section></main></body></html>`;
}

async function sendDocx(project, res, fileName) {
  const { ZipArchive } = require('archiver');
  const archive = new ZipArchive();
  archive.pipe(res);
  const escXml = (value) => escapeHtml(value).replace(/&#39;/g, '&apos;');
  const paragraphs = screenplayText(project).split(/\n/).map((line) => `<w:p><w:r><w:t xml:space="preserve">${escXml(line)}</w:t></w:r></w:p>`).join('');
  archive.append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', { name: '[Content_Types].xml' });
  archive.append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', { name: '_rels/.rels' });
  archive.append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paragraphs + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>', { name: 'word/document.xml' });
  archive.finalize();
}

router.get('/projects', auth, async (req, res) => {
  try {
    const projects = await Screenplay.find({ userId: req.userId }).sort({ updatedAt: -1 }).lean();
    res.json(projects.map(screenplaySummary));
  } catch (error) {
    res.status(500).json({ message: '加载剧本项目失败', error: redactError(error.message) });
  }
});

router.get('/projects/:id', auth, async (req, res) => {
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    res.json(project);
  } catch (error) {
    res.status(500).json({ message: '加载剧本项目失败', error: redactError(error.message) });
  }
});

router.post('/projects/:id/export', auth, async (req, res) => {
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    const format = String(req.body?.format || '').toLowerCase();
    if (!['txt', 'md', 'html', 'docx'].includes(format)) return res.status(400).json({ message: '不支持的导出格式' });
    const fileName = `${safeFileName(project.title)}.${format}`;
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    if (format === 'txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(screenplayText(project));
    }
    if (format === 'md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      return res.send(screenplayMarkdown(project));
    }
    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(screenplayHtml(project, req.body?.viewState || {}));
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    await sendDocx(project, res, fileName);
  } catch (error) {
    console.error('[ScreenplayExport] 失败:', error);
    if (!res.headersSent) res.status(500).json({ message: '剧本导出失败', error: redactError(error.message) });
  }
});

router.delete('/projects/:id', auth, async (req, res) => {
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    if (project.imageGeneration?.status === 'running' || await isScreenplayBusy(project._id)) return res.status(409).json({ message: '请等待正在生成的剧本或视觉资产保存后再删除' });
    const result = await Screenplay.deleteOne({ _id: req.params.id, userId: req.userId });
    if (!result.deletedCount) return res.status(404).json({ message: '剧本项目不存在' });
    res.json({ message: '剧本项目已删除' });
  } catch (error) {
    res.status(500).json({ message: '删除剧本项目失败', error: redactError(error.message) });
  }
});

router.post('/projects', auth, async (req, res) => {
  try {
    const { title, sourceType, productionTarget, sourceNovelId, concept, conceptExpansion, includeMainlinePlanning, episodeCount, episodeDurationSeconds, personaId, imageGeneration } = req.body || {};
    if (!String(title || '').trim()) return res.status(400).json({ message: '请填写剧本名称' });
    if (!['adaptation', 'original'].includes(sourceType)) return res.status(400).json({ message: '请选择剧本来源' });
    if (!['video', 'live_action'].includes(productionTarget)) return res.status(400).json({ message: '请选择交付方式' });

    let sourceSnapshot = {};
    let writingPersona = null;
    if (personaId) {
      writingPersona = await WritingPersona.findOne({ _id: personaId, userId: req.userId }).lean();
      if (!writingPersona) return res.status(404).json({ message: '所选写作人格不存在' });
    }
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
        persona: writingPersona || novel.writingPersonaSnapshot || null,
        referenceStyleSnapshot: novel.referenceStyleSnapshot || [],
        structureReference: novel.structureReference || '',
      };
    }

    if ((req.body.referenceIds || []).length || req.body.structurePattern) Object.assign(sourceSnapshot, await prepareReferenceContext(req.userId, req.body));
    const project = await Screenplay.create({
      userId: req.userId,
      title: String(title).trim(),
      sourceType,
      productionTarget,
      sourceNovelId: sourceType === 'adaptation' ? sourceNovelId : null,
      sourceSnapshot,
      writingPersonaId: writingPersona?._id || null,
      writingPersonaSnapshot: writingPersona || (sourceSnapshot.persona || null),
      concept: String(concept || '').trim(),
      conceptExpansion: sourceType === 'original' ? normalizeConceptExpansion(conceptExpansion) : null,
      includeMainlinePlanning: sourceType === 'original' && Boolean(includeMainlinePlanning),
      episodeCount: Math.max(1, Math.min(120, Number(episodeCount) || 12)),
      episodeDurationSeconds: Math.max(30, Math.min(MAX_SCREENPLAY_DURATION_SECONDS, Number(episodeDurationSeconds) || 120)),
      imageGeneration: normalizeImageOptions(imageGeneration),
    });
    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ message: '创建剧本项目失败', error: redactError(error.message) });
  }
});

router.post('/projects/expand-concept', auth, async (req, res) => {
  try {
    const { concept, episodeCount, episodeDurationSeconds, personaId, includeMainlinePlanning } = req.body || {};
    const seed = String(concept || '').trim();
    if (seed.length < 8) return res.status(400).json({ message: '请先输入至少 8 个字的原创短剧思路' });
    let persona = null;
    if (personaId) {
      persona = await WritingPersona.findOne({ _id: personaId, userId: req.userId }).lean();
      if (!persona) return res.status(404).json({ message: '所选写作人格不存在' });
    }
    const count = Math.max(1, Math.min(120, Number(episodeCount) || 12));
    const duration = Math.max(30, Math.min(MAX_SCREENPLAY_DURATION_SECONDS, Number(episodeDurationSeconds) || 120));
    const personaDirective = buildScreenplayPersonaDirective(persona);
    const mainlineRule = includeMainlinePlanning
      ? '用户已勾选主线规划：必须给出有阶段、反转、代价和结局方向的主线，并让 episodeBeats 覆盖全部集数。'
      : '用户未勾选主线规划：mainline 必须为空，不替用户决定唯一主线或结局，只扩展可供选择的支线、人物、空间、伏笔和局部事件。';
    const prompt = `你是原创短剧开发编辑。请把用户提供的粗略想法扩展成可进入剧本圣经的结构化创作素材。${personaDirective}\n\n【用户原始想法】${seed}\n【集数】${count}集\n【单集时长】${duration}秒\n【主线开关】${mainlineRule}\n\n扩展要求：人物要有目标、关系、秘密和变化可能；支线要有参与人物、推进节点和与主线的连接方式；场景要写可拍摄的空间功能、动线和道具；伏笔要有埋设、误导、回收条件；details 补充冲突来源、日常质感和视觉/声音细节。不要套用固定类型模板，不要模仿具体作者，不要写违禁或露骨内容。只输出 JSON，不要 markdown：{"premise":"扩展后的一句话设定","mainline":"${includeMainlinePlanning ? '完整主线规划' : ''}","characters":[{"name":"人物","role":"身份","goal":"目标","secret":"秘密","relationship":"关系","arc":"变化可能"}],"locations":[{"name":"地点","function":"戏剧功能","layout":"空间布局与动线","props":"核心道具"}],"subplots":[{"name":"支线","characters":"涉及人物","beats":"推进节点","connection":"与主线连接或独立价值"}],"foreshadowing":[{"id":"F1","setup":"埋设","misdirection":"误导","payoff":"回收条件"}],"episodeBeats":[{"episodeNumber":1,"purpose":"本集任务","turn":"本集变化","hook":"结尾问题"}],"details":["可选细节"]}`;
    const result = await streamGenerate(`你是一位擅长原创短剧开发的结构编辑。${personaDirective}`, prompt, null, null, resolveApiConfig(req.userModelConfig, 'outline'), 2, 0.65, Math.min(24000, Math.max(7000, count * 500)), 10 * 60 * 1000);
    const parsed = parseJsonObject(result.content);
    if (!parsed || typeof parsed !== 'object') return res.status(502).json({ message: 'AI 扩展设定返回格式无效，请重试' });
    const expansion = normalizeConceptExpansion({ ...parsed, mainline: includeMainlinePlanning ? parsed.mainline : '' });
    if (!expansion || (!expansion.premise && !expansion.characters.length && !expansion.subplots.length)) return res.status(502).json({ message: 'AI 扩展设定内容为空，请重试' });
    await recordScreenplayUsage(req, prompt, result.content, 'outline', null, `screenplay-concept:${req.userId}:${Date.now()}`, result.usage);
    res.json({ expansion, sourceConcept: seed, includeMainlinePlanning: Boolean(includeMainlinePlanning) });
  } catch (error) {
    const rawMessage = String(error?.message || '');
    const insufficientPoints = rawMessage === 'TOKEN_EXHAUSTED' || rawMessage.includes('模型额度不足');
    const upstreamFailure = error?.isApiError || rawMessage === 'fetch failed' || /AI API 请求|线路尚未配置/.test(rawMessage);
    const message = insufficientPoints
      ? '模型额度不足，请检查所选线路'
      : upstreamFailure
        ? `AI 线路请求失败：${rawMessage || '请检查管理端线路配置和网络连接后重试'}`
        : '扩展原创设定失败';
    res.status(upstreamFailure ? 502 : 500).json({ message, error: rawMessage });
  }
});

router.post('/projects/:id/develop', auth, creativeOperation('screenplay_develop', async (req, res) => {
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    const persona = project.writingPersonaSnapshot || project.sourceSnapshot?.persona || null;
    const personaBlock = (persona ? `\n\n【用户选择的写作人格】名称：${String(persona.name || '自定义人格').slice(0, 100)}\n声线：${String(persona.voice || '').slice(0, 1800)}\n语气节奏：${String(persona.tone || '').slice(0, 1400)}\n规则：${String(persona.rules || '').slice(0, 2200)}\n用词：${String(persona.vocab || '').slice(0, 1000)}\n该人格优先于默认编剧腔，必须落实到人物对白、叙述节奏和动作取舍。` : '') + buildReferencePrompt(project.sourceSnapshot, { adaptation: project.sourceType === 'adaptation' });
    const source = project.sourceType === 'adaptation'
      ? `【改编小说】\n标题：${project.sourceSnapshot?.title || ''}\n大纲：${String(project.sourceSnapshot?.outline || '').slice(0, 10000)}\n世界观：${String(project.sourceSnapshot?.worldSetting || '').slice(0, 3500)}\n已写剧情摘要：${String(project.sourceSnapshot?.chapterSummaries || '').slice(-7000)}\n动态蓝图：${JSON.stringify(project.sourceSnapshot?.blueprint || {}).slice(0, 14000)}\n原作人格：${JSON.stringify(project.sourceSnapshot?.persona || {}).slice(0, 4000)}`
      : `【原创设定】\n${project.concept || '请先构建一个具有明确人物关系和连续冲突的短剧设定。'}${project.conceptExpansion ? `\n【AI扩展设定${project.includeMainlinePlanning ? '（含主线规划）' : '（未指定唯一主线）'}】\n${conceptExpansionText(project.conceptExpansion)}` : ''}`;
    const requirements = getScriptRequirements(project.episodeDurationSeconds, await loadScreenplayGenerationConfig());
    const productionRule = project.productionTarget === 'video'
      ? '交付给视频生成工具：场景必须可视化、单场地点明确，productionNotes 写镜头景别、主体动作、画面重点和转场，不写无法呈现的抽象说明。'
      : '交付给实拍团队：场景必须可执行，productionNotes 写布景重点、人物走位、必要道具和声音提示，避免无法拍摄的内容。';
    const prompt = `请作为连续短剧总编剧，为下列项目建立“剧本圣经”和${project.episodeCount}集分集蓝图。短剧要在有限时长内建立冲突、关系变化和悬念，不能只给一条主线梗概。每集都要有可执行的场次计划，明确人物目标、阻力、结果、支线推进、伏笔埋设/回收和情绪曲线。\n\n${source}\n\n【每集时长】约${project.episodeDurationSeconds}秒\n【制作方式】${productionRule}\n\n只输出 JSON，不要 markdown：\n{\n  "bible": {\n    "logline": "一句话故事",\n    "genre": "类型",\n    "visualTone": "可见的整体视觉气质",\n    "adaptationBoundary": "改编作品时必须保留/允许重排的边界；原创则写原创约束",\n    "characters": [{"name":"姓名","visual":"外貌、服装、年龄段、气质","objective":"本剧阶段目标","relationship":"关键关系","continuity":"不得前后改变的身份、物件或状态"}],\n    "locations": [{"name":"地点","visual":"空间布局、光线、色调和核心道具","storyFunction":"这个场景承载的冲突","continuity":"需要持续保持的空间事实"}],\n    "characterArcs": [{"character":"人物","startState":"开局状态","turningPoints":"关键变化节点","endState":"阶段终点","pressure":"主要压力来源"}],\n    "subplots": [{"name":"支线名称","characters":"涉及人物","purpose":"与主线的关系","beats":"在第几集如何推进/转折/结束"}],\n    "foreshadowing": [{"id":"F1","setup":"埋设内容","payoff":"回收方式","targetEpisodes":"目标集数","misdirection":"可接受的误导"}],\n    "continuityRules": ["跨集必须保持的事实"],\n    "styleRules": ["本剧独有的叙事和对白规则"]\n  },\n  "episodes": [{"episodeNumber":1,"title":"有信息量的章节标题","durationSeconds":${project.episodeDurationSeconds},"premise":"本集开场与目标","conflict":"核心冲突与对抗双方","turn":"本集反转及其前置依据","cliffhanger":"结尾钩子和下一集问题","emotionalArc":"情绪从何处到何处","characterBeats":[{"character":"人物","before":"本集前状态","choice":"关键选择","after":"本集后状态"}],"subplotBeats":[{"subplot":"支线","beat":"本集推进或暂缓方式"}],"setupPayoff":[{"type":"setup或payoff","foreshadowingId":"F1","detail":"具体内容"}],"scenePlan":[{"sceneNumber":1,"purpose":"场景戏剧目的","location":"地点","characters":["人物"],"objective":"人物想得到什么","obstacle":"什么阻碍","turn":"场内变化","exitState":"离场状态"}],"continuityState":"本集结束后人物、道具、地点和未解问题的状态"}]\n}`;
    // 思考模型（GLM/deepseek reasoning 线路）的思考 token 与正文共享
    // max_tokens：预算下限过低时思考会耗尽预算，正文为空或截断。
    // 32768 为思考（约 1 万 token）+ 完整圣经 JSON 留出余量。
    const outputTokens = Math.min(120000, Math.max(
      32768,
      requirements.outputTokens,
      Math.ceil(Number(project.episodeCount || 12) * 900)
    ));
    const systemPrompt = '你是一位重视人物动机、空间调度与跨集连续性的短剧总编剧。输出必须可直接进入剧本制作流程。';
    let parsed = null;
    let result = null;
    const styleReminder = `\n\n【风格差异要求】请为本项目建立独有的语言气质和人物声音。避免空泛的“高级、电影感、细腻、震撼”等形容词；不同人物使用不同句长、词汇、回避方式和情绪外露程度，允许生活化停顿、改口和答非所问。${personaBlock}`;
    // 修复 P5：开启生图时 imagePlan 从"可选"提为"必填"，避免模型跳过导致视觉资产失去规划
    const imagePlanningInstruction = (project.imageGeneration && project.imageGeneration.enabled)
      ? '\n\n【视觉资产规划（必填）】本项目已开启生图功能，必须额外返回 bible.imagePlan（含 portraitCount、portraitSize、relationshipCount、relationshipSize、notes），以及每集/场景的 imagePlan（含 prompt 与 size）。size 只能从 1024x1024、720x1280、1280x720、768x1152、1152x768 中选择，count 只能为 1-4。缺少 imagePlan 会被视为格式不合格。'
      : '';
    let requestPrompt = `${prompt}${styleReminder}${imagePlanningInstruction}`;
    // 一次性生成全部分集时，过大的返回预算更容易触发线路上下文上限或
    // 在末尾截断 JSON。首轮保留完整预算，后续格式重试主动收敛输出，
    // 用更紧凑的字段内容换取可解析的完整对象。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const attemptOutputTokens = attempt === 0
        ? outputTokens
        : Math.max(24000, Math.floor(outputTokens * (attempt === 1 ? 0.78 : 0.62)));
      const attemptPrompt = attempt === 0
        ? requestPrompt
        : `${prompt}${styleReminder}\n\n【紧凑格式重试 ${attempt}/2】上一次返回未形成完整 JSON。请减少每个字段的篇幅，但必须保留 bible 全部栏目和 ${project.episodeCount} 个 episodes；每集保留 title、premise、conflict、turn、cliffhanger、characterBeats、subplotBeats、setupPayoff、scenePlan、continuityState。不要 imagePlan，不要解释，不要 markdown，必须一次性输出闭合 JSON。`;
      result = await streamGenerate(
        systemPrompt,
        attemptPrompt,
        null,
        null,
        // 剧本圣经/分集蓝图属于总策划类任务：按五模型架构走 outline 线路（qwen），
        // 不走 reasoning（glm 强制思考对超大规划任务会熔断）。
        resolveApiConfig(req.userModelConfig, 'outline'),
        1,
        0.35,
        attemptOutputTokens,
        // 剧本圣经会同时生成角色、场景和全部分集大纲，允许长线路完整返回。
        20 * 60 * 1000
      );
      parsed = normalizeDevelopmentPayload(parseJsonObject(result.content));
      if (parsed) break;
      console.warn(`[Screenplay] 剧本圣经 JSON 第${attempt + 1}次解析失败，输出长度 ${String(result.content || '').length}，预览：${String(result.content || '').slice(0, 240)}`);
    }
    if (!parsed) return res.status(502).json({ message: '剧本圣经生成未完成，系统已自动重试 3 次。请稍后点击重试，或适当减少集数/单集时长。', error: '模型返回未形成包含 bible 和 episodes 的完整 JSON' });

    // 修复 P3：大批量（>24 集）单次成型实测会缺集、伏笔表为空——按缺失区间
    // 分批补拉分集，并按需补生成伏笔表，再进入落库映射。
    const wantedTotal = Number(project.episodeCount) || 0;
    if (wantedTotal > 24) {
      const merged = new Map((parsed.episodes || []).map((episode) => [Number(episode.episodeNumber), episode]));
      const missing = [];
      for (let i = 1; i <= wantedTotal; i++) if (!merged.has(i)) missing.push(i);
      if (missing.length) {
        console.warn(`[Screenplay] 蓝图缺 ${missing.length} 集（${missing[0]}..${missing[missing.length - 1]}），分批补拉`);
        const ranges = [];
        let rangeStart = missing[0];
        let prev = missing[0];
        for (const n of [...missing.slice(1), NaN]) {
          if (n === prev + 1) { prev = n; continue; }
          ranges.push([rangeStart, prev]);
          if (Number.isFinite(n)) { rangeStart = n; prev = n; }
        }
        for (const [from, to] of ranges) {
          let cursor = from;
          while (cursor <= to) {
            const end = Math.min(cursor + 23, to);
            try {
              const repairPrompt = `${requestPrompt}\n\n【补全任务】其余分集已生成完毕。现在只补全第 ${cursor}~${end} 集的分集大纲，只输出 JSON：{"episodes":[{"episodeNumber":N,"title":"...","premise":"...","conflict":"...","turn":"...","cliffhanger":"...","emotionalArc":"...","characterBeats":[{"character":"","before":"","choice":"","after":""}],"subplotBeats":[{"subplot":"","beat":""}],"setupPayoff":[{"type":"setup或payoff","foreshadowingId":"F1","detail":""}],"scenePlan":[{"sceneNumber":1,"purpose":"","location":"","characters":[""],"objective":"","obstacle":"","turn":"","exitState":""}],"continuityState":"本集结束状态"}]}。episodeNumber 必须逐一覆盖 ${cursor}..${end}；剧情必须衔接既有分集的走向与 continuityState；不要输出 bible，不要解释。`;
              const repairResult = await streamGenerate(systemPrompt, repairPrompt, null, null,
                resolveApiConfig(req.userModelConfig, 'outline'), 1, 0.35,
                Math.min(100000, Math.max(20000, (end - cursor + 1) * 1600)), 15 * 60 * 1000);
              const repairParsed = parseJsonObject(repairResult.content);
              const partEpisodes = Array.isArray(repairParsed?.episodes) ? repairParsed.episodes : (Array.isArray(repairParsed) ? repairParsed : []);
              let added = 0;
              for (const episode of partEpisodes) {
                const num = Number(episode?.episodeNumber);
                if (num >= cursor && num <= end && !merged.has(num)) { merged.set(num, episode); added++; }
              }
              console.warn(`[Screenplay] 补拉 ${cursor}~${end} 集：新增 ${added} 集`);
            } catch (error) {
              console.warn(`[Screenplay] 补拉 ${cursor}~${end} 集失败:`, error.message);
            }
            cursor = end + 1;
          }
        }
      }
      parsed.episodes = [...merged.values()].sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber));
      if (!(Array.isArray(parsed.bible?.foreshadowing) && parsed.bible.foreshadowing.length)) {
        try {
          const foreshadowPrompt = `${requestPrompt}\n\n【补全任务】基于上述圣经与分集蓝图，只输出 JSON：{"foreshadowing":[{"id":"F1","setup":"埋设内容","payoff":"回收方式","targetEpisodes":"目标集数区间","misdirection":"可接受的误导"}]}，登记 8~14 条跨集伏笔（埋设集与回收集必须明确落在 1~${wantedTotal} 集内），不要输出其他内容。`;
          const foreshadowResult = await streamGenerate(systemPrompt, foreshadowPrompt, null, null,
            resolveApiConfig(req.userModelConfig, 'outline'), 1, 0.3, 8000, 10 * 60 * 1000);
          const foreshadowParsed = parseJsonObject(foreshadowResult.content);
          const items = Array.isArray(foreshadowParsed?.foreshadowing) ? foreshadowParsed.foreshadowing : [];
          if (items.length) {
            parsed.bible = parsed.bible || {};
            parsed.bible.foreshadowing = items;
            console.warn(`[Screenplay] 伏笔表补全：${items.length} 条`);
          }
        } catch (error) {
          console.warn('[Screenplay] 伏笔表补全失败:', error.message);
        }
      }
    }
    // 解析成功后才扣费：解析失败触发的内部重试不再重复扣费，
    // 全部失败（返回 502）则不扣费——与分集“质量不达标不扣费”的策略一致。
    await recordScreenplayUsage(req, requestPrompt, result.content, 'reasoning', project._id, '', result.usage);

    project.screenplayBible = {
      logline: String(parsed.bible.logline || '').slice(0, 800),
      genre: String(parsed.bible.genre || '').slice(0, 120),
      visualTone: String(parsed.bible.visualTone || '').slice(0, 800),
      adaptationBoundary: String(parsed.bible.adaptationBoundary || '').slice(0, 1200),
      characters: (Array.isArray(parsed.bible.characters) ? parsed.bible.characters : []).slice(0, 30),
      locations: (Array.isArray(parsed.bible.locations) ? parsed.bible.locations : []).slice(0, 30),
      continuityRules: sanitizeList(parsed.bible.continuityRules, 30, 500),
      characterArcs: normalizeBlueprintItems(parsed.bible.characterArcs, 30),
      subplots: normalizeBlueprintItems(parsed.bible.subplots, 30),
      foreshadowing: normalizeBlueprintItems(parsed.bible.foreshadowing, 40),
      styleRules: sanitizeList(parsed.bible.styleRules, 30, 500),
      imagePlan: (project.imageGeneration && project.imageGeneration.enabled)
        ? {
          portraitCount: Math.max(1, Math.min(4, Number(parsed.bible.imagePlan?.portraitCount) || 1)),
          portraitSize: String(parsed.bible.imagePlan?.portraitSize || '1024x1024').slice(0, 20),
          relationshipCount: Math.max(1, Math.min(4, Number(parsed.bible.imagePlan?.relationshipCount) || 1)),
          relationshipSize: String(parsed.bible.imagePlan?.relationshipSize || '1024x1024').slice(0, 20),
          notes: String(parsed.bible.imagePlan?.notes || '').slice(0, 500),
        }
        : {},
    };
    project.episodes = Array.from({ length: project.episodeCount }, (_, index) => parsed.episodes[index] || ({ episodeNumber: index + 1 })).map((episode, index) => ({
      episodeNumber: index + 1,
      title: String(episode.title || `第${index + 1}集`).slice(0, 120),
      durationSeconds: Math.max(30, Math.min(MAX_SCREENPLAY_DURATION_SECONDS, Number(episode.durationSeconds) || project.episodeDurationSeconds)),
      premise: String(episode.premise || '').slice(0, 1000),
      conflict: String(episode.conflict || '').slice(0, 1000),
      turn: String(episode.turn || '').slice(0, 1000),
      cliffhanger: String(episode.cliffhanger || '').slice(0, 1000),
      emotionalArc: String(episode.emotionalArc || '').slice(0, 1000),
      characterBeats: normalizeBlueprintItems(episode.characterBeats, 20),
      subplotBeats: normalizeBlueprintItems(episode.subplotBeats, 20),
      setupPayoff: normalizeBlueprintItems(episode.setupPayoff, 20),
      scenePlan: normalizeBlueprintItems(episode.scenePlan, 40),
      continuityState: String(episode.continuityState || '').slice(0, 1600),
      imagePlan: episode.imagePlan && typeof episode.imagePlan === 'object' ? {
        prompt: String(episode.imagePlan.prompt || episode.imagePlan.imagePrompt || '').slice(0, 6000),
        size: String(episode.imagePlan.size || '').slice(0, 20),
        count: Math.max(1, Math.min(4, Number(episode.imagePlan.count || episode.imagePlan.n) || 1)),
      } : {},
    }));
    project.status = 'developed';
    await project.save();
    // Visual assets are deliberately a background task: image providers are
    // slow and must never hold the text-generation request open. The project
    // status is persisted as running and the bookshelf/polling endpoint can
    // observe completion or failure.
    void generateProjectImageAssets(project, req, 'bible').catch((error) => {
      console.warn('[Screenplay] 后台生成剧本圣经图片失败:', error.message);
    });
    res.json(project);
  } catch (error) {
    const rawMessage = String(error?.message || '');
    const insufficientPoints = rawMessage === 'TOKEN_EXHAUSTED' || rawMessage.includes('模型额度不足');
    const upstreamFailure = error?.isApiError || /AI API|线路尚未配置|流式响应空闲超时|请求超时/.test(rawMessage);
    const message = insufficientPoints
      ? '模型额度不足，请检查所选线路'
      : upstreamFailure
        ? `AI 线路请求失败：${rawMessage || '请检查管理端线路配置和网络连接后重试'}`
        : '生成剧本圣经失败，请稍后重试';
    res.status(upstreamFailure ? 502 : 500).json({ message, error: rawMessage });
  }
}));

// 剧本线路的备用配置：主线路整体不可用（中转 server_busy/断流）时自动切换，
// 避免"3 次重试都打在同一条死线路上"的空转。优先级与 novel.js 的 outline 一致。
function getScreenplayFallbackConfig(user) {
  const config = user?.modelConfig;
  if (config && !['default', 'system'].includes(config.provider || 'default')) return null;
  const { createModelCatalog, resolveRouteId } = require('../config/modelCatalog');
  const primary = resolveRouteId(config, 'outline');
  return createModelCatalog().find(route => route.id !== primary && route.baseUrl && route.apiKey && route.model) || null;
}

// 分阶段生成剧本圣经与分集大纲（SSE）：先出圣经+首批分集并即时落库推送，
// 之后循环补齐剩余分集（默认 12 集一批，重试减半+切备用线路），每批成功即
// 落库并推送前端渲染——75~120 集不再依赖单次巨型 JSON 成型。


router.post('/projects/:id/develop-stream', auth, creativeOperation('screenplay_develop', async (req, res) => {
  let project = null;
  try {
    project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    if (activeBatchWorkers.has(`develop:${project._id}`)) return res.status(409).json({ message: '该项目正在生成中，请等待完成或刷新页面' });
    activeBatchWorkers.set(`develop:${project._id}`, true);
    const persona = project.writingPersonaSnapshot || project.sourceSnapshot?.persona || null;
    const personaBlock = (persona ? `\n\n【用户选择的写作人格】名称：${String(persona.name || '自定义人格').slice(0, 100)}\n声线：${String(persona.voice || '').slice(0, 1800)}\n语气节奏：${String(persona.tone || '').slice(0, 1400)}\n规则：${String(persona.rules || '').slice(0, 2200)}\n用词：${String(persona.vocab || '').slice(0, 1000)}\n该人格优先于默认编剧腔，必须落实到人物对白、叙述节奏和动作取舍。` : '') + buildReferencePrompt(project.sourceSnapshot, { adaptation: project.sourceType === 'adaptation' });
    const source = project.sourceType === 'adaptation'
      ? `【改编小说】\n标题：${project.sourceSnapshot?.title || ''}\n大纲：${String(project.sourceSnapshot?.outline || '').slice(0, 10000)}\n世界观：${String(project.sourceSnapshot?.worldSetting || '').slice(0, 3500)}\n已写剧情摘要：${String(project.sourceSnapshot?.chapterSummaries || '').slice(-7000)}\n动态蓝图：${JSON.stringify(project.sourceSnapshot?.blueprint || {}).slice(0, 14000)}\n原作人格：${JSON.stringify(project.sourceSnapshot?.persona || {}).slice(0, 4000)}`
      : `【原创设定】\n${project.concept || '请先构建一个具有明确人物关系和连续冲突的短剧设定。'}${project.conceptExpansion ? `\n【AI扩展设定${project.includeMainlinePlanning ? '（含主线规划）' : '（未指定唯一主线）'}】\n${conceptExpansionText(project.conceptExpansion)}` : ''}`;
    await loadScreenplayGenerationConfig();
    const productionRule = project.productionTarget === 'video'
      ? '交付给视频生成工具：场景必须可视化、单场地点明确，productionNotes 写镜头景别、主体动作、画面重点和转场，不写无法呈现的抽象说明。'
      : '交付给实拍团队：场景必须可执行，productionNotes 写布景重点、人物走位、必要道具和声音提示，避免无法拍摄的内容。';
    const prompt = `请作为连续短剧总编剧，为下列项目建立“剧本圣经”和${project.episodeCount}集分集蓝图。短剧要在有限时长内建立冲突、关系变化和悬念，不能只给一条主线梗概。每集都要有可执行的场次计划，明确人物目标、阻力、结果、支线推进、伏笔埋设/回收和情绪曲线。\n\n${source}\n\n【每集时长】约${project.episodeDurationSeconds}秒\n【制作方式】${productionRule}\n\n只输出 JSON，不要 markdown：\n{\n  "bible": {\n    "logline": "一句话故事",\n    "genre": "类型",\n    "visualTone": "可见的整体视觉气质",\n    "adaptationBoundary": "改编作品时必须保留/允许重排的边界；原创则写原创约束",\n    "characters": [{"name":"姓名","visual":"外貌、服装、年龄段、气质","objective":"本剧阶段目标","relationship":"关键关系","continuity":"不得前后改变的身份、物件或状态"}],\n    "locations": [{"name":"地点","visual":"空间布局、光线、色调和核心道具","storyFunction":"这个场景承载的冲突","continuity":"需要持续保持的空间事实"}],\n    "characterArcs": [{"character":"人物","startState":"开局状态","turningPoints":"关键变化节点","endState":"阶段终点","pressure":"主要压力来源"}],\n    "subplots": [{"name":"支线名称","characters":"涉及人物","purpose":"与主线的关系","beats":"在第几集如何推进/转折/结束"}],\n    "foreshadowing": [{"id":"F1","setup":"埋设内容","payoff":"回收方式","targetEpisodes":"目标集数","misdirection":"可接受的误导"}],\n    "continuityRules": ["跨集必须保持的事实"],\n    "styleRules": ["本剧独有的叙事和对白规则"]\n  },\n  "episodes": [{"episodeNumber":1,"title":"有信息量的章节标题","durationSeconds":${project.episodeDurationSeconds},"premise":"本集开场与目标","conflict":"核心冲突与对抗双方","turn":"本集反转及其前置依据","cliffhanger":"结尾钩子和下一集问题","emotionalArc":"情绪从何处到何处","characterBeats":[{"character":"人物","before":"本集前状态","choice":"关键选择","after":"本集后状态"}],"subplotBeats":[{"subplot":"支线","beat":"本集推进或暂缓方式"}],"setupPayoff":[{"type":"setup或payoff","foreshadowingId":"F1","detail":"具体内容"}],"scenePlan":[{"sceneNumber":1,"purpose":"场景戏剧目的","location":"地点","characters":["人物"],"objective":"人物想得到什么","obstacle":"什么阻碍","turn":"场内变化","exitState":"离场状态"}],"continuityState":"本集结束后人物、道具、地点和未解问题的状态"}]\n}`;
    const systemPrompt = '你是一位重视人物动机、空间调度与跨集连续性的短剧总编剧。输出必须可直接进入剧本制作流程。';
    const styleReminder = `\n\n【风格差异要求】请为本项目建立独有的语言气质和人物声音。避免空泛的“高级、电影感、细腻、震撼”等形容词；不同人物使用不同句长、词汇、回避方式和情绪外露程度，允许生活化停顿、改口和答非所问。${personaBlock}`;
    const imagePlanningInstruction = (project.imageGeneration && project.imageGeneration.enabled)
      ? '\n\n【视觉资产规划（必填）】本项目已开启生图功能，必须额外返回 bible.imagePlan（含 portraitCount、portraitSize、relationshipCount、relationshipSize、notes），以及每集/场景的 imagePlan（含 prompt 与 size）。size 只能从 1024x1024、720x1280、1280x720、768x1152、1152x768 中选择，count 只能为 1-4。缺少 imagePlan 会被视为格式不合格。'
      : '';
    const requestPrompt = `${prompt}${styleReminder}${imagePlanningInstruction}`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (evt) => { try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch {} };
    const wantedTotal = Math.max(1, Number(project.episodeCount) || 12);
    const BATCH = 12;
    send({ type: 'started', episodeCount: wantedTotal });

    const episodesMap = new Map();
    let bibleRaw = null;

    const sanitizeBible = (bible) => ({
      logline: String(bible?.logline || '').slice(0, 800),
      genre: String(bible?.genre || '').slice(0, 120),
      visualTone: String(bible?.visualTone || '').slice(0, 800),
      adaptationBoundary: String(bible?.adaptationBoundary || '').slice(0, 1200),
      characters: (Array.isArray(bible?.characters) ? bible.characters : []).slice(0, 30),
      locations: (Array.isArray(bible?.locations) ? bible.locations : []).slice(0, 30),
      continuityRules: sanitizeList(bible?.continuityRules, 30, 500),
      characterArcs: normalizeBlueprintItems(bible?.characterArcs, 30),
      subplots: normalizeBlueprintItems(bible?.subplots, 30),
      foreshadowing: normalizeBlueprintItems(bible?.foreshadowing, 40),
      styleRules: sanitizeList(bible?.styleRules, 30, 500),
      imagePlan: (project.imageGeneration && project.imageGeneration.enabled)
        ? {
          portraitCount: Math.max(1, Math.min(4, Number(bible?.imagePlan?.portraitCount) || 1)),
          portraitSize: String(bible?.imagePlan?.portraitSize || '1024x1024').slice(0, 20),
          relationshipCount: Math.max(1, Math.min(4, Number(bible?.imagePlan?.relationshipCount) || 1)),
          relationshipSize: String(bible?.imagePlan?.relationshipSize || '1024x1024').slice(0, 20),
          notes: String(bible?.imagePlan?.notes || '').slice(0, 500),
        }
        : {},
    });
    const sanitizeEpisode = (raw, fallbackNumber) => ({
      episodeNumber: Math.max(1, Math.min(wantedTotal, Number(raw?.episodeNumber) || fallbackNumber)),
      title: String(raw?.title || `第${fallbackNumber}集`).slice(0, 120),
      durationSeconds: Math.max(30, Math.min(MAX_SCREENPLAY_DURATION_SECONDS, Number(raw?.durationSeconds) || project.episodeDurationSeconds)),
      premise: String(raw?.premise || '').slice(0, 1000),
      conflict: String(raw?.conflict || '').slice(0, 1000),
      turn: String(raw?.turn || '').slice(0, 1000),
      cliffhanger: String(raw?.cliffhanger || '').slice(0, 1000),
      emotionalArc: String(raw?.emotionalArc || '').slice(0, 1000),
      characterBeats: normalizeBlueprintItems(raw?.characterBeats, 20),
      subplotBeats: normalizeBlueprintItems(raw?.subplotBeats, 20),
      setupPayoff: normalizeBlueprintItems(raw?.setupPayoff, 20),
      scenePlan: normalizeBlueprintItems(raw?.scenePlan, 40),
      continuityState: String(raw?.continuityState || '').slice(0, 1600),
      imagePlan: raw?.imagePlan && typeof raw.imagePlan === 'object' ? {
        prompt: String(raw.imagePlan.prompt || raw.imagePlan.imagePrompt || '').slice(0, 6000),
        size: String(raw.imagePlan.size || '').slice(0, 20),
        count: Math.max(1, Math.min(4, Number(raw.imagePlan.count || raw.imagePlan.n) || 1)),
      } : {},
    });
    const applyToProject = () => {
      if (bibleRaw) project.screenplayBible = sanitizeBible(bibleRaw);
      const sorted = [...episodesMap.entries()].sort((a, b) => a[0] - b[0]);
      project.episodes = sorted.map(([num, raw]) => sanitizeEpisode(raw, num));
      project.markModified('screenplayBible');
      project.markModified('episodes');
    };

    // ---- 断点续跑：paused/developing 状态下重试时，沿用已保存的圣经与分集，
    // 只补缺失集数；draft/developed 状态则全新生成。----
    const resume = ['paused', 'developing'].includes(project.status);
    if (resume) {
      for (const episode of project.episodes || []) {
        const num = Number(episode?.episodeNumber);
        const rawEpisode = typeof episode.toJSON === 'function' ? episode.toJSON() : episode;
        if (num >= 1 && num <= wantedTotal && (rawEpisode.premise || rawEpisode.title)) {
          episodesMap.set(num, rawEpisode);
        }
      }
      if (episodesMap.size > 0 && project.screenplayBible && Object.keys(project.screenplayBible).length) {
        bibleRaw = { ...project.screenplayBible };
      }
      if (episodesMap.size) {
        send({ type: 'progress', message: `检测到已生成的 ${episodesMap.size}/${wantedTotal} 集，从缺失处继续补齐…`, generated: episodesMap.size, total: wantedTotal });
      }
    }

    // ---- 阶段 1：剧本圣经 + 首批分集（批次数随重试自适应缩减，
    // 小输出上限的线路也能放下；断点续跑时 bible 已存在则跳过）----
    if (!bibleRaw) {
      const primaryConfig = resolveApiConfig(req.userModelConfig, 'outline');
      const fallbackConfig = getScreenplayFallbackConfig({ modelConfig: req.userModelConfig });
      const attempts = [
        { cfg: primaryConfig, batch: Math.min(wantedTotal, 8) },
        { cfg: primaryConfig, batch: Math.min(wantedTotal, 4) },
        { cfg: fallbackConfig || primaryConfig, batch: Math.min(wantedTotal, 3) },
      ];
      let stage1 = null;
      for (const at of attempts) {
        const tail = `\n\n【分阶段生成·第 1 批】本次只输出剧本圣经 bible 和第 1~${at.batch} 集的 episodes（episodeNumber 从 1 连续到 ${at.batch}）。后续集数会在下一步单独生成，本次不要输出。每集字段保持完整，必须一次性输出闭合 JSON，不要 markdown。`;
        const retryNote = at === attempts[0]
          ? ''
          : `\n\n【紧凑格式重试】上一次返回未形成完整 JSON（疑似超输出上限被截断）。请大幅压缩每个字段的篇幅，只保留 bible 全部栏目和第 1~${at.batch} 集完整 episodes；不要 imagePlan，不要解释，必须一次性输出闭合 JSON。`;
        const stage1Prompt = `${requestPrompt}${tail}${retryNote}`;
        try {
          const result = await streamGenerate(systemPrompt, stage1Prompt, null, null,
            at.cfg, 1, 0.35, 40000, 20 * 60 * 1000);
          console.warn(`[Screenplay] 阶段1使用线路 ${at.cfg.routeId || 'custom'}，批次 ${at.batch}`);
          const parsed = normalizeDevelopmentPayload(parseJsonObject(result.content));
          if (parsed && parsed.bible && Array.isArray(parsed.episodes) && parsed.episodes.length) {
            stage1 = parsed;
            try { await recordScreenplayUsage(req, stage1Prompt, result.content, 'reasoning', project._id, `screenplay-develop-stream:${project._id}:s1:${Date.now()}`, result.usage); } catch (e) { console.warn('[Screenplay] 阶段1用量记录失败:', e.message); }
          } else {
            const contentText = String(result.content || '');
            const truncated = !contentText.trim().replace(/\x60\x60\x60/g, '').trimEnd().endsWith('}');
            console.warn(`[Screenplay] 阶段1解析失败，长度 ${contentText.length}，疑似${truncated ? '输出被截断' : 'JSON格式错误'}，预览：${contentText.slice(0, 120)}，尾部：${contentText.slice(-120)}`);

          }
        } catch (error) {
          console.warn(`[Screenplay] 阶段1请求失败:`, error.message);
        }
      }
      if (!stage1) {
        send({ type: 'error', message: '剧本圣经生成未完成（已自动重试 3 次）。请稍后点击重试，或更换 outline 线路模型。' });
        res.end();
        return;
      }
      bibleRaw = stage1.bible;
      for (const episode of stage1.episodes) {
        const num = Number(episode?.episodeNumber);
        if (num >= 1 && num <= wantedTotal && !episodesMap.has(num)) episodesMap.set(num, episode);
      }
    }

    applyToProject();
    project.status = 'developing';
    await project.save();
    send({ type: 'bible', bible: sanitizeBible(bibleRaw), episodes: project.episodes, generated: episodesMap.size, total: wantedTotal, progress: `剧本圣经与已生成的 ${episodesMap.size} 集分集就绪，继续补齐剩余分集` });

    // ---- 阶段 2..N：循环补齐剩余分集（默认 12 集一批；本批失败自动切备用
    // 线路并把批量减半再试一次；每批成功即落库并推送前端渲染）----
    let failedRange = null;
    let safety = 0;
    while (episodesMap.size < wantedTotal && safety < 40) {
      safety += 1;
      const missing = [];
      for (let i = 1; i <= wantedTotal; i += 1) if (!episodesMap.has(i)) missing.push(i);
      if (!missing.length) break;
      const primaryConfig = resolveApiConfig(req.userModelConfig, 'outline');
      const fallbackConfig = getScreenplayFallbackConfig({ modelConfig: req.userModelConfig });
      const attempts = [
        { cfg: primaryConfig, batch: Math.min(BATCH, missing.length) },
        { cfg: fallbackConfig || primaryConfig, batch: Math.max(3, Math.ceil(Math.min(BATCH, missing.length) / 2)) },
      ];
      let addedNumbers = null;
      let batchUsage = null;
      let batchPromptUsed = '';
      let batchContent = '';
      let batchFrom = missing[0];
      let batchTo = missing[Math.min(BATCH, missing.length) - 1];
      for (const at of attempts) {
        const numbers = missing.filter((n) => !episodesMap.has(n)).slice(0, at.batch);
        if (!numbers.length) break;
        batchFrom = numbers[0];
        batchTo = numbers[numbers.length - 1];
        send({ type: 'progress', message: `正在生成第 ${batchFrom}~${batchTo} 集分集大纲…`, generated: episodesMap.size, total: wantedTotal });
        const numbersList = numbers.join('、');
        const previous = episodesMap.get(numbers[0] - 1);
        const prevContext = previous
          ? JSON.stringify({ episodeNumber: previous.episodeNumber, title: previous.title, continuityState: String(previous.continuityState || '').slice(0, 800) })
          : '（无，从第 1 集开始）';
        const batchPrompt = `${requestPrompt}\n\n【分阶段生成】剧本圣经与前段分集已完成。现在只补全第 ${numbersList} 集的分集大纲（episodeNumber 必须恰好逐一覆盖：${numbersList}），剧情必须衔接既有分集走向与 continuityState。只输出 JSON：{"episodes":[{ 每集字段与主任务 schema 相同：episodeNumber,title,durationSeconds,premise,conflict,turn,cliffhanger,emotionalArc,characterBeats,subplotBeats,setupPayoff,scenePlan,continuityState }]}。不要输出 bible，不要解释，不要 markdown，必须一次性输出闭合 JSON。\n【前序衔接】${prevContext}`;
        try {
          const result = await streamGenerate(systemPrompt, batchPrompt, null, null,
            at.cfg, 1, 0.35,
            Math.min(60000, Math.max(20000, numbers.length * 1600)), 15 * 60 * 1000);
          batchUsage = result.usage;
          batchContent = result.content;
          const parsed = parseJsonObject(result.content);
          const eps = Array.isArray(parsed?.episodes) ? parsed.episodes : (Array.isArray(parsed) ? parsed : []);
          const valid = [];
          for (const ep of eps) {
            const num = Number(ep?.episodeNumber);
            if (numbers.includes(num) && !episodesMap.has(num)) { episodesMap.set(num, ep); valid.push(num); }
          }
          if (valid.length) addedNumbers = valid;
          else console.warn(`[Screenplay] 本批无可入库分集（长度 ${String(result.content || '').length}，预览 ${String(result.content || '').slice(0, 160)}）`);
        } catch (error) {
          console.warn(`[Screenplay] 本批请求失败:`, error.message);
        }
      }
      if (!addedNumbers) {
        failedRange = [batchFrom, batchTo];
        break;
      }
      try { await recordScreenplayUsage(req, batchPromptUsed, batchContent, 'reasoning', project._id, `screenplay-develop-stream:${project._id}:b${safety}:${Date.now()}`, batchUsage); } catch (e) { console.warn('[Screenplay] 分批用量记录失败:', e.message); }
      applyToProject();
      project.status = 'developing';
      await project.save();
      send({ type: 'episodes_batch', from: batchFrom, to: batchTo, added: addedNumbers.length, episodes: project.episodes, generated: episodesMap.size, total: wantedTotal, progress: `分集大纲已生成 ${episodesMap.size}/${wantedTotal} 集` });
    }

    if (failedRange && episodesMap.size === 0) {
      project.status = 'draft';
      await project.save().catch(() => {});
      send({ type: 'error', message: `第 ${failedRange[0]}~${failedRange[1]} 集分集大纲生成失败（已重试 2 次），且暂无任何已生成分集。请稍后重试或减少集数。` });
      res.end();
      return;
    }
    if (failedRange) {
      applyToProject();
      project.status = 'paused';
      await project.save();
      send({ type: 'partial', message: `第 ${failedRange[0]}~${failedRange[1]} 集生成失败（已重试 2 次）。已生成的 ${episodesMap.size}/${wantedTotal} 集已保存，稍后点击重试将从缺失处继续补齐。`, generated: episodesMap.size, total: wantedTotal });
      res.end();
      return;
    }

    project.status = 'developed';
    await project.save();
    void generateProjectImageAssets(project, req, 'bible').catch((error) => {
      console.warn('[Screenplay] 后台生成剧本圣经图片失败:', error.message);
    });
    send({ type: 'completed', progress: `全部 ${wantedTotal} 集分集大纲已生成`, project: project.toJSON(), total: wantedTotal });
    res.end();
  } catch (error) {
    console.error('[Screenplay] develop-stream 异常:', error.message);
    if (res.headersSent) {
      try { res.write(`data: ${JSON.stringify({ type: 'error', message: error.message || '生成剧本圣经失败，请稍后重试' })}\n\n`); res.end(); } catch {}
    } else {
      res.status(500).json({ message: '生成剧本圣经失败，请稍后重试', error: redactError(error.message) });
    }
  } finally {
    if (project) activeBatchWorkers.delete(`develop:${project._id}`);
  }
}));

// Use the very same episode lease as AI generation. Only replace this scene;
// images and other episodes may be saved independently while an editor is open.
router.put('/projects/:id/episodes/:episodeNumber/scenes/:sceneNumber', auth, creativeOperation('screenplay_episode', async (req, res) => {
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    if (await isCreativeBusy(`screenplay:${project._id}:development`) || await isCreativeBusy(`screenplay:${project._id}:batch`)) {
      return res.status(409).json({ message: '剧本正在生成，请先暂停并等待保存完成后再编辑' });
    }
    const batch = await getLatestTask({ userId: req.userId, resourceId: project._id, kind: 'screenplay_batch' });
    if (batch && ['queued', 'running'].includes(batch.status)) return res.status(409).json({ message: '请先暂停批量生成，再保存手工修改' });
    const episode = project.episodes.find(item => item.episodeNumber === Number(req.params.episodeNumber));
    const scene = episode?.scenes.find(item => item.sceneNumber === Number(req.params.sceneNumber));
    if (!scene) return res.status(404).json({ message: '场景不存在，请重新加载项目' });
    const expected = req.body?.expectedScene;
    if (!expected || !Array.isArray(expected.dialogue)) return res.status(400).json({ message: '缺少原场景版本，请重新打开编辑器' });
    if (JSON.stringify(sceneEditSnapshot(scene)) !== JSON.stringify(sceneEditSnapshot(expected))) {
      return res.status(409).json({ message: '场景正文已被更新，未覆盖最新内容。请保留草稿，重新打开项目后核对修改' });
    }
    const edit = validateSceneEdit(req.body?.scene);
    const characters = [...new Set([...(scene.characters || []), ...edit.dialogue.map(line => line.character.trim()).filter(Boolean)])];
    scene.set({ ...edit, characters, editedAt: new Date() });
    await scene.validate();
    await assertCreativeLease();
    const result = await Screenplay.updateOne(
      { _id: project._id, userId: req.userId },
      { $set: { 'episodes.$[episode].scenes.$[scene]': scene.toObject() } },
      { arrayFilters: [{ 'episode.episodeNumber': episode.episodeNumber }, { 'scene.sceneNumber': scene.sceneNumber }] },
    );
    if (!result.matchedCount) return res.status(404).json({ message: '剧本项目已不存在' });
    res.json({ scene: scene.toObject(), message: '场景已保存，未调用 AI，也未修改其他场景' });
  } catch (error) {
    if (error.status === 400 || error.name === 'ValidationError') return res.status(400).json({ message: error.message });
    throw error;
  }
}));

router.post('/projects/:id/episodes/:episodeNumber/generate', auth, generationRateLimit, creativeOperation('screenplay_episode', async (req, res) => {
  let episodeLockKey = '';
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    if (await isCreativeBusy(`screenplay:${project._id}:development`)) return res.status(409).json({ message: '请先等待剧本圣经生成完毕' });
    const episodeNumber = Number(req.params.episodeNumber);
    const episode = project.episodes.find((item) => item.episodeNumber === episodeNumber);
    if (!episode) return res.status(404).json({ message: '分集大纲不存在，请先生成剧本圣经' });
    episodeLockKey = `${req.userId}:${project._id}:${episodeNumber}`;
    if (activeEpisodeWorkers.has(episodeLockKey)) return res.status(409).json({ message: '本集正在生成，请稍后查看进度' });
    const previousStatus = episode.generationReport && typeof episode.generationReport === 'object' ? episode.generationReport : {};
    const priorGenerationReport = { ...previousStatus };
    // The marker survives a process restart, but the in-memory lock does not.
    // A generating marker without a local worker is therefore stale and may
    // be safely reclaimed by this request.
    activeEpisodeWorkers.set(episodeLockKey, true);
    // Persist an explicit in-progress marker before the model call. If the
    // browser disconnects or the provider fails, reopening the project shows
    // what happened instead of making the episode look untouched.
    episode.generationReport = {
      ...previousStatus,
      status: 'generating', lastError: '', startedAt: new Date(),
    };
    await persistScreenplayEpisode(project, episodeNumber, episode);
    const previous = project.episodes.find((item) => item.episodeNumber === episodeNumber - 1);
    const screenplayGeneration = await loadScreenplayGenerationConfig();
    const requirements = getScriptRequirements(episode.durationSeconds || project.episodeDurationSeconds, screenplayGeneration);

    const generationTask = await beginTask({
      userId: req.userId,
      kind: 'screenplay_episode',
      resourceType: 'screenplay',
      resourceId: project._id,
      idempotencyKey: `screenplay:${project._id}:episode:${episodeNumber}:${Date.now()}`,
      totalUnits: requirements.sceneCount,
      metadata: { episodeNumber, mode: req.body?.mode || 'generate', durationSeconds: requirements.duration },
    });
    await updateTask(generationTask?._id, { stage: 'writing', progress: `正在生成第 ${episodeNumber} 集` });
    const productionRule = project.productionTarget === 'video'
      ? 'productionNotes 必须包含镜头景别、可见主体、动作、画面重点与转场建议。'
      : 'productionNotes 必须包含布景、走位、核心道具、声音或拍摄执行提示。';
    const perSceneDialogue = Math.max(4, Math.ceil(requirements.dialogueLineCount / requirements.sceneCount));
    const perSceneAction = Math.max(180, Math.ceil(requirements.actionChars / requirements.sceneCount));
    const compactBible = compactScreenplayBible(project.screenplayBible);
    const writingPersona = project.writingPersonaSnapshot || project.sourceSnapshot?.persona || null;
    const styleDirective = buildScreenplayStyleDirective(project.screenplayBible, project.productionTarget) + buildReferencePrompt(project.sourceSnapshot, { adaptation: project.sourceType === 'adaptation' });
    const previousContext = compactPreviousEpisodeContext(previous);
    const episodeBlueprint = {
      emotionalArc: episode.emotionalArc || '',
      characterBeats: episode.characterBeats || [],
      subplotBeats: episode.subplotBeats || [],
      setupPayoff: episode.setupPayoff || [],
      scenePlan: episode.scenePlan || [],
      continuityState: episode.continuityState || '',
    };
    const requestedRepair = req.body?.mode === 'quality_repair';
    const previousReport = priorGenerationReport;
    const repairIssues = [];
    const reportedIssues = Array.isArray(previousReport?.issues)
      ? previousReport.issues.map((issue) => String(issue || '').trim()).filter(Boolean).slice(0, 12)
      : [];
    repairIssues.push(...reportedIssues);
    if (requestedRepair || previousReport) {
      if (!previousReport || previousReport.coverage?.scenes === false) repairIssues.push(`场次数量不足：目标约 ${requirements.sceneCount} 场`);
      if (!previousReport || previousReport.coverage?.dialogue === false) repairIssues.push(`对白密度不足：目标至少 ${requirements.dialogueLineCount} 条，平均每场 ${perSceneDialogue} 条`);
      if (!previousReport || previousReport.coverage?.action === false) repairIssues.push(`动作与空间描写不足：目标至少 ${requirements.actionChars} 字，平均每场 ${perSceneAction} 字`);
      if (!previousReport || previousReport.coverage?.sceneExecution === false) repairIssues.push('场次执行字段不完整：每场必须补齐目标、阻力、结果、镜头计划和声音设计');
      if (!previousReport) repairIssues.push('这是旧版剧本结果，必须升级为包含对白语气、神态、姿势、站位和潜台词的新版格式');
    }
    const uniqueRepairIssues = [...new Set(repairIssues)];
    const repairBlock = uniqueRepairIssues.length
      ? `\n\n【本次重生成必须修复的系统诊断】\n${uniqueRepairIssues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')}\n不要只补几句对白或在末尾追加说明，必须重新组织整集场次，使每个问题在正文中得到实际修复。保留本集冲突、转折、钩子和剧本圣经连续性。`
      : '';
    const existingDraftBlock = requestedRepair && episode.scenes?.length
      ? `\n\n【待修复正文压缩摘要】${compactEpisodeForRepair(episode).slice(0, 45000)}\n这是旧正文的压缩摘要。请重写完整整集，不要只返回摘要，也不要沿用其中的缺陷。`
      : '';
    const prompt = `请按影视行业可执行的连续短剧剧本格式，完整写出第${episodeNumber}集。不能改变剧本圣经的角色外观、关系、地点空间与连续性规则；只能使用分集大纲允许的推进。\n\n【压缩后的剧本圣经】${JSON.stringify(compactBible)}\n【压缩后的上一集结尾】${previousContext}\n【本集】${JSON.stringify({ episodeNumber: episode.episodeNumber, title: episode.title, premise: episode.premise, conflict: episode.conflict, turn: episode.turn, cliffhanger: episode.cliffhanger })}\n【制作方式】${productionRule}\n\n【时长与规模硬约束】\n本集时长约 ${requirements.duration} 秒（${(requirements.duration / 60).toFixed(1)} 分钟）。必须写 ${requirements.sceneCount} 个左右的连续场次，至少 ${requirements.dialogueLineCount} 条对白，总动作与空间描写不少于约 ${requirements.actionChars} 个汉字。平均每场至少 ${perSceneDialogue} 条完整对白、${perSceneAction} 字动作与空间描写。不要用“若干场景”“同上”“略”或一句话概括代替正文。\n\n【空间与人物调度硬约束】\n每个场次必须交代：空间布局、人物初始位置、视线关系、进出场路径、距离变化、可见道具、光线/声音和动作后果。人物每次说话都必须同时写清 delivery（语气、音量、速度、情绪、停顿）、physicalAction（神态、手势、姿势或正在做的动作）、position（说话时所在位置、与谁的距离或移动方向）；需要时写 subtext（没有直接说出口的真实意图）。对白不能只是推进剧情的短句，要有来回、打断、试探、回避和潜台词。\n\n【输出前自检】\n在内部逐项检查场次数量、对白数量、动作/空间描写字数，以及每条对白的语气、神态/姿势和站位字段；任何一项不足都必须先补足再输出。不要为了省 token 把场景合并成梗概。\n\n只输出 JSON，不要 markdown：\n{"scenes":[{"sceneNumber":1,"heading":"场次标题","interiorExterior":"INT 或 EXT","timeOfDay":"时间","location":"地点","characters":["人物"],"action":"不少于 ${perSceneAction} 字的可见动作、空间布局、走位、视线、道具、光线声音与因果后果","dialogue":[{"character":"人物","line":"完整对白","delivery":"语气、音量、速度、停顿与情绪","physicalAction":"神态、姿势、手势或正在做的动作","position":"位置、距离和移动方向","subtext":"潜台词或未说出口的意图"}],"productionNotes":"${productionRule}"}]}\n动作和对白必须共同推进冲突；不要在对白里解释已知信息；最后一场必须兑现本集 cliffhanger。`;
    const blueprintInstruction = `\n\n【分集蓝图执行要求】${JSON.stringify(episodeBlueprint)}\n每场戏必须有明确目标、阻力、转折和结果，至少一场推动支线或伏笔；不得只按主线直线复述。场景必须体现人物状态变化，并在可执行字段中交代镜头计划与声音设计。`;
    const generationPrompt = `${styleDirective}\n\n${prompt}${blueprintInstruction}${repairBlock}${existingDraftBlock}`;
    let result = null;
    let parsed = null;
    let requestPrompt = generationPrompt;
    const apiConfig = resolveApiConfig(req.userModelConfig, 'writing');
    let repairPasses = 0;
    let qualityReport = null;
    if (requirements.sceneCount > 10) {
      // Long episodes are generated in contiguous, self-contained scene
      // groups. Asking one response for a full 18-minute episode routinely
      // produces truncated JSON and makes the repair loop waste requests.
      const assembledScenes = [];
      let precedingScene = null;
      const scenesPerBatch = 1;
      for (let startNumber = 1; startNumber <= requirements.sceneCount; startNumber += scenesPerBatch) {
        const count = Math.min(scenesPerBatch, requirements.sceneCount - startNumber + 1);
        const groups = await Promise.all(Array.from({ length: count }, (_, index) => generateScreenplaySceneSegment({
          apiConfig,
          bible: compactBible,
          persona: writingPersona,
          previousContext,
          episode,
          productionRule,
          startNumber: startNumber + index,
          count: 1,
          perSceneDialogue,
          perSceneAction,
          precedingScene,
        })));
        const segment = groups.flat().sort((left, right) => left.sceneNumber - right.sceneNumber);
        assembledScenes.push(...segment);
        precedingScene = segment[segment.length - 1] || precedingScene;
        await updateTask(generationTask?._id, {
          stage: 'writing',
          currentUnit: assembledScenes.length,
          progress: `正在生成第 ${episodeNumber} 集：已完成 ${assembledScenes.length}/${requirements.sceneCount} 场`,
        });
      }
      parsed = { scenes: assembledScenes };
      result = { content: JSON.stringify(parsed) };
      qualityReport = assessScreenplayQuality(assembledScenes, requirements);
    } else {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        result = await streamGenerate(
          `你是一位擅长人物调度、空间叙事和有潜台词对白的短剧编剧。你必须交付完整可执行的剧本正文，不得把剧本压缩成梗概。每句对白都要绑定说话人的语气、神态、姿势和空间位置。${styleDirective}`,
          requestPrompt,
          null,
          null,
          apiConfig,
          1,
          0.65,
          requirements.outputTokens,
          Math.max(300000, requirements.duration * 900)
        );
        parsed = parseJsonObject(result.content);
        if (!parsed || !Array.isArray(parsed.scenes) || !parsed.scenes.length) {
          if (attempt < 3) requestPrompt = `${generationPrompt}\n\n【格式重试】上一次返回未形成可解析的完整 JSON。请重新输出完整 JSON，必须从 {"scenes":[ 开始，确保每个场景对象和数组都闭合，不要解释、不要 markdown。`;
          continue;
        }
        const candidateScenes = normalizeScenes(parsed.scenes.slice(0, Math.max(requirements.sceneCount, 2000)));
        qualityReport = assessScreenplayQuality(candidateScenes, requirements);
        if (!qualityReport.issues.length) {
          parsed.scenes = candidateScenes;
          break;
        }
        // Make the first generation self-healing as well. Models often return
        // valid JSON with too few scenes or dialogue lines; use the remaining
        // attempts to rewrite the complete episode before exposing a warning.
        const maxRepairPasses = 3;
        if (repairPasses >= maxRepairPasses) {
          parsed.scenes = candidateScenes;
          break;
        }
        // One user click may perform one internal repair pass. The repair pass
        // receives the concrete diagnostic list and must rewrite the complete
        // episode, rather than appending a few missing lines at the end.
        repairPasses += 1;
        requestPrompt = `${generationPrompt}\n\n【自动质量修复：这是本次点击内的最后一次修复机会】\n${qualityReport.issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')}\n请完整重写整集并满足所有指标，尤其是每条对白都必须填写 character、line、delivery、physicalAction、position，必要时填写 subtext。只输出闭合的 JSON，不要解释，不要 markdown。`;
      }
    }
    if (!parsed || !Array.isArray(parsed.scenes) || !parsed.scenes.length) {
      const reason = '模型返回内容不完整或 JSON 格式无法解析，已保留本集生成状态，请点击重试';
      episode.generationReport = { ...episode.generationReport, status: 'failed', lastError: reason, failedAt: new Date() };
      await persistScreenplayEpisode(project, episodeNumber, episode);
      return res.status(502).json({ message: reason });
    }
    episode.scenes = normalizeScenes(parsed.scenes);
    // Assess the model output before deterministic repair fields are added.
    // System-derived values improve readability but must never make an
    // incomplete model response appear to have passed quality gates.
    const generatedQualityReport = assessScreenplayQuality(episode.scenes, requirements);
    // Models occasionally return valid scene prose while omitting the
    // structured execution metadata. These fields are deterministic from the
    // episode blueprint/production rule, so normalize them for every
    // generation path (not only explicit repair) before quality assessment.
    episode.scenes = fillRepairExecutionFields(episode.scenes, episode, productionRule);
    episode.generatedAt = new Date();
    const renderedQualityReport = assessScreenplayQuality(episode.scenes, requirements);
    qualityReport = {
      ...renderedQualityReport,
      // Keep the unmodified coverage and issues authoritative for billing and
      // completion status; derivedCoverage is informational only.
      generatedCoverage: generatedQualityReport.coverage,
      generatedIssues: generatedQualityReport.issues,
      derivedCoverage: renderedQualityReport.coverage,
      issues: generatedQualityReport.issues,
    };
    episode.generationReport = {
      status: qualityReport.issues.length ? 'partial' : 'completed',
      lastError: qualityReport.issues.length ? `自动修复后仍有未达标项：${qualityReport.issues.join('；')}` : '',
      durationSeconds: requirements.duration,
      ...qualityReport,
      repairFocus: [...new Set([...uniqueRepairIssues, ...(qualityReport.issues || [])])],
      generatedAt: new Date(),
    };
    // Record provider usage and persist the episode with its quality report.
    // This migration does not add a separate points charge.
    await recordScreenplayUsage(req, requestPrompt, result.content, 'writing', project._id, generationTask?._id?.toString(), result.usage);
    await persistScreenplayEpisode(project, episodeNumber, episode);
    void generateProjectImageAssets(project, req, 'episodes', episode.scenes, episodeNumber).catch((error) => {
      console.warn(`[Screenplay] 后台生成第${episodeNumber}集图片失败:`, error.message);
    });
    await (qualityReport.issues.length
      ? updateTask(generationTask?._id, { status: 'completed', stage: 'quality_warning', progress: '已生成，但仍有质量警告', error: qualityReport.issues.join('；'), completedAt: new Date() })
      : completeTask(generationTask?._id, { progress: `第 ${episodeNumber} 集生成完成`, currentUnit: episode.scenes.length }));
    // Return the updated visual asset collection as well as the episode so
    // the workspace can render newly generated boards without a manual reload.
    res.json({ episode, imageGeneration: project.imageGeneration });
  } catch (error) {
    try {
      const failedProject = await Screenplay.findOne({ _id: req.params.id, userId: req.userId });
      const failedEpisode = failedProject?.episodes?.find((item) => item.episodeNumber === Number(req.params.episodeNumber));
      if (failedProject && failedEpisode) {
        failedEpisode.generationReport = { ...(failedEpisode.generationReport && typeof failedEpisode.generationReport === 'object' ? failedEpisode.generationReport : {}), status: 'failed', lastError: error.message || '生成失败', failedAt: new Date() };
        await persistScreenplayEpisode(failedProject, Number(req.params.episodeNumber), failedEpisode);
      }
    } catch (persistError) { console.warn('[Screenplay] 保存失败状态失败:', persistError.message); }
    try {
      const task = await getLatestTask({ userId: req.userId, resourceId: req.params.id });
      if (task && task.kind === 'screenplay_episode' && task.metadata?.episodeNumber === Number(req.params.episodeNumber)) await failTask(task._id, error.message);
    } catch {}
    res.status(500).json({ message: error.message === 'TOKEN_EXHAUSTED' || error.message.includes('模型额度不足') ? '模型额度不足，请检查所选线路' : '生成单集剧本失败', error: redactError(error.message) });
  } finally {
    if (episodeLockKey) activeEpisodeWorkers.delete(episodeLockKey);
  }
}));

router.get('/projects/:id/generation-task', auth, async (req, res) => {
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId }).select('_id status episodes');
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    const task = await getLatestTask({ userId: req.userId, resourceId: project._id });
    const batchTask = await getLatestTask({ userId: req.userId, resourceId: project._id, kind: 'screenplay_batch' });
    res.json({ task, batchTask, project: { status: project.status, episodes: (project.episodes || []).map((episode) => ({ episodeNumber: episode.episodeNumber, status: episode.generationReport?.status || (episode.scenes?.length ? 'completed' : 'queued'), sceneCount: episode.scenes?.length || 0 })) } });
  } catch (error) {
    res.status(500).json({ message: '获取剧本任务状态失败', error: redactError(error.message) });
  }
});

router.post('/projects/:id/batch/start', auth, async (req, res) => {
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId });
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    const requested = Array.isArray(req.body?.episodeNumbers) ? req.body.episodeNumbers.map(Number).filter(Number.isFinite) : [];
    const mode = req.body?.mode === 'quality_repair' ? 'quality_repair' : 'generate';
    const episodeNumbers = [...new Set((requested.length ? requested : (project.episodes || []).map((episode) => episode.episodeNumber)).filter((number) => {
      const episode = project.episodes.find((item) => item.episodeNumber === number);
      if (!episode) return false;
      return mode === 'quality_repair' ? episodeNeedsRepair(episode) : episodeIsUnfinished(episode);
    }))].sort((a, b) => a - b);
    if (!episodeNumbers.length) return res.status(400).json({ message: '没有需要生成的分集' });
    const existing = await getLatestTask({ userId: req.userId, resourceId: project._id, kind: 'screenplay_batch' });
    if (existing && ['queued', 'running'].includes(existing.status)) {
      void runScreenplayBatchWorker(existing, req.headers.authorization, req.headers['x-mn-model-config']);
      return res.json({ task: existing, resumed: true });
    }
    if (await isCreativeBusy('screenplay:' + project._id + ':batch')) return res.status(409).json({ message: '后台正在完成本集并保存，请稍后再恢复' });
    const task = await beginTask({
      userId: req.userId,
      kind: 'screenplay_batch',
      resourceType: 'screenplay',
      resourceId: project._id,
      idempotencyKey: `screenplay-batch:${project._id}:${Date.now()}`,
      totalUnits: episodeNumbers.length,
      metadata: { episodeNumbers, completedEpisodes: [], failedEpisodes: [], failedDetails: [], currentEpisode: 0, mode },
    });
    await updateTask(task?._id, { stage: 'queued', progress: `已排队，共 ${episodeNumbers.length} 集` });
    const responseTask = await getLatestTask({ userId: req.userId, resourceId: project._id, kind: 'screenplay_batch' });
    res.status(202).json({ task: responseTask });
    void runScreenplayBatchWorker(responseTask, req.headers.authorization, req.headers['x-mn-model-config']);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? '已有后台批量任务，请等待当前任务结束' : '创建批量生成任务失败', error: error.code === 11000 ? '' : error.message });
  }
});

router.post('/projects/:id/batch/progress', auth, async (req, res) => {
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId }).select('_id');
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    const task = await getLatestTask({ userId: req.userId, resourceId: project._id, kind: 'screenplay_batch' });
    if (!task) return res.status(404).json({ message: '批量生成任务不存在' });
    const episodeNumber = Number(req.body?.episodeNumber || 0);
    const success = req.body?.success !== false;
    const completedEpisodes = [...new Set([...(task.metadata?.completedEpisodes || []), ...(success && episodeNumber ? [episodeNumber] : [])])];
    const failedEpisodes = [...new Set([...(task.metadata?.failedEpisodes || []), ...(!success && episodeNumber ? [episodeNumber] : [])])];
    const queue = task.metadata?.episodeNumbers || [];
    const finished = completedEpisodes.length + failedEpisodes.length >= queue.length;
    const updated = finished
      ? await completeTask(task._id, { progress: `批量生成完成：成功 ${completedEpisodes.length} 集，失败 ${failedEpisodes.length} 集`, currentUnit: queue.length, metadata: { ...task.metadata, completedEpisodes, failedEpisodes, currentEpisode: episodeNumber } })
      : await updateTask(task._id, { status: 'running', stage: success ? 'episode_saved' : 'episode_failed', progress: `已处理 ${completedEpisodes.length + failedEpisodes.length}/${queue.length} 集`, currentUnit: completedEpisodes.length + failedEpisodes.length, metadata: { ...task.metadata, completedEpisodes, failedEpisodes, currentEpisode: episodeNumber } });
    res.json({ task: updated });
  } catch (error) {
    res.status(500).json({ message: '更新批量生成进度失败', error: redactError(error.message) });
  }
});

router.post('/projects/:id/batch/cancel', auth, async (req, res) => {
  try {
    const project = await Screenplay.findOne({ _id: req.params.id, userId: req.userId }).select('_id');
    if (!project) return res.status(404).json({ message: '剧本项目不存在' });
    const task = await getLatestTask({ userId: req.userId, resourceId: project._id, kind: 'screenplay_batch' });
    if (!task) return res.status(404).json({ message: '批量生成任务不存在' });
    const updated = await updateTask(task._id, { status: 'paused', stage: 'paused', progress: '批量生成已暂停', cancellationRequested: true });
    res.json({ task: updated });
  } catch (error) {
    res.status(500).json({ message: '暂停批量生成失败', error: redactError(error.message) });
  }
});

module.exports = router;
module.exports.getScriptRequirements = getScriptRequirements;
module.exports.MAX_SCREENPLAY_DURATION_SECONDS = MAX_SCREENPLAY_DURATION_SECONDS;
module.exports.MAX_SCREENPLAY_OUTPUT_TOKENS = MAX_SCREENPLAY_OUTPUT_TOKENS;
module.exports.normalizeScreenplayGeneration = normalizeScreenplayGeneration;
module.exports.getScreenplayOutputTokens = getScreenplayOutputTokens;
module.exports.parseJsonObject = parseJsonObject;
module.exports.assessScreenplayQuality = assessScreenplayQuality;
module.exports.screenplayText = screenplayText;
module.exports.screenplayMarkdown = screenplayMarkdown;
module.exports.screenplayHtml = screenplayHtml;
module.exports.buildScreenplayPersonaDirective = buildScreenplayPersonaDirective;
module.exports.normalizeConceptExpansion = normalizeConceptExpansion;
module.exports.fillRepairExecutionFields = fillRepairExecutionFields;
module.exports.characterVisualAnchors = characterVisualAnchors;
module.exports.isProxyableImageUrl = isProxyableImageUrl;
module.exports.appendImageAsset = appendImageAsset;
module.exports.persistImageState = persistImageState;
