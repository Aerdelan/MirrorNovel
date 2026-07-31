/**
 * Novel Editorial Engine — 七阶段编辑引擎
 *
 * 流水线：
 *   原稿 → ① AI特征分析 → ② 删除AI痕迹 → ③ 节奏重构 → ④ 人物重塑
 *        → ⑤ 风格润色 → ⑥ 字数压缩 → ⑦ 全文一致性检查 → 最终稿
 *
 * 每一步调用一次 LLM，效果远高于单个超级 Prompt。
 * 所有 Prompt 由 editorialRules DSL 自动生成，可配置可迭代。
 */

const { streamGenerate, resolveApiConfig } = require('./aiService');
const dsl = require('../config/editorialRules');

// 阶段定义
const STAGES = [
  { id: 'analysis',     name: 'AI特征分析',     enabled: dsl.stages.analysis },
  { id: 'deAI',         name: '删除AI痕迹',     enabled: dsl.stages.deAI },
  { id: 'rhythm',       name: '节奏重构',       enabled: dsl.stages.rhythm },
  { id: 'character',    name: '人物重塑',       enabled: dsl.stages.character },
  { id: 'style',        name: '风格润色',       enabled: dsl.stages.style },
  { id: 'compression',  name: '字数压缩',       enabled: dsl.stages.compression },
  { id: 'consistency',  name: '全文一致性检查',  enabled: dsl.stages.consistency },
];

// ====== 各阶段 Prompt 生成器（由 DSL 驱动） ======

/**
 * 第1阶段：AI特征分析
 * 不修改文本，输出 JSON 评分，指导后续阶段
 */
function buildAnalysisPrompt(text) {
  const dims = dsl.analysisDimensions.map((d, i) =>
    `${i + 1}、${d.name}（${d.desc}）`
  ).join('\n');

  const jsonKeys = dsl.analysisDimensions.map(d => `"${d.id}"`).join(',\n  ');

  return {
    system: `你是一名拥有十五年以上经验的网络文学总编，同时也是AI文本分析专家。

你的任务不是修改，而是分析。

请分析下面小说存在的人工智能写作痕迹。

从下面几个维度评分（0-100，分数越高表示AI痕迹越严重）：

${dims}

最后只输出JSON，不要输出其他任何内容。格式如下：

{
  "${dsl.analysisDimensions[0].id}": 0,
  ${dsl.analysisDimensions.slice(1).map(d => `"${d.id}": 0`).join(',\n  ')}
}`,
    user: `请分析以下小说文本的AI写作痕迹：\n\n${text}`,
  };
}

/**
 * 第2阶段：删除AI痕迹（核心阶段）
 * 根据分析结果，使用编辑规则去除AI痕迹
 */
function buildDeAIPrompt(text, analysis) {
  const analysisText = analysis
    ? `\n\n【AI特征分析结果】\n${Object.entries(analysis).map(([k, v]) => `${k}: ${v}/100`).join('\n')}\n请重点处理得分较高的维度。`
    : '';

  const rules = dsl.editorialRules.map((r, i) =>
    `规则${i + 1}：\n${r}`
  ).join('\n\n————————\n\n');

  const forbidden = dsl.forbidden.join('、');

  return {
    system: `你不是AI改写器。

你是一名番茄小说签约编辑。

你的工作不是重写，而是润稿。

绝对禁止：
①改变剧情
②增加剧情
③删除伏笔
④修改人物关系
⑤修改世界观
⑥修改故事顺序

可以做：
①删除AI写作痕迹
②增加人物特色
③优化阅读节奏
④减少解释
⑤增强画面感
⑥增加真实细节
⑦增强人物心理
⑧增强对白

目标：让读者认为这是职业作者写出来的，而不是AI。`,
    user: `【编辑规则】

${rules}

【禁用词汇/句式】
${forbidden}

出现以上词汇必须替换或删除。${analysisText}

请对以下文本进行去AI痕迹处理。保留剧情、伏笔、人物关系和世界观不变，只改表达方式。直接输出处理后的完整文本，不要加任何解释。

以下是需要处理的文本：

${text}`,
  };
}

