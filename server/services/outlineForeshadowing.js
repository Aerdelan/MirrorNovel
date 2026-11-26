const SCHEDULE_HEADING = /^伏笔(?:与|及)?回收表[：:]?$/;
const NEXT_SECTION = /^(?:结局方向|结局设计|结局规划|关键节点|角色规划|人物规划|故事主线|剧情阶段|支线与人物关系网)[：:]?$/;
const HOOK_TITLE = /^伏笔\s*[\d一二三四五六七八九十百]*\s*[：:｜|]\s*(.+)$/;

function unwrapEmphasis(value) {
  return value.trim().replace(/^\*\*(.+)\*\*$/, '$1').trim();
}

function fieldType(label) {
  if (/^(?:埋设|埋下|铺设|设置)(?:章节|章号|章)$/.test(label)) return 'setup';
  if (/^(?:推进|发展|强化)(?:章节|章号|章)$/.test(label)) return 'progress';
  if (/^(?:回收|兑现|揭晓)(?:章节|章号|章)$/.test(label)) return 'payoff';
  if (/^(?:表面解释|真实含义|伏笔计划|计划|说明)$/.test(label)) return 'description';
  return '';
}

function chapterEndpoints(value, totalChapters) {
  // Explanations after a chapter can mention other chapters. Only parse the
  // explicit list outside parentheses and keep range endpoints as authored.
  let depth = 0;
  let list = '';
  for (const char of value) {
    if (char === '(' || char === '（') depth++;
    else if (char === ')' || char === '）') {
      if (depth === 0) return null;
      depth--;
    } else if (depth === 0) list += char;
  }
  if (depth) return null;
  const endpoints = [];
  for (const part of list.trim().replace(/[。.]$/, '').split(/[、，,；;\/]|以及|及|和|与/)) {
    const match = part.trim().match(/^(?:第\s*)?(\d+)\s*(?:章\s*)?(?:[-－–—~～至到]\s*(?:第\s*)?(\d+)\s*章?)?$/);
    if (!match) return null;
    const first = Number(match[1]);
    const last = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > totalChapters) return null;
    endpoints.push(first, last);
  }
  return endpoints;
}

function makeHook(row, totalChapters) {
  if (!row?.name) return null;
  const chapters = { setup: [], progress: [], payoff: [] };
  for (const { type, value } of row.fields) {
    if (type === 'description') continue;
    if (type === 'progress' && /^(?:无|暂无|—|-)\s*[。.]?$/.test(value)) continue;
    const endpoints = chapterEndpoints(value, totalChapters);
    if (!endpoints) return null;
    chapters[type].push(...endpoints);
  }
  if (!chapters.setup.length || !chapters.payoff.length) return null;
  const setupChapter = Math.min(...chapters.setup);
  const payoffChapter = Math.max(...chapters.payoff);
  if (Math.max(...chapters.setup) > Math.min(...chapters.payoff)
    || chapters.progress.some(chapter => chapter < setupChapter || chapter > payoffChapter)) return null;
  const progressChapters = [...new Set([...chapters.setup, ...chapters.progress, ...chapters.payoff])]
    .filter(chapter => chapter > setupChapter && chapter < payoffChapter).sort((a, b) => a - b);
  const plan = row.fields.map(({ label, value }) => `${label}：${value}`).join('\n');
  return { name: row.name, setupChapter, progressChapters, payoffChapter, plan };
}

function readOutlineForeshadowing(outline, totalChapters) {
  if (typeof outline !== 'string' || !Number.isSafeInteger(totalChapters) || totalChapters < 1) return [];
  const hooks = new Map();
  let section = null;
  let row = null;
  let table = null;
  const store = entry => {
    const hook = makeHook(entry, totalChapters);
    if (!hook) return;
    const key = hook.name.replace(/\s+/g, '');
    if (!hooks.has(key)) hooks.set(key, hook);
    else {
      const previous = hooks.get(key);
      if (previous && (previous.setupChapter !== hook.setupChapter || previous.payoffChapter !== hook.payoffChapter
        || previous.progressChapters.join() !== hook.progressChapters.join())) hooks.set(key, null);
    }
  };

  for (const raw of outline.split(/\r?\n/)) {
    const markdown = raw.trim().match(/^(#{1,6})\s+(.+?)\s*#*$/);
    const line = unwrapEmphasis((markdown?.[2] || raw).replace(/^\s*(?:[-+*•]\s+|\d+[.、]\s*)/, ''));
    const bracket = line.match(/^【(.+)】$/);
    const heading = bracket?.[1].trim() || line;
    if (SCHEDULE_HEADING.test(heading)) {
      store(row);
      section = { depth: markdown?.[1].length || 6 };
      row = table = null;
      continue;
    }
    if (!section || !line) continue;
    const name = heading.match(HOOK_TITLE)?.[1];
    if (name) {
      store(row);
      row = { name: unwrapEmphasis(name), fields: [] };
      table = null;
    } else if (bracket || NEXT_SECTION.test(heading) || (markdown && markdown[1].length <= section.depth)) {
      store(row);
      section = row = table = null;
    } else if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.slice(1, -1).split('|').map(unwrapEmphasis);
      const nameIndex = cells.findIndex(cell => /^(?:伏笔|伏笔名称|伏笔名)$/.test(cell));
      const types = cells.map(fieldType);
      if (nameIndex >= 0 && types.includes('setup') && types.includes('payoff')) {
        store(row);
        row = null;
        table = { labels: cells, types, nameIndex };
      } else if (table && cells.length === table.labels.length && !cells.every(cell => /^:?-{2,}:?$/.test(cell))) {
        const fields = table.types.flatMap((type, index) => type && cells[index]
          ? [{ type, label: table.labels[index], value: cells[index] }] : []);
        store({ name: cells[table.nameIndex], fields });
      }
    } else if (row) {
      const field = line.match(/^([^：:]+)[：:]\s*(.+)$/);
      if (!field) continue;
      const label = unwrapEmphasis(field[1]);
      const type = fieldType(label);
      if (type) row.fields.push({ type, label, value: field[2].trim() });
    }
  }
  store(row);
  return [...hooks.values()].filter(Boolean);
}

module.exports = { readOutlineForeshadowing };
