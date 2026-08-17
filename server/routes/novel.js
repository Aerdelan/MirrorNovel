const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const Novel = require('../models/Novel');
const User = require('../models/User');
const novelTypes = require('../config/novelTypes');
const novelTemplates = require('../config/novelTemplates');
const { typeTemplates, buildTemplatePrompt } = novelTemplates;
const {
  buildSystemPrompt, buildInitialPrompt, buildContinuePrompt,
  buildImportContinuePrompt, buildOutlinePrompt,
  buildChapterPlan, buildStoryStateSummary,
  buildOptimizeAnalysisPrompt, buildOptimizeChapterPrompt, extractChapterSummary,
  streamGenerate, resolveApiConfig, countTokens, humanizeRewrite, getFriendlyErrorMessage,
} = require('../services/aiService');
const {
  buildAugmentedContext,
  buildContextFromDocs,
  summarizeChapterForDoc,
  updateForeshadowingDoc,
} = require('../services/novelContext');
const { processChapter } = require('../services/chapterToolchain');
const { runEditorialPipeline, STAGES } = require('../services/editorialEngine');
const {
  parseChapterPlan,
  initializeCreativeState,
  buildChapterContract,
  renderChapterContract,
  checkChapterContinuity,
  extractEventSignature,
  updateCreativeState,
  renderPlanForContext,
  seedPlannedHooks,
} = require('../services/storyState');
const {
  calculatePointsCharge,
  debitPointsForUser,
  getPointsSnapshot,
  isPointsBillingRequired,
  routeIdForModelConfig,
} = require('../services/pointsService');
const { claimAutoActivitiesForUser } = require('../services/activityService');

// 全局活跃生成流跟踪
const activeStreams = new Map();

function getCompletedWordCount(novel) {
  return (novel.chapters || []).reduce((sum, chapter) => sum + Number(chapter.wordCount || 0), 0);
}

function getHighestChapterNumber(novel) {
  return (novel.chapters || []).reduce((highest, chapter) => Math.max(highest, Number(chapter.chapterNumber || 0)), 0);
}

function getTotalPlannedChapters(planData, targetWordCount, completedChapterNumber = 0) {
  const planned = (planData && Array.isArray(planData.chapters) ? planData.chapters : [])
    .map((chapter) => Number(chapter.chapterNumber || 0))
    .filter(Boolean);
  if (planned.length) return Math.max(...planned);
  const target = Number(targetWordCount) || 50000;
  return Math.max(Number(completedChapterNumber || 0) + 1, Math.ceil(target / 3000));
}

function getChapterTemperature(contract) {
  const tension = Number(contract?.emotion?.tension || 6);
  const value = Math.max(0.72, Math.min(0.86, 0.78 + (tension - 5) * 0.012));
  // Some OpenAI-compatible providers reject a temperature with over two decimals.
  return Number(value.toFixed(2));
}

function appendChapterContextDocs(novel, content, chapterNumber, protagonistName) {
  try {
    const summary = summarizeChapterForDoc(content, chapterNumber, protagonistName);
    novel.chapterSummaryDoc = novel.chapterSummaryDoc ? `${novel.chapterSummaryDoc}\n${summary}` : summary;
    if (novel.chapterSummaryDoc.length > 16000) novel.chapterSummaryDoc = novel.chapterSummaryDoc.slice(-16000);
  } catch (error) {
    console.warn('[Doc] 章节摘要更新失败:', error.message);
  }

  try {
    novel.foreshadowingDoc = updateForeshadowingDoc(content, chapterNumber, novel.foreshadowingDoc || '');
  } catch (error) {
    console.warn('[Doc] 伏笔追踪更新失败:', error.message);
  }
}

function finalizeGeneratedChapter({ novel, chapterNumber, rawContent, contract, protagonistName, status = 'generating' }) {
  let finalContent = String(rawContent || '').trim();
  let toolchainReport = {};

  if (finalContent.length > 100) {
    try {
      const result = processChapter(finalContent, {
        doDeAI: true,
        doPunctuation: true,
        doAutoFormat: true,
        doHumanize: false,
        doRhythmRandomize: false,
        genre: novel.novelTypeId || '',
      });
      finalContent = String(result.text || '').trim();
      toolchainReport = result.report || {};
    } catch (error) {
      console.warn('[Toolchain] 第' + chapterNumber + '章后处理失败:', error.message);
    }
  }

  if (finalContent.length < 80) throw new Error('本章生成内容过短，未保存为正式章节');
  if ((novel.chapters || []).some((chapter) => Number(chapter.chapterNumber) === Number(chapterNumber))) {
    throw new Error(`第${chapterNumber}章已存在，已阻止重复写入`);
  }

  const previousChapter = (novel.chapters || []).length ? novel.chapters[novel.chapters.length - 1] : null;
  const continuity = checkChapterContinuity(finalContent, previousChapter, contract);
  novel.chapters.push({
    chapterNumber,
    title: `第${chapterNumber}章`,
    content: finalContent,
    wordCount: finalContent.length,
    qualityReport: {
      score: continuity.score,
      issues: continuity.issues,
      eventSignature: continuity.eventSignature,
      toolchain: toolchainReport,
    },
  });
  updateCreativeState(novel, chapterNumber, finalContent, contract, continuity);
  appendChapterContextDocs(novel, finalContent, chapterNumber, protagonistName);
  novel.currentWordCount = getCompletedWordCount(novel);
  novel.currentChapterIndex = Math.max(Number(novel.currentChapterIndex || 0), Number(chapterNumber));
  novel.status = status;
  novel.markModified('chapters');
  novel.markModified('foreshadowingLedger');
  novel.markModified('emotionCurve');
  novel.markModified('recentEventSignatures');
  return { content: finalContent, wordCount: finalContent.length, continuity, toolchainReport };
}

function prepareCreativeState(novel) {
  initializeCreativeState(novel);
  const planData = parseChapterPlan(
    novel.chapterPlanData && Array.isArray(novel.chapterPlanData.chapters)
      ? novel.chapterPlanData
      : (novel.chapterPlan || '')
  );
  seedPlannedHooks(novel, planData);
  if (!novel.recentEventSignatures.length && (novel.chapters || []).length) {
    novel.recentEventSignatures = novel.chapters
      .slice(-5)
      .map((chapter) => extractEventSignature(chapter.content))
      .filter(Boolean);
  }
  novel.chapterPlanData = planData;
  novel.markModified('chapterPlanData');
  novel.markModified('recentEventSignatures');
  return planData;
}

// 获取所有小说类型
router.get('/types', (req, res) => {
  res.json(novelTypes);
});

// 单独生成大纲（同步返回，供前端弹窗确认使用）
router.post('/generate-outline', auth, async (req, res) => {
  try {
    const { novelTypeId, protagonistName, worldSetting, targetWordCount, structureRef } = req.body;
    if (!novelTypeId) return res.status(400).json({ message: '请选择小说类型' });

    let type = novelTypes.find(t => t.id === novelTypeId || t.name === novelTypeId);
    if (!type) {
      try {
        const typeData = require('../config/novelTypeData');
        const allCats = [...(typeData.male || []), ...(typeData.female || [])];
        const found = allCats.find(c => c.name === novelTypeId);
        if (found) type = { id: novelTypeId, name: found.name, icon: found.icon, keywords: '', outline: '' };
        else type = { id: novelTypeId, name: novelTypeId, icon: '📄', keywords: '', outline: '' };
      } catch { type = { id: novelTypeId, name: novelTypeId, icon: '📄', keywords: '', outline: '' }; }
    }

    // 如果有参考结构，提取世界观但不再强制大纲雷同
    let effectiveWorld = worldSetting;
    let outlinePrompt;
    if (structureRef) {
      // 从参考结构中提取世界观设定作为参考
      const worldMatch = structureRef.match(/【世界观设定】([\s\S]*?)(?=【|$)/);
      const plotMatch = structureRef.match(/【剧情整体走向】([\s\S]*?)(?=【|$)/);
      effectiveWorld = worldMatch ? worldMatch[1].trim() : (worldSetting || '由参考小说设定');

      outlinePrompt = `你是一位专业的小说大纲策划师。用户上传了一本参考小说，要求参考其结构模式进行**创新性再创作**，生成一本全新的原创小说。

主角名字：${protagonistName || '未设定'}
世界观设定（来自参考小说，可以调整）：${effectiveWorld}
目标总字数：约${targetWordCount}字

【参考小说的结构模式】
以下是参考小说的结构分析，请参考其**结构模式**（如冲突类型、节奏安排、阶段划分等），但不要照搬具体情节：
${structureRef}

⚠️ 核心原则：
1. **不得直接复制原小说的具体情节、事件、场景和冲突**。必须全新创作具体内容。
2. 参考其**结构模板**（如"主角成长→遇到挑战→突破瓶颈"这种抽象模式），填入全新的情节素材
3. 改变冲突的具体表现方式：如果原小说是"武林争霸"，你可以写成"商业竞争"或"宫廷斗争"
4. 调整章节顺序和事件分布：将原小说的前半与后半打乱重组，或添加全新的事件节点
5. 角色名称使用参考结构中"AI生成替换名称"部分提供的新名称
6. 如果与原小说情节雷同，将被内容平台判定为抄袭下架，所以必须确保每个情节都是原创的

请按以下格式输出大纲：

【故事主线】
（一个全新的原创故事线，只保留参考小说的结构骨架）

【核心冲突】
（生成全新的具体冲突，不要复刻原小说的冲突设定）

【主要角色】
（使用参考结构中提供的新名称，但重新设计角色关系和性格）

【剧情阶段】
（参考参考小说的阶段数量和节奏比例，但每个阶段的内容必须全新创作）

【结局方向】
（参考参考小说的结局类型，但具体实现方式必须原创）

【关键节点】
（参考参考小说的关键节奏点位置，但每个节点的具体事件必须原创）`;
    } else {
      outlinePrompt = buildOutlinePrompt(novelTypeId, protagonistName, worldSetting, targetWordCount);
    }

    const systemPrompt = structureRef
      ? '你是一位专业的小说大纲策划师。用户提供了参考小说的结构模式，你必须参考其结构骨架进行创新性再创作。输出的大纲必须是在结构上与原文相似，但在具体情节、冲突、事件上完全不同的原创作品。避免抄袭，确保每个情节都是全新的。'
      : '你是一位专业的小说大纲策划师。';

    const result = await streamGenerate(
      systemPrompt, outlinePrompt, null, null,
      resolveApiConfig(req.user?.modelConfig, 'writing')
    );

    const outline = result.content || '';
    if (!outline) return res.status(500).json({ message: '大纲生成失败' });

    res.json({ outline });
  } catch (error) {
    console.error('大纲生成失败:', error);
    res.status(500).json({ message: '大纲生成失败', error: error.message });
  }
});

