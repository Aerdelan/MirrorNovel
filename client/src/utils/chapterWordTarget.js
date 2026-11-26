// Validate on blur/submission, not while the author is typing a multi-digit number.
export function normalizeChapterWordTargetInput(value) {
  const number = value === '' || value == null ? 3000 : Number(value)
  return Number.isFinite(number) ? Math.max(2000, Math.min(20000, Math.round(number))) : 3000
}

export const MAX_TARGET_CHAPTER_COUNT = 5000

export function parseTargetChapterCount(value) {
  if (value === '' || value == null) return undefined
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value.trim()))) return null
  const count = Number(value)
  return Number.isInteger(count) && count >= 1 && count <= MAX_TARGET_CHAPTER_COUNT ? count : null
}
