/**
 * Chapter Toolchain Service — 章节后处理流水线 v2
 *
 * 链路：原始内容 → 朱雀专项检测 → 上下文感知去AI味 → 段落节奏随机化 → 标点修正 → 最终输出
 *
 * v2 增强：
 *   - 朱雀高频标记词检测（除原有16个模式外，新增8个朱雀专项模式）
 *   - 上下文感知替换（不再暴力删除，根据语境选择不同替换策略）
 *   - 段落节奏随机化（打破AI的均匀段落特征）
 *   - 极短句穿插（每200字插入一句打断节奏）
 */

const deslop = require('../config/deslop')

// AI 味检测词库（原有 16 个模式 + 朱雀专项 8 个模式）
const AI_PATTERNS = [
  /\b仿佛\b/g, /\b好像\b/g, /\b不禁\b/g, /\b微微\b/g,
  /\b眼中闪过\b/g, /\b嘴角\b.*\b勾起\b/g, /\b不由得\b/g,
  /\b顿时\b/g, /\b瞬间\b/g, /\b忽然\b/g,
  /\b似乎\b/g, /\b略显\b/g, /\b略带\b/g,
  /\b一抹\b/g, /\b一丝\b/g, /\b一股\b/g,
  /\b心头一\w/g, /\b心中一动\b/g,
  /\b眼神之中\b/g, /\b语气之中\b/g,
  // v2 朱雀专项：连接词/总结词/假深度句
  /值得注意的是/g, /不可否认/g, /综上所述/g,
  /与此同时/g, /总而言之/g, /显而易见/g, /众所周知/g,
  /进一步来说/g, /从这个角度来看/g, /基于以上分析/g,
  /他终于明白/g, /她这才意识到/g, /这一刻终于/g,
  // v2 模板化标签
  /\w+说道/g, /\w+淡淡地说/g, /\w+冷冷地说/g,
  // v3 漏网标记
  /后知后觉/g, /小结一下/g, /\b小结\b/g, /愣住/g,
]

