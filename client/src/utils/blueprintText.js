const FALLBACK = {
  mainArc: '故事主线', lockedFacts: '不可改写的设定', tagChecklist: '全书标签清单', phases: '全书级篇章',
  phase: '大篇章', subphase: '小阶段', rolling: '滚动执行蓝图', rollingChapter: '执行章',
  chapterRange: '第 {start}-{end} 章', goal: '阶段目标', obstacle: '主要阻力', reversal: '关键反转',
  threads: '支线与人物关系', tags: '标签兑现', characters: '人物推进与声线', scenes: '必备场景',
  forbidden: '禁止漂移', entry: '进入条件', exit: '离开条件', foreshadowing: '伏笔计划', unresolved: '未决问题',
  windowObjective: '窗口目标', chapterPurpose: '章节目的', relationship: '关系变化',
  foreshadowingActions: '伏笔动作', exitHook: '章末钩子', character: '角色', conflict: '冲突', change: '变化',
  voice: '声线', setup: '埋设', progress: '推进', payoff: '回收', plan: '安排', none: '暂无', untitled: '未命名阶段',
}

function tr(t, key, fallback, params) {
  if (typeof t !== 'function') return fallback
  const value = t(`generate.blueprintText${key}`, params)
  return !value || value === `generate.blueprintText${key}` ? fallback : value
}

function labels(t) {
  return Object.fromEntries(Object.entries(FALLBACK).map(([key, value]) => [key, tr(t, key[0].toUpperCase() + key.slice(1), value)]))
}

function oneLine(value) { return String(value || '').replace(/[\r\n]+/g, ' ').trim() }
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : [] }
function pushList(lines, label, values, none) {
  lines.push(`${label}：`)
  if (list(values).length) list(values).forEach((item) => lines.push(`- ${oneLine(item)}`))
  else lines.push(`- ${none}`)
}
function rangeText(t, start, end) {
  const fallback = `第 ${start}-${end} 章`
  const value = typeof t === 'function' ? t('generate.blueprintTextChapterRange', { start, end }) : fallback
  return !value || value === 'generate.blueprintTextChapterRange' ? fallback : value
}
function formatCharacterBeat(beat, l) {
  if (typeof beat === 'string') return beat
  return [oneLine(beat?.character) || l.character, `${l.goal}=${oneLine(beat?.goal) || l.none}`, `${l.conflict}=${oneLine(beat?.conflict) || l.none}`, `${l.change}=${oneLine(beat?.change) || l.none}`, `${l.voice}=${oneLine(beat?.voiceGuard) || l.none}`].join('｜')
}
function formatForeshadowing(item, l) {
  if (typeof item === 'string') return item
  return [oneLine(item?.name) || l.untitled, `${l.setup}=${Number(item?.setupChapter) || 0}`, `${l.progress}=${list(item?.progressChapters).join(',') || 0}`, `${l.payoff}=${Number(item?.payoffChapter) || 0}`, `${l.plan}=${oneLine(item?.plan) || l.none}`].join('｜')
}
function pushStage(lines, stage, heading, l) {
  lines.push('', `【${heading}】`)
  lines.push(`${l.goal}：${oneLine(stage?.goal) || l.none}`)
  lines.push(`${l.obstacle}：${oneLine(stage?.obstacle) || l.none}`)
  lines.push(`${l.reversal}：${oneLine(stage?.reversal) || l.none}`)
  lines.push(`${l.entry}：${oneLine(stage?.entryCondition) || l.none}`)
  lines.push(`${l.exit}：${oneLine(stage?.exitCondition) || l.none}`)
  pushList(lines, l.threads, stage?.threads, l.none)
  pushList(lines, l.tags, stage?.tagCommitments, l.none)
  pushList(lines, l.characters, list(stage?.characterBeats).map((item) => formatCharacterBeat(item, l)), l.none)
  pushList(lines, l.scenes, stage?.requiredScenes, l.none)
  pushList(lines, l.forbidden, stage?.forbiddenDrift, l.none)
  pushList(lines, l.foreshadowing, list(stage?.foreshadowing).map((item) => formatForeshadowing(item, l)), l.none)
  pushList(lines, l.unresolved, stage?.unresolvedQuestions, l.none)
}

