/**
 * Novel Editorial Engine v4 — 精简编辑引擎
 *
 * v4 核心重构：
 *   - 7 次 LLM 调用 → 3 次（Token 消耗降低约 60%）
 *   - 去AI化放最后一步（前面润色/压缩不会重新引入 AI 特征）
 *   - 合并阶段：结构重构(压缩+节奏+人物+分析) → 风格一致性(润色+一致性) → 去AI化(最终)
 *
 * 流水线：
 *   原稿 → ⓪ 作者人格（本地）→ ① 结构重构 → ② 风格一致性 → ③ 去AI化(最终) → 最终稿
 *
 * [蓝图] 未来版本将引入规则 DSL + 小说 AST + 统计学习层，
 *        详见 server/config/ruleEngineBlueprint.js
 */

const { streamGenerate, resolveApiConfig } = require('./aiService');
const dsl = require('../config/editorialRules');
const { hasAcceptableRewriteLength, buildRewriteReviewPrompt } = require('./rewriteReview');

// 阶段定义（v4：仅 3 次 LLM 调用 + 1 次本地生成）
const STAGES = [
  { id: 'persona',     name: '作者人格', enabled: true, local: true },
  { id: 'structural',  name: '结构重构', enabled: true },
  { id: 'polish',       name: '风格一致性', enabled: true },
  { id: 'deAI',         name: '去AI化',   enabled: true },
];

// ====== 作者人格本地生成器 ======
// A4 起流水线不再调用本函数（不随机决定本书作者）；保留导出仅供旧脚本兼容。

const PERSONA_POOL = {
  education: ['初中', '高中', '大专', '本科', '硕士'],
  favorite: ['乌贼', '猫腻', '烽火戏诸侯', '辰东', '耳根', '忘语', '唐家三少', '天蚕土豆', '血红', '跳舞', '我吃西红柿', '骷髅精灵', '梦入神机'],
  habit: [
    '喜欢短句', '喜欢长句嵌套', '喜欢插废话', '喜欢黑色幽默', '喜欢突然断句',
    '喜欢人物自言自语', '不喜欢解释', '喜欢用比喻', '喜欢环境烘托', '喜欢节奏快',
    '喜欢节奏慢', '喜欢对话多于描写', '喜欢描写多于对话', '喜欢第一人称视角',
    '喜欢用粗口', '喜欢自嘲',
  ],
  flaws: ['偶尔跑题', '偶尔重复', '标点不规范', '偶尔用错词', '句子有时太碎', '偶尔过度描写'],
};