// 上下文感知替换表（多选项，按语境随机选择）
const CONTEXT_AWARE_REPLACEMENTS = [
  // [正则匹配, 候选替换列表, 匹配组]
  { pattern: /仿佛/g, candidates: ['像', '跟……似的', '好像'], preferDelete: false,
    genreOverrides: { xianxia: ['宛如', '如', '似乎', '就好似', '恰似', '（删除）'], wuxia: ['似乎', '好像', '好比', '（删除）'], gufeng: ['宛如', '如', '似乎', '恰似', '（删除）'] } },
  { pattern: /好像/g, candidates: ['像', '跟……似的', '八成是'], preferDelete: false,
    genreOverrides: { xianxia: ['似乎', '仿佛', '如', '好比', '（删除）'], wuxia: ['似乎', '仿佛', '好比', '（删除）'], gufeng: ['似乎', '仿佛', '如', '（删除）'] } },
  { pattern: /不禁/g, candidates: ['（删除）'], preferDelete: true },
  { pattern: /不由得/g, candidates: ['（删除）'], preferDelete: true },
  { pattern: /顿时/g, candidates: ['立刻', '马上', '当下', '一下子'], preferDelete: false },
  { pattern: /瞬间/g, candidates: ['转眼', '一眨眼', '眨眼间', '眨眼工夫'], preferDelete: false },
  { pattern: /忽然/g, candidates: ['突然', '猛一下', '冷不丁', '一扭头'], preferDelete: false,
    genreOverrides: { xianxia: ['陡然', '骤然', '猛然', '突地', '（删除）'], wuxia: ['陡然', '猛然', '突地', '（删除）'], gufeng: ['陡然', '骤然', '忽而', '突地', '（删除）'] } },
  { pattern: /似乎/g, candidates: ['好像', '八成是', '感觉', '（删除）'], preferDelete: true,
    genreOverrides: { xianxia: ['仿佛', '大概', '约莫', '（删除）'], wuxia: ['仿佛', '大概', '（删除）'], gufeng: ['仿佛', '似有', '约莫', '（删除）'] } },
  { pattern: /略显/g, candidates: ['有点', '有几分', '多少有点', '带着点'], preferDelete: false },
  { pattern: /略带/g, candidates: ['有点', '带着点', '多少有点'], preferDelete: false },
  { pattern: /眼中闪过/g, candidates: ['眼里露出', '眼神变了', '眼底一沉', '目光一凝'], preferDelete: false },
  { pattern: /嘴角不由/g, candidates: ['嘴角', '嘴角一抽', '嘴角动了动'], preferDelete: false },
  { pattern: /嘴角微微/g, candidates: ['嘴角', '嘴角动了下', '嘴角抽了抽'], preferDelete: false },
  { pattern: /心头一震/g, candidates: ['心里一惊', '心里咯噔一下', '心一沉', '心里发毛'], preferDelete: false },
  { pattern: /心中一动/g, candidates: ['心里一动', '心里打了个突', '心里痒了一下', '心思一动'], preferDelete: false },
  { pattern: /语气之中/g, candidates: ['语气里', '话里', '声音里'], preferDelete: false },
  { pattern: /眼神之中/g, candidates: ['眼神里', '眼睛里', '眼底'], preferDelete: false },
  // v2 朱雀专项 — 连接词
  { pattern: /值得注意的是/g, candidates: ['（删除）'], preferDelete: true },
  { pattern: /不可否认/g, candidates: ['（删除）', '说实话'], preferDelete: true },
  { pattern: /综上所述/g, candidates: ['说白了', '说穿了', '一句话', '总之'], preferDelete: false,
    genreOverrides: { xianxia: ['（删除）'], wuxia: ['（删除）'], gufeng: ['（删除）'] } },
  { pattern: /与此同时/g, candidates: ['（删除）'], preferDelete: true },
  { pattern: /众所周知/g, candidates: ['（删除）', '谁都知道'], preferDelete: true },
  { pattern: /进一步来说/g, candidates: ['（删除）'], preferDelete: true },
  { pattern: /从这个角度来看/g, candidates: ['（删除）'], preferDelete: true },
  { pattern: /基于以上分析/g, candidates: ['（删除）'], preferDelete: true },
  // v2 朱雀专项 — 假深度句（最容易触发朱雀检测但最容易被忽略）
  { pattern: /他终于明白/g, candidates: ['这才反应过来', '心里一下子明白了', '总算懂了', '（删除）'], preferDelete: false },
  { pattern: /她这才意识到/g, candidates: ['她这才发现', '她到这时候才看清', '（删除）'], preferDelete: false,
    genreOverrides: { xianxia: ['（删除）', '她才看清'], wuxia: ['（删除）', '她才看清'], gufeng: ['（删除）', '她才看清'] } },
  { pattern: /这一刻终于/g, candidates: ['这一刻总算', '可算', '终于', '（删除）'], preferDelete: false,
    genreOverrides: { xianxia: ['终于', '总算', '如今', '（删除）'], wuxia: ['终于', '总算', '（删除）'], gufeng: ['终于', '总算', '如今', '（删除）'] } },
  { pattern: /命运如此安排/g, candidates: ['事到如今', '走到这一步', '事情都这样了', '（删除）'], preferDelete: false },
  { pattern: /生活就是这样/g, candidates: ['（删除）', '日子不就这样么'], preferDelete: true },
  { pattern: /时间会给出答案/g, candidates: ['等着瞧吧', '走着看吧', '以后再说吧', '（删除）'], preferDelete: false },
  // v3 漏网标记替换
  { pattern: /后知后觉/g, candidates: ['这才意识到', '才发现', '（删除）'], preferDelete: true,
    genreOverrides: { xianxia: ['（删除）', '方才醒悟'], wuxia: ['（删除）', '方才醒悟'], gufeng: ['（删除）', '方才醒悟'] } },
  { pattern: /小结一下/g, candidates: ['（删除）'], preferDelete: true },
  { pattern: /小结/g, candidates: ['（删除）', '简单说'], preferDelete: true },
  { pattern: /一股/g, candidates: ['一阵', '一种', '（删除）'], preferDelete: false,
    genreOverrides: { xianxia: ['一阵', '（删除）'], wuxia: ['一阵', '（删除）'], gufeng: ['一阵', '（删除）'] } },
  { pattern: /愣住/g, candidates: ['一怔', '一呆', '僵住', '呆了呆'], preferDelete: false },
  // v3 连接词仙侠加强：仙侠体裁下所有连接词优先删除
  { pattern: /总而言之/g, candidates: ['说白了', '反正', '一句话', '要说就是'], preferDelete: false,
    genreOverrides: { xianxia: ['（删除）'], wuxia: ['（删除）'], gufeng: ['（删除）'] } },
  { pattern: /显而易见/g, candidates: ['（删除）', '明摆着', '谁都看得出来'], preferDelete: true,
    genreOverrides: { xianxia: ['（删除）'], wuxia: ['（删除）'], gufeng: ['（删除）'] } },
  { pattern: /总而言之/g, candidates: ['说白了', '说穿了', '一句话', '总之'], preferDelete: false,
    genreOverrides: { xianxia: ['（删除）'], wuxia: ['（删除）'], gufeng: ['（删除）'] } },
]

/**
 * 上下文感知去AI味替换（v2 核心改进）
 * 相比于 v1 简单暴力的字符串替换，v2 会根据语境选择不同的替换方案
 * 避免"不禁→删除"导致句子不通顺的问题
 */
