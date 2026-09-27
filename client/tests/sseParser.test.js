import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifySSEEnd,
  createSSEParser,
} from '../src/utils/sseParser.js'

function feedOneUtf8ByteAtATime(parser, source) {
  const decoder = new TextDecoder()
  for (const byte of new TextEncoder().encode(source)) {
    const text = decoder.decode(Uint8Array.of(byte), { stream: true })
    if (text) parser.push(text)
  }
  const tail = decoder.decode()
  if (tail) parser.push(tail)
}

test('parses JSON SSE events when every UTF-8 byte is a separate packet', () => {
  const events = []
  const parser = createSSEParser({ onEvent: event => events.push(event) })
  const source = [
    ': heartbeat\r\n',
    'data: {"type":"content","content":"校园祭与猫🐈"}\r\n\r\n',
    'data: {"type":"completed","novelId":"n-1"}\n\n',
  ].join('')

  feedOneUtf8ByteAtATime(parser, source)
  parser.finish()

  assert.deepEqual(events, [
    { type: 'content', content: '校园祭与猫🐈' },
    { type: 'completed', novelId: 'n-1' },
  ])
  assert.equal(parser.getState().hasTerminalEvent, true)
})

test('keeps an incomplete data line buffered until the rest arrives', () => {
  const events = []
  const parser = createSSEParser({ onEvent: event => events.push(event) })
  parser.push('da')
  parser.push('ta: {"type":"con')
  parser.push('tent","content":"abc"}\n')
  assert.deepEqual(events, [])
  parser.push('\n')
  assert.deepEqual(events, [{ type: 'content', content: 'abc' }])
})

test('a disconnected stream with content is unknown and never completed', () => {
  const events = []
  const parser = createSSEParser({ onEvent: event => events.push(event) })
  parser.push('data: {"type":"content","content":"partial"}\n\n')
  parser.finish()

  const result = classifySSEEnd({ status: 200, state: parser.getState() })
  assert.deepEqual(result, { kind: 'disconnected', state: 'unknown' })
  assert.equal(events.some(event => event.type === 'completed'), false)
})

test('truncated JSON is reported as disconnected rather than completed', () => {
  const parser = createSSEParser()
  parser.push('data: {"type":"content","content":"cut')
  parser.finish()

  const result = classifySSEEnd({ status: 200, state: parser.getState() })
  assert.deepEqual(result, { kind: 'disconnected', state: 'unknown' })
  assert.equal(parser.getState().invalidEventCount, 1)
})

test('HTTP failures and empty successful responses are never treated as completion', () => {
  const parser = createSSEParser()
  assert.deepEqual(
    classifySSEEnd({ status: 502, state: parser.getState() }),
    { kind: 'http_error', status: 502 },
  )
  assert.deepEqual(
    classifySSEEnd({ status: 200, state: parser.getState() }),
    { kind: 'empty_response' },
  )
})

test('explicit abort and terminal error remain distinguishable from network disconnect', () => {
  const parser = createSSEParser()
  parser.push('data: {"type":"error","message":"upstream failed"}\n\n')
  parser.finish()

  assert.equal(classifySSEEnd({ status: 200, state: parser.getState() }).kind, 'terminal')
  assert.deepEqual(
    classifySSEEnd({ status: 0, state: parser.getState(), aborted: true }),
    { kind: 'aborted' },
  )
})

