const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hash, splitChapterText, validChapterMemory, collectLedger, ensureSemanticMemory,
  invalidateSemanticMemory, buildSemanticContext,
  renderSemanticContext,
} = require('../services/semanticMemory');
const { compileChapterExecutionPackage } = require('../services/novelContext');
const { buildContinuePrompt } = require('../services/aiService');

test('single-chapter continuation without a semantic cache retains the saved ending instead of only the opening', () => {
  const book = { protagonistName: '林舟', chapters: [{ chapterNumber: 1, wordCount: 6000,
    content: '旧邮局的开场。'.repeat(800) + '章末唯一事实：林舟已经离开邮局，把铜钥匙交给了苏晚。' }],
    contextMemory: { version: 1, checkpointSummary: '过期记忆不应注入' } };
  const prompt = buildContinuePrompt('test', book);
  assert.match(prompt, /章末唯一事实：林舟已经离开邮局，把铜钥匙交给了苏晚/);
  assert.match(prompt, /已保存正文摘录/);
  assert.doesNotMatch(prompt, /过期记忆不应注入/);
  assert.doesNotMatch(prompt, /标注【未完待续】/);
});

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
  assert.doesNotMatch(calls[1].prompt, /原文证据编号表/);
  assert.deepEqual(book.chapters[0].memorySummary, before);
  assert.equal(book.contextMemory.checkpointSummary, '旧记忆');
});

test('a deferred chapter retries after more chapters are saved without blocking later summaries or skipping a stage gap', async () => {
  const book = novel(6);
  const earlierCheckpoint = structuredClone(book.contextMemory);
  const calls = [];
  const progress = [];
  let failFirst = true;
  const request = model(calls, (task, prompt) => {
    if (failFirst && task === 'chapter_memory' && prompt.includes('【章节号】1【')) {
      return chapterResponse(prompt, { events: [{ text: '未经证实的行动', evidence: '这段证据从未出现在小说中' }] });
    }
  });
  const ensure = () => ensureSemanticMemory({ novel: book, request, retryInvalidAfterChapters: 6, onProgress: event => progress.push(event) });

  await ensure();
  assert.equal(calls.length, 7);
  assert.match(calls[1].prompt, /1–3 条关键已发生事件/);
  assert.match(progress.find(event => event.includes('待补齐')), /记忆证据不在本段正文中/);
  assert.deepEqual(book.contextMemory, earlierCheckpoint);
  assert.equal(validChapterMemory(book.chapters[0]), null);
  assert.ok(book.chapters.slice(1).every(validChapterMemory));
  assert.deepEqual(book.chapters[0].memorySummary.validationRetry, { sourceHash: hash(book.chapters[0].content), afterChapter: 12 });
  assert.deepEqual(buildSemanticContext({ chapters: book.chapters, contextMemory: book.contextMemory }).pendingChapterNumbers, [1]);

  // Simulate reloading the book from storage before new chapters arrive.
  book.chapters = structuredClone(book.chapters);
  failFirst = false;
  book.chapters.push(...novel(11).chapters.slice(6));
  calls.length = 0;
  await ensure();
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => call.task === 'chapter_memory' && !call.prompt.includes('【章节号】1【')));
  assert.deepEqual(book.contextMemory, earlierCheckpoint);

  book.chapters.push(novel(12).chapters[11]);
  calls.length = 0;
  await ensure();
  assert.deepEqual(calls.map(call => call.task), ['chapter_memory', 'chapter_memory', 'stage_memory', 'stage_memory']);
  assert.equal(book.contextMemory.checkpointChapter, 12);
  assert.ok(validChapterMemory(book.chapters[0]));
  assert.equal(book.chapters[0].memorySummary.validationRetry, undefined);
});

test('chapter memory cooldown propagates cancellation and save errors', async () => {
  const book = novel(1);
  const cancel = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  const saveError = new Error('unable to save validation retry');
  const run = (request, persist) => ensureSemanticMemory({ novel: book, request, persist, retryInvalidAfterChapters: 6 });
  await assert.rejects(run(async () => { throw cancel; }), error => error === cancel);
  assert.equal(book.chapters[0].memorySummary, undefined);
  await assert.rejects(run(async () => ({ content: '{}' }), async () => { throw saveError; }), error => error === saveError);
});

