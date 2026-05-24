<template>
  <div class="page-container ref-list-page">
    <div class="page-header">
      <span>📖 风格参考库</span>
      <button class="btn btn-sm btn-primary header-btn" @click="$router.push('/reference-upload')">
        ➕ 上传
      </button>
    </div>

    <div class="list-content">
      <!-- 加载中 -->
      <div v-if="loading" class="empty-state">
        <div class="loading-spinner" style="width:32px;height:32px;margin:0 auto;"></div>
        <div class="empty-text" style="margin-top:12px;">加载中...</div>
      </div>

      <!-- 空状态 -->
      <div v-else-if="refStore.referenceList.length === 0" class="empty-state">
        <div class="empty-icon">📚</div>
        <div class="empty-text">还没有上传参考小说</div>
        <button class="btn btn-primary btn-sm" style="margin-top:12px;" @click="$router.push('/reference-upload')">
          📄 上传第一部
        </button>
      </div>

      <!-- 列表（含统计） -->
      <template v-else>
        <div class="stats-bar">
          <span>共 {{ refStore.referenceList.length }} 部</span>
          <span>已分析 {{ analyzedCount }} 部</span>
        </div>
        <div class="novel-list">
        <div
          v-for="novel in refStore.referenceList"
          :key="novel._id"
          class="novel-card card"
          @click="showDetail(novel)"
        >
          <div class="card-header">
            <div class="novel-icon">{{ getGenderIcon(novel.gender) }}{{ getMainIcon(novel.mainCategory) }}</div>
            <div class="novel-info">
              <div class="novel-title">{{ novel.title }}</div>
              <div class="novel-category">{{ novel.mainCategory }} / {{ novel.subCategory || '通用' }}</div>
            </div>
            <div class="header-right">
              <span v-if="novel.aiProcessed" class="status-badge completed">已分析</span>
              <span v-else class="status-badge paused">未分析</span>
              <span class="quality-badge" :class="scoreClass(novel.qualityScore)">{{ novel.qualityScore || '-' }}</span>
            </div>
          </div>
          <div class="novel-meta">
            <span>📝 {{ (novel.originalLength || 0).toLocaleString() }} 字</span>
            <span>🏷️ {{ (novel.tags || []).join(', ') || '无标签' }}</span>
          </div>
          <div class="novel-meta" v-if="novel.gender">
            <span>{{ novel.gender === 'male' ? '🚹 男频' : '🚺 女频' }}</span>
            <span>📊 质量分：{{ novel.qualityScore || '待评估' }}</span>
            <span>{{ novel.vocabularyBank?.length || 0 }} 个特色词汇</span>
          </div>
          <div class="novel-actions" @click.stop>
            <button class="btn btn-sm btn-outline" style="color:var(--error-color);border-color:var(--error-color);" @click="confirmDelete(novel)">
              🗑 删除
            </button>
          </div>
        </div>
      </div>
      </template>
    </div>

    <!-- 详情弹窗 -->
    <Teleport to="body">
      <div v-if="detailNovel" class="detail-overlay" @click.self="detailNovel=null">
        <div class="detail-modal">
          <h3>📖 {{ detailNovel.title }}</h3>
          <div class="detail-info">
            <div><strong>分类：</strong>{{ detailNovel.mainCategory }} / {{ detailNovel.subCategory || '通用' }}</div>
            <div><strong>性别：</strong>{{ detailNovel.gender === 'male' ? '男频' : '女频' }}</div>
            <div><strong>字数：</strong>{{ (detailNovel.originalLength || 0).toLocaleString() }}</div>
            <div v-if="detailNovel.tags?.length"><strong>标签：</strong>{{ detailNovel.tags.join(', ') }}</div>
            <div><strong>质量评分：</strong><span class="quality-badge" :class="scoreClass(detailNovel.qualityScore)">{{ detailNovel.qualityScore || '未评估' }}</span></div>
          </div>

          <div v-if="detailNovel.styleProfile" class="detail-section">
            <div class="detail-label">📋 风格描述（{{ detailNovel.styleProfile.length }}字）</div>
            <div class="detail-text">{{ detailNovel.styleProfile }}</div>
          </div>

          <div v-if="detailNovel.writingCharacteristics" class="detail-section">
            <div class="detail-label">✍️ 写作特点</div>
            <div class="detail-text">{{ detailNovel.writingCharacteristics }}</div>
          </div>

          <div v-if="detailNovel.keyExcerpts?.length" class="detail-section">
            <div class="detail-label">📝 精选片段（{{ detailNovel.keyExcerpts.length }}段）</div>
            <div v-for="(ex, i) in detailNovel.keyExcerpts" :key="i" class="detail-excerpt">
              <div class="excerpt-num">片段 {{ i + 1 }}</div>
              <div class="excerpt-text">{{ ex.slice(0, 300) }}{{ ex.length > 300 ? '...' : '' }}</div>
            </div>
          </div>

          <div v-if="detailNovel.vocabularyBank?.length" class="detail-section">
            <div class="detail-label">🏷️ 特色词汇（{{ detailNovel.vocabularyBank.length }}个）</div>
            <div class="detail-tags">
              <span v-for="v in detailNovel.vocabularyBank" :key="v" class="vocab-tag">{{ v }}</span>
            </div>
          </div>

          <div v-if="detailNovel.chapterStructure" class="detail-section">
            <div class="detail-label">📐 章节结构</div>
            <div class="detail-text">{{ detailNovel.chapterStructure }}</div>
          </div>

          <button class="btn btn-outline btn-block" style="margin-top:12px;" @click="detailNovel=null">关闭</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useReferenceStore } from '../stores/reference'

