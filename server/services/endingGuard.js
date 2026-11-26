const COPIED_PASSAGE_LENGTH = 28;
const ANCHOR_LENGTH = 10;
const REPEATED_SCENE_SPAN = 120;
const RECENT_CHAPTERS = 12;

function narrativePassages(content) {
  return String(content || '').split(/\r?\n+/).map(line => {
    const excerpt = line.trim();
    // A recurring lyric or short line of dialogue need not replay a scene.
    const narrative = excerpt.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\r\n]*"/g, '');
    const recordIds = new Set([...narrative.matchAll(/(?:档案|工单|证件|案件|记录)?编号\s*[:：#]?\s*([A-Za-z]*\d[\w-]*)/g)].map(match => match[1]));
    return { excerpt, text: narrative.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(), recordIds };
  }).filter(passage => passage.text.length >= COPIED_PASSAGE_LENGTH);
}

function distinctNearby(first, second, field) {
  const end = Math.max(first[field] + first.length, second[field] + second.length);
  const start = Math.min(first[field], second[field]);
  return end - start >= first.length + second.length && end - start <= REPEATED_SCENE_SPAN;
}

/** Compare only new prose to the chapter in an insertion, or check a full draft against itself. */
function findRepeatedEndingScene(content, reference = '') {
  const index = new Map();
  const addPassage = passage => {
    for (let offset = 0; offset + ANCHOR_LENGTH <= passage.text.length; offset++) {
      const key = passage.text.slice(offset, offset + ANCHOR_LENGTH);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ passage, offset });
    }
  };
  for (const passage of narrativePassages(reference)) addPassage(passage);
  for (const current of narrativePassages(content)) {
    const previousMatches = new Map();
    for (let offset = 0; offset + ANCHOR_LENGTH <= current.text.length; offset++) {
      const key = current.text.slice(offset, offset + ANCHOR_LENGTH);
      for (const { passage, offset: earlier } of index.get(key) || []) {
        // A series of separately numbered records can legitimately report the same action for each entry.
        if (current.recordIds.size === 1 && passage.recordIds.size === 1
          && !current.recordIds.has(passage.recordIds.values().next().value)) continue;
        if (!previousMatches.has(passage)) previousMatches.set(passage, { byDiagonal: new Map(), spans: [] });
        const { byDiagonal, spans } = previousMatches.get(passage);
        const diagonal = offset - earlier;
        if (offset < (byDiagonal.get(diagonal) || 0)) continue;
        let length = ANCHOR_LENGTH;
        while (offset + length < current.text.length && earlier + length < passage.text.length
          && current.text[offset + length] === passage.text[earlier + length]) length++;
        byDiagonal.set(diagonal, offset + length);
        const match = { offset, earlier, length };
        // Two separately copied parts of a scene can survive small edits or a
        // change in sentence order. A lone common gesture does not qualify.
        const repeatedScene = length >= COPIED_PASSAGE_LENGTH || spans.some(previous => (
          length + previous.length >= COPIED_PASSAGE_LENGTH && distinctNearby(previous, match, 'offset')
          && distinctNearby(previous, match, 'earlier')
        ));
        if (repeatedScene) return { kind: 'repetition', excerpt: current.excerpt, referenceExcerpt: passage.excerpt };
        spans.push(match);
      }
    }
    addPassage(current);
  }
  return null;
}

const AUTHORITY = '(?:(?:调度|管理|控制|写入|读取|访问|撤销|临时|永久|行政|执法|执行|编辑|系统|后台|只读)?权限|指挥权|控制权|决策权|调度权|管理权|管辖权)';
const TRANSFER = '(?:移交|交接|交出|转交)';
const SIGNED = '(?:签名栏[^。！？!?\\r\\n]{0,18}(?:落下去|落笔|签下)|签了字|签好字|签完字|签上(?:名字|姓名)|签署(?:完毕|完成)|签字(?:完成|生效|确认)|签了名字)';
const TRANSFER_DOCUMENT = '(?:交接|移交)(?:文件|手续|协议|文书)';
const COMPLETED_TRANSFER = new RegExp([
  `(?:签署了?|签下了?|签了)\\s*(${AUTHORITY})${TRANSFER_DOCUMENT}`,
  `(${AUTHORITY})${TRANSFER_DOCUMENT}[^\\r\\n]{0,115}?${SIGNED}`,
  `(${AUTHORITY})[^。！？!?\\r\\n]{0,8}(?:已(?:经)?|正式)${TRANSFER}`,
  `(${AUTHORITY})${TRANSFER}(?:已(?:经)?)?(?:完毕|完成)`,
  `(?:已(?:经)?|正式)${TRANSFER}了?\\s*(${AUTHORITY})`,
].join('|'), 'g');
const UNDONE_TRANSFER = new RegExp(`(${AUTHORITY})(?:的)?(?:移交|交接)(?:文件|协议|手续)?\\s*(?:已经|已|被|宣布){0,2}(?:撤销|作废|失效|取消|无效)|(?:撤销|取消)了?(${AUTHORITY})(?:的)?(?:移交|交接)`, 'g');
const UNFINISHED = '(?:没有|没|未)\\s*(?:正式|实际|真正)?';
const TRANSFER_END = '(?=[。！？!?；;，、\\s"“”’」』]|$)';
const DENIED_TRANSFER = new RegExp([
  `(${AUTHORITY})[，,、：:\\s]*(?:仍然|仍|还|一直|并|其实|根本|尚)?${UNFINISHED}(?:移交|交接|交出|转交|交)(?:完(?:成|毕)?)?${TRANSFER_END}`,
  `${UNFINISHED}${TRANSFER}\\s*(${AUTHORITY})${TRANSFER_END}`,
].join('|'), 'g');
const UNDECIDED_TRANSFER = new RegExp(`(?:还|仍|尚)(?:没有|没|未)(?:决定|想好)(?:要不要|是否|该不该)\\s*(?:移交|交接|交出|转交|交)(?:去)?${TRANSFER_END}`, 'g');
const TRANSFER_MENTION = new RegExp(`(${AUTHORITY})(?:的)?(?:${TRANSFER_DOCUMENT}|(?:也|就)?(?:会|将|要)?(?:自己|自动)?${TRANSFER}(?:去)?)`, 'g');
const TRANSFER_BRIDGE = /(?:就是|就算|便是|就等于)(?:交出|转交|移交|交接)/;

function paragraphText(content) {
  return String(content || '').split(/\r?\n+/).map(line => line.trim()).filter(Boolean);
}

function sentenceAt(paragraph, index) {
  const start = paragraph.slice(0, index).search(/[^。！？!?；;]*$/u);
  const end = paragraph.slice(index).search(/[。！？!?；;]/u);
  return paragraph.slice(start, end < 0 ? undefined : index + end + 1).trim();
}

function isConditionalOrReported(sentence) {
  return /如果|假如|倘若|要不是|若是|谁说|误以为|以为|猜测|怀疑|听说|传言|据说|谣传|流言|假设|原先|过去|当年|当初|曾经|之前/.test(sentence);
}

/** Catch explicit reversals whose completed state can be located in recent saved prose. */
function findEndingContinuityConflict(content, chapters = []) {
  const settled = new Map();
  const recent = chapters.slice().sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber)).slice(-RECENT_CHAPTERS);
  for (const chapter of recent) {
    for (const paragraph of paragraphText(chapter.content)) {
      const events = [
        ...Array.from(paragraph.matchAll(COMPLETED_TRANSFER), match => ({ match, completed: true })),
        ...Array.from(paragraph.matchAll(UNDONE_TRANSFER), match => ({ match, completed: false })),
      ].sort((a, b) => a.match.index - b.match.index);
      for (const { match, completed } of events) {
        const excerpt = sentenceAt(paragraph, match.index);
        if (isConditionalOrReported(excerpt)
          || /差点|准备|打算|差一步|不能|拒绝|未能|并非|(?:没有|没|未)(?:签|正式|交出|交接|移交|转交)/.test(excerpt)) continue;
        const authority = match.slice(1).find(Boolean);
        if (completed) {
          settled.set(authority, { referenceExcerpt: paragraph, referenceChapter: Number(chapter.chapterNumber) });
        } else {
          settled.delete(authority);
        }
      }
    }
  }
  let priorText = '';
  for (const paragraph of paragraphText(content)) {
    if (/^(?:[-—*_]{3,}$|#{1,6}\s)/.test(paragraph)) priorText = '';
    const denials = Array.from(paragraph.matchAll(DENIED_TRANSFER), match => ({ match, authority: match[1] || match[2] }));
    for (const match of paragraph.matchAll(UNDECIDED_TRANSFER)) {
      const leading = paragraph.slice(0, match.index);
      // A nearby name for the transfer is required when the decision drops
      // its object. Allow a little more space if the dialogue explicitly
      // bridges back to completing the same handover.
      const context = (priorText + '\n' + leading).slice(TRANSFER_BRIDGE.test(leading) ? -500 : -160);
      const authorities = new Set(Array.from(context.matchAll(TRANSFER_MENTION), mention => mention[1]));
      if (authorities.size === 1) denials.push({ match, authority: authorities.values().next().value });
    }
    for (const { match, authority } of denials) {
      const reference = settled.get(authority);
      const sentence = sentenceAt(paragraph, match.index);
      if (!reference || isConditionalOrReported(sentence) || /[？?]$/.test(sentence)) continue;
      if (/(?:想起|回想|回忆|当时|那时)/.test(paragraph) && !/(?:现在|如今|眼下|目前)/.test(paragraph)) continue;
      return { kind: 'continuity', excerpt: sentence, ...reference };
    }
    priorText = (priorText + '\n' + paragraph).slice(-500);
  }
  return null;
}

module.exports = { findRepeatedEndingScene, findEndingContinuityConflict };