function smartDeAIfy(text, genre = '') {
  if (!text) return text

  let result = text
  const literaryGenres = ['xianxia', 'wuxia', 'gufeng']
  const isLiterary = literaryGenres.includes(genre)

  for (const rule of CONTEXT_AWARE_REPLACEMENTS) {
    if (!rule.pattern.test(result)) continue

    // 重置 lastIndex（因为全局正则需要手动重置）
    rule.pattern.lastIndex = 0

    // 体裁感知：古风/仙侠/武侠优先使用体裁专属候选
    let effectiveCandidates = rule.candidates
    if (isLiterary && rule.genreOverrides && rule.genreOverrides[genre]) {
      effectiveCandidates = rule.genreOverrides[genre]
    }

    if (rule.preferDelete) {
      // 优先删除：尝试直接删除，检查删除后语义是否完整
      // 如果匹配词前面是句号/问号/感叹号/开头，后面是逗号/句号，安全删除
      result = result.replace(rule.pattern, (match, offset) => {
        const before = offset > 0 ? result[offset - 1] : ''
        const after = offset + match.length < result.length ? result[offset + match.length] : ''

        // 安全删除条件：前面是标点/开头，且后面有内容
        if (/[。！？\n　]/u.test(before) || offset === 0) {
          // 如果后面紧跟逗号，一并删除
          if (/^[，,]\s*/.test(after)) {
            return ''
          }
          return ''
        }

        // 不安全删除：用缓和的替换
        const candidate = effectiveCandidates[Math.floor(Math.random() * effectiveCandidates.length)]
        if (candidate === '（删除）') return ''
        return candidate
      })
    } else {
      // 非优先删除：从候选列表中随机选择替换
      result = result.replace(rule.pattern, () => {
        const nonDeleteCandidates = effectiveCandidates.filter(c => c !== '（删除）')
        if (nonDeleteCandidates.length === 0) return ''
        return nonDeleteCandidates[Math.floor(Math.random() * nonDeleteCandidates.length)]
      })
    }
  }

  // 修正因连续删除导致的多余标点和空格
  result = result.replace(/[，,]\s*[，,]/g, '，')
  result = result.replace(/[。！？]\s*[，,]/g, (m) => m[0])
  result = result.replace(/[，,]\s*$/gm, '')
  // 删除开头/段落首位的孤立逗号（开头词被删除后可能残留 ",内容"）
  result = result.replace(/^[，,]\s*/gm, '')
  result = result.replace(/\n[，,]\s*/g, '\n')
  result = result.replace(/\n{3,}/g, '\n\n')

  // 修复替换副作用
  result = cleanupArtifacts(result)

  return result
}

/**
 * 清理替换副作用产生的文本错误（v3 新增）
 * 修复替换词导致的冗余、重复、语境不适配等副作用
 */
