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
     <textarea id="screenplay-concept" v-model.trim="form.concept" class="textarea" rows="4" :placeholder="form.sourceType === 'adaptation' ? '例如：保留人物关系与核心谜团，压缩支线' : '只需写大体思路，AI 可继续扩展人物、场景、支线和伏笔'" />
    </section>
    <section v-if="form.sourceType === 'original'" class="form-section concept-ai-section">
     <div class="concept-ai-heading"><label>AI 扩展原创设定</label><span class="field-hint">先扩展，再建立剧本圣经</span></div>
     <label class="checkbox-row concept-mainline-toggle"><input type="checkbox" v-model="form.includeMainlinePlanning" /> <span>同时规划主线</span></label>
     <p class="field-hint">不勾选时，AI 不替你锁定唯一主线，只提供可选择的支线、人物、空间、伏笔和细节。</p>
     <button type="button" class="btn btn-secondary btn-block" :disabled="expandingConcept || !form.concept" @click="expandOriginalConcept">{{ expandingConcept ? '正在扩展设定...' : 'AI 扩展我的思路' }}</button>
     <div v-if="conceptExpansion" class="concept-expansion-preview"><strong>扩展结果已就绪</strong><span>{{ conceptExpansion.characters?.length || 0 }}人物 · {{ conceptExpansion.subplots?.length || 0 }}条支线 · {{ conceptExpansion.foreshadowing?.length || 0 }}个伏笔</span><p v-if="conceptExpansion.premise">{{ conceptExpansion.premise }}</p><p v-if="conceptExpansion.mainline"><b>主线：</b>{{ conceptExpansion.mainline }}</p><button type="button" class="btn btn-sm btn-primary" @click="applyConceptExpansion">应用到核心设定</button></div>
    </section>

   <section class="form-section">
    <label for="screenplay-persona">写作人格</label>
    <select id="screenplay-persona" v-model="form.personaId" class="input">
     <option value="">默认剧本人格</option>
     <option v-for="persona in screenplayPersonas" :key="persona._id" :value="persona._id">{{ persona.name }}{{ persona.isSystem ? '（系统）' : '' }}{{ persona.scope === 'screenplay' ? '（剧本）' : '' }}</option>
    </select>
    <div class="persona-inline-actions"><p class="field-hint">人格会锁定到本项目，并贯穿剧本圣经、分场生成、重生成和后续编辑。</p><button type="button" class="btn btn-sm btn-secondary" @click="personaModalOpen = true">新增剧本人格</button><button type="button" class="btn btn-sm btn-secondary" :disabled="personaBusy" @click="generateScreenplayPersona">AI 生成</button></div>
    <div v-if="personaModalOpen" class="screenplay-persona-editor">
     <div class="persona-editor-head"><strong>新增剧本人格</strong><button type="button" class="icon-button" title="关闭" @click="closePersonaEditor">×</button></div>
     <input v-model.trim="personaForm.name" class="input" maxlength="40" placeholder="人格名称，例如：生活流悬疑" />
     <input v-model.trim="personaForm.description" class="input" maxlength="200" placeholder="一句话描述" />
     <textarea v-model="personaForm.voice" class="textarea" rows="2" placeholder="作者声线：视角、叙事距离、温度" />
     <textarea v-model="personaForm.tone" class="textarea" rows="2" placeholder="语气与节奏：句长、停顿、对白密度" />
     <textarea v-model="personaForm.rules" class="textarea" rows="3" placeholder="剧本规则：空间调度、人物动作、镜头和声音要求" />
     <textarea v-model="personaForm.vocab" class="textarea" rows="2" placeholder="推荐词与禁用套词" />
     <label class="checkbox-row"><input type="checkbox" v-model="personaForm.overrideDeslop" /><span>使用本模板的去 AI 化规则</span></label>
     <div class="persona-editor-actions"><button type="button" class="btn btn-sm btn-primary" :disabled="personaBusy" @click="saveScreenplayPersona">保存</button><button type="button" class="btn btn-sm btn-secondary" @click="closePersonaEditor">取消</button></div>
     <p v-if="personaStatus" class="field-hint">{{ personaStatus }}</p>
    </div>
   </section>

   <div class="compact-grid">
    <section class="form-section">
     <label for="episode-count">集数</label>
     <input id="episode-count" v-model.number="form.episodeCount" class="input" type="number" min="1" max="120" />
    </section>
    <section class="form-section">
     <label for="episode-duration">单集秒数</label>
     <input id="episode-duration" v-model.number="form.episodeDurationSeconds" class="input" type="number" min="30" max="86400" step="30" />
    </section>
   </div>

   <section class="form-section visual-assets-options">
    <div class="concept-ai-heading"><label>配套视觉资产（可选）</label><span class="field-hint">不勾选不会调用生图模型</span></div>
    <div class="visual-assets-grid">
     <label class="checkbox-row"><input type="checkbox" v-model="form.imageGeneration.enabled" /> <span>启用配套生图</span></label>
     <label class="checkbox-row"><input type="checkbox" v-model="form.imageGeneration.characterPortraits" :disabled="!form.imageGeneration.enabled" /> <span>生成配套人物头像</span></label>
     <label class="checkbox-row"><input type="checkbox" v-model="form.imageGeneration.relationshipChart" :disabled="!form.imageGeneration.enabled" /> <span>生成关系图</span></label>
     <label class="checkbox-row"><input type="checkbox" v-model="form.imageGeneration.transitionBoards" :disabled="!form.imageGeneration.enabled" /> <span>生成每个转场场景站位图</span></label>
    </div>
    <div v-if="form.imageGeneration.enabled" class="image-model-row">
     <label for="image-model">生图模型</label>
     <select id="image-model" v-model="form.imageGeneration.modelId" class="input">
      <option v-for="model in imageModels" :key="model.id" :value="model.id">{{ model.alias }}{{ model.configured ? '' : '（未配置）' }}</option>
     </select>
    </div>
    <p class="field-hint">系统会根据人物规模、交付方式和场景需要自动选择尺寸与数量（每次 1-4 张），请求严格串行。</p>
   </section>

   <ReferenceSelector v-model:reference-ids="form.referenceIds" v-model:structure-pattern="form.structurePattern" :disabled="creating" @persona-created="useReferencePersona" />
   <button class="btn btn-primary btn-block" :disabled="creating" @click="createProject">{{ creating ? '正在创建...' : '创建剧本项目' }}</button>
   <p v-if="error" class="error-text">{{ error }}</p>
   <p v-if="notice" class="notice-text">{{ notice }}</p>

   <section v-if="projects.length" class="project-list">
    <h2>最近项目</h2>
    <button v-for="project in projects" :key="project._id" class="project-row" @click="openProject(project._id)">
     <span class="project-row-info">
      <strong>{{ project.title }}</strong>
      <small>{{ sourceLabel(project.sourceType) }} · {{ targetLabel(project.productionTarget) }}</small>
     </span>
     <span class="project-status">{{ project.status === 'developed' ? '已规划' : project.status === 'developing' ? '生成中' : project.status === 'paused' ? '已暂停' : '草稿' }}</span>
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

   <div v-if="hasBible" class="workspace-actions">
   <button class="btn btn-primary" :disabled="developing || autoGenerating || generatingEpisode" @click="generateAllEpisodes('generate')">{{ autoGenerating && batchMode === 'generate' ? `生成未完成集中（${autoGenerateProgress}）` : '自动生成未完成集' }}</button>
   <button class="btn btn-secondary" :disabled="developing || autoGenerating || generatingEpisode || !repairEpisodeCount" @click="generateAllEpisodes('quality_repair')">{{ autoGenerating && batchMode === 'quality_repair' ? `修复问题集中（${autoGenerateProgress}）` : `一键修复问题剧集${repairEpisodeCount ? `（${repairEpisodeCount}）` : ''}` }}</button>
   <button v-if="batchTask && ['queued', 'running'].includes(batchTask.status)" class="btn btn-secondary" :disabled="batchCancelling" @click="cancelBatchGeneration">{{ batchCancelling ? '正在暂停...' : '暂停批量生成' }}</button>
   <button v-if="batchTask?.status === 'paused' && !batchTask.cancellationRequested" class="btn btn-primary" :disabled="autoGenerating" @click="resumeBatchGeneration">继续批量生成</button>
   <span v-if="batchTask" class="batch-progress" :class="{ warning: batchTask.metadata?.failedEpisodes?.length }">{{ batchTask.progress || (batchTask.status === 'completed' ? '批量生成已完成' : '') }}<template v-if="batchTask.metadata?.failedDetails?.length">；{{ batchTask.metadata.failedDetails.map((item) => `第${item.episodeNumber}集：${item.error}`).join('；') }}</template></span>
    <div class="export-control">
     <button class="btn btn-secondary" :disabled="exporting || autoGenerating || generatingEpisode" @click="exportMenuOpen = !exportMenuOpen">{{ exporting ? '导出中...' : '导出剧本' }}</button>
     <div v-if="exportMenuOpen" class="export-menu">
      <button v-for="format in exportFormats" :key="format.value" type="button" @click="exportProject(format.value)">{{ format.label }}</button>
     </div>
    </div>
   </div>

   <!-- 建立剧本圣经 -->
   <section v-if="!hasBible" class="card action-card">
    <h2>建立剧本圣经</h2>
    <p>生成角色视觉设定、场景空间、连续性规则和全部分集大纲。</p>
    <button class="btn btn-primary btn-block" :disabled="developing" @click="developProject">{{ developing ? '正在生成剧本圣经...' : '生成剧本圣经与分集大纲' }}</button>
    <p v-if="developing" class="generation-status" role="status" aria-live="polite"><template v-if="developProgress">{{ developProgress }}<br></template>已等待 {{ developingElapsedSeconds }} 秒，请保持页面打开</p>
   </section>

   <template v-else>
    <!-- 剧本圣经 -->
    <section class="card bible-card">
     <div class="section-heading clickable-heading" @click="bibleCollapsed = !bibleCollapsed">
      <h2>剧本圣经</h2>
      <div class="section-heading-actions">
       <button class="icon-button" title="重新生成剧本圣经" :disabled="developing || autoGenerating" @click.stop="developProject">↻</button>
       <button class="icon-button" :title="bibleCollapsed ? '展开剧本圣经' : '收起剧本圣经'" @click.stop="bibleCollapsed = !bibleCollapsed">{{ bibleCollapsed ? '＋' : '－' }}</button>
      </div>
     </div>
    <p v-if="developing" class="generation-status bible-generation-status" role="status" aria-live="polite"><template v-if="developProgress">{{ developProgress }}<br></template>已等待 {{ developingElapsedSeconds }} 秒，请保持页面打开</p>
     <div v-if="!bibleCollapsed">
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
     <div v-if="activeProject.imageGeneration?.assets?.length" class="bible-block image-assets-block">
      <h3>配套视觉资产</h3>
      <p v-if="activeProject.imageGeneration.status === 'running'" class="field-hint">正在依次生成视觉资产，请保持页面打开。</p>
      <p v-if="activeProject.imageGeneration.lastError" class="field-hint error-text">{{ activeProject.imageGeneration.lastError }}</p>
      <div class="image-assets-grid">
      <div v-for="(asset, index) in activeProject.imageGeneration.assets.filter((item) => item.type !== 'transition_board')" :key="`${asset.createdAt || ''}-${index}`" class="image-asset-card">
        <div class="image-asset-title">{{ asset.label }} · {{ asset.size }}</div>
        <div v-if="asset.status === 'failed'" class="asset-error-row"><span class="field-hint error-text">生成失败：{{ asset.error }}</span><button type="button" class="btn btn-sm btn-secondary" :disabled="retryingAsset === index" @click="retryImageAsset(index)">{{ retryingAsset === index ? '重试中...' : '重试' }}</button></div>
        <img v-for="(url, imageIndex) in asset.urls || []" :key="`${index}-${imageIndex}`" :src="assetImageUrl(url)" :alt="asset.label" loading="lazy" />
       </div>
      </div>
     </div>

     <div class="bible-block">
      <h3>场景空间</h3>
      <div v-for="location in activeProject.screenplayBible.locations || []" :key="location.name" class="bible-item">
       <div class="bible-item-head"><strong>{{ location.name }}</strong></div>
       <div class="bible-item-visual">{{ location.visual }}</div>
       <div class="bible-item-meta">{{ location.storyFunction }}</div>
       <div class="bible-item-continuity">{{ location.continuity }}</div>
       <div v-for="asset in (activeProject.imageGeneration?.assets || []).filter((item) => item.type === 'scene_board' && item.locationName === location.name && item.status === 'completed')" :key="`${location.name}-${asset.createdAt || ''}`" class="location-assets">
        <div class="image-asset-title">场景画像 · {{ asset.size }}</div>
        <div class="image-asset-grid"><img v-for="(url, imageIndex) in asset.urls || []" :key="`${location.name}-${imageIndex}`" :src="assetImageUrl(url)" :alt="`${location.name}场景画像`" loading="lazy" /></div>
       </div>
      </div>
     </div>
     <div v-if="activeProject.screenplayBible.characterArcs?.length" class="bible-block">
      <h3>人物弧线</h3>
      <div v-for="(arc, index) in activeProject.screenplayBible.characterArcs" :key="`arc-${index}`" class="bible-item">
       <div class="bible-item-head"><strong>{{ arc.character || arc.name || '人物' }}</strong></div>
       <div class="bible-item-visual">{{ arc.startState || arc.start || '' }} → {{ arc.endState || arc.end || '' }}</div>
       <div class="bible-item-meta">转折：{{ arc.turningPoints || arc.turn || '' }} · 压力：{{ arc.pressure || '' }}</div>
      </div>
     </div>
     <div v-if="activeProject.screenplayBible.subplots?.length" class="bible-block">
      <h3>支线规划</h3>
      <div v-for="(subplot, index) in activeProject.screenplayBible.subplots" :key="`subplot-${index}`" class="bible-item">
       <div class="bible-item-head"><strong>{{ subplot.name || subplot.subplot || '支线' }}</strong></div>
       <div class="bible-item-visual">{{ subplot.purpose || '' }}</div>
       <div class="bible-item-meta">推进：{{ subplot.beats || subplot.progression || '' }}</div>
      </div>
     </div>
     <div v-if="activeProject.screenplayBible.foreshadowing?.length" class="bible-block">
      <h3>伏笔与回收</h3>
      <div v-for="(hook, index) in activeProject.screenplayBible.foreshadowing" :key="`hook-${index}`" class="bible-item">
       <div class="bible-item-head"><strong>{{ hook.id || `伏笔${index + 1}` }}</strong></div>
       <div class="bible-item-visual">埋设：{{ hook.setup || '' }}</div>
       <div class="bible-item-meta">回收：{{ hook.payoff || '' }} · 目标集：{{ hook.targetEpisodes || '' }}</div>
      </div>
     </div>
     </div>
    </section>

    <!-- 分集剧本 -->
    <section class="episode-list">
     <div class="section-heading episode-list-heading">
      <h2>分集剧本</h2>
      <button class="icon-button" :title="episodesCollapsed ? '展开分集剧本' : '收起分集剧本'" @click="episodesCollapsed = !episodesCollapsed">{{ episodesCollapsed ? '＋' : '－' }}</button>
     </div>
     <div v-if="!episodesCollapsed">
     <article v-for="episode in activeProject.episodes || []" :key="episode.episodeNumber" class="card episode-card">
      <div class="episode-header clickable-heading" @click="toggleEpisode(episode.episodeNumber)">
       <div class="episode-header-info">
        <span class="episode-no">第{{ episode.episodeNumber }}集 · {{ episode.durationSeconds }}秒</span>
        <h3>{{ episode.title }}</h3>
       </div>
       <button class="btn btn-sm btn-primary" :disabled="generatingEpisode === episode.episodeNumber || autoGenerating" @click.stop="generateEpisode(episode.episodeNumber)">{{ generatingEpisode === episode.episodeNumber ? '生成中...' : needsRepair(episode) ? '一键修复重生成' : episode.scenes?.length ? '重生成' : '生成剧本' }}</button>
      </div>
      <div v-if="!isEpisodeCollapsed(episode.episodeNumber)">
      <p class="episode-premise">{{ episode.premise }}</p>
       <div class="episode-facts">
       <div class="episode-fact"><label>冲突</label><span>{{ episode.conflict }}</span></div>
       <div class="episode-fact"><label>转折</label><span>{{ episode.turn }}</span></div>
        <div class="episode-fact"><label>钩子</label><span>{{ episode.cliffhanger }}</span></div>
       </div>
       <div v-if="episode.emotionalArc || episode.continuityState || episode.characterBeats?.length || episode.subplotBeats?.length || episode.setupPayoff?.length || episode.scenePlan?.length" class="episode-blueprint">
        <div v-if="episode.emotionalArc" class="blueprint-row"><label>情绪曲线</label><span>{{ episode.emotionalArc }}</span></div>
        <div v-if="episode.continuityState" class="blueprint-row"><label>连续性状态</label><span>{{ episode.continuityState }}</span></div>
        <div v-if="episode.characterBeats?.length" class="blueprint-row"><label>人物节拍</label><span>{{ episode.characterBeats.map((beat) => `${beat.character || '人物'}：${beat.before || ''} → ${beat.after || beat.choice || ''}`).join('；') }}</span></div>
        <div v-if="episode.subplotBeats?.length" class="blueprint-row"><label>支线节拍</label><span>{{ episode.subplotBeats.map((beat) => `${beat.subplot || '支线'}：${beat.beat || ''}`).join('；') }}</span></div>
        <div v-if="episode.setupPayoff?.length" class="blueprint-row"><label>伏笔节拍</label><span>{{ episode.setupPayoff.map((beat) => `${beat.foreshadowingId || beat.type || '伏笔'}：${beat.detail || ''}`).join('；') }}</span></div>
        <div v-if="episode.scenePlan?.length" class="blueprint-row"><label>场次计划</label><span>{{ episode.scenePlan.map((scene) => `${scene.sceneNumber || ''}场：${scene.purpose || scene.objective || ''}（${scene.location || ''}）`).join('；') }}</span></div>
       </div>
      <div v-if="generatingEpisode === episode.episodeNumber" class="episode-generation-progress" role="status" aria-live="polite">
       <span class="loading-spinner" aria-hidden="true"></span>
       <div>
        <strong>正在生成剧本正文</strong>
        <p>模型正在扩写场景、对白和人物调度，请保持页面打开。已等待 {{ generatingElapsedSeconds }} 秒</p>
       </div>
      </div>
      <div v-if="hasGenerationReport(episode)" class="generation-report">
       <span v-if="episode.generationReport.status === 'generating'" class="report-warning">后台仍在生成，请稍后刷新查看</span>
       <span v-if="episode.generationReport.status === 'failed'" class="report-warning">上次生成未完成：{{ episode.generationReport.lastError || '请重试' }}</span>
       <span v-if="episode.generationReport.status === 'partial'" class="report-warning">仅恢复了部分场景，建议重生成补全</span>
       <span>已生成 {{ episode.generationReport.sceneCount || 0 }} 场</span>
       <span>{{ episode.generationReport.dialogueLineCount || 0 }} 条对白</span>
       <span>{{ episode.generationReport.actionChars || 0 }} 字动作/空间描写</span>
       <span v-if="!(episode.generationReport.issues || []).length && episode.generationReport.coverage && !episode.generationReport.coverage.dialogue" class="report-warning">对白密度偏低，建议按警告修复</span>
       <span v-if="!(episode.generationReport.issues || []).length && episode.generationReport.coverage && !episode.generationReport.coverage.action" class="report-warning">动作/空间描写不足，建议按警告修复</span>
       <span v-for="issue in (episode.generationReport.issues || [])" :key="issue" class="report-warning">{{ issue }}，建议按警告修复</span>
      </div>
      <div v-else-if="episode.scenes?.length" class="generation-report report-warning">这是旧版生成结果，未经过新剧本质量检查，建议按警告修复</div>
      <div v-if="episode.scenes?.length" class="scenes">
       <article v-for="scene in episode.scenes" :key="scene.sceneNumber" class="scene">
        <div class="scene-heading">{{ scene.sceneNumber }}. {{ scene.interiorExterior }} · {{ scene.timeOfDay }} · {{ scene.location }}</div>
        <button type="button" class="btn btn-sm btn-secondary" :disabled="sceneEditingBlocked" @click="openSceneEdit(episode, scene)">编辑本场</button>
        <p v-if="scene.editedAt" class="field-hint">此场已手工修改；原生成质量统计和配图不会自动更新。</p>
        <div class="scene-characters">{{ scene.characters?.join('、') }}</div>
        <div v-if="scene.objective || scene.obstacle || scene.result" class="scene-facts">
         <div v-if="scene.objective"><label>目标</label><span>{{ scene.objective }}</span></div>
         <div v-if="scene.obstacle"><label>阻力</label><span>{{ scene.obstacle }}</span></div>
         <div v-if="scene.result"><label>结果</label><span>{{ scene.result }}</span></div>
        </div>
        <p class="scene-action">{{ scene.action }}</p>
        <div v-if="scene.dialogue?.length" class="dialogue-list">
         <div v-for="(line, index) in scene.dialogue" :key="index" class="dialogue">
          <strong class="dialogue-character">{{ line.character }}</strong>
          <span class="dialogue-line"><span>{{ line.line }}</span><small v-if="line.delivery || line.physicalAction || line.position">{{ [line.delivery, line.physicalAction, line.position].filter(Boolean).join('；') }}</small><em v-if="line.subtext">潜台词：{{ line.subtext }}</em></span>
         </div>
        </div>
        <div v-for="asset in (activeProject.imageGeneration?.assets || []).filter((item) => item.type === 'transition_board' && (item.episodeNumber == null || Number(item.episodeNumber) === Number(episode.episodeNumber)) && Number(item.sceneNumber) === Number(scene.sceneNumber))" :key="`scene-asset-${episode.episodeNumber}-${scene.sceneNumber}-${asset.createdAt || ''}`" class="scene-visual-assets">
         <div class="image-asset-title">场景站位画像 · {{ asset.size }}</div>
         <div v-if="asset.status === 'failed'" class="asset-error-row"><span class="field-hint error-text">生成失败：{{ asset.error }}</span><button type="button" class="btn btn-sm btn-secondary" :disabled="retryingAsset === activeProject.imageGeneration.assets.indexOf(asset)" @click="retryImageAsset(activeProject.imageGeneration.assets.indexOf(asset))">{{ retryingAsset === activeProject.imageGeneration.assets.indexOf(asset) ? '重试中...' : '重试' }}</button></div>
         <div class="image-asset-grid"><img v-for="(url, imageIndex) in asset.urls || []" :key="`${scene.sceneNumber}-${imageIndex}`" :src="assetImageUrl(url)" :alt="`第${scene.sceneNumber}场站位画像`" loading="lazy" /></div>
        </div>
        <div v-if="scene.productionNotes" class="scene-notes">{{ scene.productionNotes }}</div>
        <div v-if="scene.shotPlan" class="scene-notes">镜头：{{ scene.shotPlan }}</div>
        <div v-if="scene.soundDesign" class="scene-notes">声音：{{ scene.soundDesign }}</div>
       </article>
      </div>
      </div>
     </article>
     </div>
    </section>
   </template>
   <ScreenplaySceneEditor v-if="editingScene" :project-id="activeProject._id" :episode-number="editingScene.episodeNumber" :scene="editingScene.scene" :busy="sceneEditingBlocked" @saved="applySceneEdit" @close="editingScene = null" />
   <p v-if="error" class="error-text">{{ error }}</p>
   <p v-if="notice" class="notice-text">{{ notice }}</p>
  </div>
 </div>
