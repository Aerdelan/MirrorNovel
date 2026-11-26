const test = require('node:test');
const assert = require('node:assert/strict');
const { findRepeatedEndingScene, findEndingContinuityConflict } = require('../services/endingGuard');

test('rejects a scene that replays a previously written registry update inside the terminal chapter', () => {
  const earlier = '户籍室。温小满把第四十九行状态改为“在册”，合上终端。左口袋里两张纸叠在一起，她没掏出来看。她推开了门。';
  const replay = '苏棠从净水站出来。温小满在户籍室把第四十九行状态改为"在册"，合上终端，左口袋里两张纸叠在一起，她没掏出来看。';
  const expected = { kind: 'repetition', excerpt: replay, referenceExcerpt: earlier };
  assert.deepEqual(findRepeatedEndingScene(replay, earlier), expected);
  assert.deepEqual(findRepeatedEndingScene(`${earlier}\n\n${replay}`), expected);
});

test('locates an already performed action even when two copied parts change order', () => {
  const earlier = '净水站B-3。苏棠把纸条“它自己不会倒”从表盘旁揭下来，折好，放进工装胸袋。水表指针正向缓转，读数0.6，比昨天高了一格。';
  const replay = '水表指针正向缓转，读数0.6。她没拍照片，只是把纸条“它自己不会倒”从表盘旁揭下来，折好放进工装胸袋。';
  assert.deepEqual(findRepeatedEndingScene(replay, earlier), { kind: 'repetition', excerpt: replay, referenceExcerpt: earlier });
});

test('keeps a shared lyric and object when the prose performs a new action', () => {
  const lyric = '你若听见灯响的时候，记得绕过风最重的那条街，回头还有好几个人在等你。';
  const content = `最开始裴远舟靠在栏杆旁哼唱：“${lyric}”他还记得有人给他留过一张车票。\n\n孩子把纸杯摆在公告栏下，朝刚出站的人招手：“${lyric}”站台上有三个人停下来帮她张贴通知。`;
  assert.equal(findRepeatedEndingScene(content), null);
  assert.equal(findRepeatedEndingScene('净水站B-3。苏棠把纸条“它自己不会倒”贴进新班组的交接本，写清这张纸条的来历。',
    '净水站B-3。苏棠把纸条“它自己不会倒”从表盘旁揭下来，折好，放进工装胸袋。'), null);
});

test('allows parallel actions on distinct numbered records while checking a replay of the same record', () => {
  const update = id => `温小满把编号 ${id} 的档案翻到末页，检查居民签名和复核日期，再把公章盖在确认一栏。`;
  assert.equal(findRepeatedEndingScene(`${update(417)}\n\n${update(418)}`), null);
  assert.equal(findRepeatedEndingScene(update(418), update(417)), null);
  assert.equal(findRepeatedEndingScene(update(417), update(417))?.kind, 'repetition');
});

const referenceExcerpt = '调度室没有开灯。钟离鹤坐在转椅上，面前摊着权限交接文件。纸页边缘卷起来，被反复摩挲过。他拿起笔，笔尖悬在签名栏上方，落下去。字迹比平时重，纸背有压痕。';
const priorChapters = [{ chapterNumber: 98, content: referenceExcerpt },
  { chapterNumber: 99, content: '桌面上一枚笔帽。转椅的座面朝墙，没有人坐。' }];

test('does not let the terminal draft turn a signed handover back into an open decision', () => {
  const inserted = '林见夏没接话。他想起昨天在管理科门口，那把转椅的扶手还停在半空。钟离鹤人已经走了，但椅子没归位。权限没交。他现在才觉得不对。';
  assert.deepEqual(findEndingContinuityConflict(inserted, priorChapters), {
    kind: 'continuity', excerpt: '权限没交。', referenceChapter: 98, referenceExcerpt,
  });
  assert.equal(findEndingContinuityConflict('钟离鹤并未正式移交权限。', priorChapters)?.referenceChapter, 98);
});

test('leaves explicit flashbacks, unresolved drafts, separate authorities and previously voided transfer alone', () => {
  assert.equal(findEndingContinuityConflict('他想起当初会议还没有开，权限没交。那时众人整夜没有离开调度室。', priorChapters), null);
  assert.equal(findEndingContinuityConflict('谁说权限没交？他把签过的文件递了过去。', priorChapters), null);
  assert.equal(findEndingContinuityConflict('管理权限没交。', priorChapters), null);
  assert.equal(findEndingContinuityConflict('权限没交。', [{ chapterNumber: 98, content: '钟离鹤还没签署权限交接文件。' }]), null);
  assert.equal(findEndingContinuityConflict('权限没交。', [...priorChapters,
    { chapterNumber: 99, content: '权限的移交已经撤销。' }]), null);
});

test('links an omitted transfer object to a single nearby authority and respects scene breaks', () => {
  const prefix = '“权限会自己交出去。”裴远舟指了指那把椅子。';
  const gap = `${'他沿着轨道往前走，看着第二班电车从相反方向驶来。'.repeat(10)}\n\n`;
  const undecided = '“转完了就是交出去了。”林见夏说，“他还没决定要不要交。”';
  assert.equal(findEndingContinuityConflict(`${prefix}\n\n${gap}${undecided}`, priorChapters)?.referenceChapter, 98);
  assert.equal(findEndingContinuityConflict(undecided, priorChapters), null);
  assert.equal(findEndingContinuityConflict(`${prefix}\n\n---\n\n${undecided}`, priorChapters), null);
  assert.equal(findEndingContinuityConflict(`${prefix}只读权限也会交出。\n\n${undecided}`, priorChapters), null);
  assert.equal(findEndingContinuityConflict(`${prefix}\n\n她想起了当初那一晚，他还没决定要不要交。`, priorChapters), null);
});