function cleanupArtifacts(text) {
  if (!text) return text

  let result = text

  // 1. 重复动词：感觉+意识到 / 总觉得+觉得 / 看上去+看起来
  result = result.replace(/感觉意识到/g, '意识到')
  result = result.replace(/感觉察觉/g, '察觉')
  result = result.replace(/总觉得觉得/g, '总觉得')

  // 2. 重复连词/副词：到了到了 / 等等等等
  result = result.replace(/到了到了/g, '到了')
  result = result.replace(/(\S{1,3})\1{2,}/g, (m, p1) => {
    // 连续重复3次以上的非空白短词，保留1个
    return p1
  })

  // 3. 删除"八成是"残留（在任何体裁中都过于口语）
  result = result.replace(/八成是/g, '大概')
  result = result.replace(/跟……似的/g, '像')  // 全局回退，不该出现在文学文本中

  // 4. 残留的双重连接词
  result = result.replace(/总之总之/g, '总之')
  result = result.replace(/然而然而/g, '然而')

  // 5. 强制清理残留的朱雀标记
  const stubbornPatterns = [
    /声音之中/g, /目光之中/g, /空气之中/g,
    /淡淡地说/g, /冷冷地说/g, /缓缓地说/g, /轻声说道/g,
  ]
  for (const p of stubbornPatterns) {
    result = result.replace(p, (m) => {
      if (m === '声音之中') return '声音里'
      if (m === '目光之中') return '目光里'
      if (m === '空气之中') return '空气里'
      if (m === '淡淡地说') return '淡淡道'
      if (m === '冷冷地说') return '冷冷道'
      if (m === '缓缓地说') return '缓缓道'
      if (m === '轻声说道') return '轻声道'
      return m
    })
  }

  // 6. 修复替换链产生的残余错误
  result = result.replace(/道道/g, '道')
  result = result.replace(/淡淡地说道/g, '淡淡道')
  result = result.replace(/说实话地说/g, '说实话，')
  result = result.replace(/众人皆知/g, '天下皆知')
  result = result.replace(/人人都知道/g, '谁都清楚')
  result = result.replace(/愣住/g, '一呆')
  // 这一瞬间→瞬间被替换成"一眨眼"后产生"这一一眨眼"
  result = result.replace(/这一一眨眼/g, '转瞬间')
  result = result.replace(/这一转眼/g, '转瞬间')
  // 值得一提是→删除
  result = result.replace(/值得一提是/g, '')
  // 目光一凝一抹 → 目光一凝，一抹  |  眼底一沉复杂 → 眼底一沉，复杂
  result = result.replace(/(一[凝沉闪动])([一抹一丝一缕半点])/g, '$1，$2')
  result = result.replace(/(一[凝沉闪动])(\S)/g, (m, p1, p2) => {
    // 如果后面紧跟汉字不是标点，加逗号
    if (/[\u4e00-\u9fff]/.test(p2)) return p1 + '，' + p2
    return m
  })
  // 残留的孤立"地说" → 删除
  result = result.replace(/[，,]\s*地说/g, '，')
  result = result.replace(/。地说/g, '。')
  // "变了"后接汉字时补充逗号（眼中闪过→眼神变了/心思变了等），仅限替换链产生的上下文
  result = result.replace(/([眼神目面心思])(变了)([\u4e00-\u9fff])/g, '$1$2，$3')
  // 清理替换后残留的"，："和"：："相连标点
  result = result.replace(/[，,]+[：:]/g, '：')
  result = result.replace(/[：:]{2,}/g, '：')
  // 删除后段落开头残留逗号、引导词删除后残留 "但，"
  result = result.replace(/"\s*[，,]/g, '"')
  result = result.replace(/([但不过])([，,])/g, '$1')
  // 句号后紧跟逗号 → 只留句号
  result = result.replace(/[。！？][，,]/g, (m) => m[0])

  return result
}

/**
 * 统计AI味词汇密度（v2 增强版，含朱雀专项检查）
 */
function countAIFlavor(text) {
  if (!text) return {
    count: 0,
    density: 0,
    examples: [],
    // v2：分维度报告
    zhuqueConnectors: 0,    // 朱雀连接词命中数
    zhuqueFakeDepth: 0,     // 朱雀假深度命中数
    aiModifiers: 0,          // AI修饰词命中数
    dialogueTags: 0,         // 机械对话标签命中数
  }

  let count = 0
  const examples = []
  let zhuqueConnectors = 0
  let zhuqueFakeDepth = 0
  let aiModifiers = 0
  let dialogueTags = 0

  // 朱雀连接词模式
  const zhuqueConnectorPatterns = [
    /值得注意的是/g, /不可否认/g, /综上所述/g, /与此同时/g,
    /总而言之/g, /显而易见/g, /众所周知/g, /进一步来说/g,
    /从这个角度来看/g, /基于以上分析/g,
  ]
  for (const p of zhuqueConnectorPatterns) {
    const matches = text.match(p)
    if (matches) zhuqueConnectors += matches.length
  }

  // 朱雀假深度模式
  const zhuqueFakeDepthPatterns = [
    /他终于明白/g, /她这才意识到/g, /这一刻终于/g, /生活就是这样/g,
    /命运如此安排/g, /时间会给出答案/g,
  ]
  for (const p of zhuqueFakeDepthPatterns) {
    const matches = text.match(p)
    if (matches) zhuqueFakeDepth += matches.length
  }

  // AI修饰词
  const modifierPatterns = [
    /\b仿佛\b/g, /\b好像\b/g, /\b不禁\b/g, /\b微微\b/g,
    /\b眼中闪过\b/g, /\b一闪\b/g, /\b一抹\b/g,
  ]
  for (const p of modifierPatterns) {
    const matches = text.match(p)
    if (matches) aiModifiers += matches.length
  }

  // 机械对话标签
  const tagPatterns = [/\w+说道/g, /\w+淡淡地说/g, /\w+冷冷地说/g]
  for (const p of tagPatterns) {
    const matches = text.match(p)
    if (matches) dialogueTags += matches.length
  }

  // 全量检测
  for (const pattern of AI_PATTERNS) {
    const matches = text.match(pattern)
    if (matches) {
      count += matches.length
      examples.push(matches[0])
    }
  }

  return {
    count,
    density: text.length > 0 ? count / (text.length / 100) : 0,
    examples: [...new Set(examples)].slice(0, 10),
    zhuqueConnectors,
    zhuqueFakeDepth,
    aiModifiers,
    dialogueTags,
  }
}

/**
 * 标点符号修正
 */
function fixPunctuation(text) {
  if (!text) return text
  let result = text
  result = result.replace(/'([^']+)'/g, '「$1」')
  result = result.replace(/\s{2,}/g, ' ')
  result = result.replace(/([\u4e00-\u9fff]),(\s*[\u4e00-\u9fff])/g, '$1，$2')
  result = result.replace(/！{2,}/g, '！')
  result = result.replace(/？{2,}/g, '？')
  result = result.replace(/。{2,}/g, '。')
  result = result.replace(/[。！？]\s+[。！？]/g, (m) => m.trim())
  return result
}