/** Convert backend JSON into one readable, editable three-level blueprint document. */
export function formatBlueprintText(blueprint, t) {
  if (!blueprint || typeof blueprint !== 'object') return ''
  const l = labels(t)
  const lines = [`【${l.mainArc}】`, String(blueprint.mainArc || l.none).trim(), '', `【${l.lockedFacts}】`]
  const facts = list(blueprint.lockedFacts)
  if (facts.length) facts.forEach((item) => lines.push(`- ${oneLine(item)}`)); else lines.push(`- ${l.none}`)
  lines.push('', `【${l.tagChecklist}】`)
  const tagChecklist = list(blueprint.tagChecklist)
  if (tagChecklist.length) tagChecklist.forEach((item) => lines.push(`- ${oneLine(item)}`)); else lines.push(`- ${l.none}`)
  lines.push('', `【${l.phases}】`)
  list(blueprint.phases).forEach((phase, phaseIndex) => {
    const start = Math.max(1, Number(phase?.startChapter) || 1)
    const end = Math.max(start, Number(phase?.endChapter) || start)
    pushStage(lines, phase, `${l.phase} ${phaseIndex + 1}｜${rangeText(t, start, end)}｜${oneLine(phase?.title) || l.untitled}`, l)
    list(phase?.subphases).forEach((subphase, subIndex) => {
      const subStart = Math.max(start, Number(subphase?.startChapter) || start)
      const subEnd = Math.max(subStart, Number(subphase?.endChapter) || subStart)
      pushStage(lines, subphase, `${l.subphase} ${phaseIndex + 1}.${subIndex + 1}｜${rangeText(t, subStart, subEnd)}｜${oneLine(subphase?.title) || l.untitled}`, l)
    })
  })
  const rolling = blueprint.rollingPlan
  if (rolling && typeof rolling === 'object') {
    const start = Math.max(1, Number(rolling.startChapter) || 1)
    const end = Math.max(start, Number(rolling.endChapter) || start)
    lines.push('', `【${l.rolling}｜${rangeText(t, start, end)}】`)
    lines.push(`${l.windowObjective}：${oneLine(rolling.objective) || l.none}`)
    pushList(lines, l.tags, rolling.tagCommitments, l.none)
    pushList(lines, l.forbidden, rolling.forbiddenDrift, l.none)
    list(rolling.chapters).forEach((chapter) => {
      lines.push('', `【${l.rollingChapter} ${Number(chapter?.chapterNumber) || start}｜${oneLine(chapter?.title) || l.untitled}】`)
      lines.push(`${l.chapterPurpose}：${oneLine(chapter?.purpose) || l.none}`)
      pushList(lines, l.tags, chapter?.tagCommitments, l.none)
      pushList(lines, l.characters, list(chapter?.characterBeats).map((item) => formatCharacterBeat(item, l)), l.none)
      pushList(lines, l.scenes, chapter?.requiredScenes, l.none)
      lines.push(`${l.relationship}：${oneLine(chapter?.relationshipChange) || l.none}`)
      pushList(lines, l.foreshadowingActions, chapter?.foreshadowingActions, l.none)
      lines.push(`${l.exitHook}：${oneLine(chapter?.exitHook) || l.none}`)
    })
  }
  return lines.join('\n').trim()
}

function headingValue(line) {
  const match = String(line || '').trim().match(/^【(.+)】$/)
  return match ? match[1].trim() : ''
}
function aliases(current, zh, en) { return Array.from(new Set([current, zh, en])) }
function afterLabel(line, names) {
  const value = String(line || '').trim()
  for (const name of names) {
    if (value.startsWith(`${name}：`) || value.startsWith(`${name}:`)) return value.slice(name.length + 1).trim()
  }
  return null
}
function parseRangedHeading(value, names) {
  if (!names.some((name) => value.startsWith(`${name} `))) return null
  const parts = value.split(/[｜|]/).map((item) => item.trim())
  const range = parts[1]?.match(/(\d+)\D+(\d+)/)
  if (!range || parts.length < 3) return null
  return { title: parts.slice(2).join('｜'), startChapter: Number(range[1]), endChapter: Number(range[2]) }
}
function blankStage(base) {
  return { ...base, goal: '', obstacle: '', reversal: '', threads: [], tagCommitments: [], characterBeats: [], requiredScenes: [], forbiddenDrift: [], entryCondition: '', exitCondition: '', foreshadowing: [], unresolvedQuestions: [] }
}
function keyedPart(parts, names) {
  for (const name of names) {
    const part = parts.find((item) => item.startsWith(`${name}=`))
    if (part) return part.slice(name.length + 1).trim()
  }
  return ''
}
function parseCharacterBeat(value, n, none) {
  const parts = value.split(/[｜|]/).map((item) => item.trim())
  const clean = (item) => none.has(item) ? '' : item
  return { character: clean(parts[0] || ''), goal: clean(keyedPart(parts, n.goal)), conflict: clean(keyedPart(parts, n.conflict)), change: clean(keyedPart(parts, n.change)), voiceGuard: clean(keyedPart(parts, n.voice)) }
}
function parseForeshadowing(value, n, none) {
  const parts = value.split(/[｜|]/).map((item) => item.trim())
  const progress = keyedPart(parts, n.progress).split(/[,，、]/).map(Number).filter((item) => item > 0)
  const plan = keyedPart(parts, n.plan)
  return { name: parts[0] || '', setupChapter: Number(keyedPart(parts, n.setup)) || 0, progressChapters: progress, payoffChapter: Number(keyedPart(parts, n.payoff)) || 0, plan: none.has(plan) ? '' : plan }
}

