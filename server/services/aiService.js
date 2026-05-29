const novelTypes = require('../config/novelTypes');
const deslop = require('../config/deslop');

/**
 * 估算 token 消耗（中文字符 ≈ 1.5 token，英文 ≈ 0.3 token）
 */
function countTokens(text) {
  if (!text) return 0;
  let tokens = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) {
      tokens += 1.5; // 中文
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      tokens += 0.3;  // 英文/数字
    } else {
      tokens += 0.5; // 标点/空格
    }
  }
  return Math.ceil(tokens);
}

/**
 * 构建小说生成系统提示词（支持男女频区分）
 * @param {string} novelTypeId - 类型 ID
 * @param {string} [gender] - 'male' | 'female' | 'unisex'
 */
function buildSystemPrompt(novelTypeId, gender) {
  const type = novelTypes.find(t => t.id === novelTypeId || t.name === novelTypeId);
  if (!type) return '你是一位专业的小说家，擅长创作各种类型的小说。';

  // 轻小说使用日式ACGN专属提示
  if (novelTypeId && novelTypeId.startsWith('lightnovel_')) {
    return `你是一位专业的轻小说作家，擅长创作日式ACGN风格的${type.name}题材作品。

写作风格要求：
1. 【角色为核心】角色萌属性鲜明（傲娇、天然呆、无口、元气等），每个角色有自己的口头禅或习惯动作
2. 【对话驱动】多用对话推进剧情，角色对话自然生动，加入日式吐槽和内心独白
3. 【描写的节奏】场景描写简洁但有画面感，注重角色表情和动作的细节刻画
4. 【萌系要素】适当加入脸红、慌张、嘟嘴、傲娇扭头等动漫式反应
5. 【叙事视角】可采用第一人称或第三人称紧贴主角的限定视角
6. 【章节结构】每章要有起承转合，结尾留钩子（cliffhanger）或温馨收尾
7. 【语言风格】文字轻松活泼，可以加入可爱的象声词和语气词
8. 【禁止AI味】不使用"仿佛、好像、不禁、微微、眼中闪过"等词汇

题材关键词：${type.keywords}
推荐用词：${type.aiWordBank}
大纲参考：${type.outline}

请直接开始创作，角色名称使用日本风格的名字，适当加入日式称呼（さん、くん、ちゃん等）。`;
  }

  // 国产小说 — 根据 gender 区分写作指导
  const genderGuide = gender === 'female' ? `
3. 【情感刻画优先】细腻描写人物的内心活动和情感变化，动作和环境为情感服务
4. 【关系驱动】以人物关系的演变推动剧情，注重互动中的微妙张力
5. 【氛围营造】场景描写要有氛围感和画面感，烘托情绪基调
6. 【对话与潜台词】对话不仅是信息传递，更是情感交流和关系博弈的载体
7. 【爽点节奏】虐心的桥段后必有甜宠回馈，保持"先苦后甜"的情感节奏` : `
3. 【节奏紧凑】保持张弛有度的叙事节奏，每章至少有一个小高潮或悬念钩子
4. 【爽点明确】每一段剧情都要有明确的"爽点"（升级/打脸/收获/揭秘）
5. 【世界观清晰】逐步展开世界观设定，通过剧情自然带出而非大段说明
6. 【对话直给】对话简洁有力，服务于剧情推进和人物塑造
7. 【战斗/冲突描写】动作场面要有画面感和层次感，避免干巴巴的叙述`;

  return `你是一位专业的小说家，擅长创作${type.name}类型的${gender === 'female' ? '女性向' : '男性向'}小说。
写作关键词：${type.keywords}
写作大纲参考：${type.outline}
推荐用词：${type.aiWordBank}

写作要求：
1. 请完全按照${type.name}风格创作
2. 每章约2000-3000字
${genderGuide}
${deslop.systemDeslopPrompt}`;
}

/**
 * 生成大纲的提示词
 */
function buildOutlinePrompt(novelTypeId, protagonistName, worldSetting, targetWordCount) {
  const type = novelTypes.find(t => t.id === novelTypeId);
  return `你是一位专业的小说大纲策划师。请为一部${type ? type.name : ''}小说创作一份完整的创作大纲。

主角名字：${protagonistName || '未设定'}
世界观设定：${worldSetting || '由你自由发挥'}
目标总字数：约${targetWordCount}字

请按以下格式输出大纲：

【故事主线】
（用3-5句话概括核心故事线）

【核心冲突】
（描述主要冲突和矛盾）

【主要角色】
（列出主角和重要配角及其定位）

【剧情阶段】
（按时间线划分3-5个阶段，每个阶段用3句话描述）

【结局方向】
（概述故事的结局走向）

【关键节点】
（列出3-5个重要剧情转折点）

请直接输出大纲内容，不要加额外的解释。`;
}

