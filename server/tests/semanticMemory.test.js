const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hash, splitChapterText, validChapterMemory, collectLedger, ensureSemanticMemory,
  invalidateSemanticMemory, buildSemanticContext,
  renderSemanticContext,
} = require('../services/semanticMemory');
const { compileChapterExecutionPackage } = require('../services/novelContext');

function novel(count = 6) {
  return {
    chapters: Array.from({ length: count }, (_, index) => ({ chapterNumber: index + 1,
      content: `林舟拿到编号${index + 1}的铜钥匙，确认钥匙属于失踪的证人。最后把记录交给苏晚保管。` })),
    chapterSummaryDoc: '旧的截断式摘要', contextMemory: { version: 1, checkpointSummary: '旧记忆', facts: [] },
    markModified() {}, chapterPlan: '未来计划：证人将逃走（尚未发生）',
  };
}

function chapterResponse(prompt, extra = {}) {
  const source = prompt.split('【正文开始】\n')[1].split('\n【正文结束】')[0];
  return { content: JSON.stringify({ summary: '林舟取得铜钥匙并确认其归属，随后将记录交给苏晚，证人的去向仍待追查。',
    events: [{ text: '林舟取得铜钥匙并将记录交给苏晚', evidence: source.slice(0, 100) }],
    facts: [{ text: source.includes('地下室') ? '铜钥匙可以打开地下室门' : '铜钥匙属于失踪证人', evidence: source.slice(0, 100) }],
    characters: [{ name: '苏晚', state: '负责保管记录', evidence: source.slice(0, 100) }],
    openLoops: [], resolvedLoops: [], ...extra }) };
}

function model(calls, handler) {
  return async (task, prompt) => {
    calls.push({ task, prompt });
    if (handler) { const output = await handler(task, prompt); if (output) return output; }
    if (task === 'chapter_memory_compaction') return { content: JSON.stringify({ summary: '林舟在本章中段取得关键原件，最终确认签名与货损责任，并将证据交给苏晚保管。' }) };
    if (task === 'chapter_memory') return chapterResponse(prompt);
    return { content: JSON.stringify({ summary: '累计阶段记忆：林舟追查失踪证人，陆续找到铜钥匙，苏晚接手保管记录，两人继续核对证人去向。', focusFactIds: [], focusLoopIds: [] }) };
  };
}

test('chapter splitting preserves the entire text including the middle and ending', () => {
  const source = '开场。'.repeat(5000) + '正文中段关键转折：证人交出唯一原件。' + '后续。'.repeat(5000) + '结尾：仓库封条被拆开。';
  const chunks = splitChapterText(source);
  assert.equal(chunks.join(''), source);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 14000));
  assert.match(chunks.join(''), /正文中段关键转折/);
  const edge = splitChapterText('正文'.repeat(7000) + '。');
  assert.equal(edge.join(''), '正文'.repeat(7000) + '。');
  assert.ok(edge.every(chunk => chunk.length >= 4));
});

test('each saved chapter gets semantic memory, then six chapters merge into cumulative memory', async () => {
  const book = novel();
  const calls = [];
  let writes = 0;
  let usage = 0;
  await ensureSemanticMemory({ novel: book, request: model(calls), persist: async () => writes++, onUsage: () => usage++ });
  assert.equal(calls.filter(call => call.task === 'chapter_memory').length, 6);
  assert.equal(calls.filter(call => call.task === 'stage_memory').length, 1);
  assert.equal(usage, 7);
  assert.ok(writes >= 7);
  assert.equal(book.contextMemory.version, 2);
  assert.equal(book.contextMemory.checkpointChapter, 6);
  assert.equal(book.contextMemory.factLedger.length, 6);
  assert.ok(book.chapters.every(chapter => validChapterMemory(chapter)));
  assert.ok(calls.every(call => !call.prompt.includes('未来计划')));
  assert.match(calls.at(-1).prompt, /累计故事记忆/);
});

test('subsequent chapters are incremental and a no-op recovery makes zero model calls', async () => {
  const book = novel(5);
  const calls = [];
  const request = model(calls);
  await ensureSemanticMemory({ novel: book, request });
  assert.equal(calls.length, 5);
  assert.equal(book.contextMemory.checkpointChapter, 0);
  calls.length = 0;
  await ensureSemanticMemory({ novel: book, request, persist: async () => assert.fail('unchanged memory must not be rewritten') });
  assert.equal(calls.length, 0);
  book.chapters.push(novel(6).chapters[5]);
  await ensureSemanticMemory({ novel: book, request });
  assert.deepEqual(calls.map(call => call.task), ['chapter_memory', 'stage_memory']);
  assert.equal(book.contextMemory.checkpointChapter, 6);
});

