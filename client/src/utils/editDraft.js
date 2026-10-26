// Drafts are scoped to an account and resource; never reuse another account's text.
export function editDraftKey(userId, resourceId, unit) {
  if (!userId || !resourceId || !unit) return ''
  return `mn_edit_draft:${encodeURIComponent(userId)}:${encodeURIComponent(resourceId)}:${encodeURIComponent(unit)}`
}

export function readEditDraft(key, storage) {
  if (!key) return null
  try {
    const value = JSON.parse((storage || globalThis.localStorage).getItem(key))
    return value?.version === 1 && typeof value.content === 'string' && typeof value.base === 'string' ? value : null
  } catch { return null }
}

export function writeEditDraft(key, content, base, storage) {
  if (!key) return false
  try {
    const target = storage || globalThis.localStorage
    if (content === base) target.removeItem(key)
    else target.setItem(key, JSON.stringify({ version: 1, content, base, updatedAt: Date.now() }))
    return true
  } catch { return false }
}

export function removeEditDraft(key, storage) {
  if (!key) return false
  try { (storage || globalThis.localStorage).removeItem(key); return true } catch { return false }
}