// 创建新小说并开始生成（SSE流式）
router.post('/generate', auth, async (req, res) => {
  try {
    await checkTokenBalance(req.user);

    let { novelTypeId, protagonistName, worldSetting, targetWordCount, referenceIds } = req.body;
    if (!novelTypeId) return res.status(400).json({ message: '请选择小说类型' });
    targetWordCount = Number(targetWordCount) || 50000;
    // 支持新旧两种类型系统：先用旧 ID 查找，失败则用名称匹配
    let type = novelTypes.find(t => t.id === novelTypeId || t.name === novelTypeId);
    if (!type) {
      // 从 full type data 中获取名称作为 fallback
      try {
        const typeData = require('../config/novelTypeData');
        const allCats = [...(typeData.male || []), ...(typeData.female || [])];
        const found = allCats.find(c => c.name === novelTypeId);
        if (found) type = { id: novelTypeId, name: found.name, icon: found.icon, keywords: '', outline: '' };
        else type = { id: novelTypeId, name: novelTypeId, icon: '📄', keywords: '', outline: '' };
      } catch { type = { id: novelTypeId, name: novelTypeId, icon: '📄', keywords: '', outline: '' }; }
    }

    const mode = req.body.mode || 'book';
    const isBook = mode === 'book';
    const structureRef = req.body.structureRef || '';

    // 如果启用了参考结构，强制使用参考小说的世界观设定
    if (structureRef) {
      const worldMatch = structureRef.match(/【世界观设定】([\s\S]*?)(?=【|$)/);
      if (worldMatch) {
        worldSetting = worldMatch[1].trim();
      }
    }

    // 创建小说记录
    const novel = new Novel({
      userId: req.userId,
      title: `${type.name}：${protagonistName || '未命名'}的传奇`,
      novelTypeId, novelTypeName: type.name,
      protagonistName: protagonistName || '', worldSetting: worldSetting || '',
      targetWordCount,
      status: 'generating', batchIndex: 0,
    });

    // 构建系统提示词（含参考风格注入）
    let systemPrompt = buildSystemPrompt(novelTypeId);

    // 如果有参考风格 ID，获取其风格数据注入提示词
    if (referenceIds && Array.isArray(referenceIds) && referenceIds.length > 0) {
      try {
        const ReferenceNovel = require('../models/ReferenceNovel');
        const refs = await ReferenceNovel.find({ _id: { $in: referenceIds } })
          .select('title styleProfile writingCharacteristics vocabularyBank chapterStructure');
        if (refs.length > 0) {
          const refSection = refs.map((r, i) => {
            return `【参考风格 ${i + 1}: ${r.title}】
${r.styleProfile ? '风格描述：' + r.styleProfile : ''}
${r.writingCharacteristics ? '写作特点：' + r.writingCharacteristics : ''}
${r.vocabularyBank && r.vocabularyBank.length > 0 ? '特色词汇：' + r.vocabularyBank.join(', ') : ''}
${r.chapterStructure ? '章节结构：' + r.chapterStructure : ''}`;
          }).join('\n\n');

          systemPrompt += `\n\n【参考风格库】
以下是由用户选择的参考小说风格数据，请在创作时充分学习并融合这些风格特征：

${refSection}

请在保持轻小说整体风格的前提下，融合以上参考作品的行文特点和叙事风格。`;
        }
      } catch (e) {
        console.error('加载参考风格失败:', e.message);
      }
    }

    // 如果有小说结构参考（上传参考小说 → 提取结构 → 替换名称）
    // ⚠️ 此注入可能在模板匹配时被覆盖，模板匹配逻辑中有重新注入
    if (structureRef) {
      systemPrompt += `\n\n【参考小说结构（名称已替换）—— 参考结构模式，创作全新内容】
用户上传了一本参考小说，要求参考其结构模式进行**创新性再创作**。以下内容作为创作蓝图参考：

⚠️ 核心要求：
1. **禁止直接复制参考小说的具体情节、事件、场景、对话** — 必须全新创作
2. 参考其**结构骨架**（冲突节奏、阶段划分、角色弧线类型），填入全新的情节素材
3. 改变冲突的具体表现形式（如原小说是武力冲突，可改为权谋/商战/情感冲突）
4. 重新设计角色关系和人物性格，避免人物关系与原小说雷同
5. 调整章节顺序和事件分布，可打乱重组、添加新的事件节点
6. 世界观设定可参考但允许自行调整和延伸

【参考小说的结构模板】
${structureRef}

注意：本参考仅提供结构模式参考。**如果生成的内容与原小说情节雷同，将被内容平台判定为抄袭下架**，因此必须确保每个具体情节和冲突都是原创的。`;
    }

    // 类型模板匹配 — 先推断 gender 重建系统提示，再注入动态模板
    try {
      const matchedTmpls = matchTemplates(worldSetting || '', novelTypeId);
      if (matchedTmpls.length > 0) {
        const tmpl = matchedTmpls[0];
        // 根据匹配到的 gender 重新构建系统提示（男女频写作指导不同）
        const baseSys = buildSystemPrompt(novelTypeId, tmpl.gender || 'male');

        const genderTag = tmpl.gender === 'female' ? '女频' : tmpl.gender === 'unisex' ? '通用' : '男频';

        systemPrompt = baseSys + `\n\n【类型模板参考（${genderTag} · ${tmpl.name} · 匹配度 ${tmpl.score}%）】
以下是系统根据「${tmpl.name}」类型和你的世界观设定自动生成的创作参考。
⚠️ 重要提示：你的原始设定始终占主导地位，以下内容仅为辅助参考，每次生成时随机组合不同变体以保证多样性。

${tmpl.dynamicPrompt}

注意：以上为动态生成的参考组合，每次生成会随机选择不同的写作变体、节奏和看点，请根据你的故事主线灵活运用。`;

        // 如果启用了参考结构，在模板之后重新注入（因为 buildSystemPrompt 覆盖了之前的注入）
        if (structureRef) {
          systemPrompt += `\n\n【参考小说结构（名称已替换）—— 参考结构模式，创作全新内容】
⚠️ 核心要求：
1. **禁止直接复制参考小说的具体情节、事件、场景、对话** — 必须全新创作
2. 参考其**结构骨架**（冲突节奏、阶段划分、角色弧线类型），填入全新的情节素材
3. 改变冲突的具体表现形式（如原小说是武力冲突，可改为权谋/商战/情感冲突）
4. 重新设计角色关系和人物性格
5. 可调整章节顺序和事件分布，添加新的事件节点
6. **若与原小说情节雷同，将被判定为抄袭下架**

【参考小说的结构模板】
${structureRef}

注意：本参考仅提供结构模式参考。所有具体情节和冲突必须全新创作，不得直接搬运。`;
        }
      }
    } catch (e) {
      console.error('模板匹配注入失败:', e.message);
    }

    novel.generationContext = systemPrompt;
    await novel.save();

    // SSE（先发，让客户端知道连接已建立）
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify({ type: 'novel_created', novelId: novel._id })}\n\n`);

    // ====== 循环生成（提前声明，让close handler可以引用） ======
    let abortController = new AbortController();
    let generationDone = false;
    const streamKey = novel._id.toString();
    activeStreams.set(streamKey, abortController);

    let currentChapterNum = 1;

    // 客户端断开（全局，优先注册防止大纲阶段丢失）
    req.on('close', async () => {
      if (!generationDone) {
        console.log(`⚠️ 客户端断开连接（currentCh=${currentChapterNum}, done=${generationDone}），继续后台生成`);
        // 后台生成继续运行，并保留 controller 供 /pause 主动中断。
      }
    });

    // ====== 自动生成大纲（整本模式且用户未填写，300秒超时） ======
    let outline = req.body.outline || '';
    let outlineHb = null;
    if (isBook && !outline) {
      res.write(`data: ${JSON.stringify({ type: 'status', message: '正在根据您的设定生成创作大纲（可能需要1-3分钟）...' })}\n\n`);
      const outlinePrompt = buildOutlinePrompt(novelTypeId, protagonistName, worldSetting, targetWordCount);
      try {
        outlineHb = setInterval(() => {
          try { res.write(': outline-heartbeat\n\n'); } catch { clearInterval(outlineHb); }
        }, 10000);
        const ac = new AbortController();
        const t = setTimeout(() => { try { ac.abort(); } catch {}; console.log('大纲生成超时(300s)'); }, 300000);
        const outlineResult = await streamGenerate(
          '你是一位专业的小说大纲策划师。',
          outlinePrompt, null, ac.signal,
          resolveApiConfig(req.user?.modelConfig, 'writing')
        );
        clearTimeout(t); clearInterval(outlineHb); outlineHb = null;
        outline = outlineResult.content || '';
        if (outline) {
          novel.outline = outline;
          await novel.save();
          res.write(`data: ${JSON.stringify({ type: 'outline', content: outline })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'status', message: '大纲已生成，开始创作正文...' })}\n\n`);
        } else {
          throw new Error('大纲内容为空');
        }
      } catch (e) {
        if (outlineHb) clearInterval(outlineHb);
        console.error('大纲生成失败:', e.message);
        res.write(`data: ${JSON.stringify({ type: 'status', message: '大纲生成暂不可用，继续创作...' })}\n\n`);
      }
    } else if (outline) {
      novel.outline = outline;
      await novel.save();
    }

    // ====== 生成章节计划表（整本模式） ======
    let chapterPlan = '';
    if (isBook && outline) {
      try {
        res.write(`data: ${JSON.stringify({ type: 'status', message: '正在制定章节计划表...' })}\n\n`);
        const planPrompt = buildChapterPlan(outline, targetWordCount, protagonistName, worldSetting, structureRef);

        // 用 AbortController 施加超时 + 心跳保证连接不断
        const planController = new AbortController();
        const planTimeout = setTimeout(() => {
          console.log('章节计划表生成超时(150s)，将在重试后继续');
          planController.abort();
        }, 150000); // 150 秒超时
        const heartbeat = setInterval(() => {
          try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
        }, 10000);

        const planResult = await streamGenerate(
          '你是一位专业的小说章节规划师。你的任务是制定详细的章节计划表，确保每章有明确目标、伏笔合理铺设和回收、结局节奏自然。',
          planPrompt, null, planController.signal,
          resolveApiConfig(req.user?.modelConfig, 'writing')
        ).finally(() => { clearTimeout(planTimeout); clearInterval(heartbeat); });

        if (planResult && planResult.content) {
          chapterPlan = planResult.content;
          novel.chapterPlan = chapterPlan;
          const parsedPlan = parseChapterPlan(chapterPlan);
          novel.chapterPlanData = parsedPlan;
          initializeCreativeState(novel);
          seedPlannedHooks(novel, parsedPlan);
          novel.markModified('chapterPlanData');
          await novel.save();
          const planChCount = parsedPlan.chapters.length || (chapterPlan.match(/第\d+章/g) || []).length;
          res.write(`data: ${JSON.stringify({ type: 'status', message: `章节计划已制定（共 ${planChCount} 章）` })}\n\n`);
        } else {
          console.warn('章节计划表生成为空内容，将暂停整本生成');
        }
      } catch (e) {
        console.error('章节计划生成失败:', e.message, '将暂停整本生成');
        res.write(`data: ${JSON.stringify({ type: 'status', message: '章节计划生成暂不可用，准备暂停并等待补充计划...' })}\n\n`);
      }
    }

    // 正文生成始终从同一份结构化创作状态开始，兼容旧作品的纯文本计划。
    if (chapterPlan) novel.chapterPlan = chapterPlan;
    const planData = prepareCreativeState(novel);
    await novel.save();

    // 整本生成必须建立在可机读章节计划上。计划生成失败时暂停，避免退化为无约束长循环。
    if (isBook && !planData.chapters.length) {
      generationDone = true;
      activeStreams.delete(streamKey);
      novel.status = 'paused';
      await novel.save();
      res.write(`data: ${JSON.stringify({ type: 'plan_needs_extension', message: '未获得有效章节计划，已暂停生成，请先补充或重新生成章节计划' })}\n\n`);
      res.end();
      return;
    }

    // ====== 循环生成 ======

    /** 生成并保存一个章节 */
    async function generateOneChapter(chNum, prompt, contract) {
      let buffer = '';

      try { res.write(`data: ${JSON.stringify({ type: 'chapter_start', chapterNumber: chNum, title: `第${chNum}章` })}\n\n`); } catch {}

      // 温度随章节压力稳定变化，避免每章随机切换作者声线。
      const chapterTemp = getChapterTemperature(contract);

      await streamGenerate(systemPrompt, prompt, (chunk) => {
        buffer += chunk;
        try { res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`); } catch {}
      }, abortController.signal, resolveApiConfig(req.user?.modelConfig, 'writing'), 2, chapterTemp);

      const chapterResult = finalizeGeneratedChapter({
        novel,
        chapterNumber: chNum,
        rawContent: buffer,
        contract,
        protagonistName,
      });
      await novel.save();
      if (chapterResult.continuity.issues.length) {
        try { res.write(`data: ${JSON.stringify({ type: 'quality_notice', chapterNumber: chNum, report: chapterResult.continuity })}\n\n`); } catch {}
      }
      await claimAutoActivitiesForUser(req.user, 'writing');
      await claimAutoActivitiesForUser(req.user, 'continuous');
      try { await deductTokens(req.user, chapterResult.content, `${systemPrompt}\n${prompt}`); } catch (e) {
        // 如果扣费失败（如 TOKEN_EXHAUSTED），记录下来但不中断生成流程
        if (e.message === 'TOKEN_EXHAUSTED') {
          console.warn(`[Token] 第${chNum}章扣费后 Token 已用完，后续循环会尽快停止`);
        } else {
          console.error('[Token] 扣费异常:', e.message);
        }
      }

      try { res.write(`data: ${JSON.stringify({ type: 'chapter_end', chapterNumber: chNum, wordCount: chapterResult.wordCount })}\n\n`); } catch {}
      return chapterResult;
    }

    console.log('开始正文循环生成，outline长度:', outline?.length || 0, 'aborted:', abortController.signal.aborted, '当前章节数:', novel.chapters.length);
    try {
      if (isBook) {
        // ====== 整本模式：严格按结构化章节计划创作 ======
        const totalPlannedChapters = getTotalPlannedChapters(planData, targetWordCount);
        let lastChapterContent = '';

        for (let ch = 1; ch <= totalPlannedChapters; ch++) {
          if (abortController.signal.aborted) break;

          // 每章开始前发心跳，保持 SSE 连接不超时
          try { res.write(': chapter-heartbeat\n\n'); } catch {}

          const currentTotal = getCompletedWordCount(novel);
          const remaining = targetWordCount - currentTotal;
          if (remaining <= 0) break;

          const contract = buildChapterContract({
            novel,
            chapterNumber: ch,
            totalChapters: totalPlannedChapters,
            planData,
            currentWords: currentTotal,
            targetWords: targetWordCount,
            previousChapter: novel.chapters.length ? novel.chapters[novel.chapters.length - 1] : null,
          });

          // 近期摘要和伏笔来自已落库状态；计划单独以紧凑结构注入。
          const contextFromDocs = buildContextFromDocs(
            novel.chapterSummaryDoc, novel.foreshadowingDoc, outline, '', ch,
            lastChapterContent ? extractChapterSummary(lastChapterContent) : ''
          );

          const chPrompt = `请继续创作这部${type.name}小说。

主角：${protagonistName || '未设定'}
世界观：${worldSetting || '自由发挥'}

【已写内容与当前状态】
${contextFromDocs || '（故事开场，先建立人物当下处境。）'}

【后续计划摘要】
${renderPlanForContext(planData, ch) || '按故事主线自然推进。'}

${renderChapterContract(contract)}

当前剩余目标约${remaining}字。
写作要求：
1. 只完成本章的唯一核心事件，并让因果、人物选择和章末状态自然衔接。
2. 用具体动作、感官和可见后果推进，不复述前情，不用抽象总结代替戏剧动作。
3. 对话应符合角色认知、关系和当下情绪，保留潜台词与停顿，但不要靠随机吐槽、走神或口头禅伪造人味。
4. 段落与句长随场景自然变化；沉重题材的喘息只能服务关系、信息或伏笔，不能突兀搞笑。
5. 不输出章节标题、提纲、说明或“【未完待续】”标签；结尾给出具体的下一步、未解问题或情绪余波。`;

          await ensureTokensLeft(req.user);
          const genResult = await generateOneChapter(ch, chPrompt, contract);
          lastChapterContent = genResult.content;
          currentChapterNum = ch + 1;
        }

        if (abortController.signal.aborted) {
          novel.status = 'paused';
          await novel.save();
          activeStreams.delete(streamKey);
          try { res.write(`data: ${JSON.stringify({ type: 'paused', message: '生成已暂停' })}\n\n`); res.end(); } catch {}
          return;
        }

        if (planData.chapters.length && getCompletedWordCount(novel) < targetWordCount * 0.72) {
          novel.status = 'paused';
          await novel.save();
          activeStreams.delete(streamKey);
          try { res.write(`data: ${JSON.stringify({ type: 'plan_needs_extension', message: '计划章节已写完但目标字数不足，为避免无计划扩写，已暂停等待扩展计划' })}\n\n`); res.end(); } catch {}
          return;
        }

        generationDone = true;
        activeStreams.delete(streamKey);
        novel.status = 'completed';
        await novel.save();
        res.write(`data: ${JSON.stringify({ type: 'completed', novelId: novel._id, totalWordCount: novel.currentWordCount })}\n\n`);
        res.end();

      } else {
        // ====== 单章模式：只生成一章 ======
        const contract = buildChapterContract({
          novel,
          chapterNumber: 1,
          totalChapters: 1,
          planData,
          currentWords: 0,
          targetWords: targetWordCount,
          previousChapter: null,
        });
        const userPrompt = `${buildInitialPrompt(novelTypeId, protagonistName, worldSetting, targetWordCount, mode, outline)}\n\n${renderChapterContract(contract)}\n\n请只输出正文，用具体事件和人物选择完成这章，不输出标题、提纲或“【未完待续】”标签。`;
        await ensureTokensLeft(req.user);
        await generateOneChapter(1, userPrompt, contract);

        generationDone = true;
        activeStreams.delete(streamKey);
        novel.status = 'completed';
        await novel.save();
        res.write(`data: ${JSON.stringify({ type: 'completed', novelId: novel._id, totalWordCount: novel.currentWordCount })}\n\n`);
        res.end();
      }
    } catch (streamError) {
      const isTokenExhausted = streamError?.message === 'TOKEN_EXHAUSTED' || streamError?.message?.includes('余额不足');
      const isAbort = streamError?.name === 'AbortError' || streamError?.message?.includes('abort');
      const isApiError = streamError?.isApiError;
      if (isTokenExhausted) {
        console.log('⚠️ Token 配额已耗尽，停止生成（novelId:', novel._id, ', completed:', novel.chapters.length, '章）');
      } else if (isAbort) {
        console.log('⚠️ 生成被中断/取消（novelId:', novel._id, ', completed:', novel.chapters.length, '章）');
      } else {
        console.error('❌ 正文生成失败:', streamError?.message || streamError);
      }
      novel.status = 'paused';
      await novel.save();
      activeStreams.delete(streamKey);
      try {
        if (isTokenExhausted) {
          res.write(`data: ${JSON.stringify({ type: 'token_exhausted', message: '积分已用完，请充值后继续' })}\n\n`);
        } else if (isApiError) {
          // AI API 错误，发送友好提示
          res.write(`data: ${JSON.stringify({ type: 'error', message: streamError.message || 'AI 服务暂时不可用，请稍后重试' })}\n\n`);
        } else if (isAbort) {
          res.write(`data: ${JSON.stringify({ type: 'paused', message: '生成已暂停' })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ type: 'error', message: '生成过程中出现错误，请稍后重试' })}\n\n`);
        }
        res.end();
      } catch {}
    }
  } catch (error) {
    console.error('生成小说失败:', error.message);
    // 如果 SSE 已建立，通过 SSE 发送错误
    if (res.headersSent) {
      try {
        const msg = error.isApiError ? error.message : '创建小说失败，请稍后重试';
        res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
        res.end();
      } catch {}
    } else {
      res.status(500).json({ message: error.isApiError ? error.message : '创建小说失败，请稍后重试' });
    }
  }
});

