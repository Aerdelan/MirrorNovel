const VOICE_SECTION = '人物声音表';
const OTHER_SECTION = /^(?:故事主线|核心冲突|主要角色|剧情阶段|支线与人物关系网|伏笔与回收表|结局方向|关键节点)$/;
const EXAMPLE_HEADING = /^同场(?:对话)?差异(?:示例|样例)(?:[（(].*[）)])?\s*[：:]?$/;
const VOICE_FIELD = /^(常用词汇(?:范围)?|词汇(?:范围)?|句长|句子长短|称呼礼貌|礼貌\s*[/／]\s*称呼习惯|称呼习惯|礼貌程度|遇到冲突时会说|冲突反应|刻意不说|回避点|情绪失控后|失控变化|说话方式|说话习惯|声线)\s*[：:]\s*(.*)$/;
const CHARACTER_NAME = /^\p{L}[\p{L}\p{M}\p{N} .·・'’_-]{0,39}$/u;
const MAX_SECTION_LINES = 320;
const MAX_PROFILES = 24;
const MAX_RULES = 8;
const MAX_RULE_LENGTH = 180;

function readLine(raw) {
  const trimmed = raw.trim();
  const heading = /^(#{1,6})\s+/.exec(trimmed);
  const text = trimmed.slice(heading?.[0].length || 0)
    .replace(/^(?:[-+*]\s+|\d+[.、]\s*)/, '')
    .replace(/^(\*\*|__)(.+?)\1/, '$2')
    .trim();
  return { text, level: heading?.[1].length || 0 };
}

function readOutlineCharacterVoices(outline) {
  if (typeof outline !== 'string') return [];
  const profiles = new Map();
  let sectionLevel = null;
  let linesInSection = 0;
  let name = '';

  for (const raw of outline.split(/\r?\n/)) {
    const { text, level } = readLine(raw);
    const bracket = /^【(.+)】$/.exec(text);
    const title = (bracket?.[1] || text).replace(/[：:]$/, '').trim();
    if (sectionLevel === null) {
      if (title === VOICE_SECTION) sectionLevel = level;
      continue;
    }
    if (++linesInSection > MAX_SECTION_LINES) break;
    if (!text) continue;
    if (bracket || (level > 0 && level <= sectionLevel) || OTHER_SECTION.test(title) || EXAMPLE_HEADING.test(text)) break;

    const field = VOICE_FIELD.exec(text);
    if (field) {
      const value = field[2].trim();
      if (name && value) {
        const voiceRules = profiles.get(name) || [];
        const rule = `${field[1]}：${value}`.slice(0, MAX_RULE_LENGTH);
        if (voiceRules.length < MAX_RULES && !voiceRules.includes(rule)) {
          if (!profiles.has(name) && profiles.size >= MAX_PROFILES) break;
          voiceRules.push(rule);
          profiles.set(name, voiceRules);
        }
      }
      continue;
    }

    // Only a standalone name heading can introduce a profile. Quoted speech,
    // scene examples and ordinary prose never create profile entries.
    if (level > 0 || /[：:]$/.test(text)) name = CHARACTER_NAME.test(title) ? title : '';
  }

  return [...profiles].map(([name, voiceRules]) => ({ name, voiceRules }));
}

function stripOutlineCharacterVoices(outline) {
  if (!readOutlineCharacterVoices(outline).length) return outline;
  const lines = outline.split(/\r?\n/);
  const start = lines.findIndex(line => readLine(line).text.replace(/^【(.+)】$/, '$1').replace(/[：:]$/, '').trim() === VOICE_SECTION);
  const sectionLevel = readLine(lines[start]).level;
  let end = start + 1;
  for (; end < lines.length; end++) {
    const { text, level } = readLine(lines[end]);
    const bracket = /^【(.+)】$/.exec(text);
    const title = (bracket?.[1] || text).replace(/[：:]$/, '').trim();
    if (EXAMPLE_HEADING.test(title)) continue;
    if (bracket || (level > 0 && level <= sectionLevel) || OTHER_SECTION.test(title)) break;
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

module.exports = { readOutlineCharacterVoices, stripOutlineCharacterVoices };