/** Parse an edited readable blueprint document back to the backend shape. */
export function parseBlueprintText(text, currentBlueprint = {}, t) {
  const l = labels(t)
  const n = {
    mainArc: aliases(l.mainArc, '故事主线', 'Main story arc'), lockedFacts: aliases(l.lockedFacts, '不可改写的设定', 'Locked facts'),
    tagChecklist: aliases(l.tagChecklist, '全书标签清单', 'Book-wide tag checklist'), phases: aliases(l.phases, '全书级篇章', 'Book-level arcs'),
    phase: aliases(l.phase, '大篇章', 'Arc'), subphase: aliases(l.subphase, '小阶段', 'Subphase'), rolling: aliases(l.rolling, '滚动执行蓝图', 'Rolling execution plan'),
    rollingChapter: aliases(l.rollingChapter, '执行章', 'Execution chapter'), goal: aliases(l.goal, '阶段目标', 'Stage goal'),
    obstacle: aliases(l.obstacle, '主要阻力', 'Main obstacle'), reversal: aliases(l.reversal, '关键反转', 'Key reversal'),
    threads: aliases(l.threads, '支线与人物关系', 'Subplots and relationships'), tags: aliases(l.tags, '标签兑现', 'Tag commitments'),
    characters: aliases(l.characters, '人物推进与声线', 'Character beats and voices'), scenes: aliases(l.scenes, '必备场景', 'Required scenes'),
    forbidden: aliases(l.forbidden, '禁止漂移', 'Forbidden drift'), entry: aliases(l.entry, '进入条件', 'Entry condition'), exit: aliases(l.exit, '离开条件', 'Exit condition'),
    foreshadowing: aliases(l.foreshadowing, '伏笔计划', 'Foreshadowing plan'), unresolved: aliases(l.unresolved, '未决问题', 'Unresolved questions'),
    windowObjective: aliases(l.windowObjective, '窗口目标', 'Window objective'), chapterPurpose: aliases(l.chapterPurpose, '章节目的', 'Chapter purpose'),
    relationship: aliases(l.relationship, '关系变化', 'Relationship change'), foreshadowingActions: aliases(l.foreshadowingActions, '伏笔动作', 'Foreshadowing actions'),
    exitHook: aliases(l.exitHook, '章末钩子', 'Exit hook'), conflict: aliases(l.conflict, '冲突', 'Conflict'), change: aliases(l.change, '变化', 'Change'),
    voice: aliases(l.voice, '声线', 'Voice'), setup: aliases(l.setup, '埋设', 'Setup'), progress: aliases(l.progress, '推进', 'Progress'),
    payoff: aliases(l.payoff, '回收', 'Payoff'), plan: aliases(l.plan, '安排', 'Plan'), none: new Set([l.none, '暂无', 'None']),
  }
  const result = { ...currentBlueprint, blueprintLevel: 3, mainArc: '', lockedFacts: [], tagChecklist: [], phases: [], rollingPlan: null }
  let section = '', arc = null, stage = null, rollingChapter = null, collection = ''
  const clear = () => { collection = '' }
  const setCollection = (line, target, definitions) => {
    for (const [key, names] of definitions) {
      const lead = afterLabel(line, names)
      if (lead !== null) {
        collection = key
        if (lead && !n.none.has(lead)) target[key].push(lead)
        return true
      }
    }
    return false
  }
  for (const raw of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const heading = headingValue(line)
    if (heading) {
      if (n.mainArc.includes(heading)) { section = 'mainArc'; arc = stage = rollingChapter = null; clear(); continue }
      if (n.lockedFacts.includes(heading)) { section = 'lockedFacts'; arc = stage = rollingChapter = null; clear(); continue }
      if (n.tagChecklist.includes(heading)) { section = 'tagChecklist'; arc = stage = rollingChapter = null; clear(); continue }
      if (n.phases.includes(heading)) { section = 'phases'; arc = stage = rollingChapter = null; clear(); continue }
      const parsedArc = parseRangedHeading(heading, n.phase)
      if (parsedArc) { arc = blankStage({ ...parsedArc, subphases: [] }); result.phases.push(arc); stage = arc; section = 'stage'; rollingChapter = null; clear(); continue }
      const parsedSub = parseRangedHeading(heading, n.subphase)
      if (parsedSub && arc) { stage = blankStage(parsedSub); arc.subphases.push(stage); section = 'stage'; rollingChapter = null; clear(); continue }
      if (n.rolling.some((name) => heading.startsWith(`${name}｜`) || heading.startsWith(`${name}|`))) {
        const range = heading.match(/(\d+)\D+(\d+)/)
        result.rollingPlan = { startChapter: Number(range?.[1]) || 1, endChapter: Number(range?.[2]) || 1, calibratedAtChapter: Number(currentBlueprint?.rollingPlan?.calibratedAtChapter) || 0, objective: '', tagCommitments: [], forbiddenDrift: [], chapters: [] }
        section = 'rolling'; arc = stage = rollingChapter = null; clear(); continue
      }
      if (n.rollingChapter.some((name) => heading.startsWith(`${name} `)) && result.rollingPlan) {
        const parts = heading.split(/[｜|]/).map((item) => item.trim())
        const chapterNumber = Number((parts[0].match(/\d+/) || [])[0])
        rollingChapter = { chapterNumber, title: parts.slice(1).join('｜'), purpose: '', tagCommitments: [], characterBeats: [], requiredScenes: [], relationshipChange: '', foreshadowingActions: [], exitHook: '' }
        result.rollingPlan.chapters.push(rollingChapter); section = 'rollingChapter'; clear(); continue
      }
    }
    if (section === 'mainArc') { result.mainArc = [result.mainArc, line].filter(Boolean).join('\n'); continue }
    if ((section === 'lockedFacts' || section === 'tagChecklist') && line.startsWith('- ')) {
      const value = line.slice(2).trim(); if (value && !n.none.has(value)) result[section].push(value); continue
    }
    const target = section === 'rollingChapter' ? rollingChapter : section === 'rolling' ? result.rollingPlan : stage
    if (!target) continue
    const scalarDefs = section === 'rollingChapter'
      ? [['purpose', n.chapterPurpose], ['relationshipChange', n.relationship], ['exitHook', n.exitHook]]
      : section === 'rolling' ? [['objective', n.windowObjective]]
        : [['goal', n.goal], ['obstacle', n.obstacle], ['reversal', n.reversal], ['entryCondition', n.entry], ['exitCondition', n.exit]]
    let matched = false
    for (const [key, names] of scalarDefs) {
      const value = afterLabel(line, names)
      if (value !== null) { target[key] = n.none.has(value) ? '' : value; clear(); matched = true; break }
    }
    if (matched) continue
    const collectionDefs = section === 'rollingChapter'
      ? [['tagCommitments', n.tags], ['characterBeats', n.characters], ['requiredScenes', n.scenes], ['foreshadowingActions', n.foreshadowingActions]]
      : section === 'rolling' ? [['tagCommitments', n.tags], ['forbiddenDrift', n.forbidden]]
        : [['threads', n.threads], ['tagCommitments', n.tags], ['characterBeats', n.characters], ['requiredScenes', n.scenes], ['forbiddenDrift', n.forbidden], ['foreshadowing', n.foreshadowing], ['unresolvedQuestions', n.unresolved]]
    if (setCollection(line, target, collectionDefs)) continue
    if (collection && line.startsWith('- ')) {
      const value = line.slice(2).trim()
      if (!value || n.none.has(value)) continue
      if (collection === 'characterBeats') target[collection].push(parseCharacterBeat(value, n, n.none))
      else if (collection === 'foreshadowing') target[collection].push(parseForeshadowing(value, n, n.none))
      else target[collection].push(value)
    }
  }
  if (!result.mainArc.trim()) throw new Error(typeof t === 'function' ? t('generate.errBlueprintMainArc') : '请保留“故事主线”段落')
  if (!result.phases.length) throw new Error(typeof t === 'function' ? t('generate.errBlueprintPhases') : '至少需要一个全书级篇章')
  return result
}
