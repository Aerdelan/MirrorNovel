const novelTypes = require('../config/novelTypes');
const deslop = require('../config/deslop');
const { getServerRoute } = require('../config/modelPriceCatalog');

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
  if (!type) {
    return `你是一位专业的小说作者。先确认既有文本的叙事视角、叙事距离和语言气质，再沿用同一套作者声线继续创作。

${deslop.systemDeslopPrompt}`;
  }

  // 轻小说使用日式ACGN专属提示
  if (novelTypeId && novelTypeId.startsWith('lightnovel_')) {
    return `你是一位成熟的轻小说作者。你会从题材、人物关系和既有文本中提炼稳定的作者声线，并在全篇保持一致。

题材：${type.name}（日式ACGN风格）
题材关键词：${type.keywords}
题材语汇参考（只在具体语境成立时使用，禁止堆砌）：${type.aiWordBank}
大纲参考：${type.outline}

核心写作要求：
1. 【角色为核心】角色的辨识度来自成长背景、当前目标、性格弱点和彼此关系，不靠重复口头禅或标签化萌属性
2. 【对话驱动】对话必须推进事件、关系或认知；允许日式轻喜剧节奏，但笑点必须从人物处境和关系摩擦中自然产生
3. 【描写简洁】场景描写简洁有画面感，不要堆砌修辞
4. 【情绪可信】用人物当下的选择、动作和潜台词表现情绪，避免批量套用脸红、慌张、傲娇扭头等固定反应
5. 【叙事视角】第一人称或紧贴主角的第三人称
6. 【场景节奏】段落和句子长度服从场景功能：行动可以利落，观察、判断和关系变化可以适当展开
7. 【语言气质】叙述语言轻松活泼，但不让叙述者随机插话，不用无关吐槽破坏沉浸
8. 【轻重平衡】沉重段落后的轻松片段必须同时推进关系、信息或伏笔，不能只为调节气氛而插入笑话

${deslop.systemDeslopPrompt}

请直接开始创作，角色名称使用日本风格的名字，适当加入日式称呼。`;
  }

  // 国产小说 — 根据 gender 区分写作指导
  const genderGuide = gender === 'female' ? `
5. 【情感刻画优先】细腻描写人物的内心活动和情感变化，动作和环境为情感服务
6. 【关系驱动】以人物关系的演变推动剧情，注重互动中的微妙张力
7. 【氛围营造】场景描写要有氛围感和画面感，烘托情绪基调
8. 【对话与潜台词】对话不仅是信息传递，更是情感交流和关系博弈的载体
9. 【轻重节奏】沉重情节后可以留出关系缓冲，但不强制发糖；轻松片段仍要推进关系、信息或伏笔` : `
5. 【节奏紧凑】保持张弛有度，每章都要有实质变化；悬念和高潮应由当前因果自然累积，不机械卡点
6. 【回报可信】升级、反击、收获或揭秘必须来自人物此前的选择与代价，不要求每段都安排爽点
7. 【世界观清晰】逐步展开世界观设定，通过剧情自然带出而非大段说明
8. 【对话直给】对话简洁有力，服务于剧情推进和人物塑造
9. 【战斗/冲突描写】动作场面要有画面感和层次感，避免干巴巴的叙述`;

  return `你是一位成熟的网文作者。你会从题材、人物关系和既有文本中提炼稳定的作者声线，并在全篇保持一致。
写作类型：${type.name}
写作关键词：${type.keywords}
大纲参考：${type.outline}
题材语汇参考（只在具体语境成立时使用，禁止堆砌）：${type.aiWordBank}

核心写作要求：
1. 按照${type.name}的题材规律创作，并遵循当前章节任务给出的目标篇幅
2. 从既有文本提炼叙事视角、叙事距离、用词密度和句法节奏，后续章节不要随机更换作者声线
3. 用人物的具体观察、选择、动作和潜台词承载情绪，让每个场景都产生可追踪的因果变化
4. 段落和句长由场景决定，不设置机械比例，不为显得随意而故意走神、吐槽、硬切或制造语病
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
  const managedRoute = getServerRoute(userModelConfig?.routeId);
  const defaults = {
    baseUrl: managedRoute.baseUrl,
    apiKey: managedRoute.apiKey,
    model: managedRoute.model,
    routeId: managedRoute.id,
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
    if (!model) throw new Error('本地模型配置不完整，请先选择模型');
    return {
      baseUrl: userModelConfig.ollamaBaseUrl || 'http://localhost:11434',
      apiKey: '', model,
    };
  }

  if (userModelConfig.provider === 'cloud') {
    const model = userModelConfig[`cloud${fieldSuffix}`];
    if (!userModelConfig.cloudBaseUrl || !userModelConfig.cloudApiKey || !model) {
      throw new Error('自备云模型配置不完整，请填写地址、密钥和模型');
    }
    return {
      baseUrl: userModelConfig.cloudBaseUrl,
      apiKey: userModelConfig.cloudApiKey,
      model,
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
  if (!config.baseUrl || !config.model) {
    const error = new Error('AI 服务线路尚未配置，请联系管理员填写该线路的服务地址和模型名称');
    error.isApiError = true;
    throw error;
  }
  const isOllama = config.baseUrl && config.baseUrl.includes('localhost:11434');
  const apiUrl = isOllama
    ? `${config.baseUrl.replace(/\/+$/, '')}/api/chat`
    : `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  // 支持按任务传入温度；续写可保留创造性，校稿任务使用更低温度减少事实漂移。
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

      console.log(`[AI] 请求开始: ${config.model} -> ${apiUrl}`);
      const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: currentSignal });
      console.log(`[AI] 收到响应头, status=${response.status}`);

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AI] 错误响应: status=${response.status}, body=${errorText.slice(0, 300)}`);
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
      let firstChunkLogged = false;

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
                if (content) {
                  if (!firstChunkLogged) { firstChunkLogged = true; console.log('[AI] 收到首个内容片段'); }
                  fullContent += content; if (onChunk) onChunk(content);
                }
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

  planPrompt += `\n\n请只输出合法 JSON，不要 Markdown、不要解释、不要代码块。输出结构如下：
{
  "version": 1,
  "phases": ["阶段名称（第1-5章）：本阶段目的"],
  "chapters": [
    {
      "chapterNumber": 1,
      "wordTarget": 3000,
      "phase": "阶段名称",
      "coreEvent": "本章唯一、不可与相邻章节重复的核心事件",
      "setHooks": ["本章新埋的具体伏笔"],
      "resolveHooks": ["本章明确回收的既有伏笔"],
      "characters": ["本章关键角色"],
      "chapterRole": "主线推进/关系推进/信息揭示/喘息推进/收束",
      "tension": 1
    }
  ]
}

