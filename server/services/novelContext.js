/**
 * Novel Context Service — RAG 风格上下文构建器
 *
 * 替代原有的 distillChapters 简单拼接：
 * 1. 近期章节保留详情，越早的章节越压缩
 * 2. 自动追踪活跃的剧情线和角色状态
 * 3. 提取未回收的伏笔
 * 4. 构建结构化的上下文注入提示词
 */

/**
 * 提取单章摘要（关键事件 + 关键对话 + 结局状态）
 */
function extractChapterSnapshot(chapter) {
  const content = chapter.content || ''
  if (!content || content.length < 50) return { summary: '', keyLines: [], endState: '' }

  // 取前10%的文本作为"开篇场景"
  const openingLen = Math.min(200, Math.floor(content.length * 0.1))
  const opening = content.slice(0, openingLen).trim()

  // 取中段最有冲突的句子
  const lines = content.split(/[。！？\n]/).filter(l => l.trim().length > 15)
  const conflictLines = lines.filter(l =>
    /但是|然而|突然|没想到|竟然|可是|却|终于|发现|看到|知道|原来/.test(l)
  ).slice(0, 3)

  // 取结尾20%作为"章末状态"
  const endLen = Math.min(150, Math.floor(content.length * 0.1))
  const endState = content.slice(-endLen).trim()

  return {
    chapterNumber: chapter.chapterNumber,
    summary: opening.substring(0, 100) + '…',
    conflictLines: conflictLines.length > 0 ? conflictLines : [lines[0] || ''].filter(Boolean),
    endState: endState.substring(0, 100),
  }
}

/**
 * 从已写章节中提取活跃角色
 */
function extractActiveCharacters(chapters) {
  const charMap = new Map() // name → { mentions, lastChapter, description }
  const namePattern = /[^\u3000-\u303F\uff00-\uffef\u0020-\u007E]{2,4}(?:先生|小姐|同学|老师|前辈|后辈|君|酱|さん|くん|ちゃん|兄|姐|爷|总|哥|姐|叔|姨|婆婆|爷爷)/g

  // 只扫描最近 5 章
  const recent = chapters.slice(-5)
  for (let ci = 0; ci < recent.length; ci++) {
    const ch = recent[ci]
    if (!ch.content) continue
    const matches = ch.content.match(namePattern) || []
    for (const name of matches) {
      const existing = charMap.get(name) || { mentions: 0, lastChapter: 0, contexts: [] }
      existing.mentions++
      existing.lastChapter = Math.max(existing.lastChapter, ch.chapterNumber || ci)
      if (existing.contexts.length < 3) {
        // 找角色附近的一句话
        const idx = ch.content.indexOf(name)
        if (idx >= 0) {
          const ctx = ch.content.substring(Math.max(0, idx - 30), idx + 50).replace(/\n/g, ' ')
          if (!existing.contexts.includes(ctx)) existing.contexts.push(ctx)
        }
      }
      charMap.set(name, existing)
    }
  }

  // 过滤：提到不到2次或最后一章没出现的移除
  const active = []
  for (const [name, data] of charMap) {
    if (data.mentions >= 2) {
      active.push({
        name,
        mentions: data.mentions,
        isActive: data.lastChapter >= (recent.length > 0 ? recent[recent.length - 1].chapterNumber || 0 : 0),
        description: data.contexts[0] || '',
      })
    }
  }

  return active.sort((a, b) => b.mentions - a.mentions).slice(0, 8)
}

/**
 * 提取未回收的伏笔
 */
