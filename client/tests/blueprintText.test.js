import test from 'node:test'
import assert from 'node:assert/strict'
import { formatBlueprintText, parseBlueprintText } from '../src/utils/blueprintText.js'

test('prose blueprints survive preview and manual editing without losing the actual plan', () => {
  const plan = '周行舟公开账本，承担交接失误造成的代价。\n他拒绝替司机撒谎，选择保留原始记录，让同事重新判断他的立场。'
  const card = '周行舟在仓库核对签收单，发现日期与车辆记录不符。他必须当场决定是否暂停放货，并承担回款延期的后果。'
  const blueprint = { mainArc: '以公开证据改变责任划分', lockedFacts: ['没有超能力'], tagChecklist: ['职场'],
    phases: [{ title: '交接', startChapter: 1, endChapter: 6, goal: '核对账本', planText: plan,
      subphases: [{ title: '交接', startChapter: 1, endChapter: 6, planText: plan }] }],
    rollingPlan: { startChapter: 1, endChapter: 1, chapters: [{ chapterNumber: 1, title: '签收单', purpose: '核对签收', planText: card }] } }
  const text = formatBlueprintText(blueprint)
  assert.equal(text.split(plan).length - 1, 1, 'do not display the same implicit subphase twice')
  assert.ok(!text.includes('进入条件'))
  const edited = parseBlueprintText(text.replace('保留原始记录', '当众封存原始记录'), blueprint)
  assert.equal(edited.phases[0].planText, plan.replace('保留原始记录', '当众封存原始记录'))
  assert.equal(edited.rollingPlan.chapters[0].planText, card)
  assert.ok(edited.rollingPlan.chapters[0].purpose)
  assert.deepEqual(edited.tagChecklist, ['职场'])
})
