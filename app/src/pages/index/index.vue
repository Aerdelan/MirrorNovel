<template>
  <view class="page-container generate-page">
    <view class="page-header">
      <text>生成小说</text>
    </view>

    <view class="content">
      <view class="card">
        <view class="section-title">① 选择类型</view>
        <view class="gender-tabs">
          <button :class="['gender-btn', { active: gender === 'male' }]" @click="gender='male'">男频</button>
          <button :class="['gender-btn', { active: gender === 'female' }]" @click="gender='female'">女频</button>
        </view>
        <view class="type-grid">
          <view v-for="cat in currentCats" :key="cat.name"
            :class="['type-card', { selected: selectedType === cat.name }]"
            @click="selectedType = cat.name">
            <text class="type-icon">{{ cat.icon }}</text>
            <text class="type-name">{{ cat.name }}</text>
          </view>
        </view>
      </view>

      <view class="card">
        <view class="section-title">② 主角姓名</view>
        <input v-model="protagonistName" class="input" placeholder="输入主角姓名" maxlength="20" />
      </view>

      <view class="card">
        <view class="section-title">③ 世界观设定</view>
        <textarea v-model="worldSetting" class="textarea" placeholder="描述你想要的背景设定" rows="4"></textarea>
      </view>

      <view class="card">
        <view class="section-title">📋 大纲（可选）</view>
        <textarea v-model="outline" class="textarea" placeholder="输入大纲，留空则由AI生成" rows="4"></textarea>
      </view>

      <view class="card">
        <view class="section-title">④ 生成模式</view>
        <view class="mode-radio-group">
          <label :class="['mode-radio', { active: genMode === 'book' }]">
            <radio value="book" :checked="genMode === 'book'" @click="genMode='book'" />
            <text>整本小说</text>
          </label>
          <label :class="['mode-radio', { active: genMode === 'chapter' }]">
            <radio value="chapter" :checked="genMode === 'chapter'" @click="genMode='chapter'" />
            <text>单章</text>
          </label>
        </view>
        <view class="word-count-input" style="margin-top:12px;">
          <input v-model.number="targetWordCount" class="input" type="number" :min="genMode==='chapter'?500:1000" step="500" />
          <text class="unit">字</text>
        </view>
      </view>

      <button class="btn btn-primary btn-block btn-lg" :disabled="generating || !selectedType" @click="startGen">
        {{ generating ? '生成中...' : '开始生成' }}
      </button>

      <view v-if="streamingText" class="card stream-card">
        <view class="section-title">📝 生成内容</view>
        <scroll-view class="stream-content" scroll-y>{{ streamingText }}</scroll-view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useNovelStore } from '../../stores/novel'
import { useAuthStore } from '../../stores/auth'
import { xhrUrl } from '../../utils/apiUrl'

const novelStore = useNovelStore()
const authStore = useAuthStore()

function getToken() {
  try { if (uni.getStorageSync) return uni.getStorageSync('token') || '' } catch {}
  try { return localStorage.getItem('token') || '' } catch { return '' }
}

const gender = ref('male')
const selectedType = ref('')
const protagonistName = ref('')
const worldSetting = ref('')
const outline = ref('')
const genMode = ref('book')
const targetWordCount = ref(50000)
const generating = ref(false)
const streamingText = ref('')

// 小说类别数据（简化版，后续从API获取）
const typeData = {
  male: [
    { name: '仙侠', icon: '🔮' }, { name: '都市', icon: '🏙️' },
    { name: '科幻', icon: '🚀' }, { name: '武侠', icon: '⚔️' },
    { name: '悬疑', icon: '🔍' }, { name: '历史', icon: '🏛️' },
    { name: '奇幻', icon: '🐉' }, { name: '游戏', icon: '🎮' },
  ],
  female: [
    { name: '现代言情', icon: '💕' }, { name: '古代言情', icon: '👘' },
    { name: '玄幻言情', icon: '✨' }, { name: '总裁', icon: '👔' },
    { name: '重生', icon: '🔄' }, { name: '穿越', icon: '⏰' },
  ],
}
const currentCats = computed(() => typeData[gender.value] || [])

async function startGen() {
  if (!selectedType.value || generating.value) return
  generating.value = true
  streamingText.value = ''

  if (!authStore.isLoggedIn) {
    uni.showToast({ title: '请先登录', icon: 'none' })
    uni.navigateTo({ url: '/pages/login/login' })
    generating.value = false
    return
  }

  const token = getToken()
  const xhr = new XMLHttpRequest()
  xhr.open('POST', xhrUrl('/api/novel/generate'))
  xhr.setRequestHeader('Authorization', `Bearer ${token}`)
  xhr.setRequestHeader('Content-Type', 'application/json')
  let lastIndex = 0

  xhr.onprogress = () => {
    const newData = xhr.responseText.substring(lastIndex)
    lastIndex = xhr.responseText.length
    const lines = newData.split('\n').filter(l => l.startsWith('data: '))
    for (const line of lines) {
      try {
        const event = JSON.parse(line.substring(6))
        if (event.type === 'content') streamingText.value += event.content
        else if (event.type === 'completed') {
          generating.value = false
          uni.showToast({ title: '生成完成', icon: 'success' })
        }
      } catch {}
    }
  }

  xhr.onerror = () => { generating.value = false }
  xhr.send(JSON.stringify({
    novelTypeId: selectedType.value,
    protagonistName: protagonistName.value,
    worldSetting: worldSetting.value,
    targetWordCount: targetWordCount.value,
    outline: outline.value,
    mode: genMode.value,
  }))
}
</script>

<style scoped>
.generate-page { padding-top: var(--header-height); }
.page-header {
  position: fixed; top: 0; left: 0; right: 0; height: var(--header-height);
  background: var(--card-bg); display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 600; border-bottom: 1px solid var(--border-color); z-index: 100;
}
.content { padding-top: 8px; padding-bottom: 20px; }
.gender-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.gender-btn {
  flex: 1; padding: 10px; border: 2px solid var(--border-color);
  border-radius: 10px; font-size: 14px; font-weight: 600;
  background: #f8f8f8; text-align: center;
}
.gender-btn.active { border-color: var(--primary-color); background: var(--primary-light); color: var(--primary-color); }
.type-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.type-card {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px 8px; border: 2px solid transparent; border-radius: 10px;
  background: #f8f8f8; transition: all 0.2s;
}
.type-card.selected { border-color: var(--primary-color); background: var(--primary-light); }
.type-icon { font-size: 28px; }
.type-name { font-size: 12px; color: var(--text-secondary); }
.mode-radio-group { display: flex; gap: 10px; }
.mode-radio {
  flex: 1; display: flex; align-items: center; gap: 6px;
  padding: 10px; border: 2px solid var(--border-color); border-radius: 10px;
  font-size: 14px; background: #f8f8f8;
}
.mode-radio.active { border-color: var(--primary-color); background: var(--primary-light); }
.word-count-input { display: flex; align-items: center; gap: 8px; }
.word-count-input .input { flex: 1; }
.unit { font-size: 13px; color: var(--text-light); }
.stream-card { margin-top: 12px; }
.stream-content { max-height: 300px; overflow-y: auto; font-size: 14px; line-height: 1.8; white-space: pre-wrap; }
</style>