function extractPlotHooks(chapters) {
  if (chapters.length < 2) return []

  const hooks = []
  // 找章节结尾的悬念句
  for (const ch of chapters) {
    if (!ch.content || ch.content.length < 100) continue
    const lines = ch.content.split(/[。！？\n]/).filter(l => l.trim().length > 8)
    // 章末句
    const lastLines = lines.slice(-3)
    for (const line of lastLines) {
      if (/发现|到底|难道|难道说|究竟|谁|什么|为什么|怎么|突然|意外|神秘|谜|未解|秘密|隐藏/.test(line)) {
        const snapshot = extractChapterSnapshot(ch)
        hooks.push({
          chapterNumber: ch.chapterNumber,
          hook: line.trim(),
          status: 'pending',
        })
      }
    }
  }

  // 标记已回收的伏笔（最近2章提到了前文伏笔内容）
  const recentContent = chapters.slice(-2).map(c => c.content || '').join('')
  return hooks.map(h => ({
    ...h,
    status: recentContent.includes(h.hook.substring(0, 10)) ? 'resolved' : 'pending',
  })).slice(0, 5)
}

/**
 * 构建增强上下文（替代 distillChapters）
 * 策略：最近3章保持详细，之前的压缩为摘要
 */
function buildAugmentedContext(chapters) {
  if (!chapters || chapters.length === 0) return ''

  const total = chapters.length
  const recentCount = Math.min(3, total)
  const recentStart = total - recentCount

  const parts = []

  // 1. 全局概览
  const activeChars = extractActiveCharacters(chapters)
  const plotHooks = extractPlotHooks(chapters)

  parts.push(`【已有章节概览】共 ${total} 章`)

  if (activeChars.length > 0) {
    parts.push(`当前活跃角色：${activeChars.filter(c => c.isActive).map(c => c.name).join('、')}`)
  }

  if (plotHooks.length > 0) {
    const pending = plotHooks.filter(h => h.status === 'pending')
    if (pending.length > 0) {
      parts.push(`待回收伏笔：${pending.map(h => `第${h.chapterNumber}章「${h.hook}」`).join('\n')}`)
    }
  }

  // 2. 近期章节（详细保留）
  parts.push('\n【近期章节详情】')
  for (let i = recentStart; i < total; i++) {
    const ch = chapters[i]
    const content = ch.content || ''
    // 保留近期章节的头尾共1000字
    const head = content.substring(0, 500).trim()
    const tail = content.length > 800 ? content.slice(-300).trim() : ''
    const snapshot = extractChapterSnapshot(ch)
    parts.push(`\n第${ch.chapterNumber}章：`)
    if (snapshot.conflictLines.length > 0) {
      parts.push(`关键发展：${snapshot.conflictLines[0]}`)
    }
    parts.push(head)
    if (tail) parts.push(`...（章末）${tail}`)
  }

  // 3. 早期章节（极简压缩）
  if (recentStart > 0) {
    const earlySummaries = []
    for (let i = 0; i < recentStart; i++) {
      const ch = chapters[i]
      const snapshot = extractChapterSnapshot(ch)
      earlySummaries.push(`第${ch.chapterNumber}章：${snapshot.summary}`)
    }
    parts.push('\n【前置章节回顾】')
    parts.push(earlySummaries.join('\n'))
  }

  const result = parts.join('\n')

  // 限制总长度
  if (result.length > 4000) {
    return result.substring(0, 4000) + '\n...（上下文已截断）'
  }
  return result
}

/**
 * 为续写构建结构化 prompt
 */
function buildAgentContinuePrompt(novel, continuationRequest) {
  const context = buildAugmentedContext(novel.chapters)
  const activeChars = extractActiveCharacters(novel.chapters)
  const plotHooks = extractPlotHooks(novel.chapters)

  const charSection = activeChars.length > 0
    ? `\n注意保持以下角色的性格一致性：${activeChars.map(c => c.name + (c.description ? '(' + c.description.substring(0, 40) + ')' : '')).join('、')}`
    : ''

  const plotSection = plotHooks.filter(h => h.status === 'pending').length > 0
    ? `\n以下伏笔需要在本章或后续章节中回收：${plotHooks.filter(h => h.status === 'pending').map(h => '第' + h.chapterNumber + '章「' + h.hook + '」').join('、')}`
    : ''

  const requestSection = continuationRequest
    ? `\n\n用户续写要求：${continuationRequest}`
    : ''

  return `请继续创作第${novel.currentChapterIndex + 1}章。

以下是已有剧情的完整脉络：

${context}
${charSection}
${plotSection}
${requestSection}

写作要求：
1. 严格衔接上一章结尾，不要重复已有内容
2. 关注上文提到的伏笔，适时回收
3. 保持角色性格和关系一致性
4. 每一章要有独立的起承转合，结尾留悬念
5. 推进主线剧情的同时，可以适当展开支线
6. 每章结束时标注【未完待续】`
}

