const MAX_BOOK_CHAPTERS = 5000;

function normalizeTargetChapterCount(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value.trim()))) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 1 && count <= MAX_BOOK_CHAPTERS ? count : null;
}

function confirmedBlueprintChapterCount(blueprint) {
  if (!(Number(blueprint?.blueprintLevel) === 3 || blueprint?.rollingPlan) || !Array.isArray(blueprint.phases)) return null;
  return normalizeTargetChapterCount(blueprint.phases.reduce((last, phase) => Math.max(last, Number(phase.endChapter) || 0), 0));
}

function getFixedChapterCount(novel) {
  const input = novel?.generationInput;
  const persisted = normalizeTargetChapterCount(novel?.targetChapterCount);
  if (persisted) return persisted;
  if (!input || input.mode === 'chapter') return null;
  if (Object.hasOwn(input, 'targetChapterCount')) return normalizeTargetChapterCount(input.targetChapterCount);
  return confirmedBlueprintChapterCount(input.storyBlueprint);
}

module.exports = { MAX_BOOK_CHAPTERS, normalizeTargetChapterCount, confirmedBlueprintChapterCount, getFixedChapterCount };