关键规则：
1. 每个伏笔设置后，必须在后续某章的 resolveHooks 中写出同一伏笔名称；最后 5-8 章集中回收，不留悬空线索。
2. 每章只能有一个核心事件，不能把多个大转折塞进同一章；相邻章节的 coreEvent 不得重复。
3. tension 是 1-10。连续 3 章 tension 不得都高于 7；在非结局段可安排 "喘息推进"，但它仍要推进关系、信息或伏笔。
4. 沉重、悬疑、悲剧题材的喘息章只可使用温情、生活细节或黑色幽默，不能突然变成纯搞笑日常。
5. 每章字数 2000-4200，总章数约 ${estChapters} 章；最后一章 chapterRole 为 "收束"，完整回收主线。
6. 所有数组都必须存在；没有内容时返回 []。`;

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
 * 双轮叙事改写。
 * 第一遍：在事实、视角和篇幅不变的前提下去除模板化表达。
 * 第二遍：以原文为事实基准，复核作者声线、人物声音和场景节奏。
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

  const hasAcceptableLength = (candidate, source) => {
    if (!candidate || !source) return false;
    const ratio = candidate.trim().length / source.trim().length;
    return ratio >= 0.8 && ratio <= 1.2;
  };

  // === 第一遍：保真重写，去除模板化表达 ===
  let pass1 = text;
  try {
    const result1 = await streamGenerate(
      '你是一位资深小说文字编辑。你的首要职责是守住原文事实、情节、视角、作者声线和篇幅，只修正削弱叙事可信度的表达。',
      `${deslop.humanizeRewritePrompt}\n\n以下是需要改写的小说草稿：\n\n${text}`,
      onChunk ? (chunk) => { onChunk(chunk, 'pass1'); } : null,
      null, config, 2, 0.72
    );
    if (result1 && hasAcceptableLength(result1.content, text)) {
      pass1 = result1.content;
      console.log(`[人味改写-第1遍] ${text.length}字 → ${pass1.length}字`);
    } else {
      console.warn(`[人味改写-第1遍] 篇幅漂移(${result1?.content?.length || 0}字)，使用原文`);
      return text;
    }
  } catch (e) {
    console.error('[人味改写-第1遍] 失败:', e.message);
    return text;
  }

  // 等待几秒避免触发 API 限流
  await new Promise(r => setTimeout(r, 3000));

  // === 第二遍：以原文为基准做连续性与声线复核 ===
  const pass2Prompt = `你是同一位小说编辑。请对候选稿做最后一轮校稿，原文是唯一的事实基准。

