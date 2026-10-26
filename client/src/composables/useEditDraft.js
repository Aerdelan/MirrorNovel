import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useI18n } from './useI18n'
import { editDraftKey, readEditDraft, writeEditDraft, removeEditDraft } from '../utils/editDraft'

// Shared by chapter and scene editors. Drafts never alter the saved work until
// the normal save endpoint succeeds, and remain local to the current account.
export function useEditDraft() {
  const auth = useAuthStore()
  const { $t } = useI18n()
  const visible = ref(false), value = ref(null), saving = ref(false)
  const message = ref(''), pendingDraft = ref(null)
  const base = ref('null')
  let key = '', timer = null
  const dirty = computed(() => visible.value && JSON.stringify(value.value) !== base.value)
  const needsChoice = computed(() => pendingDraft.value !== null)
  function stopTimer() { if (timer) clearTimeout(timer); timer = null }
  function persist() {
    stopTimer()
    if (!visible.value || needsChoice.value) return true
    const ok = writeEditDraft(key, JSON.stringify(value.value), base.value)
    message.value = ok ? (dirty.value ? $t('editing.draftSaved') : '') : $t('editing.draftFailed')
    return ok
  }
  function open({ resourceId, unit, value: original, normalize = value => value }) {
    if (visible.value && !close()) return false
    stopTimer()
    key = editDraftKey(auth.user?.id || auth.user?._id, resourceId, unit)
    base.value = JSON.stringify(original)
    value.value = JSON.parse(base.value)
    pendingDraft.value = null
    message.value = ''
    const draft = readEditDraft(key)
    if (draft && draft.content !== base.value) {
      try {
        const restored = normalize(JSON.parse(draft.content))
        if (typeof restored !== typeof original || restored == null) throw new Error('Invalid draft')
        if (draft.base === base.value) { value.value = restored; message.value = $t('editing.draftRestored') }
        else { pendingDraft.value = restored; message.value = $t('editing.draftConflict') }
      } catch { message.value = $t('editing.draftInvalid') }
    } else if (draft) removeEditDraft(key)
    visible.value = true
    return true
  }
  function restore() {
    if (!needsChoice.value || saving.value) return
    value.value = pendingDraft.value
    pendingDraft.value = null
    persist()
  }
  function discard() {
    if (saving.value || !window.confirm($t('editing.discardConfirm'))) return
    stopTimer()
    removeEditDraft(key)
    pendingDraft.value = null
    value.value = JSON.parse(base.value)
    message.value = ''
  }
  function close() {
    if (!visible.value) return true
    if (saving.value) return false
    const stored = persist()
    if (dirty.value && !window.confirm($t(stored ? 'editing.closeConfirm' : 'editing.closeUnsafe'))) return false
    visible.value = false
    return true
  }
  function saved() {
    stopTimer()
    removeEditDraft(key)
    base.value = JSON.stringify(value.value)
    visible.value = false
    message.value = ''
  }
  watch(value, () => {
    if (!visible.value || needsChoice.value || saving.value) return
    stopTimer()
    timer = setTimeout(persist, 350)
  }, { deep: true, flush: 'sync' })
  function beforeUnload(event) {
    if (!dirty.value) return
    persist()
    event.preventDefault()
    event.returnValue = ''
  }
  onBeforeRouteLeave(close)
  onBeforeRouteUpdate((to, from) => to.path === from.path || close())
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  onUnmounted(() => { persist(); stopTimer(); window.removeEventListener('beforeunload', beforeUnload) })
  return { visible, value, saving, message, dirty, needsChoice, open, close, saved, restore, discard }
}
