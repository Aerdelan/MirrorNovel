const { createHash } = require('node:crypto');

const VERSION = 2;
const STAGE_SIZE = 6;
const CHUNK_CHARS = 14000;
const list = value => Array.isArray(value) ? value : [];
const hash = text => createHash('sha256').update(String(text || '')).digest('hex');
const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();

function memoryError(message) {
  const error = new Error(message);
  error.code = 'SEMANTIC_MEMORY_REQUIRED';
  error.resumable = true;
  return error;
}

function parseJson(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('记忆必须为 JSON 对象');
  return value;
}

function requiredText(value, name, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name}缺失或过长`);
  return value.trim();
}

function boundedArray(value, name, max = 12) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${name}格式错误或条目过多`);
  return value;
}

function splitChapterText(content, maxChars = CHUNK_CHARS) {
  const text = String(content || '');
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const window = text.slice(start, end);
      const boundary = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('。'));
      if (boundary > maxChars * 0.7) end = start + boundary + 1;
      // Do not leave an isolated punctuation mark or a tiny tail for a model
      // that must provide a meaningful verbatim evidence quote.
      const minimumTail = Math.min(800, Math.floor(maxChars * 0.15));
      if (text.length - end < minimumTail) end = text.length - minimumTail;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function validChapterMemory(chapter) {
  const memory = chapter?.memorySummary;
  return memory?.version === VERSION && Number(memory.chapterNumber) === Number(chapter.chapterNumber) && memory.sourceHash === hash(chapter.content)
    && typeof memory.summary === 'string' && memory.summary.length > 0
    && Array.isArray(memory.events) && memory.events.length > 0 ? memory : null;
}

function validateChapterPart(content, source, prefix, knownLoops) {
  const data = parseJson(content);
  const summary = requiredText(data.summary, '章节总结', 1200);
  if (summary.length < 20) throw new Error('章节总结信息不足');
  const evidence = row => {
    const quote = requiredText(row?.evidence, '正文证据', 500);
    if (normalize(quote).length < 4 || !normalize(source).includes(normalize(quote))) throw new Error('记忆证据不在本段正文中');
    return quote;
  };
  const items = (field, max = 12) => boundedArray(data[field], field, max).map((row, index) => ({
    id: `${prefix}_${field}_${index}`, text: requiredText(row?.text, field, 360), evidence: evidence(row),
  }));
  const events = items('events', 10);
  if (!events.length) throw new Error('缺少已发生事件');
  const facts = items('facts');
  const openLoops = items('openLoops', 8);
  const characters = boundedArray(data.characters, 'characters', 10).map(row => ({
    name: requiredText(row?.name, '人物名', 60), state: requiredText(row?.state, '人物状态', 360), evidence: evidence(row),
  }));
  const resolvedLoops = boundedArray(data.resolvedLoops, 'resolvedLoops', 10).map(row => {
    const id = requiredText(row?.id, '伏笔ID', 160);
    if (!knownLoops.has(id)) throw new Error('回收了不存在的未决问题');
    return { id, evidence: evidence(row) };
  });
  return { summary, events, facts, characters, openLoops, resolvedLoops };
}

function collectLedger(chapters) {
  const facts = new Map();
  const loops = new Map();
  const characters = new Map();
  for (const chapter of chapters) {
    const memory = validChapterMemory(chapter);
    if (!memory) continue;
    for (const fact of list(memory.facts)) facts.set(fact.id, { ...fact, chapterNumber: chapter.chapterNumber });
    for (const loop of list(memory.openLoops)) loops.set(loop.id, { ...loop, chapterNumber: chapter.chapterNumber });
    for (const resolved of list(memory.resolvedLoops)) loops.delete(resolved.id);
    for (const character of list(memory.characters)) characters.set(character.name, { ...character, chapterNumber: chapter.chapterNumber });
  }
  return { facts: [...facts.values()], openLoops: [...loops.values()], characters: [...characters.values()] };
}