【保真优先级】
1. 保留原文的角色、身份、关系、地点、时间顺序、道具、行动结果、线索、伏笔、揭示和结尾落点，不增加原文没有的事件或设定。
2. 保持原文的叙事人称、视角人物、叙事距离和时态。候选稿若发生视角漂移或替人物补写其不可能知道的信息，必须恢复。
3. 保留每场戏和每段对话的核心意图；可以调整措辞，不得改变人物选择、信息量和因果关系。
4. 最终篇幅保持在原文的 80%-120%，这是校稿，不是扩写、缩写或另写一版。

【只处理确有问题之处】
1. 统一作者声线。沿用原文已经建立的词汇密度、叙述温度和幽默尺度，不擅自换成编辑自己的文风。
2. 把空泛判断、重复解释和套话改成视角人物当下能感知的具体观察、动作或选择，但细节必须与场景有关。
3. 检查动作、反应与结果之间的因果；检查对话是否有目标、回避、试探或潜台词，而不是轮流说明剧情。
4. 人物声音来自其背景、目标、情绪和彼此关系，不统一添加口头禅、填充词、粗口或碎片句。
5. 句长和段落长度服从场景：动作需要清楚，犹豫需要停顿，关系变化需要留白。不要按比例拆段或机械追求长短交替。
6. 沉重题材中的轻松只能来自人物关系或处境，并且要推进关系、信息或伏笔；不要在创伤、危险或哀痛中随机插入笑话。
7. 禁止为了显得像真人而加入无关走神、叙述者吐槽、括号旁白、固定口头禅、故意语病、错误标点或突兀硬切。

若候选稿已经符合要求，保留原句。直接输出完整终稿，不要解释、标题或修改说明。

【原文：事实与叙事基准】
${text}

【第一轮候选稿】
${pass1}`;

  try {
    const result2 = await streamGenerate(
      '你是一位谨慎的小说终审编辑。先保证事实、情节、视角、声线和篇幅不漂移，再做最少且必要的语言调整。',
      pass2Prompt,
      onChunk ? (chunk) => { onChunk(chunk, 'pass2'); } : null,
      null, config, 2, 0.55
    );
    if (result2 && hasAcceptableLength(result2.content, text)) {
      console.log(`[人味改写-第2遍] ${pass1.length}字 → ${result2.content.length}字`);
      return result2.content;
    }
    console.warn(`[人味改写-第2遍] 篇幅漂移(${result2?.content?.length || 0}字)，使用第1遍结果`);
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