// 继续生成小说（SSE流式）—— 支持整本/单章模式
router.post('/continue/:novelId', auth, async (req, res) => {
  try {
    // 检查 Token 余额
    await checkTokenBalance(req.user);

    const novel = await Novel.findOne({ _id: req.params.novelId, userId: req.userId });
    if (!novel) {
      return res.status(404).json({ message: '小说不存在' });
    }

    if (novel.status === 'completed') {
      return res.status(400).json({ message: '小说已生成完成' });
    }

    const streamKey = novel._id.toString();
    if (activeStreams.has(streamKey)) {
      return res.status(409).json({ message: '这部小说正在生成，请等待当前任务完成或先暂停' });
    }

    const mode = req.body.mode || 'chapter'; // 'chapter' | 'book'

    // 系统提示词
    const systemPrompt = novel.generationContext || buildSystemPrompt(novel.novelTypeId);
    const typeName = novel.novelTypeName || '未知';
    const protagonistName = novel.protagonistName || '';
    const worldSetting = novel.worldSetting || '';
    const outline = novel.outline || '';
    const targetWordCount = Number(novel.targetWordCount) || 50000;
    const planData = prepareCreativeState(novel);

    // 更新状态，并将旧作品的计划/事件签名补入结构化状态。
    novel.status = 'generating';
    await novel.save();

    // 设置 SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`data: ${JSON.stringify({ type: 'continue_start', novelId: novel._id })}\n\n`);

    let abortController = new AbortController();
    let generationDone = false;
    activeStreams.set(streamKey, abortController);

    req.on('close', async () => {
      if (!generationDone) {
        console.log(`⚠️ [Continue] 客户端断开连接（novelId=${novel._id}），继续后台生成`);
        // 后台生成仍保留 controller，/pause 才能真正中断它。
      }
    });

    /** 生成并保存一个章节（内部函数） */
    async function generateOneChapter(chNum, prompt, contract) {
      let buffer = '';

      try { res.write(`data: ${JSON.stringify({ type: 'chapter_start', chapterNumber: chNum, title: `第${chNum}章` })}\n\n`); } catch {}

      const chapterTemp = getChapterTemperature(contract);

      await streamGenerate(systemPrompt, prompt, (chunk) => {
        buffer += chunk;
        try { res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`); } catch {}
      }, abortController.signal, resolveApiConfig(req.user?.modelConfig, 'writing'), 2, chapterTemp);

      const chapterResult = finalizeGeneratedChapter({
        novel,
        chapterNumber: chNum,
        rawContent: buffer,
        contract,
        protagonistName,
      });
      await novel.save();
      if (chapterResult.continuity.issues.length) {
        try { res.write(`data: ${JSON.stringify({ type: 'quality_notice', chapterNumber: chNum, report: chapterResult.continuity })}\n\n`); } catch {}
      }
      await claimAutoActivitiesForUser(req.user, 'writing');
      await claimAutoActivitiesForUser(req.user, 'continuous');
      try { await deductTokens(req.user, chapterResult.content, `${systemPrompt}\n${prompt}`); } catch (error) {
        if (error.message !== 'TOKEN_EXHAUSTED') console.error('[Token] 扣费异常:', error.message);
      }

      try { res.write(`data: ${JSON.stringify({ type: 'chapter_end', chapterNumber: chNum, wordCount: chapterResult.wordCount })}\n\n`); } catch {}
      return chapterResult;
    }

    try {
      if (mode === 'book') {
        // ====== 整本模式：循环生成多章直到目标字数 ======
        if (!planData.chapters.length) {
          novel.status = 'paused';
          await novel.save();
          activeStreams.delete(streamKey);
          try { res.write(`data: ${JSON.stringify({ type: 'plan_needs_extension', message: '缺少有效章节计划，请先生成或补充计划后再续写整本' })}\n\n`); res.end(); } catch {}
          return;
        }

        const currentTotal = getCompletedWordCount(novel);
        const remainingTarget = targetWordCount - currentTotal;
        if (remainingTarget <= 0) {
          generationDone = true;
          activeStreams.delete(streamKey);
          novel.status = 'completed';
          await novel.save();
          res.write(`data: ${JSON.stringify({ type: 'completed', novelId: novel._id, totalWordCount: novel.currentWordCount })}\n\n`);
          res.end();
          return;
        }

        const startCh = getHighestChapterNumber(novel) + 1;
        const totalPlannedChapters = getTotalPlannedChapters(planData, targetWordCount, startCh - 1);
        if (planData.chapters.length && startCh > totalPlannedChapters) {
          novel.status = 'paused';
          await novel.save();
          activeStreams.delete(streamKey);
          try { res.write(`data: ${JSON.stringify({ type: 'plan_needs_extension', message: '章节计划已执行完毕，请先扩展计划后再续写' })}\n\n`); res.end(); } catch {}
          return;
        }

        for (let ch = startCh; ch <= totalPlannedChapters; ch++) {
          if (abortController.signal.aborted) break;

          const curTotal = getCompletedWordCount(novel);
          const remaining = targetWordCount - curTotal;
          if (remaining <= 0) break;

          const contract = buildChapterContract({
            novel,
            chapterNumber: ch,
            totalChapters: totalPlannedChapters,
            planData,
            currentWords: curTotal,
            targetWords: targetWordCount,
            previousChapter: novel.chapters.length ? novel.chapters[novel.chapters.length - 1] : null,
          });
          const contextFromDocs = (novel.chapterSummaryDoc || novel.foreshadowingDoc)
            ? buildContextFromDocs(novel.chapterSummaryDoc, novel.foreshadowingDoc, outline, '', ch, '')
            : buildAugmentedContext(novel.chapters);

          const chPrompt = `请继续创作这部${typeName}小说。

主角：${protagonistName || '未设定'}
世界观：${worldSetting || '自由发挥'}

【已写内容与当前状态】
${contextFromDocs || '（故事开场，先建立人物当下处境。）'}

【后续计划摘要】
${renderPlanForContext(planData, ch) || '按故事主线自然推进。'}

${renderChapterContract(contract)}

当前剩余目标约${remaining}字。
写作要求：
1. 只完成本章唯一核心事件，推进至少一条主线或关系线，不复述已有剧情。
2. 通过行动、因果和人物选择衔接上一章；避免百科式解释、空泛升华和流水账。
3. 对话要符合人物认知与关系，有潜台词和自然停顿，但不靠随机吐槽或突兀搞笑制造人味。
4. 重题材的喘息内容必须带来关系、信息或伏笔变化；不输出标题、提纲或“【未完待续】”标签。`;

          await ensureTokensLeft(req.user);
          await generateOneChapter(ch, chPrompt, contract);
        }

        if (abortController.signal.aborted) {
          novel.status = 'paused';
          await novel.save();
          activeStreams.delete(streamKey);
          try { res.write(`data: ${JSON.stringify({ type: 'paused', message: '生成已暂停' })}\n\n`); res.end(); } catch {}
          return;
        }

        if (planData.chapters.length && getCompletedWordCount(novel) < targetWordCount * 0.72) {
          novel.status = 'paused';
          await novel.save();
          activeStreams.delete(streamKey);
          try { res.write(`data: ${JSON.stringify({ type: 'plan_needs_extension', message: '计划章节已写完但目标字数不足，为避免无计划扩写，已暂停等待扩展计划' })}\n\n`); res.end(); } catch {}
          return;
        }

        generationDone = true;
        activeStreams.delete(streamKey);
        novel.status = 'completed';
        await novel.save();
        res.write(`data: ${JSON.stringify({ type: 'completed', novelId: novel._id, totalWordCount: novel.currentWordCount })}\n\n`);
        res.end();

      } else {
        // ====== 单章模式：复用整本生成的契约、质量与持久化逻辑 ======
        const chapterNumber = getHighestChapterNumber(novel) + 1;
        const totalPlannedChapters = getTotalPlannedChapters(planData, targetWordCount, chapterNumber - 1);
        const contract = buildChapterContract({
          novel,
          chapterNumber,
          totalChapters: totalPlannedChapters,
          planData,
          currentWords: getCompletedWordCount(novel),
          targetWords: targetWordCount,
          previousChapter: novel.chapters.length ? novel.chapters[novel.chapters.length - 1] : null,
        });
        const userPrompt = `${buildContinuePrompt(novel._id, novel)}\n\n${renderChapterContract(contract)}\n\n仅输出正文。严格承接上一章，完成本章唯一核心事件；用人物行动和具体后果推进，不输出标题、提纲或“【未完待续】”标签。`;
        await ensureTokensLeft(req.user);
        await generateOneChapter(chapterNumber, userPrompt, contract);

        if (abortController.signal.aborted) {
          novel.status = 'paused';
          await novel.save();
          activeStreams.delete(streamKey);
          return;
        }

        generationDone = true;
        activeStreams.delete(streamKey);
        // completed 事件表示本次单章请求完成；作品仍可继续追加后续章节。
        novel.status = 'paused';
        await novel.save();

        res.write(`data: ${JSON.stringify({ type: 'completed', novelId: novel._id, totalWordCount: novel.currentWordCount })}\n\n`);
        res.end();
      }
    } catch (streamError) {
      const isTokenExhausted = streamError?.message === 'TOKEN_EXHAUSTED' || streamError?.message?.includes('余额不足');
      const isAbort = streamError?.name === 'AbortError' || streamError?.message?.toLowerCase().includes('abort');
      const isApiError = streamError?.isApiError;
      if (isTokenExhausted) console.log('继续生成 Token 配额已耗尽');
      else if (isAbort) console.log('继续生成已暂停');
      else console.error('继续生成失败:', streamError.message);
      novel.status = 'paused';
      await novel.save();
      activeStreams.delete(streamKey);
      try {
        if (isTokenExhausted) {
          res.write(`data: ${JSON.stringify({ type: 'token_exhausted', message: '积分已用完，请充值后继续' })}\n\n`);
        } else if (isAbort) {
          res.write(`data: ${JSON.stringify({ type: 'paused', message: '生成已暂停' })}\n\n`);
        } else if (isApiError) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: streamError.message || 'AI 服务暂时不可用，请稍后重试' })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ type: 'error', message: '续写过程中出现错误，请稍后重试' })}\n\n`);
        }
        res.end();
      } catch {}
    }
  } catch (error) {
    console.error('继续生成失败:', error.message);
    if (error.message?.includes('余额不足')) {
      return res.status(402).json({ message: '余额不足，请充值后再生成' });
    }
    const msg = error.isApiError ? error.message : '继续生成失败，请稍后重试';
    if (res.headersSent) {
      try { res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`); res.end(); } catch {}
    } else {
      res.status(500).json({ message: msg });
    }
  }
});

// 导入外部小说并续写（SSE流式）
router.post('/continue-import', auth, async (req, res) => {
  try {
    await checkTokenBalance(req.user);

    const { importedText, continuationRequest, novelTypeName, title, novelId } = req.body;

    if (!importedText || importedText.trim().length < 50) {
      return res.status(400).json({ message: '导入的小说内容太少（至少50字）' });
    }

    const typeName = novelTypeName || '自定义';
    let novel;
    let isAppend = false;
    let baseChapterNumber = 1;

    if (novelId) {
      // 追加到已有小说
      novel = await Novel.findOne({ _id: novelId, userId: req.userId });
      if (!novel) return res.status(404).json({ message: '原小说不存在' });
      isAppend = true;
      novel.status = 'generating';
      baseChapterNumber = (novel.currentChapterIndex || 0) + 1;
      await novel.save();
    } else {
      // 创建全新记录
      const novelTitle = title || `续写：${typeName}小说`;
      novel = new Novel({
        userId: req.userId,
        title: novelTitle,
        novelTypeId: 'custom',
        novelTypeName: typeName,
        worldSetting: '导入续写',
        targetWordCount: req.body.targetWordCount || 50000,
        status: 'generating',
        batchIndex: 0,
      });
      await novel.save();
    }

    // 构建续写系统提示词
    const systemPrompt = `你是一位专业的小说续写专家，擅长模仿各种文风进行创作。`;
    const mode = req.body.mode || 'book';
    const userPrompt = buildImportContinuePrompt(importedText, continuationRequest, typeName, req.body.targetWordCount || 50000, mode);

    novel.lastPrompt = userPrompt;
    novel.generationContext = systemPrompt;
    await novel.save();

    // SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`data: ${JSON.stringify({ type: 'novel_created', novelId: novel._id })}\n\n`);

    let chapterBuffer = '';
    let abortController = new AbortController();
    let generationDone = false;
    let lastAutoSave = 0;
    const chapterNumber = baseChapterNumber;
    const streamKey = novel._id.toString();
    activeStreams.set(streamKey, abortController);

    async function saveProgress(status = 'generating') {
      try {
        if (!chapterBuffer.trim()) return;
        const savedWords = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
        await Novel.findByIdAndUpdate(novel._id, { $set: { status, currentWordCount: savedWords + chapterBuffer.length } });
        lastAutoSave = Date.now();
      } catch (e) { console.error('自动保存失败:', e.message); }
    }

    async function finalSave(status = 'completed') {
      if (chapterBuffer.trim()) {
        novel.chapters.push({ chapterNumber, title: `第${chapterNumber}章`, content: chapterBuffer, wordCount: chapterBuffer.length });
      }
      const savedWords = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
      novel.currentWordCount = savedWords;
      novel.currentChapterIndex = chapterNumber;
      novel.status = status;
      await novel.save();
    }

    req.on('close', async () => {
      if (!generationDone) {
        abortController.abort();
        await finalSave('paused');
        try { await deductTokens(req.user, chapterBuffer, `${systemPrompt}\n${userPrompt}`); } catch {}
        activeStreams.delete(streamKey);
        try { res.write(`data: ${JSON.stringify({ type: 'paused' })}\n\n`); res.end(); } catch {}
      }
    });

    await ensureTokensLeft(req.user);
    res.write(`data: ${JSON.stringify({ type: 'chapter_start', chapterNumber, title: `第${chapterNumber}章` })}\n\n`);

    try {
      await streamGenerate(
        systemPrompt,
        userPrompt,
        (chunk) => {
          chapterBuffer += chunk;
          if (Date.now() - lastAutoSave > 5000) saveProgress('generating');
          res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
        },
        abortController.signal,
        resolveApiConfig(req.user?.modelConfig, 'writing')
      );

      if (abortController.signal.aborted) {
        await finalSave('paused');
        try { await deductTokens(req.user, chapterBuffer, `${systemPrompt}\n${userPrompt}`); } catch {}
        activeStreams.delete(streamKey);
        return;
      }

      generationDone = true;
      activeStreams.delete(streamKey);
      await finalSave('completed');
      try { await deductTokens(req.user, chapterBuffer, `${systemPrompt}\n${userPrompt}`); } catch {}

      res.write(`data: ${JSON.stringify({ type: 'chapter_end', chapterNumber, wordCount: chapterBuffer.length })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'completed', novelId: novel._id, totalWordCount: novel.currentWordCount })}\n\n`);
      res.end();
    } catch (streamError) {
      const isTokenExhausted = streamError?.message === 'TOKEN_EXHAUSTED' || streamError?.message?.includes('余额不足');
      if (isTokenExhausted) console.log('续写 Token 配额已耗尽');
      else console.error('续写失败:', streamError.message);
      try { await finalSave('paused'); } catch {}
      try { await deductTokens(req.user, chapterBuffer, `${systemPrompt}\n${userPrompt}`); } catch {}
      activeStreams.delete(streamKey);
      try {
        if (isTokenExhausted) {
          res.write(`data: ${JSON.stringify({ type: 'token_exhausted' })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ type: 'paused' })}\n\n`);
        }
        res.end();
      } catch {}
    }
  } catch (error) {
    console.error('续写失败:', error);
    if (error.message?.includes('余额不足')) {
      return res.status(402).json({ message: '余额不足，请充值后再生成', error: error.message });
    }
    res.status(500).json({ message: '续写失败', error: error.message });
  }
});

// 获取用户书架
router.get('/bookshelf', auth, async (req, res) => {
  try {
    const novels = await Novel.find({ userId: req.userId })
      .select('-chapters')
      .sort({ updatedAt: -1 });
    res.json(novels);
  } catch (error) {
    res.status(500).json({ message: '获取书架失败', error: error.message });
  }
});

// ---- 导出逻辑 ----
// 加载字体映射（用于解码番茄小说的反爬 PUA 字符）
let fontMapping = null
try { fontMapping = require('../services/font_mapping.json') } catch {}

function decodeContent(text) {
  if (!fontMapping || !text) return text
  const { decodeText } = require('../services/fontDecoder')
  return decodeText(text, fontMapping)
}

async function exportNovels(req, res) {
  const novelIds = req.body?.novelIds || (req.query.ids ? req.query.ids.split(',').filter(Boolean) : []);
  if (novelIds.length === 0) {
    return res.status(400).json({ message: '请选择要导出的书籍' });
  }

  const novels = await Novel.find({ _id: { $in: novelIds }, userId: req.userId });
  if (novels.length === 0) return res.status(404).json({ message: '未找到可导出的书籍' });

  const { ZipArchive } = require('archiver');
  const archive = new ZipArchive();
  archive.level = 9;

  const filename = encodeURIComponent('小说导出_' + Date.now() + '.zip');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  archive.pipe(res);

  for (const novel of novels) {
    const safeTitle = novel.title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
    let fullText = `【${novel.novelTypeName}】${novel.title}\n作者：${req.user.nickname || '书友'}\n主角：${novel.protagonistName || '未设定'}\n世界观设定：${novel.worldSetting || '自由发挥'}\n总字数：${novel.currentWordCount} / ${novel.targetWordCount}\n状态：${novel.status === 'completed' ? '已完成' : novel.status === 'generating' ? '生成中' : '已暂停'}\n${'='.repeat(50)}\n\n`;
    for (const ch of novel.chapters) {
      fullText += `第${ch.chapterNumber}章\n${'='.repeat(30)}\n${decodeContent(ch.content || '')}\n\n`;
    }
    archive.append(fullText, { name: `整本/${safeTitle}.txt` });

    for (const ch of novel.chapters) {
      const chText = `【${novel.novelTypeName}】${novel.title}\n第${ch.chapterNumber}章\n${'='.repeat(30)}\n\n${decodeContent(ch.content || '')}\n\n${'='.repeat(30)}\n本文字数：${ch.wordCount} 字`;
      archive.append(chText, { name: `分章节/${safeTitle}/第${String(ch.chapterNumber).padStart(3, '0')}章.txt` });
    }
  }
  archive.finalize();
}

// 导出小说（POST，由前端 auth 中间件鉴权）
router.post('/export', auth, async (req, res) => {
  try { await exportNovels(req, res); }
  catch (error) { console.error('导出失败:', error); res.status(500).json({ message: '导出失败', error: error.message }); }
});

// 导出小说（GET，用于手机浏览器直接导航下载）
router.get('/export', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).json({ message: '未登录' });
    const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
    req.user = await require('../models/User').findById(decoded.userId).select('-password');
    if (!req.user) return res.status(401).json({ message: '用户不存在' });
    req.userId = req.user._id;
    await exportNovels(req, res);
  } catch (error) {
    if (error.name === 'TokenExpiredError') return res.status(401).json({ message: '登录已过期' });
    console.error('导出失败:', error);
    res.status(500).json({ message: '导出失败', error: error.message });
  }
});

// 获取小说详情（含章节）
router.get('/:novelId', auth, async (req, res) => {
  try {
    const novel = await Novel.findOne({ _id: req.params.novelId, userId: req.userId });
    if (!novel) {
      return res.status(404).json({ message: '小说不存在' });
    }
    res.json(novel);
  } catch (error) {
    res.status(500).json({ message: '获取小说详情失败', error: error.message });
  }
});

// 删除小说
router.delete('/:novelId', auth, async (req, res) => {
  try {
    const result = await Novel.deleteOne({ _id: req.params.novelId, userId: req.userId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: '小说不存在' });
    }
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ message: '删除失败', error: error.message });
  }
});

// 暂停生成
router.post('/pause/:novelId', auth, async (req, res) => {
  try {
    const novel = await Novel.findOne({ _id: req.params.novelId, userId: req.userId });
    if (!novel) {
      return res.status(404).json({ message: '小说不存在' });
    }
    
    // 如果有活跃的流，中断它
    const streamKey = novel._id.toString();
    if (activeStreams.has(streamKey)) {
      activeStreams.get(streamKey).abort();
      activeStreams.delete(streamKey);
    }

    novel.status = 'paused';
    await novel.save();
    res.json({ message: '已暂停生成' });
  } catch (error) {
    res.status(500).json({ message: '暂停失败', error: error.message });
  }
});

// 更新大纲
router.put('/:novelId/outline', auth, async (req, res) => {
  try {
    const novel = await Novel.findOne({ _id: req.params.novelId, userId: req.userId });
    if (!novel) return res.status(404).json({ message: '小说不存在' });
    novel.outline = req.body.outline || '';
    await novel.save();
    res.json({ message: '大纲已更新', outline: novel.outline });
  } catch (error) {
    res.status(500).json({ message: '更新大纲失败', error: error.message });
  }
});

// ---- 章节操作 ----

// 删除章节
router.delete('/:novelId/chapter/:chapterNumber', auth, async (req, res) => {
  try {
    const novel = await Novel.findOne({ _id: req.params.novelId, userId: req.userId });
    if (!novel) return res.status(404).json({ message: '小说不存在' });

    const chNum = Number(req.params.chapterNumber);
    const idx = novel.chapters.findIndex(c => c.chapterNumber === chNum);
    if (idx === -1) return res.status(404).json({ message: '章节不存在' });

    const removed = novel.chapters.splice(idx, 1)[0];
    novel.currentWordCount = Math.max(0, novel.currentWordCount - (removed.wordCount || 0));
    // 重排章节号
    novel.chapters.forEach((c, i) => { c.chapterNumber = i + 1; });
    novel.currentChapterIndex = novel.chapters.length;
    await novel.save();
    res.json({ message: '章节已删除', chapters: novel.chapters, currentWordCount: novel.currentWordCount, currentChapterIndex: novel.currentChapterIndex });
  } catch (error) {
    res.status(500).json({ message: '删除失败', error: error.message });
  }
});

// 编辑章节
router.put('/:novelId/chapter/:chapterNumber', auth, async (req, res) => {
  try {
    const novel = await Novel.findOne({ _id: req.params.novelId, userId: req.userId });
    if (!novel) return res.status(404).json({ message: '小说不存在' });

    const chNum = Number(req.params.chapterNumber);
    const chapter = novel.chapters.find(c => c.chapterNumber === chNum);
    if (!chapter) return res.status(404).json({ message: '章节不存在' });

    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ message: '请提供内容' });

    // 重新计算字数
    novel.currentWordCount -= chapter.wordCount || 0;
    chapter.content = content;
    chapter.wordCount = content.length;
    novel.currentWordCount += chapter.wordCount;
    chapter.generatedAt = new Date();
    await novel.save();
    res.json({ message: '章节已更新', chapter });
  } catch (error) {
    res.status(500).json({ message: '编辑失败', error: error.message });
  }
});

// 继续生成/新建指定章节（SSE流式）
router.post('/:novelId/continue-chapter/:chapterNumber', auth, async (req, res) => {
  try {
    await checkTokenBalance(req.user);
    const novel = await Novel.findOne({ _id: req.params.novelId, userId: req.userId });
    if (!novel) return res.status(404).json({ message: '小说不存在' });
    const chNum = Number(req.params.chapterNumber);
    const { wordCount, notes } = req.body;

    let chapter = novel.chapters.find(c => c.chapterNumber === chNum);
    let systemPrompt, userPrompt;

    if (chapter) {
      const existing = (chapter.content || '').slice(-2000);
      systemPrompt = '你是一位专业的小说续写专家，请接着用户已有的章节内容继续往下写，保持风格一致。';
      userPrompt = `以下是该章节已有的结尾部分：\n\n${existing}\n\n请接着上面的内容继续往下写。\n${notes ? '写作方向/备注：' + notes : '保持原有风格继续推进剧情。'}\n目标字数：约${wordCount || 2000}字。\n请直接输出续写内容，不要重复已有内容。`;
    } else {
      const lastCh = novel.chapters[novel.chapters.length - 1];
      const lastContent = lastCh ? (lastCh.content || '').slice(-1500) : '（故事开始）';
      chapter = { chapterNumber: chNum, title: `第${chNum}章`, content: '', wordCount: 0 };
      novel.chapters.push(chapter);
      systemPrompt = '你是一位专业的小说家，请接着用户已有的小说内容创作下一章，保持风格一致。';
      userPrompt = `以下是上一章的结尾部分：\n\n${lastContent}\n\n请接着上面的内容创作第${chNum}章。\n${notes ? '写作方向/备注：' + notes : '保持原有风格继续推进剧情。'}\n目标字数：约${wordCount || 2000}字。\n请直接输出章节内容。`;
    }

    novel.status = 'generating';
    await novel.save();

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify({ type: 'chapter_start', chapterNumber: chNum, title: `第${chNum}章` })}\n\n`);

    let appendBuffer = '';
    let abortController = new AbortController();
    let generationDone = false;
    let lastAutoSave = 0;
    const streamKey = `${novel._id}_ch${chNum}`;
    activeStreams.set(streamKey, abortController);

    async function saveAppendProgress() {
      try {
        if (!appendBuffer.trim()) return;
        await Novel.findByIdAndUpdate(novel._id, { $set: { status: 'generating', currentWordCount: novel.currentWordCount + appendBuffer.length } });
        lastAutoSave = Date.now();
      } catch {}
    }

    function saveChapterContent(isFinal = false) {
      if (!appendBuffer.trim()) return;
      const idx = novel.chapters.findIndex(c => c.chapterNumber === chNum);
      if (idx > -1) {
        const newContent = (novel.chapters[idx].content || '') + appendBuffer;
        novel.chapters[idx].content = isFinal ? processChapter(newContent).text : newContent;
        novel.chapters[idx].wordCount = novel.chapters[idx].content.length;
        novel.markModified(`chapters.${idx}`);
      }
      novel.currentWordCount = (novel.currentWordCount || 0) + appendBuffer.length;
    }

    req.on('close', async () => {
      activeStreams.delete(streamKey);
      if (!generationDone) {
        abortController.abort();
        saveChapterContent(true);
        novel.status = 'paused'; await novel.save();
        try { await deductTokens(req.user, appendBuffer, `${systemPrompt}\n${userPrompt}`); } catch {}
        try { res.write(`data: ${JSON.stringify({ type: 'paused' })}\n\n`); res.end(); } catch {}
      }
    });

    try {
      await streamGenerate(systemPrompt, userPrompt, (chunk) => {
        appendBuffer += chunk;
        if (Date.now() - lastAutoSave > 5000) saveAppendProgress();
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
      }, abortController.signal, resolveApiConfig(req.user?.modelConfig, 'writing'));

      if (abortController.signal.aborted) {
        activeStreams.delete(streamKey);
        saveChapterContent(true);
        novel.status = 'paused'; await novel.save();
        try { await deductTokens(req.user, appendBuffer, `${systemPrompt}\n${userPrompt}`); } catch {}
        return;
      }

      generationDone = true;
      activeStreams.delete(streamKey);
      saveChapterContent(true);
      // completed 事件只表示本次指定章节续写完成，整部小说仍可继续创作。
      novel.status = 'paused'; await novel.save();
      await claimAutoActivitiesForUser(req.user, 'writing');
      await claimAutoActivitiesForUser(req.user, 'continuous');
      try { await deductTokens(req.user, appendBuffer, `${systemPrompt}\n${userPrompt}`); } catch {}

      res.write(`data: ${JSON.stringify({ type: 'chapter_continued', chapterNumber: chNum, addedLength: appendBuffer.length })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'completed' })}\n\n`);
      res.end();
    } catch (streamError) {
      activeStreams.delete(streamKey);
      saveChapterContent(true);
      novel.status = 'paused'; await novel.save();
      try { await deductTokens(req.user, appendBuffer, `${systemPrompt}\n${userPrompt}`); } catch {}
      try { res.write(`data: ${JSON.stringify({ type: 'paused' })}\n\n`); res.end(); } catch {}
    }
  } catch (error) {
    res.status(500).json({ message: '续写出错', error: error.message });
  }
});