async function validatedRequest(request, task, prompt, validate, onUsage) {
  let reason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await request(task, prompt + (reason ? `\n上次校验失败：${reason}。请重新输出完整 JSON，不能编造证据。` : ''));
    onUsage?.(result);
    try { return validate(result?.content); }
    catch (error) { reason = error instanceof SyntaxError ? 'JSON 不完整或无法解析' : error.message; }
  }
  throw memoryError(`语义记忆校验失败：${reason}`);
}

async function summarizeChapter(chapter, priorChapters, request, onUsage) {
  const source = String(chapter.content || '');
  if (!source.trim()) throw memoryError('章节正文为空，无法总结');
  const sourceHash = hash(source);
  const pending = collectLedger(priorChapters).openLoops;
  const knownLoops = new Set(pending.map(item => item.id));
  const chunks = splitChapterText(source);
  const parts = [];
  for (let index = 0; index < chunks.length; index++) {
    const prefix = `c${chapter.chapterNumber}_${sourceHash.slice(0, 12)}p${index}`;
    const prompt = `你是小说事实记忆整理员。只总结下方已写正文，不续写，不润色，不读取或猜测后续计划。
提炼本段实际发生的行动、选择、因果与结果，人物当前状态和关系变化。facts 只收录重要且已被正文证实的事实；人物猜测、传言、未来打算不能写成既成事实。尚无答案的问题放 openLoops。
每条事件、事实、人物状态和问题都必须附上正文中的一段原文 evidence（4-500字），不可改写或拼接。没有证据的条目不输出。
只有正文确实给出答案，才在 resolvedLoops 中填写下列已有问题的 id 和本段证据；不能因为没提到就认为已解决。
【待核对问题】${JSON.stringify(selectRecords(pending, chunks[index], [], 24).map(item => ({ id: item.id, text: item.text })))}
【章节号】${chapter.chapterNumber}【分段】${index + 1}/${chunks.length}
【正文开始】
${chunks[index]}
【正文结束】
只返回 JSON：{"summary":"200-500字，概括已发生事件与章末状态，不写天气流水账","events":[{"text":"行动、冲突和结果","evidence":"正文原句"}],"facts":[{"text":"已证实事实","evidence":"正文原句"}],"characters":[{"name":"姓名","state":"本段结束时状态/关系/目标","evidence":"正文原句"}],"openLoops":[{"text":"尚未解决的问题","evidence":"正文原句"}],"resolvedLoops":[{"id":"已有问题ID","evidence":"正文确实回收的原句"}]}。
events 1-10条，facts不超过12条，characters不超过10条，openLoops不超过8条，resolvedLoops不超过10条；没有的数组填写 []。`;
    const part = await validatedRequest(request, 'chapter_memory', prompt,
      content => validateChapterPart(content, chunks[index], prefix, knownLoops), onUsage);
    parts.push(part);
    for (const loop of part.openLoops) { pending.push(loop); knownLoops.add(loop.id); }
  }
  let summaries = parts.map(part => part.summary);
  while (summaries.join('\n').length > 800) {
    const compressed = [];
    for (let offset = 0; offset < summaries.length; offset += 8) {
      const group = summaries.slice(offset, offset + 8);
      const summary = await validatedRequest(request, 'chapter_memory_compaction',
        `将同一章各段的语义总结合并成200-400字的完整章节总结，最多800字。保留关键选择、因果转折、后果与章末局面；不能杜撰，不能只保留开头或结尾。只返回 {"summary":"合并后的语义总结"}。\n【各段总结】${JSON.stringify(group)}`,
        content => {
          const value = requiredText(parseJson(content).summary, '合并章节总结', 800);
          if (value.length < 20) throw new Error('合并章节总结信息不足');
          return value;
        }, onUsage);
      compressed.push(summary);
    }
    summaries = compressed;
  }
  return {
    version: VERSION, sourceHash, chapterNumber: Number(chapter.chapterNumber),
    summary: summaries.join('\n'),
    ...Object.fromEntries(['events', 'facts', 'characters', 'openLoops', 'resolvedLoops'].map(field => [field, parts.flatMap(part => part[field])])),
    sourcePartCount: chunks.length, updatedAt: new Date().toISOString(),
  };
}