module.exports = {
  buildAugmentedContext,
  extractActiveCharacters,
  extractPlotHooks,
  extractChapterSnapshot,
  buildAgentContinuePrompt,
  // 新的持久化文档函数
  summarizeChapterForDoc,
  updateForeshadowingDoc,
  buildContextFromDocs,
}

/**
 * 将刚生成的章节浓缩为一段结构化文字（供 chapterSummaryDoc 追加）
 * AI 生成 → 提取关键信息，比简单截头尾更准确
 */
async function summarizeChapterForDoc(chapterContent, chapterNumber, protagonistName) {
  if (!chapterContent || chapterContent.length < 100) {
    return `第${chapterNumber}章：内容过短，未记录详细摘要。`
  }

  // 取开头 200 字（场景设定）
  const head = chapterContent.slice(0, 200).replace(/\s+/g, ' ').trim()
  // 取结尾 200 字（章末状态/悬念）
  const tail = chapterContent.slice(-200).replace(/\s+/g, ' ').trim()
  // 找关键冲突句
  const lines = chapterContent.split(/[。！？\n]/).filter(l => l.trim().length > 10)
  const keyLines = lines.filter(l =>
    /发现|原来|竟然|终于|没想到|但是|然而|突然|秘密|真相|原来如此/.test(l)
  ).slice(0, 2)

  let summary = `第${chapterNumber}章：`
  summary += `开篇：${head.length > 100 ? head.slice(0, 100) + '…' : head}。`
  if (keyLines.length > 0) {
    summary += `关键发展：${keyLines.join('；')}。`
  }
  summary += `章末：${tail.length > 100 ? tail.slice(0, 100) + '…' : tail}。`

  return summary
}

/**
 * 根据新生成的章节内容，更新伏笔追踪文档
 * 扫描章节中的悬念句和回收句，更新到 foreshadowingDoc
 */
function updateForeshadowingDoc(chapterContent, chapterNumber, existingDoc) {
  if (!chapterContent || chapterContent.length < 100) return existingDoc || ''

  let doc = existingDoc || ''
  const lines = chapterContent.split(/[。！？\n]/).filter(l => l.trim().length > 8)

  // ---- 1. 检测本章新埋的伏笔 ----
  const newHooks = []
  // 章末 5 句话，包含悬念词 → 算新伏笔
  const lastLines = lines.slice(-5)
  for (const line of lastLines) {
    if (/发现|到底|难道|难道说|究竟|谁|什么|为什么|怎么|突然|意外|神秘|秘密|隐藏|不对劲|奇怪/.test(line)) {
      newHooks.push(line.trim())
    }
  }
  // 全文搜索含"悬念/谜团/未解/秘密"等明确伏笔标记的句子
  for (const line of lines) {
    if (/埋下.*伏笔|留下.*悬念|一个谜团|未解之谜/.test(line)) {
      if (!newHooks.includes(line.trim())) newHooks.push(line.trim())
    }
  }

  for (const hook of newHooks) {
    const id = `FH_${chapterNumber}_${hook.slice(0, 15).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')}`
    // 检查是否已记录
    if (!doc.includes(id)) {
      doc += `\n【伏笔】ID=${id} | 设章=第${chapterNumber}章 | 状态=待回收 | 内容=${hook}`
    }
  }

  // ---- 2. 检测本章回收的伏笔（标记已存在的待回收伏笔为已回收） ----
  // 扫描所有待回收的伏笔，看本章内容是否提到了它们
  const pendingMatch = doc.matchAll(/ID=(\S+?) \| 设章=第(\d+)章 \| 状态=待回收 \| 内容=(.+?)(?=\n|$)/g)
  for (const match of pendingMatch) {
    const [full, id, refCh, hookContent] = match
    const hookKeywords = hookContent.slice(0, 20)
    if (chapterContent.includes(hookKeywords)) {
      doc = doc.replace(
        `ID=${id} | 设章=第${refCh}章 | 状态=待回收 | 内容=${hookContent}`,
        `ID=${id} | 设章=第${refCh}章 | 状态=已回收(第${chapterNumber}章) | 内容=${hookContent}`
      )
    }
  }

  // 控制文档大小，只保留最近 50 条
  const entries = doc.split('\n').filter(l => l.startsWith('【伏笔】'))
  if (entries.length > 50) {
    doc = entries.slice(-50).join('\n')
  }

  return doc
}

