import { computed, ref } from 'vue'

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'pause_requested'])

export function isGenerationActive(novel, job, localRunning = false) {
  return localRunning || novel?.status === 'generating' || ACTIVE_JOB_STATUSES.has(job?.status)
}

// Only the current, visible novel may consume a response. A failed status request
// cannot turn a running task into an idle task or enable a second generation.
export function useNovelGeneration({ novel, localRunning, fetchJob, fetchNovel, onNovel }) {
  const job = ref(null)
  const ready = ref(false)
  const unavailable = ref(false)
  const busy = computed(() => isGenerationActive(novel.value, job.value, localRunning.value))
  let epoch = 0
  let visible = false
  let timer = null
  let pending = null

  function stop() {
    visible = false
    epoch += 1
    clearTimeout(timer)
    timer = null
    pending = null
    ready.value = false
  }

  function reset() {
    stop()
    job.value = null
    unavailable.value = false
  }

  async function check(forceRefresh = false) {
    if (pending) {
      const result = await pending
      if (!forceRefresh) return result
    }
    const id = String(novel.value?._id || '')
    if (!visible || !id) return false
    const run = epoch
    const current = () => visible && run === epoch && String(novel.value?._id || '') === id
    const request = (async () => {
      try {
        const result = await fetchJob(id)
        if (!current()) return false
        const next = result?.job || null
        const changed = job.value?.jobId !== next?.jobId || job.value?.status !== next?.status
        const committed = Number(next?.lastCommittedChapter || 0)
        // Draft progress uses the small job response; reload the full book only
        // when a chapter commits, a job changes state, or an action needs a fresh snapshot.
        if (forceRefresh || changed || committed > Number(novel.value?.currentChapterIndex || 0)
          || (novel.value?.status === 'generating' && !ACTIVE_JOB_STATUSES.has(next?.status))) {
          const data = await fetchNovel(id)
          if (!current()) return false
          novel.value = data
          onNovel(data)
        }
        job.value = next
        ready.value = true
        unavailable.value = false
        return true
      } catch {
        if (current()) {
          ready.value = false
          unavailable.value = true
        }
        return false
      }
    })()
    pending = request
    try { return await request }
    finally { if (pending === request) pending = null }
  }

  async function poll(run) {
    await check()
    if (!visible || run !== epoch) return
    timer = setTimeout(() => poll(run), unavailable.value ? 4000 : (busy.value ? 2000 : 4000))
  }

  function start() {
    stop()
    visible = true
    poll(epoch)
  }

  return { job, ready, unavailable, busy, check, start, stop, reset }
}
