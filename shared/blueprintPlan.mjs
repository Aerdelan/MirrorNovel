// Compatibility for readable blueprints saved/submitted before planText was
// preserved. Only reuse authored narrative; never invent missing plot fields.
const scalarText = value => typeof value === 'string' ? value.trim() : ''
const meaningful = value => {
  const text = scalarText(value)
  return text && !/^(?:暂无|无|待补充|待定|未填写|未设定|None|N\/A)[。.\s]*$/i.test(text) ? text : ''
}
const detailFields = ['characterBeats', 'requiredScenes', 'forbiddenDrift', 'foreshadowing', 'unresolvedQuestions']

export function blueprintPlanText(stage = {}) {
  // An explicitly supplied plan, including one that is too short, remains the
  // user's content. Validation must still reject short/empty placeholder plans.
  if (scalarText(stage.planText)) return scalarText(stage.planText)
  const chapter = Number(stage.chapterNumber) > 0
  const fields = chapter
    ? [['purpose', '章节目的'], ['relationshipChange', '关系变化'], ['exitHook', '章末局面']]
    : [['goal', '阶段目标'], ['obstacle', '主要阻力'], ['reversal', '关键转折'], ['entryCondition', '进入条件'], ['exitCondition', '阶段结束局面']]
  const parts = fields.map(([key, label]) => ({ text: meaningful(stage[key]), label })).filter(item => item.text)
  const primary = meaningful(chapter ? stage.purpose : stage.goal)
  const hasDetails = detailFields.some(key => Array.isArray(stage[key]) && stage[key].some(item =>
    typeof item === 'string' ? meaningful(item) : item && typeof item === 'object' && Object.values(item).some(meaningful)))
  if (hasDetails && primary.length < (chapter ? 30 : 40)) return ''
  if (parts.map(item => item.text).join('').length < (chapter ? 30 : 40)) return ''
  return parts.map(item => `${item.label}：${item.text}`).join('\n')
}

export function normalizeBlueprintPlans(blueprint) {
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) return blueprint
  const stage = item => {
    if (!item || typeof item !== 'object') return item
    const planText = blueprintPlanText(item)
    return { ...item, ...(planText ? { planText } : {}),
      ...(Array.isArray(item.subphases) ? { subphases: item.subphases.map(stage) } : {}) }
  }
  return { ...blueprint,
    ...(Array.isArray(blueprint.phases) ? { phases: blueprint.phases.map(stage) } : {}),
    ...(blueprint.rollingPlan ? { rollingPlan: { ...blueprint.rollingPlan,
      ...(Array.isArray(blueprint.rollingPlan.chapters) ? { chapters: blueprint.rollingPlan.chapters.map(stage) } : {}) } } : {}) }
}