/**
 * 蒸馏提纯：根据章节数量动态调整上下文压缩策略
 * - 章节少时：保留详细内容
 * - 章节多时：最近2章保留详情，之前的压缩为摘要
 * - 上限字符数：10000
 */
function distillChapters(chapters) {
  if (!chapters || chapters.length === 0) return '';

  const totalChars = chapters.reduce((s, c) => s + (c.content || '').length, 0);
  const threshold = 8000; // 超过此阈值触发压缩

  if (totalChars <= threshold || chapters.length <= 3) {
    // 内容少：保留每章前3000字，总上限10000
    return chapters.map((ch, i) => {
      const content = (ch.content || '').slice(0, 3000);
      return `【第${ch.chapterNumber}章（${ch.wordCount}字）】\n${content}`;
    }).join('\n\n').slice(0, 10000);
  }

  // 内容多：最近2章保留详情，前面的章节压缩为单行摘要
  const recentChapters = chapters.slice(-2);
  const earlyChapters = chapters.slice(0, -2);

  const earlySummary = earlyChapters.map((ch, i) => {
    const firstLine = (ch.content || '').split('\n')[0] || '';
    return `第${ch.chapterNumber}章（${ch.wordCount}字）：${firstLine.slice(0, 50)}...`;
  }).join('\n');

  const recentDetail = recentChapters.map((ch, i) => {
    const content = (ch.content || '').slice(0, 2000);
    return `【第${ch.chapterNumber}章（${ch.wordCount}字）】\n${content}`;
  }).join('\n\n');

  return `【前期章节概要】\n${earlySummary}\n\n【最近章节详情】\n${recentDetail}`.slice(0, 10000);
}

function buildInitialPrompt(novelTypeId, protagonistName, worldSetting, targetWordCount, mode, outline) {
  const type = novelTypes.find(t => t.id === novelTypeId);
  const isChapter = mode === 'chapter';
  const outlineText = outline ? `\n【创作大纲】\n${outline}\n` : '';
  const continuityNote = isChapter
    ? '请创作一个完整的章节，有起承转合。'
    : '请创作一部完整的小说，注意以下要点：\n'
      + '1. 保持情节的连贯性，前后呼应\n'
      + '2. 伏笔要在后续章节中合理回收\n'
      + '3. 人物弧光要完整，性格发展要有逻辑\n'
      + '4. 开篇要吸引人，中间要有冲突和转折，结局要圆满\n'
      + '5. 这不是独立的章节拼接，而是一部浑然一体的作品\n'
      + '6. 每章结束时可以留悬念，但不要中断主线剧情';

  return `请创作一部${type ? type.name : ''}小说。

主角名字：${protagonistName || '未设定'}
世界观设定：${worldSetting || '由你自由发挥'}
目标字数：约${targetWordCount}字${outlineText}

${continuityNote}

请从第一章开始，保持风格统一，全局规划好剧情走向。每章结束时标注【未完待续】。`;
}

function buildContinuePrompt(novelId, novel) {
  // 蒸馏提纯：提取所有章节的关键内容
  const distilled = distillChapters(novel.chapters);
  const outlineNote = novel.outline ? `\n【创作大纲】\n${novel.outline}\n` : '';

  return `请继续创作这部小说。

小说类型：${novel.novelTypeName}
主角：${novel.protagonistName || '未设定'}
${outlineNote}

以下是从已有章节中提取的完整剧情脉络（包含所有伏笔和人物线）：

${'='.repeat(40)}
${distilled}
${'='.repeat(40)}

续写要求：
1. 仔细阅读上述所有内容，理解剧情的整体走向
2. 注意尚未回收的伏笔，在后续章节中要合理回收
3. 保持人物性格和风格的一致性
4. 剧情衔接要自然，不要跳跃或矛盾
5. 如有大纲请严格遵循大纲方向

请从第${novel.currentChapterIndex + 1}章开始续写。每章结束时标注【未完待续】。`;
}