// 获取所有novelType信息（用于前端图标映射）
router.get('/types/map', (req, res) => {
  const map = {};
  novelTypes.forEach(t => { map[t.id] = { icon: t.icon, name: t.name }; });
  res.json(map);
});

// ====== 类型模板匹配（增强版） ======

/**
 * 类型模板匹配函数
 * 根据用户输入的世界观文本，与 typeTemplates 的 keywords 计算相似度
 * 同时返回匹配的 gender 信息，供后续动态模板构建使用
 */
function matchTemplates(worldSetting, selectedType) {
  if (!worldSetting || !worldSetting.trim()) return [];

  const tokens = worldSetting
    .replace(/[，。！？、；：""''（）\n\r\s,\.!\?;:\(\)\[\]【】]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2)

  if (tokens.length === 0) return [];

  const matched = [];
  // 自动推断 gender（如果选中的类型在 typeTemplates 中有记录）
  let inferredGender = 'male';

  for (const tmpl of typeTemplates) {
    // 只匹配与当前选择类型相关的模板
    if (selectedType) {
      const isMainMatch = tmpl.name === selectedType
      const isSubMatch = selectedType.includes(tmpl.name) || tmpl.name.includes(selectedType)
      if (!isMainMatch && !isSubMatch) continue
    }

    // 记录 gender，用于后续区分
    if (tmpl.gender) inferredGender = tmpl.gender;

    const kw = tmpl.keywords || []
    if (kw.length === 0) continue

    let matchCount = 0
    for (const token of tokens) {
      for (const keyword of kw) {
        if (token.includes(keyword) || keyword.includes(token)) {
          matchCount++
          break
        }
      }
    }

    const userTokenRatio = tokens.length > 0 ? matchCount / tokens.length : 0
    const keywordRatio = matchCount / kw.length
    const score = Math.max(userTokenRatio, keywordRatio)

    if (score >= 0.2) {
      matched.push({ name: tmpl.name, score: Math.round(score * 100), gender: tmpl.gender })
    }
  }

  if (matched.length === 0) return [];

  // 使用 buildTemplatePrompt 生成动态、多样化的提示
  const dynamicPrompt = buildTemplatePrompt(matched, inferredGender)

  return [{
    name: matched[0].name,
    score: matched[0].score,
    gender: inferredGender,
    dynamicPrompt,
  }]
}

