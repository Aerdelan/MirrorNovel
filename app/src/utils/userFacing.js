const MODEL_NAME_PATTERN = /\b(?:deepseek|qwen|gpt|openai|claude|anthropic|gemini|llama|mistral|yi|glm|internlm|doubao|ollama|siliconflow|zhipu|moonshot|dashscope)(?:[\s./:+_-]*(?:v?\d+(?:\.\d+)*|[a-z][\w-]*))*\b/gi

const LINE_ALIASES = {
  zh: ['普通线路模型一', '普通线路模型二', '高级线路模型一', 'VIP线路模型', 'SVIP线路模型'],
  en: ['Standard Route Model 1', 'Standard Route Model 2', 'Advanced Route Model 1', 'VIP Route Model', 'SVIP Route Model'],
}

export function lineAliases(locale = 'zh') {
  return LINE_ALIASES[locale === 'en' ? 'en' : 'zh']
}

export function modelLineAlias(modelName, locale = 'zh', preferredIndex = 0) {
  if (!modelName) return lineAliases(locale)[preferredIndex % 5]
  let hash = 0
  for (const char of String(modelName)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return lineAliases(locale)[(hash + preferredIndex) % 5]
}

export function toUserFacingMessage(value, locale = 'zh') {
  if (value === undefined || value === null) return ''
  const pointsLabel = locale === 'en' ? 'Points' : '积分'
  return String(value)
    .replace(/\bTokens?\b/gi, pointsLabel)
    .replace(MODEL_NAME_PATTERN, (name) => modelLineAlias(name, locale))
}
