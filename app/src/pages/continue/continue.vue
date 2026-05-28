<template>
  <view class="page-container continue-page">
    <view class="page-header">
      <button class="back-btn" @click="goBack">← 返回</button>
      <text>续写</text>
    </view>

    <view class="card">
      <view class="section-title">导入文本</view>
      <view class="upload-bar">
        <button class="btn btn-sm btn-outline" @click="chooseFile">📄 选择文件</button>
        <text v-if="fileName" class="file-name">{{ fileName }}</text>
      </view>
      <textarea v-model="importedText" class="textarea" placeholder="粘贴小说文本，或选择文件导入" rows="8"></textarea>
      <view class="import-hint">
        <text>{{ importedText.length }} 字符</text>
        <text v-if="importedText.length < 50" style="color:var(--error-color);margin-left:8px;">至少50个字符</text>
      </view>
    </view>

    <view class="card">
      <view class="section-title">小说信息</view>
      <view class="form-group">
        <text class="label">书名</text>
        <input v-model="title" class="input" placeholder="输入书名" maxlength="50" />
      </view>
      <view class="form-group">
        <text class="label">风格类型</text>
        <input v-model="novelTypeName" class="input" placeholder="如：仙侠、都市、言情" />
      </view>
    </view>

    <view class="card">
      <view class="section-title">写作要求</view>
      <textarea v-model="continuationRequest" class="textarea" rows="4" placeholder="描述接下来要写的内容方向"></textarea>
    </view>

    <view class="card">
      <view class="section-title">模式</view>
      <view class="mode-radio-group">
        <label :class="['mode-radio', { active: genMode === 'book' }]">
          <radio value="book" :checked="genMode==='book'" @click="genMode='book'" />
          <text>续写整本</text>
        </label>
        <label :class="['mode-radio', { active: genMode === 'chapter' }]">
          <radio value="chapter" :checked="genMode==='chapter'" @click="genMode='chapter'" />
          <text>只续写一章</text>
        </label>
      </view>
      <view class="word-count-input" style="margin-top:12px;">
        <input v-model.number="targetWordCount" class="input" type="number"
          :min="genMode==='chapter'?500:1000" :max="genMode==='chapter'?8000:100000" step="500" />
        <text class="unit">字</text>
      </view>
    </view>

    <button class="btn btn-primary btn-block btn-lg" :disabled="continuing || !importedText.trim()" @click="startContinue">
      {{ continuing ? '续写中...' : '开始续写' }}
    </button>

    <view v-if="streamingText" class="card stream-card">
      <view class="section-title">📝 续写内容</view>
      <scroll-view class="stream-content" scroll-y>{{ streamingText }}</scroll-view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { xhrUrl } from '../../utils/apiUrl'

const importedText = ref('')
const fileName = ref('')
const title = ref('')
const novelTypeName = ref('')
const continuationRequest = ref('')
const genMode = ref('book')
const targetWordCount = ref(5000)
const continuing = ref(false)
const streamingText = ref('')

function getToken() {
  try { if (uni.getStorageSync) return uni.getStorageSync('token') || '' } catch {}
  try { return localStorage.getItem('token') || '' } catch { return '' }
}

function chooseFile() {
  uni.chooseFile({
    count: 1,
    extension: ['.txt'],
    success: (res) => {
      const file = res.tempFiles[0]
      fileName.value = file.name
      uni.getFileSystemManager().readFile({
        filePath: file.path, encoding: 'utf-8',
        success: (r) => { importedText.value = r.data }
      })
    }
  })
}

function startContinue() {
  if (!importedText.value.trim() || importedText.value.trim().length < 50) {
    return uni.showToast({ title: '文本太短（至少50字）', icon: 'none' })
  }
  const text = importedText.value.trim()
  continuing.value = true
  streamingText.value = ''

  const token = getToken()
  const xhr = new XMLHttpRequest()
  xhr.open('POST', xhrUrl('/api/novel/continue-import'))
  xhr.setRequestHeader('Authorization', `Bearer ${token}`)
  xhr.setRequestHeader('Content-Type', 'application/json')
  xhr.setRequestHeader('Accept', 'text/event-stream')
  let lastIdx = 0

  xhr.onprogress = () => {
    const newData = xhr.responseText.substring(lastIdx)
    lastIdx = xhr.responseText.length
    const lines = newData.split('\n').filter(l => l.startsWith('data: '))
    for (const line of lines) {
      try {
        const event = JSON.parse(line.substring(6))
        if (event.type === 'content') streamingText.value += event.content
        else if (event.type === 'completed' || event.type === 'paused') {
          continuing.value = false
          if (event.type === 'paused') uni.showToast({ title: '已暂停' })
          else uni.showToast({ title: '续写完成', icon: 'success' })
        }
      } catch {}
    }
  }

  xhr.onerror = () => { continuing.value = false; uni.showToast({ title: '网络请求失败', icon: 'none' }) }
  xhr.send(JSON.stringify({
    importedText: text,
    continuationRequest: continuationRequest.value,
    novelTypeName: novelTypeName.value,
    targetWordCount: targetWordCount.value,
    mode: genMode.value,
    title: title.value || undefined,
  }))
}

function goBack() { uni.navigateBack() }
</script>

<style scoped>
.continue-page { padding-top: var(--header-height); }
.page-header { position:fixed;top:0;left:0;right:0;height:var(--header-height);background:var(--card-bg);display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--border-color);z-index:100; }
.back-btn { background:none;border:none;font-size:16px;color:var(--primary-color);padding:4px 8px; }
.mode-radio-group { display:flex;gap:10px; }
.mode-radio { flex:1;display:flex;align-items:center;gap:6px;padding:10px;border:2px solid var(--border-color);border-radius:10px;font-size:14px;background:#f8f8f8; }
.mode-radio.active { border-color:var(--primary-color);background:var(--primary-light); }
.form-group { margin-bottom:12px; }
.form-group .label { display:block;font-size:13px;color:var(--text-secondary);margin-bottom:4px; }
.upload-bar { display:flex;align-items:center;gap:8px;margin-bottom:10px; }
.file-name { font-size:12px;color:var(--text-light);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.import-hint { font-size:12px;color:var(--text-light);margin-top:4px; }
.word-count-input { display:flex;align-items:center;gap:8px; }
.word-count-input .input { flex:1; }
.unit { font-size:13px;color:var(--text-light); }
.stream-card { margin-top:12px; }
.stream-content { max-height:300px;overflow-y:auto;font-size:14px;line-height:1.8;white-space:pre-wrap; }
</style>