function checkpointIsCurrent(memory, chapters) {
  if (memory?.version !== VERSION || memory.staleFromChapter || !Array.isArray(memory.sourceHashes)) return false;
  const prefix = chapters.filter(chapter => Number(chapter.chapterNumber) <= Number(memory.checkpointChapter || 0));
  return prefix.length === memory.sourceHashes.length && prefix.every((chapter, index) =>
    Number(chapter.chapterNumber) === Number(memory.sourceHashes[index].chapterNumber)
    && hash(chapter.content) === memory.sourceHashes[index].sourceHash);
}

function semanticSummaryDoc(chapters) {
  return chapters.map(chapter => {
    const memory = validChapterMemory(chapter);
    return memory ? `第${chapter.chapterNumber}章：${memory.summary.replace(/\s+/g, ' ')}` : '';
  }).filter(Boolean).join('\n');
}

/** Persist L1 chapter summaries independently, then merge six chapters into
 * cumulative L2 memory. Failed calls never replace a valid previous snapshot.
 * Old works are upgraded lazily from saved prose, without any DB migration. */
async function ensureSemanticMemory({ novel, throughChapter = Infinity, request, onUsage, persist = async () => {}, onProgress, forceStage = false }) {
  const chapters = list(novel.chapters).filter(chapter => Number(chapter.chapterNumber) <= throughChapter && String(chapter.content || '').trim())
    .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
  if (!chapters.length) return { updated: false, chapters: 0, stages: 0 };
  let summarized = 0;
  let stages = 0;
  for (let index = 0; index < chapters.length; index++) {
    const chapter = chapters[index];
    if (validChapterMemory(chapter)) continue;
    onProgress?.(`正在总结第${chapter.chapterNumber}章的剧情事实（${index + 1}/${chapters.length}）...`);
    const capturedHash = hash(chapter.content);
    const memory = await summarizeChapter(chapter, chapters.slice(0, index), request, onUsage);
    if (hash(chapter.content) !== capturedHash) throw memoryError('正文在总结期间发生修订，请重新更新记忆');
    chapter.memorySummary = memory;
    const indexInNovel = novel.chapters.indexOf(chapter);
    novel.markModified?.(`chapters.${indexInNovel}.memorySummary`);
    await persist();
    summarized++;
  }
  let base = checkpointIsCurrent(novel.contextMemory, chapters) ? novel.contextMemory : {
    version: VERSION, checkpointChapter: 0, checkpointSummary: '', sourceHashes: [],
    facts: [], openLoops: [], factLedger: [], loopLedger: [], characters: [],
  };
  let pending = chapters.filter(chapter => Number(chapter.chapterNumber) > Number(base.checkpointChapter || 0));
  while (pending.length >= STAGE_SIZE || (forceStage && pending.length)) {
    const batch = pending.slice(0, STAGE_SIZE);
    const end = Number(batch.at(-1).chapterNumber);
    const covered = chapters.filter(chapter => Number(chapter.chapterNumber) <= end);
    const ledger = collectLedger(covered);
    // The durable ledger is complete. Only bounded indexes are sent back to
    // the model; never resend a growing whole-book ledger at every merge.
    const first = Number(batch[0].chapterNumber);
    const factIndex = [...new Map(ledger.facts.filter(item => item.chapterNumber >= first || list(base.focusFactIds).includes(item.id))
      .map(item => [normalize(item.text), item])).values()].slice(-48);
    const loopIndex = [...new Map([
      ...ledger.openLoops.slice(0, 16), ...ledger.openLoops.slice(-32),
      ...ledger.openLoops.filter(item => list(base.focusLoopIds).includes(item.id)),
    ].map(item => [item.id, item])).values()].slice(0, 40);
    const allowedFacts = new Set(factIndex.map(item => item.id));
    const allowedLoops = new Set(loopIndex.map(item => item.id));
    onProgress?.(`正在合并截至第${end}章的阶段记忆...`);
    const prompt = `你是长篇小说阶段记忆编辑。将旧阶段记忆与新增的逐章语义总结合并，形成截至第${end}章的累计故事记忆。
只归纳已经发生的事件、因果转折、人物关系和当前局面，不预测后文，不把人物猜测写成事实。不能用概括性口号替代具体变化。
旧的重要事实和未决问题不能因为本批未提及就消失；未决问题账本已按逐章证据核对回收，不得擅自宣布解决。
【上一版阶段记忆】${base.checkpointSummary || '无，首次建立'}
【新增章节总结】${JSON.stringify(batch.map(chapter => ({ chapterNumber: chapter.chapterNumber, summary: chapter.memorySummary.summary, characters: chapter.memorySummary.characters.map(({ name, state }) => ({ name, state })) })))}
【重要事实索引】${JSON.stringify(factIndex.map(item => ({ id: item.id, text: item.text })))}
【仍未解决的问题索引】${JSON.stringify(loopIndex.map(item => ({ id: item.id, text: item.text })))}
只返回 {"summary":"600-1500字累计记忆：保留起因、重要转折、代价与结果、人物目前状态，最多4000字","focusFactIds":["最重要的事实ID，最多24个"],"focusLoopIds":["最重要的未决问题ID，最多24个"]}。ID只能来自提供的索引，完整账本由程序保留，不能臆造事实或问题。`;
    const result = await validatedRequest(request, 'stage_memory', prompt, content => {
      const data = parseJson(content);
      const summary = requiredText(data.summary, '阶段记忆', 4000);
      if (summary.length < 40) throw new Error('阶段记忆信息不足');
      const ids = (field, allowed) => boundedArray(data[field], field, 24).map(id => {
        if (typeof id !== 'string' || !allowed.has(id)) throw new Error('阶段记忆引用了不存在的事实或问题');
        return id;
      });
      return { summary, focusFactIds: ids('focusFactIds', allowedFacts), focusLoopIds: ids('focusLoopIds', allowedLoops) };
    }, onUsage);
    base = {
      version: VERSION, checkpointChapter: end, checkpointSummary: result.summary,
      sourceHashes: covered.map(chapter => ({ chapterNumber: Number(chapter.chapterNumber), sourceHash: hash(chapter.content) })),
      factLedger: ledger.facts, loopLedger: ledger.openLoops, characters: ledger.characters,
      focusFactIds: result.focusFactIds, focusLoopIds: result.focusLoopIds,
      facts: ledger.facts.map(item => `第${item.chapterNumber}章：${item.text}`),
      openLoops: ledger.openLoops.map(item => `第${item.chapterNumber}章：${item.text}`),
      updatedAt: new Date().toISOString(),
    };
    novel.contextMemory = base;
    novel.markModified?.('contextMemory');
    await persist();
    stages++;
    pending = pending.slice(batch.length);
  }
  // A book with fewer than six chapters has full L1 semantic summaries; there
  // is no need to fabricate an L2 checkpoint or pay for a merge every chapter.
  let metadataChanged = false;
  if (novel.contextMemory !== base) {
    novel.contextMemory = base;
    novel.markModified?.('contextMemory');
    metadataChanged = true;
  }
  const document = semanticSummaryDoc(chapters.slice(-8));
  if (novel.chapterSummaryDoc !== document) {
    novel.chapterSummaryDoc = document;
    novel.markModified?.('chapterSummaryDoc');
    metadataChanged = true;
  }
  if (metadataChanged) await persist();
  return { updated: summarized > 0 || stages > 0, chapters: summarized, stages };
}

