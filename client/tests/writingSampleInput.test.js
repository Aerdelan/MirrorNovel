import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSampleText, validateSampleContent, buildSampleDraft,
  SAMPLE_MIN_CHARS, SAMPLE_MAX_CHARS, SAMPLE_SCENE_TYPES,
} from '../src/utils/writingSampleInput.js'

const longText = '窗外的雨没有停，他把那封信折好放回抽屉，关门时又停了一会儿，直到楼道的灯亮起来。'.repeat(2)

test('sample text normalization and validation mirror the server limits', () => {
  assert.equal(normalizeSampleText('  a\r\n\r\n\r\nb  '), 'a\n\nb')
  assert.equal(normalizeSampleText(null), '')
  assert.equal(validateSampleContent('太短').reason, 'short')
  assert.equal(validateSampleContent('x'.repeat(SAMPLE_MAX_CHARS + 1)).reason, 'long')
  const ok = validateSampleContent('  ' + longText + '  ')
  assert.equal(ok.ok, true)
  assert.equal(ok.length, longText.length, 'length counts normalized text, not raw input')
  assert.equal(SAMPLE_MIN_CHARS, 40)
  assert.ok(SAMPLE_MAX_CHARS >= 2000)
})

test('chapter selection prefill pins the source; drafts never inherit approval', () => {
  const draft = buildSampleDraft({ preset: { content: longText, sourceKind: 'own_text', scope: 'novel', sourceNovelId: 'n1', sourceNovelTitle: '书名', sourceChapterNumber: 3 } })
  assert.equal(draft.isEdit, false)
  assert.equal(draft.fromReference, false)
  assert.equal(draft.approveNow, false, 'approval must be an explicit checkbox, never a default')
  assert.equal(draft.sourceNovelId, 'n1')
  assert.equal(draft.sourceChapterNumber, 3)
  assert.equal(draft.scope, 'novel')
})

test('reference excerpts resolve to the authorized_reference draft path', () => {
  const draft = buildSampleDraft({ preset: { content: longText, sourceKind: 'authorized_reference', sourceReferenceId: 'r1', sourceReferenceTitle: '参考', allowedForModelInput: true } })
  assert.equal(draft.fromReference, true)
  assert.equal(draft.sourceReferenceId, 'r1')
  assert.equal(draft.sourceKind, 'authorized_reference')
})

test('edit drafts keep identity and clamp title/notes without inventing fields', () => {
  const sample = { _id: 's1', status: 'approved', title: 'x'.repeat(200), notes: 'n'.repeat(900), content: longText, scope: 'screenplay', sceneType: 'dialogue', sourceKind: 'human_edit' }
  const draft = buildSampleDraft({ sample })
  assert.equal(draft.isEdit, true)
  assert.equal(draft.id, 's1')
  assert.equal(draft.status, 'approved')
  assert.equal(draft.title.length, 80)
  assert.equal(draft.notes.length, 500)
  assert.equal(draft.scope, 'screenplay')
  assert.equal(draft.sceneType, 'dialogue')
  const blank = buildSampleDraft({})
  assert.equal(blank.isEdit, false)
  assert.equal(blank.scope, 'novel')
  assert.equal(blank.sceneType, 'other')
  assert.ok(SAMPLE_SCENE_TYPES.includes(blank.sceneType))
})