/**
 * 构建导入小说续写提示词（蒸馏提纯版）
 */
function buildImportContinuePrompt(importedText, continuationRequest, novelTypeName, targetWordCount, mode) {
  // 对导入文本进行分段提纯
  const paragraphs = (importedText || '').split(/\n{2,}/);
  const distilled = paragraphs.slice(0, 30).map((p, i) => `[段落${i + 1}] ${p.slice(0, 500)}`).join('\n');

  const isChapter = mode === 'chapter';
  const targetHint = isChapter
    ? `本次只续写一个章节（目标约${targetWordCount}字），请写出一个完整的章节`
    : `目标总字数约${targetWordCount}字，分多个章节续写，注意全局连贯性和伏笔回收`;

  return `你是一位专业的小说续写专家。请仔细阅读下方导入小说的完整剧情脉络，理解其风格、剧情走向、人物设定及所有伏笔，然后根据要求续写。

小说风格类型：${novelTypeName || '未知'}

用户导入的小说完整内容摘要（含全部情节脉络）：
${'='.repeat(40)}
${distilled.slice(0, 10000)}
${'='.repeat(40)}

用户续写要求：
${continuationRequest || '请根据已有内容和风格自然续写'}
${targetHint}

写作要求：
1. 完全保持与导入小说一致的文风和叙事风格
2. 延续已有的人物性格、世界观设定
3. 剧情发展符合逻辑，衔接自然
4. 每章约2000-3000字
5. 语言生动有画面感
6. 从导入内容结束处开始续写，不要重复已有的内容
7. 每章结束时标注【未完待续】`;
}

/**
 * 根据用户配置和模型类型获取 API 请求参数
 */
function resolveApiConfig(userModelConfig, modelType = 'writing') {
  const defaults = {
    baseUrl: process.env.AI_API_BASE,
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
  };

  if (!userModelConfig || userModelConfig.provider === 'default' || userModelConfig.provider === 'system') {
    return defaults;
  }

  const modelFieldMap = {
    outline: 'OutlineModel', writing: 'WritingModel',
    polish: 'PolishModel', reasoning: 'ReasoningModel',
  };
  const fieldSuffix = modelFieldMap[modelType] || 'WritingModel';

  if (userModelConfig.provider === 'ollama') {
    const model = userModelConfig[`ollama${fieldSuffix}`];
    if (!model) return defaults;
    return {
      baseUrl: userModelConfig.ollamaBaseUrl || 'http://localhost:11434',
      apiKey: '', model,
    };
  }

  if (userModelConfig.provider === 'cloud') {
    const model = userModelConfig[`cloud${fieldSuffix}`];
    if (!model) return defaults;
    return {
      baseUrl: userModelConfig.cloudBaseUrl || defaults.baseUrl,
      apiKey: userModelConfig.cloudApiKey || defaults.apiKey, model,
    };
  }

  return defaults;
}

/**
 * 流式生成
 * @returns {Promise<{content:string, tokenCount:number}>}
 */
async function streamGenerate(systemPrompt, userPrompt, onChunk, signal, apiConfig, retries = 2) {
  const config = apiConfig || resolveApiConfig(null);
  const isOllama = config.baseUrl && config.baseUrl.includes('localhost:11434');
  const apiUrl = isOllama
    ? `${config.baseUrl.replace(/\/+$/, '')}/api/chat`
    : `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const body = isOllama
    ? { model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], stream: true, options: { temperature: 0.8, num_predict: 8192 } }
    : { model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], stream: true, temperature: 0.8, max_tokens: 8192 };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);
      const combinedSignal = controller.signal;

      const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: combinedSignal });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        if ((response.status === 503 || response.status === 429) && attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`AI API 请求 ${response.status}，第 ${attempt + 1} 次重试，等待 ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(`AI API 请求失败: ${response.status} ${errorText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        if (isOllama) {
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              const content = parsed.message?.content || '';
              if (content) { fullContent += content; if (onChunk) onChunk(content); }
              if (parsed.done) break;
            } catch (e) { /* skip */ }
          }
        } else {
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed.startsWith('data: ')) {
              const data = trimmed.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) { fullContent += content; if (onChunk) onChunk(content); }
              } catch (e) { /* skip */ }
            }
          }
        }
      } // while

      return { content: fullContent, tokenCount: countTokens(fullContent) };

    } catch (e) {
      clearTimeout(timeoutId);
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`AI API 请求异常（${e.message}），第 ${attempt + 1} 次重试，等待 ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      // 所有重试耗尽，向外抛
      throw (e.name === 'AbortError') ? new Error('AI API 请求超时（90s）') : e;
    }
  } // for
  // 所有尝试均失败（理论上不会到达，但保留以防万一）
  throw new Error('AI API 请求失败，所有重试均已耗尽');
}

