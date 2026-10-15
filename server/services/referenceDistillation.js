const { streamGenerate } = require('./aiService');
const CHUNK_SIZE = 20000
const MAX_CHUNKS = 20 // 最多分析 20 块 ≈ 40 万字

async function extractStyleProfile(fileContent, mainCategory, subCategory, novelType = 'normal', apiConfig, onProgress = () => {}, signal = null) {
  const isLightNovel = novelType === 'lightnovel'
  const typeLabel = isLightNovel ? '轻小说（日式ACGN风格）' : '小说'

  // 分块
  const totalLen = fileContent.length
  const chunkCount = Math.min(Math.ceil(totalLen / CHUNK_SIZE), MAX_CHUNKS)
  console.log(`[蒸馏] 全文 ${totalLen} 字，分 ${chunkCount} 块分析`)

  const chunkResults = []

  for (let i = 0; i < chunkCount; i++) {
    const start = chunkCount === 1 ? 0 : Math.round(i * Math.max(0, totalLen - CHUNK_SIZE) / (chunkCount - 1))
    const end = Math.min(start + CHUNK_SIZE, totalLen)
    const chunk = fileContent.slice(start, end)
    await onProgress(i, chunkCount)
    const isFirst = i === 0
    const positionLabel = isFirst ? '开头' : (i === chunkCount - 1 ? '结尾' : `第${i + 1}部分`)

    // 首块做完整分析，后续块只提取"新增特征"
    const prompt = isFirst
      ? (isLightNovel
        ? `你是一位专业的轻小说分析专家。请分析以下轻小说内容，提取它的风格特征。

轻小说类型：${mainCategory}${subCategory ? ' - ' + subCategory : ''}

请按以下格式输出（纯文本，不要用Markdown）：

【风格描述】
用 800-1000 字详细描述这部轻小说的整体风格。从以下几个维度展开：
1. 叙事视角：第一人称还是第三人称，主角视角的贴近程度
2. 角色塑造：角色萌属性（傲娇/天然呆/元气/冷酷等）的表现方式，角色间互动
3. 对话风格：对话占比、对话中是否包含角色个性
4. 描写风格：场景描写是否有动画感、萌系动作描写
5. 情感基调：整体氛围（温馨/热血/治愈/伤感）
6. 叙事节奏：日常/战斗/剧情的穿插比例
7. 用词倾向：是否使用拟声词、语气词

【精选片段】
从原文中挑选 8-10 个最能体现风格的片段，每个不超过 300 字，用 【片段1】...【片段10】 标记。

【写作特点】
用 200-300 字分析写作技法。

【特色词汇】
列出 15-25 个最有辨识度的特色词汇。

【章节结构】
用 80-150 字概括章节结构规律。

【质量评分】
根据内容与分类（${mainCategory}${subCategory ? ' - ' + subCategory : ''}）的匹配程度，给出 1-100 的整数分数。

以下是小说${positionLabel}内容：
${chunk}`
        : `你是一位专业的小说分析专家。请分析以下小说内容，提取它的风格特征。

小说类型：${mainCategory}${subCategory ? ' - ' + subCategory : ''}

请按以下格式输出（纯文本，不要用Markdown）：

【风格描述】
用 800-1000 字详细描述这部小说的整体风格。从以下几个维度展开：
1. 叙事节奏：整体快慢风格、张弛节奏变化规律、高潮分布密度
2. 对话比例与风格：对话/叙述比例、对话特色
3. 描写风格：场景描写是简笔勾勒还是细密铺陈
4. 情感基调：整体氛围（压抑/热血/轻松/沉重）
5. 开篇风格：如何快速引入世界观/人物/冲突
6. 用词倾向：文言/白话、用词华丽或朴实
7. 爽点/爽感设计：打脸节奏、升级反馈、情绪释放方式

【精选片段】
从原文中挑选 8-10 个最能体现风格的片段，每个不超过 300 字，用 【片段1】...【片段10】 标记。

【写作特点】
用 200-300 字分析写作技法。

【特色词汇】
列出 15-25 个最有辨识度的特色词汇。

【章节结构】
用 80-150 字概括章节结构规律。

【质量评分】
根据内容与分类（${mainCategory}${subCategory ? ' - ' + subCategory : ''}）的匹配程度，给出 1-100 的整数分数。

以下是小说${positionLabel}内容：
${chunk}`)
      : `以下是${typeLabel}《${mainCategory}》的${positionLabel}（第${start}~${end}字范围）。请提取这一段新增的风格特征，重点标注与开头部分不同的地方。

格式要求：
【新增风格特征】
用 200-300 字描述这一段与开头相比出现的新的风格特征（如有），包括但不限于：
- 节奏是否有变化
- 是否有新的写作手法
- 角色塑造是否有新的维度
- 是否有新的用词习惯

【新增特色词汇】
列出这一段中新出现的、前面没有的特色词汇，最多 10 个，用逗号分隔。

【补充片段】
从这一段中挑选 1-3 个最能代表风格或与前文不同的片段，每个不超过 200 字，用 【片段1】... 标记。

文本内容：
${chunk}`

    const result = await streamGenerate(
      `你是一位专业的${typeLabel}分析专家，擅长提取文本风格特征。`,
      prompt, null, signal,
      apiConfig
    )

    const raw = result.content || ''
    if (raw.length > 50) {
      chunkResults.push({ index: i, position: positionLabel, content: raw, isFirst })
    }
  }

  // 如果有多个分块，让 AI 综合成最终结果
  if (chunkResults.length > 1) {
    const synthesisInput = chunkResults.map((r, idx) => {
      return `===== 第${idx + 1}块分析（${r.position}）=====\n${r.content}`
    }).join('\n\n')

    const synthesisPrompt = `你是一位资深的小说编辑，请将以下对同一部小说的多份风格分析报告，综合成一份完整、一致的最终风格档案。

要求：
1. 合并所有分析中的风格描述，去重、补充
2. 精选片段从所有块中挑选最好的 8-10 个
3. 特色词汇去重合并为 15-30 个
4. 写作特点和章节结构综合所有块的信息
5. 质量评分取各块评分的平均值

请严格按照以下格式输出：

【风格描述】
（合并后的完整风格描述，1000-1500 字）

【精选片段】
（从全文范围挑选 8-10 个最佳片段）

【写作特点】
（综合后的写作特点分析，200-300 字）

【特色词汇】
（去重合并后的特色词汇列表，逗号分隔）

【章节结构】
（综合后的章节结构描述，80-150 字）

【质量评分】
（综合评分，1-100 的整数）

以下是各块分析结果：
${synthesisInput}`

    const result = await streamGenerate(
      '你是一位资深的小说编辑，擅长综合多份分析报告。',
      synthesisPrompt, null, signal,
      apiConfig
    )

    return result.content || chunkResults[0].content
  }

  return chunkResults[0]?.content || ''
}