/**
 * 段落节奏随机化（v2 新增核心功能）
 * 针对朱雀检测"段落长度均匀性"特征：
 * 1. 合并某些相邻短段落为中等段落
 * 2. 拆分某些长段落为短段落+极短句
 * 3. 在合适位置插入节奏打断句
 */
/**
 * v4 段落节奏随机化（更激进）
 * 核心目标：彻底打破AI的段落均匀性
 */
function randomizeParagraphRhythm(paragraphs) {
  if (!paragraphs || paragraphs.length < 3) return paragraphs

  const result = []
  let i = 0

  while (i < paragraphs.length) {
    const para = paragraphs[i]

    // 策略1：短段合并（<60字的连续短段，70%概率合并）
    if (i + 1 < paragraphs.length &&
        para.length < 60 &&
        paragraphs[i + 1].length < 100 &&
        Math.random() > 0.3) {
      result.push(para + '\n' + paragraphs[i + 1])
      i += 2
      continue
    }

    // 策略2：长段激进拆分（>250字，60%概率拆分）
    if (para.length > 250 && Math.random() > 0.4) {
      const sentences = para.split(/(?<=[。！？…])/g).filter(s => s.trim())
      if (sentences.length >= 3) {
        // 随机选择拆分点，可能在1/3处或2/3处
        const splitPoint = Math.floor(sentences.length * (0.3 + Math.random() * 0.4))
        const firstPart = sentences.slice(0, splitPoint).join('')
        const secondPart = sentences.slice(splitPoint).join('')

        // 在拆分处插入极短句
        const breakers = [
          '他愣住。', '完了。', '不对。', '妈的。', '行。',
          '啧。', '有意思。', '然后呢。', '没戏。', '死定了。',
          '算了。', '得了。', '爱咋咋地。', '想那么多干嘛。',
        ]
        const breaker = breakers[Math.floor(Math.random() * breakers.length)]

        result.push(firstPart)
        result.push(breaker)
        result.push(secondPart)
        i++
        continue
      }
    }

    // 策略3：中段随机插入极短段落（80-250字，25%概率）
    if (para.length >= 80 && para.length <= 250 && Math.random() > 0.75) {
      const breakers = [
        '他愣住了。', '完了。', '真的。', '来不及了。', '这——',
        '行吧。', '无所谓了。', '就这样吧。',
      ]
      const breaker = breakers[Math.floor(Math.random() * breakers.length)]
      result.push(para)
      result.push(breaker)
      i++
      continue
    }

    result.push(para)
    i++
  }

  return result
}

/**
 * 自动格式化章节文本：分段 + 首行缩进 + 段落间距 + 段落节奏随机化
 */
function autoFormat(text) {
  if (!text || text.length < 20) return text

  let processed = text
  processed = processed.replace(/\r\n/g, '\n')
  processed = processed.replace(/\n{3,}/g, '\n\n')

  let paragraphs = processed.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0)

  if (paragraphs.length <= 1 && processed.length > 300) {
    if (processed.includes('\n')) {
      paragraphs = processed.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0)
    }
  }

  if (paragraphs.length <= 1 && processed.length > 300) {
    paragraphs = smartSplitParagraphs(processed)
  }

  if (paragraphs.length === 0) {
    paragraphs = [processed.trim()]
  }

  // v2：段落节奏随机化
  const randomized = randomizeParagraphRhythm(paragraphs)

  const formatted = randomized.map(p => {
    if (p.startsWith('\u3000\u3000')) return p
    return '\u3000\u3000' + p.trim()
  })

  return formatted.join('\n\n')
}

/**
 * 智能将无分段的长文本拆分为段落
 */
function smartSplitParagraphs(text) {
  if (!text || text.length < 100) return [text.trim()]

  const segments = []
  const raw = text.trim()
  let buffer = ''
  let i = 0

  while (i < raw.length) {
    buffer += raw[i]
    const isEnd = /[。！？…」』」\n]/.test(raw[i])
    if (isEnd && buffer.length >= 120) {
      segments.push(buffer.trim())
      buffer = ''
    } else if (buffer.length >= 400) {
      segments.push(buffer.trim())
      buffer = ''
    }
    i++
  }

  if (buffer.trim()) {
    if (segments.length > 0 && buffer.trim().length < 60) {
      segments[segments.length - 1] += buffer
    } else {
      segments.push(buffer.trim())
    }
  }

  return segments.length > 0 ? segments : [text.trim()]
}