test('long-book chapter retries can select numbered verbatim evidence; out-of-range IDs are rejected', async (t) => {
  for (const validSelection of [true, false]) {
    await t.test(validSelection ? 'expands a valid selection alongside verbatim evidence' : 'defers after an invalid selection', async () => {
      const book = novel(1);
      const source = book.chapters[0].content + Array.from({ length: 45 }, (_, index) => `林舟检查了第${index + 1}间档案室。`).join('');
      book.chapters[0].content = source;
      const calls = [];
      const progress = [];
      let selected;
      await ensureSemanticMemory({ novel: book, retryInvalidAfterChapters: 6, onProgress: event => progress.push(event),
        request: model(calls, (_task, prompt) => {
          const table = prompt.split('【原文证据编号表】\n')[1];
          if (!table) return chapterResponse(prompt, { events: [{ text: '错误证据', evidence: '书中不存在的内容' }] });
          const snippets = JSON.parse(table);
          assert.equal(snippets.length, 24);
          assert.ok(snippets.every((snippet, index) => snippet.evidenceId === index + 1 && source.includes(snippet.text)));
          assert.match(snippets.at(-1).text, /第45间档案室/);
          selected = snippets.at(-1);
          return chapterResponse(prompt, { events: [
            { text: '林舟检查了档案室', evidenceId: validSelection ? selected.evidenceId : selected.evidenceId + 1 },
            { text: '林舟拿到铜钥匙', evidence: snippets[0].text },
          ] });
        }),
      });
      assert.equal(calls.length, 2);
      const memory = validChapterMemory(book.chapters[0]);
      if (validSelection) {
        assert.equal(memory.events[0].evidence, selected.text);
        assert.match(memory.events[1].evidence, /铜钥匙/);
        assert.equal(memory.events[0].evidenceId, undefined);
      } else {
        assert.equal(memory, null);
        assert.match(progress.at(-1), /正文证据编号无效/);
      }
    });
  }
});

test('a single markdown JSON wrapper and omitted optional records do not block valid chapter memory', async () => {
  const book = novel(1);
  const calls = [];
  await ensureSemanticMemory({ novel: book, request: model(calls, (_task, prompt) => {
    const response = JSON.parse(chapterResponse(prompt).content);
    for (const field of ['facts', 'characters', 'openLoops', 'resolvedLoops']) delete response[field];
    return { content: `以下是根据正文整理的结果：\n\n\`\`\`json\n${JSON.stringify(response)}\n\`\`\`\n整理完毕。` };
  }) });
  assert.equal(calls.length, 1, 'valid content does not require a paid validation retry');
  const memory = validChapterMemory(book.chapters[0]);
  assert.ok(memory);
  for (const field of ['facts', 'characters', 'openLoops', 'resolvedLoops']) assert.deepEqual(memory[field], []);
  assert.equal(memory.events.length, 1);
});

test('missing required events or malformed optional records remain validation errors', async (t) => {
  for (const patch of [{ events: undefined }, { facts: null }, { characters: {} }, { resolvedLoops: 'none' }]) {
    await t.test(JSON.stringify(patch), async () => {
      const book = novel(1);
      const calls = [];
      await assert.rejects(ensureSemanticMemory({ novel: book,
        request: model(calls, (_task, prompt) => chapterResponse(prompt, patch)),
      }), error => error.code === 'SEMANTIC_MEMORY_REQUIRED');
      assert.equal(calls.length, 2);
      assert.equal(book.chapters[0].memorySummary, undefined);
    });
  }
});

test('JSON evidence containing literal markdown fences is kept unchanged', async () => {
  const book = novel(1);
  book.chapters[0].content += '苏晚在纸上原样写下了```json```作为记录标记。';
  await ensureSemanticMemory({ novel: book, request: model([], (_task, prompt) => chapterResponse(prompt, {
    facts: [{ text: '苏晚写下记录标记', evidence: '苏晚在纸上原样写下了```json```作为记录标记。' }],
  })) });
  assert.equal(book.chapters[0].memorySummary.facts[0].evidence, '苏晚在纸上原样写下了```json```作为记录标记。');
});

test('omitted stage focus indexes keep the complete verified ledger', async () => {
  const book = novel();
  await ensureSemanticMemory({ novel: book, request: model([], task => task === 'stage_memory'
    ? { content: JSON.stringify({ summary: '林舟逐步追查失踪证人，在寻找铜钥匙的过程中不断得到新证据，苏晚保管着记录，两人将继续核对已有线索。' }) }
    : undefined) });
  assert.equal(book.contextMemory.checkpointChapter, 6);
  assert.equal(book.contextMemory.factLedger.length, 6);
  assert.deepEqual(book.contextMemory.focusFactIds, []);
  assert.deepEqual(book.contextMemory.focusLoopIds, []);
});

