import test from 'node:test'
import assert from 'node:assert/strict'
import { formatBlueprintText, parseBlueprintText } from '../src/utils/blueprintText.js'
import { blueprintPlanText, normalizeBlueprintPlans } from '../../shared/blueprintPlan.mjs'

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
  assert.equal(edited.phases[0].goal, '核对账本')
  assert.equal(edited.phases[0].subphases[0].planText, edited.phases[0].planText)
  assert.equal(edited.rollingPlan.chapters[0].planText, card)
  assert.ok(edited.rollingPlan.chapters[0].purpose)
  assert.deepEqual(edited.tagChecklist, ['职场'])
})

test('legacy sparse preview uses its authored narrative, not empty optional field placeholders', () => {
  const goal = '见夏在被遗忘的车站发现妹妹留下的车票，她选择用自己的记忆换取一次发车机会，并承担母亲再也认不出自己的代价。'
  const source = { mainArc: '寻找妹妹并揭开失述的真相', phases: [{ title: '末班车', startChapter: 1, endChapter: 6,
    goal, characterBeats: [], requiredScenes: [], forbiddenDrift: [], foreshadowing: [], unresolvedQuestions: [] }] }
  const text = formatBlueprintText(source)
  assert.ok(text.includes(goal))
  assert.ok(!text.slice(text.indexOf('【大篇章')).includes('暂无'))
  const confirmed = parseBlueprintText(text, source)
  assert.ok(confirmed.phases[0].planText.includes(goal))
  const edited = parseBlueprintText(text.replace('妹妹留下的车票', '妹妹亲手折好的车票'), source)
  assert.ok(edited.phases[0].planText.includes('妹妹亲手折好的车票'))
  assert.equal(source.phases[0].planText, undefined, 'do not mutate the source snapshot')
})

test('an unchanged preview preserves existing constraints and unknown fields rather than reconstructing them', () => {
  const planText = '见夏在废弃广播站听见妹妹的声音，她选择拆下自己的愿章接通线路，并在失去一段重要记忆之后，发现广播来自城市钟楼。'
  const source = { mainArc: '追查广播源头', phases: [{ title: '广播', startChapter: 1, endChapter: 6, planText,
    characterBeats: [{ character: '见夏', voiceGuard: '紧张时用短句，回避妹妹的名字' }],
    requiredScenes: ['废弃广播站'], customMetadata: 'future compatible field' }] }
  const confirmed = parseBlueprintText(formatBlueprintText(source), source)
  assert.deepEqual(confirmed, source)
  const edited = parseBlueprintText(formatBlueprintText(source).replace('来自城市钟楼', '来自钟楼地下室'), source)
  assert.equal(edited.phases[0].characterBeats[0].voiceGuard, '紧张时用短句，回避妹妹的名字')
  assert.deepEqual(edited.phases[0].requiredScenes, ['废弃广播站'])
})

test('editing a long-book blueprint preserves each scheduled payoff and unfinished question', () => {
  const planText = '电车抵达档案站，见夏查到乘车登记，从这里开始追踪注销章的去向。'
  const hook = { name: '注销章', setupChapter: 61, progressChapters: [70, 82], payoffChapter: 93, plan: '用原始登记证明注销无效' }
  const source = { mainArc: '查明乘客失踪案', phases: [{ title: '调查', startChapter: 61, endChapter: 100, planText,
    subphases: [{ title: '找证', startChapter: 61, endChapter: 85, planText, foreshadowing: [hook], unresolvedQuestions: ['是谁取走注销章？'] }] }] }
  const edited = parseBlueprintText(formatBlueprintText(source).replace('档案站', '档案楼'), source)
  assert.deepEqual(edited.phases[0].subphases[0].foreshadowing, [hook])
  assert.deepEqual(edited.phases[0].subphases[0].unresolvedQuestions, ['是谁取走注销章？'])
  assert.equal(edited.phases[0].endChapter, 100)
})

test('placeholder-only fields cannot become an invented prose plan', () => {
  const stage = { title: '待定', goal: '暂无', obstacle: '无', reversal: '待补充', entryCondition: 'None', exitCondition: '未设定',
    characterBeats: [], requiredScenes: ['暂无'], forbiddenDrift: [], foreshadowing: [], unresolvedQuestions: [] }
  assert.equal(blueprintPlanText(stage), '')
  const source = { phases: [stage] }
  assert.equal(normalizeBlueprintPlans(source).phases[0].planText, undefined)
})
