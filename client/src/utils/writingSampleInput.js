// 写作样稿的客户端共享规则。与服务端 services/writingSamples.js 的限值保持一致；
// 这里只做纯函数校验与预填，不做网络请求。

export const SAMPLE_MIN_CHARS = 40
export const SAMPLE_MAX_CHARS = 2000
export const SAMPLE_MAX_TITLE_CHARS = 80
export const SAMPLE_MAX_NOTE_CHARS = 500
export const SAMPLE_SCOPES = ['novel', 'screenplay']
export const SAMPLE_SCENE_TYPES = ['dialogue', 'action', 'observation', 'emotion', 'transition', 'other']
export const SAMPLE_SOURCE_KINDS = ['own_text', 'human_edit', 'authorized_reference']

export function normalizeSampleText(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// 返回 { ok, length, reason }；reason: 'short' | 'long' | null
export function validateSampleContent(text) {
  const content = normalizeSampleText(text)
  const length = content.length
  if (length < SAMPLE_MIN_CHARS) return { ok: false, length, reason: 'short' }
  if (length > SAMPLE_MAX_CHARS) return { ok: false, length, reason: 'long' }
  return { ok: true, length, reason: null }
}

// 弹窗表单的统一预填。preset 来自章节选区或参考片段；sample 为编辑已有样稿。
// 参考片段永远以草稿进入，不继承“立即认可”勾选。
export function buildSampleDraft({ sample = null, preset = null } = {}) {
  const source = sample || preset || {}
  const scope = SAMPLE_SCOPES.includes(source.scope) ? source.scope : 'novel'
  const sceneType = SAMPLE_SCENE_TYPES.includes(source.sceneType) ? source.sceneType : 'other'
  const sourceKind = SAMPLE_SOURCE_KINDS.includes(source.sourceKind) ? source.sourceKind : 'own_text'
  const fromReference = sourceKind === 'authorized_reference' || !!source.sourceReferenceId
  return {
    id: sample?._id || '',
    isEdit: !!sample,
    status: sampleStatusOf(sample),
    fromReference,
    title: String(source.title || '').slice(0, SAMPLE_MAX_TITLE_CHARS),
    content: normalizeSampleText(source.content),
    notes: String(source.notes || '').slice(0, SAMPLE_MAX_NOTE_CHARS),
    scope,
    sceneType,
    sourceKind,
    sourceNovelId: source.sourceNovelId || source.novelId || '',
    sourceNovelTitle: source.sourceNovelTitle || source.novelTitle || '',
    sourceChapterNumber: Number(source.sourceChapterNumber || source.chapterNumber || 0),
    sourceReferenceId: source.sourceReferenceId || source.referenceId || '',
    sourceReferenceTitle: source.sourceReferenceTitle || source.referenceTitle || '',
    approveNow: false,
  }
}

export function sampleStatusOf(sample) {
  return sample && ['draft', 'approved', 'revoked'].includes(sample.status) ? sample.status : 'draft'
}