/**
 * 构建章节计划表（细化到每一章的事件、伏笔、字数）
 */
function buildChapterPlan(outline, targetWordCount, protagonistName, worldSetting, structureRef) {
  const estChapters = Math.max(10, Math.ceil(targetWordCount / 3000));

  let planPrompt = `你是一位专业的小说章节规划师。请根据以下素材制定一份详细的章节计划表。

目标：约${targetWordCount}字，预计${estChapters}章

素材：
主角：${protagonistName || '未设定'}
世界观：${worldSetting || '自由发挥'}
大纲：
${outline || '无大纲，请自行规划故事'}`;

  if (structureRef) {
    planPrompt += `\n\n参考小说结构（必须严格遵循）：
${structureRef}`;
  }

  planPrompt += `\n\n请按以下格式输出【章节计划表】（每章一行，不要额外解释）：

【章节计划表】
阶段1: [阶段名称](第X-Y章) — [一句话概括本阶段]
第1章([字数]字): [本章核心事件] | 埋伏笔: [伏笔1],[伏笔2] | 回收伏笔: [伏笔1] | 关键角色: [角色]
第2章([字数]字): [本章核心事件] | 埋伏笔: [伏笔3] | 回收伏笔: [伏笔2] | 关键角色: [角色]
...
阶段2: [阶段名称](第X-Y章) — [一句话概括]
...

关键规则：
1. 每个伏笔设置后，必须在后续某章中标明"回收伏笔: [该伏笔]"
2. 最后5-8章集中回收所有遗留伏笔，确保结局不烂尾
3. 重要转折所在的章标 ★转折点
4. 每章字数3000-5000字
5. 总章节数控制在${estChapters}章左右
6. 用"大结局"标注最后一章`;

  return planPrompt;
}

/**
 * 根据章节计划和已完成章数，构建当前故事状态摘要
 */
function buildStoryStateSummary(chapterPlan, currentChapter, totalChapters, currentWords, targetWords) {
  const progress = Math.round((currentWords / targetWords) * 100);
  const phase = progress < 25 ? '开端' : progress < 55 ? '发展' : progress < 80 ? '转折' : '高潮结局';
  const remaining = totalChapters - currentChapter + 1;

  // 从章节计划中提取本阶段和伏笔信息
  // 简单实现：直接提取计划文本中相关段落
  let currentPhase = '';
  let pendingForeshadowing = '（请参考章节计划表）';
  let revealedForeshadowing = '（请参考章节计划表）';

  // 根据进度判断当前所处阶段
  if (chapterPlan) {
    const phases = chapterPlan.match(/阶段\d+:[^\n]+/g) || [];
    const phaseIdx = Math.min(Math.floor(progress / 25), phases.length - 1);
    currentPhase = phases[phaseIdx] || '进行中';
  }

  return `【当前故事状态】
当前阶段: ${currentPhase} (已完成 ${progress}%)
已生成: ${currentChapter - 1}/${totalChapters} 章, ${currentWords}/${targetWords} 字
剩余: ${remaining} 章

【伏笔追踪】
${pendingForeshadowing}

${revealedForeshadowing}

【写作提示】
- 当前处于${phase}阶段，注意节奏把控
- ${remaining <= 8 ? '⚠️ 剩余章节不多，开始集中回收伏笔，准备结局！' : ''}
- ${remaining <= 3 ? '⚡ 最后几章，收束所有故事线，给出有力量的结局！' : ''}
- ${progress >= 80 ? '📌 已接近目标字数，确保在剩余章节内完成主线和副线收束。' : '📌 按章节计划推进，确保每章有明确的目标。'}`;
}

module.exports = {
  buildSystemPrompt, buildInitialPrompt, buildContinuePrompt,
  buildImportContinuePrompt, buildOutlinePrompt, distillChapters,
  buildChapterPlan, buildStoryStateSummary,
  streamGenerate, resolveApiConfig, countTokens,
};