/**
 * 第3阶段：节奏重构
 * 打破AI均匀段落特征，实现长短交替
 */
function buildRhythmPrompt(text) {
  const r = dsl.rhythmRules;
  const ratioStr = `短段落（1-2句）占${Math.round(r.shortParagraphRatio.min * 100)}-${Math.round(r.shortParagraphRatio.max * 100)}%\n中段落（3-5句）占${Math.round(r.mediumParagraphRatio.min * 100)}-${Math.round(r.mediumParagraphRatio.max * 100)}%\n长段落（6句以上）占${Math.round(r.longParagraphRatio.min * 100)}-${Math.round(r.longParagraphRatio.max * 100)}%`;

  return {
    system: `你是一名资深网文编辑，擅长优化叙事节奏。你的任务是重构段落的节奏感，打破AI生成的均匀段落特征。`,
    user: `请对以下文本进行节奏重构。

【节奏规则】
${ratioStr}
${r.ultraShortSentenceRate}
${r.forbidConsecutiveSameLength ? '绝对不能出现连续3段长度相近的段落。' : ''}
${r.hardCutTransitions ? '段落之间可以硬切，不需要过渡词。' : '段落之间需要自然过渡。'}

【具体操作】
1. 把过长的段落拆成短段，把过短的段落合并或保留
2. 在适当位置插入极短句（3-8字）打断节奏
3. 拟声词、动作、内心独白可以独立成段
4. 长段落后面必须跟极短段落作为"呼吸"
5. 句式必须混合：完整句、省略句、感叹句、无主语句交替

【禁止】
- 不要改变剧情和人物
- 不要增加或删除场景
- 只调整段落结构和句式节奏

直接输出节奏重构后的完整文本。

以下是需要重构的文本：

${text}`,
  };
}

/**
 * 第4阶段：人物重塑
 * 为每个角色注入独特的语言风格和行为习惯
 */
function buildCharacterPrompt(text) {
  const voices = Object.entries(dsl.characterVoices).map(([key, v]) =>
    `${v.name}（${key}）：\n  特征：${v.traits}\n  说话速度：${v.speechSpeed}\n  文化水平：${v.educationLevel}\n  习惯：${v.patterns.join('；')}`
  ).join('\n\n');

  const idleDetails = dsl.humanizationMaterials.idleDetails.join('；');
  const interruptions = dsl.humanizationMaterials.interruptions.join('；');
  const fragments = dsl.humanizationMaterials.fragments.join('；');

  return {
    system: `你是一名角色塑造专家。你的任务是让每个角色拥有独特的语言风格和行为习惯，不能所有人都像AI。`,
    user: `请对以下文本进行人物重塑。

【角色声音原型参考】
${voices}

根据文本中出现的角色，为每个角色分配或强化独特的语言风格。每个角色必须拥有：
- 自己的口头禅
- 自己的动作习惯
- 自己的思维方式
- 自己的说话速度
- 自己的文化水平
- 自己的身份特征

【人味注入素材】
无功能细节示例：${idleDetails}
口误/思考中断示例：${interruptions}
碎片化短句示例：${fragments}

【具体操作】
1. 分析文本中的角色，为每个角色确定语言风格
2. 修改对白，让不同角色说话方式明显不同
3. 在叙述中加入角色的个人化观察和吐槽
4. 加入微动作（握拳、咬牙、停顿等）替代抽象情绪
5. 偶尔加入无功能细节增加真实感
6. 允许角色口误、思考中断、说废话

【禁止】
- 不要改变剧情和人物关系
- 不要增加新角色
- 不要改变故事走向

直接输出人物重塑后的完整文本。

以下是需要重塑的文本：

${text}`,
  };
}

/**
 * 第5阶段：风格润色
 * 统一文风，增强可读性
 */
