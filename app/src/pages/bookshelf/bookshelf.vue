<template>
  <view class="page-container bookshelf-page">
    <view class="page-header">
      <text>我的书架</text>
    </view>

    <view v-if="loading" class="empty-state">
      <view class="loading-spinner"></view>
      <text class="text" style="margin-top:12px;">加载中...</text>
    </view>

    <view v-else-if="novelStore.bookshelf.length === 0" class="empty-state">
      <text class="icon">📖</text>
      <text class="text">书架是空的</text>
      <text class="text" style="font-size:13px;margin-top:4px;">去生成一本小说吧</text>
    </view>

    <view v-else class="novel-list">
      <view v-for="novel in novelStore.bookshelf" :key="novel._id" class="novel-card card"
        @click="openNovel(novel)">
        <view class="novel-header">
          <text class="novel-icon">{{ getTypeIcon(novel.novelTypeId) }}</text>
          <view class="novel-info">
            <text class="novel-title">{{ novel.title || '未命名' }}</text>
            <text class="novel-type">{{ novel.novelTypeName }}</text>
          </view>
          <text :class="['status-badge', novel.status]">{{ statusMap[novel.status] || novel.status }}</text>
        </view>
        <view class="novel-meta">
          <text>📝 {{ novel.currentWordCount }} / {{ novel.targetWordCount }} 字</text>
          <text>📖 {{ novel.currentChapterIndex || 0 }} 章</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useNovelStore } from '../../stores/novel'
import { useAuthStore } from '../../stores/auth'

const novelStore = useNovelStore()
const authStore = useAuthStore()
const loading = ref(true)

const statusMap = { generating: '生成中', paused: '已暂停', completed: '已完成', error: '异常' }

const typeIcons = { xianxia: '🔮', urban: '🏙️', scifi: '🚀', wuxia: '⚔️', mystery: '🔍', romance: '💕', historical: '🏛️' }
function getTypeIcon(typeId) { return typeIcons[typeId] || '📄' }

onMounted(async () => {
  if (!authStore.isLoggedIn) {
    uni.reLaunch({ url: '/pages/login/login' })
    return
  }
  try { await novelStore.fetchBookshelf() } catch (e) { console.error('获取书架失败:', e) }
  loading.value = false
})

function openNovel(novel) {
  uni.navigateTo({ url: `/pages/novel/novel?id=${novel._id}` })
}
</script>

<style scoped>
.bookshelf-page { padding-top: var(--header-height); }
.page-header {
  position: fixed; top: 0; left: 0; right: 0; height: var(--header-height);
  background: var(--card-bg); display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 600; border-bottom: 1px solid var(--border-color); z-index: 100;
}
.novel-list { padding: 8px 0; }
.novel-card { cursor: pointer; }
.novel-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
.novel-icon { font-size: 32px; flex-shrink: 0; }
.novel-info { flex: 1; min-width: 0; }
.novel-title { font-size: 16px; font-weight: 600; color: var(--text-primary); display: block; }
.novel-type { font-size: 12px; color: var(--text-light); margin-top: 2px; }
.novel-meta { display: flex; gap: 12px; font-size: 12px; color: var(--text-light); }
.status-badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #f0f0f0; }
.status-badge.completed { background: #f6ffed; color: #52c41a; }
.status-badge.generating { background: #fff5f0; color: var(--primary-color); }
.status-badge.paused { background: #fffbe6; color: #faad14; }
</style>
