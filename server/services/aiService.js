const novelTypes = require('../config/novelTypes');
const deslop = require('../config/deslop');
const { getServerRoute } = require('../config/modelCatalog');

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

  // 内容审核拦截（悬疑灵异/恐怖等题材常见）：与状态码无关，优先识别
  if (/flagged|usage policy|content policy|invalid prompt|moderation/i.test(apiMessage)) {
    return '本次内容被 AI 服务的内容审核拦截（悬疑灵异、恐怖等题材常见）。可尝试：直接重试、更换模型/线路，或调整大纲与世界观设定后再生成';
  }

  // 429 频率限制
  if (statusCode === 429) {
    if (apiMessage.includes('访问量过大') || apiMessage.includes('rate limit') || apiMessage.includes('too many')) {
      return 'AI 服务当前访问量过大，请稍后重试（建议等待 1-2 分钟）';
    }
    if (apiMessage.includes('余额') || apiMessage.includes('quota') || apiMessage.includes('credit')) {
      return 'AI 服务额度已用完，请检查模型提供商配置';
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
 * 构建小说生成系统提示词（支持男女频区分 + 写作人格注入）
 * @param {string} novelTypeId - 类型 ID
 * @param {string} [gender] - 'male' | 'female' | 'unisex'
 * @param {object} [persona] - 写作人格（WritingPersona 文档或等价对象）
 *   - voice: 作者声线
 *   - tone:  语气与节奏
 *   - rules: 题材约束与人物声音规则
 *   - vocab: 推荐/禁用词表
 *   - overrideDeslop: 是否用 rules 接管默认 deslop 策略
 *   - name:  人格名称（仅用于日志）
 *
 * 注入策略（Q1 方案：替换声线 + 允许覆盖 deslop）：
 *   - persona 提供时，用其 voice/tone/rules 替换硬编码的"作者声线+写作要求"段
 *   - 题材信息（type.name/keywords/outline/aiWordBank）始终保留，因为这是题材元数据而非人格
 *   - overrideDeslop=false（默认）时，仍追加 deslop.systemDeslopPrompt（保留系统去AI化策略）
 *   - overrideDeslop=true 时，不再追加 deslop.systemDeslopPrompt，由 persona.rules 全权接管
 *   - persona 为空时，行为与旧版完全一致（向后兼容）
 */
function buildSystemPrompt(novelTypeId, gender, persona) {
  const type = novelTypes.find(t => t.id === novelTypeId || t.name === novelTypeId);
  const genreStyleContract = buildGenreStyleContract(novelTypeId, type);

  // ===== persona 注入分支 =====
  if (persona && (persona.voice || persona.tone || persona.rules)) {
    const personaBlock = [
      persona.voice ? `【作者声线】\n${persona.voice}` : '',
      persona.tone ? `【语气与节奏】\n${persona.tone}` : '',
      persona.rules ? `【写作规则】\n${persona.rules}` : '',
      persona.vocab ? `【用词表】\n${persona.vocab}` : '',
    ].filter(Boolean).join('\n\n');

    // 题材元数据（非人格，始终保留）
    const typeMeta = type ? [
      `写作类型：${type.name}`,
      `写作关键词：${type.keywords || ''}`,
      type.outline ? `大纲参考：${type.outline}` : '',
      type.aiWordBank ? `题材语汇参考（只在具体语境成立时使用，禁止堆砌）：${type.aiWordBank}` : '',
    ].filter(Boolean).join('\n') : '';

    // deslop 策略：默认保留系统去AI化；overrideDeslop=true 时由 persona.rules 接管
    const deslopTail = persona.overrideDeslop
      ? `\n\n（已启用自定义去AI化策略，遵循上方【写作规则】）`
      : `\n\n${deslop.systemDeslopPrompt}`;

    return `你是一位成熟的小说作者。请严格遵循下方给定的写作人格进行创作，在全篇保持声线一致。

${personaBlock}

${typeMeta}

${genreStyleContract}

请直接开始创作，从既有文本提炼叙事视角并保持一致。${deslopTail}`;
  }

  // ===== 以下为旧版逻辑（无 persona 时保持兼容） =====
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

${genreStyleContract}

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

${genreStyleContract}

${deslop.systemDeslopPrompt}`;
}

/**
 * 生成大纲的提示词
 */
function buildPersonaPrompt(persona, options = {}) {
  if (!persona) return '';
  const blocks = [
    persona.voice ? `【作者声线】\n${persona.voice}` : '',
    persona.tone ? `【语气与节奏】\n${persona.tone}` : '',
    persona.rules ? `【写作规则】\n${persona.rules}` : '',
    persona.vocab ? `【用词表】\n${persona.vocab}` : '',
  ].filter(Boolean);
  if (!blocks.length) return '';
  const deslopNote = options.includeDeslop === false ? '' : persona.overrideDeslop
    ? '\n【去AI化策略】仅遵循上方写作规则，不套用系统统一去AI化文风。'
    : `\n${deslop.systemDeslopPrompt}`;
  return `\n\n【用户选择的写作人格：${persona.name || '自定义模板'}】\n${blocks.join('\n\n')}${deslopNote}`;
}

function buildGenreStyleContract(novelTypeId, type) {
  const id = String(novelTypeId || '').toLowerCase();
  if (/mystery|detective|suspense|horror|thriller|悬疑|推理/.test(id)) return `【题材叙事契约：悬疑/惊悚】
以受限信息和可验证线索组织阅读体验：先给可观察事实，再给解释冲突，重要真相要通过行为、证据和视角偏差逐层释放。场景优先写声音、光线、物证、空间死角和人物反应；对白允许回避、试探和不完整回答。不要用全知旁白提前解释谜底，不要每段都用夸张形容词制造恐怖。`;
  if (/romance|love|言情|恋爱|校园/.test(id)) return `【题材叙事契约：言情/关系】
以关系变化而非事件清单组织章节：每次相处都要改变信任、边界、误解或选择。把情绪放进动作、距离、礼物、沉默和未说出口的判断里；对白保留双方目标差异，不用旁白反复宣布“心动/虐/甜”。日常段落可以完整展开，但必须留下关系或记忆的不可逆变化。`;
  if (/wuxia|martial|jianghu|武侠/.test(id)) return `【题材叙事契约：武侠/江湖】
以选择、恩义、规矩和代价塑造人物，不把江湖写成连续升级表。动作场面交代地形、兵器、节奏和判断，决斗结果必须由先前立场与代价积累而来。留出赶路、饮酒、疗伤、守约等低压段，让人物的江湖关系和失去的东西沉淀下来。`;
  if (/xianxia|fantasy|修仙|玄幻/.test(id)) return `【题材叙事契约：玄幻/修仙】
让力量体系服务于人物选择、世界规则和代价，不用境界名词替代戏剧。场景重点是感知变化、资源限制、仪式和人与天地/宗门的关系；突破必须改变责任或风险。阶段之间保留修行、行旅、同伴相处和规则观察，使世界有生活纹理而非只剩任务与战斗。`;
  if (/scifi|science|future|科幻|未来/.test(id)) return `【题材叙事契约：科幻/未来】
以技术后果、制度约束和陌生环境改变人物选择，不用术语堆砌未来感。优先写界面、设备、身体感受、空间尺度和信息不对称；解释世界观时让人物通过工作、故障、交易或日常使用发现规则。关键段落之间允许安静的观察和共同生活，让宏大设定落到人的损失与愿望。`;
  if (/historical|history|古代|历史|宫斗|权谋/.test(id)) return `【题材叙事契约：历史/权谋】
以身份、制度、利益和礼法塑造冲突，避免现代口吻直接替代时代人物。信息通过奏报、账册、宴席、军令、流言和沉默的站位流动；每次谋略都要有资源与政治代价。安排具有时代生活质感的间歇场景，让人物关系和权力变化在低声交谈、劳作或仪式中沉淀。`;
  if (/lightnovel|isekai|school|轻小说|异世界/.test(id)) return `【题材叙事契约：轻小说/ACGN】
以角色关系、具体处境和轻重反差形成节奏，不依赖统一吐槽、口头禅或模板化萌反应。冒险、校园、社团和共同生活都必须推进关系、信息或规则理解；重大情绪前允许轻松段落积累记忆，避免每章都用相同的笑点和收尾方式。`;
  return `【题材叙事契约】
请从当前题材、世界规则、人物关系和大纲中提炼本书独有的叙事节奏。不要套用统一的网文腔、固定转折句、固定情绪词或相同的章节收尾。先确定本书的叙事距离、信息释放速度、感官重点、对白密度和低压场景形态，并在全文保持这一组特征。`;
}

/** 规范化每章目标字数：允许福尔摩斯式大章（1万+字），默认维持旧口径 3000。 */
function normalizeChapterWordTarget(value) {
  if (value === undefined || value === null || value === '') return 3000;
  const target = Number(value);
  if (!Number.isFinite(target)) return 3000;
  return Math.max(2000, Math.min(20000, Math.round(target)));
}

function getOutlineRequirements(targetWordCount, chapterWordTarget) {
  const target = Math.max(10000, Math.min(10000000, Number(targetWordCount) || 50000));
  const scale = Math.min(1, Math.max(0, (target - 50000) / 950000));
  const phaseCount = target <= 50000 ? 4 : Math.max(5, Math.min(12, Math.ceil(4 + scale * 8)));
  const nodeCount = Math.max(12, Math.min(80, Math.round(14 + scale * 56)));
  const characterCount = Math.max(8, Math.min(40, Math.round(10 + scale * 30)));
  const subplotCount = Math.max(4, Math.min(24, Math.round(5 + scale * 19)));
  // 大纲上限收紧到 2 万字：长大纲的中段是"数字升级"式模板重复，而下游
  // （章节计划/蓝图/分层渲染）只需要结构化信息。outputTokens 与
  // outlineChars 耦合，输出预算自动从旧版 12 万 token 降到约 1.4 万。
  const outlineChars = Math.max(7000, Math.min(20000, Math.round(7000 + scale * 13000)));
  const outputTokens = Math.max(9000, Math.min(16000, Math.ceil(outlineChars / 1.45)));
  const chapterWords = normalizeChapterWordTarget(chapterWordTarget);
  const estChapters = Math.max(1, Math.ceil(target / chapterWords));
  return { target, phaseCount, nodeCount, characterCount, subplotCount, outlineChars, outputTokens, chapterWords, estChapters };
}

function buildOutlineSpec(targetWordCount, chapterWordTarget) {
  const requirements = getOutlineRequirements(targetWordCount, chapterWordTarget);
  const chapterPacing = requirements.chapterWords >= 6000
    ? `本书每章约${requirements.chapterWords}字，属于大章节奏：每个关键节点应承载完整的信息链（现场/线索→推理或冲突→新问题），不要把一个大章拆成多个重复场景，也不要压缩成流水账。`
    : `本书每章约${requirements.chapterWords}字，保持紧凑节奏：每个关键节点对应明确的场景推进，避免一章内塞入过多事件。`;
  return `【按目标字数动态规划的规模】
目标约${requirements.target}字，预计需要${requirements.estChapters}章（每章约${requirements.chapterWords}字）。不要套用固定模板，必须完成：${requirements.phaseCount}个剧情阶段、约${requirements.nodeCount}个关键节点、${requirements.characterCount}名有明确目标和关系变化的主要/次要人物、至少${requirements.subplotCount}条可交叉推进的支线。规模必须随目标字数增长：百万字目标必须使用更大的阶段/节点/角色数量，不能退化成四阶段小结构。
${chapterPacing}

【输出内容要求 — 信息密度优先，长度是结果不是目标】
1. 故事主线：写清起因、阶段性目标、因果链、主要反转、终局代价与结局落点，不能只写一句复仇/成长概括。
2. 核心冲突：拆出外部目标、内部选择、关系冲突、资源限制和不断升级的阻力。
3. 主要角色：至少${requirements.characterCount}人。每人写身份、表面目标、隐藏目标、与主角关系、阶段变化、关键选择、结局状态，以及一句"其他角色无法替代的功能"；删掉不影响主线走向的角色。
4. 剧情阶段：严格写${requirements.phaseCount}个阶段。每阶段列出阶段目标、阻力、人物关系变化、主线推进、支线交叉点、阶段反转和进入下一阶段的条件。
5. 支线与人物关系网：至少${requirements.subplotCount}条支线。每条写发起人物、独立目标、与主线的连接、至少两个转折、可能的误导、回收节点和最终状态。
6. 关键节点：至少${requirements.nodeCount}个，按预计章节范围排列（全书约${requirements.estChapters}章）。每个节点必须写清：触发条件→参与人物→具体事件→信息变化→后果与对下一节点的推动；禁止只列结果不写因果。
7. 伏笔与回收表：列出不少于${Math.max(8, Math.round(requirements.nodeCount * 0.45))}组伏笔，标明埋设阶段、表面解释、真实含义和回收阶段，禁止只写“后续揭晓”。
8. 结局方向：说明主线、主要支线、人物弧线和核心悬念如何分别收束；允许保留余波，但不能只写“主角成功”。

【反重复约束】
- 禁止用"更强的敌人/更大的危机/更高的境界"式数字升级凑节点；相邻阶段和节点必须改变人物关系或信息状态，而不只是提高强度。
- 阶段、节点、角色之间不得互为换皮复述；若删掉某个节点不影响因果链，就合并它。
- 宁可短而具体，不要长而重复：完成上述结构要求即可收束，不要为凑篇幅扩写。
直接输出大纲正文，不要解释生成过程。`;
}

function buildOutlinePrompt(novelTypeId, protagonistName, worldSetting, targetWordCount, persona, chapterWordTarget) {
  const type = novelTypes.find(t => t.id === novelTypeId);
  const requirements = getOutlineRequirements(targetWordCount, chapterWordTarget);
  return `你是一位专业的小说大纲策划师。请为一部${type ? type.name : ''}小说创作一份完整、可执行、可供分章规划使用的创作大纲。${buildPersonaPrompt(persona, { includeDeslop: false })}

${buildGenreStyleContract(novelTypeId, type)}

主角名字：${protagonistName || '未设定'}
世界观设定：${worldSetting || '由你自由发挥'}
目标总字数：约${requirements.target}字（预计${requirements.estChapters}章，每章约${requirements.chapterWords}字）

${buildOutlineSpec(targetWordCount, chapterWordTarget)}

请按以下格式输出大纲：

【故事主线】
（写清起因、阶段目标、主要反转与终局落点之间的因果链）

【核心冲突】
（描述主要冲突和矛盾）

【主要角色】
（列出主角和重要配角及其定位）

【剧情阶段】
（按上方动态规模划分阶段，逐阶段详细展开）

【支线与人物关系网】
（逐条展开支线目标、转折、与主线交叉和回收）

【伏笔与回收表】
（逐组列出埋设与回收位置）

【结局方向】
（概述故事的结局走向）

【关键节点】
（按章节范围列出动态数量的重要节点）

请直接输出大纲内容，不要加额外的解释。`;
}

/** Build a bounded chapter context for continuation prompts. */
function buildChapterContext(chapters) {
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

function buildInitialPrompt(novelTypeId, protagonistName, worldSetting, targetWordCount, mode, outline, persona) {
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

  return `请创作一部${type ? type.name : ''}小说。${buildPersonaPrompt(persona)}

主角名字：${protagonistName || '未设定'}
世界观设定：${worldSetting || '由你自由发挥'}
目标字数：约${targetWordCount}字${outlineText}

${continuityNote}

请从第一章开始，保持风格统一，全局规划好剧情走向。每章结束时标注【未完待续】。`;
}

function buildContinuePrompt(novelId, novel, persona = novel?.writingPersonaSnapshot) {
  const chapterContext = buildChapterContext(novel.chapters);
  const outlineNote = novel.outline ? `\n【创作大纲】\n${novel.outline}\n` : '';

  return `请继续创作这部小说。${buildPersonaPrompt(persona)}

小说类型：${novel.novelTypeName}
主角：${novel.protagonistName || '未设定'}
${outlineNote}

以下是从已有章节中提取的完整剧情脉络（包含所有伏笔和人物线）：

${'='.repeat(40)}
${chapterContext}
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
 * 构建导入小说续写提示词
 */
function buildImportContinuePrompt(importedText, continuationRequest, novelTypeName, targetWordCount, mode, persona) {
  // 对导入文本进行分段提纯
  const paragraphs = (importedText || '').split(/\n{2,}/);
  const chapterContext = paragraphs.slice(0, 30).map((p, i) => `[段落${i + 1}] ${p.slice(0, 500)}`).join('\n');

  const isChapter = mode === 'chapter';
  const targetHint = isChapter
    ? `本次只续写一个章节（目标约${targetWordCount}字），请写出一个完整的章节`
    : `目标总字数约${targetWordCount}字，分多个章节续写，注意全局连贯性和伏笔回收`;

  return `你是一位专业的小说续写专家。${buildPersonaPrompt(persona)}请仔细阅读下方导入小说的完整剧情脉络，理解其风格、剧情走向、人物设定及所有伏笔，然后根据要求续写。

小说风格类型：${novelTypeName || '未知'}

用户导入的小说完整内容摘要（含全部情节脉络）：
${'='.repeat(40)}
${chapterContext.slice(0, 10000)}
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
  const roleRouteId = userModelConfig?.roleRoutes?.[modelType] || userModelConfig?.routeId;
  const managedRoute = getServerRoute(roleRouteId);
  const defaults = {
    baseUrl: managedRoute.baseUrl,
    apiKey: managedRoute.apiKey,
    model: managedRoute.model,
    routeId: managedRoute.id,
    // GLM-4.7/同类思考模型在正文、普通大纲和润色任务中开启深度思考
    // 会明显拉长首字等待；推理线路仍保留思考能力。
    disableThinking: modelType !== 'reasoning',
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
      apiKey: '', model, disableThinking: modelType !== 'reasoning',
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
      model, disableThinking: modelType !== 'reasoning',
    };
  }

  return defaults;
}

/**
 * 流式生成
 * @param {Function} [onReasoning] 思考型模型（如 GLM-4.7/DeepSeek-R1）思考过程的增量回调，用于向前端展示思考进度
 * @returns {Promise<{content:string, tokenCount:number}>}
 */
const MAX_GENERATION_TOKENS = 700000;

// Different OpenAI-compatible providers expose different output ceilings. The
// admin budget is an application-level target, but it must never make a
// request fail just because a provider advertises a smaller hard limit. This
// extracts a limit from common max_tokens validation messages so the request
// can be retried safely with the provider's actual ceiling.
function extractProviderMaxTokens(errorText) {
  const text = String(errorText || '');
  if (!/max[\s_-]*tokens/i.test(text)) return null;
  const match = text.match(/max[\s_-]*tokens[\s\S]{0,160}?[\[\(（【]\s*1\s*[,，]\s*(\d{3,})/i);
  const limit = match ? Number(match[1]) : 0;
  return Number.isFinite(limit) && limit >= 256 ? Math.floor(limit) : null;
}

async function streamGenerate(systemPrompt, userPrompt, onChunk, signal, apiConfig, retries = 2, temperature = 0.85, maxTokens = 16384, timeoutMs = 90000, onReasoning) {
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

  // 支持按任务传入温度和输出上限。700k 是服务允许的最高返回预算，
  // 各业务线路仍可传入更小的任务预算，避免无意义地放大响应时间。
  let outputLimit = Math.max(256, Math.min(MAX_GENERATION_TOKENS, Number(maxTokens) || 16384));
  // GLM-4.7 等思考模型默认开启 thinking，正文前会长时间输出 reasoning_content。
  // 设置 AI_THINKING_DISABLED=true 可强制关闭思考，换取更快的首字响应。
  const disableThinking = config.disableThinking === true
    || String(process.env.AI_THINKING_DISABLED || '').toLowerCase() === 'true';
  // 思考参数可能与模型能力不符：如 glm-5.3-flash 会拒绝禁用思考
  // （"当前模型必须开启深度思考"），而部分线路不认识 thinking 字段。
  // 这类确定性 400 带着同样参数重试只会原样失败，下方在识别后修正并
  // 免费重试一次（每个方向只修正一次）。
  let thinkingMode = disableThinking ? 'disabled' : null;
  let thinkingTweaked = false;
  // 思考模型（如 glm-5.3-flash）的 reasoning 与正文共享 max_tokens 预算，
  // 复杂任务的思考可能耗尽预算导致正文为空。对确认要求思考的线路附加
  // reasoning_effort 限制思考篇幅；不认识该字段的线路会在 400 后自动去除。
  let reasoningEffort = null;
  let effortTweaked = false;
  // 输入 token 估算（无服务商用量时回退使用）。system+user 在重试间不变，
  // 只需计算一次。
  const estimatedInputTokens = countTokens(systemPrompt) + countTokens(userPrompt);
  const buildRequestBody = () => isOllama
    ? { model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], stream: true, options: { temperature, num_predict: outputLimit } }
    : { model: config.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], stream: true, temperature, max_tokens: outputLimit,
      ...(thinkingMode ? { thinking: { type: thinkingMode } } : {}),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) };

  for (let attempt = 0; attempt <= retries; attempt++) {
    // An external abort is a caller decision (for example, the chapter-plan
    // deadline). It must end the operation immediately instead of turning
    // into another full-length retry.
    if (signal?.aborted) {
      const error = new Error('AI API 请求已取消');
      error.name = 'AbortError';
      throw error;
    }
    let timeoutId;
    let currentSignal;
    try {
      const timeoutController = new AbortController();
      // 超时按"每次尝试"计算，不是全请求共享：思考型线路一次空输出尝试
      // 可能消耗数百秒，若共享剩余时间，最后一次尝试会立刻超时。
      timeoutId = setTimeout(() => timeoutController.abort(), Math.max(5000, Number(timeoutMs) || 90000));

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

      const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(buildRequestBody()), signal: currentSignal });

      if (!response.ok) {
        const errorText = await response.text();
        clearTimeout(timeoutId);
        // 思考参数与模型能力不符：识别"必须开启深度思考"（当前携带 disabled）
        // 与"不支持/无效 thinking 参数"，修正后免费重试一次。
        if (!thinkingTweaked && /深度思考|thinking/i.test(errorText)) {
          if (/必须开启|enable|required/i.test(errorText) && thinkingMode === 'disabled') {
            thinkingMode = 'enabled';
            thinkingTweaked = true;
            // 该线路强制思考，主动附上 reasoning_effort 限制思考篇幅。
            reasoningEffort = reasoningEffort || 'medium';
            // 强制思考模型的 reasoning 与正文共享 max_tokens：只按正文
            // 估算的预算必然被思考挤空（实测 glm-5.3-flash 大纲任务思考
            // 可达正文的 3 倍以上），放大预算给思考留出空间。
            const previousLimit = outputLimit;
            outputLimit = Math.min(65536, Math.ceil(outputLimit * 4));
            console.warn(`AI API 要求开启深度思考，已改为 thinking:enabled，输出预算 ${previousLimit}→${outputLimit} 后重试`);
            attempt -= 1;
            continue;
          }
          if (thinkingMode) {
            thinkingMode = null;
            thinkingTweaked = true;
            console.warn('AI API 拒绝 thinking 参数，已去除该字段后重试');
            attempt -= 1;
            continue;
          }
        }
        // 部分线路不认识 reasoning_effort 字段，去除后免费重试。
        if (!effortTweaked && reasoningEffort && /reasoning_effort/i.test(errorText)) {
          reasoningEffort = null;
          effortTweaked = true;
          console.warn('AI API 拒绝 reasoning_effort 参数，已去除该字段后重试');
          attempt -= 1;
          continue;
        }
        const providerMaxTokens = extractProviderMaxTokens(errorText);
        if (providerMaxTokens && outputLimit > providerMaxTokens) {
          outputLimit = Math.min(outputLimit, providerMaxTokens);
          console.warn(`AI API max_tokens 超出线路上限，自动调整为 ${outputLimit} 后重试`);
          // Do not consume a retry slot for this deterministic request fix.
          attempt -= 1;
          continue;
        }
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
      // 服务商在流末尾返回的实际用量（若支持）。DeepSeek 附带
      // prompt_cache_hit_tokens，OpenAI 兼容线路在 prompt_tokens_details.cached_tokens
      // 中给出前缀缓存命中量。不做请求体改动，被动捕获即可，兼容所有线路。
      let providerUsage = null;
      // finish_reason 与 reasoning 累计用于空输出诊断：思考模型（如
      // glm-5.3-flash）的 reasoning 与正文共享 max_tokens，若 reasoning
      // 吃满预算（finish=length 且无正文），同预算重试必然再失败。
      let finishReason = null;
      let reasoningChars = 0;

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
              if (parsed.done && (parsed.prompt_eval_count || parsed.eval_count)) {
                providerUsage = { prompt_tokens: parsed.prompt_eval_count, completion_tokens: parsed.eval_count };
              }
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
                // 思考阶段只有 reasoning_content，不转发会导致前端长时间停在 0 字
                const reasoning = parsed.choices?.[0]?.delta?.reasoning_content || '';
                if (reasoning) { reasoningChars += reasoning.length; if (onReasoning) onReasoning(reasoning); }
                const reason = parsed.choices?.[0]?.finish_reason;
                if (reason) finishReason = reason;
                if (parsed.usage && typeof parsed.usage === 'object') providerUsage = parsed.usage;
              } catch (e) { /* skip */ }
            }
          }
        }
      } // while

      // 超时需覆盖整个流式读取过程：头部到达即停表会让慢速流（思考模型
      // 长推理）在无超时保护下无限挂起。到这里流已结束，停表。
      clearTimeout(timeoutId);

      // v4: 空输出检测 — 模型返回 200 但内容为空，视为失败并重试。
      // 思考模型 reasoning 吃满预算（finish=length 且 reasoning 很长）时，
      // 同预算重试必然原样失败：先放大预算再重试，同时收紧 reasoning_effort。
      if (!fullContent.trim() && attempt < retries) {
        const delay = Math.pow(2, attempt) * 1500;
        if (finishReason === 'length' && reasoningChars > 0) {
          const previousLimit = outputLimit;
          outputLimit = Math.min(MAX_GENERATION_TOKENS, Math.ceil(outputLimit * 2.5));
          if (!effortTweaked && reasoningEffort !== 'low') {
            reasoningEffort = 'low';
          }
          console.warn(`AI 思考耗尽输出预算（reasoning ${reasoningChars} 字，finish=length），预算 ${previousLimit}→${outputLimit} 并收紧 reasoning_effort 后重试`);
        }
        console.warn(`AI API 返回空内容，第 ${attempt + 1} 次重试，等待 ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      return {
        content: fullContent,
        tokenCount: countTokens(fullContent),
        inputTokens: estimatedInputTokens,
        usage: providerUsage,
      };

    } catch (e) {
      clearTimeout(timeoutId);
      if (signal?.aborted) {
        throw (e.name === 'AbortError')
          ? new Error('AI API 请求已取消')
          : e;
      }
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`AI API 请求异常（${e.message}），第 ${attempt + 1} 次重试，等待 ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      // 所有重试耗尽，向外抛
      throw (e.name === 'AbortError') ? new Error(`AI API 请求超时（${Math.round((Number(timeoutMs) || 90000) / 1000)}s）`) : e;
    }
  } // for
  // 所有尝试均失败（理论上不会到达，但保留以防万一）
  throw new Error('AI API 请求失败，所有重试均已耗尽');
}

/**
 * 构建章节计划表（细化到每一章的事件、伏笔、字数）
 */
function getChapterPlanOutputTokens(targetWordCount, chapterWordTarget) {
  const chapterWords = normalizeChapterWordTarget(chapterWordTarget);
  const chapters = Math.max(10, Math.ceil((Number(targetWordCount) || 50000) / chapterWords));
  return Math.max(16384, Math.min(120000, Math.ceil(chapters * 135)));
}

function buildChapterPlan(outline, targetWordCount, protagonistName, worldSetting, persona, storyBlueprint, chapterWordTarget) {
  // 兼容两种历史调用形态：旧形态第 5 位是一个已废弃的上下文参数
  // (outline, target, proto, world, unusedContext, persona, blueprint)，
  // 新形态是 (outline, target, proto, world, persona, blueprint, chapterWordTarget)。
  // 第 7 位是数字即新形态，否则按旧形态重排。
  if (arguments.length >= 7 && typeof arguments[6] !== 'number') {
    storyBlueprint = arguments[6];
    persona = arguments[5];
    chapterWordTarget = undefined;
  }
  const chapterWords = normalizeChapterWordTarget(chapterWordTarget);
  const estChapters = Math.max(10, Math.ceil(targetWordCount / chapterWords));
  const plannedBreaths = Math.max(1, Math.round(estChapters * 0.09));
  // 章节字数带宽：3000 字时为 2000-4200（与旧口径一致），大章按比例放宽。
  const wordBandLow = Math.max(1200, Math.floor(chapterWords * 0.67));
  const wordBandHigh = Math.ceil(chapterWords * 1.4);
  const chapterPacing = chapterWords >= 6000
    ? `\n8. 每章约${chapterWords}字属于大章：必须承载完整的信息链或冲突推进（场景→交锋/推理→新局面），禁止把一章拆成多个场景重复或压缩成事件清单。`
    : '';
  const blueprint = storyBlueprint && typeof storyBlueprint === 'object' ? storyBlueprint : {};
  const blueprintPhases = Array.isArray(blueprint.phases) ? blueprint.phases.slice(0, 12).map((phase) => ({
    title: phase.title || '', startChapter: phase.startChapter || 1, endChapter: phase.endChapter || estChapters,
    goal: phase.goal || '', obstacle: phase.obstacle || '', reversal: phase.reversal || '', threads: phase.threads || [],
  })) : [];
  const blueprintBrief = blueprintPhases.length
    ? `

【用户已确认的故事蓝图（必须落实到章节计划）】
主线：${String(blueprint.mainArc || '').slice(0, 1600)}
不可改写事实：${Array.isArray(blueprint.lockedFacts) ? blueprint.lockedFacts.join('；') : '无'}
阶段与支线：${JSON.stringify(blueprintPhases)}
章节计划必须把蓝图阶段边界、每条支线的进入/交叉/转折/回收位置写进对应章节，不能只在总述里提及。`
    : `

【故事蓝图】当前没有用户确认的细化蓝图。请根据大纲和人物关系自行形成阶段、支线和伏笔安排，但不要凭空改变大纲已确定的事实。`;

  let planPrompt = `你是一位专业的小说章节规划师。请根据以下素材制定一份详细的章节计划表。${buildPersonaPrompt(persona, { includeDeslop: false })}

目标：约${targetWordCount}字，预计${estChapters}章（每章约${chapterWords}字）

素材：
主角：${protagonistName || '未设定'}
世界观：${worldSetting || '自由发挥'}
大纲：
${outline || '无大纲，请自行规划故事'}`;

  planPrompt += blueprintBrief;

  planPrompt += `\n\n为避免长篇计划在输出时被截断，必须使用下面的紧凑 JSON 格式。不要 Markdown、不要解释、不要代码块：
{"version":1,"phases":["阶段名：目标"],"chapters":[[章节号,目标字数,"核心事件","埋伏笔（无则空字符串）","回收伏笔（无则空字符串）","关键角色（无则空字符串）","章节角色",张力,"章节短标题","所属阶段","本章支线焦点（无则空字符串）","关系变化","缓冲功能（无则空字符串）"]]}

示例：
{"version":1,"phases":["开端：建立危机"],"chapters":[[1,3000,"收到匿名来信","旧钥匙","","林舟、苏晚","主线推进",5,"雨夜来信","开端","苏晚的隐瞒","两人从合作转为互相试探",""],[2,3000,"追查来信来源","","旧钥匙","林舟","信息揭示",6,"无名邮戳","开端","旧钥匙来源线","林舟开始怀疑苏晚",""],[3,2600,"在旧屋做饭并发现照片角落的标记","照片标记","","林舟、苏晚","喘息推进",4,"炉火余温","开端","关系线","短暂恢复日常信任并留下照片线索","让前几章的压力沉淀为关系和记忆变化"]]}

关键规则：
1. 必须完整输出第 1 至第 ${estChapters} 章，不能省略、不能用“其余同理”。每个核心事件限 18-42 个汉字，其他字符串尽量短。
2. 每章只能有一个核心事件；相邻章节不得重复。章节角色只可使用：主线推进、关系推进、信息揭示、喘息推进、收束。
3. 伏笔设置后，必须在后续章的回收字段写出同一名称；最后一章必须是“收束”。没有伏笔或角色请使用空字符串。
4. 张力是 1-10；连续 3 章不得都高于 7；全书约安排 ${plannedBreaths} 个喘息推进章，但位置和形式必须由当前人物压力、关系状态、题材和前后事件决定，禁止固定每隔 N 章安排，也禁止所有作品使用同一种日常模板。
5. 喘息推进章不是无意义凑字数：必须让关系、信息、记忆、物件、支线或伏笔发生可见变化；可以是生活、旅途、工作、仪式、梦境、共同空间或题材特有的低压场景，但只能选择适合本书世界和人物的形式。
6. 每条蓝图支线至少要有进入章节、一次中段变化和回收/转化章节；阶段反转必须落到具体章节，不能只写在 phases 总述。
7. 每章目标字数 ${wordBandLow}-${wordBandHigh}，总章数约 ${estChapters} 章。最后一个字段必须给出 4-12 个汉字的章节短标题，具体、有画面感、不得重复，不要包含“第X章”。${chapterPacing}`;

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
function buildOptimizeAnalysisPrompt(chapters, outline, protagonistName, worldSetting, persona, novelTypeId) {
  const fullText = chapters.map(ch =>
    `【第${ch.chapterNumber}章（${ch.wordCount}字）】\n${(ch.content || '').slice(0, 3000)}`
  ).join('\n\n').slice(0, 40000);

  return `你是一位专业的小说编辑。${buildPersonaPrompt(persona, { includeDeslop: false })}

${buildGenreStyleContract(novelTypeId, novelTypes.find(t => t.id === novelTypeId || t.name === novelTypeId))}

请分析以下小说的全文，输出一份详细的调优分析报告。

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
function buildOptimizeChapterPrompt(chapter, chapterNumber, analysis, outline, persona, novelTypeId) {
  return `你是一位专业的小说编辑。${buildPersonaPrompt(persona)}

${buildGenreStyleContract(novelTypeId, novelTypes.find(t => t.id === novelTypeId || t.name === novelTypeId))}

请根据以下小说全文分析报告，对第${chapterNumber}章进行优化重写。

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
  buildSystemPrompt, buildPersonaPrompt, buildInitialPrompt, buildContinuePrompt,
  buildImportContinuePrompt, buildOutlinePrompt,
  getOutlineRequirements, buildOutlineSpec, getChapterPlanOutputTokens, buildGenreStyleContract,
  normalizeChapterWordTarget,
  buildChapterPlan, buildStoryStateSummary,
  buildOptimizeAnalysisPrompt, buildOptimizeChapterPrompt, extractChapterSummary,
  streamGenerate, resolveApiConfig, countTokens,
  MAX_GENERATION_TOKENS,
  extractProviderMaxTokens,
  humanizeRewrite,
  getFriendlyErrorMessage,  // 友好错误提示
};