/**
 * 完整后处理流水线（v2）
 * @param {string} text - 原始章节内容
 * @param {Object} options - 配置项
 * @param {boolean} options.doDeAI - 是否执行去AI味
 * @param {boolean} options.doPunctuation - 是否执行标点修正
 * @param {boolean} options.doAutoFormat - 是否执行自动格式化
 * @param {boolean} options.doRhythmRandomize - 是否执行段落节奏随机化（v2新增）
 * @param {string}  options.genre - 体裁（v3新增），xianxia/wuxia/gufeng 触发体裁感知替换
 * @returns {{ text: string, report: Object }}
 */
function processChapter(text, options = {}) {
  const { doDeAI = true, doPunctuation = true, doAutoFormat = true, doRhythmRandomize = true, doHumanize = true, genre = '' } = options
  if (!text) return { text: '', report: {} }

  let processed = text
  const report = {
    originalLength: text.length,
    deAICount: 0,
    punctuationFixes: 0,
    formatted: false,
    rhythmChanges: 0,
    zhuqueCleared: 0,
    humanizeChanges: 0,
  }

  // Step 1: AI味检测（v2：含朱雀专项报告）
  const aiFlavor = countAIFlavor(text)
  report.aiFlavorBefore = aiFlavor

  // Step 2: 去AI味 — v2使用智能替换
  const shouldDeAI = aiFlavor.density > 0.3 ||
                     (aiFlavor.zhuqueConnectors !== undefined && aiFlavor.zhuqueConnectors >= 1) ||
                     (aiFlavor.zhuqueFakeDepth !== undefined && aiFlavor.zhuqueFakeDepth >= 1)

  if (doDeAI && shouldDeAI) {
    const before = processed.length
    processed = smartDeAIfy(processed, genre)
    report.deAICount = before - processed.length
    report.zhuqueCleared = (aiFlavor.zhuqueConnectors || 0) + (aiFlavor.zhuqueFakeDepth || 0)
  }

  // Step 2.5: v3 人味注入（在去AI味之后、标点修正之前）
  if (doHumanize && processed.length > 300) {
    const before = processed
    processed = humanizeText(processed)
    report.humanizeChanges = processed.length - before.length
  }

  // Step 3: 标点修正
  if (doPunctuation) {
    const before = processed.length
    processed = fixPunctuation(processed)
    report.punctuationFixes = processed.length - before
  }

  // Step 4: 自动格式化 + 段落节奏随机化
  if (doAutoFormat) {
    const before = processed
    processed = autoFormat(processed)
    report.formatted = (processed !== before)
    report.rhythmChanges = doRhythmRandomize ? 1 : 0
  }

  // Step 5: 再次检测AI味（含朱雀报告）
  const aiFlavorAfter = countAIFlavor(processed)
  report.aiFlavorAfter = aiFlavorAfter

  return { text: processed, report }
}

/**
 * 章节质量评分（v2：增加朱雀维度）
 */
function qualityScore(text) {
  if (!text || text.length < 50) return 0

  let score = 70
  const deductions = []

  if (text.length < 300) { score -= 20; deductions.push('章节过短') }
  else if (text.length < 800) { score -= 10; deductions.push('章节偏短') }
  else if (text.length > 5000) { score += 5; deductions.push('章节充实') }

  const ai = countAIFlavor(text)

  // v2：分层扣分
  if (ai.density > 1) { score -= 15; deductions.push('AI味过重') }
  else if (ai.density > 0.5) { score -= 8; deductions.push('AI味偏重') }

  // 朱雀专项扣分
  if (ai.zhuqueConnectors >= 3) { score -= 12; deductions.push('朱雀连接词过密(≥3)') }
  else if (ai.zhuqueConnectors >= 1) { score -= 5; deductions.push('含朱雀标记连接词') }

  if (ai.zhuqueFakeDepth >= 2) { score -= 10; deductions.push('朱雀假深度句过多(≥2)') }
  else if (ai.zhuqueFakeDepth >= 1) { score -= 4; deductions.push('含朱雀假深度句') }

  if (ai.dialogueTags >= 5) { score -= 8; deductions.push('机械对话标签过密') }

  const dialogCount = (text.match(/[""「」『』]/g) || []).length
  const dialogRatio = dialogCount / (text.length / 100)
  if (dialogRatio < 0.1 && text.length > 500) { score -= 5; deductions.push('对话偏少') }
  else if (dialogRatio > 2) { score += 5; deductions.push('对话丰富') }

  const paragraphs = text.split(/\n+/).filter(p => p.trim().length > 20)
  if (paragraphs.length > 0) {
    const avgParaLen = paragraphs.reduce((s, p) => s + p.length, 0) / paragraphs.length
    if (avgParaLen > 500 && text.length > 1000) { score -= 8; deductions.push('段落过长') }

    // v2：段落长度均匀性检测（朱雀核心特征）
    if (paragraphs.length >= 5) {
      const lengths = paragraphs.map(p => p.length)
      const mean = lengths.reduce((s, l) => s + l, 0) / lengths.length
      const variance = lengths.reduce((s, l) => s + Math.pow(l - mean, 2), 0) / lengths.length
      const cv = Math.sqrt(variance) / mean // 变异系数

      // 变异系数 < 0.3 表示段落长度过于均匀（AI特征）
      if (cv < 0.3 && text.length > 1000) {
        score -= 10
        deductions.push('段落长度过于均匀(AI特征)')
      }
    }
  }

  return {
    score: Math.max(10, Math.min(100, score)),
    deductions,
    aiDensity: ai.density.toFixed(1),
    // v2 新增
    zhuqueConnectors: ai.zhuqueConnectors,
    zhuqueFakeDepth: ai.zhuqueFakeDepth,
    dialogueTags: ai.dialogueTags,
  }
}

