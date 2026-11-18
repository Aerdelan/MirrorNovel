const part = require('./blueprintPart');

function stageText(stage) {
  return `【篇章｜第${stage.startChapter}-${stage.endChapter}章｜${stage.title}】\n${stage.goal}。${stage.obstacle}，迫使周行舟重新核对现场证据。${stage.reversal}，他必须向同事公开自己的判断并承担经营代价；这段职场冲突通过交接和回款约束兑现，下一篇章承接公开责任表后的新局面。`;
}

module.exports = function prosePart(name, blueprint) {
  const payload = part(name, blueprint);
  if (name === '全书概览') return `【故事主线】\n${payload.mainArc}\n【已定事实】\n${payload.lockedFacts.map(fact => `- ${fact}`).join('\n') || '无'}\n${payload.phases.map(stageText).join('\n\n')}`;
  if (payload.phases) return payload.phases.map(stageText).join('\n\n');
  if (payload.chapters) return payload.chapters.map(card => `【第${card.chapterNumber}章｜${card.title}】\n${card.purpose}。周行舟必须在仓库向同事说明交接证据，承担选择的代价，以具体口语回应质疑。${card.relationshipChange}，${card.exitHook}，让下一章从这项职场冲突的后果开始。`).join('\n\n');
  if (payload.phase) return stageText(payload.phase);
  return payload.lockedFacts ? `【已定事实】\n${payload.lockedFacts.join('\n') || '无'}` : `【故事主线】\n${payload.mainArc}`;
};
