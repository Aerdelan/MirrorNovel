module.exports = function blueprintPart(name, blueprint) {
  if (name === '全书概览') return {
    mainArc: blueprint.mainArc, lockedFacts: blueprint.lockedFacts,
    phases: blueprint.phases.map(({ title, startChapter, endChapter, goal, obstacle, reversal, threads, tagCommitments }) =>
      ({ title, startChapter, endChapter, goal, obstacle, reversal, threads, tagCommitments })),
  };
  const match = name.match(/第(\d+)-(\d+)章/);
  if (!match) throw new Error('Unknown blueprint part: ' + name);
  const [, start, end] = match.map(Number);
  if (name.startsWith('篇章')) return {
    phases: blueprint.phases.filter(phase => phase.startChapter >= start && phase.endChapter <= end),
  };
  return { chapters: blueprint.rollingPlan.chapters.filter(card => card.chapterNumber >= start && card.chapterNumber <= end) };
};
