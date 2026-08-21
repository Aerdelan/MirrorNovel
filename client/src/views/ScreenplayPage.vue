<template>
 <div class="page-container screenplay-page">
  <div class="page-header"><span>AI剧本</span></div>

  <!-- 创建项目 -->
  <div v-if="!activeProject" class="creator">
   <div class="workspace-intro">
    <h1>连续短剧工作台</h1>
    <p>从剧本圣经到分集大纲，再到可拍摄或可生成的场景剧本。</p>
   </div>

   <section class="form-section">
    <label>剧本来源</label>
    <div class="segmented">
     <button type="button" :class="{ selected: form.sourceType === 'adaptation' }" @click="form.sourceType = 'adaptation'">小说改编</button>
     <button type="button" :class="{ selected: form.sourceType === 'original' }" @click="form.sourceType = 'original'">原创短剧</button>
    </div>
   </section>

   <section class="form-section">
    <label>交付方式</label>
    <div class="segmented">
     <button type="button" :class="{ selected: form.productionTarget === 'video' }" @click="form.productionTarget = 'video'">视频生成</button>
     <button type="button" :class="{ selected: form.productionTarget === 'live_action' }" @click="form.productionTarget = 'live_action'">实拍制作</button>
    </div>
    <p class="field-hint">{{ form.productionTarget === 'video' ? '后续场次会生成镜头与画面重点。' : '后续场次会生成布景、走位、道具与执行提示。' }}</p>
   </section>

   <section v-if="form.sourceType === 'adaptation'" class="form-section">
    <label for="source-novel">选择小说</label>
    <select id="source-novel" v-model="form.sourceNovelId" class="input">
     <option value="">请选择已创建的小说</option>
     <option v-for="novel in novels" :key="novel._id" :value="novel._id">{{ novel.title }}（{{ novel.currentChapterIndex || 0 }}章）</option>
    </select>
   </section>

   <section class="form-section">
    <label for="screenplay-title">剧本名称</label>
    <input id="screenplay-title" v-model.trim="form.title" class="input" maxlength="120" placeholder="例如：旧城来信" />
   </section>

   <section class="form-section">
    <label for="screenplay-concept">{{ form.sourceType === 'adaptation' ? '改编重点' : '核心设定' }}</label>
    <textarea id="screenplay-concept" v-model.trim="form.concept" class="textarea" rows="4" :placeholder="form.sourceType === 'adaptation' ? '例如：保留人物关系与核心谜团，压缩支线' : '人物、冲突、时代或世界规则'" />
   </section>

   <div class="compact-grid">
    <section class="form-section">
     <label for="episode-count">集数</label>
     <input id="episode-count" v-model.number="form.episodeCount" class="input" type="number" min="1" max="120" />
    </section>
    <section class="form-section">
     <label for="episode-duration">单集秒数</label>
     <input id="episode-duration" v-model.number="form.episodeDurationSeconds" class="input" type="number" min="30" max="1800" step="30" />
    </section>
   </div>

   <button class="btn btn-primary btn-block" :disabled="creating" @click="createProject">{{ creating ? '正在创建...' : '创建剧本项目' }}</button>
   <p v-if="error" class="error-text">{{ error }}</p>

   <section v-if="projects.length" class="project-list">
    <h2>最近项目</h2>
    <button v-for="project in projects" :key="project._id" class="project-row" @click="openProject(project._id)">
     <span class="project-row-info">
      <strong>{{ project.title }}</strong>
      <small>{{ sourceLabel(project.sourceType) }} · {{ targetLabel(project.productionTarget) }}</small>
     </span>
     <span class="project-status">{{ project.status === 'developed' ? '已规划' : '草稿' }}</span>
    </button>
   </section>
  </div>

  <!-- 项目工作台 -->
  <div v-else class="project-workspace">
   <div class="project-topline">
    <button class="icon-button" title="返回项目列表" @click="closeProject">←</button>
    <div class="project-topline-title">
     <h1>{{ activeProject.title }}</h1>
     <p>{{ sourceLabel(activeProject.sourceType) }} · {{ targetLabel(activeProject.productionTarget) }} · {{ activeProject.episodeCount }}集</p>
    </div>
   </div>

   <section class="card project-summary">
    <div class="summary-item">
     <span>交付规范</span>
     <strong>{{ activeProject.productionTarget === 'video' ? '镜头、画面重点与转场' : '布景、走位、道具与执行提示' }}</strong>
    </div>
    <div v-if="activeProject.sourceType === 'adaptation'" class="summary-item">
     <span>改编来源</span>
     <strong>{{ activeProject.sourceSnapshot?.title || '已选小说' }}</strong>
    </div>
   </section>

   <!-- 建立剧本圣经 -->
   <section v-if="!hasBible" class="card action-card">
    <h2>建立剧本圣经</h2>
    <p>生成角色视觉设定、场景空间、连续性规则和全部分集大纲。</p>
    <button class="btn btn-primary btn-block" :disabled="developing" @click="developProject">{{ developing ? '正在规划...' : '生成剧本圣经与分集大纲' }}</button>
   </section>

   <template v-else>
    <!-- 剧本圣经 -->
    <section class="card bible-card">
     <div class="section-heading">
      <h2>剧本圣经</h2>
      <button class="icon-button" title="重新生成剧本圣经" :disabled="developing" @click="developProject">↻</button>
     </div>
     <p class="logline">{{ activeProject.screenplayBible.logline }}</p>
     <div class="bible-facts">
      <div class="fact-row"><span>类型</span><strong>{{ activeProject.screenplayBible.genre }}</strong></div>
      <div class="fact-row"><span>视觉气质</span><strong>{{ activeProject.screenplayBible.visualTone }}</strong></div>
      <div v-if="activeProject.screenplayBible.adaptationBoundary" class="fact-row"><span>改编边界</span><strong>{{ activeProject.screenplayBible.adaptationBoundary }}</strong></div>
     </div>

     <div class="bible-block">
      <h3>角色连续性</h3>
      <div v-for="character in activeProject.screenplayBible.characters || []" :key="character.name" class="bible-item">
       <div class="bible-item-head"><strong>{{ character.name }}</strong></div>
       <div class="bible-item-visual">{{ character.visual }}</div>
       <div class="bible-item-meta">{{ character.objective }} · {{ character.relationship }}</div>
       <div class="bible-item-continuity">{{ character.continuity }}</div>
      </div>
     </div>

     <div class="bible-block">
      <h3>场景空间</h3>
      <div v-for="location in activeProject.screenplayBible.locations || []" :key="location.name" class="bible-item">
       <div class="bible-item-head"><strong>{{ location.name }}</strong></div>
       <div class="bible-item-visual">{{ location.visual }}</div>
       <div class="bible-item-meta">{{ location.storyFunction }}</div>
       <div class="bible-item-continuity">{{ location.continuity }}</div>
      </div>
     </div>
    </section>

    <!-- 分集剧本 -->
    <section class="episode-list">
     <h2>分集剧本</h2>
     <article v-for="episode in activeProject.episodes || []" :key="episode.episodeNumber" class="card episode-card">
      <div class="episode-header">
       <div class="episode-header-info">
        <span class="episode-no">第{{ episode.episodeNumber }}集 · {{ episode.durationSeconds }}秒</span>
        <h3>{{ episode.title }}</h3>
       </div>
       <button class="btn btn-sm btn-primary" :disabled="generatingEpisode === episode.episodeNumber" @click="generateEpisode(episode.episodeNumber)">{{ generatingEpisode === episode.episodeNumber ? '生成中...' : episode.scenes?.length ? '重生成' : '生成剧本' }}</button>
      </div>
      <p class="episode-premise">{{ episode.premise }}</p>
      <div class="episode-facts">
       <div class="episode-fact"><label>冲突</label><span>{{ episode.conflict }}</span></div>
       <div class="episode-fact"><label>转折</label><span>{{ episode.turn }}</span></div>
       <div class="episode-fact"><label>钩子</label><span>{{ episode.cliffhanger }}</span></div>
      </div>
      <div v-if="episode.scenes?.length" class="scenes">
       <article v-for="scene in episode.scenes" :key="scene.sceneNumber" class="scene">
        <div class="scene-heading">{{ scene.sceneNumber }}. {{ scene.interiorExterior }} · {{ scene.timeOfDay }} · {{ scene.location }}</div>
        <div class="scene-characters">{{ scene.characters?.join('、') }}</div>
        <p class="scene-action">{{ scene.action }}</p>
        <div v-if="scene.dialogue?.length" class="dialogue-list">
         <div v-for="(line, index) in scene.dialogue" :key="index" class="dialogue">
          <strong class="dialogue-character">{{ line.character }}</strong>
          <span class="dialogue-line">{{ line.line }}</span>
         </div>
        </div>
        <div v-if="scene.productionNotes" class="scene-notes">{{ scene.productionNotes }}</div>
       </article>
      </div>
     </article>
    </section>
   </template>
   <p v-if="error" class="error-text">{{ error }}</p>
  </div>
 </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import api from '../api'