</template>

<script setup>
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'
import api from '../api'
import ReferenceSelector from '../components/ReferenceSelector.vue'
import ScreenplaySceneEditor from '../components/ScreenplaySceneEditor.vue'
import { buildModelOverrideHeader, HEADER_NAME } from '../utils/modelOverride'
import { saveBlob } from '../utils/download'
import { usePersonaStore } from '../stores/persona'
import { useAuthStore } from '../stores/auth'
const personaStore = usePersonaStore()
const authStore = useAuthStore()
const form = ref({ sourceType: 'adaptation', productionTarget: 'video', sourceNovelId: '', title: '', concept: '', conceptExpansion: null, includeMainlinePlanning: false, episodeCount: 12, episodeDurationSeconds: 120, personaId: '', imageGeneration: { enabled: false, modelId: 'image_1', characterPortraits: false, relationshipChart: false, transitionBoards: false } })
const personas = ref([])
const screenplayPersonas = computed(() => personas.value.filter((persona) => !persona.scope || persona.scope === 'all' || persona.scope === 'screenplay'))
function useReferencePersona(persona) { if (!personas.value.some(value => value._id === persona._id)) personas.value.push(persona); form.value.personaId = persona._id }
const imageModels = ref([{ id: 'image_1', alias: '生图模型一', configured: false }, { id: 'image_2', alias: '生图模型二', configured: false }])
const novels = ref([]), projects = ref([]), activeProject = ref(null), creating = ref(false), developing = ref(false), developingStartedAt = ref(0), developingElapsedSeconds = ref(0), developProgress = ref(''), generatingEpisode = ref(0), generatingStartedAt = ref(0), generatingElapsedSeconds = ref(0), autoGenerating = ref(false), autoGenerateProgress = ref(''), exporting = ref(false), exportMenuOpen = ref(false), bibleCollapsed = ref(false), episodesCollapsed = ref(false), collapsedEpisodes = ref(new Set()), error = ref('')
const batchTask = ref(null), batchCancelling = ref(false), batchMode = ref('generate'), notice = ref(''), retryingAsset = ref(-1)
const editingScene = ref(null)
const sceneEditingBlocked = computed(() => developing.value || autoGenerating.value || Boolean(generatingEpisode.value) || ['queued', 'running'].includes(batchTask.value?.status))
function openSceneEdit(episode, scene) {
 if (!sceneEditingBlocked.value) editingScene.value = { episodeNumber: episode.episodeNumber, scene }
}
function applySceneEdit(scene) {
 const episode = activeProject.value?.episodes?.find(item => item.episodeNumber === editingScene.value?.episodeNumber)
 if (!episode) return
 episode.scenes = episode.scenes.map(item => item.sceneNumber === scene.sceneNumber ? scene : item)
 notice.value = '场景修改已保存。后续导出和续集生成将使用已保存的正文。'
}
const expandingConcept = ref(false), conceptExpansion = ref(null)
const personaModalOpen = ref(false), personaBusy = ref(false), personaStatus = ref('')
const personaForm = ref({ _id: '', name: '', description: '', voice: '', tone: '', rules: '', vocab: '', overrideDeslop: false })
let batchPollTimer = null
// App.vue 对页面做了 keep-alive：切页不触发 onUnmounted，必须用
// onActivated/onDeactivated 控制轮询，否则离开页面后定时器仍在空转。
let pageActive = true
const exportFormats = [
 { value: 'txt', label: '导出 TXT' },
 { value: 'md', label: '导出 Markdown' },
 { value: 'html', label: '导出 HTML' },
 { value: 'docx', label: '导出 DOCX' },
]
function isBatchRunnable(task) { return Boolean(task && (['queued', 'running'].includes(task.status) || (task.status === 'paused' && !task.cancellationRequested))) }
let generationTimer = null
let developingTimer = null
const hasBible = computed(() => Boolean(activeProject.value?.screenplayBible?.logline))
function sourceLabel(value) { return value === 'adaptation' ? '小说改编' : '原创短剧' }
function targetLabel(value) { return value === 'video' ? '视频生成' : '实拍制作' }
function resetError() { error.value = ''; notice.value = '' }
function closePersonaEditor() { personaModalOpen.value = false; personaStatus.value = ''; personaForm.value = { _id: '', name: '', description: '', voice: '', tone: '', rules: '', vocab: '', overrideDeslop: false } }
async function saveScreenplayPersona() {
 if (personaBusy.value) return
 if (!personaForm.value.name) { personaStatus.value = '请填写人格名称'; return }
 personaBusy.value = true; personaStatus.value = '正在保存...'
 try {
  const payload = { ...personaForm.value, scope: 'screenplay' }
  const response = personaForm.value._id ? await api.put(`/persona/${personaForm.value._id}`, payload) : await api.post('/persona', payload)
  const saved = response.data
  const index = personas.value.findIndex((item) => item._id === saved._id)
  if (index >= 0) personas.value[index] = saved; else personas.value.push(saved)
  form.value.personaId = saved._id
  closePersonaEditor(); notice.value = '剧本人格已保存并选中。'
 } catch (e) { personaStatus.value = e.response?.data?.message || '保存剧本人格失败' } finally { personaBusy.value = false }
}
async function generateScreenplayPersona() {
 if (personaBusy.value) return
 const topic = form.value.concept || '连续短剧'
 personaBusy.value = true; personaStatus.value = 'AI 正在设计剧本人格...'
 try {
  const saved = (await api.post('/persona/ai-generate', { novelType: topic.slice(0, 120), hint: '必须突出场景空间、人物走位、对白潜台词、镜头和声音的可执行写法。', scope: 'screenplay' }, { timeout: 0 })).data
  personas.value.push(saved); form.value.personaId = saved._id; notice.value = 'AI 剧本人格已生成并选中。'
 } catch (e) { personaStatus.value = e.response?.data?.message || 'AI 生成剧本人格失败' } finally { personaBusy.value = false }
}
function hasGenerationReport(episode) { return Boolean(episode?.generationReport?.generatedAt || episode?.generationReport?.sceneCount || episode?.generationReport?.status) }
// 生成按实际 AI 用量计费：先预检余额，避免带着 0 余额发起长任务后才发现失败
async function ensureBillingReady({ requireConfirm = false, costHint = '' } = {}) {
 if (!authStore.isLoggedIn) { error.value = '请先登录'; return false }
 return !requireConfirm || window.confirm(costHint + '\n确认开始批量生成？')
}
function needsRepair(episode) {
 const report = episode?.generationReport
 return Boolean(report?.status === 'failed' || report?.status === 'partial' || (episode?.scenes?.length && (!hasGenerationReport(episode) || report?.coverage?.scenes === false || report?.coverage?.dialogue === false || report?.coverage?.action === false || report?.coverage?.dialogueMetadata === false || report?.coverage?.sceneExecution === false || report?.issues?.length)))
}
function needsGeneration(episode) { return !episode?.scenes?.length || episode?.generationReport?.status === 'failed' }
// 生图服务商可能返回 http:// 图片地址，https 站点会被浏览器按“混合内容”拦截；
// 且 img 标签无法携带鉴权头。统一走后端同源代理，token 通过查询参数传递。
function assetImageUrl(url) {
 if (!url) return ''
 if (url.startsWith('data:') || url.startsWith('/')) return url
 const token = localStorage.getItem('token')
 return `/api/screenplay/image-proxy?token=${encodeURIComponent(token || '')}&url=${encodeURIComponent(url)}`
}
const repairEpisodeCount = computed(() => (activeProject.value?.episodes || []).filter(needsRepair).length)
async function loadProjects() { projects.value = (await api.get('/screenplay/projects')).data || [] }
async function loadImageModels() { try { const data = (await api.get('/screenplay/image-config')).data; if (Array.isArray(data.models) && data.models.length) imageModels.value = data.models } catch {} }
async function retryImageAsset(index) {
 if (!activeProject.value || retryingAsset.value >= 0) return
 retryingAsset.value = index; resetError()
 try { activeProject.value = (await api.post(`/screenplay/projects/${activeProject.value._id}/image-assets/${index}/retry`, {}, { timeout: 0 })).data.project; notice.value = '视觉资产已重试。' }
 catch (e) { error.value = e.response?.data?.message || '图片重试失败' }
 finally { retryingAsset.value = -1 }
}
// 打开项目只加载状态，不自动恢复批量生成——恢复涉及持续扣积分，
// 必须由用户点击“继续批量生成”显式触发。
async function openProject(id) { resetError(); try { activeProject.value = (await api.get(`/screenplay/projects/${id}`)).data; await loadBatchTask(); startBatchPollingIfNeeded() } catch (e) { error.value = e.response?.data?.message || '加载剧本项目失败' } }
async function expandOriginalConcept() { if (form.value.sourceType !== 'original' || expandingConcept.value || !form.value.concept) return; resetError(); expandingConcept.value = true; try { conceptExpansion.value = (await api.post('/screenplay/projects/expand-concept', { concept: form.value.concept, episodeCount: form.value.episodeCount, episodeDurationSeconds: form.value.episodeDurationSeconds, personaId: form.value.personaId || undefined, includeMainlinePlanning: form.value.includeMainlinePlanning }, { timeout: 0 })).data.expansion } catch (e) { error.value = e.response?.data?.message || e.response?.data?.error || 'AI 扩展原创设定失败' } finally { expandingConcept.value = false } }
function applyConceptExpansion() {
 if (!conceptExpansion.value) return
 form.value.conceptExpansion = conceptExpansion.value
 // Keep repeated clicks idempotent so the generated premise is not appended
 // over and over to the user's seed text.
 const premise = String(conceptExpansion.value.premise || '').trim()
 const current = String(form.value.concept || '').trim()
 if (premise && !current.split(/\n\s*\n/).some((block) => block.trim() === premise)) form.value.concept = `${current}${current ? '\n\n' : ''}${premise}`
 notice.value = 'AI 扩展设定已应用，创建项目后会进入剧本圣经。'
}
async function createProject() { resetError(); if (!form.value.title) { error.value = '请填写剧本名称'; return } if (form.value.sourceType === 'adaptation' && !form.value.sourceNovelId) { error.value = '请选择要改编的小说'; return } creating.value = true; try { activeProject.value = (await api.post('/screenplay/projects', form.value)).data; await loadProjects() } catch (e) { error.value = e.response?.data?.message || '创建剧本项目失败' } finally { creating.value = false } }
async function developProject() {
 if (!activeProject.value || developing.value) return
 if (activeProject.value.episodes?.some(episode => episode.scenes?.some(scene => scene.editedAt)) && !window.confirm('本项目含手工修改。重新规划剧本可能替换分集与正文，确认继续？')) return
 resetError()
 if (!await ensureBillingReady()) return
 developing.value = true
 developingStartedAt.value = Date.now()
 developingElapsedSeconds.value = 0
 developProgress.value = '正在生成剧本圣经与首批分集…'
 developingTimer = window.setInterval(() => {
  developingElapsedSeconds.value = Math.floor((Date.now() - developingStartedAt.value) / 1000)
 }, 1000)
 const projectId = activeProject.value._id
 try {
  // 分阶段 SSE：圣经+首批分集先出，剩余分集按批推送，每批即时渲染展示
  const token = localStorage.getItem('token')
  const res = await fetch(`/api/screenplay/projects/${projectId}/develop-stream`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json',
    ...(buildModelOverrideHeader() ? { [HEADER_NAME]: buildModelOverrideHeader() } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  if (!res.ok || !res.body) {
   let message = '生成剧本圣经失败，请稍后重试'
   try { const j = await res.json(); message = j.message || message } catch {}
   throw new Error(message)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
   const { done, value } = await reader.read()
   if (done) break
   buffer += decoder.decode(value, { stream: true })
   const lines = buffer.split('\n')
   buffer = lines.pop() || ''
   for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data: ')) continue
    let evt; try { evt = JSON.parse(trimmed.slice(6)) } catch { continue }
    if (evt.type === 'bible' || evt.type === 'episodes_batch') {
     if (evt.bible) activeProject.value.screenplayBible = evt.bible
     if (Array.isArray(evt.episodes)) activeProject.value.episodes = evt.episodes
     if (evt.progress) developProgress.value = evt.progress
    } else if (evt.type === 'progress') {
     developProgress.value = evt.message || ''
    } else if (evt.type === 'completed') {
     if (evt.project) activeProject.value = evt.project
     developProgress.value = evt.progress || '全部生成完成'
    } else if (evt.type === 'partial') {
     if (Array.isArray(evt.episodes)) activeProject.value.episodes = evt.episodes
     developProgress.value = evt.message || ''
     error.value = evt.message || ''
    } else if (evt.type === 'error') {
     error.value = evt.message || '生成剧本圣经失败'
     developProgress.value = evt.message || ''
    }
   }
  }
  await loadProjects()
 } catch (e) {
  error.value = e.message || '生成剧本圣经失败'
 } finally {
  developing.value = false
  if (developingTimer) { window.clearInterval(developingTimer); developingTimer = null }
  developingStartedAt.value = 0
 }
}
async function generateEpisode(number) {
 if (!activeProject.value || generatingEpisode.value) return
 if (activeProject.value.episodes.find(item => item.episodeNumber === number)?.scenes?.some(scene => scene.editedAt) && !window.confirm('本集含手工修改。重生成将替换本集已有正文，确认继续？')) return
 resetError()
 if (!await ensureBillingReady()) return
 generatingEpisode.value = number
 generatingStartedAt.value = Date.now()
 generatingElapsedSeconds.value = 0
 generationTimer = window.setInterval(() => {
  generatingElapsedSeconds.value = Math.floor((Date.now() - generatingStartedAt.value) / 1000)
 }, 1000)
 const projectId = activeProject.value._id
 try {
  // 长剧本可能需要数分钟，不能沿用普通 API 的 60 秒超时。
 const currentEpisode = activeProject.value.episodes.find((item) => item.episodeNumber === number)
  const mode = needsRepair(currentEpisode) ? 'quality_repair' : 'generate'
  const res = await api.post(`/screenplay/projects/${activeProject.value._id}/episodes/${number}/generate`, { mode }, { timeout: 0 })
  activeProject.value.episodes = activeProject.value.episodes.map((item) => item.episodeNumber === number ? { ...item, ...res.data.episode } : item)
  // 单集接口会在生成完成后返回最新的视觉资产状态，立即合并到当前项目，
  // 避免用户必须刷新或重新打开项目才能看到场景站位图。
  if (res.data?.imageGeneration) {
   activeProject.value.imageGeneration = res.data.imageGeneration
  }
 } catch (e) {
  try { await openProject(projectId) } catch {}
  error.value = e.response?.data?.message || '生成单集剧本失败'
 } finally {
  if (generationTimer) { window.clearInterval(generationTimer); generationTimer = null }
  generatingEpisode.value = 0
  generatingStartedAt.value = 0
 }
}
function toggleEpisode(number) {
 const next = new Set(collapsedEpisodes.value)
 next.has(number) ? next.delete(number) : next.add(number)
 collapsedEpisodes.value = next
}
function isEpisodeCollapsed(number) { return collapsedEpisodes.value.has(number) }
async function generateAllEpisodes(mode = 'generate') {
 if (!activeProject.value || autoGenerating.value || generatingEpisode.value) return
 const queue = (activeProject.value.episodes || []).filter(mode === 'quality_repair' ? needsRepair : needsGeneration)
 if (!queue.length) { notice.value = '所有分集都已生成且通过质量检查'; return }
 resetError()
 const editedEpisodes = queue.filter(episode => episode.scenes?.some(scene => scene.editedAt)).map(episode => episode.episodeNumber)
 const editWarning = editedEpisodes.length ? `\n第 ${editedEpisodes.join('、')} 集含手工修改，生成会替换这些集的已有正文。` : ''
 if (!await ensureBillingReady({ requireConfirm: true, costHint: `本次将排队生成 ${queue.length} 集。${editWarning}` })) return
 autoGenerating.value = true
 batchMode.value = mode
 try {
  const taskResponse = await api.post(`/screenplay/projects/${activeProject.value._id}/batch/start`, { episodeNumbers: queue.map((episode) => episode.episodeNumber), mode })
  batchTask.value = taskResponse.data?.task || null
  startBatchPollingIfNeeded()
  await waitForBatchTask()
 } finally {
  autoGenerating.value = false
  autoGenerateProgress.value = ''
  batchMode.value = 'generate'
 }
}
async function resumeBatchGeneration() {
 if (autoGenerating.value || generatingEpisode.value || !isBatchRunnable(batchTask.value) || !activeProject.value) return
 const episodeNumbers = batchTask.value.metadata?.episodeNumbers || []
 const queue = episodeNumbers.map((number) => activeProject.value.episodes.find((episode) => episode.episodeNumber === number)).filter(Boolean)
 if (!queue.length) return
 if (queue.some(episode => episode.scenes?.some(scene => scene.editedAt)) && !window.confirm('待生成的分集中含手工修改。继续批量生成将替换相应集的已有正文，确认继续？')) return
 autoGenerating.value = true
 try {
  if (batchTask.value.status === 'paused') {
   batchMode.value = batchTask.value.metadata?.mode === 'quality_repair' ? 'quality_repair' : 'generate'
   batchTask.value = (await api.post(`/screenplay/projects/${activeProject.value._id}/batch/start`, { episodeNumbers: queue.map((episode) => episode.episodeNumber), mode: batchMode.value })).data?.task || batchTask.value
  }
  startBatchPollingIfNeeded()
  await waitForBatchTask()
 } finally { autoGenerating.value = false; autoGenerateProgress.value = ''; batchMode.value = 'generate'; await loadBatchTask() }
}
async function waitForBatchTask() {
 for (let attempt = 0; attempt < 21600; attempt += 1) {
  if (!batchTask.value || !isBatchRunnable(batchTask.value)) break
  if (!pageActive) break
  const completed = batchTask.value.metadata?.completedEpisodes?.length || 0
  const failed = batchTask.value.metadata?.failedEpisodes?.length || 0
  const total = batchTask.value.metadata?.episodeNumbers?.length || batchTask.value.totalUnits || 0
  autoGenerateProgress.value = `${completed + failed}/${total}（${batchTask.value.progress || '后台生成中'}）`
  await new Promise((resolve) => window.setTimeout(resolve, 4000))
  await loadBatchTask()
 }
 // 批量结束（或离开页面停止等待）后整包刷新一次，同步每集正文
 if (activeProject.value) {
  try { activeProject.value = (await api.get(`/screenplay/projects/${activeProject.value._id}`)).data } catch {}
 }
}
const KNOWN_REPORT_STATUSES = ['generating', 'completed', 'partial', 'failed']
async function loadBatchTask() {
 if (!activeProject.value) return
 try {
  const data = (await api.get(`/screenplay/projects/${activeProject.value._id}/generation-task`)).data
  batchTask.value = data?.batchTask || null
  // /generation-task 自带轻量进度（不含场次正文），把它合并进当前集状态，
  // 避免轮询期间每 4 秒整包拉回整个项目。
  const lightEpisodes = data?.project?.episodes || []
  if (lightEpisodes.length) {
   activeProject.value.episodes = activeProject.value.episodes.map((episode) => {
    const light = lightEpisodes.find((item) => item.episodeNumber === episode.episodeNumber)
    return light && KNOWN_REPORT_STATUSES.includes(light.status)
     ? { ...episode, generationReport: { ...(episode.generationReport || {}), status: light.status } }
     : episode
   })
  }
 } catch {}
}
function startBatchPollingIfNeeded() {
 stopBatchPolling()
 if (!pageActive) return
 if (!isBatchRunnable(batchTask.value)) return
 batchPollTimer = window.setInterval(async () => {
  await loadBatchTask()
  if (!isBatchRunnable(batchTask.value)) stopBatchPolling()
 }, 4000)
}
function stopBatchPolling() { if (batchPollTimer) { window.clearInterval(batchPollTimer); batchPollTimer = null } }
async function cancelBatchGeneration() {
 if (!activeProject.value || batchCancelling.value) return
 batchCancelling.value = true
 try { batchTask.value = (await api.post(`/screenplay/projects/${activeProject.value._id}/batch/cancel`)).data?.task || batchTask.value } catch (e) { error.value = e.response?.data?.message || '暂停批量生成失败' } finally { batchCancelling.value = false }
}
async function exportProject(format) {
 if (!activeProject.value || exporting.value) return
 resetError()
 exporting.value = true
 exportMenuOpen.value = false
 try {
  const payload = { format }
  if (format === 'html') {
   payload.viewState = {
    bibleCollapsed: bibleCollapsed.value,
    episodesCollapsed: episodesCollapsed.value,
    collapsedEpisodes: [...collapsedEpisodes.value],
   }
  }
  const response = await api.post(`/screenplay/projects/${activeProject.value._id}/export`, payload, { responseType: 'blob', timeout: 0 })
  const blob = response.data
  const disposition = response.headers['content-disposition'] || ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  const fileName = encoded ? decodeURIComponent(encoded[1]) : `${activeProject.value.title}.${format}`
  await saveBlob(blob, fileName)
 } catch (e) {
  error.value = e.response?.data?.message || '剧本导出失败'
 } finally { exporting.value = false }
}
function closeProject() { activeProject.value = null; batchTask.value = null; stopBatchPolling(); resetError(); loadProjects().catch(() => {}) }
onMounted(async () => { try { const [novelRes, , personaList] = await Promise.all([api.get('/novel/bookshelf'), loadProjects(), personaStore.fetchList(), loadImageModels()]); novels.value = novelRes.data || []; personas.value = personaList || [] } catch (e) { error.value = e.response?.data?.message || '加载剧本工作台失败' } })
onActivated(() => { pageActive = true; startBatchPollingIfNeeded() })
onDeactivated(() => { pageActive = false; stopBatchPolling() })
onUnmounted(() => { pageActive = false; if (generationTimer) window.clearInterval(generationTimer); if (developingTimer) window.clearInterval(developingTimer); stopBatchPolling() })
</script>

<style scoped>
.screenplay-page {
 width: min(100%, 1180px);
 margin: 0 auto;
 padding: 0 clamp(16px, 4vw, 42px) calc(var(--tab-height) + 36px);
 box-sizing: border-box;
}

.screenplay-page .page-header { margin: 0 calc(clamp(16px, 4vw, 42px) * -1) 18px; padding: 14px clamp(16px, 4vw, 42px); justify-content: flex-start; background: color-mix(in srgb, var(--card) 88%, transparent); border-bottom: 1px solid var(--card-border); }
.creator { width: min(100%, 920px); margin: 0 auto; }
.project-workspace { width: 100%; }
.workspace-intro { padding: 18px 0 24px; }
.workspace-intro h1 { font-size: clamp(22px, 3vw, 30px); letter-spacing: 0; }
.workspace-intro p { max-width: 680px; font-size: 14px; }

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

.compact-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }

.error-text { color: var(--error-color); font-size: 13px; margin: 12px 0 0; }
.notice-text { color: var(--text-secondary); font-size: 13px; margin: 12px 0 0; }

/* === 项目列表 === */
.project-list { margin-top: 24px; border-top: 1px solid var(--card-border); padding-top: 16px; }
.project-list h2, .episode-list > h2 { margin: 0 0 10px; font-size: 15px; }
.project-row { display: flex; width: 100%; justify-content: space-between; align-items: center; text-align: left; gap: 12px; border: 0; border-bottom: 1px solid var(--card-border); padding: 12px 0; background: transparent; color: var(--text-primary); cursor: pointer; }
.project-row-info { display: grid; gap: 4px; }
.project-row strong { font-size: 14px; }
.project-row small, .project-status { color: var(--text-light); font-size: 12px; }

/* === 项目顶栏 === */
.project-topline { display: flex; align-items: flex-start; gap: 12px; padding: 18px 0; }
.project-topline-title { flex: 1; min-width: 0; }
.icon-button { width: 32px; height: 32px; border: 1px solid var(--card-border); border-radius: 6px; background: var(--card); color: var(--text-primary); font-size: 18px; cursor: pointer; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; }

/* === 卡片通用 === */
.card { background: var(--card); border: 1px solid var(--card-border); border-radius: 10px; padding: clamp(16px, 2.4vw, 24px); margin: 0 0 16px; box-shadow: 0 8px 24px rgba(35, 63, 45, 0.05); }