function buildStylePrompt(text) {
  const s = dsl.style;
  const h = dsl.humanization;

  const humanizationRules = [
    h.sentenceMix && '长短句交替',
    h.reduceTransitionWords && '减少AI连接词',
    h.showNotTell && '展示而非讲述',
    h.addCharacterVoice && '保持角色个人语言',
    h.addMicroActions && '添加微动作',
    h.addIdleDetails && '添加无功能细节',
    h.randomizeParagraphLength && '随机化段落长度',
    h.addImperfections && '添加不完美性',
    h.addStuttering && '添加口误和思考中断',
    h.addSarcasm && '添加吐槽',
  ].filter(Boolean).join('、');

  const colloquialTransitions = dsl.humanizationMaterials.colloquialTransitions.join('、');

  return {
    system: `你是一名小说风格润色师，负责对文本进行最终的风格统一和润色。`,
    user: `请对以下文本进行风格润色。

【风格设定】
体裁：${s.genre}
节奏：${s.pacing}
叙事视角：${s.narration}
对话占比目标：${Math.round(s.dialogueRatio * 100)}%

【人味化要求】
${humanizationRules}

【口语化过渡词】
${colloquialTransitions}

【润色原则】
1. 统一全文文风，确保前后一致
2. 检查并修复残留的AI痕迹
3. 增强画面感和可读性
4. 确保对话自然生动
5. 段尾不要升华、总结、感悟——戛然而止最好
6. 用大白话描写，不用修辞堆砌

【禁止】
- 不要改变剧情
- 不要增加或删除场景
- 不要改变字数（保持当前长度）

直接输出润色后的完整文本。

以下是需要润色的文本：

${text}`,
  };
}

/**
 * 第6阶段：字数压缩
 * 压缩至原文的70%，删除冗余
 */
function buildCompressionPrompt(text, originalLength) {
  const c = dsl.compression;
  const targetLength = Math.round(originalLength * c.ratio);

  return {
    system: `你是一名专业的小说压缩编辑。你的目标是在保持故事完整性的前提下，将文本压缩至原文的${Math.round(c.ratio * 100)}%。`,
    user: `请将以下文本压缩至约${targetLength}字（原文约${originalLength}字）。

【必须保留】
${c.keep.map(k => `- ${k}`).join('\n')}

【可以删除】
${c.remove.map(r => `- ${r}`).join('\n')}

【压缩原则】
1. 删除重复描写
2. 删除重复心理
3. 删除重复环境
4. 删除重复动作
5. 删除作者解释
6. 合并相似段落
7. 压缩不是缩写——用更精炼的方式表达同样的内容

【禁止删除】
- 剧情
- 人物
- 设定
- 伏笔
- 冲突
- 战斗高潮
- 结尾

直接输出压缩后的完整文本。

以下是需要压缩的文本：

${text}`,
  };
}

/**
 * 第7阶段：全文一致性检查
 * 最后检查，修复一致性问题
 */
function buildConsistencyPrompt(text) {
  const rules = dsl.consistencyRules.map((r, i) => `${i + 1}. ${r}`).join('\n');

  return {
    system: `你是一名全文一致性检查编辑。你的任务是检查并修复文本中的不一致之处，确保最终稿件质量。`,
    user: `请检查并修复以下文本的一致性问题。

【检查清单】
${rules}

【修复原则】
1. 只修复不一致之处，不要大幅改写
2. 如果发现人物性格前后不一致，以后面出现的为准
3. 如果发现世界观矛盾，保留更合理的设定
4. 如果发现伏笔被意外删除，从上下文推断并恢复
5. 确保人物称呼、场景描写前后一致

【禁止】
- 不要改变核心剧情
- 不要增加新内容
- 只修复不一致，不要"优化"

直接输出检查修复后的完整文本。

以下是需要检查的文本：

${text}`,
  };
}

// ====== Prompt 生成器映射表 ======
const PROMPT_BUILDERS = {
  analysis:    buildAnalysisPrompt,
  deAI:        buildDeAIPrompt,
  rhythm:      buildRhythmPrompt,
  character:   buildCharacterPrompt,
  style:       buildStylePrompt,
  compression: (text, _analysis, originalLen) => buildCompressionPrompt(text, originalLen),
  consistency: buildConsistencyPrompt,
};

// ====== 核心流水线 ======

