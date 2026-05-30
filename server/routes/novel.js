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
  streamGenerate, resolveApiConfig, countTokens,
} = require('../services/aiService');
const { buildAugmentedContext } = require('../services/novelContext');
const { processChapter } = require('../services/chapterToolchain');

// 全局活跃生成流跟踪
const activeStreams = new Map();

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
      targetWordCount: targetWordCount || 50000,
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
        console.log('客户端断开连接');
        abortController.abort();
        novel.status = 'paused';
        await novel.save();
        activeStreams.delete(streamKey);
        try { res.write(`data: ${JSON.stringify({ type: 'paused' })}\n\n`); res.end(); } catch {}
      }
    });

    // ====== 自动生成大纲（整本模式且用户未填写，300秒超时） ======
    let outline = req.body.outline || '';
    if (isBook && !outline) {
      res.write(`data: ${JSON.stringify({ type: 'status', message: '正在根据您的设定生成创作大纲（可能需要1-3分钟）...' })}\n\n`);
      const outlinePrompt = buildOutlinePrompt(novelTypeId, protagonistName, worldSetting, targetWordCount);
      try {
        const ac = new AbortController();
        const t = setTimeout(() => { try { ac.abort(); } catch {}; console.log('大纲生成超时(300s)'); }, 300000);
        const outlineResult = await streamGenerate(
          '你是一位专业的小说大纲策划师。',
          outlinePrompt, null, ac.signal,
          resolveApiConfig(req.user?.modelConfig, 'writing')
        );
        clearTimeout(t);
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
        const planResult = await streamGenerate(
          '你是一位专业的小说章节规划师。你的任务是制定详细的章节计划表，确保每章有明确目标、伏笔合理铺设和回收、结局节奏自然。',
          planPrompt, null, null,
          resolveApiConfig(req.user?.modelConfig, 'writing')
        );
        if (planResult && planResult.content) {
          chapterPlan = planResult.content;
          novel.chapterPlan = chapterPlan;
          await novel.save();
          const planChCount = (chapterPlan.match(/第\d+章/g) || []).length;
          res.write(`data: ${JSON.stringify({ type: 'status', message: `章节计划已制定（共 ${planChCount} 章）` })}\n\n`);
        }
      } catch (e) {
        console.error('章节计划生成失败:', e.message);
        res.write(`data: ${JSON.stringify({ type: 'status', message: '章节计划生成暂不可用，继续创作...' })}\n\n`);
      }
    }

    // ====== 循环生成 ======

    /** 生成并保存一个章节 */
    async function generateOneChapter(chNum, prompt) {
      let buffer = '';
      let lastSave = 0;

      res.write(`data: ${JSON.stringify({ type: 'chapter_start', chapterNumber: chNum, title: `第${chNum}章` })}\n\n`);

      await streamGenerate(systemPrompt, prompt, (chunk) => {
        buffer += chunk;
        if (Date.now() - lastSave > 5000) {
          const sw = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
          Novel.findByIdAndUpdate(novel._id, { $set: { status: 'generating', currentWordCount: sw + buffer.length } }).catch(() => {});
          lastSave = Date.now();
        }
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
      }, abortController.signal, resolveApiConfig(req.user?.modelConfig, 'writing'));

      // 工具链：去AI味 + 标点修正
      let finalContent = buffer;
      if (buffer.length > 100) {
        try {
          const { text } = processChapter(buffer);
          finalContent = text;
        } catch (e) { /* 后处理失败不影响主流程 */ }
      }

      // 保存章节
      novel.chapters.push({ chapterNumber: chNum, title: `第${chNum}章`, content: finalContent, wordCount: finalContent.length });
      const sw = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
      novel.currentWordCount = sw;
      novel.currentChapterIndex = chNum;
      novel.status = 'generating';
      await novel.save();
      deductTokens(req.user, finalContent);

      res.write(`data: ${JSON.stringify({ type: 'chapter_end', chapterNumber: chNum, wordCount: buffer.length })}\n\n`);
      return { content: finalContent, wordCount: buffer.length };
    }

    console.log('开始正文循环生成，outline长度:', outline?.length || 0, 'aborted:', abortController.signal.aborted);
    try {
      if (isBook) {
        // ====== 整本模式：生成多章直到达到目标字数 ======
        const chapterSize = Math.max(2000, Math.min(5000, Math.floor(targetWordCount / 3)));
        const maxChapters = Math.ceil(targetWordCount / 1000);
        const planChapters = chapterPlan ? (chapterPlan.match(/第\d+章/g) || []).length : 0;
        const totalPlannedChapters = planChapters || Math.ceil(targetWordCount / chapterSize);

        // 追踪上一章内容，防止重复
        let lastChapterContent = '';

        for (let ch = 1; ch <= maxChapters; ch++) {
          if (abortController.signal.aborted) break;

          const currentTotal = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
          const remaining = targetWordCount - currentTotal;
          if (remaining <= 0) break;

          const distilled = buildAugmentedContext(novel.chapters);

          // 从章节计划中提取当前章的描述
          let currentChapterPlan = '';
          if (chapterPlan) {
            const lines = chapterPlan.split('\n').filter(l => l.trim());
            const chLine = lines.find(l => l.trim().startsWith(`第${ch}章(`) || l.trim().startsWith(`第${ch}章 `));
            if (chLine) currentChapterPlan = chLine.trim();
          }

          const storyState = buildStoryStateSummary(
            chapterPlan, ch, totalPlannedChapters,
            currentTotal, targetWordCount
          );

          const chPlanSection = chapterPlan ? '【章节计划表】\n' + chapterPlan + '\n' : '';
          const thisChSection = currentChapterPlan ? '【本章计划】\n' + currentChapterPlan + '\n' : '';
          const prevChSection = lastChapterContent
            ? `【上一章概要】（⚠️ 当前章节的核心事件/剧情推进必须与上一章不同，不要重复）\n${extractChapterSummary(lastChapterContent)}\n`
            : '';

          const chPrompt = `请继续创作这部${type.name}小说。

主角：${protagonistName || '未设定'}
世界观：${worldSetting || '自由发挥'}
${outline ? '【创作大纲】\n' + outline + '\n' : ''}
${chPlanSection}
${thisChSection}
${prevChSection}
${storyState}

已有章节摘要：
${distilled || '（故事开始）'}

当前是第${ch}章，剩余目标约${remaining}字。
要求：
1. 保持与前面章节一致的文风和节奏
2. 注意剧情连贯性，衔接上一章结尾，但核心事件不能与上一章重复
3. 如有【本章计划】请严格遵循，完成本章核心事件
4. 每章必须有新的情节推进，必须有矛盾冲突或转折，禁止写纯粹的过渡章
5. 严格按照【章节计划表】中的伏笔安排来设置和回收伏笔
6. 密切关注【当前故事状态】中的进度要求，确保在剩余章节内合理收束
7. 目标本章约${chapterSize}字，不要过度缩水或灌水
8. 每章结束时标注【未完待续】
9. 如果剩余章节不足10章，逐步收紧节奏，开始准备结局
10. 最后3章要给出一个有力量、有意义、不烂尾的结局
11. ⚠️ 绝对禁止：核心剧情与上一章高度相似或完全重复，每章必须推动主线`;

          await ensureTokensLeft(req.user);
          const genResult = await generateOneChapter(ch, chPrompt);
          // 更新上一章内容摘要用于下一章的防重复检测
          if (genResult && genResult.content) {
            lastChapterContent = genResult.content;
          }
          currentChapterNum = ch + 1;
        }

        generationDone = true;
        activeStreams.delete(streamKey);
        novel.status = 'completed';
        await novel.save();
        res.write(`data: ${JSON.stringify({ type: 'completed', novelId: novel._id, totalWordCount: novel.currentWordCount })}\n\n`);
        res.end();

      } else {
        // ====== 单章模式：只生成一章 ======
        const userPrompt = buildInitialPrompt(novelTypeId, protagonistName, worldSetting, targetWordCount, mode, outline);
        await ensureTokensLeft(req.user);
        await generateOneChapter(1, userPrompt);

        generationDone = true;
        activeStreams.delete(streamKey);
        novel.status = 'completed';
        await novel.save();
        res.write(`data: ${JSON.stringify({ type: 'completed', novelId: novel._id, totalWordCount: novel.currentWordCount })}\n\n`);
        res.end();
      }
    } catch (streamError) {
      const isTokenExhausted = streamError?.message === 'TOKEN_EXHAUSTED';
      if (isTokenExhausted) console.log('Token 配额已耗尽，停止生成');
      else console.error('正文生成失败(详细):', streamError?.message || streamError);
      novel.status = 'paused';
      await novel.save();
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
    console.error('生成小说失败:', error);
    res.status(500).json({ message: '创建小说失败', error: error.message });
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

    const mode = req.body.mode || 'chapter'; // 'chapter' | 'book'

    // 更新状态
    novel.status = 'generating';
    await novel.save();

    // 系统提示词
    const systemPrompt = novel.generationContext || buildSystemPrompt(novel.novelTypeId);
    const typeName = novel.novelTypeName || '未知';
    const protagonistName = novel.protagonistName || '';
    const worldSetting = novel.worldSetting || '';
    const outline = novel.outline || '';
    const targetWordCount = novel.targetWordCount || 50000;

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
    const streamKey = novel._id.toString();
    activeStreams.set(streamKey, abortController);

    req.on('close', async () => {
      if (!generationDone) {
        abortController.abort();
        novel.status = 'paused';
        await novel.save();
        activeStreams.delete(streamKey);
        try { res.write(`data: ${JSON.stringify({ type: 'paused' })}\n\n`); res.end(); } catch {}
      }
    });

    /** 生成并保存一个章节（内部函数） */
    async function generateOneChapter(chNum, prompt) {
      let buffer = '';
      let lastSave = 0;

      res.write(`data: ${JSON.stringify({ type: 'chapter_start', chapterNumber: chNum, title: `第${chNum}章` })}\n\n`);

      await streamGenerate(systemPrompt, prompt, (chunk) => {
        buffer += chunk;
        if (Date.now() - lastSave > 5000) {
          const sw = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
          Novel.findByIdAndUpdate(novel._id, { $set: { status: 'generating', currentWordCount: sw + buffer.length } }).catch(() => {});
          lastSave = Date.now();
        }
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
      }, abortController.signal, resolveApiConfig(req.user?.modelConfig, 'writing'));

      // 工具链后处理：去AI味 + 标点修正
      let finalContent = buffer;
      if (buffer.length > 100) {
        try {
          const { text, report } = processChapter(buffer, { doDeAI: true, doPunctuation: true });
          finalContent = text;
          if (report.deAICount > 0 || report.punctuationFixes !== 0) {
            console.log(`[Toolchain] 第${chNum}章: AI味 ${report.aiFlavorBefore?.density || 0}→${report.aiFlavorAfter?.density || 0}，去AI ${report.deAICount} 处`);
          }
        } catch (e) {
          console.warn('[Toolchain] 后处理失败:', e.message);
        }
      }

      // 保存章节
      novel.chapters.push({ chapterNumber: chNum, title: `第${chNum}章`, content: finalContent, wordCount: finalContent.length });
      const sw = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
      novel.currentWordCount = sw;
      novel.currentChapterIndex = chNum;
      await novel.save();
      deductTokens(req.user, finalContent);

      res.write(`data: ${JSON.stringify({ type: 'chapter_end', chapterNumber: chNum, wordCount: finalContent.length })}\n\n`);
      return finalContent.length;
    }

    try {
      if (mode === 'book') {
        // ====== 整本模式：循环生成多章直到目标字数 ======
        const currentTotal = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
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

        const chapterSize = Math.max(2000, Math.min(5000, Math.floor(targetWordCount / 3)));
        const maxAdditionalChapters = Math.max(1, Math.ceil(remainingTarget / 1000));
        const startCh = novel.currentChapterIndex + 1;

        for (let ch = startCh; ch < startCh + maxAdditionalChapters; ch++) {
          if (abortController.signal.aborted) break;

          const curTotal = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
          const remaining = targetWordCount - curTotal;
          if (remaining <= 0) break;

          const distilled = buildAugmentedContext(novel.chapters);

          const chPrompt = `请继续创作这部${typeName}小说。

主角：${protagonistName || '未设定'}
世界观：${worldSetting || '自由发挥'}
${outline ? '【创作大纲】\n' + outline + '\n' : ''}

以下是已有章节的完整剧情脉络（含所有伏笔和人物线）：
${'='.repeat(40)}
${distilled || '（故事开始）'}
${'='.repeat(40)}

当前是第${ch}章，剩余目标约${remaining}字，目标本章约${chapterSize}字。

续写要求：
1. 仔细阅读上述已有章节，确保剧情连贯、无缝衔接上一章结尾
2. 检查尚未回收的伏笔，在后续章节中要适时回收
3. 保持人物性格和风格的高度一致性
4. 严禁简单复述或概括已有内容，必须推进新剧情
5. 每章要有独立的起承转合和一个小高潮
6. 避免模板化用语和流水账式叙事，保持生动的细节描写
7. 如有大纲请严格遵循大纲方向，同时允许合理的即兴发挥
8. 每章结束时标注【未完待续】`;

          await ensureTokensLeft(req.user);
          await generateOneChapter(ch, chPrompt);
        }

        generationDone = true;
        activeStreams.delete(streamKey);
        novel.status = 'completed';
        await novel.save();
        res.write(`data: ${JSON.stringify({ type: 'completed', novelId: novel._id, totalWordCount: novel.currentWordCount })}\n\n`);
        res.end();

      } else {
        // ====== 单章模式：只生成一章（原有行为） ======
        const userPrompt = buildContinuePrompt(novel._id, novel);
        const chapterNumber = novel.currentChapterIndex + 1;

        let chapterBuffer = '';
        let lastAutoSave = 0;

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
            const { text: finalContent } = processChapter(chapterBuffer);
            novel.chapters.push({ chapterNumber, title: `第${chapterNumber}章`, content: finalContent, wordCount: finalContent.length });
          }
          const savedWords = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
          novel.currentWordCount = savedWords;
          novel.currentChapterIndex = chapterNumber;
          novel.status = status;
          await novel.save();
        }

        await ensureTokensLeft(req.user);
        res.write(`data: ${JSON.stringify({ type: 'chapter_start', chapterNumber, title: `第${chapterNumber}章` })}\n\n`);

        await streamGenerate(
          systemPrompt, userPrompt,
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
          deductTokens(req.user, chapterBuffer);
          activeStreams.delete(streamKey);
          return;
        }

        generationDone = true;
        activeStreams.delete(streamKey);
        await finalSave('completed');
        deductTokens(req.user, chapterBuffer);

        res.write(`data: ${JSON.stringify({ type: 'chapter_end', chapterNumber, wordCount: chapterBuffer.length })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'completed', novelId: novel._id, totalWordCount: novel.currentWordCount })}\n\n`);
        res.end();
      }
    } catch (streamError) {
      const isTokenExhausted = streamError?.message === 'TOKEN_EXHAUSTED';
      if (isTokenExhausted) console.log('继续生成 Token 配额已耗尽');
      else console.error('继续生成失败:', streamError.message);
      novel.status = 'paused';
      await novel.save();
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
    console.error('继续生成失败(外):', error);
    res.status(500).json({ message: '继续生成失败', error: error.message });
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
        deductTokens(req.user, chapterBuffer);
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
        deductTokens(req.user, chapterBuffer);
        activeStreams.delete(streamKey);
        return;
      }

      generationDone = true;
      activeStreams.delete(streamKey);
      await finalSave('completed');
      deductTokens(req.user, chapterBuffer);

      res.write(`data: ${JSON.stringify({ type: 'chapter_end', chapterNumber, wordCount: chapterBuffer.length })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'completed', novelId: novel._id, totalWordCount: novel.currentWordCount })}\n\n`);
      res.end();
    } catch (streamError) {
      const isTokenExhausted = streamError?.message === 'TOKEN_EXHAUSTED';
      if (isTokenExhausted) console.log('续写 Token 配额已耗尽');
      else console.error('续写失败:', streamError.message);
      try { await finalSave('paused'); } catch {}
      try { deductTokens(req.user, chapterBuffer); } catch {}
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
        deductTokens(req.user, appendBuffer);
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
        deductTokens(req.user, appendBuffer);
        return;
      }

      generationDone = true;
      activeStreams.delete(streamKey);
      saveChapterContent(true);
      novel.status = 'completed'; await novel.save();
      deductTokens(req.user, appendBuffer);

      res.write(`data: ${JSON.stringify({ type: 'chapter_continued', chapterNumber: chNum, addedLength: appendBuffer.length })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'completed' })}\n\n`);
      res.end();
    } catch (streamError) {
      activeStreams.delete(streamKey);
      saveChapterContent(true);
      novel.status = 'paused'; await novel.save();
      deductTokens(req.user, appendBuffer);
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
async function deductTokens(user, content) {
  try {
    if (!user || !user.modelConfig) return;
    const provider = user.modelConfig.provider || 'default';
    if (provider !== 'default' && provider !== 'system') return;
    const tokenCost = countTokens(content || '');
    if (tokenCost <= 0) return;

    const freshUser = await User.findById(user._id);
    if (!freshUser) return;
    const available = Math.max(0, (freshUser.tokens.total || 0) - (freshUser.tokens.used || 0));
    
    // 如果配额已用完，抛出异常
    if (available <= 0) {
      throw new Error('TOKEN_EXHAUSTED');
    }
    
    const actualDeduct = Math.min(tokenCost, available);
    freshUser.tokens.used = (freshUser.tokens.used || 0) + actualDeduct;
    await freshUser.save();
    
    // 扣除后再次检查是否用完
    const remaining = Math.max(0, (freshUser.tokens.total || 0) - (freshUser.tokens.used || 0));
    if (remaining <= 0) {
      throw new Error('TOKEN_EXHAUSTED');
    }
  } catch (e) {
    if (e.message === 'TOKEN_EXHAUSTED') throw e;
    console.error('扣除 Token 失败(非致命):', e.message);
  }
}

/**
 * 检查用户 token 余额是否足够，若不足则抛出错误
 */
async function checkTokenBalance(user) {
  if (!user || !user.modelConfig) return;
  const provider = user.modelConfig.provider || 'default';
  if (provider !== 'default' && provider !== 'system') return; // 自备Key不检查
  const freshUser = await User.findById(user._id);
  if (!freshUser) return;
  const available = (freshUser.tokens.total || 0) - (freshUser.tokens.used || 0);
  if (available <= 0) {
    throw new Error('Token 余额不足，请充值后再生成');
  }
}

/**
 * 每章之前快速检查是否还有可用 Token，一旦用完立即抛出 TOKEN_EXHAUSTED
 * 这样不用等到整章生成完才发现没钱了
 */
async function ensureTokensLeft(user) {
  if (!user || !user.modelConfig) return;
  const provider = user.modelConfig.provider || 'default';
  if (provider !== 'default' && provider !== 'system') return;
  const freshUser = await User.findById(user._id);
  if (!freshUser) return;
  const available = (freshUser.tokens.total || 0) - (freshUser.tokens.used || 0);
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

    const systemPrompt = deslop.deslopSystemPrompt;
    const userPrompt = `请对以下文本进行去AI味处理：\n\n${text}`;

    const result = await streamGenerate(
      systemPrompt,
      userPrompt,
      null,
      null,
      resolveApiConfig(req.user?.modelConfig, 'writing')
    );

    res.json({ original: text, processed: processChapter(result.content).text });
  } catch (error) {
    res.status(500).json({ message: '去AI味处理失败', error: error.message });
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

    // 获取最新余额
    const getAvailableTokens = async () => {
      const fresh = await User.findById(req.user._id);
      if (!fresh) return 0;
      return Math.max(0, (fresh.tokens.total || 0) - (fresh.tokens.used || 0));
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
        const totalCost = inputTokenCost + outputTokenUsed;
        if (totalCost >= available) {
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
      await deductTokens(req.user, polished);
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
        try { await deductTokens(req.user, desloped); } catch {}

        if (desloped.trim().length > 10) polished = desloped;
      }
    }

    // 发送完成事件（含 Token 信息）
    if (tokenExhausted) {
      res.write(`data: ${JSON.stringify({ type: 'token_exhausted', message: 'Token 已消耗完毕，已返回当前润色结果', totalLength: polished.length })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'completed', totalLength: polished.length, tokenExhausted })}\n\n`);
    res.end();
  } catch (error) {
    console.error('润色失败:', error);
    if (error.message === 'TOKEN_EXHAUSTED' || (error.message && error.message.includes('Token 不足'))) {
      try { res.write(`data: ${JSON.stringify({ type: 'token_exhausted', message: 'Token 余额不足，请充值后重试' })}\n\n`); res.end(); } catch {}
    } else {
      try { res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`); res.end(); } catch {}
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

module.exports = router;