test('older cached chapter memory without optional character indexes can still merge', async () => {
  const book = novel();
  await ensureSemanticMemory({ novel: book, request: model([]) });
  for (const chapter of book.chapters) delete chapter.memorySummary.characters;
  book.contextMemory = { version: 1 };
  const calls = [];
  await ensureSemanticMemory({ novel: book, request: model(calls) });
  assert.deepEqual(calls.map(call => call.task), ['stage_memory']);
  assert.equal(book.contextMemory.checkpointChapter, 6);
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

test('a partial memory outage retains recent committed prose without stale summaries or future chapters', async () => {
  const book = novel(1);
  await ensureSemanticMemory({ novel: book, request: model([]) });
  const second = { chapterNumber: 2, content: '苏晚把唯一原件交给林舟，两人决定立即离开旧邮局。' };
  const future = { chapterNumber: 3, content: '尚未应进入当前提示词的未来情节。' };
  book.chapters.push(second, future);
  const semantic = buildSemanticContext({ chapters: book.chapters, contextMemory: book.contextMemory, currentChapter: 3 });
  assert.deepEqual(semantic.pendingChapterNumbers, [2]);
  assert.equal(semantic.pendingChapterExcerpts[0].content, second.content);
  const compiled = compileChapterExecutionPackage({ chapters: book.chapters, contextMemory: book.contextMemory,
    currentChapter: 3, chapterSummaryDoc: '过期旧摘要：原件仍在苏晚手上。',
  });
  assert.match(compiled.dynamicContext, /第1章：/);
  assert.match(compiled.dynamicContext, /已保存正文摘录/);
  assert.match(compiled.dynamicContext, /并非摘要/);
  assert.ok(compiled.dynamicContext.includes(second.content));
  assert.doesNotMatch(compiled.dynamicContext, /过期旧摘要|未来情节/);
});

test('legacy works with no semantic summaries use bounded source excerpts and preserve the latest ending', () => {
  const book = novel(7);
  book.contextMemory = { version: 1, checkpointSummary: '过期的阶段记忆不能进入提示词' };
  book.chapters[6].content = '最新章开头。' + '动作与冲突。'.repeat(1200) + '结尾唯一状态：林舟带走原件，苏晚留在门外。';
  const semantic = buildSemanticContext({ chapters: book.chapters, contextMemory: book.contextMemory, currentChapter: 8 });
  assert.deepEqual(semantic.pendingChapterNumbers, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(semantic.pendingChapterExcerpts.map(item => item.chapterNumber), [5, 6, 7]);
  assert.ok(semantic.pendingChapterExcerpts.every(item => item.content.length <= 1800));
  const compiled = compileChapterExecutionPackage({ chapters: book.chapters, contextMemory: book.contextMemory,
    chapterSummaryDoc: '过期的逐章摘要不能进入提示词', maxDynamicChars: 900, currentChapter: 8,
  });
  assert.ok(compiled.dynamicChars <= 900);
  assert.match(compiled.dynamicContext, /有7章尚无有效语义总结/);
  assert.match(compiled.dynamicContext, /第7章｜已保存正文摘录/);
  assert.match(compiled.dynamicContext, /结尾唯一状态：林舟带走原件，苏晚留在门外/);
  assert.doesNotMatch(compiled.dynamicContext + compiled.stableContext, /过期的阶段记忆|过期的逐章摘要/);
});

test('edited chapters use current source text while preserving but excluding old snapshots', async () => {
  const book = novel();
  await ensureSemanticMemory({ novel: book, request: model([]) });
  const oldCheckpoint = structuredClone(book.contextMemory);
  const oldChapterMemory = structuredClone(book.chapters[5].memorySummary);
  book.chapters[5].content = '林舟发现记录是伪造的，于是撕毁副本，带走原件与苏晚离开。';
  const compiled = compileChapterExecutionPackage({ chapters: book.chapters, contextMemory: book.contextMemory, currentChapter: 7 });
  assert.match(compiled.dynamicContext, /记录是伪造的/);
  assert.doesNotMatch(compiled.stableContext, /阶段记忆检查点/);
  assert.deepEqual(book.contextMemory, oldCheckpoint, 'building prompts must not overwrite durable snapshots');
  assert.deepEqual(book.chapters[5].memorySummary, oldChapterMemory);
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

test('a stage-merge outage cannot push the newest chapter summaries out of the prompt budget', async () => {
  const book = novel(12);
  await assert.rejects(ensureSemanticMemory({ novel: book, request: model([], (task, prompt) => {
    if (task === 'stage_memory') return { content: 'invalid JSON' };
    if (task !== 'chapter_memory') return;
    const number = Number(prompt.match(/【章节号】(\d+)/)[1]);
    return chapterResponse(prompt, { summary: '本章行动、冲突与后果。'.repeat(20) + `第${number}章结果终点。` });
  }) }), error => error.code === 'SEMANTIC_MEMORY_REQUIRED');
  assert.ok(book.chapters.every(validChapterMemory));
  const compiled = compileChapterExecutionPackage({ chapters: book.chapters, contextMemory: book.contextMemory,
    currentChapter: 13, maxDynamicChars: 1000,
  });
  assert.ok(compiled.dynamicContext.length <= 1000);
  assert.match(compiled.dynamicContext, /第12章结果终点/);
  assert.match(compiled.dynamicContext, /第11章结果终点/);
  assert.doesNotMatch(compiled.dynamicContext, /第1章结果终点/);
  assert.ok(compiled.dynamicContext.indexOf('第11章结果终点') < compiled.dynamicContext.indexOf('第12章结果终点'));
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