/**
 * v3 核心：人味注入后处理
 * 针对朱雀检测三大维度（语义熵值、句式多样性、情感波动曲线）进行后处理级别的改造
 * 与 smartDeAIfy 的区别：smartDeAIfy 是"去AI味"（删除/替换），humanizeText 是"加人味"（注入人类特征）
 */

// 人味注入素材库
const HUMANIZE_MATERIALS = {
  // 角色走神/联想素材（插入叙事中）
  tangentialThoughts: [
    '（说起来，他昨天晚饭吃的什么来着？）',
    '——这让他莫名想起小时候的一件事，不过现在不是回忆的时候。',
    '（奇怪，怎么突然想到这个。）',
    '他走神了一秒。窗外有只鸟叫得特别大声。',
    '（话说回来，这事其实挺离谱的。）',
    '也不知道为什么，他脑子里突然蹦出一个完全不相关的画面。',
  ],
  // 叙述者吐槽/旁白（插入叙述中）
  narratorAsides: [
    '——别问为什么，问就是离谱。',
    '（这个操作说实话有点迷。）',
    '——后面的事情证明他这个决定是对的，但当时谁也看不出来。',
    '（当然，这是后话了。）',
    '——事情到这里其实还没完。',
    '（讲真，换谁都会懵。）',
  ],
  // 句子碎片化结尾（替代完整句）
  fragmentEndings: [
    '……算了。',
    '……无所谓了。',
    '就这样吧。',
    '得了。',
    '爱咋咋地。',
    '想那么多干嘛。',
    '行吧。',
  ],
  // 情绪突变过渡句
  moodShiftTransitions: [
    '不过话说回来——',
    '但这都不重要了。',
    '他懒得再想这些。',
    '算了，先不管了。',
    '想这些有什么用。',
    '他摇了摇头，把念头甩掉。',
  ],
  // 口语化连接词（替代书面连接词）
  colloquialConnectors: [
    '话说回来，', '说白了，', '讲真，', '老实讲，',
    '你猜怎么着——', '对了，', '哦对，', '嗯……',
    '反正吧，', '其实吧，', '怎么说呢，', '这么跟你说吧，',
  ],
}

/**
 * 检测并修复重复的句首模式
 * AI 生成的文本经常连续多句以"他/她/这/那"开头
 */
function fixRepetitiveSentenceOpenings(text) {
  if (!text) return text
  const lines = text.split('\n')
  const result = []
  let lastOpening = ''
  let repeatCount = 0

  for (const line of lines) {
    if (!line.trim()) { result.push(line); continue }
    // 提取句首前2个字符
    const opening = line.trim().replace(/[\s""''「『（(]*/g, '').substring(0, 2)

    if (opening === lastOpening && opening.length > 0) {
      repeatCount++
      if (repeatCount >= 2) {
        // 连续3句相同开头，对中间那句做变换
        const prefixes = ['其实', '话说', '嗯，', '——', '倒是']
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)]
        result[result.length - 1] = prefix + line.trim().substring(0) // 在前一句加前缀
      }
    } else {
      repeatCount = 0
    }
    lastOpening = opening
    result.push(line)
  }
  return result.join('\n')
}

/**
 * 在适当位置注入人味元素
 * 策略：低频、随机、不破坏叙事
 */
