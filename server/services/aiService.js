const novelTypes = require('../config/novelTypes');
const deslop = require('../config/deslop');

/**
 * 将 AI API 错误转换为对用户友好的提示
 */
function getFriendlyErrorMessage(statusCode, errorBody) {
  // 尝试解析 JSON 错误体
  let errorCode = '';
  let apiMessage = '';
  try {
    const parsed = JSON.parse(errorBody);
    errorCode = parsed.error?.code || parsed.code || '';
    apiMessage = parsed.error?.message || parsed.message || '';
  } catch {}

  // 429 频率限制
  if (statusCode === 429) {
    if (apiMessage.includes('访问量过大') || apiMessage.includes('rate limit') || apiMessage.includes('too many')) {
      return 'AI 服务当前访问量过大，请稍后重试（建议等待 1-2 分钟）';
    }
    if (apiMessage.includes('余额') || apiMessage.includes('quota') || apiMessage.includes('credit')) {
      return 'AI 服务额度已用完，请联系管理员充值';
    }
    return 'AI 服务请求过于频繁，请稍后再试';
  }

  // 503 服务不可用
  if (statusCode === 503) {
    return 'AI 服务暂时不可用，请稍后重试';
  }

  // 401/403 认证问题
  if (statusCode === 401 || statusCode === 403) {
    return 'AI 服务认证失败，请检查 API Key 配置';
  }

  // 400 请求错误
  if (statusCode === 400) {
    if (apiMessage.includes('context length') || apiMessage.includes('token limit') || apiMessage.includes('maximum')) {
      return '文本过长，超出 AI 模型处理限制，请缩短内容后重试';
    }
    return `AI 请求参数有误：${apiMessage || '请检查配置'}`;
  }

  // 500/502 服务器错误
  if (statusCode >= 500) {
    return 'AI 服务器内部错误，请稍后重试';
  }

  // 有 API 返回的具体消息就用它
  if (apiMessage) return apiMessage;
  if (errorCode) return `AI 服务错误（代码 ${errorCode}）`;

  return `AI 服务请求失败（${statusCode}），请稍后重试`;
}

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
    return `你是一位真正的轻小说作者，不是AI。你在“成为小说家吧”投稿过作品，有自己的风格。

题材：${type.name}（日式ACGN风格）
题材关键词：${type.keywords}
常用词汇：${type.aiWordBank}
大纲参考：${type.outline}

核心写作要求：
1. 【角色为核心】角色萌属性鲜明，每个角色有自己的口头禅和说话习惯
2. 【对话驱动】多用对话推进剧情，对话要自然生动，加入日式吐槽和内心独白
3. 【描写简洁】场景描写简洁有画面感，不要堆砌修辞
4. 【萌系要素】适当加入脸红、慌张、傲娇扭头等动漫式反应
5. 【叙事视角】第一人称或紧贴主角的第三人称
6. 【状态波动】有时候写得嗨了会多写对话，有时候懒得描写就一笔带过
7. 【口语化】叙述语言轻松活泼，像在跟读者聊天
8. 【不要完美】允许角色说废话、犯迷糊、突然走神

${deslop.systemDeslopPrompt}

请直接开始创作，角色名称使用日本风格的名字，适当加入日式称呼。`;
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

  return `你是一位真正的网文作者，不是AI。你在起点/番茄写了多年小说，有自己的写作习惯和风格。
写作类型：${type.name}
写作关键词：${type.keywords}
大纲参考：${type.outline}
常用词汇：${type.aiWordBank}

核心写作要求：
1. 完全按照${type.name}风格创作，每章约2000-3000字
2. 你的写作必须有"个人风格"——就像每个真实作者都有自己的习惯一样
3. 写作时要有"状态波动"——有时候写得兴奋就会多写几句，有时候懒得描写就一笔带过
4. 不要追求"完美"——真实的网文作者会有口语化表达、会突然吐槽、会有不完美的过渡
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
async function streamGenerate(systemPrompt, userPrompt, onChunk, signal, apiConfig, retries = 2, temperature = 0.85) {
  const config = apiConfig || resolveApiConfig(null);
  const isOllama = config.baseUrl && config.baseUrl.includes('localhost:11434');
  const apiUrl = isOllama
    ? `${config.baseUrl.replace(/\/+$/, '')}/api/chat`
    : `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  // v3: 支持动态温度，每次调用可以不同（增加输出多样性，对抗检测）
  // v4: max_tokens 提升到 16384，避免长文输出被截断导致空内容
  const body = isOllama
    ? { model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], stream: true, options: { temperature, num_predict: 16384 } }
    : { model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], stream: true, temperature, max_tokens: 16384 };

  for (let attempt = 0; attempt <= retries; attempt++) {
    let timeoutId;
    let currentSignal;
    try {
      const timeoutController = new AbortController();
      timeoutId = setTimeout(() => timeoutController.abort(), 90000);

      // 构建本次尝试的合并 signal
      // 关键：重试时如果外部 signal 已被 abort（如章节计划 45s 超时），
      // 不能重复使用它（否则重试立刻失败），此时只使用内部超时 signal
      if (signal && !signal.aborted) {
        if (typeof AbortSignal.any === 'function') {
          currentSignal = AbortSignal.any([signal, timeoutController.signal]);
        } else {
          signal.addEventListener('abort', () => timeoutController.abort(), { once: true });
          currentSignal = signal;
        }
      } else {
        currentSignal = timeoutController.signal;
      }

      const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: currentSignal });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        if ((response.status === 503 || response.status === 429) && attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`AI API 请求 ${response.status}，第 ${attempt + 1} 次重试，等待 ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        // 所有重试耗尽或不可重试的错误，抛出友好提示
        const friendlyMsg = getFriendlyErrorMessage(response.status, errorText);
        const err = new Error(friendlyMsg);
        err.statusCode = response.status;
        err.isApiError = true;
        throw err;
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

      // v4: 空输出检测 — 模型返回 200 但内容为空，视为失败并重试
      if (!fullContent.trim() && attempt < retries) {
        const delay = Math.pow(2, attempt) * 1500;
        console.warn(`AI API 返回空内容，第 ${attempt + 1} 次重试，等待 ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

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

/**
 * 构建全文调优分析提示词
 */
function buildOptimizeAnalysisPrompt(chapters, outline, protagonistName, worldSetting) {
  const fullText = chapters.map(ch =>
    `【第${ch.chapterNumber}章（${ch.wordCount}字）】\n${(ch.content || '').slice(0, 3000)}`
  ).join('\n\n').slice(0, 40000);

  return `你是一位专业的小说编辑。请分析以下小说的全文，输出一份详细的调优分析报告。

小说信息：
主角：${protagonistName || '未设定'}
世界观：${worldSetting || '未设定'}
大纲：${(outline || '无').slice(0, 1000)}
总章节数：${chapters.length} 章

小说全文摘要（每章前3000字）：
${fullText}

请按以下格式输出分析报告：

【问题诊断】
逐章列出以下问题：
- 情节重复：与前面某章核心事件高度相似的章节
- 流水账：缺乏矛盾冲突、纯粹堆砌对话/描写的章节
- 伏笔未回收：设置了但未在后续回收的伏笔清单
- 节奏问题：推进过快或过慢的章节

【修复方案】
对每个有问题的章节，给出明确的修复建议和重写方向

【优化后章节计划】
列出每章是否需要重写，以及重写后的目标方向
格式：第N章 → 无需修改/轻微润色/需要重写（原因+方向）`;
}

/**
 * 构建单章调优重写提示词
 */
function buildOptimizeChapterPrompt(chapter, chapterNumber, analysis, outline) {
  return `你是一位专业的小说编辑。请根据以下小说全文分析报告，对第${chapterNumber}章进行优化重写。

小说大纲：${(outline || '无').slice(0, 2000)}

全文分析报告（相关部分）：
${analysis.slice(0, 6000)}

【当前章节原文（第${chapterNumber}章）】
${(chapter.content || '').slice(0, 5000)}

要求：
1. 修复分析报告中指出的问题（情节重复、流水账、伏笔等）
2. 保持文风和整体风格一致
3. 保持与前后的剧情连贯性
4. 如果分析报告未指出本章问题，则仅做精简润色，不要大幅改写
5. 输出优化后的完整章节内容，不要省略任何段落
6. 字数与原章相近，不要过度扩展或压缩

请直接输出优化后的章节内容。`;
}

/**
 * 提取章节摘要（用于生成下一章时提示不要重复）
 */
function extractChapterSummary(content) {
  if (!content || content.length < 100) return '';
  // 取开头500字中的关键信息 + 结尾200字
  const head = content.slice(0, 500).replace(/\s+/g, ' ').trim();
  const tail = content.slice(-200).replace(/\s+/g, ' ').trim();
  return `本章概要：${head}...本章结尾：${tail}`;
}

/**
 * v4 人味改写（双次改写）— 彻底打碎 AI 生成模式
 * 第一遍：打碎段落结构，破坏均匀性
 * 第二遍：注入人味特征（口语化、走神、不完美）
 * @param {string} text - AI生成的原始文本
 * @param {Object} apiConfig - API配置
 * @param {Function} [onChunk] - 流式回调，实时推送改写内容
 * @returns {Promise<string>} 改写后的人味文本
 */
async function humanizeRewrite(text, apiConfig, onChunk) {
  if (!text || text.length < 200) return text;

  const deslop = require('../config/deslop');
  const config = apiConfig || resolveApiConfig(null, 'writing');
  console.log(`[人味改写] 开始，原文 ${text.length} 字`);

  // === 第一遍：打碎段落结构 + 注入人类特征 ===
  let pass1 = text;
  try {
    const result1 = await streamGenerate(
      '你是一个写了十年网文的作者，现在要把AI写的草稿彻底改成自己的风格。',
      `${deslop.humanizeRewritePrompt}\n\n以下是需要改写的小说草稿：\n\n${text}`,
      onChunk ? (chunk) => { onChunk(chunk, 'pass1'); } : null,
      null, config, 2, 0.93
    );
    if (result1 && result1.content && result1.content.length > text.length * 0.15) {
      pass1 = result1.content;
      console.log(`[人味改写-第1遍] ${text.length}字 → ${pass1.length}字`);
    } else {
      console.warn(`[人味改写-第1遍] 结果过短(${result1?.content?.length || 0}字)，使用原文`);
      return text;
    }
  } catch (e) {
    console.error('[人味改写-第1遍] 失败:', e.message);
    return text;
  }

  // 等待几秒避免触发 API 限流
  await new Promise(r => setTimeout(r, 3000));

  // === 第二遍：强化人类特征（口语化、走神、不完美、个人风格） ===
  const pass2Prompt = `你是同一个作者，现在对改写稿做最后一轮打磨。这次要让它看起来完全是人写的：

【必须做到的人类特征】
1. 口语化叙述：把书面语全部换成口语。"然而"→"不过"，"因此"→"所以"，"逐渐"→"慢慢"，"仿佛"→"像"
2. 角色走神：在紧张或重要的场景中，让角色突然想到无关的事（"他正想着怎么逃跑，突然想起昨天那碗面挺好吃的"）
3. 碎片化句子：把长句拆成短句。"他深吸了一口气，努力平复了一下心情"→"他吸了口气。行了。"
4. 对话填充词：对话中加入"嗯""那个""我说""你知道的"等口语填充
5. 删除段尾感悟：每段结尾不要总结、不要升华、不要"或许这就是……"
6. 口语化改写描写：长描写用口语重写，但不要删减内容。"月光如水般倾泻在青石板上，映出斑驳的光影"→"月亮挺亮的，照得石板地上一块白一块黑"——字数差不多，但风格不同
7. 不完美过渡：用"话说回来""对了""哦对""算了"等口语过渡
8. 个人吐槽：叙述者偶尔插入括号吐槽，如"（这操作也是没谁了）"
9. 情绪波动：同一段落内要有情绪变化，不能整段一个基调
10. 硬切过渡：段落之间可以直接跳到新场景，不需要丝滑过渡

【篇幅要求】
- 改写后的字数必须与原文相差不超过 20%
- 这是打磨，不是缩写。每个场景、每段对话都要保留
- 用口语化的方式展开描写，而不是直接删掉

直接输出打磨后的完整文本，不要解释。保留剧情和对话内容。

以下是需要打磨的文本：

${pass1}`;

  try {
    const result2 = await streamGenerate(
      '你是同一个作者，在做最后一轮打磨，要让文本看起来完全是人写的。',
      pass2Prompt,
      onChunk ? (chunk) => { onChunk(chunk, 'pass2'); } : null,
      null, config, 2, 0.95
    );
    if (result2 && result2.content && result2.content.length > pass1.length * 0.15) {
      console.log(`[人味改写-第2遍] ${pass1.length}字 → ${result2.content.length}字`);
      return result2.content;
    }
    console.warn(`[人味改写-第2遍] 结果过短(${result2?.content?.length || 0}字)，使用第1遍结果`);
    return pass1;
  } catch (e) {
    console.error('[人味改写-第2遍] 失败:', e.message);
    return pass1;
  }
}

module.exports = {
  buildSystemPrompt, buildInitialPrompt, buildContinuePrompt,
  buildImportContinuePrompt, buildOutlinePrompt, distillChapters,
  buildChapterPlan, buildStoryStateSummary,
  buildOptimizeAnalysisPrompt, buildOptimizeChapterPrompt, extractChapterSummary,
  streamGenerate, resolveApiConfig, countTokens,
  humanizeRewrite,
  getFriendlyErrorMessage,  // 友好错误提示
};