function invalidateSemanticMemory(novel) {
  const memory = novel.contextMemory;
  if (memory?.version !== VERSION) return false;
  const chapters = list(novel.chapters).slice().sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
  if (checkpointIsCurrent(memory, chapters)) return false;
  const current = new Map(chapters.map(chapter => [Number(chapter.chapterNumber), hash(chapter.content)]));
  const firstChanged = list(memory.sourceHashes).find(item => current.get(Number(item.chapterNumber)) !== item.sourceHash);
  memory.staleFromChapter = Number(firstChanged?.chapterNumber || 1);
  novel.markModified?.('contextMemory');
  return true;
}

function selectRecords(records, query, focusIds = [], limit = 14) {
  const text = String(query || '');
  const unique = [...new Map(records.map(item => [normalize(item.text), item])).values()];
  return unique.map((item, index) => {
    const phrases = String(item.text || '').match(/[\u4e00-\u9fff]+|[A-Za-z0-9_]{2,}/g) || [];
    const terms = [...new Set(phrases.flatMap(phrase => /^[\u4e00-\u9fff]+$/.test(phrase)
      ? Array.from({ length: Math.max(0, phrase.length - 1) }, (_, i) => phrase.slice(i, i + 2)) : [phrase]))];
    return { item, score: terms.reduce((score, term) => score + (text.includes(term) ? 4 : 0), 0)
    + (focusIds.includes(item.id) ? 3 : 0) + index / Math.max(1, unique.length) };
  })
    .sort((a, b) => b.score - a.score).slice(0, limit).map(({ item }) => item);
}