function injectHumanElements(text) {
  if (!text || text.length < 200) return text

  const paragraphs = text.split(/\n\n+/).filter(p => p.trim())
  const result = []
  let lastInjection = -5 // 控制注入间隔，至少隔4段

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]
    result.push(para)

    // 不在开头和结尾段注入
    if (i < 1 || i >= paragraphs.length - 1) continue
    // 控制注入频率：每 2000-4000 字注入一次
    if (i - lastInjection < 3) continue
    // 长段落才注入（短段落注入会显得突兀）
    if (para.length < 150) continue
    // 随机概率
    if (Math.random() > 0.35) continue

    // 根据段落内容选择合适的注入方式
    const hasDialogue = /[""''「」]/.test(para)
    const isNarration = !hasDialogue && para.length > 100

    if (isNarration && Math.random() > 0.5) {
      // 叙述段落：在后面加一个走神/旁白
      const material = HUMANIZE_MATERIALS.tangentialThoughts[
        Math.floor(Math.random() * HUMANIZE_MATERIALS.tangentialThoughts.length)
      ]
      result.push(material)
      lastInjection = i
    } else if (hasDialogue && Math.random() > 0.6) {
      // 对话段落：在后面加一个叙述者吐槽
      const aside = HUMANIZE_MATERIALS.narratorAsides[
        Math.floor(Math.random() * HUMANIZE_MATERIALS.narratorAsides.length)
      ]
      result.push(aside)
      lastInjection = i
    }
  }

  return result.join('\n\n')
}

/**
 * 打破段落结尾的"完美收束"感
 * AI 喜欢用总结性句子结尾，人类更多是戛然而止
 */
function breakPerfectEndings(text) {
  if (!text) return text
  const paragraphs = text.split(/\n\n+/)

  return paragraphs.map((para, idx) => {
    if (!para.trim() || idx === 0) return para

    // 检测"升华式"结尾并替换
    const sublimationPatterns = [
      /或许 [，这].*[就是].*[。]?$/,
      /这 [，就]?是.*[的意义].*[。]?$/,
      /生活.*[就是如此].*[。]?$/,
      /也许.*[才？是].*[真谛].*[。]?$/,
      /原来.*[一直].*[。]?$/,
    ]
    
    for (const pattern of sublimationPatterns) {
      if (pattern.test(para.trim())) {
        // 用更口语化的碎片结尾替代
        const fragment = HUMANIZE_MATERIALS.fragmentEndings[
          Math.floor(Math.random() * HUMANIZE_MATERIALS.fragmentEndings.length)
        ]
        // 保留段落主体，只替换结尾
        const sentences = para.split(/(?<=[。！？…])/)
        if (sentences.length > 2) {
          sentences[sentences.length - 1] = fragment
          return sentences.join('')
        }
      }
    }

    return para
  }).join('\n\n')
}

/**
 * 增加对话的碎片感和真实感
 * 在连续对话中插入动作描写、停顿、打断
 */
function fragmentizeDialogue(text) {
  if (!text) return text

  // 检测连续对话（3句以上连续的引号内容）
  const dialoguePattern = /([""「」『』][^""「」『』]*[""「」『』]\s*){3,}/g
  const matches = text.match(dialoguePattern)
  if (!matches) return text

  let result = text

  // 对部分对话添加动作插入
  const actionInsertions = [
    '他顿了一下，',
    '她看了他一眼，',
    '他挠了挠头，',
    '她没抬头，',
    '他叹了口气，',
    '',  // 有时不加
  ]

  // 随机在一些对话标签后插入动作
  result = result.replace(/(\w{1,4})(说道|淡淡地说|冷冷地说|轻声说|缓缓说)/g, (match, name, verb) => {
    if (Math.random() > 0.5) {
      const action = actionInsertions[Math.floor(Math.random() * actionInsertions.length)]
      return action ? name + action.replace(/，$/, '') : '"'
    }
    return match
  })

  return result
}

/**
 * 完整的人味注入流水线（v3 核心）
 * 在 smartDeAIfy 之后调用，负责"加人味"而非"去AI味"
 */
function humanizeText(text, options = {}) {
  if (!text || text.length < 300) return text
  const { doTangentialInjection = true, doEndingBreak = true, doDialogueFragment = true, doOpeningFix = true } = options

  let result = text

  // Step 1: 修复重复句首
  if (doOpeningFix) {
    result = fixRepetitiveSentenceOpenings(result)
  }

  // Step 2: 注入走神/旁白等人类特征
  if (doTangentialInjection) {
    result = injectHumanElements(result)
  }

  // Step 3: 打破完美结尾
  if (doEndingBreak) {
    result = breakPerfectEndings(result)
  }

  // Step 4: 对话碎片化
  if (doDialogueFragment) {
    result = fragmentizeDialogue(result)
  }

  return result
}

module.exports = {
  processChapter,
  qualityScore,
  countAIFlavor,
  smartDeAIfy,
  simpleDeAIfy: smartDeAIfy,
  cleanupArtifacts,
  fixPunctuation,
  randomizeParagraphRhythm,
  humanizeText,               // v3 新增：人味注入后处理
  fixRepetitiveSentenceOpenings, // v3 新增：修复重复句首
  injectHumanElements,         // v3 新增：注入走神/旁白
  breakPerfectEndings,         // v3 新增：打破完美结尾
  fragmentizeDialogue,         // v3 新增：对话碎片化
}