const form = ref({ sourceType: 'adaptation', productionTarget: 'video', sourceNovelId: '', title: '', concept: '', episodeCount: 12, episodeDurationSeconds: 120 })
const novels = ref([]), projects = ref([]), activeProject = ref(null), creating = ref(false), developing = ref(false), generatingEpisode = ref(0), error = ref('')
const hasBible = computed(() => Boolean(activeProject.value?.screenplayBible?.logline))
function sourceLabel(value) { return value === 'adaptation' ? '小说改编' : '原创短剧' }
function targetLabel(value) { return value === 'video' ? '视频生成' : '实拍制作' }
function resetError() { error.value = '' }
async function loadProjects() { projects.value = (await api.get('/screenplay/projects')).data || [] }
async function openProject(id) { resetError(); try { activeProject.value = (await api.get(`/screenplay/projects/${id}`)).data } catch (e) { error.value = e.response?.data?.message || '加载剧本项目失败' } }
async function createProject() { resetError(); if (!form.value.title) { error.value = '请填写剧本名称'; return } if (form.value.sourceType === 'adaptation' && !form.value.sourceNovelId) { error.value = '请选择要改编的小说'; return } creating.value = true; try { activeProject.value = (await api.post('/screenplay/projects', form.value)).data; await loadProjects() } catch (e) { error.value = e.response?.data?.message || '创建剧本项目失败' } finally { creating.value = false } }
async function developProject() { if (!activeProject.value) return; resetError(); developing.value = true; try { activeProject.value = (await api.post(`/screenplay/projects/${activeProject.value._id}/develop`)).data; await loadProjects() } catch (e) { error.value = e.response?.data?.message || '生成剧本圣经失败' } finally { developing.value = false } }
async function generateEpisode(number) { if (!activeProject.value) return; resetError(); generatingEpisode.value = number; try { const res = await api.post(`/screenplay/projects/${activeProject.value._id}/episodes/${number}/generate`); activeProject.value.episodes = activeProject.value.episodes.map((episode) => episode.episodeNumber === number ? { ...episode, ...res.data.episode } : episode) } catch (e) { error.value = e.response?.data?.message || '生成单集剧本失败' } finally { generatingEpisode.value = 0 } }
function closeProject() { activeProject.value = null; resetError(); loadProjects().catch(() => {}) }
onMounted(async () => { try { const [novelRes] = await Promise.all([api.get('/novel/bookshelf'), loadProjects()]); novels.value = novelRes.data || [] } catch (e) { error.value = e.response?.data?.message || '加载剧本工作台失败' } })
</script>

