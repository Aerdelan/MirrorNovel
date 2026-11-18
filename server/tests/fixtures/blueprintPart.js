module.exports = function blueprintPart(name, blueprint) {
  if (name === '概览事实') return { lockedFacts: blueprint.lockedFacts };
  if (name === '概览主线') return { mainArc: blueprint.mainArc };
  if (name === '全书概览') return {
    mainArc: blueprint.mainArc, lockedFacts: blueprint.lockedFacts,
    phases: blueprint.phases.map(({ title, startChapter, endChapter, goal, obstacle, reversal, threads, tagCommitments }) =>
      ({ title, startChapter, endChapter, goal, obstacle, reversal, threads, tagCommitments })),
  };
  const match = name.match(/第(\d+)-(\d+)章/);
  if (!match) throw new Error('Unknown blueprint part: ' + name);
  const [, start, end] = match.map(Number);
  if (name.startsWith('概览篇章')) {
    const phase = blueprint.phases.find(phase => phase.startChapter === start && phase.endChapter === end);
    if (!phase) throw new Error('No overview phase for: ' + name);
    const { title, startChapter, endChapter, goal, obstacle, reversal, threads, tagCommitments } = phase;
    return { phase: { title, startChapter, endChapter, goal, obstacle, reversal, threads, tagCommitments } };
  }
  if (name.startsWith('篇章')) return {
    phases: blueprint.phases.filter(phase => phase.startChapter >= start && phase.endChapter <= end),
  };
  return { chapters: blueprint.rollingPlan.chapters.filter(card => card.chapterNumber >= start && card.chapterNumber <= end) };
};
