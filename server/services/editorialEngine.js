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

// 阶段定义（v4：仅 3 次 LLM 调用 + 1 次本地生成）
const STAGES = [
  { id: 'persona',     name: '作者人格', enabled: true, local: true },
  { id: 'structural',  name: '结构重构', enabled: true },
  { id: 'polish',       name: '风格一致性', enabled: true },
  { id: 'deAI',         name: '去AI化',   enabled: true },
];

// ====== 作者人格本地生成器 ======

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
  const targetLength = Math.round(originalLen * (dsl.compression?.ratio || 0.7));

  return {
    system: `你是资深网文编辑，负责结构性改稿。${personaConstraint(persona)}`,
    user: `对以下文本进行结构性重构（压缩+节奏+人物），保留剧情/伏笔/人物关系不变。

【压缩】目标约${targetLength}字（原文${originalLen}字）
- 删：重复描写、重复心理、冗余过渡、作者解释
- 留：剧情、人物、设定、伏笔、冲突、高潮

【节奏】
- 句长随机化：3字→50字→5字，禁止连续两句长度相近
- 每200字一句极短句（2-5字）
- 段落极端化：短段（1-2句）和长段（6句+）交替
- 允许硬切过渡，不需要"与此同时""紧接着"

【人物】
- 每个角色独特语言风格：口头禅、说话速度、文化水平
- 对白要有打断、答非所问、不完整句
- 微动作替代抽象情绪（握拳、咬牙替代"心中一惊"）

注意：这一步只改结构和内容，不需要刻意去AI痕迹，后续阶段专门处理。

直接输出重构后的完整文本。

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
5. 世界观设定是否有矛盾（保留更合理的）

【风格检查】
1. 口语过渡词优先用：话说回来、对了、算了、反正
2. 禁止"与此同时""紧接着""值得注意的是"等AI连接词
3. 禁止段尾升华/总结/感悟
4. 叙述口语化，不用书面语

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
    system: `你是番茄小说签约编辑。这是终稿去AI化处理，你的任务是让文本看起来完全像人写的。${personaConstraint(persona)}`,
    user: `对以下文本进行终稿去AI化。保留剧情/伏笔/人物不变，只改表达方式。

【核心 — 重建语言分布】

1. 打破标准开头
   禁止"环境→人物→动作→能力"
   改用：冲突开头 / 对话开头 / 奇怪的话开头 / 错误后纠正

2. 注入废信息（每500字至少一处）
   - 角色注意到无关细节（"墙上有个钉子，不知道谁钉的"）
   - 角色走神（"他想起昨天那碗面，挺咸的"）
   - 环境噪音（"远处什么东西倒了，咣当一声"）
   - 口误废话（"这个嘛……怎么说呢"）
   - 叙述者吐槽（"——话说回来，这人怎么还不来"）

3. 对白人格化
   - 不同角色说话方式完全不同
   - 要有打断（"我说——""行了行了我知道了"）
   - 要有答非所问
   - 要有不完整句（"那个……算了"）
   - 要有重复改口（"我觉得——不对，应该说是"）

4. 句长极端化（对抗 Entropy 检测）
   - 3字→50字→5字，完全随机
   - 允许"完了。""不对。""行。"独立成段
   - 允许五十多字的长句（中间破折号插入）
   - 禁止连续两句长度相近

5. 禁用词（必须替换或删除）
   ${dsl.forbidden.slice(0, 15).join('、')}

6. 禁止段尾升华/总结/感悟
7. 叙述口语化，不用书面语

直接输出终稿。这是最后一次处理，请确保文本看起来完全是真人写的。

${text}`,
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
  const delay = dsl.interStageDelay || 5000;

  for (let i = 0; i < STAGES.length; i++) {
    const stage = STAGES[i];

    if (stage.enabled === false) {
      stageResults.push({ stage: stage.id, name: stage.name, skipped: true });
      continue;
    }

    if (onStatus) {
      onStatus(stage.id, stage.name, `正在执行第${i + 1}阶段：${stage.name}...`, false, 'running');
    }

    // persona 阶段：本地生成，不调 LLM
    if (stage.local || stage.id === 'persona') {
      authorPersona = persona || generateAuthorPersonaLocal();
      console.log(`[编辑引擎] 作者人格生成(本地):`, JSON.stringify(authorPersona));
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
      const safeText = truncateForStage(currentText);
      const { system, user } = builder(safeText, null, originalLength, authorPersona);

      let result = await streamGenerate(
        system,
        user,
        onChunk ? (chunk) => { onChunk(chunk, stage.id); } : null,
        null,
        apiConfig,
        3,           // 3 次重试
        0.85 + Math.random() * 0.15
      );

      let stageOutput = result?.content || '';

      // 空输出重试：用精简 Prompt 再试一次
      if (!stageOutput.trim()) {
        console.warn(`[编辑引擎] 第${i + 1}阶段首次返回空内容，用精简Prompt重试`);
        if (onStatus) {
          onStatus(stage.id, stage.name, `第${i + 1}阶段返回为空，正在重试...`, false, 'running');
        }
        await new Promise(r => setTimeout(r, 2000));

        const simplifiedUser = `请对以下文本进行${stage.name}处理。保留剧情/伏笔/人物不变，只改表达方式。\n\n【核心】\n- 句子忽长忽短，完全随机\n- 加入废信息和角色走神\n- 对白人格化\n- 禁止AI连接词\n- 禁止段尾升华\n- 叙述口语化\n${personaConstraint(authorPersona)}\n\n直接输出完整文本。\n\n${truncateForStage(currentText, 8000)}`;

        result = await streamGenerate(
          `你是网文编辑，擅长${stage.name}。`,
          simplifiedUser,
          onChunk ? (chunk) => { onChunk(chunk, stage.id); } : null,
          null,
          apiConfig,
          3,
          0.9 + Math.random() * 0.1
        );
        stageOutput = result?.content || '';
      }

      // 检查输出并更新文本
      if (stageOutput.length > currentText.length * 0.15) {
        currentText = stageOutput;
      } else {
        console.warn(`[编辑引擎] 第${i + 1}阶段输出过短(${stageOutput.length}字)，使用上一阶段结果`);
      }
      stageResults.push({
        stage: stage.id, name: stage.name,
        output: currentText.length,
        success: stageOutput.length > currentText.length * 0.15,
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
};