<style scoped>
.screenplay-page {
 padding-bottom: calc(var(--tab-height) + 28px);
 max-width: 760px;
}

/* === 工作台引言 === */
.workspace-intro { padding: 16px 2px 14px; }
.workspace-intro h1,
.project-topline h1 { margin: 0 0 6px; font-size: 20px; letter-spacing: 0; }
.workspace-intro p,
.project-topline p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.65; }

/* === 表单区 === */
.form-section { margin: 0 0 15px; }
.form-section > label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 7px; }
.field-hint { margin: 7px 0 0; color: var(--text-light); font-size: 12px; line-height: 1.5; }

.segmented { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--card-border); border-radius: 8px; overflow: hidden; }
.segmented button { min-height: 42px; border: 0; border-right: 1px solid var(--card-border); background: var(--card); color: var(--text-secondary); font: inherit; font-size: 13px; cursor: pointer; transition: background .15s; }
.segmented button:last-child { border-right: 0; }
.segmented button.selected { background: var(--primary); color: white; }

.input, .textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--card-border); border-radius: 6px; background: var(--card); color: var(--text-primary); font: inherit; padding: 10px; }
.textarea { resize: vertical; line-height: 1.6; }

.compact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.error-text { color: var(--error-color); font-size: 13px; margin: 12px 0 0; }

/* === 项目列表 === */
.project-list { margin-top: 24px; border-top: 1px solid var(--card-border); padding-top: 16px; }
.project-list h2, .episode-list > h2 { margin: 0 0 10px; font-size: 15px; }
.project-row { display: flex; width: 100%; justify-content: space-between; align-items: center; text-align: left; gap: 12px; border: 0; border-bottom: 1px solid var(--card-border); padding: 12px 0; background: transparent; color: var(--text-primary); cursor: pointer; }
.project-row-info { display: grid; gap: 4px; }
.project-row strong { font-size: 14px; }
.project-row small, .project-status { color: var(--text-light); font-size: 12px; }

/* === 项目顶栏 === */
.project-topline { display: flex; align-items: flex-start; gap: 10px; padding: 14px 0; }
.project-topline-title { flex: 1; min-width: 0; }
.icon-button { width: 32px; height: 32px; border: 1px solid var(--card-border); border-radius: 6px; background: var(--card); color: var(--text-primary); font-size: 18px; cursor: pointer; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; }

