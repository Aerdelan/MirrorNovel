import test from 'node:test'
import assert from 'node:assert/strict'
import { editDraftKey, readEditDraft, writeEditDraft, removeEditDraft } from '../src/utils/editDraft.js'
import { normalizeChapterWordTargetInput } from '../src/utils/chapterWordTarget.js'
import { createSceneEditValue } from '../src/utils/sceneEditValue.js'

function memoryStorage() {
 const rows = new Map()
 return { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) }
}
test('drafts survive reopening, stay account/resource scoped, and clear after save or returning to the original', () => {
 const store = memoryStorage(), key = editDraftKey('a', 'book', 'chapter:1')
 assert.equal(writeEditDraft(key, '改写', '原文', store), true)
 assert.equal(readEditDraft(key, store).content, '改写')
 for (const other of [editDraftKey('b', 'book', 'chapter:1'), editDraftKey('a', 'other', 'chapter:1'), editDraftKey('a', 'book', 'chapter:2')]) assert.equal(readEditDraft(other, store), null)
 assert.equal(writeEditDraft(key, '原文', '原文', store), true)
 assert.equal(readEditDraft(key, store), null)
 writeEditDraft(key, '改写', '原文', store)
 assert.equal(removeEditDraft(key, store), true)
 assert.equal(readEditDraft(key, store), null)
 assert.equal(editDraftKey('', 'book', 'chapter:1'), '')
 assert.notEqual(editDraftKey('a:b', 'c', 'd'), editDraftKey('a', 'b:c', 'd'))
})
test('bad or unavailable draft storage does not throw or report false success', () => {
 const broken = { getItem() { throw Error('blocked') }, setItem() { throw Error('quota') }, removeItem() { throw Error('blocked') } }
 assert.equal(writeEditDraft('key', 'new', 'old', broken), false)
 assert.equal(readEditDraft('key', broken), null)
 assert.equal(removeEditDraft('key', broken), false)
 const store = memoryStorage()
 for (const value of ['broken', 'null', '{"version":2,"content":"x","base":"y"}', '{"version":1,"content":42,"base":"y"}']) { store.setItem('key', value); assert.equal(readEditDraft('key', store), null) }
})
test('chapter length preserves valid requests and clamps only when explicitly validated', () => {
 for (const number of [2000, 3000, 8000, 10000, 20000]) assert.equal(normalizeChapterWordTargetInput(number), number)
 for (const value of ['', null, undefined, 'bad', Infinity]) assert.equal(normalizeChapterWordTargetInput(value), 3000)
 assert.equal(normalizeChapterWordTargetInput(1), 2000)
 assert.equal(normalizeChapterWordTargetInput(99999), 20000)
 assert.equal(normalizeChapterWordTargetInput('12345'), 12345)
})
test('scene edit forms preserve text and dialogue metadata without mutating the displayed scene', () => {
 const scene = { sceneNumber: 7, action: '  她愣住了。\n', objective: '目标', imagePlan: { prompt: '画面' }, dialogue: [{ character: '甲', line: ' 保留原句 ', subtext: '隐瞒', position: '门边' }] }
 const form = createSceneEditValue(scene)
 assert.equal(form.action, scene.action)
 assert.equal(form.dialogue[0].subtext, '隐瞒')
 form.dialogue[0].line = '新台词'
 assert.equal(scene.dialogue[0].line, ' 保留原句 ')
 assert.equal(form.sceneNumber, undefined)
 assert.equal(form.imagePlan, undefined)
 assert.deepEqual(createSceneEditValue({ dialogue: 'bad draft' }).dialogue, [])
})