// 根据用户输入匹配类型模板（生成前调用）
router.post('/match-templates', auth, async (req, res) => {
  try {
    const { worldSetting, novelTypeId } = req.body;
    if (!worldSetting || !worldSetting.trim()) {
      return res.json({ matched: [] });
    }
    const matched = matchTemplates(worldSetting, novelTypeId);
    res.json({ matched });
  } catch (error) {
    console.error('模板匹配失败:', error);
    res.json({ matched: [] });
  }
});

// ---- Token 扣除辅助函数 ----
async function deductTokens(user, content, inputContent = '') {
  try {
    if (!user || !isPointsBillingRequired(user.modelConfig)) return null;

    return await debitPointsForUser(User, user._id, {
      routeId: routeIdForModelConfig(user.modelConfig),
      inputTokens: countTokens(inputContent || ''),
      outputTokens: countTokens(content || ''),
    }, { reason: 'novel_generation' });
  } catch (e) {
    if (e.code === 'POINTS_INSUFFICIENT' || e.message === 'TOKEN_EXHAUSTED') throw e;
    console.error('扣除积分失败(非致命):', e.message);
    return null;
  }
}

/**
 * 检查用户 token 余额是否足够，若不足则抛出错误
 */
async function checkTokenBalance(user) {
  if (!user || !isPointsBillingRequired(user.modelConfig)) return;
  const freshUser = await User.findById(user._id);
  if (!freshUser) return;
  const available = getPointsSnapshot(freshUser).available;
  if (available <= 0) {
    const error = new Error('积分余额不足，请充值后再生成');
    error.code = 'POINTS_INSUFFICIENT';
    throw error;
  }
}

/**
 * 每章之前快速检查是否还有可用 Token，一旦用完立即抛出 TOKEN_EXHAUSTED
 * 这样不用等到整章生成完才发现没钱了
 */
