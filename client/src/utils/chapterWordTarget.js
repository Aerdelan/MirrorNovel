// Validate on blur/submission, not while the author is typing a multi-digit number.
export function normalizeChapterWordTargetInput(value) {
  const number = value === '' || value == null ? 3000 : Number(value)
  return Number.isFinite(number) ? Math.max(2000, Math.min(20000, Math.round(number))) : 3000
}