test('a fake evidence quote is rejected twice and cannot replace the previous summary', async () => {
  const book = novel(1);
  book.chapters[0].memorySummary = { version: 2, sourceHash: 'old-hash', summary: '上次摘要，不应被失败请求覆盖', events: [] };
  const before = structuredClone(book.chapters[0].memorySummary);
  const calls = [];
  await assert.rejects(ensureSemanticMemory({ novel: book, request: model(calls, (task, prompt) => chapterResponse(prompt, {
    facts: [{ text: '证人已经死亡', evidence: '书中从未出现的死亡现场' }],
  })) }), error => error.code === 'SEMANTIC_MEMORY_REQUIRED');
  assert.equal(calls.length, 2);
  assert.deepEqual(book.chapters[0].memorySummary, before);
  assert.equal(book.contextMemory.checkpointSummary, '旧记忆');
});

test('a failed stage merge preserves the last successful cumulative memory and cached chapter summaries', async () => {
  const book = novel();
  await ensureSemanticMemory({ novel: book, request: model([]) });
  const previous = structuredClone(book.contextMemory);
  book.chapters.push(...novel(12).chapters.slice(6));
  await assert.rejects(ensureSemanticMemory({ novel: book, request: model([], task => {
    if (task === 'stage_memory') return { content: 'not json' };
  }) }));
  assert.deepEqual(book.contextMemory, previous);
  assert.ok(book.chapters.every(validChapterMemory));
  const retry = [];
  await ensureSemanticMemory({ novel: book, request: model(retry) });
  assert.deepEqual(retry.map(call => call.task), ['stage_memory']);
  assert.equal(book.contextMemory.checkpointChapter, 12);
  assert.equal(book.contextMemory.factLedger.length, 12, 'old facts survive even when the model chooses no focus IDs');
});

test('an open question survives silence and is closed only using a known ID and actual prose evidence', async () => {
  const book = novel(3);
  book.chapters[0].content += '林舟不知道铜钥匙能打开哪扇门。';
  book.chapters[2].content += '林舟用铜钥匙打开了地下室的铁门。';
  await ensureSemanticMemory({ novel: book, request: model([], (task, prompt) => {
    if (task !== 'chapter_memory') return;
    const number = Number(prompt.match(/【章节号】(\d+)/)[1]);
    if (number === 1) return chapterResponse(prompt, { openLoops: [{ text: '铜钥匙能打开哪扇门', evidence: '林舟不知道铜钥匙能打开哪扇门。' }] });
    if (number === 3) {
      const pending = JSON.parse(prompt.split('【待核对问题】')[1].split('\n【章节号】')[0]);
      assert.equal(pending.length, 1, 'chapter two did not silently resolve the question');
      return chapterResponse(prompt, { resolvedLoops: [{ id: pending[0].id, evidence: '林舟用铜钥匙打开了地下室的铁门。' }] });
    }
  }) });
  assert.equal(collectLedger(book.chapters.slice(0, 2)).openLoops.length, 1);
  assert.equal(collectLedger(book.chapters).openLoops.length, 0);
});

test('an invented resolution ID is rejected even if the quoted text exists', async () => {
  const book = novel(1);
  await assert.rejects(ensureSemanticMemory({ novel: book, request: model([], (_task, prompt) => chapterResponse(prompt, {
    resolvedLoops: [{ id: 'future-loop', evidence: '最后把记录交给苏晚保管。' }],
  })) }));
  assert.equal(book.chapters[0].memorySummary, undefined);
});

test('revising prose invalidates its summary and the old checkpoint; unchanged chapter caches are reused', async () => {
  const book = novel();
  await ensureSemanticMemory({ novel: book, request: model([]) });
  const old = book.contextMemory.checkpointSummary;
  book.chapters[1].content = '苏晚发现铜钥匙已经折断，暂时不能打开地下室。最后把记录交给苏晚保管。';
  assert.equal(invalidateSemanticMemory(book), true);
  assert.equal(book.contextMemory.staleFromChapter, 2);
  const excluded = buildSemanticContext({ chapters: book.chapters, contextMemory: book.contextMemory, currentChapter: 7 });
  assert.equal(excluded.checkpointSummary, '');
  assert.equal(book.contextMemory.checkpointSummary, old, 'invalidated snapshot is preserved until rebuilt');
  const calls = [];
  await ensureSemanticMemory({ novel: book, request: model(calls) });
  assert.deepEqual(calls.map(call => call.task), ['chapter_memory', 'stage_memory']);
  assert.equal(book.chapters[1].memorySummary.sourceHash, hash(book.chapters[1].content));
  assert.equal(book.contextMemory.staleFromChapter, undefined);
});

test('summary responses cannot attach to prose that changed while the model was running', async () => {
  const book = novel(1);
  await assert.rejects(ensureSemanticMemory({ novel: book, request: model([], (_task, prompt) => {
    const output = chapterResponse(prompt);
    book.chapters[0].content = '用户在总结请求期间另存了新正文。';
    return output;
  }) }), /正文在总结期间发生修订/);
  assert.equal(book.chapters[0].memorySummary, undefined);
});

