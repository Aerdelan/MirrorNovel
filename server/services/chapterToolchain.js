/**
 * Chapter Toolchain Service — 章节后处理流水线
 *
 * 链路：原始内容 → 去AI味 → 质量检查 → 标点修正 → 最终输出
 */

// AI 味检测词库
const AI_PATTERNS = [
  /\b仿佛\b/g, /\b好像\b/g, /\b不禁\b/g, /\b微微\b/g,
  /\b眼中闪过\b/g, /\b嘴角\b.*\b勾起\b/g, /\b不由得\b/g,
  /\b顿时\b/g, /\b瞬间\b/g, /\b忽然\b/g,
  /\b似乎\b/g, /\b略显\b/g, /\b略带\b/g,
  /\b一抹\b/g, /\b一丝\b/g, /\b一股\b/g,
  /\b心头一\w/g, /\b心中一动\b/g,
  /\b眼神之中\b/g, /\b语气之中\b/g,
]

// 基础去AI味替换
function simpleDeAIfy(text) {
  if (!text) return text

  let result = text

  // 替换特定AI味词汇
  const replacements = [
    [/仿佛/g, '像'], [/好像/g, '像'],
    [/不禁/g, ''], [/不由得/g, ''],
    [/顿时/g, '立刻'], [/瞬间/g, '转眼'],
    [/忽然/g, '突然'],
    [/似乎/g, ''], [/略显/g, '有点'], [/略带/g, '有点'],
    [/一抹/g, '一丝'], [/一丝/g, '一点'],
    [/眼中闪过/g, '眼里露出'],
    [/嘴角不由/g, '嘴角'], [/嘴角微微/g, '嘴角'],
    [/心头一震/g, '心里一惊'], [/心中一动/g, '心里一动'],
    [/语气之中/g, '语气里'], [/眼神之中/g, '眼神里'],
    [/一股\w+的气息/g, (m) => m.replace('的气息', '')],
  ]

  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement)
  }

  return result
}

/**
 * 统计AI味词汇密度
 */
function countAIFlavor(text) {
  if (!text) return { count: 0, density: 0, examples: [] }
  let count = 0
  const examples = []
  for (const pattern of AI_PATTERNS) {
    const matches = text.match(pattern)
    if (matches) {
      count += matches.length
      examples.push(matches[0])
    }
  }
  return {
    count,
    density: text.length > 0 ? count / (text.length / 100) : 0, // 每百字出现次数
    examples: [...new Set(examples)].slice(0, 5),
  }
}

/**
 * 标点符号修正
 */
function fixPunctuation(text) {
  if (!text) return text
  let result = text
  // 连续中文引号修正
  result = result.replace(/'([^']+)'/g, '「$1」')
  // 多余空格
  result = result.replace(/\s{2,}/g, ' ')
  // 中文之间的英文逗号改为中文逗号
  result = result.replace(/([\u4e00-\u9fff]),(\s*[\u4e00-\u9fff])/g, '$1，$2')
  // 连续标点归一
  result = result.replace(/！{2,}/g, '！')
  result = result.replace(/？{2,}/g, '？')
  result = result.replace(/。{2,}/g, '。')
  // 句尾空格
  result = result.replace(/[。！？]\s+[。！？]/g, (m) => m.trim())
  return result
}

/**
 * 完整后处理流水线
 * @param {string} text - 原始章节内容
 * @param {Object} options - 配置项
 * @param {boolean} options.doDeAI - 是否执行去AI味
 * @param {boolean} options.doPunctuation - 是否执行标点修正
 * @returns {{ text: string, report: Object }}
 */
function processChapter(text, options = {}) {
  const { doDeAI = true, doPunctuation = true } = options
  if (!text) return { text: '', report: {} }

  let processed = text
  const report = {
    originalLength: text.length,
    deAICount: 0,
    punctuationFixes: 0,
  }

  // Step 1: AI味检测
  const aiFlavor = countAIFlavor(text)
  report.aiFlavorBefore = aiFlavor

  // Step 2: 去AI味（如果密度 > 0.5/百字）
  if (doDeAI && aiFlavor.density > 0.3) {
    const before = processed.length
    processed = simpleDeAIfy(processed)
    report.deAICount = before - processed.length
  }

  // Step 3: 标点修正
  if (doPunctuation) {
    const before = processed.length
    processed = fixPunctuation(processed)
    report.punctuationFixes = processed.length - before
  }

  // Step 4: 再次检测AI味
  const aiFlavorAfter = countAIFlavor(processed)
  report.aiFlavorAfter = aiFlavorAfter

  return { text: processed, report }
}

/**
 * 章节质量评分
 */
function qualityScore(text) {
  if (!text || text.length < 50) return 0

  let score = 70 // 基础分
  const deductions = []

  // 长度判定
  if (text.length < 300) { score -= 20; deductions.push('章节过短') }
  else if (text.length < 800) { score -= 10; deductions.push('章节偏短') }
  else if (text.length > 5000) { score += 5; deductions.push('章节充实') }

  // AI味检测
  const ai = countAIFlavor(text)
  if (ai.density > 1) { score -= 15; deductions.push('AI味过重') }
  else if (ai.density > 0.5) { score -= 8; deductions.push('AI味偏重') }

  // 对话比例（粗略）
  const dialogCount = (text.match(/[""「」『』]/g) || []).length
  const dialogRatio = dialogCount / (text.length / 100)
  if (dialogRatio < 0.1 && text.length > 500) { score -= 5; deductions.push('对话偏少') }
  else if (dialogRatio > 2) { score += 5; deductions.push('对话丰富') }

  // 段落长度（段落太长的扣分）
  const paragraphs = text.split(/\n+/).filter(p => p.trim().length > 20)
  if (paragraphs.length > 0) {
    const avgParaLen = paragraphs.reduce((s, p) => s + p.length, 0) / paragraphs.length
    if (avgParaLen > 500 && text.length > 1000) { score -= 8; deductions.push('段落过长') }
  }

  return {
    score: Math.max(10, Math.min(100, score)),
    deductions,
    aiDensity: ai.density.toFixed(1),
  }
}

module.exports = {
  processChapter,
  qualityScore,
  countAIFlavor,
  simpleDeAIfy,
  fixPunctuation,
}
