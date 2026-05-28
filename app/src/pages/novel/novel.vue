<template>
  <view class="novel-detail-page">
    <view class="detail-header">
      <button class="back-btn" @click="goBack">← 关闭</button>
      <text class="detail-title">{{ novel?.title || '小说详情' }}</text>
    </view>
    <scroll-view class="detail-content" scroll-y>
      <view class="card summary-card">
        <view class="summary-row"><text class="summary-label">类型</text><text>{{ novel?.novelTypeName }}</text></view>
        <view class="summary-row"><text class="summary-label">主角</text><text>{{ novel?.protagonistName|| '未知' }}</text></view>
        <view class="summary-row"><text class="summary-label">进度</text><text>{{ novel?.currentWordCount }} / {{ novel?.targetWordCount }} 字</text></view>
        <view class="summary-row"><text class="summary-label">章节</text><text>{{ novel?.currentChapterIndex||0 }} 章</text></view>
        <view class="summary-row"><text class="summary-label">状态</text><text :class="['status-badge', novel?.status]">{{ statusMap[novel?.status] }}</text></view>
      </view>

      <view class="card">
        <view class="section-title">📖 章节列表</view>
        <view v-if="!novel?.chapters?.length" class="empty-chapters">暂无章节内容</view>
        <view v-for="(chapter, index) in novel?.chapters" :key="chapter.chapterNumber" class="chapter-item">
          <view class="chapter-header" @click="toggleChapter(index)">
            <text class="chapter-num">第{{ chapter.chapterNumber }}章</text>
            <text class="chapter-words">{{ chapter.wordCount }}字</text>
            <text class="expand-icon">{{ expandedChapter === index ? '▼' : '▶' }}</text>
          </view>
          <view v-show="expandedChapter === index" class="chapter-body">
            <scroll-view class="chapter-content" scroll-y>{{ chapter.content||'内容生成中...' }}</scroll-view>
            <view class="chapter-actions">
              <button class="btn-ch action-edit" @click="openEdit(chapter)">✏️ 编辑</button>
              <button class="btn-ch action-del" @click="confirmDeleteChapter(chapter)">🗑 删除</button>
              <button class="btn-ch action-deslop" @click="deslopChapter(chapter)">✨ 去AI味</button>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 编辑弹窗 -->
    <view v-if="showEditModal" class="gen-overlay" @click.self="showEditModal=false">
      <view class="gen-modal edit-modal">
        <view class="modal-title">编辑第{{ editingChapter?.chapterNumber }}章</view>
        <textarea v-model="editContent" class="textarea" rows="12" style="min-height:200px;"></textarea>
        <view class="gf-acts">
          <button class="btn btn-outline" @click="showEditModal=false">取消</button>
          <button class="btn btn-primary" @click="saveEdit">保存</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { useNovelStore } from '../../stores/novel'

const authStore = useAuthStore()
const novelStore = useNovelStore()
const novel = ref(null)
const expandedChapter = ref(null)
const showEditModal = ref(false)
const editingChapter = ref(null)
const editContent = ref('')

const statusMap = { generating: '生成中', paused: '已暂停', completed: '已完成', error: '异常' }

onMounted(async () => {
  const pages = getCurrentPages()
  const page = pages[pages.length - 1]
  const novelId = page?.$page?.options?.id || page?.options?.id
  if (!novelId) { uni.showToast({ title: '参数错误', icon: 'none' }); return }
  try { novel.value = await novelStore.fetchNovelDetail(novelId) }
  catch { uni.showToast({ title: '加载失败', icon: 'none' }) }
})

function toggleChapter(idx) { expandedChapter.value = expandedChapter.value === idx ? null : idx }
function openEdit(chapter) { editingChapter.value = chapter; editContent.value = chapter.content || ''; showEditModal.value = true }

function getToken() {
  try { if (uni.getStorageSync) return uni.getStorageSync('token') || '' } catch {}
  try { return localStorage.getItem('token') || '' } catch { return '' }
}

function getNovelId() {
  const pages = getCurrentPages()
  const page = pages[pages.length - 1]
  return page?.$page?.options?.id || page?.options?.id
}

async function saveEdit() {
  const id = getNovelId()
  try {
    await uni.request({
      url: '/api/novel/' + id + '/chapter/' + editingChapter.value.chapterNumber,
      method: 'PUT',
      data: { content: editContent.value },
      header: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
    })
    showEditModal.value = false; refreshNovel()
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e) { uni.showModal({ title: '保存失败', content: e.message || '请重试' }) }
}

