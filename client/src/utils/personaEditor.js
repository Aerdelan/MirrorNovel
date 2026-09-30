const DEFAULT_AXES = { temperature: 3, diction: 3, narrator: 3, pacing: 3, humor: 3, emotion: 3 }

/** 系统风格以个人草稿编辑，保存时新建；个人风格保留 id，保存时更新。 */
export function createPersonaEditDraft(persona, existing = [], copySuffix = '（自定义）') {
  let name = persona?.name || ''
  if (persona?.isSystem) {
    const names = new Set(existing.map(item => item.name))
    const base = name
    let index = 1
    do {
      const suffix = `${copySuffix}${index === 1 ? '' : ` ${index}`}`
      name = `${base.slice(0, Math.max(0, 40 - suffix.length))}${suffix}`
      index += 1
    } while (names.has(name))
  }
  return {
    editingPersona: { _id: persona?.isSystem ? undefined : persona?._id, name },
    systemName: persona?.isSystem ? persona.name : '',
    axesEnabled: Boolean(persona?.axes),
    form: {
      name,
      description: persona?.description || '',
      voice: persona?.voice || '',
      tone: persona?.tone || '',
      rules: persona?.rules || '',
      vocab: persona?.vocab || '',
      overrideDeslop: Boolean(persona?.overrideDeslop),
      applicableTypes: [...(persona?.applicableTypes || [])],
      axes: { ...DEFAULT_AXES, ...persona?.axes },
    },
  }
}