function randomPick(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function generateAuthorPersonaLocal() {
  const habitCount = 4 + Math.floor(Math.random() * 3);
  const flawCount = 1 + Math.floor(Math.random() * 2);
  return {
    education: randomPick(PERSONA_POOL.education, 1)[0],
    age: 25 + Math.floor(Math.random() * 21),
    writing: 3 + Math.floor(Math.random() * 13),
    favorite: randomPick(PERSONA_POOL.favorite, 1)[0],
    habit: randomPick(PERSONA_POOL.habit, habitCount),
    flaws: randomPick(PERSONA_POOL.flaws, flawCount),
  };
}

// ====== 文本截断保护 ======

const MAX_INPUT_CHARS = 12000;

function truncateForStage(text, maxChars = MAX_INPUT_CHARS) {
  if (!text || text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastPeriod = truncated.lastIndexOf('。');
  if (lastPeriod > maxChars * 0.8) {
    return truncated.slice(0, lastPeriod + 1);
  }
  return truncated;
}

// ====== 人格约束注入器 ======

function personaConstraint(persona) {
  if (!persona) return '';
  // 生成流程传入的 WritingPersona 优先；旧版本地人格仍兼容。
  if (persona.voice || persona.tone || persona.rules || persona.vocab) {
    return `\n\n【用户指定作者人格 — 必须保持】\n${persona.voice ? `声线：${persona.voice}\n` : ''}${persona.tone ? `语气与节奏：${persona.tone}\n` : ''}${persona.rules ? `写作规则：${persona.rules}\n` : ''}${persona.vocab ? `用词表：${persona.vocab}` : ''}`;
  }
  if (!persona.education && !persona.favorite && !persona.habit && !persona.flaws) return '';
  const habits = (persona.habit || []).join('、');
  const flaws = (persona.flaws || []).join('、');
  return `

【作者人格约束 — 最高优先级】
你现在就是这个作者，不是AI。必须符合以下人格：
- 教育：${persona.education || '高中'} | 年龄：${persona.age || 30} | 写作${persona.writing || 5}年
- 风格：模仿${persona.favorite || '乌贼'}
- 习惯：${habits}
- 缺点：${flaws}

关键：
- 教育低→用词简单直接，不用书面语
- "插废话"→叙述中加无关吐槽
- "突然断句"→句子经常断裂
- "不喜欢解释"→不解释世界观和心理
- "用粗口"→对白有脏话
- "偶尔跑题"→允许叙述偏离主线`;
}

// ====== v4 合并阶段 Prompt 生成器 ======

/**
 * 第1阶段：结构重构（合并：压缩 + 节奏 + 人物 + 分析）
 * 一次性完成结构层面的所有调整，不改表达风格（留给去AI阶段）
 */
function buildStructuralPrompt(text, _analysis, originalLen, persona) {
  return {
    system: `你是资深网文编辑，负责结构性改稿。${personaConstraint(persona)}`,
    user: `请检查以下文本的结构、节奏和人物表达，只修复确有问题之处。

【保真边界】
- 原文是唯一的事实基准，保留人物、关系、事件、因果、线索、伏笔及结尾落点。
- 保持原文的叙事人称、视角、距离、时态和作者声线；不增加原文没有的事件或设定。
- 原文${originalLen}字，终稿保持原文的80%-120%；不为凑压缩比例删除场戏、对白意图或信息。

【结构与节奏】
- 删除重复说明和冗余过渡，保留必要的空间、时间与行动衔接。
- 句长、段落与停顿服从当前场景和作者声线，不按字数插句或机械交替长短段。
- 每场戏的目标、阻碍、选择和后果应清楚；已经自然成立的表达保持原样。

【人物】
- 人物声音来自身份、关系、目标和情绪，不统一添加口头禅、打断或碎片句。
- 对白保留核心意图和信息量；动作与情绪必须符合已有情境，不靠固定微动作替换词表。

直接输出完整文本，不附解释或修改说明。

${text}`,
  };
}

/**
 * 第2阶段：风格一致性（合并：润色 + 一致性检查）
 * 统一风格，检查前后一致，不做大幅改写
 */
function buildPolishPrompt(text, _analysis, _origLen, persona) {
  return {
    system: `你是小说终审编辑，负责风格统一和一致性检查。${personaConstraint(persona)}`,
    user: `对以下文本进行风格统一和一致性检查，只修复不改写。

【风格统一】
1. 叙述视角是否一致（不能中途换人称）
2. 人物称呼前后是否统一
3. 时间线是否连贯
4. 伏笔是否被意外删除（如有则恢复）
5. 世界观设定是否有矛盾（以原文明确建立的事实为准，不自行选择或新增设定）

【风格检查】
1. 沿用作者的词汇密度、叙述温度和幽默尺度，保留书面语或口语的既定选择。
2. 只修复空泛、重复或妨碍理解的连接与解释，不按禁词表机械替换。
3. 结尾保留原文落点，不额外补写情绪总结或升华；保留有意的叙述者介入。
4. 原文是唯一的事实基准；保留每场戏和对白意图，终稿保持原稿的80%-120%。

注意：不要大幅改写，只修复不一致和明显问题。去AI痕迹由下一阶段处理。

直接输出检查修复后的完整文本。

${text}`,
  };
}

/**
 * 第3阶段：去AI化（最终阶段 — 全部人类特征注入）
 * 这是最后一次 LLM 调用，前面阶段的 AI 特征在此全部消除
 */
function buildDeAIPrompt(text, _analysis, _origLen, persona) {
  return {
    system: `你是小说终稿编辑，负责保真校稿，保留作者声线并修复重复与模板表达。${personaConstraint(persona)}`,
    user: buildRewriteReviewPrompt(text, text),
  };
}

// ====== Prompt 生成器映射表 ======
const PROMPT_BUILDERS = {
  // persona: 本地生成，不需要 LLM Prompt
  structural: buildStructuralPrompt,
  polish:     buildPolishPrompt,
  deAI:       buildDeAIPrompt,
};

// ====== 核心流水线 ======

/**
 * 运行编辑引擎 v4（3 次 LLM 调用）
 */
async function runEditorialPipeline(text, options = {}) {
  const {
    apiConfig = resolveApiConfig(null, 'writing'),
    onChunk = null,
    onStatus = null,
    persona = null,
    // A4：作品冻结快照的修订风格上下文（偏好 + 修订边界样稿），由调用方构建一次。
    styleContext = '',
  } = options;

  if (!text || text.length < 100) {
    return { content: text, analysis: null, persona: null, stageResults: [] };
  }

  // A chapter larger than the provider-safe window must never be silently
  // reduced to its first 12k characters and written back as a full chapter.
  // Callers can split it explicitly in a future chunked editor; for now keep
  // the source intact and report the safe skip.
  if (String(text).length > MAX_INPUT_CHARS) {
    return {
      content: text,
      analysis: null,
      persona: persona || null,
      stageResults: [{ stage: 'guard', name: '长度保护', skipped: true, reason: `章节超过${MAX_INPUT_CHARS}字安全处理上限，保留原文` }],
      originalLength: String(text).length,
      finalLength: String(text).length,
      skipped: true,
    };
  }

  const originalLength = text.length;
  let currentText = text;
  let authorPersona = null;
  const stageResults = [];
  const delay = dsl.interStageDelay ?? 5000;

  for (let i = 0; i < STAGES.length; i++) {
    const stage = STAGES[i];

    if (stage.enabled === false) {
      stageResults.push({ stage: stage.id, name: stage.name, skipped: true });
      continue;
    }

    if (onStatus) {
      onStatus(stage.id, stage.name, `正在执行第${i + 1}阶段：${stage.name}...`, false, 'running');
    }

    // persona 阶段：只使用真实人格（作品/账号绑定），不再随机编造"本书作者"。
    // 没有人格时 personaConstraint 返回空串，编辑引擎按通用编辑行为工作。
    if (stage.local || stage.id === 'persona') {
      authorPersona = persona || null;
      if (!authorPersona) console.log('[编辑引擎] 未绑定写作人格，跳过作者人格注入（A4：不随机决定本书作者）');
      stageResults.push({ stage: stage.id, name: stage.name, persona: authorPersona, success: true });
      if (onStatus) {
        onStatus(stage.id, stage.name, `第${i + 1}阶段完成：${stage.name}（本地生成）`, false);
      }
      continue;
    }

    // LLM 阶段间延迟
    if (delay > 0) {
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const builder = PROMPT_BUILDERS[stage.id];
      const safeText = currentText;
      const { system, user } = builder(safeText, null, originalLength, authorPersona);
      // A4：阶段系统提示统一追加作品冻结快照的风格上下文（修订边界）。
      const stageSystem = system + styleContext;

      let result = await streamGenerate(
        stageSystem,
        stage.id === 'deAI' ? buildRewriteReviewPrompt(text, currentText) : user,
        onChunk ? (chunk) => { onChunk(chunk, stage.id); } : null,
        null,
        apiConfig,
        3,           // 3 次重试
        stage.id === 'structural' ? 0.65 : 0.55,
        undefined,
        300000
      );

      let stageOutput = result?.content || '';

      // 空输出重试：用精简 Prompt 再试一次
      if (!stageOutput.trim()) {
        console.warn(`[编辑引擎] 第${i + 1}阶段首次返回空内容，用精简Prompt重试`);
        if (onStatus) {
          onStatus(stage.id, stage.name, `第${i + 1}阶段返回为空，正在重试...`, false, 'running');
        }
        await new Promise(r => setTimeout(r, 2000));

        // A4：精简重试不再注入"加废信息/角色走神"之类的噪声指令，
        // 句式与口语度服从原文与作者声线（规划书 A4 任务 4）。
        const simplifiedUser = stage.id === 'deAI'
          ? buildRewriteReviewPrompt(text, currentText)
          : `请对以下文本进行${stage.name}处理。原文是唯一的事实基准，保留剧情、伏笔、人物、视角和作者声线，只改明确有问题的表达。最终篇幅保持原稿的80%-120%，不扩写或缩写。直接输出完整文本。\n\n${currentText}`;

        result = await streamGenerate(
          stageSystem,
          simplifiedUser,
          onChunk ? (chunk) => { onChunk(chunk, stage.id); } : null,
          null,
          apiConfig,
          3,
          0.55,
          undefined,
          300000
        );
        stageOutput = result?.content || '';
      }

      // 检查输出并更新文本
      // Check against the original, so successive stages cannot compound
      // shrinkage. Also keep every accepted draft inside the next stage's
      // complete-input window rather than silently cutting off its ending.
      const accepted = hasAcceptableRewriteLength(stageOutput, text) && stageOutput.length <= MAX_INPUT_CHARS;
      if (accepted) {
        currentText = stageOutput;
      } else {
        console.warn(`[编辑引擎] 第${i + 1}阶段篇幅异常(${stageOutput.length}字)，保留上一阶段结果`);
      }
      stageResults.push({
        stage: stage.id, name: stage.name,
        output: currentText.length,
        success: accepted,
        ...(!accepted ? { reason: '候选稿篇幅超出保真范围，已保留上一阶段文本' } : {}),
      });

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
    }
  }

  return {
    content: currentText,
    analysis: null,
    persona: authorPersona,
    stageResults,
    originalLength,
    finalLength: currentText.length,
  };
}

module.exports = {
  runEditorialPipeline,
  STAGES,
  PROMPT_BUILDERS,
  truncateForStage,
  MAX_INPUT_CHARS,
  personaConstraint,
};
