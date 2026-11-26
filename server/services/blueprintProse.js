// Model-facing blueprints are readable prose. Only headings identify chapter
// ranges; narrative content stays intact instead of requiring nested JSON keys.
const { inspectStructuredPayload } = require('./blueprintPayload');

function prosePrompt({ context, instruction, name, field, failure, requiredTags }) {
  // Keep task context (confirmed anchors, previous results), remove the old
  // output-schema example and everything following it. JSON in references is
  // input data, never a requirement on the model's response.
  const reference = instruction.split(/返回(?:包含|结构示例|一个完整JSON对象|\{)/)[0];
  const formats = {
    mainArc: '【故事主线】\n用自然语言说明主线因果与终局。\n【已定事实】\n逐行摘取用户已明确的事实；没有则写“无”。\n【篇章｜第1-6章｜具体标题】\n一段具体剧情规划。按本次任务要求列齐所有篇章、写清各自范围，示例章号不是固定值。',
    lockedFacts: '【已定事实】\n逐行摘取用户已明确的事实；没有则写“无”。',
    phase: '【篇章｜第1-6章｜具体标题】\n写本次要求的一个篇章，示例章号需替换为本次实际范围。篇章只覆盖一章时，用【篇章｜第1章｜具体标题】。',
    phases: '【篇章｜第1-6章｜具体标题】\n写该篇章的剧情规划。每个要求的篇章另起一个同类标题，不能合并或漏掉，示例章号需替换为本次实际范围。',
    chapters: '【第1章｜具体标题】\n写本章新发生的事件、人物选择、关系变化与章末局面。按本次要求逐章列齐，不合并章节。',
  };
  return `${context}\n\n【本次任务：${name}】\n${reference}\n
【输出方式】使用中文分段文本，不输出JSON、代码围栏或英文键名。格式如下：
${formats[field] || formats.phases}
每个篇章写150-500字，执行章写80-200字。写清发生什么、谁作出什么选择、付出什么代价、局面如何变化，以及如何承接前后剧情。可自然穿插场景、人物声线、伏笔及回收、未解问题和不应偏离的设定，不要求分字段逐项填写，也不强制嵌套小阶段。
所选标签：${requiredTags.join('、') || '无'}。在合适篇章中用标签原名说明具体兑现方式，不能只把标签抄成清单。
${failure ? `【仅补齐缺失字段或本块剧情】上次未完成的问题：${failure.errors.join('；')}。只重写本次任务，返回完整的分段文本。` : ''}`;
}

function heading(line) {
  const value = line.trim().replace(/^#{1,6}\s*/, '').replace(/^\*\*(.*?)\*\*$/, '$1');
  return value.replace(/^【(.*)】$/, '$1').trim();
}

function parseBlueprintProse(text, field, requiredTags = []) {
  // Preserve compatibility with providers that keep returning the old format.
  const legacy = inspectStructuredPayload(text, field);
  if (legacy.parsed || /^\s*(?:```(?:json)?\s*)?[{[]/.test(text)) return legacy;
  const result = { phases: [], chapters: [] };
  let section = '', target = null;
  for (const raw of String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').split(/\r?\n/)) {
    const line = raw.trim();
    const title = heading(line);
    if (/^(?:故事主线|全书主线|主线)[：:]?$/.test(title)) { section = 'mainArc'; target = null; result.mainArc = ''; continue; }
    if (/^(?:已定事实|不可改写的设定|不可改写事实|固定事实)[：:]?$/.test(title)) { section = 'lockedFacts'; target = null; result.lockedFacts = []; continue; }
    const range = title.match(/^(?:篇章|大篇章|小阶段)(?:\s*\d+(?:\.\d+)?)?\s*[｜|：:]?\s*第?\s*(\d+)(?:\s*[-—–~～至到]\s*(\d+))?\s*章\s*[｜|：:]?\s*(.*)$/);
    const chapter = title.match(/^(?:执行章\s*|第\s*)(\d+)\s*章?\s*[｜|：:]\s*(.+)$/);
    const singleChapterPhase = field === 'phase' && chapter && /^第/.test(title);
    if (range || singleChapterPhase) {
      const startChapter = Number(range?.[1] ?? chapter[1]);
      target = { title: (range?.[3] ?? chapter[2]).trim(), startChapter, endChapter: Number(range?.[2] ?? startChapter), planText: '' };
      if (/^小阶段/.test(title) && result.phases.length) (result.phases.at(-1).subphases ||= []).push(target);
      else result.phases.push(target);
      section = 'stage'; continue;
    }
    if (chapter) {
      target = { chapterNumber: Number(chapter[1]), title: chapter[2].trim(), planText: '' };
      result.chapters.push(target); section = 'chapter'; continue;
    }
    if (section === 'mainArc') result.mainArc += `${result.mainArc ? '\n' : ''}${raw}`;
    else if (section === 'lockedFacts') {
      const fact = line.replace(/^(?:[-*•]\s*|\d+[.、]\s*)/, '');
      if (fact && !/^(?:无|暂无|无明确事实)[。.]?$/.test(fact)) result.lockedFacts.push(fact);
    } else if (target) target.planText += `${target.planText ? '\n' : ''}${raw}`;
  }
  for (const stage of [...result.phases, ...result.phases.flatMap(item => item.subphases || []), ...result.chapters]) {
    stage.planText = stage.planText.trim();
    const first = stage.planText.split('\n').find(line => line.trim()) || '';
    const summary = first.replace(/^(?:目标|阶段目标|剧情|本章事件|章节目的)[：:]\s*/, '').slice(0, 420);
    if (stage.chapterNumber) stage.purpose = summary;
    else stage.goal = summary;
    stage.tagCommitments = requiredTags.filter(tag => stage.planText.includes(tag));
  }
  if (result.mainArc !== undefined) result.mainArc = result.mainArc.trim();
  if (field === 'phase' && result.phases.length === 1) result.phase = result.phases[0];
  if (field === 'mainArc' && result.mainArc) result.lockedFacts ||= [];
  const found = field === 'mainArc' ? Boolean(result.mainArc)
    : field === 'lockedFacts' ? Array.isArray(result.lockedFacts)
      : field === 'phase' ? Boolean(result.phase) : Boolean(result[field]?.length);
  return found ? { parsed: result, prose: true, reason: null, documentCount: 0, foundKeys: [] }
    : { parsed: null, reason: text.trim() ? 'invalid_text' : 'empty_output', documentCount: 0, foundKeys: [] };
}

module.exports = { prosePrompt, parseBlueprintProse };