async function ensureTokensLeft(user) {
  if (!user || !isPointsBillingRequired(user.modelConfig)) return;
  const freshUser = await User.findById(user._id);
  if (!freshUser) return;
  const available = getPointsSnapshot(freshUser).available;
  if (available <= 0) {
    throw new Error('TOKEN_EXHAUSTED');
  }
}

// ====== 去AI味 ======
const deslop = require('../config/deslop');

// 对文本进行去AI味处理
router.post('/deslop', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length < 10) return res.status(400).json({ message: '文本太短' });
    await checkTokenBalance(req.user);

    const systemPrompt = deslop.deslopSystemPrompt;
    const userPrompt = `请对以下文本进行去AI味处理：\n\n${text}`;

    const result = await streamGenerate(
      systemPrompt,
      userPrompt,
      null,
      null,
      resolveApiConfig(req.user?.modelConfig, 'writing')
    );

    await deductTokens(req.user, result.content, `${systemPrompt}\n${userPrompt}`);

    res.json({ original: text, processed: processChapter(result.content).text });
  } catch (error) {
    res.status(500).json({ message: '去AI味处理失败', error: error.message });
  }
});

// ====== 去AI化（SSE流式，用于生成后的人味改写） ======
router.post('/deslop-stream', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length < 50) return res.status(400).json({ message: '文本太短' });

    // 检查 Token 余额
    await checkTokenBalance(req.user);

    // SSE 设置
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const apiConfig = resolveApiConfig(req.user?.modelConfig, 'writing');
    const deslop = require('../config/deslop');
    let fullContent = '';

    // 第一遍：打碎段落结构
    res.write(`data: ${JSON.stringify({ type: 'status', message: '正在改写第1遍：打碎段落结构...' })}\n\n`);
    try {
      const result1 = await streamGenerate(
        '你是一个写了十年网文的作者，擅长把AI写的东西改成自己的风格。',
        `${deslop.humanizeRewritePrompt}\n\n以下是需要改写的小说草稿：\n\n${text}`,
        (chunk) => {
          fullContent += chunk;
          res.write(`data: ${JSON.stringify({ type: 'content', content: chunk, pass: 1 })}\n\n`);
        },
        null, apiConfig, 2, 0.92
      );
      if (result1 && result1.content && result1.content.length > text.length * 0.3) {
        fullContent = result1.content;
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', message: '改写结果异常，使用原文' })}\n\n`);
        res.end();
        return;
      }
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: e.message || '改写失败' })}\n\n`);
      res.end();
      return;
    }

    // 第二遍：注入人味特征
    res.write(`data: ${JSON.stringify({ type: 'status', message: '正在改写第2遍：注入人味特征...' })}\n\n`);
    let finalContent = '';
    try {
      const pass2Prompt = `你是同一个作者，现在对刚才的改写稿做最后一轮打磨。这次的重点不是结构，而是"人味"：

1. 把所有书面化的词换成口语——"然而"→"不过"，"因此"→"所以"，"逐渐"→"慢慢"
2. 在叙述中随机插入角色的走神或吐槽，用括号或破折号
3. 把一些完整的句子改成碎片
4. 对话中加一些口语填充词
5. 删掉所有段尾的总结句、感悟句
6. 长描写用口语重写，但不要删减内容——字数要和原文差不多
7. 加入一些不完美的过渡——"话说回来""对了""哦对"
8. 叙述者偶尔插入括号吐槽
9. 同一段落内要有情绪变化

【重要】改写后的字数必须与原文相差不超过 20%。这是打磨，不是缩写。

直接输出打磨后的完整文本，不要解释。保留剧情和对话内容。

以下是需要打磨的文本：

${fullContent}`;

      await streamGenerate(
        '你是同一个作者，在做最后一轮打磨。',
        pass2Prompt,
        (chunk) => {
          finalContent += chunk;
          res.write(`data: ${JSON.stringify({ type: 'content', content: chunk, pass: 2 })}\n\n`);
        },
        null, apiConfig, 2, 0.95
      );

      if (finalContent && finalContent.length > fullContent.length * 0.3) {
        // 后处理
        const { text: processedText } = processChapter(finalContent, { doHumanize: true });
        res.write(`data: ${JSON.stringify({ type: 'completed', content: processedText })}\n\n`);
      } else {
        const { text: processedText } = processChapter(fullContent, { doHumanize: true });
        res.write(`data: ${JSON.stringify({ type: 'completed', content: processedText })}\n\n`);
      }
    } catch (e) {
      const { text: processedText } = processChapter(fullContent, { doHumanize: true });
      res.write(`data: ${JSON.stringify({ type: 'completed', content: processedText })}\n\n`);
    }

    // 扣除 Token
    try { await deductTokens(req.user, finalContent || fullContent, `${text}\n${fullContent}`); } catch {}

    res.end();
  } catch (error) {
    console.error('去AI化流式处理失败:', error.message);
    if (res.headersSent) {
      try { res.write(`data: ${JSON.stringify({ type: 'error', message: error.isApiError ? error.message : '去AI化处理失败' })}\n\n`); res.end(); } catch {}
    } else {
      res.status(500).json({ message: error.isApiError ? error.message : '去AI化处理失败' });
    }
  }
});

// ====== 润色（SSE流式，支持自定义润色方案 + Token实时消耗） ======
router.post('/polish', auth, async (req, res) => {
  try {
    const { text, polishPrompt, doDeslop } = req.body;
    if (!text || text.trim().length < 10) return res.status(400).json({ message: '文本太短' });

    // 检查 Token 余额
    await checkTokenBalance(req.user);

    const defaultPolishPrompt = `你是一位专业的小说润色专家。请对以下小说文本进行润色优化，要求：

1. 修正语病和不通顺的句子
2. 优化用词，使表达更加精准生动
3. 调整句式节奏，让阅读更流畅
4. 保留原文的风格和情节
5. 保持人物性格的一致性
6. 注意段落间的衔接自然

请直接输出润色后的完整文本，不要加任何评价或说明。`;

    const userPrompt = `${polishPrompt || defaultPolishPrompt}\n\n以下是需要润色的文本：\n\n${text}`;

    // 估算输入 token 成本（输入文本 + 提示词）
    const inputTokenCost = countTokens(text) + countTokens(polishPrompt || defaultPolishPrompt);
    let outputTokenUsed = 0;
    const billingRouteId = routeIdForModelConfig(req.user?.modelConfig);
    const requiresPoints = isPointsBillingRequired(req.user?.modelConfig);

    // 获取最新余额
    const getAvailableTokens = async () => {
      const fresh = await User.findById(req.user._id);
      if (!fresh) return 0;
      return getPointsSnapshot(fresh).available;
    };

    // SSE 流式输出润色结果
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let polished = '';
    const abortController = new AbortController();
    let streamAborted = false;
    let tokenExhausted = false;

    req.on('close', () => { try { abortController.abort(); } catch {}; try { res.end(); } catch {} });

    // 发送初始 Token 信息
    const initialAvailable = await getAvailableTokens();
    res.write(`data: ${JSON.stringify({ type: 'token_info', available: initialAvailable })}\n\n`);

    // 包装 onChunk：实时检查 Token
    const wrappedOnChunk = async (chunk) => {
      if (streamAborted) return;
      polished += chunk;
      outputTokenUsed = countTokens(polished);

      // 每 200 输出 token 检查一次余额
      if (outputTokenUsed % 200 < 10) {
        const available = await getAvailableTokens();
        const estimatedPoints = requiresPoints
          ? calculatePointsCharge({ routeId: billingRouteId, inputTokens: inputTokenCost, outputTokens: outputTokenUsed }).points
          : 0;
        if (requiresPoints && estimatedPoints >= available) {
          tokenExhausted = true;
          streamAborted = true;
          abortController.abort();
          return;
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
    };

    try {
      await streamGenerate(
        '你是一位专业的小说润色专家，擅长各种文风的精修与优化。',
        userPrompt,
        wrappedOnChunk,
        abortController.signal,
        resolveApiConfig(req.user?.modelConfig, 'writing')
      );
    } catch (e) {
      if (e.name === 'AbortError' && tokenExhausted) {
        // Token 耗尽导致的正常中止
      } else if (!tokenExhausted) {
        throw e;
      }
    }

    // 扣除实际消耗的 Token（仅扣除输出部分，输入部分可酌情免除）
    try {
      await deductTokens(req.user, polished, `你是一位专业的小说润色专家，擅长各种文风的精修与优化。\n${userPrompt}`);
    } catch (e) {
      if (e.message === 'TOKEN_EXHAUSTED') {
        tokenExhausted = true;
      }
    }

    // 如果用户选择了去AI味且未因 token 耗尽中止
    if (doDeslop && polished.trim().length > 10 && !tokenExhausted) {
      // 去AI味前再次检查余额
      const availableNow = await getAvailableTokens();
      if (availableNow <= 0) {
        tokenExhausted = true;
      } else {
        res.write(`data: ${JSON.stringify({ type: 'status', message: '正在执行去AI味处理...' })}\n\n`);

        const deslopPrompt = `${deslop.deslopSystemPrompt}\n\n请对以下文本进行去AI味处理：\n\n${polished}`;
        let desloped = '';
        let deslopExhausted = false;

        const deslopOnChunk = async (chunk) => {
          if (deslopExhausted) return;
          desloped += chunk;
          const dtc = countTokens(desloped);
          if (dtc % 100 < 10) {
            const avail = await getAvailableTokens();
            if (avail <= 0) {
              deslopExhausted = true;
              abortController.abort();
              return;
            }
          }
          res.write(`data: ${JSON.stringify({ type: 'deslop_content', content: chunk })}\n\n`);
        };

        try {
          await streamGenerate(
            '你是一位专业的小说润色专家。',
            deslopPrompt,
            deslopOnChunk,
            abortController.signal,
            resolveApiConfig(req.user?.modelConfig, 'writing')
          );
        } catch (e) {
          if (!(e.name === 'AbortError' && deslopExhausted)) throw e;
        }

        // 扣除去AI味消耗的 Token
        try { await deductTokens(req.user, desloped, `你是一位专业的小说润色专家。\n${deslopPrompt}`); } catch {}

        if (desloped.trim().length > 10) polished = desloped;
      }
    }

    // 发送完成事件（含 Token 信息）
    if (tokenExhausted) {
      res.write(`data: ${JSON.stringify({ type: 'token_exhausted', message: '积分已消耗完毕，已返回当前润色结果', totalLength: polished.length })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'completed', totalLength: polished.length, tokenExhausted })}\n\n`);
    res.end();
  } catch (error) {
    console.error('润色失败:', error.message);
    if (error.message === 'TOKEN_EXHAUSTED' || (error.message && error.message.includes('Token 不足'))) {
      try { res.write(`data: ${JSON.stringify({ type: 'token_exhausted', message: '积分余额不足，请充值后重试' })}\n\n`); res.end(); } catch {}
    } else if (error.isApiError) {
      // AI API 错误，使用友好提示
      try { res.write(`data: ${JSON.stringify({ type: 'error', message: error.message || 'AI 服务暂时不可用，请稍后重试' })}\n\n`); res.end(); } catch {}
    } else {
      try { res.write(`data: ${JSON.stringify({ type: 'error', message: '润色过程中出现错误，请稍后重试' })}\n\n`); res.end(); } catch {}
    }
  }
});

// ====== 上传参考小说 → 提取剧情结构（走向/伏笔/世界观/地名替换） ======
router.post('/analyze-structure', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: '请上传 .txt 文件' });
    const text = req.file.buffer.toString('utf-8');
    if (text.length < 100) return res.status(400).json({ message: '小说太短，至少100字' });

    // 限制最大分析字数
    const MAX_ANALYSIS_CHARS = 5000000;
    if (text.length > MAX_ANALYSIS_CHARS) {
      return res.status(400).json({ message: `小说内容过长（${text.length} 字），最多支持 ${MAX_ANALYSIS_CHARS} 字分析` });
    }

    const systemPrompt = '你是一位专业的小说结构分析师。你的任务是从给定的小说文本中提取**抽象的结构骨架**（节奏模式、冲突类型、阶段划分方式）作为创作蓝图，并用AI生成全新的角色名称和地点名称。⚠️ 注意：输出的结构模板会用于生成全新的小说，因此要抽象到"模板"级别，避免包含具体的情节细节，防止被控抄袭。';

    // 估算 token 开销
    const promptSkeleton = `请分析以下小说文本，提取其抽象的结构模式作为创作模板。你需要输出以下内容（使用中文）：

【结构模板 — 剧情整体走向】
- 不要复述原小说的具体情节，而是抽象描述其**故事类型模板**（如：废柴逆袭型、寻宝探险型、重生复仇型、系统升级型等）
- 用100-200字描述该模板的核心套路和节奏模式

【结构模板 — 章节结构规划】
- 不要复制原小说的章节顺序，而是抽象描述**阶段划分方式**
- 格式：阶段1：[类型描述，如"主角初始困境建立"] → 大致节奏、关键转折类型
- 阶段2：[类型描述，如"外部势力介入"] → 大致节奏、关键转折类型