/* === 项目摘要 === */
.project-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-bottom: 16px; }
.summary-item { display: grid; gap: 4px; }
.summary-item span { color: var(--text-light); font-size: 12px; }
.summary-item strong { font-size: 13px; font-weight: 500; line-height: 1.55; }

.workspace-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 0 0 16px; }
.workspace-actions .btn { min-height: 38px; }
.batch-progress { color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.batch-progress.warning { color: var(--warning, #a66a00); }
.export-control { position: relative; }
.export-menu { position: absolute; z-index: 5; top: calc(100% + 6px); right: 0; min-width: 150px; padding: 6px; background: var(--card); border: 1px solid var(--card-border); border-radius: 8px; box-shadow: 0 10px 24px rgba(35,63,45,.14); }
.export-menu button { display: block; width: 100%; border: 0; border-radius: 5px; padding: 9px 10px; text-align: left; background: transparent; color: var(--text-primary); font: inherit; font-size: 13px; cursor: pointer; }
.export-menu button:hover { background: var(--primary-light, rgba(63,125,90,.1)); color: var(--primary); }

/* === 动作卡 === */
.action-card h2, .bible-card h2 { margin: 0 0 7px; font-size: 16px; }
.action-card p { color: var(--text-secondary); font-size: 13px; line-height: 1.65; margin: 0 0 14px; }
.generation-status { display: flex; align-items: center; gap: 8px; margin: -4px 0 14px; color: var(--primary); }
.generation-status::before { content: ''; width: 12px; height: 12px; flex: 0 0 auto; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: screenplay-spin .8s linear infinite; }
.bible-generation-status { margin: 12px 0 14px; }

/* === 剧本圣经 === */
.section-heading, .episode-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.clickable-heading { cursor: pointer; }
.section-heading-actions { display: flex; gap: 6px; flex: 0 0 auto; }
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
.episode-list-heading { margin: 0 0 14px; align-items: center; }
.episode-list-heading h2 { font-size: 20px; margin: 0; }
.episode-card { margin-bottom: 12px; }
.episode-generation-progress { display: flex; align-items: center; gap: 12px; margin: 12px 0; padding: 14px; color: var(--primary); background: var(--primary-light, rgba(63, 125, 90, 0.08)); border: 1px solid var(--primary-border, rgba(63, 125, 90, 0.22)); border-radius: 8px; }
.episode-generation-progress strong { display: block; font-size: 13px; }
.episode-generation-progress p { margin: 4px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.55; }
.episode-generation-progress .loading-spinner { width: 22px; height: 22px; flex: 0 0 auto; border-width: 3px; }
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
.episode-blueprint { margin: 12px 0; padding: 10px 12px; background: var(--bg-secondary); border-radius: 8px; display: grid; gap: 7px; }
.blueprint-row { display: grid; grid-template-columns: 72px 1fr; gap: 8px; font-size: 12px; line-height: 1.55; }
.blueprint-row label, .scene-facts label { color: var(--text-light); }
.scene-facts { display: grid; gap: 4px; margin: 8px 0; padding: 8px 10px; border-left: 2px solid var(--primary); background: var(--primary-light); font-size: 12px; }
.scene-facts > div { display: grid; grid-template-columns: 36px 1fr; gap: 8px; }
.scene-action { white-space: pre-wrap; color: var(--text-secondary); font-size: 13px; line-height: 1.72; margin: 8px 0; }

.dialogue-list { margin: 8px 0 0; padding-left: 10px; border-left: 2px solid var(--card-border); }
.dialogue { display: grid; grid-template-columns: 60px 1fr; gap: 8px; padding: 5px 0; font-size: 13px; line-height: 1.6; }
.dialogue-character { color: var(--primary); font-weight: 600; }
.dialogue-line { color: var(--text-primary); }
.dialogue-line small,.dialogue-line em { display:block; margin-top:3px; color:var(--text-secondary); font-size:12px; line-height:1.55; font-style:normal; }
.dialogue-line em { color:var(--primary); }
.generation-report { display:flex; flex-wrap:wrap; gap:6px 12px; margin-top:10px; padding:8px 0; border-top:1px solid var(--card-border); color:var(--text-light); font-size:11px; }
.report-warning { color:var(--warning); }
.concept-ai-section { border: 1px solid var(--primary-border, rgba(63,125,90,.25)); background: var(--primary-light, rgba(63,125,90,.05)); }
.concept-ai-heading { display:flex; justify-content:space-between; align-items:center; gap:10px; }
.concept-mainline-toggle { margin: 10px 0 2px; }
.concept-expansion-preview { margin-top: 12px; padding: 12px; background: var(--card-bg, #fff); border: 1px solid var(--card-border); border-radius: 8px; display: grid; gap: 6px; }
.concept-expansion-preview span { color: var(--text-secondary); font-size: 12px; }
.visual-assets-options { border: 1px solid var(--card-border); background: var(--card-bg, #fff); }
.visual-assets-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; margin: 12px 0 10px; }
.image-model-row { display: grid; grid-template-columns: 110px minmax(0, 1fr); align-items: center; gap: 10px; max-width: 560px; }
.image-model-row label { color: var(--text-secondary); font-size: 12px; }
.image-assets-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.image-asset-card { min-width: 0; padding: 10px; border: 1px solid var(--card-border); border-radius: 8px; background: var(--card-bg, #fff); }
.asset-error-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.location-assets { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--card-border); }
.scene-visual-assets { margin: 10px 0; padding: 10px; border: 1px solid var(--card-border); border-radius: 8px; background: var(--bg-secondary); }
.image-asset-title { color: var(--text-secondary); font-size: 12px; margin-bottom: 8px; }
.image-asset-card img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; background: var(--bg-secondary); }
.image-asset-grid { width: 100%; max-width: 100%; min-width: 0; overflow: hidden; display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
.image-asset-grid img, .location-assets img, .scene-visual-assets img { display: block; width: 100%; max-width: 100%; height: auto; max-height: 420px; min-width: 0; object-fit: contain; border-radius: 6px; background: var(--bg-secondary); }
.image-asset-card, .location-assets, .scene-visual-assets { max-width: 100%; min-width: 0; overflow: hidden; }
@media(max-width:640px){.visual-assets-grid{grid-template-columns:1fr}.image-model-row{grid-template-columns:1fr;gap:4px}}
.concept-expansion-preview p { margin: 4px 0; color: var(--text-secondary); line-height: 1.6; font-size: 13px; }
.persona-inline-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.persona-inline-actions .field-hint { flex: 1 1 240px; margin: 0; }
.screenplay-persona-editor { margin-top: 10px; padding: 12px; border: 1px solid var(--card-border); background: var(--bg-secondary); border-radius: 8px; display: grid; gap: 8px; }
.persona-editor-head, .persona-editor-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.persona-editor-actions { justify-content: flex-end; }
@keyframes screenplay-spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
 .screenplay-page { padding-left: 12px; padding-right: 12px; }
 .screenplay-page .page-header { margin-left: -12px; margin-right: -12px; padding-left: 12px; padding-right: 12px; }
 .compact-grid, .project-summary { grid-template-columns: 1fr; gap: 0; }
 .project-summary .summary-item + .summary-item { padding-top: 12px; border-top: 1px solid var(--card-border); }
 .episode-header { align-items: center; }
 .episode-header .btn { flex: 0 0 auto; min-width: 84px; padding-left: 10px; padding-right: 10px; }
 .dialogue { grid-template-columns: minmax(48px, 64px) 1fr; }
}

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