const router = useRouter()
const authStore = useAuthStore()
const refStore = useReferenceStore()
const detailNovel = ref(null)
const loading = ref(true)

const typeIcons = {
  '都市':'🏙️','玄幻':'🔮','仙侠':'☯️','历史':'🏛️','武侠':'⚔️',
  '科幻':'🚀','悬疑灵异':'🔍','游戏':'🎮','体育':'🏀','军事':'🎖️','二次元':'🎭',
  '现代言情':'💕','古代言情':'👘','玄幻言情':'✨','悬疑言情':'🔎',
  '青春校园':'🏫','纯爱（双男主）':'🌈','百合（双女主）':'🌸',
}

const analyzedCount = computed(() => refStore.referenceList.filter(n => n.aiProcessed).length)

function getGenderIcon(g) { return g === 'male' ? '🚹' : g === 'female' ? '🚺' : '' }
function getMainIcon(name) { return typeIcons[name] || '📄' }
function scoreClass(s) {
  if (!s) return '';
  if (s >= 80) return 'high';
  if (s >= 60) return 'mid';
  return 'low';
}

function showDetail(novel) {
  if (novel.aiProcessed) {
    refStore.getDetail(novel._id).then(d => { detailNovel.value = d }).catch(() => { detailNovel.value = novel })
  } else {
    detailNovel.value = novel
  }
}

function confirmDelete(novel) {
  if (confirm(`确定删除《${novel.title}》吗？`)) {
    refStore.deleteReference(novel._id)
  }
}

onMounted(async () => {
  if (!authStore.isLoggedIn) { router.push('/login'); return }
  loading.value = true
  await refStore.fetchList()
  loading.value = false
})
</script>

<style scoped>
.ref-list-page { padding-top: var(--header-height); }
.page-header {
  position: fixed; top: 0; left: 0; right: 0; height: var(--header-height);
  background: var(--card-bg);
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 600;
  border-bottom: 1px solid var(--border-color); z-index: 100; gap: 8px;
}
.header-btn { position: absolute; right: 12px; font-size: 12px; }
.list-content { padding: 8px 0; }
.empty-state { text-align: center; padding: 60px 20px; }
.empty-icon { font-size: 48px; }
.empty-text { margin-top: 12px; color: var(--text-secondary); }
.stats-bar {
  display: flex; gap: 16px; font-size: 13px; color: var(--text-light);
  padding: 8px 12px; background: #f8f8f8; border-radius: 8px; margin-bottom: 8px;
}

.novel-card { cursor: pointer; }
.card-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 6px; }
.novel-icon { font-size: 24px; }
.novel-info { flex: 1; min-width: 0; }
.novel-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.novel-category { font-size: 12px; color: var(--text-light); margin-top: 2px; }
.header-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }

.status-badge { font-size: 11px; padding: 2px 8px; border-radius: 8px; }
.status-badge.completed { background: #f6ffed; color: #52c41a; }
.status-badge.paused { background: #fff7e6; color: #faad14; }

.quality-badge { font-size: 12px; padding: 1px 8px; border-radius: 10px; font-weight: 600; }
.quality-badge.high { background: #f6ffed; color: #52c41a; }
.quality-badge.mid { background: #fff7e6; color: #fa8c16; }
.quality-badge.low { background: #fff1f0; color: #ff4d4f; }

.novel-meta { display: flex; gap: 12px; font-size: 12px; color: var(--text-light); flex-wrap: wrap; margin-top: 2px; }
.novel-actions { margin-top: 8px; display: flex; gap: 8px; }

/* 详情弹窗 */
.detail-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.detail-modal {
  background: var(--card-bg); border-radius: 16px; max-width: 480px; width: 100%;
  padding: 24px; max-height: 85vh; overflow-y: auto;
}
.detail-modal h3 { margin: 0 0 12px; font-size: 17px; }
.detail-info { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }
.detail-info > div { margin-bottom: 4px; }
.detail-section { margin-bottom: 14px; }
.detail-label { font-size: 14px; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); }
.detail-text { font-size: 13px; color: var(--text-secondary); line-height: 1.7; white-space: pre-wrap; }
.detail-excerpt {
  background: #fafafa; border-radius: 8px; padding: 10px; margin-bottom: 8px;
}
.excerpt-num { font-size: 12px; font-weight: 600; color: var(--primary-color); margin-bottom: 4px; }
.excerpt-text { font-size: 13px; color: var(--text-secondary); line-height: 1.6; }
.detail-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.vocab-tag {
  padding: 3px 10px; background: #f0f5ff; border: 1px solid #d6e4ff;
  border-radius: 12px; font-size: 12px; color: #1890ff;
}
</style>