/* === 卡片通用 === */
.card { background: var(--card); border: 1px solid var(--card-border); border-radius: 10px; padding: 16px; margin-bottom: 12px; }

/* === 项目摘要 === */
.project-summary { display: grid; gap: 12px; margin-bottom: 12px; }
.summary-item { display: grid; gap: 4px; }
.summary-item span { color: var(--text-light); font-size: 12px; }
.summary-item strong { font-size: 13px; font-weight: 500; line-height: 1.55; }

/* === 动作卡 === */
.action-card h2, .bible-card h2 { margin: 0 0 7px; font-size: 16px; }
.action-card p { color: var(--text-secondary); font-size: 13px; line-height: 1.65; margin: 0 0 14px; }

/* === 剧本圣经 === */
.section-heading, .episode-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.logline { font-size: 14px; line-height: 1.7; margin: 0 0 14px; color: var(--text-primary); }

.bible-facts { display: grid; gap: 0; margin-bottom: 4px; }
.fact-row { display: grid; grid-template-columns: 80px 1fr; gap: 8px; padding: 8px 0; border-top: 1px solid var(--card-border); align-items: start; }
.fact-row span { color: var(--text-light); font-size: 12px; }
.fact-row strong { font-size: 13px; font-weight: 500; line-height: 1.55; }

.bible-block { margin-top: 16px; border-top: 1px solid var(--card-border); padding-top: 14px; }
.bible-block h3 { margin: 0 0 10px; font-size: 13px; color: var(--text-secondary); }
.bible-item { padding: 12px 0; border-bottom: 1px solid var(--card-border); }
.bible-item:last-child { border-bottom: 0; padding-bottom: 0; }
.bible-item:first-child { padding-top: 0; }
.bible-item-head { margin-bottom: 6px; }
.bible-item-head strong { font-size: 14px; }
.bible-item-visual { font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 4px; }
.bible-item-meta { font-size: 12px; color: var(--text-light); line-height: 1.55; margin-bottom: 4px; }
.bible-item-continuity { font-size: 12px; color: var(--primary); line-height: 1.55; padding-left: 8px; border-left: 2px solid var(--primary); }

/* === 分集剧本 === */
.episode-list { margin-top: 16px; }
.episode-card { margin-bottom: 12px; }
.episode-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.episode-header-info { flex: 1; min-width: 0; }
.episode-no { color: var(--text-light); font-size: 12px; display: block; }
.episode-header h3 { margin: 4px 0 0; font-size: 15px; }
.episode-premise { color: var(--text-secondary); font-size: 13px; line-height: 1.65; margin: 10px 0; }

.episode-facts { display: grid; gap: 8px; margin: 10px 0 0; padding: 10px 0 0; border-top: 1px solid var(--card-border); }
.episode-fact { display: grid; grid-template-columns: 40px 1fr; gap: 8px; align-items: start; }
.episode-fact label { color: var(--text-light); font-size: 12px; font-weight: 600; }
.episode-fact span { color: var(--text-secondary); font-size: 12px; line-height: 1.55; }

/* === 场景 === */
.scenes { border-top: 1px solid var(--card-border); margin-top: 12px; padding-top: 10px; }
.scene { padding: 12px 0; border-bottom: 1px solid var(--card-border); }
.scene:last-child { border-bottom: 0; padding-bottom: 0; }
.scene:first-child { padding-top: 0; }
.scene-heading { color: var(--primary); font-size: 12px; font-weight: 600; line-height: 1.5; }
.scene-characters { color: var(--text-light); font-size: 12px; margin-top: 4px; }
.scene-action { white-space: pre-wrap; color: var(--text-secondary); font-size: 13px; line-height: 1.72; margin: 8px 0; }

.dialogue-list { margin: 8px 0 0; padding-left: 10px; border-left: 2px solid var(--card-border); }
.dialogue { display: grid; grid-template-columns: 60px 1fr; gap: 8px; padding: 5px 0; font-size: 13px; line-height: 1.6; }
.dialogue-character { color: var(--primary); font-weight: 600; }
.dialogue-line { color: var(--text-primary); }

.scene-notes { margin-top: 8px; padding: 8px 10px; background: var(--bg-secondary, rgba(0,0,0,0.03)); border-radius: 6px; color: var(--text-light); font-size: 12px; line-height: 1.55; }

/* === 响应式 === */
@media (max-width: 420px) {
 .compact-grid { gap: 8px; }
 .episode-header { align-items: center; }
 .episode-header .btn { flex: 0 0 auto; }
 .fact-row { grid-template-columns: 68px 1fr; }
 .dialogue { grid-template-columns: 52px 1fr; }
}
</style>