async function confirmDeleteChapter(ch) {
  uni.showModal({
    title: '确认删除',
    content: '确定删除第' + ch.chapterNumber + '章吗？',
    success: async (res) => {
      if (!res.confirm) return
      const id = getNovelId()
      try {
        await uni.request({
          url: '/api/novel/' + id + '/chapter/' + ch.chapterNumber,
          method: 'DELETE',
          header: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
        })
        refreshNovel()
        uni.showToast({ title: '已删除', icon: 'success' })
      } catch (e) { uni.showModal({ title: '删除失败', content: e.message || '请重试' }) }
    }
  })
}

async function deslopChapter(chapter) {
  uni.showModal({
    title: '去AI味',
    content: '对第' + chapter.chapterNumber + '章进行去AI味处理？',
    success: async (res) => {
      if (!res.confirm) return
      try {
        const deslopRes = await uni.request({ url: '/api/novel/deslop', method: 'POST', data: { text: chapter.content || '' }, header: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' } })
        const data = deslopRes.data
        if (data.processed) {
          const id = getNovelId()
          await uni.request({ url: '/api/novel/' + id + '/chapter/' + chapter.chapterNumber, method: 'PUT', data: { content: data.processed }, header: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' } })
          refreshNovel()
          uni.showToast({ title: '✅ 去AI味完成' })
        }
      } catch (e) { uni.showModal({ title: '处理失败', content: e.message || '请重试' }) }
    }
  })
}

async function refreshNovel() {
  const id = getNovelId()
  if (!id) return
  try { novel.value = await novelStore.fetchNovelDetail(id) } catch {}
}

function goBack() { uni.navigateBack() }
</script>

<style scoped>
.novel-detail-page { display:flex;flex-direction:column;height:100vh; }
.detail-header { display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--card-bg);border-bottom:1px solid var(--border-color);flex-shrink:0; }
.back-btn { background:none;border:none;font-size:16px;color:var(--primary-color);padding:4px 8px; }
.detail-title { font-size:16px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.detail-content { flex:1; }
.summary-card { display:flex;flex-direction:column;gap:8px; }
.summary-row { display:flex;justify-content:space-between;align-items:center; }
.summary-label { font-size:13px;color:var(--text-light); }
.section-title { font-size:15px;font-weight:600;margin-bottom:12px; }
.empty-chapters { text-align:center;padding:20px;color:var(--text-light);font-size:14px; }
.chapter-item { border-bottom:1px solid var(--border-color); }
.chapter-header { display:flex;align-items:center;gap:8px;padding:12px 0;cursor:pointer; }
.chapter-num { flex:1;font-size:14px;font-weight:500; }
.chapter-words { font-size:12px;color:var(--text-light); }
.expand-icon { font-size:10px;color:var(--text-light); }
.chapter-body { padding:0 0 12px; }
.chapter-content { line-height:1.8;font-size:14px;color:var(--text-secondary);white-space:pre-wrap;max-height:300px;padding:8px;background:#fafafa;border-radius:6px; }
.chapter-actions { display:flex;gap:6px;margin-top:8px;flex-wrap:wrap; }
.btn-ch { padding:4px 10px;border-radius:5px;font-size:12px;border:1px solid #ddd;background:white; }
.action-edit { color:#1890ff;border-color:#1890ff; }
.action-del { color:#ff4d4f;border-color:#ff4d4f; }
.action-deslop { color:#FF6B35;border-color:#FF6B35; }
.gen-overlay { position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px; }
.gen-modal { background:white;border-radius:12px;padding:24px;max-width:420px;width:100%; }
.edit-modal { max-width:600px; }
.modal-title { font-size:16px;font-weight:600;margin-bottom:16px; }
.gf-acts { display:flex;gap:8px;margin-top:12px; }
.gf-acts button { flex:1;padding:10px;border-radius:8px;font-size:14px;text-align:center; }
.status-badge { font-size:11px;padding:2px 8px;border-radius:10px;background:#f0f0f0; }
.status-badge.completed { background:#f6ffed;color:#52c41a; }
.status-badge.generating { background:#fff5f0;color:var(--primary-color); }
</style>