function relevantRecords(records, query, focusIds = [], limit = 14) {
  return selectRecords(records, query, focusIds, limit).map(item => `第${item.chapterNumber}章：${item.text}`);
}

function buildSemanticContext({ chapters = [], contextMemory = {}, currentChapter = Infinity, query = '' }) {
  const completed = chapters.filter(chapter => Number(chapter.chapterNumber) < currentChapter).sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
  const current = checkpointIsCurrent(contextMemory, completed);
  const checkpoint = current ? Number(contextMemory.checkpointChapter) : 0;
  const pending = completed.filter(chapter => Number(chapter.chapterNumber) > checkpoint);
  const ledger = collectLedger(completed);
  return {
    version: VERSION, checkpointChapter: checkpoint, checkpointSummary: current ? contextMemory.checkpointSummary : '',
    chapterSummaryDoc: semanticSummaryDoc(pending),
    chapterSummaries: pending.map(chapter => ({ chapterNumber: chapter.chapterNumber, memory: validChapterMemory(chapter) }))
      .filter(item => item.memory).map(item => `第${item.chapterNumber}章：${item.memory.summary}`),
    facts: relevantRecords(ledger.facts, query, current ? contextMemory.focusFactIds : []),
    openLoops: relevantRecords(ledger.openLoops, query, current ? contextMemory.focusLoopIds : []),
    characters: ledger.characters.slice(-12).map(item => `${item.name}（第${item.chapterNumber}章）：${item.state}`),
    relevantHistory: relevantRecords(completed.flatMap(chapter => list(validChapterMemory(chapter)?.events).map(event => ({ ...event, chapterNumber: chapter.chapterNumber }))), query, [], 4),
  };
}

// Pack whole semantic records. Budgeting may select fewer historical records,
// but must never turn a semantic summary back into a cut-off opening sentence.
function renderSemanticContext(memory, { maxChars = 10000, checkpoint = true, recent = true } = {}) {
  const blocks = [];
  let used = 0;
  const add = (label, text) => {
    if (!text) return;
    const block = `${label}\n${text}`;
    if (used + block.length + 2 > maxChars) return;
    blocks.push(block);
    used += block.length + 2;
  };
  add('【正文事实记忆】', '以下记忆来自已写正文；计划不等于已发生事实，未列出的历史信息不代表未发生或已经解决。');
  if (checkpoint && memory.checkpointSummary) add(`【阶段记忆检查点｜截至第${memory.checkpointChapter}章】`, memory.checkpointSummary);
  if (recent) for (const summary of list(memory.chapterSummaries)) add('【已写章节语义总结】', summary);
  const fields = [['【不可遗忘事实】', memory.facts], ['【当前开放剧情线】', memory.openLoops],
    ['【正文确认的人物状态】', memory.characters], ['【相关历史事件】', memory.relevantHistory]];
  for (let index = 0; index < 14; index++) {
    for (const [label, records] of fields) add(label, list(records)[index]);
  }
  return blocks.join('\n\n');
}

module.exports = { VERSION, STAGE_SIZE, hash, splitChapterText, validChapterMemory, validateChapterPart,
  collectLedger, ensureSemanticMemory, invalidateSemanticMemory, checkpointIsCurrent, buildSemanticContext, renderSemanticContext };