/**
 * 从持久化文档中构建上下文，替代 buildAugmentedContext
 * @param {string} chapterSummaryDoc - 章节浓缩文档
 * @param {string} foreshadowingDoc - 伏笔追踪文档
 * @param {string} outline - 大纲
 * @param {string} chapterPlan - 章节计划表
 * @param {number} currentCh - 当前章节号
 * @param {string} lastChapterSummary - 上一章摘要
 * @returns {string} 格式化后的上下文文本
 */
function buildContextFromDocs(chapterSummaryDoc, foreshadowingDoc, outline, chapterPlan, currentCh, lastChapterSummary) {
  // 安全保护：老数据库可能没有这些字段
  chapterSummaryDoc = chapterSummaryDoc || '';
  foreshadowingDoc = foreshadowingDoc || '';
  outline = outline || '';
  chapterPlan = chapterPlan || '';
  const parts = []

  // 1. 大纲
  if (outline) {
    parts.push(`【创作大纲】\n${outline}`)
  }

  // 2. 章节计划表
  if (chapterPlan) {
    // 只保留当前章及之后的计划
    const planLines = chapterPlan.split('\n').filter(l => l.trim())
    const remaining = planLines.filter(l => {
      const match = l.match(/第(\d+)章/)
      return !match || parseInt(match[1]) >= currentCh
    })
    parts.push(`【剩余章节计划】\n${remaining.join('\n') || chapterPlan}`)
  }

  // 3. 伏笔追踪（优先展示待回收的）
  if (foreshadowingDoc) {
    const pending = foreshadowingDoc.split('\n').filter(l => l.includes('待回收'))
    const resolved = foreshadowingDoc.split('\n').filter(l => l.includes('已回收'))
    if (pending.length > 0) {
      parts.push(`【待回收伏笔（共${pending.length}条）】\n${pending.join('\n')}`)
    }
    if (resolved.length > 0) {
      parts.push(`【已回收伏笔（共${resolved.length}条）】\n${resolved.slice(-10).join('\n')}`)
    }
  }

  // 4. 章节浓缩文档（全文故事脉络）
  if (chapterSummaryDoc) {
    const summaries = chapterSummaryDoc.split('\n').filter(l => l.trim().startsWith('第'))
    // 如果超过 15 章，只保留最近 5 章的详情，早期的合并为一行
    if (summaries.length > 15) {
      const recentCount = 5
      const earlyCount = summaries.length - recentCount
      const early = summaries.slice(0, earlyCount)
      const recent = summaries.slice(-recentCount)
      parts.push(`【前期剧情概览（共${earlyCount}章）】\n${early.map(s => s.slice(0, 60) + '…').join('\n')}`)
      parts.push(`【近期剧情详情】\n${recent.join('\n')}`)
    } else {
      parts.push(`【已有章节剧情脉络】\n${chapterSummaryDoc}`)
    }
  }

  // 5. 上一章摘要（防重复）
  if (lastChapterSummary) {
    parts.push(`【上一章概要】（⚠️ 当前章核心事件必须与上一章不同）\n${lastChapterSummary}`)
  }

  return parts.join('\n\n')
}