test('execution prompts use cumulative memory plus unmerged semantic summaries and exclude future chapters', async () => {
  const book = novel(8);
  await ensureSemanticMemory({ novel: book, request: model([]) });
  const context = compileChapterExecutionPackage({ chapters: book.chapters, contextMemory: book.contextMemory,
    chapterSummaryDoc: '旧开篇：天气很潮湿。', foreshadowingDoc: '启发式误报：已回收', currentChapter: 9, memoryQuery: '铜钥匙',
  });
  assert.match(context.stableContext, /截至第6章/);
  assert.match(context.dynamicContext, /第7章：/);
  assert.match(context.dynamicContext, /第8章：/);
  assert.doesNotMatch(context.dynamicContext, /旧开篇|启发式误报|第1章：林舟取得/);
  const earlier = buildSemanticContext({ chapters: book.chapters, contextMemory: book.contextMemory, currentChapter: 5 });
  assert.equal(earlier.checkpointSummary, '', 'a future checkpoint cannot leak into earlier generation');
  assert.doesNotMatch(earlier.chapterSummaryDoc, /第5章|第6章|第8章/);
});

test('long-term retrieval can select an old fact rather than always returning the newest facts', async () => {
  const book = novel(24);
  await ensureSemanticMemory({ novel: book, request: model([], (task, prompt) => {
    if (task !== 'chapter_memory') return;
    const number = Number(prompt.match(/【章节号】(\d+)/)[1]);
    return chapterResponse(prompt, { facts: [{ text: number === 1 ? '铜钥匙保管在地下室保险柜' : `第${number}号账单已交给会计复核`, evidence: prompt.split('【正文开始】\n')[1].split('\n【正文结束】')[0].slice(0, 80) }] });
  }) });
  const context = buildSemanticContext({ chapters: book.chapters, contextMemory: book.contextMemory, currentChapter: 25, query: '地下室里的铜钥匙' });
  assert.match(context.facts[0], /第1章.*铜钥匙/);
  assert.equal(book.contextMemory.factLedger.length, 24);
});

test('long chapters are read in full and their part summaries are semantically merged rather than truncated', async () => {
  const book = novel(1);
  book.chapters[0].content = '开头场景。'.repeat(3000) + '中段唯一转折：证人交出签收原件。' + '继续行动。'.repeat(3000) + '结尾：刘海柱保存了原件。';
  const calls = [];
  await ensureSemanticMemory({ novel: book, request: model(calls, (task, prompt) => {
    if (task !== 'chapter_memory') return;
    return chapterResponse(prompt, { summary: '本段中人物取得重要线索并承担了相应后果。'.repeat(30) });
  }) });
  const sourceCalls = calls.filter(call => call.task === 'chapter_memory');
  const readText = sourceCalls.map(call => call.prompt.split('【正文开始】\n')[1].split('\n【正文结束】')[0]).join('');
  assert.equal(readText, book.chapters[0].content);
  assert.ok(calls.some(call => call.task === 'chapter_memory_compaction'));
  assert.ok(book.chapters[0].memorySummary.summary.length <= 800);
  assert.match(book.chapters[0].memorySummary.summary, /本章中段取得关键原件/);
});

test('semantic context budgeting keeps complete records and all unmerged chapter summaries', () => {
  const summaries = Array.from({ length: 5 }, (_, index) => `第${index + 7}章：${'完整语义总结。'.repeat(90)}第${index + 7}章结果终点。`);
  const context = renderSemanticContext({ chapterSummaries: summaries, facts: Array.from({ length: 30 }, () => '重要事实。'.repeat(60)), openLoops: [], characters: [], relevantHistory: [] }, { maxChars: 7000, checkpoint: false });
  assert.ok(context.length <= 7000);
  for (const summary of summaries) assert.ok(context.includes(summary));
  assert.ok(!context || context.endsWith('。'));
});

test('deletion and renumbering invalidates cached source chapter references', async () => {
  const book = novel();
  await ensureSemanticMemory({ novel: book, request: model([]) });
  book.chapters.splice(1, 1);
  book.chapters.forEach((chapter, index) => { chapter.chapterNumber = index + 1; });
  assert.equal(validChapterMemory(book.chapters[1]), null);
  assert.equal(invalidateSemanticMemory(book), true);
});

test('Mongoose persists semantic memory metadata without marking the entire prose array for replacement', async () => {
  const mongoose = require('mongoose');
  const Novel = require('../models/Novel');
  const source = novel(1).chapters[0].content;
  const book = Novel.hydrate({ _id: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(), novelTypeId: 'test', novelTypeName: '测试', chapters: [{ chapterNumber: 1, content: source }] });
  await ensureSemanticMemory({ novel: book, request: model([]), persist: async () => {
    assert.equal(book.directModifiedPaths().includes('chapters'), false);
  } });
  assert.equal(book.chapters[0].memorySummary.sourceHash, hash(source));
  assert.equal(book.validateSync(), undefined);
});
