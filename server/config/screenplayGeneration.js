const MAX_SCREENPLAY_OUTPUT_TOKENS = 700000;
const DEFAULT_SCREENPLAY_GENERATION = Object.freeze({
  tokensPerSecond: 32,
  minimumTokens: 7000,
  maximumTokens: MAX_SCREENPLAY_OUTPUT_TOKENS,
});

function normalizeScreenplayGeneration(value = {}) {
  const tokensPerSecond = Number(value.tokensPerSecond);
  const minimumTokens = Number(value.minimumTokens);
  return {
    tokensPerSecond: Number.isFinite(tokensPerSecond) ? Math.min(1000, Math.max(1, tokensPerSecond)) : DEFAULT_SCREENPLAY_GENERATION.tokensPerSecond,
    minimumTokens: Number.isFinite(minimumTokens) ? Math.min(MAX_SCREENPLAY_OUTPUT_TOKENS, Math.max(256, Math.floor(minimumTokens))) : DEFAULT_SCREENPLAY_GENERATION.minimumTokens,
    maximumTokens: MAX_SCREENPLAY_OUTPUT_TOKENS,
  };
}

function getScreenplayOutputTokens(durationSeconds, config = DEFAULT_SCREENPLAY_GENERATION) {
  const normalized = normalizeScreenplayGeneration(config);
  const duration = Math.max(30, Number(durationSeconds) || 120);
  return Math.min(normalized.maximumTokens, Math.max(normalized.minimumTokens, Math.ceil(duration * normalized.tokensPerSecond)));
}

module.exports = {
  MAX_SCREENPLAY_OUTPUT_TOKENS,
  DEFAULT_SCREENPLAY_GENERATION,
  normalizeScreenplayGeneration,
  getScreenplayOutputTokens,
};