【世界观设定】
- 列出核心世界观要素（时代背景、社会结构、特殊规则等）
- 每个要素30-50字，抽象描述类型（如"修炼等级体系"而非具体等级名字）

【伏笔类型】
- 不要列出具体伏笔，而是描述**伏笔的类型和设置方式**
- 格式：伏笔类型 → 常见回收方式

【核心冲突类型】
- 列出主要冲突类型（至少3条，含主线、感情线、成长线）
- 每种类型20-30字，描述冲突的模板

【AI生成替换名称】
请为以下每个类别生成5个全新的、与原文风格不同的名称：
- 主角（男女各5个）
- 配角（男女各5个）  
- 地名/场景（5个）
- 特殊物品/能力（5个）
- 宠物/坐骑（3个）

重要：这些名称必须是新创作的，不能使用原文中的任何名字！名称的文化背景可以与原文不同（如原文是中式名称，可生成西式名称）

小说文本（0字）：
DUMMY_TEXT

请按照以上格式输出，确保名称是全新的。`;

    const overhead = countTokens(systemPrompt + promptSkeleton);
    const MAX_PROMPT_TOKENS = 1000000;
    const maxNovelTokens = MAX_PROMPT_TOKENS - overhead;

    const estimatedTokens = countTokens(text);
    let finalContent = '';
    let totalTokenCount = 0;
    const apiConfig = resolveApiConfig(req.user?.modelConfig, 'writing');

    // ---------- 单次处理（文本足够短） ----------
    if (estimatedTokens <= maxNovelTokens) {
      const userPrompt = `请分析以下小说文本，提取其抽象的结构模式作为创作模板。你需要输出以下内容（使用中文）：

【结构模板 — 剧情整体走向】
- 不要复述原小说的具体情节，而是抽象描述其**故事类型模板**（如：废柴逆袭型、寻宝探险型、重生复仇型、系统升级型等）
- 用100-200字描述该模板的核心套路和节奏模式

【结构模板 — 章节结构规划】
- 不要复制原小说的章节顺序，而是抽象描述**阶段划分方式**
- 格式：阶段1：[类型描述，如"主角初始困境建立"] → 大致节奏、关键转折类型
- 阶段2：[类型描述，如"外部势力介入"] → 大致节奏、关键转折类型

【世界观设定】
- 列出核心世界观要素（时代背景、社会结构、特殊规则等）
- 每个要素30-50字，抽象描述类型（如"修炼等级体系"而非具体等级名字）

【伏笔类型】
- 不要列出具体伏笔，而是描述**伏笔的类型和设置方式**
- 格式：伏笔类型 → 常见回收方式

【核心冲突类型】
- 列出主要冲突类型（至少3条，含主线、感情线、成长线）
- 每种类型20-30字，描述冲突的模板

【AI生成替换名称】
请为以下每个类别生成5个全新的、与原文风格不同的名称：
- 主角（男女各5个）
- 配角（男女各5个）  
- 地名/场景（5个）
- 特殊物品/能力（5个）
- 宠物/坐骑（3个）

重要：这些名称必须是新创作的，不能使用原文中的任何名字！名称的文化背景可以与原文不同（如原文是中式名称，可生成西式名称）

小说文本（${text.length}字）：
${text}

请按照以上格式输出，确保名称是全新的。`;

      const result = await streamGenerate(systemPrompt, userPrompt, null, null, apiConfig);
      if (!result || !result.content) throw new Error('结构分析失败');
      finalContent = result.content;
      totalTokenCount = result.tokenCount;

    // ---------- 智能分批处理（超长文本） ----------
    } else {
      // 每块可容纳的最大字符数（留 10% 余量，按 token/字比例折算）
      const ratio = (maxNovelTokens * 0.85) / estimatedTokens;
      const rawChunkSize = Math.floor(text.length * ratio);
      const OVERLAP = 2000; // 块间重叠字符数，保证上下文不丢失
      const MIN_CHUNK = 5000; // 每块至少 5000 字

      // 在段落边界拆分
      const chunks = [];
      let pos = 0;
      while (pos < text.length) {
        const endRaw = Math.min(pos + rawChunkSize, text.length);
        // 找到最后一个段落边界（\n\n）
        let cutPos = endRaw;
        if (endRaw < text.length) {
          const searchStart = Math.max(pos, endRaw - 3000);
          const segment = text.substring(searchStart, endRaw);
          const lastBreak = segment.lastIndexOf('\n\n');
          if (lastBreak !== -1 && lastBreak > 100) {
            cutPos = searchStart + lastBreak;
          } else {
            // 没有段落边界，找最后一个换行
            const lastNewline = segment.lastIndexOf('\n');
            if (lastNewline > 0) {
              cutPos = searchStart + lastNewline;
            }
          }
        }
        // 加上重叠
        const chunkEnd = Math.min(cutPos + OVERLAP, text.length);
        if (chunkEnd - pos < MIN_CHUNK && chunks.length > 0) {
          // 最后一块太小，并入前一块
          chunks[chunks.length - 1] += text.substring(pos, chunkEnd);
          break;
        }
        chunks.push(text.substring(pos, chunkEnd));
        pos = cutPos;
      }

      const totalBatches = chunks.length;

      // 分批 prompt 模板（提取抽象结构模式，不要求输出 AI 生成替换名称，只在前/后块提）
      const chunkPrompt = (chunkText, batchIdx, total) => `你正在为小说结构的第 ${batchIdx}/${total} 部分提取结构模式。请从这一部分中提取**抽象的结构特征**（使用中文）：

【本部分的结构作用】
- 本部分在全书中承担什么结构功能（如：引入冲突、建立世界观、推进主线等）
- 描述其叙事节奏类型（快速推进/慢速铺垫/高潮爆发等）

【本部分的新增世界观类型】
- 本部分中出现的新世界观要素类型

【本部分的冲突模式】
- 本部分中出现的冲突类型及其在故事结构中的位置

【本部分的关键角色类型】
- 本部分中起关键作用的角色类型（如：导师型、对手型、伙伴型等）${batchIdx === total ? '\n\n【AI生成替换名称】（仅在最后一部分输出）\n请为以下每个类别生成5个全新的、与原文文化背景不同的名称：\n- 主角（男女各5个）\n- 配角（男女各5个）\n- 地名/场景（5个）\n- 特殊物品/能力（5个）\n- 宠物/坐骑（3个）' : ''}

小说片段（第 ${batchIdx}/${total} 部分，${chunkText.length}字）：
${chunkText}`;

      // 分批执行（并行加速）
      let parallelTokenCount = 0;
      const partialResults = await Promise.all(chunks.map(async (chunk, i) => {
        const cp = chunkPrompt(chunk, i + 1, totalBatches);
        const result = await streamGenerate(systemPrompt, cp, null, null, apiConfig);
        if (!result || !result.content) throw new Error(`第 ${i + 1}/${totalBatches} 部分分析失败`);
        parallelTokenCount += result.tokenCount;
        return result.content;
      }));
      totalTokenCount += parallelTokenCount;

      // 合并汇总
      const aggregationSystemPrompt = '你是一位专业的小说结构分析师。你将收到对同一本小说多个部分的结构分析结果，请将它们合并成一份**抽象的结构模板**，用于指导新小说的创作，不得包含原文的具体情节细节。';
      const partialsText = partialResults.map((r, i) => `===== 第 ${i + 1}/${totalBatches} 部分分析 =====\n${r}`).join('\n\n');

      const aggregationPrompt = `以下是对同一本小说的 ${totalBatches} 个部分分别进行结构分析的结果。请将这些抽象的结构模式合并成一份完整的结构模板报告（使用中文）：

【结构模板 — 剧情整体走向】
- 不要复述原小说的具体情节，而是抽象描述其**故事类型模板**（如：废柴逆袭型、寻宝探险型、重生复仇型等）
- 用100-200字描述该模板的核心套路和节奏模式

【结构模板 — 章节结构规划】
- 不要复制原小说的章节顺序，而是抽象描述**阶段划分方式**
- 格式：阶段1：[类型描述] → 大致节奏、关键转折类型

【世界观设定】
- 列出核心世界观要素（时代背景、社会结构、特殊规则等）
- 每个要素30-50字，抽象描述类型

【伏笔类型】
- 不要列出具体伏笔，而是描述**伏笔的类型和设置方式**
- 格式：伏笔类型 → 常见回收方式

【核心冲突类型】
- 列出主要冲突类型（至少3条，含主线、感情线、成长线）
- 每种类型20-30字，描述冲突的模板

【AI生成替换名称】
请为以下每个类别生成5个全新的、与原文风格不同的名称：
- 主角（男女各5个）
- 配角（男女各5个）  
- 地名/场景（5个）
- 特殊物品/能力（5个）
- 宠物/坐骑（3个）

重要：这些名称必须是新创作的，不能使用原文中的任何名字！

各部分分析结果如下：

${partialsText}

请输出抽象的结构模板，确保所有名称都是全新的。`;

      const aggResult = await streamGenerate(aggregationSystemPrompt, aggregationPrompt, null, null, apiConfig);
      if (!aggResult || !aggResult.content) throw new Error('结构汇总分析失败');
      finalContent = aggResult.content;
      totalTokenCount += aggResult.tokenCount;
    }

    res.json({ structure: finalContent, tokenCount: totalTokenCount });
  } catch (error) {
    console.error('结构分析失败:', error);
    res.status(500).json({ message: '结构分析失败', error: error.message });
  }
});

// ====== 章节关键字总结（用于生图） ======
router.post('/chapter-keywords/:novelId/:chapterNumber', auth, async (req, res) => {
  try {
    await checkTokenBalance(req.user);
    const novel = await Novel.findOne({ _id: req.params.novelId, userId: req.userId });
    if (!novel) return res.status(404).json({ message: '小说不存在' });

    const chNum = parseInt(req.params.chapterNumber);
    const chapter = novel.chapters.find(c => c.chapterNumber === chNum);
    if (!chapter) return res.status(404).json({ message: '章节不存在' });

    const content = (chapter.content || '').slice(0, 6000);
    if (content.length < 50) return res.status(400).json({ message: '章节内容过短，无法提取关键字' });

    const systemPrompt = '你是一位专业的图像关键词生成师。你的任务是从小说章节中提取两套关键字，用于 AI 图像生成软件（如 Stable Diffusion、Midjourney）。';

    const userPrompt = `请从以下小说章节内容中提取两套关键字。

章节内容：
${content}

请输出以下格式（不要包含其他内容）：

【人物画风关键字】
（中文输出，列出本章涉及的主要人物及其画风描述，格式：人物名: 画风关键字, 例如：主角: 少年、剑眉星目、古代侠客装、眼神坚定）

【场景关键字】
（中文输出，列出本章的主要场景及其风格描述，格式：场景名: 风格关键字, 例如：战场: 夕阳、硝烟弥漫、破败城池、史诗级、暗色调）

