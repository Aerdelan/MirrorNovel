import test from 'node:test'
import assert from 'node:assert/strict'
import { createPersonaEditDraft } from '../src/utils/personaEditor.js'

test('editing a system preset creates an independent personal draft without a system update id', () => {
  const preset = {
    _id: 'system-1', isSystem: true, name: '幽默吐槽', description: '轻松节奏',
    voice: '第三人称', tone: '轻快', rules: '自然吐槽', vocab: '推荐词',
    overrideDeslop: true, applicableTypes: ['lightnovel'], axes: { humor: 5, narrator: 4 },
  }
  const original = structuredClone(preset)
  const draft = createPersonaEditDraft(preset, [preset])
  assert.equal(draft.editingPersona._id, undefined)
  assert.equal(draft.systemName, preset.name)
  assert.equal(draft.form.name, '幽默吐槽（自定义）')
  for (const field of ['description', 'voice', 'tone', 'rules', 'vocab', 'overrideDeslop']) {
    assert.equal(draft.form[field], preset[field])
  }
  assert.equal(draft.axesEnabled, true)
  draft.form.voice = '第一人称'
  draft.form.axes.humor = 2
  draft.form.applicableTypes.push('male')
  assert.deepEqual(preset, original)
})

test('editing a personal template keeps its update id and name', () => {
  const draft = createPersonaEditDraft({ _id: 'personal-1', isSystem: false, name: '我的风格', voice: '近距离' })
  assert.equal(draft.editingPersona._id, 'personal-1')
  assert.equal(draft.form.name, '我的风格')
  assert.equal(draft.systemName, '')
  assert.equal(draft.axesEnabled, false)
})

test('a new template has a visible editing state and empty editable fields', () => {
  const draft = createPersonaEditDraft(null)
  assert.ok(draft.editingPersona)
  assert.equal(draft.editingPersona._id, undefined)
  assert.equal(draft.form.name, '')
  assert.equal(draft.form.rules, '')
  assert.equal(draft.axesEnabled, false)
})

test('personal copy names avoid collisions and respect the 40-character limit', () => {
  const preset = { isSystem: true, name: '幽默吐槽' }
  const existing = [{ name: '幽默吐槽（自定义）' }, { name: '幽默吐槽（自定义） 2' }]
  assert.equal(createPersonaEditDraft(preset, existing).form.name, '幽默吐槽（自定义） 3')
  const long = { isSystem: true, name: '风'.repeat(40) }
  const first = createPersonaEditDraft(long, [], ' (Custom)')
  const second = createPersonaEditDraft(long, [{ name: first.form.name }], ' (Custom)')
  assert.equal(first.form.name.length, 40)
  assert.equal(second.form.name.length, 40)
  assert.notEqual(second.form.name, first.form.name)
})
