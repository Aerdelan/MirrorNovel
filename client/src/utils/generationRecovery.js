export const GENERATION_IDLE_MS = 180000
export function backendGenerationActive(data) {
  if (typeof data?.active === 'boolean') return data.active
  return ['queued', 'running', 'pause_requested'].includes(data?.job?.status)
}

export function generationAttemptUiMode(attempt) {
  if (attempt?.uiMode === 'lightnovel' || attempt?.uiMode === 'generate') return attempt.uiMode
  // Older records did not retain their tab. Light-novel types have stable IDs.
  return String(attempt?.input?.novelTypeId || '').startsWith('lightnovel_') ? 'lightnovel' : 'generate'
}

export function generationErrorMessage(error, fallback = '') {
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim()
  return fallback
}

// Full-book reads are expensive; while recovering a lost stream, refresh only
// newly committed chapters and at most once per interval. A live stream or an
// obsolete view must never be overwritten by a late snapshot.
export function createGenerationSnapshotReader({ fetchNovel, onNovel, current = () => true,
  canApply = () => true, intervalMs = 5000, now = Date.now }) {
  let lastCommitted = -1
  let nextAllowedAt = 0
  return {
    async refresh(novelId, committedChapter, { force = false } = {}) {
      const chapter = Math.max(0, Number(committedChapter) || 0)
      if (!novelId || !current() || !canApply()) return false
      if (!force && (chapter <= lastCommitted || now() < nextAllowedAt)) return false
      nextAllowedAt = now() + intervalMs
      const novel = await fetchNovel(novelId)
      if (!current() || !canApply()) return false
      onNovel(novel)
      lastCommitted = Math.max(lastCommitted, Number(novel.currentChapterIndex) || 0,
        ...(novel.chapters || []).map(item => Number(item.chapterNumber) || 0))
      return true
    },
  }
}

// Reconnect by reading task state, never by resubmitting the generation POST.
// A failed poll is an unknown state, not evidence that the worker has stopped.
export function createGenerationRecoveryMonitor({ fetchStatus, onStatus, onUnavailable,
  intervalMs = 2000, retryMs = 4000, schedule = setTimeout, cancel = clearTimeout }) {
  let epoch = 0
  let timer = null

  function stop() {
    epoch += 1
    if (timer !== null) cancel(timer)
    timer = null
  }

  async function poll(run) {
    let delay = intervalMs
    try {
      const status = await fetchStatus()
      if (run !== epoch) return
      if (await onStatus(status) === false || run !== epoch) return
    } catch (error) {
      if (run !== epoch) return
      onUnavailable?.(error)
      delay = retryMs
    }
    if (run === epoch) timer = schedule(() => poll(run), delay)
  }

  function start() {
    stop()
    return poll(epoch)
  }

  return { start, stop }
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