/**
 * 运行七阶段编辑引擎
 *
 * @param {string} text - 原始文本
 * @param {Object} options - 选项 { apiConfig, onChunk, onStatus, customDsl }
 * @param {Object} apiConfig - API 配置
 * @param {Function} [onChunk] - 流式回调 (chunk, stageId) => void
 * @param {Function} [onStatus] - 状态回调 (stageId, stageName, message) => void
 * @returns {Promise<{content: string, analysis: Object, stageResults: Array}>}
 */
async function runEditorialPipeline(text, options = {}) {
  const {
    apiConfig = resolveApiConfig(null, 'writing'),
    onChunk = null,
    onStatus = null,
    customDsl = null,
  } = options;

  // 如果有自定义 DSL，合并
  const effectiveDsl = customDsl ? { ...dsl, ...customDsl } : dsl;

  if (!text || text.length < 100) {
    return { content: text, analysis: null, stageResults: [] };
  }

  const originalLength = text.length;
  let currentText = text;
  let analysisResult = null;
  const stageResults = [];
  const delay = dsl.interStageDelay || 5000;  // 阶段间延迟 5 秒，避免 429

  for (let i = 0; i < STAGES.length; i++) {
    const stage = STAGES[i];

    // 检查阶段是否启用
    if (!stage.enabled) {
      stageResults.push({ stage: stage.id, name: stage.name, skipped: true });
      continue;
    }

    // 报告阶段开始
    if (onStatus) {
      onStatus(stage.id, stage.name, `正在执行第${i + 1}阶段：${stage.name}...`, false, 'running');
    }

    // 阶段间延迟（跳过第一阶段）
    if (i > 0 && delay > 0) {
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const builder = PROMPT_BUILDERS[stage.id];
      const { system, user } = builder(currentText, analysisResult, originalLength);

      const result = await streamGenerate(
        system,
        user,
        onChunk ? (chunk) => { onChunk(chunk, stage.id); } : null,
        null,
        apiConfig,
        3,           // 3 次重试（应对 429 限流）
        0.85 + Math.random() * 0.15  // 随机温度
      );

      const stageOutput = result?.content || '';

      // 第1阶段：解析 JSON 分析结果
      if (stage.id === 'analysis') {
        try {
          // 尝试提取 JSON
          const jsonMatch = stageOutput.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            analysisResult = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          console.warn(`[编辑引擎] 第1阶段JSON解析失败:`, e.message);
          analysisResult = null;
        }
        // 第1阶段不修改文本，继续使用原文本
        stageResults.push({
          stage: stage.id, name: stage.name,
          input: originalLength, output: originalLength,
          analysis: analysisResult, success: true,
        });
      } else {
        // 后续阶段：检查输出长度
        if (stageOutput.length > currentText.length * 0.15) {
          currentText = stageOutput;
        } else {
          console.warn(`[编辑引擎] 第${i + 1}阶段输出过短(${stageOutput.length}字)，使用上一阶段结果`);
        }
        stageResults.push({
          stage: stage.id, name: stage.name,
          input: stageResults.length > 0 ? (stageResults[stageResults.length - 1].output || originalLength) : originalLength,
          output: currentText.length,
          success: stageOutput.length > currentText.length * 0.15,
        });
      }

      if (onStatus) {
        onStatus(stage.id, stage.name, `第${i + 1}阶段完成：${stage.name}（${currentText.length}字）`, false);
      }
    } catch (e) {
      console.error(`[编辑引擎] 第${i + 1}阶段失败 (${stage.name}):`, e.message);
      stageResults.push({
        stage: stage.id, name: stage.name,
        error: e.message, success: false,
      });
      if (onStatus) {
        onStatus(stage.id, stage.name, `第${i + 1}阶段失败：${e.message}`, true);
      }
      // 失败不中断，使用上一阶段结果继续
    }
  }

  return {
    content: currentText,
    analysis: analysisResult,
    stageResults,
    originalLength,
    finalLength: currentText.length,
  };
}

module.exports = {
  runEditorialPipeline,
  STAGES,
  PROMPT_BUILDERS,
};
