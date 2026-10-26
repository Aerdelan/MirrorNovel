export const GENERATION_IDLE_MS = 180000
export function backendGenerationActive(data) {
  if (typeof data?.active === 'boolean') return data.active
  return ['queued', 'running', 'pause_requested'].includes(data?.job?.status)
}
export function generationAttemptKey(userId) {
  return userId ? `mn_generation_attempt:${encodeURIComponent(userId)}` : ''
}
export function readGenerationAttempt(userId, storage = globalThis.localStorage) {
  try {
    const key = generationAttemptKey(userId)
    const value = key && JSON.parse(storage.getItem(key))
    if (value?.version !== 1 || typeof value.requestId !== 'string' || !/^[\w-]{16,80}$/.test(value.requestId)
      || !value.input || typeof value.input !== 'object' || Array.isArray(value.input)) return null
    for (const key of ['referenceIds', 'researchLinks']) {
      if (value.input[key] !== undefined && (!Array.isArray(value.input[key]) || value.input[key].some(item => typeof item !== 'string'))) return null
    }
    return value
  } catch { return null }
}
export function saveGenerationAttempt(userId, attempt, storage = globalThis.localStorage) {
  try {
    const key = generationAttemptKey(userId)
    if (!key) return false
    if (attempt) storage.setItem(key, JSON.stringify({ ...attempt, version: 1 }))
    else storage.removeItem(key)
    return true
  } catch { return false }
}