// 解析 AI 输出为结构化数据
function parseStyleOutput(text) {
  const styleProfile = (text.match(/【风格描述】\s*([\s\S]*?)(?=\n【精选片段】|$)/) || [])[1]?.trim() || ''

  const excerptsMatch = text.match(/【片段\d+】\s*([\s\S]*?)(?=\n【片段\d+】|\n【写作特点】|$)/g) || []
  const keyExcerpts = excerptsMatch.map(e => e.replace(/【片段\d+】\s*/, '').trim()).filter(Boolean)

  const writingMatch = (text.match(/【写作特点】\s*([\s\S]*?)(?=\n【特色词汇】|$)/) || [])[1]
  const writingCharacteristics = writingMatch ? writingMatch.trim() : ''

  const vocabMatch = (text.match(/【特色词汇】\s*([\s\S]*?)(?=\n【章节结构】|$)/) || [])[1]
  const vocabularyBank = vocabMatch ? vocabMatch.split(/[,，、]/).map(v => v.trim()).filter(Boolean) : []

  const chapterStructure = (text.match(/【章节结构】\s*([\s\S]*?)(?=\n【质量评分】|$)/) || [])[1]?.trim() || ''

  const qualityScore = parseInt((text.match(/【质量评分】\s*(\d+)/) || [])[1], 10) || 0

  return { styleProfile: styleProfile.slice(0, 6000), keyExcerpts: keyExcerpts.slice(0, 10).map(text => text.slice(0, 300)),
    writingCharacteristics: writingCharacteristics.slice(0, 3000), vocabularyBank: vocabularyBank.slice(0, 30).map(word => word.slice(0, 80)),
    chapterStructure: chapterStructure.slice(0, 1600), qualityScore: Math.max(0, Math.min(100, qualityScore)) }
}


module.exports = { extractStyleProfile, parseStyleOutput };
