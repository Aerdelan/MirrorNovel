/**
 * Writing Agent Service — AI 写作智能体
 *
 * Agent 循环流程：
 * 1. PLAN — 分析上下文，规划本章内容（自动生成章节计划）
 * 2. WRITE — 执行写作
 * 3. REVIEW — 审查质量和一致性问题
 * 4. REVISE — 如有问题，自动修订
 */

const { streamGenerate, resolveApiConfig } = require('./aiService')

/**
 * 规划章节内容（编写章节指令）
 */
async function planChapter(novel, userConfig) {
  const outline = novel.outline || ''
  const lastChapter = novel.chapters[novel.chapters.length - 1]
  const lastContent = lastChapter ? lastChapter.content?.slice(-200) : '（故事开始）'
  const currentCh = novel.currentChapterIndex + 1

  const prompt = `你是一位专业的小说章节规划师。请为第${currentCh}章制定一个简短的写作计划。

小说类型：${novel.novelTypeName || '未知'}
主角：${novel.protagonistName || '未设定'}
大纲方向：${outline ? outline.substring(0, 300) : '无具体大纲'}

上一章结尾：${lastContent}

当前总字数：${novel.currentWordCount || 0} / ${novel.targetWordCount || 50000} 字

请输出以下格式的章节计划（200字以内）：
【本章主题】一句话概括本章核心内容
【主要剧情】2-3句话描述本章要推进的剧情
【需要衔接】上一章的结尾如何衔接
【伏笔/悬念】本章要设置或回收的伏笔
【目标字数】本章预期字数`

  const result = await streamGenerate(
    '你是一位专业的小说章节规划师，擅长设计剧情走向。',
    prompt, null, null,
    resolveApiConfig(userConfig, 'writing')
  )

  return result.content || ''
}

/**
 * 审查章节质量
 */
async function reviewChapter(chapterContent, novel, lastChapters) {
  if (!chapterContent || chapterContent.length < 100) return { issues: [], score: 0 }

  const lastCh = lastChapters[lastChapters.length - 1]
  const lastEnding = lastCh ? lastCh.content?.slice(-100) : ''

  const prompt = `请审查以下小说章节内容，检查是否存在以下问题：

1. 【衔接问题】是否与上一章结尾顺畅衔接（上一章结尾：${lastEnding ? lastEnding.substring(0, 100) : '无'}）
2. 【重复问题】是否有与前面章节重复的段落或描述
3. 【角色问题】角色性格和行为是否与之前一致（主角：${novel.protagonistName || '未知'}）
4. 【节奏问题】是否有大段无意义的描述或对话拖沓
5. 【AI味问题】是否有"仿佛、好像、不禁、微微、眼中闪过"等AI常用词汇

请逐条回答"是/否"并简要说明原因。最后给出综合评分 1-10。`

  const result = await streamGenerate(
    '你是一位专业的小说审稿编辑，擅长发现写作问题。',
    prompt + '\n\n以下是本章内容：\n' + chapterContent.substring(0, 3000),
    null, null,
    resolveApiConfig(userConfig, 'writing')
  )

  const text = result.content || ''

  // 解析审查结果
  const hasIssues = /是/.test(text) && !/完全没有|无问题|没有问题/.test(text)
  const scoreMatch = text.match(/(\d+)\s*分/)
  const score = scoreMatch ? parseInt(scoreMatch[1]) : 7

  return {
    issues: hasIssues ? [text.substring(0, 500)] : [],
    score,
    raw: text,
  }
}

/**
 * 根据审查意见修订章节
 */
async function reviseChapter(chapterContent, reviewResult, userConfig) {
  if (!reviewResult.issues || reviewResult.issues.length === 0) {
    return chapterContent
  }

  const prompt = `你对以下小说章节进行了审查，发现了一些问题。请根据审查意见进行修订。

审查意见：
${reviewResult.issues.join('\n')}

修订要求：
1. 保持原章节的情节走向不变
2. 只修改有问题的部分
3. 优化语言表达，去除AI味
4. 确保衔接自然流畅

以下是需要修订的章节内容：
${chapterContent}`

  const result = await streamGenerate(
    '你是一位专业的小说修订编辑，擅长根据审查意见优化文本。',
    prompt, null, null,
    resolveApiConfig(userConfig, 'writing')
  )

  return result.content || chapterContent
}

/**
 * 完整 Agent 写作流程（单章）
 * @param {Object} novel - 小说对象
 * @param {string} systemPrompt - 系统提示词
 * @param {Function} onChunk - 流式回调
 * @param {Function} onStatus - 状态回调
 * @param {Object} userConfig - 用户模型配置
 * @param {AbortSignal} signal - 中止信号
 * @returns {string} 生成的章节内容
 */
async function agentGenerateChapter(novel, systemPrompt, onChunk, onStatus, userConfig, signal) {
  const currentCh = (novel.currentChapterIndex || 0) + 1
  const lastChapter = novel.chapters[novel.chapters.length - 1]
  const lastContent = lastChapter ? lastChapter.content?.slice(-200) : ''
  const outline = novel.outline || ''

  // Step 1: 规划
  onStatus && onStatus({ type: 'status', message: `🤖 Agent 正在规划第${currentCh}章...` })
  let chapterPlan = ''
  try {
    chapterPlan = await planChapter(novel, userConfig)
  } catch (e) {
    console.warn('[Agent] 规划失败，跳过:', e.message)
  }

  // Step 2: 构建写作提示
  const planSection = chapterPlan
    ? `\n\n【章节计划】\n${chapterPlan}`
    : ''

  const chPrompt = `请创作第${currentCh}章。

小说类型：${novel.novelTypeName || '未知'}
主角：${novel.protagonistName || '未设定'}
世界观：${novel.worldSetting || '自由发挥'}
${outline ? '大纲方向：' + outline.substring(0, 500) : ''}

上一章结尾：
${lastContent || '（故事开始）'}
${planSection}

要求：
1. 每章要有独立的起承转合
2. 注意与上一章结尾的衔接
3. 保持角色性格一致性
4. 推进主要剧情线
5. 结尾留有悬念或钩子
6. 每章结束时标注【未完待续】`

  // Step 3: 写作
  onStatus && onStatus({ type: 'status', message: `✍️ 正在写作第${currentCh}章...` })
  let buffer = ''
  await streamGenerate(systemPrompt, chPrompt, (chunk) => {
    buffer += chunk
    if (onChunk) onChunk(chunk)
  }, signal, resolveApiConfig(userConfig, 'writing'))

  // Step 4: 审查（跳过短章节）
  let reviewedContent = buffer
  if (buffer.length > 500) {
    try {
      onStatus && onStatus({ type: 'status', message: `🔍 正在审查第${currentCh}章...` })
      const reviewResult = await reviewChapter(buffer, novel, novel.chapters, userConfig)
      if (reviewResult.score < 5 || (reviewResult.issues.length > 0 && buffer.length > 1000)) {
        onStatus && onStatus({ type: 'status', message: `🔧 正在优化第${currentCh}章...` })
        reviewedContent = await reviseChapter(buffer, reviewResult, userConfig)
      }
    } catch (e) {
      console.warn('[Agent] 审查失败，跳过:', e.message)
    }
  }

  return reviewedContent
}

module.exports = {
  agentGenerateChapter,
  planChapter,
  reviewChapter,
  reviseChapter,
}