注意：
1. 人物关键字要突出该人物的外貌特征、服装、气质
2. 场景关键字要突出该场景的氛围、色调、环境要素
3. 关键字用逗号分隔，每类至少 2-3 个人物/场景
4. 关键字可直接用于 AI 图像生成提示词的拼接`;

    const result = await streamGenerate(systemPrompt, userPrompt, null, null, resolveApiConfig(req.user?.modelConfig, 'writing'));

    if (!result || !result.content) {
      return res.status(500).json({ message: '关键字生成失败' });
    }

    // 解析输出，分离人物和场景两段
    const fullText = result.content;
    const charMatch = fullText.match(/【人物画风关键字】\s*([\s\S]*?)(?=【场景关键字】|$)/);
    const sceneMatch = fullText.match(/【场景关键字】\s*([\s\S]*)$/);

    res.json({
      characterKeywords: charMatch ? charMatch[1].trim() : '',
      sceneKeywords: sceneMatch ? sceneMatch[1].trim() : '',
      raw: fullText,
    });
  } catch (error) {
    console.error('章节关键字总结失败:', error);
    res.status(500).json({ message: '关键字生成失败', error: error.message });
  }
});

// ====== 后台全文调优任务（断网不中断） ======

/**
 * 后台运行调优任务，定期更新 novel.optimizeTask 到数据库
 */
async function runOptimizeTask(novelId, userId, apiConfig) {
  let novel;
  try {
    novel = await Novel.findOne({ _id: novelId, userId });
    if (!novel) throw new Error('小说不存在');
    if (!novel.chapters || novel.chapters.length === 0) throw new Error('没有章节需要调优');

    const totalCh = novel.chapters.length;
    await Novel.updateOne({ _id: novelId }, {
      $set: {
        'optimizeTask.status': 'analyzing',
        'optimizeTask.progress': '正在分析全文问题...',
        'optimizeTask.currentChapter': 0,
        'optimizeTask.totalChapters': totalCh,
        'optimizeTask.optimizedCount': 0,
        'optimizeTask.polishedCount': 0,
        'optimizeTask.error': '',
        'optimizeTask.startedAt': new Date(),
        'optimizeTask.completedAt': null,
      }
    });

    // 1. 分析全文问题
    const analysisPrompt = buildOptimizeAnalysisPrompt(
      novel.chapters, novel.outline, novel.protagonistName, novel.worldSetting
    );
    const analysisResult = await streamGenerate(
      '你是一位专业的小说编辑。请分析小说全文，找出所有问题。',
      analysisPrompt, null, null, apiConfig
    );
    const analysis = analysisResult?.content || '';

    // 2. 逐章优化
    let optimizedCount = 0;
    let polishedCount = 0;

    for (let i = 0; i < totalCh; i++) {
      // 每次 start 后重新读取 novel（防止多任务覆盖）
      novel = await Novel.findOne({ _id: novelId });
      if (!novel) throw new Error('调优过程中小说被删除');

      // 更新进度
      await Novel.updateOne({ _id: novelId }, {
        $set: {
          'optimizeTask.status': 'optimizing',
          'optimizeTask.progress': `正在调优第 ${i + 1}/${totalCh} 章...`,
          'optimizeTask.currentChapter': i + 1,
        }
      });

      const ch = novel.chapters[i];
      const chPrompt = buildOptimizeChapterPrompt(ch, ch.chapterNumber, analysis, novel.outline);
      const chResult = await streamGenerate(
        '你是一位专业的小说编辑。请根据分析报告优化指定章节。',
        chPrompt, null, null, apiConfig
      );
      let newContent = chResult?.content || '';
      if (newContent.length > 50) {
        try {
          const { text } = processChapter(newContent);
          newContent = text;
        } catch {}
        await Novel.updateOne(
          { _id: novelId, 'chapters.chapterNumber': ch.chapterNumber },
          { $set: { 'chapters.$.content': newContent, 'chapters.$.wordCount': newContent.length } }
        );
        optimizedCount++;
      } else {
        try {
          const { text } = processChapter(ch.content || '');
          if (text !== ch.content) {
            await Novel.updateOne(
              { _id: novelId, 'chapters.chapterNumber': ch.chapterNumber },
              { $set: { 'chapters.$.content': text } }
            );
            polishedCount++;
          }
        } catch {}
      }
    }

    // 更新总字数
    novel = await Novel.findOne({ _id: novelId });
    if (novel) {
      const totalWords = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
      await Novel.updateOne({ _id: novelId }, {
        $set: {
          currentWordCount: totalWords,
          status: 'completed',
          'optimizeTask.status': 'completed',
          'optimizeTask.progress': `✅ 全文调优完成！重写 ${optimizedCount} 章，润色 ${polishedCount} 章`,
          'optimizeTask.optimizedCount': optimizedCount,
          'optimizeTask.polishedCount': polishedCount,
          'optimizeTask.completedAt': new Date(),
        }
      });
    }
  } catch (error) {
    console.error('后台调优失败:', error);
    try {
      await Novel.updateOne({ _id: novelId }, {
        $set: {
          'optimizeTask.status': 'error',
          'optimizeTask.progress': `调优失败: ${error.message}`,
          'optimizeTask.error': error.message,
          'optimizeTask.completedAt': new Date(),
        }
      });
    } catch (dbError) {
      console.error('保存调优错误状态失败:', dbError);
    }
  }
}

// 启动后台调优任务（立即返回）
router.post('/optimize/:novelId', auth, async (req, res) => {
  try {
    const novel = await Novel.findOne({ _id: req.params.novelId, userId: req.userId });
    if (!novel) return res.status(404).json({ message: '小说不存在' });
    if (!novel.chapters || novel.chapters.length === 0) return res.status(400).json({ message: '没有章节需要调优' });

    // 检查是否已有任务在运行
    if (novel.optimizeTask?.status === 'analyzing' || novel.optimizeTask?.status === 'optimizing') {
      return res.status(409).json({ message: '已有调优任务正在运行，请等待完成' });
    }

    const apiConfig = resolveApiConfig(req.user?.modelConfig, 'writing');

    // 后台执行，不 await
    runOptimizeTask(req.params.novelId, req.userId, apiConfig);

    res.json({
      message: '调优任务已启动，后台运行中，即使断网也不受影响',
      novelId: req.params.novelId,
    });
  } catch (error) {
    console.error('启动调优失败:', error);
    res.status(500).json({ message: '启动调优失败', error: error.message });
  }
});

// 查询后台调优任务状态
router.post('/optimize-status/:novelId', auth, async (req, res) => {
  try {
    const novel = await Novel.findOne(
      { _id: req.params.novelId, userId: req.userId },
      { 'optimizeTask': 1 }
    );
    if (!novel) return res.status(404).json({ message: '小说不存在' });

    res.json({
      task: novel.optimizeTask || {
        status: 'idle', progress: '', currentChapter: 0, totalChapters: 0,
        optimizedCount: 0, polishedCount: 0, error: '',
      }
    });
  } catch (error) {
    console.error('查询调优状态失败:', error);
    res.status(500).json({ message: '查询调优状态失败', error: error.message });
  }
});

// ====== 七阶段编辑引擎 ======

// 单章编辑引擎（SSE 流式）
router.post('/editorial-stream', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length < 100) return res.status(400).json({ message: '文本太短（至少100字）' });

    await checkTokenBalance(req.user);

    // SSE 设置
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const apiConfig = resolveApiConfig(req.user?.modelConfig, 'writing');

    // 心跳
    const heartbeat = setInterval(() => {
      try { res.write(': editorial-heartbeat\n\n'); } catch { clearInterval(heartbeat); }
    }, 10000);

    let finalContent = '';

    try {
      const result = await runEditorialPipeline(text, {
        apiConfig,
        onChunk: (chunk, stageId) => {
          if (stageId !== 'persona') {
            // persona 阶段本地生成，不输出文本
            finalContent += chunk;
            res.write(`data: ${JSON.stringify({ type: 'content', content: chunk, stage: stageId })}\n\n`);
          }
        },
        onStatus: (stageId, stageName, message, failed, phase) => {
          res.write(`data: ${JSON.stringify({ type: 'status', stage: stageId, stageName, message, failed: !!failed, phase: phase || '' })}\n\n`);
        },
      });

      clearInterval(heartbeat);

      // 后处理
      let processedContent = result.content;
      try {
        const { text: cleanText } = processChapter(processedContent, { doDeAI: true, doHumanize: true });
        if (cleanText && cleanText.length > processedContent.length * 0.3) {
          processedContent = cleanText;
        }
      } catch {}

      // 扣费
      try { await deductTokens(req.user, processedContent, text); } catch (e) {
        console.warn('[编辑引擎] 扣费异常:', e.message);
      }

      res.write(`data: ${JSON.stringify({
        type: 'completed',
        content: processedContent,
        analysis: result.analysis,
        persona: result.persona,
        stageResults: result.stageResults,
        originalLength: result.originalLength,
        finalLength: processedContent.length,
      })}\n\n`);
    } catch (e) {
      clearInterval(heartbeat);
      res.write(`data: ${JSON.stringify({ type: 'error', message: e.message || '编辑引擎处理失败' })}\n\n`);
    }

    res.end();
  } catch (error) {
    console.error('编辑引擎请求失败:', error);
    res.status(500).json({ message: '编辑引擎处理失败', error: error.message });
  }
});

// 整本编辑引擎（后台任务）
async function runEditorialBookTask(novelId, userId, apiConfig) {
  try {
    let novel = await Novel.findOne({ _id: novelId, userId });
    if (!novel || !novel.chapters || novel.chapters.length === 0) {
      await Novel.updateOne({ _id: novelId }, {
        $set: { 'editorialTask.status': 'error', 'editorialTask.progress': '没有章节可处理', 'editorialTask.completedAt': new Date() }
      });
      return;
    }

    const totalChapters = novel.chapters.length;
    let processedCount = 0;

    await Novel.updateOne({ _id: novelId }, {
      $set: {
        'editorialTask.status': 'running',
        'editorialTask.progress': `开始处理，共 ${totalChapters} 章`,
        'editorialTask.totalChapters': totalChapters,
        'editorialTask.currentChapter': 0,
        'editorialTask.processedCount': 0,
        'editorialTask.startedAt': new Date(),
      }
    });

    for (let i = 0; i < novel.chapters.length; i++) {
      const ch = novel.chapters[i];
      const chNum = ch.chapterNumber;

      // 更新进度
      await Novel.updateOne({ _id: novelId }, {
        $set: {
          'editorialTask.currentChapter': i + 1,
          'editorialTask.progress': `正在编辑第${chNum}章（${i + 1}/${totalChapters}）`,
          'editorialTask.currentStage': '',
          'editorialTask.stageName': '',
        }
      });

      try {
        const result = await runEditorialPipeline(ch.content || '', {
          apiConfig,
          onStatus: async (stageId, stageName, message) => {
            // 更新当前阶段状态
            await Novel.updateOne({ _id: novelId }, {
              $set: {
                'editorialTask.currentStage': stageId,
                'editorialTask.stageName': stageName,
                'editorialTask.progress': `第${chNum}章：${stageName}`,
              }
            });
          },
        });

        let finalContent = result.content;
        if (finalContent && finalContent.length > 50) {
          // 后处理
          try {
            const { text: cleanText } = processChapter(finalContent, { doDeAI: true, doHumanize: true });
            if (cleanText && cleanText.length > finalContent.length * 0.3) {
              finalContent = cleanText;
            }
          } catch {}

          // 保存到数据库
          await Novel.updateOne(
            { _id: novelId, 'chapters.chapterNumber': chNum },
            { $set: { 'chapters.$.content': finalContent, 'chapters.$.wordCount': finalContent.length } }
          );
          processedCount++;
        }
      } catch (e) {
        console.error(`[编辑引擎] 第${chNum}章处理失败:`, e.message);
      }
    }

    // 更新总字数
    novel = await Novel.findOne({ _id: novelId });
    if (novel) {
      const totalWords = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
      await Novel.updateOne({ _id: novelId }, {
        $set: {
          currentWordCount: totalWords,
          'editorialTask.status': 'completed',
          'editorialTask.progress': `✅ 编辑引擎完成！共处理 ${processedCount}/${totalChapters} 章`,
          'editorialTask.processedCount': processedCount,
          'editorialTask.completedAt': new Date(),
        }
      });
    }
  } catch (error) {
    console.error('后台编辑引擎失败:', error);
    try {
      await Novel.updateOne({ _id: novelId }, {
        $set: {
          'editorialTask.status': 'error',
          'editorialTask.progress': `编辑引擎失败: ${error.message}`,
          'editorialTask.error': error.message,
          'editorialTask.completedAt': new Date(),
        }
      });
    } catch (dbError) {
      console.error('保存编辑引擎错误状态失败:', dbError);
    }
  }
}

// 启动整本编辑引擎（立即返回）
router.post('/editorial-book/:novelId', auth, async (req, res) => {
  try {
    const novel = await Novel.findOne({ _id: req.params.novelId, userId: req.userId });
    if (!novel) return res.status(404).json({ message: '小说不存在' });
    if (!novel.chapters || novel.chapters.length === 0) return res.status(400).json({ message: '没有章节可编辑' });

    // 检查是否已有任务在运行
    if (novel.editorialTask?.status === 'running') {
      return res.status(409).json({ message: '编辑引擎正在运行中，请等待完成' });
    }

    const apiConfig = resolveApiConfig(req.user?.modelConfig, 'writing');

    // 后台执行，不 await
    runEditorialBookTask(req.params.novelId, req.userId, apiConfig);

    res.json({
      message: '编辑引擎已启动，后台运行中',
      novelId: req.params.novelId,
      totalChapters: novel.chapters.length,
    });
  } catch (error) {
    console.error('启动编辑引擎失败:', error);
    res.status(500).json({ message: '启动编辑引擎失败', error: error.message });
  }
});

// 查询编辑引擎任务状态
router.post('/editorial-status/:novelId', auth, async (req, res) => {
  try {
    const novel = await Novel.findOne(
      { _id: req.params.novelId, userId: req.userId },
      { 'editorialTask': 1 }
    );
    if (!novel) return res.status(404).json({ message: '小说不存在' });

    res.json({
      task: novel.editorialTask || {
        status: 'idle', progress: '', currentChapter: 0, totalChapters: 0,
        currentStage: '', stageName: '', processedCount: 0, error: '',
      }
    });
  } catch (error) {
    console.error('查询编辑引擎状态失败:', error);
    res.status(500).json({ message: '查询编辑引擎状态失败', error: error.message });
  }
});

module.exports = router;
