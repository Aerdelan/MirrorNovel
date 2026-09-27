/**
 * Incremental parser for the JSON-over-SSE protocol used by MirrorNovel.
 *
 * XMLHttpRequest exposes an ever-growing responseText. A network packet may
 * end anywhere (including in the middle of `data:`, JSON or a UTF-8 character),
 * so callers must pass only the newly appended text to `push()` and keep this
 * parser alive for the whole request.
 */

export const SSE_TERMINAL_TYPES = Object.freeze([
  'completed',
  'paused',
  'cancelled',
  'token_exhausted',
  'plan_needs_extension',
  'error',
])

const TERMINAL_TYPE_SET = new Set(SSE_TERMINAL_TYPES)

export function isTerminalSSEEvent(event) {
  return Boolean(event && TERMINAL_TYPE_SET.has(event.type))
}

export function createSSEParser({ onEvent, onInvalidEvent } = {}) {
  let lineBuffer = ''
  let dataLines = []
  let receivedEventCount = 0
  let invalidEventCount = 0
  let sawDataField = false
  let terminalEvent = null

  const emitted = []

  const dispatch = () => {
    if (!dataLines.length) return
    const payload = dataLines.join('\n')
    dataLines = []
    try {
      const event = JSON.parse(payload)
      receivedEventCount += 1
      if (isTerminalSSEEvent(event)) terminalEvent = event
      emitted.push(event)
      if (onEvent) onEvent(event)
    } catch (error) {
      invalidEventCount += 1
      if (onInvalidEvent) onInvalidEvent({ payload, error })
    }
  }

  const consumeLine = (rawLine) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '') {
      dispatch()
      return
    }
    if (line.startsWith(':')) return

    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    if (field !== 'data') return
    sawDataField = true
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    dataLines.push(value)
  }

  return {
    push(chunk) {
      if (chunk == null || chunk === '') return []
      const start = emitted.length
      lineBuffer += String(chunk)
      let newlineIndex = lineBuffer.indexOf('\n')
      while (newlineIndex !== -1) {
        consumeLine(lineBuffer.slice(0, newlineIndex))
        lineBuffer = lineBuffer.slice(newlineIndex + 1)
        newlineIndex = lineBuffer.indexOf('\n')
      }
      return emitted.slice(start)
    },

    /** Flush a normally closed response, including a final line without `\n`. */
    finish() {
      const start = emitted.length
      if (lineBuffer) {
        consumeLine(lineBuffer)
        lineBuffer = ''
      }
      dispatch()
      return emitted.slice(start)
    },

    getState() {
      return {
        receivedEventCount,
        invalidEventCount,
        sawDataField,
        terminalEvent,
        hasTerminalEvent: Boolean(terminalEvent),
      }
    },
  }
}

/**
 * Classify why an XHR stream ended. A clean HTTP close is not proof that the
 * background generation completed: only a terminal SSE event is authoritative.
 */
export function classifySSEEnd({ status = 0, state, aborted = false } = {}) {
  const snapshot = state || {}
  if (aborted) return { kind: 'aborted' }
  if (snapshot.hasTerminalEvent) return { kind: 'terminal', event: snapshot.terminalEvent }
  if (status >= 400) return { kind: 'http_error', status }
  if (status === 0) return { kind: 'disconnected', state: 'unknown' }
  if (!snapshot.receivedEventCount && !snapshot.sawDataField) return { kind: 'empty_response' }
  return { kind: 'disconnected', state: 'unknown' }
}

