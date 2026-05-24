const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Novel = require('../models/Novel');
const User = require('../models/User');
const novelTypes = require('../config/novelTypes');
const {
  buildSystemPrompt, buildInitialPrompt, buildContinuePrompt,
  buildImportContinuePrompt, buildOutlinePrompt, distillChapters,
  streamGenerate, resolveApiConfig, countTokens,
} = require('../services/aiService');

// 全局活跃生成流跟踪
const activeStreams = new Map();

// 获取所有小说类型
router.get('/types', (req, res) => {
  res.json(novelTypes);
});

// 创建新小说并开始生成（SSE流式）
router.post('/generate', auth, async (req, res) => {
  try {
    await checkTokenBalance(req.user);

    const { novelTypeId, protagonistName, worldSetting, targetWordCount } = req.body;
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

    // 创建小说记录
    const novel = new Novel({
      userId: req.userId,
      title: `${type.name}：${protagonistName || '未命名'}的传奇`,
      novelTypeId, novelTypeName: type.name,
      protagonistName: protagonistName || '', worldSetting: worldSetting || '',
      targetWordCount: targetWordCount || 50000,
      status: 'generating', batchIndex: 0,
    });

    // 构建系统提示词
    const systemPrompt = buildSystemPrompt(novelTypeId);
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

      // 保存章节
      novel.chapters.push({ chapterNumber: chNum, title: `第${chNum}章`, content: buffer, wordCount: buffer.length });
      const sw = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
      novel.currentWordCount = sw;
      novel.currentChapterIndex = chNum;
      novel.status = 'generating';
      await novel.save();
      deductTokens(req.user, buffer);

      res.write(`data: ${JSON.stringify({ type: 'chapter_end', chapterNumber: chNum, wordCount: buffer.length })}\n\n`);
      return buffer.length;
    }

    console.log('开始正文循环生成，outline长度:', outline?.length || 0, 'aborted:', abortController.signal.aborted);
    try {
      if (isBook) {
        // ====== 整本模式：生成多章直到达到目标字数 ======
        const chapterSize = Math.max(2000, Math.min(5000, Math.floor(targetWordCount / 3))); // 每章约2000-5000字
        const maxChapters = Math.ceil(targetWordCount / 1000); // 防无限循环

        for (let ch = 1; ch <= maxChapters; ch++) {
          if (abortController.signal.aborted) break;

          const currentTotal = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
          const remaining = targetWordCount - currentTotal;
          if (remaining <= 0) break; // 达到目标字数

          // 蒸馏提纯上下文（根据章节数量动态压缩）
          const distilled = distillChapters(novel.chapters);

          const chPrompt = `请继续创作这部${type.name}小说。

主角：${protagonistName || '未设定'}
世界观：${worldSetting || '自由发挥'}
${outline ? '【创作大纲】\n' + outline + '\n' : ''}

已有章节摘要：
${distilled || '（故事开始）'}

当前是第${ch}章，剩余目标约${remaining}字。
要求：
1. 保持与前面章节一致的文风和节奏
2. 注意剧情连贯性，衔接上一章结尾
3. 如有大纲请严格遵循
4. 每章有独立的小高潮，同时推进主线
5. 全局规划好伏笔的铺设和回收
6. 目标本章约${chapterSize}字
7. 每章结束时标注【未完待续】`;

          await ensureTokensLeft(req.user);
          await generateOneChapter(ch, chPrompt);
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

      // 保存章节
      novel.chapters.push({ chapterNumber: chNum, title: `第${chNum}章`, content: buffer, wordCount: buffer.length });
      const sw = novel.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
      novel.currentWordCount = sw;
      novel.currentChapterIndex = chNum;
      await novel.save();
      deductTokens(req.user, buffer);

      res.write(`data: ${JSON.stringify({ type: 'chapter_end', chapterNumber: chNum, wordCount: buffer.length })}\n\n`);
      return buffer.length;
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

          const distilled = distillChapters(novel.chapters);

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
            novel.chapters.push({ chapterNumber, title: `第${chapterNumber}章`, content: chapterBuffer, wordCount: chapterBuffer.length });
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

    function saveChapterContent() {
      if (!appendBuffer.trim()) return;
      const idx = novel.chapters.findIndex(c => c.chapterNumber === chNum);
      if (idx > -1) {
        novel.chapters[idx].content = (novel.chapters[idx].content || '') + appendBuffer;
        novel.chapters[idx].wordCount = (novel.chapters[idx].wordCount || 0) + appendBuffer.length;
        novel.markModified(`chapters.${idx}`);
      }
      novel.currentWordCount = (novel.currentWordCount || 0) + appendBuffer.length;
    }

    req.on('close', async () => {
      activeStreams.delete(streamKey);
      if (!generationDone) {
        abortController.abort();
        saveChapterContent();
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
        saveChapterContent();
        novel.status = 'paused'; await novel.save();
        deductTokens(req.user, appendBuffer);
        return;
      }

      generationDone = true;
      activeStreams.delete(streamKey);
      saveChapterContent();
      novel.status = 'completed'; await novel.save();
      deductTokens(req.user, appendBuffer);

      res.write(`data: ${JSON.stringify({ type: 'chapter_continued', chapterNumber: chNum, addedLength: appendBuffer.length })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'completed' })}\n\n`);
      res.end();
    } catch (streamError) {
      activeStreams.delete(streamKey);
      saveChapterContent();
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

    res.json({ original: text, processed: result.content });
  } catch (error) {
    res.status(500).json({ message: '去AI味处理失败', error: error.message });
  }
});

// ====== 润色（SSE流式，支持自定义润色方案） ======
router.post('/polish', auth, async (req, res) => {
  try {
    const { text, polishPrompt, doDeslop } = req.body;
    if (!text || text.trim().length < 10) return res.status(400).json({ message: '文本太短' });

    const defaultPolishPrompt = `你是一位专业的小说润色专家。请对以下小说文本进行润色优化，要求：

1. 修正语病和不通顺的句子
2. 优化用词，使表达更加精准生动
3. 调整句式节奏，让阅读更流畅
4. 保留原文的风格和情节
5. 保持人物性格的一致性
6. 注意段落间的衔接自然

请直接输出润色后的完整文本，不要加任何评价或说明。`;

    const userPrompt = `${polishPrompt || defaultPolishPrompt}\n\n以下是需要润色的文本：\n\n${text}`;

    // SSE 流式输出润色结果
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let polished = '';
    const abortController = new AbortController();

    req.on('close', () => { try { abortController.abort(); } catch {}; try { res.end(); } catch {} });

    await streamGenerate(
      '你是一位专业的小说润色专家，擅长各种文风的精修与优化。',
      userPrompt,
      (chunk) => {
        polished += chunk;
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
      },
      abortController.signal,
      resolveApiConfig(req.user?.modelConfig, 'writing')
    );

    // 如果用户选择了去AI味
    if (doDeslop && polished.trim().length > 10) {
      res.write(`data: ${JSON.stringify({ type: 'status', message: '正在执行去AI味处理...' })}\n\n`);

      const deslopPrompt = `${deslop.deslopSystemPrompt}\n\n请对以下文本进行去AI味处理：\n\n${polished}`;

      let desloped = '';
      await streamGenerate(
        '你是一位专业的小说润色专家。',
        deslopPrompt,
        (chunk) => {
          desloped += chunk;
          res.write(`data: ${JSON.stringify({ type: 'deslop_content', content: chunk })}\n\n`);
        },
        abortController.signal,
        resolveApiConfig(req.user?.modelConfig, 'writing')
      );

      if (desloped.trim().length > 10) polished = desloped;
    }

    res.write(`data: ${JSON.stringify({ type: 'completed', totalLength: polished.length })}\n\n`);
    res.end();
  } catch (error) {
    console.error('润色失败:', error);
    try { res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`); res.end(); } catch {}
  }
});

module.exports = router;
