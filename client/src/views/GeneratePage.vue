<template>
 <div class="page-container generate-page">
 <!-- Tab 切换 -->
 <div class="tabs">
 <button class="tab" :class="{ active: activeTab === 'generate' }" :disabled="generationBusy || lnGenerating" @click="activeTab='generate'">{{ $t('generate.tabGen') }}</button>
 <button class="tab" :class="{ active: activeTab === 'lightnovel' }" :disabled="generationBusy || lnGenerating" @click="activeTab='lightnovel'">{{ $t('generate.tabLN') }}</button>
 </div>

 <!-- ==================== 生成 Tab ==================== -->
 <template v-if="activeTab === 'generate'">
 <div class="card">
 <div class="section-title">① {{ $t('generate.stepType') }}</div>
 <div class="gender-tabs">
 <button :class="{ active: gender === 'male' }" :disabled="generationBusy" @click="gender='male'">{{ $t('generate.maleFreq') }}</button>
 <button :class="{ active: gender === 'female' }" :disabled="generationBusy" @click="gender='female'">{{ $t('generate.femaleFreq') }}</button>
 </div>
 <div v-if="!skuCatalog" class="sku-loading">{{ $t('common.loading') }}</div>
 <template v-else>
 <div class="sku-layer">
 <div class="sku-layer-label">{{ $t('generate.skuCategory') }}</div>
 <div class="sku-chips">
 <button v-for="cat in skuCats" :key="cat.id" type="button" class="sku-chip" :class="{ selected: skuCategory === cat.id, locked: generationBusy }" @click="pickSkuCategory(cat)">
 <span class="sku-chip-icon">{{ cat.icon }}</span>{{ $tn(cat.name) }}
 </button>
 </div>
 </div>
 <div v-if="skuThemes.length" class="sku-layer">
 <div class="sku-layer-label">{{ $t('generate.skuTheme') }}</div>
 <div class="sku-chips">
 <button v-for="t in skuThemes" :key="t.id" type="button" class="sku-chip" :class="{ selected: skuTheme === t.id, locked: generationBusy }" @click="pickSkuTheme(t)">{{ $tn(t.name) }}</button>
 </div>
 </div>
 <div v-if="skuCatalog.tones && skuCatalog.tones.length" class="sku-layer">
 <div class="sku-layer-label">{{ $t('generate.skuTones') }} <span class="sku-multi-hint">{{ $t('generate.skuMultiHint') }}</span></div>
 <div class="sku-chips">
 <button v-for="t in skuCatalog.tones" :key="t.id" type="button" class="sku-chip tone" :class="{ selected: skuTones.includes(t.id), locked: generationBusy }" @click="!generationBusy && toggleSkuArr(skuTones, t.id)">{{ $tt(t.name) }}</button>
 </div>
 </div>
 <div v-if="skuCatalog.elements && skuCatalog.elements.length" class="sku-layer">
 <div class="sku-layer-label">{{ $t('generate.skuElements') }} <span class="sku-multi-hint">{{ $t('generate.skuMultiHint') }}</span></div>
 <div class="sku-chips sku-chips-scroll">
 <button v-for="e in skuCatalog.elements" :key="e.id" type="button" class="sku-chip" :class="{ selected: skuElements.includes(e.id), locked: generationBusy }" @click="!generationBusy && toggleSkuArr(skuElements, e.id)">{{ $tt(e.name) }}</button>
 </div>
 </div>
 <div v-if="skuCatalog.personas && skuCatalog.personas.length" class="sku-layer">
 <div class="sku-layer-label">{{ $t('generate.skuPersonas') }} <span class="sku-multi-hint">{{ $t('generate.skuMultiHint') }}</span></div>
 <div class="sku-chips sku-chips-scroll">
 <button v-for="p in skuCatalog.personas" :key="p.id" type="button" class="sku-chip" :class="{ selected: skuCharTags.includes(p.id), locked: generationBusy }" @click="!generationBusy && toggleSkuArr(skuCharTags, p.id)">{{ $tt(p.name) }}</button>
 </div>
 </div>
 <div class="sku-layer">
 <div class="sku-layer-label">{{ $t('generate.skuCp') }}</div>
 <div class="sku-chips">
 <button v-for="c in SKU_CP_OPTIONS" :key="c.id" type="button" class="sku-chip" :class="{ selected: skuCp === c.id, locked: generationBusy }" @click="!generationBusy && pickCp(c.id)">{{ $tt(c.name) }}</button>
 </div>
 </div>
 </template>
 <div v-if="selectedType" class="type-info">{{ $t('generate.selectedType', { name: $tn(selectedType) }) }}</div>
</div>

<div class="card">
<div class="section-title">{{ $t('generate.stepPersona') }}</div>
<div class="persona-desc">{{ $t('generate.personaDesc') }}</div>
<div class="persona-grid">
 <div
   v-for="p in personas"
   :key="p._id"
   class="persona-card"
   :class="{ selected: selectedPersonaId === p._id, disabled: personaApplicable(p) === false }"
   @click="!generationBusy && selectPersona(p)"
 >
   <div class="persona-card-head">
     <span class="persona-name">{{ $tp(p.name) }}</span>
     <span v-if="p.isSystem" class="persona-tag sys">{{ $t('generate.personaSys') }}</span>
     <span v-else-if="p.source === 'ai-generated'" class="persona-tag ai">AI</span>
     </div>
     <div class="persona-card-desc">{{ $tp(p.name, 'desc') || p.description || p.voice?.slice(0, 40) }}</div>
 </div>
 <div class="persona-card persona-add" :class="{ locked: generationBusy }" @click="!generationBusy && (showPersonaModal = true)">
   <span class="persona-add-icon">＋</span>
   <span class="persona-add-text">{{ $t('generate.personaManage') }}</span>
 </div>
</div>
<div v-if="selectedPersona" class="persona-selected-info">
 <span class="persona-selected-label">{{ $t('generate.personaCurrent') }}：</span>
 <strong>{{ $tp(selectedPersona.name) }}</strong>
 <span v-if="selectedPersona.overrideDeslop" class="persona-override-badge">{{ $t('generate.personaOverrideOn') }}</span>
</div>
</div>

<div class="card">
<div class="section-title">③ {{ $t('generate.stepChar') }}</div>
<input v-model="protagonistName" class="input" :disabled="generationBusy" :placeholder="$t('generate.placeholderName')" maxlength="20" />
</div>

<div class="card">
<div class="section-title">④ {{ $t('generate.stepWorld') }}</div>
 <textarea v-model="worldSetting" class="textarea" :disabled="generationBusy" :placeholder="$t('generate.placeholderWorld')" rows="4" @input="debounceMatchTemplates"></textarea>
 <!-- 类型模板匹配提示 -->
 <div v-if="matchedTemplates.length > 0" class="tmpl-match-card">
 <div class="tmpl-match-title">{{ $t('generate.tmplMatched') }}</div>
 <div class="tmpl-match-list">
 <div v-for="tmpl in matchedTemplates" :key="tmpl.name" class="tmpl-match-item">
 <span class="tmpl-name">{{ $tn(tmpl.name) || tmpl.name }}</span>
 <span class="tmpl-score" :class="scoreClass(tmpl.score)">{{ tmpl.score }}% {{ $t('generate.tmplMatch') }}</span>
 </div>
 </div>
 <div class="tmpl-match-hint">{{ $t('generate.tmplHint') }}</div>
 </div>
 </div>

 <div v-if="genMode === 'book'" class="card">
 <div class="section-title">{{ $t('generate.stepOutline') }}</div>
 <div v-if="generating && outlineStreamingText" class="outline-streaming">
 <div class="outline-loading">
 <span class="dot"></span><span class="dot"></span><span class="dot"></span>
 <span>AI {{ $t('generate.statusGenerating') }}</span>
 </div>
 <div class="outline-preview">{{ generatedOutline || outline }}</div>
 </div>
 <textarea v-model="outline" class="textarea" :disabled="generationBusy || blueprintGenerating" rows="4" :placeholder="$t('generate.placeholderOutline')"></textarea>
 </div>

 <div v-if="genMode === 'book'" class="card blueprint-setup-card">
  <div class="section-title"> {{ $t('generate.blueprintTitle') }}</div>
  <div class="blueprint-setup-desc">{{ $t('generate.blueprintDesc') }}</div>
  <div class="blueprint-setup-actions">
   <button class="btn btn-secondary btn-sm" :disabled="generating || blueprintGenerating || !outline.trim()" :aria-busy="blueprintGenerating" @click="generateInitialBlueprint">{{ blueprintGenerating ? ' ' + $t('generate.blueprintPlanning') : (initialBlueprint ? ' ' + $t('generate.blueprintRegenerate') : ' ' + $t('generate.blueprintGenerate')) }}</button>
   <button v-if="blueprintGenerating" class="btn btn-outline btn-sm" @click="cancelBlueprint">{{ $t('generate.stopGeneration') }}</button>
   <span v-if="initialBlueprintConfirmed" class="blueprint-confirmed"> {{ $t('generate.blueprintConfirmed') }}</span>
  </div>
  <div v-if="blueprintGenerating" class="thinking-hint">
   {{ blueprintThinkingChars > 0
      ? `${$t('generate.thinkingStatus', { seconds: blueprintThinkingElapsed })}${$t('generate.thinkingCharsSuffix', { n: blueprintThinkingChars })}`
      : $t('generate.thinkingStatus', { seconds: blueprintThinkingElapsed }) }}
   <span class="thinking-tip">{{ $t('generate.thinkingHint') }}</span>
  </div>
  <div v-if="blueprintGenerating && blueprintReasoningText && !initialBlueprintJson" ref="blueprintReasoningRef" class="stream-reasoning-box">{{ blueprintReasoningText }}</div>
  <textarea v-if="initialBlueprintJson" ref="blueprintJsonTextarea" v-model="initialBlueprintJson" :disabled="generating || blueprintGenerating" class="textarea blueprint-json-editor" rows="10" :placeholder="$t('generate.blueprintJsonPlaceholder')"></textarea>
  <div v-if="initialBlueprintJson && !initialBlueprintConfirmed" class="blueprint-setup-actions">
   <button class="btn btn-primary btn-sm" :disabled="generating || blueprintGenerating" @click="confirmInitialBlueprint">{{ $t('generate.blueprintConfirm') }}</button>
   <span class="blueprint-setup-hint">{{ $t('generate.blueprintEditHint') }}</span>
  </div>
  <div v-if="blueprintWarning" class="blueprint-setup-hint">{{ blueprintWarning }}</div>
  <div v-if="blueprintTokenUsage" class="blueprint-setup-hint">{{ tokenUsageText(blueprintTokenUsage) }}</div>
  <div v-if="blueprintSetupError" class="blueprint-setup-error">{{ blueprintSetupError }}</div>
 </div>

 <div class="card">
 <div class="section-title">⑤ {{ $t('generate.stepMode') }}</div>
 <div class="mode-radio-group">
 <label class="mode-radio" :class="{ active: genMode === 'book' }">
 <input type="radio" v-model="genMode" :disabled="generationBusy" value="book" />
 <!-- <span class="mode-icon"></span> -->
 <span class="mode-label">{{ $t('generate.modeBook') }}</span>
 </label>
 <label class="mode-radio" :class="{ active: genMode === 'chapter' }">
 <input type="radio" v-model="genMode" :disabled="generationBusy" value="chapter" />
 <!-- <span class="mode-icon"></span> -->
 <span class="mode-label">{{ $t('generate.modeChapter') }}</span>
 </label>
 </div>
 <div class="word-count-input" style="margin-top:12px;">
 <input v-model.number="targetWordCount" class="input" :disabled="generationBusy" type="number" :min="genMode==='chapter'?500:1000" :max="genMode==='chapter'?20000:10000000" step="500" />
 <span class="unit">{{ $t('generate.wordShort') }}</span>
 </div>
 <div class="word-count-presets">
 <span v-for="p in activePresets" :key="p.value" class="preset-btn" :class="{ active: targetWordCount === p.value, locked: generationBusy }" @click="!generationBusy && (targetWordCount = p.value)">{{ p.label }}</span>
 </div>
 <!-- 每章字数：整本模式可选。福尔摩斯式长篇悬疑需要 1 万+ 字的大章节奏。 -->
 <div v-if="genMode === 'book'" class="chapter-words-input">
 <label class="chapter-words-label">
 <span class="chapter-words-title">{{ $t('generate.chapterWordsTitle') }}</span>
 <input v-model.number="chapterWordTarget" class="input" :disabled="generationBusy" type="number" min="2000" max="20000" step="500" />
 <span class="unit">{{ $t('generate.unitPerChapter') }}</span>
 </label>
 <div class="word-count-presets">
 <span v-for="p in chapterWordPresets" :key="p.value" class="preset-btn" :class="{ active: chapterWordTarget === p.value, locked: generationBusy }" @click="!generationBusy && (chapterWordTarget = p.value)">{{ p.label }}</span>
 </div>
 <div class="chapter-words-hint">{{ $t('generate.estimatedChapters', { n: estimatedChapters }) }}{{ chapterWordTarget >= 6000 ? $t('generate.bigChapterHint') : '' }}</div>
 </div>
 <label class="expert-mode-toggle">
 <input type="checkbox" v-model="expertMode" :disabled="generationBusy" />
 <span><strong>{{ $t('generate.expertMode') }}</strong><small>{{ $t('generate.expertModeDesc') }}</small></span>
 </label>
 <label class="expert-mode-toggle">
 <input type="checkbox" v-model="enableResearch" :disabled="generationBusy" />
 <span><strong>{{ $t('generate.researchToggle') }}</strong><small>{{ $t('generate.researchToggleDesc') }}</small></span>
 </label>
 <div v-if="enableResearch" class="research-links-box">
 <div class="label-sm">{{ $t('generate.researchLinksLabel') }}</div>
 <textarea v-model="researchLinksText" class="textarea" :disabled="generationBusy" rows="3" :placeholder="$t('generate.researchLinksPlaceholder')"></textarea>
 </div>
 </div>

 <button class="btn btn-primary btn-block btn-lg" :disabled="generationBusy || blueprintGenerating || !selectedType" :aria-busy="generationBusy" @click="startGen">
 {{ generationBusy ? $t('generate.btnGenerating') : $t('generate.btnGenerate') }}
 </button>

 <div v-if="generating && outlineStreamingText" class="card outline-stream-card">
 <div class="section-title">{{ $t('generate.statusGenerating') }}</div>
 <div class="outline-stream-text">{{ outlineStreamingText }}</div>
 </div>

 <div v-if="genStatus" class="gen-status" :class="{ ok: genOk }">{{ genStatus }}</div>
 <div v-if="generationTokenUsage" class="gen-token-usage">
 {{ $t('generate.usageTotalLabel') }}{{ $t('generate.usageInput') }} {{ formatTokenCount(generationTokenUsage.inputTokens) }} / {{ $t('generate.usageOutput') }} {{ formatTokenCount(generationTokenUsage.outputTokens) }}<span v-if="generationTokenUsage.cacheSavedTokens > 0">（{{ $t('generate.usageCache') }} {{ formatTokenCount(generationTokenUsage.cacheSavedTokens) }}）</span>
 </div>

 <!-- 生成结果弹框 -->
 <Teleport to="body">
 <div v-if="showGenModal" class="gen-modal-overlay" @click.self="showGenModal = false">
 <div class="gen-modal">
 <div class="gen-modal-header">
 <span class="gen-modal-title">{{ genModalTitle }}</span>
 <button class="gen-modal-close" @click="showGenModal = false">&times;</button>
 </div>
 <div class="gen-modal-body">
 <!-- 联网取材状态提示 -->
 <div v-if="researchHint" class="research-hint">{{ researchHint }}</div>
 <!-- 原始生成文本 -->
 <div class="gen-text-section" :class="{ grayed: deslopRunning || deslopDone || editorialRunning || editorialDone }">
 <div class="gen-text-label">{{ genMode === 'chapter' ? $t('generate.modeChapter') : $t('generate.modeBook') }}</div>
 <div class="gen-text-content" ref="streamRef">{{ streamingText }}</div>
 </div>
 <!-- 去AI化结果 -->
 <div v-if="deslopText" class="gen-text-section deslop-section">
 <div class="gen-text-label">{{ $t('generate.deslopResult') }}</div>
 <div class="gen-text-content deslop-content" ref="deslopStreamRef">{{ deslopText }}</div>
 </div>
 <!-- 编辑引擎结果 -->
 <div v-if="editorialText" class="gen-text-section editorial-section">
 <div class="gen-text-label">{{ $t('generate.editorialResult') }}</div>
 <div class="gen-text-content editorial-content" ref="editorialStreamRef">{{ editorialText }}</div>
 </div>
 <!-- 编辑引擎分析报告 -->
 <div v-if="editorialDone && editorialAnalysis" class="gen-editorial-analysis">
 <div class="gen-text-label">{{ $t('generate.editorialAnalysis') }}</div>
 <div class="analysis-bars">
 <div v-for="(val, key) in editorialAnalysis" :key="key" class="analysis-bar-item">
 <span class="analysis-label">{{ analysisLabel(key) }}</span>
 <div class="analysis-bar-track">
 <div class="analysis-bar-fill" :style="{ width: val + '%' }" :class="val > 50 ? 'high' : 'low'"></div>
 </div>
 <span class="analysis-value">{{ val }}</span>
 </div>
 </div>
 </div>
 <!-- Diff 对比 -->
 <div v-if="deslopDone && diffHtml" class="gen-diff-section">
 <div class="gen-text-label">{{ $t('generate.diffView') }}</div>
 <div class="gen-diff-content" v-html="diffHtml"></div>
 </div>
 </div>
 <div class="gen-modal-footer">
 <button v-if="genOk && !deslopRunning && !deslopDone && !editorialRunning && !editorialDone" class="btn btn-primary" @click="startDeslop">
 {{ $t('generate.btnDeslop') }}
 </button>
 <button v-if="genOk && !deslopRunning && !deslopDone && !editorialRunning && !editorialDone" class="btn btn-editorial" @click="startEditorial">
 {{ $t('generate.btnEditorial') }}
 </button>
 <span v-if="deslopRunning" class="deslop-status">{{ deslopStatus }}</span>
 <span v-if="editorialRunning || editorialDone" class="editorial-stage-list">
 <span v-for="s in editorialStages" :key="s.id" class="editorial-stage-badge" :class="{ active: s.active, done: s.done, failed: s.error }" :title="s.errorMsg || ''">
 {{ s.name }}{{ s.error ? '!' : '' }}
 </span>
 </span>
 <div v-if="editorialStageErrors.length > 0" class="editorial-errors">
 <div v-for="e in editorialStageErrors" :key="e.id" class="editorial-error-item">
 <span class="error-stage-name">{{ e.name }}：</span>
 <span class="error-stage-msg">{{ e.errorMsg }}</span>
 </div>
 </div>
 <button v-if="deslopDone" class="btn btn-secondary" @click="resetDeslop">{{ $t('generate.btnReset') }}</button>
 <button v-if="deslopDone && genMode === 'chapter'" class="btn btn-primary" :disabled="generatedApplyBusy" @click="applyGeneratedResult('deslop')">
 {{ generatedApplyBusy ? $t('generate.applying') : $t('generate.applyDeslop') }}
 </button>
 <button v-if="editorialDone" class="btn btn-secondary" @click="resetEditorial">{{ $t('generate.btnEditorialReset') }}</button>
 <button v-if="editorialDone && genMode === 'chapter'" class="btn btn-primary" :disabled="generatedApplyBusy" @click="applyGeneratedResult('editorial')">
 {{ generatedApplyBusy ? $t('generate.applying') : $t('generate.applyEditorial') }}
 </button>
 <span v-if="(deslopDone || editorialDone) && genMode === 'book'" class="generated-apply-hint">{{ $t('generate.applyBookHint') }}</span>
 <span v-if="generatedApplyMessage" class="generated-apply-message">{{ generatedApplyMessage }}</span>
 </div>
 </div>
 </div>
 </Teleport>
 </template>

 <!-- ==================== 轻小说 Tab ==================== -->
 <template v-if="activeTab === 'lightnovel'">
 <div class="card">
 <div class="section-title">① {{ $t('generate.lnStepType') }}</div>
 <div class="type-grid ln-grid">
 <div v-for="t in lnTypes" :key="t.id" class="type-card" :class="{ selected: lnSelectedType === t.id }" @click="lnSelectedType = t.id">
 <span class="type-icon">{{ t.icon }}</span>
 <span class="type-name">{{ $tn(t.name) }}</span>
 </div>
 </div>
 <div v-if="lnSelectedType" class="type-info">{{ $t('generate.selectedType', { name: $tn(lnTypes.find(t=>t.id===lnSelectedType)?.name) }) }}</div>
 </div>

 <div class="card">
 <div class="section-title">② {{ $t('generate.lnStepChar') }}</div>
 <input v-model="lnCharName" class="input" :placeholder="$t('generate.lnPlaceholderName')" maxlength="20" />
 <div class="ln-trait-section" style="margin-top:10px;">
 <div class="label-sm">{{ $t('generate.lnCharTrait') }}</div>
 <div class="ln-traits">
 <span v-for="trait in lnTraits" :key="trait" class="preset-btn" :class="{ active: lnCharTrait === trait }" @click="lnCharTrait = (lnCharTrait === trait ? '' : trait)">{{ $tt(trait) }}</span>
 </div>
 </div>
 </div>

 <div class="card">
 <div class="section-title">③ {{ $t('generate.lnStepWorld') }}</div>
 <textarea v-model="lnWorldSetting" class="textarea" rows="4" :placeholder="$t('generate.lnPlaceholderWorld')"></textarea>
 </div>

 <div class="card">
 <div class="section-title">④ {{ $t('generate.lnStepMode') }}</div>
 <div class="mode-radio-group">
 <label class="mode-radio" :class="{ active: lnGenMode === 'book' }">
 <input type="radio" v-model="lnGenMode" value="book" />
 <span>{{ $t('generate.modeBook') }}</span>
 </label>
 <label class="mode-radio" :class="{ active: lnGenMode === 'chapter' }">
 <input type="radio" v-model="lnGenMode" value="chapter" />
 <span>{{ $t('generate.modeChapter') }}</span>
 </label>
 </div>
 <div class="word-count-input" style="margin-top:12px;">
 <input v-model.number="lnTargetWordCount" class="input" type="number" :min="lnGenMode==='chapter'?500:1000" :max="lnGenMode==='chapter'?20000:10000000" step="500" />
 <span class="unit">{{ $t('generate.wordShort') }}</span>
 </div>
 <div class="word-count-presets">
 <span v-for="p in lnActivePresets" :key="p.value" class="preset-btn" :class="{ active: lnTargetWordCount === p.value }" @click="lnTargetWordCount = p.value">{{ p.label }}</span>
 </div>
 <label class="expert-mode-toggle">
 <input type="checkbox" v-model="lnExpertMode" />
 <span><strong>{{ $t('generate.expertMode') }}</strong><small>{{ $t('generate.expertModeDesc') }}</small></span>
 </label>
 </div>

 <button class="btn btn-primary btn-block btn-lg" :disabled="lnGenerating || !lnSelectedType" @click="startLNGen">
 {{ lnGenerating ? $t('generate.btnGenerating') : $t('generate.lnBtnGenerate') }}
 </button>

 <div v-if="lnStatus" class="gen-status" :class="{ ok: lnOk }">{{ lnStatus }}</div>

 <div v-if="lnStreamingText" class="card stream-card">
 <div class="section-title"> {{ $t('generate.lnBtnGenerate') }}</div>
 <div class="stream-content" ref="lnStreamRef">{{ lnStreamingText }}</div>
 </div>
 </template>

 <!-- ==================== 写作人格管理弹窗 ==================== -->
<Teleport to="body">
<div v-if="showPersonaModal" class="modal-overlay" @click.self="showPersonaModal = false">
<div class="persona-modal-card">
 <div class="persona-modal-head">
   <h3 class="persona-modal-title">{{ $t('generate.personaManageTitle') }}</h3>
   <button class="gen-modal-close" @click="showPersonaModal = false">&times;</button>
 </div>

 <div class="persona-modal-body">
   <!-- 工具栏 -->
   <div class="persona-toolbar">
     <button class="btn btn-sm btn-primary" @click="openEditPersona(null)">{{ $t('generate.personaNew') }}</button>
     <button class="btn btn-sm btn-secondary" @click="aiGenInput.novelType ? null : (aiGenInput.novelType = selectedType ? $tn(selectedType) : '') ; personaStatus=''; ">{{ $t('generate.personaAIGen') }}</button>
     <span v-if="personaBusy" class="persona-busy"><span class="spinner" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></span> {{ personaStatus || $t('generate.processing') }}</span>
   </div>

   <!-- AI 生成输入区 -->
   <div v-if="aiGenInput.novelType !== '' || personaStatus" class="persona-ai-gen">
     <div class="label-sm">{{ $t('generate.personaAIGenTitle') }}</div>
     <input v-model="aiGenInput.novelType" class="input" :placeholder="$t('generate.personaAIGenTypePlaceholder')" />
     <textarea v-model="aiGenInput.hint" class="textarea" rows="2" :placeholder="$t('generate.personaAIGenHintPlaceholder')"></textarea>
     <div class="persona-ai-actions">
       <button class="btn btn-sm btn-primary" :disabled="personaBusy" @click="aiGeneratePersona">{{ $t('generate.personaAIGen') }}</button>
       <button class="btn btn-sm btn-secondary" @click="aiGenInput = { novelType: '', hint: '' }; personaStatus=''">{{ $t('common.cancel') }}</button>
     </div>
   </div>

   <!-- 列表 -->
   <div class="persona-list">
     <div v-for="p in personas" :key="p._id" class="persona-list-item" :class="{ active: selectedPersonaId === p._id }" @click="selectPersona(p)">
       <div class="persona-list-head">
         <span class="persona-list-name">{{ $tp(p.name) }}</span>
         <span v-if="p.isSystem" class="persona-tag sys">{{ $t('generate.personaSys') }}</span>
         <span v-else-if="p.source === 'ai-generated'" class="persona-tag ai">AI</span>
       </div>
       <div class="persona-list-desc">{{ $tp(p.name, 'desc') || p.description || p.voice?.slice(0, 60) }}</div>
       <div class="persona-list-actions" @click.stop>
         <button class="btn btn-xs btn-secondary" @click="openEditPersona(p)">{{ $t('common.edit') }}</button>
         <button v-if="!p.isSystem" class="btn btn-xs btn-secondary" @click="clonePersona(p)">{{ $t('generate.personaClone') }}</button>
         <button v-if="!p.isSystem" class="btn btn-xs btn-danger" @click="deletePersona(p)">{{ $t('common.delete') }}</button>
       </div>
     </div>
   </div>

   <!-- 编辑表单 -->
   <div v-if="editingPersona" class="persona-edit-form">
     <div class="label-sm">{{ editingPersona._id ? $t('common.edit') : $t('generate.personaNew') }}：{{ editingPersona.name || $t('generate.personaUntitled') }}</div>
     <input v-model="personaForm.name" class="input" :placeholder="$t('generate.personaFormName')" maxlength="40" :disabled="editingPersona.isSystem" />
     <input v-model="personaForm.description" class="input" :placeholder="$t('generate.personaFormDesc')" maxlength="200" />
     <div class="label-sm">{{ $t('generate.personaFormVoice') }}</div>
     <textarea v-model="personaForm.voice" class="textarea" rows="3" :disabled="editingPersona.isSystem" :placeholder="$t('generate.personaFormVoicePh')"></textarea>
     <div class="label-sm">{{ $t('generate.personaFormTone') }}</div>
     <textarea v-model="personaForm.tone" class="textarea" rows="3" :disabled="editingPersona.isSystem" :placeholder="$t('generate.personaFormTonePh')"></textarea>
     <div class="label-sm">{{ $t('generate.personaFormRules') }}</div>
     <textarea v-model="personaForm.rules" class="textarea" rows="6" :disabled="editingPersona.isSystem" :placeholder="$t('generate.personaFormRulesPh')"></textarea>
     <div class="label-sm">{{ $t('generate.personaFormVocab') }}</div>
     <textarea v-model="personaForm.vocab" class="textarea" rows="3" :disabled="editingPersona.isSystem" :placeholder="$t('generate.personaFormVocabPh')"></textarea>
     <label class="checkbox-row" style="margin-top:10px;">
       <input type="checkbox" v-model="axesEnabled" :disabled="editingPersona.isSystem" />
       <span>{{ $t('generate.personaAxesTitle') }}</span>
     </label>
     <div v-if="axesEnabled" class="axes-grid">
       <div class="axes-hint">{{ $t('generate.personaAxesHint') }}</div>
       <div v-for="ax in AXIS_DEFS" :key="ax.key" class="axis-row">
         <div class="axis-name">{{ $t('generate.axis.' + ax.key + '.name') }}</div>
         <div class="axis-scale">
           <span class="axis-end low">{{ $t('generate.axis.' + ax.key + '.low') }}</span>
           <input type="range" min="1" max="5" step="1" v-model.number="personaForm.axes[ax.key]" :disabled="editingPersona.isSystem" />
           <span class="axis-end high">{{ $t('generate.axis.' + ax.key + '.high') }}</span>
         </div>
         <div class="axis-val">{{ personaForm.axes[ax.key] }}</div>
       </div>
     </div>
     <label class="checkbox-row" style="margin-top:8px;">
       <input type="checkbox" v-model="personaForm.overrideDeslop" :disabled="editingPersona.isSystem" />
       <span>{{ $t('generate.personaOverrideDeslop') }}</span>
     </label>
     <div class="persona-edit-actions">
       <button class="btn btn-sm btn-primary" :disabled="personaBusy" @click="savePersona">{{ $t('common.save') }}</button>
       <button class="btn btn-sm btn-secondary" @click="openEditPersona(null)">{{ $t('common.cancel') }}</button>
     </div>
   </div>
 </div>
</div>
</div>
</Teleport>

<!-- ==================== 大纲预览/编辑弹窗 ==================== -->
 <Teleport to="body">
 <div v-if="outlineModal" class="modal-overlay" @click.self="outlineReject()">
 <div class="outline-modal-card">
 <h3 class="outline-modal-title">{{ $t('generate.outlinePreview') }}</h3>
 <p class="outline-modal-desc">{{ outlineStreaming ? $t('generate.outlineStreamingDesc') : $t('generate.outlineDesc') }}</p>
 <div v-if="outlineError" class="blueprint-setup-error">{{ outlineError }}</div>
 <div v-if="outlineWarn" class="blueprint-setup-hint">{{ outlineWarn }}</div>
 <div v-if="outlineStreaming && outlineReasoningText && !outlineModalText" ref="outlineReasoningRef" class="stream-reasoning-box">{{ outlineReasoningText }}</div>
 <div v-if="outlineStreaming && !outlineModalText" class="thinking-hint">
  {{ outlineThinkingChars > 0
     ? `${$t('generate.thinkingStatus', { seconds: outlineThinkingElapsed })}${$t('generate.thinkingCharsSuffix', { n: outlineThinkingChars })}`
     : $t('generate.thinkingStatus', { seconds: outlineThinkingElapsed }) }}
  <span class="thinking-tip">{{ $t('generate.thinkingHint') }}</span>
 </div>
 <textarea ref="outlineModalTextarea" v-model="outlineModalText" class="outline-modal-textarea" rows="12" @input="onOutlineInput"></textarea>
 <div v-if="outlineTokenUsage" class="outline-modal-token">{{ tokenUsageText(outlineTokenUsage) }}</div>
 <div class="outline-modal-actions">
 <button class="btn btn-secondary" @click="outlineReject()">{{ $t('common.cancel') }}</button>
 <button class="btn btn-primary" :disabled="outlineStreaming" @click="outlineConfirm()">{{ outlineStreaming ? $t('generate.outlineGenerating') : $t('generate.outlineConfirm') }}</button>
 </div>
 </div>
 </div>
 </Teleport>
 </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useNovelStore } from '../stores/novel'
import { useAuthStore } from '../stores/auth'
import { usePersonaStore } from '../stores/persona'
import { notifyModelError } from '../utils/notify'
import { useSSE } from '../composables/useSSE'
import { useI18n } from '../composables/useI18n'
import api from '../api'

const router = useRouter()
const novelStore = useNovelStore()
const authStore = useAuthStore()
const personaStore = usePersonaStore()
const { $t, $tn, $tt } = useI18n()

const streamRef = ref(null)

// ---- Tab ----
const activeTab = ref('generate')

// ---- 生成 ----
const gender = ref('male')
const selectedType = ref('')

const fullTypes = ref({ male: [], female: [] })
const currentCats = computed(() => fullTypes.value[gender.value] || [])

// ---- 番茄式「多选类型 SKU」（频道→大类→题材 单选逐级 + 情节元素/人设/风格基调 多选 + 关系向）----
const skuCatalog = ref(null)
const skuCategory = ref('')   // 大类 id
const skuTheme = ref('')      // 题材 id
const skuElements = ref([])   // 情节元素 id[]
const skuCharTags = ref([])   // 人设标签 id[]
const skuTones = ref([])      // 风格基调 id[]
const skuCp = ref('')         // 关系向 id
const SKU_CP_OPTIONS = [
  { id: 'none', name: '无CP' },
  { id: 'single', name: '单女主/单男主' },
  { id: 'multi', name: '多女主/后宫' },
  { id: 'danmei', name: '双男主' },
  { id: 'yuri', name: '双女主' },
]
const skuCats = computed(() => skuCatalog.value?.tree?.[gender.value] || [])
const skuCurCat = computed(() => skuCats.value.find(c => c.id === skuCategory.value) || null)
const skuThemes = computed(() => skuCurCat.value?.themes || [])

function pickSkuCategory(cat) {
  if (generationBusy.value) return
  skuCategory.value = cat.id
  skuTheme.value = ''
  syncSelectedTypeName()
}
function pickSkuTheme(t) {
  if (generationBusy.value) return
  skuTheme.value = skuTheme.value === t.id ? '' : t.id
  syncSelectedTypeName()
}
// 注意：模板里传入的是已被 Vue 自动解包的数组本身（skuTones 等在模板中即 .value），
// 故这里直接对数组增删，不能再写 arr.value（否则取到 undefined 会报错、导致点不动）。
function toggleSkuArr(arr, id) {
  const i = arr.indexOf(id)
  if (i >= 0) arr.splice(i, 1); else arr.push(id)
}
// 关系向（单选，再点取消）：用显式函数访问 ref，避免模板内联赋值的解包歧义。
function pickCp(id) {
  skuCp.value = skuCp.value === id ? '' : id
}
function syncSelectedTypeName() {
  const cat = skuCurCat.value
  const theme = skuThemes.value.find(t => t.id === skuTheme.value)
  selectedType.value = theme ? `${cat?.name || ''}·${theme.name}` : (cat?.name || '')
}
// 组装 typeSku：未选大类时不下发（后端回落 novelTypeId 兼容旧逻辑）。
function buildTypeSku() {
  if (!skuCategory.value) return undefined
  return {
    channel: gender.value,
    category: skuCategory.value,
    theme: skuTheme.value || undefined,
    elements: skuElements.value.slice(),
    personas: skuCharTags.value.slice(),
    tones: skuTones.value.slice(),
    cp: skuCp.value || undefined,
  }
}
watch(gender, () => {
  skuCategory.value = ''; skuTheme.value = ''
  skuElements.value = []; skuCharTags.value = []; skuTones.value = []; skuCp.value = ''
  selectedType.value = ''
})

const protagonistName = ref('')
const worldSetting = ref('')
const outline = ref('')
const genMode = ref('book')
const targetWordCount = ref(50000)
// 每章字数（整本模式）：影响大纲规模、章节计划与每章输出预算。
const chapterWordTarget = ref(3000)
const expertMode = ref(false)
// 联网取材：默认开启；实际是否联网取决于服务端是否配了搜索密钥（用户链接始终抓取）。
const enableResearch = ref(true)
const researchLinksText = ref('')
const researchHint = ref('')
const initialBlueprint = ref(null)
const initialBlueprintJson = ref('')
const initialBlueprintConfirmed = ref(false)
const blueprintGenerating = ref(false)
const blueprintSetupError = ref('')
// 大纲弹窗内的常驻错误：失败原因必须留在界面上，否则错误一闪而过，
// 用户看到的就是"生成莫名其妙停了、也不知道报没报错"。
const outlineError = ref('')
// 大纲弹窗内的非致命警告（如"输出达长度上限、中后段可能被截断"），服务端 status 事件透传。
const outlineWarn = ref('')
const blueprintWarning = ref('')

// ---- 写作人格 persona ----
const personas = ref([])
const selectedPersonaId = ref('')
const selectedPersona = computed(() => personas.value.find(p => p._id === selectedPersonaId.value) || null)
const showPersonaModal = ref(false)
// persona 编辑表单
const editingPersona = ref(null)
// 风格光谱六轴（与后端 STYLE_AXES 同 key）；axesEnabled=false 时不随人格下发 axes（从题材/大类继承）。
const AXIS_DEFS = [
  { key: 'temperature' }, { key: 'diction' }, { key: 'narrator' },
  { key: 'pacing' }, { key: 'humor' }, { key: 'emotion' },
]
function blankAxes() { return { temperature: 3, diction: 3, narrator: 3, pacing: 3, humor: 3, emotion: 3 } }
const axesEnabled = ref(false)
const personaForm = ref({ name: '', description: '', voice: '', tone: '', rules: '', vocab: '', overrideDeslop: false, applicableTypes: [], axes: blankAxes() })
// AI 生成 / 从参考生成 的输入
const aiGenInput = ref({ novelType: '', hint: '' })
const personaBusy = ref(false)
const personaStatus = ref('')

// 判断 persona 是否对当前类型适用（仅用于视觉提示，不强制禁选）
function personaApplicable(p) {
 if (!p?.applicableTypes || p.applicableTypes.length === 0) return null // 通用
 const t = selectedType.value
 const g = gender.value
 // 简单匹配：applicableTypes 里的值若为 male/female/lightnovel 则按频段，否则按类型名
 return p.applicableTypes.some(at => at === g || at === t || (at === 'lightnovel' && t?.startsWith('lightnovel_')))
}

function selectPersona(p) {
 if (selectedPersonaId.value === p._id) {
   // 再次点击取消选择
   selectedPersonaId.value = ''
 } else {
   selectedPersonaId.value = p._id
 }
}

function openEditPersona(p) {
 editingPersona.value = p ? { ...p } : null
 const axes = p && p.axes ? { ...blankAxes(), ...p.axes } : blankAxes()
 axesEnabled.value = !!(p && p.axes)
 personaForm.value = p
   ? { name: p.name, description: p.description, voice: p.voice, tone: p.tone, rules: p.rules, vocab: p.vocab, overrideDeslop: p.overrideDeslop, applicableTypes: p.applicableTypes || [], axes }
   : { name: '', description: '', voice: '', tone: '', rules: '', vocab: '', overrideDeslop: false, applicableTypes: [], axes }
}

async function savePersona() {
 const f = { ...personaForm.value }
 if (!f.name.trim()) return alert($t('generate.personaErrName'))
 // 未开启风格轴则不下发 axes（null），让人格从题材/大类默认继承，避免强制中值抹平类型风格。
 f.axes = axesEnabled.value ? { ...f.axes } : null
 personaBusy.value = true
 try {
   if (editingPersona.value?._id) {
     await personaStore.update(editingPersona.value._id, f)
   } else {
     await personaStore.create(f)
   }
   personas.value = personaStore.personas
   openEditPersona(null)
 } catch (e) {
   alert(e.response?.data?.message || e.message || $t('generate.personaErrSave'))
 } finally {
   personaBusy.value = false
 }
}

async function deletePersona(p) {
 if (!confirm($t('generate.confirmDeletePersona', { name: p.name }))) return
 try {
   await personaStore.remove(p._id)
   personas.value = personaStore.personas
   if (selectedPersonaId.value === p._id) selectedPersonaId.value = ''
 } catch (e) {
   alert(e.response?.data?.message || e.message || $t('generate.personaErrDelete'))
 }
}

async function clonePersona(p) {
 try {
   await personaStore.clone(p._id)
   personas.value = personaStore.personas
 } catch (e) {
   alert(e.response?.data?.message || e.message || $t('generate.personaErrClone'))
 }
}

async function aiGeneratePersona() {
 if (!aiGenInput.value.novelType.trim()) return alert($t('generate.personaErrNeedType'))
 personaBusy.value = true
 personaStatus.value = $t('generate.personaAIGenerating')
 try {
   await personaStore.aiGenerate(aiGenInput.value.novelType, aiGenInput.value.hint)
   personas.value = personaStore.personas
   aiGenInput.value = { novelType: '', hint: '' }
   personaStatus.value = ''
 } catch (e) {
   personaStatus.value = ''
   alert(e.response?.data?.message || e.message || $t('generate.personaErrAIGen'))
 } finally {
   personaBusy.value = false
 }
}

const generating = ref(false)
const preparingGeneration = ref(false)
const generationBusy = computed(() => generating.value || preparingGeneration.value)
const genStatus = ref('')
const genOk = ref(false)
const streamingText = ref('')
const rawStreamingText = ref('')
const generatedOutline = ref('')
const outlineStreamingText = ref('')

// ---- 生成弹框 ----
const showGenModal = ref(false)
const genModalTitle = ref('')
const generatedNovelId = ref('')
const generatedChapterNumber = ref(0)
const generatedApplyBusy = ref(false)
const generatedApplyMessage = ref('')

// ---- 去AI化 ----
const deslopRunning = ref(false)
const deslopDone = ref(false)
const deslopText = ref('')
const deslopStatus = ref('')
const deslopStreamRef = ref(null)
const diffHtml = ref('')

// ---- 编辑引擎 ----
const editorialRunning = ref(false)
const editorialDone = ref(false)
const editorialText = ref('')
const editorialAnalysis = ref(null)
const editorialStreamRef = ref(null)
const editorialStages = ref([
  { id: 'persona', name: $t('generate.stagePersona'), active: false, done: false, error: false, errorMsg: '' },
  { id: 'structural', name: $t('generate.stageStructural'), active: false, done: false, error: false, errorMsg: '' },
  { id: 'polish', name: $t('generate.stageStyle'), active: false, done: false, error: false, errorMsg: '' },
  { id: 'deAI', name: $t('generate.stageDeAI'), active: false, done: false, error: false, errorMsg: '' },
])
const editorialStageErrors = computed(() => editorialStages.value.filter(s => s.error))

const analysisLabelMap = {
  explain: $t('generate.traitExplain'), sentence: $t('generate.traitSentence'), repeat: $t('generate.traitRepeat'), flow: $t('generate.traitFlow'),
  dialogue: $t('generate.traitDialogue'), environment: $t('generate.traitEnvironment'), transition: $t('generate.traitTransition'),
  summary: $t('generate.traitSummary'), worldbuilding: $t('generate.traitWorldbuilding'), psychology: $t('generate.traitPsychology'),
}
function analysisLabel(key) { return analysisLabelMap[key] || key }

// 类型模板匹配
const matchedTemplates = ref([])
const tmplMatching = ref(false)
let tmplTimer = null

async function matchTemplates() {
 const ws = worldSetting.value?.trim()
 const st = selectedType.value
 if (!ws || ws.length < 5) { matchedTemplates.value = []; return }
 tmplMatching.value = true
 try {
 const res = await api.post('/novel/match-templates', { worldSetting: ws, novelTypeId: st })
 matchedTemplates.value = res.data.matched || []
 } catch {
 matchedTemplates.value = []
 }
 tmplMatching.value = false
}
function debounceMatchTemplates() {
 clearTimeout(tmplTimer)
 tmplTimer = setTimeout(matchTemplates, 800)
}
function scoreClass(s) { if (!s) return ''; if (s >= 60) return 'high'; if (s >= 35) return 'mid'; return 'low' }

// 监听类型切换时重新匹配
watch(selectedType, () => { matchTemplates() })

// 大纲预览弹窗
const outlineModal = ref(false)
const outlineModalText = ref('')
let outlineConfirmCallback = null
let outlineRejectCallback = null

// 大纲/蓝图流式生成状态（SSE）：弹窗打开即开始实时展示，自动追踪最新内容
const outlineStreaming = ref(false)
const outlineUserEdited = ref(false)
const outlineReasoningText = ref('')
const blueprintReasoningText = ref('')
// 深度思考模型的首字延迟可能很长：单独记录"已思考字数 + 已用秒数"，
// 让等待过程始终有可见进度，而不是一个静止的"生成中…"。
const outlineThinkingChars = ref(0)
const outlineThinkingElapsed = ref(0)
const blueprintThinkingChars = ref(0)
const blueprintThinkingElapsed = ref(0)
const genThinkingChars = ref(0)
const genThinkingElapsed = ref(0)
let thinkingTicker = null

// 本地秒表：服务端每 2 秒上报一次真实耗时，本地每秒自增保证画面持续变化
// （服务商长时间不下发任何分片时，用户也不会以为卡死）。
function startThinkingTicker() {
  stopThinkingTicker()
  thinkingTicker = setInterval(() => {
    let active = false
    if (outlineStreaming.value) { outlineThinkingElapsed.value += 1; active = true }
    if (blueprintGenerating.value) { blueprintThinkingElapsed.value += 1; active = true }
    if (generating.value) { genThinkingElapsed.value += 1; active = true }
    // 所有任务结束后自动停表，避免定时器空转（无需在每个结束分支手动清理）
    if (!active) stopThinkingTicker()
  }, 1000)
}
function stopThinkingTicker() {
  if (thinkingTicker) { clearInterval(thinkingTicker); thinkingTicker = null }
}
const outlineModalTextarea = ref(null)
const blueprintJsonTextarea = ref(null)
const outlineReasoningRef = ref(null)
const blueprintReasoningRef = ref(null)
let outlineXhr = null
let blueprintXhr = null

function onOutlineInput() { outlineUserEdited.value = true }
// 思考内容只保留尾部 4000 字，避免长时间思考导致 DOM 过大
function appendReasoning(target, text) { target.value = (target.value + text).slice(-4000) }
function scrollOutlineToBottom() {
 nextTick(() => { const el = outlineModalTextarea.value; if (el) el.scrollTop = el.scrollHeight })
}
function scrollBlueprintToBottom() {
 nextTick(() => { const el = blueprintJsonTextarea.value; if (el) el.scrollTop = el.scrollHeight })
}
function scrollReasoningBox(elRef) {
 nextTick(() => { const el = elRef.value; if (el) el.scrollTop = el.scrollHeight })
}

// 大纲/蓝图生成的单次 token 消耗（接口返回，弹窗与蓝图卡片展示）
const outlineTokenUsage = ref(null)
const blueprintTokenUsage = ref(null)
// 生成过程中的累计 token 消耗（SSE token_usage 事件）
const generationTokenUsage = ref(null)
function formatTokenCount(value) {
 const number = Number(value) || 0
 if (number >= 1000000) return `${(number / 1000000).toFixed(2)}M`
 if (number >= 10000) return $t('generate.wanCount', { n: (number / 10000).toFixed(1) })
 if (number >= 1000) return `${(number / 1000).toFixed(1)}k`
 return String(number)
}
function tokenUsageText(usage) {
 if (!usage) return ''
 return $t('generate.usageLine', { input: formatTokenCount(usage.inputTokens), output: formatTokenCount(usage.outputTokens) })
}

// 大纲生成改为 SSE 流式：弹窗立即打开，实时展示思考/正文内容并自动滚动到最新位置，
// 不再等待整个响应（思考模型耗时可达数十分钟，XHR 无超时限制）。
function showOutlineModal(selectedTypeId, charName, worldSetting, wordCount, perChapterWords) {
 return new Promise((resolve) => {
 outlineModalText.value = ''
 outlineTokenUsage.value = null
 outlineReasoningText.value = ''
 outlineError.value = ''
 outlineWarn.value = ''
 outlineUserEdited.value = false
 outlineStreaming.value = true
 outlineThinkingChars.value = 0
 outlineThinkingElapsed.value = 0
 startThinkingTicker()
 genStatus.value = $t('generate.outlineGenerating')
 outlineModal.value = true

 const payload = {
 novelTypeId: selectedTypeId,
 typeSku: buildTypeSku(),
 protagonistName: charName,
 worldSetting: worldSetting,
 targetWordCount: wordCount,
 chapterWordTarget: perChapterWords || undefined,
 personaId: selectedPersonaId.value || undefined,
 }

 const token = localStorage.getItem('token')
 const sse = useSSE()
 outlineXhr = sse
 sse.openSSE('/api/novel/generate-outline', payload, {
  token,
  onThinking: (event) => {
   outlineThinkingChars.value = event.length || 0
   outlineThinkingElapsed.value = Math.round((event.elapsedMs || 0) / 1000)
  },
  onReasoning: (content) => {
   appendReasoning(outlineReasoningText, content)
   scrollReasoningBox(outlineReasoningRef)
  },
  onContent: (content) => {
   outlineModalText.value += content
   scrollOutlineToBottom()
  },
  onCompleted: (event) => {
   // 用户未手动编辑时用最终结果整体覆盖（清掉失败重试可能残留的片段）
   if (!outlineUserEdited.value) outlineModalText.value = event.outline || outlineModalText.value
   outlineTokenUsage.value = event.tokenUsage || null
   outlineStreaming.value = false
   scrollOutlineToBottom()
  },
  onStatus: (message) => {
   // 服务端的非致命提示（如截断警告）：在弹窗内常驻展示，不能静默丢弃，
   // 否则用户只会觉得"生成莫名其妙就完了"。
   if (message) outlineWarn.value = message
  },
  onError: (message) => {
   outlineStreaming.value = false
   outlineError.value = message || $t('generate.errOutline')
   genStatus.value = outlineError.value
   notifyModelError(message)
  },
  onLoadend: () => {
   outlineStreaming.value = false
   outlineXhr = null
   stopThinkingTicker()
   // 失败时保留弹窗：让用户看到原因并能直接重试
   if (outlineError.value) return
   if (!outlineModalText.value.trim()) {
    outlineModal.value = false
    genStatus.value = ''
    resolve(null)
   }
  },
 })

 outlineConfirmCallback = () => {
  if (outlineXhr) { outlineXhr.abort(); outlineXhr = null }
  outlineStreaming.value = false
  outlineModal.value = false
  genStatus.value = ''
  resolve(outlineModalText.value)
 }
 outlineRejectCallback = () => {
  if (outlineXhr) { outlineXhr.abort(); outlineXhr = null }
  outlineStreaming.value = false
  outlineModal.value = false
  genStatus.value = ''
  resolve(null)
 }
 })
}

// 蓝图生成改为 SSE 流式：实时展示模型输出并自动滚动到最新位置（推理模型耗时长，无超时限制）
function generateInitialBlueprint() {
 if (!selectedType.value || !outline.value.trim()) {
  blueprintSetupError.value = $t('generate.errNeedTypeOutline')
  return
 }
 blueprintGenerating.value = true
 blueprintSetupError.value = ''
 blueprintWarning.value = ''
 blueprintReasoningText.value = ''
 initialBlueprintConfirmed.value = false
 initialBlueprintJson.value = ''
 initialBlueprint.value = null
 blueprintThinkingChars.value = 0
 blueprintThinkingElapsed.value = 0
 startThinkingTicker()

 const token = localStorage.getItem('token')
 const sse = useSSE()
 blueprintXhr = sse
 sse.openSSE('/api/novel/generate-blueprint', {
  novelTypeId: selectedType.value,
  typeSku: buildTypeSku(),
  protagonistName: protagonistName.value,
  worldSetting: worldSetting.value,
  targetWordCount: targetWordCount.value,
  chapterWordTarget: chapterWordTarget.value,
  outline: outline.value,
  personaId: selectedPersonaId.value || undefined,
 }, {
  token,
  onThinking: (event) => {
   blueprintThinkingChars.value = event.length || 0
   blueprintThinkingElapsed.value = Math.round((event.elapsedMs || 0) / 1000)
  },
  onReasoning: (content) => {
   appendReasoning(blueprintReasoningText, content)
   scrollReasoningBox(blueprintReasoningRef)
  },
  onContent: (content) => {
   initialBlueprintJson.value += content
   scrollBlueprintToBottom()
  },
  onCompleted: (event) => {
   initialBlueprint.value = event.blueprint || null
   initialBlueprintJson.value = JSON.stringify(initialBlueprint.value, null, 2)
   blueprintWarning.value = event.warning || ''
   blueprintTokenUsage.value = event.tokenUsage || null
   blueprintGenerating.value = false
   stopThinkingTicker()
   scrollBlueprintToBottom()
  },
  onError: (message) => {
   blueprintSetupError.value = message || $t('generate.errBlueprintGen')
   blueprintGenerating.value = false
   stopThinkingTicker()
   notifyModelError(message)
  },
  onLoadend: () => { blueprintGenerating.value = false; blueprintXhr = null; stopThinkingTicker() },
 })
}

// 深度思考模型的首字延迟可能很长，允许用户主动中止，不必干等。
function cancelBlueprint() {
 if (blueprintXhr) { try { blueprintXhr.abort() } catch {} blueprintXhr = null }
 blueprintGenerating.value = false
 stopThinkingTicker()
 genStatus.value = ''
}

function confirmInitialBlueprint() {
 try {
  const parsed = JSON.parse(initialBlueprintJson.value)
  if (!parsed || !Array.isArray(parsed.phases) || !parsed.phases.length) throw new Error($t('generate.errBlueprintPhases'))
  initialBlueprint.value = parsed
  initialBlueprintConfirmed.value = true
  blueprintSetupError.value = ''
 } catch (e) {
  initialBlueprintConfirmed.value = false
  blueprintSetupError.value = $t('generate.errBlueprintFormat', { message: e.message })
 }
}

function outlineConfirm() {
 if (outlineConfirmCallback) outlineConfirmCallback()
}
function outlineReject() {
 if (outlineRejectCallback) outlineRejectCallback()
}

const maxWordCount = computed(() => genMode.value === 'chapter' ? 20000 : 10000000)

// 字数预设文案随语言切换（中文"字/章"，英文 words/ch）
function wordCountLabel(value, unit) {
 if (unit === 'book') {
  return value >= 1000000
   ? $t('generate.wordPresetBookM', { n: value / 1000000 })
   : $t('generate.wordPresetBook', { n: value / 10000 })
 }
 return $t('generate.wordPresetChapter', { n: value })
}
const chapterWordPresets = computed(() => [3000, 5000, 8000, 10000]
 .map((value) => ({ label: wordCountLabel(value, 'chapter'), value })))

// 输入越界时夹回 [2000, 20000]，与后端 normalizeChapterWordTarget 同口径。
watch(chapterWordTarget, (value) => {
 const num = Number(value)
 if (!Number.isFinite(num)) return
 const clamped = Math.max(2000, Math.min(20000, Math.round(num)))
 if (clamped !== value) chapterWordTarget.value = clamped
})

const estimatedChapters = computed(() => {
 const total = Number(targetWordCount.value) || 50000
 const per = Math.max(2000, Math.min(20000, Number(chapterWordTarget.value) || 3000))
 return Math.max(1, Math.ceil(total / per))
})

const activePresets = computed(() => {
 const isBook = genMode.value === 'book'
 const values = isBook ? [50000, 100000, 300000, 500000] : [1000, 2000, 3000, 5000]
 return values.map((value) => ({ label: wordCountLabel(value, isBook ? 'book' : 'chapter'), value }))
})

async function startGen() {
 if (!selectedType.value || generationBusy.value) return
 preparingGeneration.value = true

 // 如果没有填写大纲且是整本模式，先生成大纲让用户确认
 if (!outline.value.trim() && genMode.value === 'book') {
 const confirmedOutline = await showOutlineModal(selectedType.value, protagonistName.value, worldSetting.value, targetWordCount.value, chapterWordTarget.value)
 if (!confirmedOutline) { preparingGeneration.value = false; return }
 outline.value = confirmedOutline
 }

 if (genMode.value === 'book' && !initialBlueprintConfirmed.value) {
  if (!initialBlueprintJson.value) await generateInitialBlueprint()
  genStatus.value = blueprintSetupError.value || $t('generate.errNeedBlueprint')
  preparingGeneration.value = false
  return
 }

 preparingGeneration.value = false
 generating.value = true; genStatus.value = ''; genOk.value = false
 researchHint.value = ''
 genThinkingChars.value = 0; genThinkingElapsed.value = 0
 startThinkingTicker()
 streamingText.value = ''; outlineStreamingText.value = ''
 rawStreamingText.value = ''
 generatedNovelId.value = ''; generatedChapterNumber.value = 0
 generatedApplyBusy.value = false; generatedApplyMessage.value = ''
 showGenModal.value = true
 genModalTitle.value = `${selectedType.value} - ${protagonistName.value || $t('generate.untitled')}`
 deslopDone.value = false; deslopText.value = ''; deslopRunning.value = false; diffHtml.value = ''
 editorialDone.value = false; editorialText.value = ''; editorialRunning.value = false; editorialAnalysis.value = null
 editorialStages.value.forEach(s => { s.active = false; s.done = false; s.error = false; s.errorMsg = '' })

 const params = {
 novelTypeId: selectedType.value,
 typeSku: buildTypeSku(),
 protagonistName: protagonistName.value,
 worldSetting: worldSetting.value,
 targetWordCount: targetWordCount.value,
 chapterWordTarget: genMode.value === 'book' ? chapterWordTarget.value : undefined,
 mode: genMode.value,
 expertMode: expertMode.value,
 outline: outline.value,
 personaId: selectedPersonaId.value || undefined,
 storyBlueprint: genMode.value === 'book' ? initialBlueprint.value : undefined,
 enableResearch: enableResearch.value,
 researchLinks: researchLinksText.value.split('\n').map(s => s.trim()).filter(Boolean),
 }

 novelStore.startGeneration(params,
 (chunk) => { rawStreamingText.value += chunk; streamingText.value += chunk; scrollToBottom() },
 (event) => {
 if (event.type === 'outline') {
 outlineStreamingText.value = event.content
 if (event.tokenUsage) outlineTokenUsage.value = event.tokenUsage
 } else if (event.type === 'novel_created') {
 genStatus.value = $t('generate.statusOutline')
 generatedNovelId.value = event.novelId || generatedNovelId.value
 } else if (event.type === 'chapter_end') {
 generatedChapterNumber.value = Number(event.chapterNumber || generatedChapterNumber.value)
 } else if (event.type === 'token_usage') {
 // 累计 token 用量：不覆盖主状态文案，只更新用量徽标。
 generationTokenUsage.value = event.usage || null
 } else if (event.type === 'status') {
 genStatus.value = event.message
 } else if (event.type === 'chapter_start') {
 genStatus.value = $t('generate.statusGeneratingChapter', { title: event.title || $t('generate.chapterTitle', { n: event.chapterNumber }) })
 } else if (event.type === 'thinking') {
  // 深度思考模型：思考阶段没有正文，必须让用户看到"仍在推进"（字数 + 已用时间），
  // 并说明思考不会占用正文字数，避免误判为卡死或"字数被吃掉"。
  genThinkingChars.value = event.length || 0
  genThinkingElapsed.value = Math.round((event.elapsedMs || 0) / 1000)
  genStatus.value = genThinkingChars.value > 0
   ? `${$t('generate.thinkingStatus', { seconds: genThinkingElapsed.value })}${$t('generate.thinkingCharsSuffix', { n: genThinkingChars.value })}`
   : $t('generate.thinkingStatus', { seconds: genThinkingElapsed.value })
 } else if (event.type === 'quality_notice') {
 const issues = event.report?.issues?.join('；') || $t('generate.qualityFallback')
 genStatus.value = $t('generate.statusQualityNotice', { n: event.chapterNumber, issues })
 } else if (event.type === 'humanized') {
 // 服务器返回改写后文本，替换显示
 streamingText.value = event.content
 genStatus.value = $t('generate.statusRewritten', { n: event.chapterNumber })
 scrollToBottom()
 } else if (event.type === 'expert_revision') {
  streamingText.value = event.content || streamingText.value
  genStatus.value = $t('generate.statusReviewed', { n: event.chapterNumber })
  scrollToBottom()
 } else if (event.type === 'completed') {
 genStatus.value = $t('generate.statusDone'); genOk.value = true; generating.value = false
 } else if (event.type === 'paused') {
 genStatus.value = $t('generate.statusPaused'); generating.value = false
 } else if (event.type === 'token_exhausted') {
 genStatus.value = $t('generate.statusStopped'); generating.value = false
 } else if (event.type === 'plan_needs_extension') {
 genStatus.value = event.message || $t('generate.statusPlanExtend'); generating.value = false
} else if (event.type === 'research_status') {
 if (event.state === 'start') researchHint.value = $t('generate.researchStatus.start')
 else if (event.state === 'done') {
 const n = Array.isArray(event.sources) ? event.sources.length : 0
 researchHint.value = $t('generate.researchStatus.done', { n })
 } else {
 researchHint.value = $t('generate.researchStatus.skipped')
 }
} else if (event.type === 'error') {
 genStatus.value = ' ' + (event.message || $t('generate.errGen')); generating.value = false
 notifyModelError(event.message)
 }
 }
 )
}

function scrollToBottom() {
 nextTick(() => { if (streamRef.value) streamRef.value.scrollTop = streamRef.value.scrollHeight })
}

// ---- 去AI化 ----
async function startDeslop() {
 if (!streamingText.value || streamingText.value.length < 50) return
 deslopRunning.value = true; deslopDone.value = false; deslopText.value = ''; diffHtml.value = ''
 deslopStatus.value = $t('generate.deslopRunning')

 const token = localStorage.getItem('token')
 const sse = useSSE()
 sse.openSSE('/api/novel/deslop-stream', { text: streamingText.value, novelId: generatedNovelId.value || undefined }, {
  token,
  onContent: (content) => {
   deslopText.value += content
   nextTick(() => { if (deslopStreamRef.value) deslopStreamRef.value.scrollTop = deslopStreamRef.value.scrollHeight })
  },
  onStatus: (message) => { deslopStatus.value = message },
  onCompleted: (event) => {
   deslopText.value = event.content || deslopText.value
   deslopDone.value = true; deslopRunning.value = false
   deslopStatus.value = $t('generate.deslopDone')
   computeDiff()
  },
  onError: (message) => {
   deslopStatus.value = message || $t('generate.errDeslop'); deslopRunning.value = false
   notifyModelError(message)
  },
  onLoadend: () => {
   if (deslopRunning.value) { deslopDone.value = true; deslopRunning.value = false; deslopStatus.value = $t('generate.deslopDone'); computeDiff() }
  },
 })
}

function resetDeslop() {
 deslopDone.value = false; deslopText.value = ''; deslopRunning.value = false; diffHtml.value = ''; deslopStatus.value = ''
}

async function applyGeneratedResult(kind) {
 if (genMode.value !== 'chapter') {
 generatedApplyMessage.value = $t('generate.applyBookHint')
 return
 }
 const content = kind === 'editorial' ? editorialText.value : deslopText.value
 if (!generatedNovelId.value || !generatedChapterNumber.value || !content.trim()) {
 generatedApplyMessage.value = $t('generate.applyUnavailable')
 return
 }
 if (!confirm($t(kind === 'editorial' ? 'generate.applyEditorialConfirm' : 'generate.applyDeslopConfirm'))) return

 generatedApplyBusy.value = true
 generatedApplyMessage.value = ''
 try {
 await api.put(`/novel/${generatedNovelId.value}/chapter/${generatedChapterNumber.value}`, {
  content,
  source: kind === 'editorial' ? 'editorial' : 'deslop',
 })
 streamingText.value = content
 generatedApplyMessage.value = $t('generate.applied')
 } catch (error) {
 generatedApplyMessage.value = error.response?.data?.message || error.message || $t('generate.applyFailed')
 } finally {
 generatedApplyBusy.value = false
 }
}

// ---- 编辑引擎 ----
async function startEditorial() {
 if (!streamingText.value || streamingText.value.length < 100) return

 const textLen = streamingText.value.length
 // 选择小说模板时，编辑引擎会沿用该模板；未选择时才生成本地人格。
 // 3 次 LLM 调用：每阶段输入~textLen*1.5 + 系统提示~500 + 输出~textLen*1.5 ≈ textLen*3 + 500
 // 总计 ≈ textLen*9 + 1500，保守取 1.3 倍系数
 const estTimeMin = Math.max(1, Math.round((textLen * 9 + 1500) * 1.3 / 3000))

 if (!confirm($t('generate.confirmEditorial', { textLen, estTimeMin }))) return

 editorialRunning.value = true; editorialDone.value = false; editorialText.value = ''; editorialAnalysis.value = null
 // 重置阶段状态
 editorialStages.value.forEach(s => { s.active = false; s.done = false; s.error = false; s.errorMsg = '' })

 const token = localStorage.getItem('token')
 const sse = useSSE()
 sse.openSSE('/api/novel/editorial-stream', { text: streamingText.value, novelId: generatedNovelId.value || undefined }, {
  token,
  onContent: (content) => {
   editorialText.value += content
   nextTick(() => { if (editorialStreamRef.value) editorialStreamRef.value.scrollTop = editorialStreamRef.value.scrollHeight })
  },
  onStatus: (message, event) => {
   // 更新阶段状态
   const stage = editorialStages.value.find(s => s.id === event.stage)
   if (stage) {
   if (event.failed) {
   // 阶段失败
   stage.error = true; stage.errorMsg = event.message; stage.active = false
   } else if (event.phase === 'running') {
   // 阶段开始 - 清空之前阶段的流式内容，只展示当前阶段
   if (event.stage !== 'persona') {
    editorialText.value = ''
   }
   stage.active = true
   const idx = editorialStages.value.findIndex(s => s.id === event.stage)
   for (let i = 0; i < idx; i++) { if (!editorialStages.value[i].error) { editorialStages.value[i].done = true; editorialStages.value[i].active = false } }
   } else {
   // 阶段完成
   stage.done = true; stage.active = false
   }
   }
  },
  onCompleted: (event) => {
   editorialText.value = event.content || editorialText.value
   editorialAnalysis.value = event.analysis || null
   editorialDone.value = true; editorialRunning.value = false
   editorialStages.value.forEach(s => { if (!s.error) { s.done = true; s.active = false } })
  },
  onError: (message) => {
   editorialRunning.value = false
   alert(message || $t('generate.errEditorial'))
  },
  onLoadend: () => {
   if (editorialRunning.value) {
   editorialDone.value = true; editorialRunning.value = false
   editorialStages.value.forEach(s => { if (!s.error) { s.done = true; s.active = false } })
   }
  },
 })
}

function resetEditorial() {
 editorialDone.value = false; editorialText.value = ''; editorialRunning.value = false; editorialAnalysis.value = null
 editorialStages.value.forEach(s => { s.active = false; s.done = false; s.error = false; s.errorMsg = '' })
}

// 简易 diff：逐字对比，红色=删除，绿色=新增
function computeDiff() {
 const oldText = streamingText.value || ''
 const newText = deslopText.value || ''
 if (!oldText || !newText) { diffHtml.value = ''; return }

 // 基于行的简易 diff
 const oldLines = oldText.split('\n')
 const newLines = newText.split('\n')
 const maxLen = Math.max(oldLines.length, newLines.length)
 let html = ''

 for (let i = 0; i < maxLen; i++) {
 const oldLine = oldLines[i] || ''
 const newLine = newLines[i] || ''
 if (oldLine === newLine) {
 html += escapeHtml(newLine) + '\n'
 } else {
 // 逐字符 diff
 const diff = charDiff(oldLine, newLine)
 html += diff + '\n'
 }
 }
 diffHtml.value = html
}

function charDiff(oldStr, newStr) {
 // 简易逐字符对比
 let result = ''
 const maxLen = Math.max(oldStr.length, newStr.length)
 for (let i = 0; i < maxLen; i++) {
 const oldChar = oldStr[i] || ''
 const newChar = newStr[i] || ''
 if (oldChar === newChar) {
 result += escapeHtml(newChar)
 } else {
 if (oldChar) result += `<del>${escapeHtml(oldChar)}</del>`
 if (newChar) result += `<ins>${escapeHtml(newChar)}</ins>`
 }
 }
 return result
}

function escapeHtml(text) {
 if (!text) return ''
 return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
}

// ---- 轻小说 ----
const lnTypes = ref([
 { id: 'lightnovel_isekai', name: '异世界转生', icon: '' },
 { id: 'lightnovel_school', name: '校园恋爱', icon: '' },
 { id: 'lightnovel_fantasy', name: '奇幻冒险', icon: '️' },
 { id: 'lightnovel_slice', name: '日常系', icon: '' },
 { id: 'lightnovel_battle', name: '战斗异能', icon: '' },
 { id: 'lightnovel_scifi', name: '科幻未来', icon: '' },
])
const lnSelectedType = ref('')
const lnCharName = ref('')
const lnCharTrait = ref('')
const lnWorldSetting = ref('')
const lnGenMode = ref('book')
const lnTargetWordCount = ref(50000)
const lnExpertMode = ref(false)
const lnGenerating = ref(false)
const lnStatus = ref('')
const lnOk = ref(false)
const lnStreamingText = ref('')
const lnStreamRef = ref(null)

// ---- 轻小说 ----
const lnTraits = ['元气', '冷酷', '温柔', '傲娇', '天然呆', '腹黑', '高冷', '治愈', '热血', '神秘', '活泼', '冷静']

const lnActivePresets = computed(() => {
 const isBook = lnGenMode.value === 'book'
 const values = isBook ? [50000, 100000, 300000, 500000] : [1000, 2000, 3000, 5000]
 return values.map((value) => ({ label: wordCountLabel(value, isBook ? 'book' : 'chapter'), value }))
})

async function startLNGen() {
 if (!lnSelectedType.value) return alert($t('generate.errNeedLNType'))

 // 轻小说整本模式：先生成大纲
 let lnOutline = ''
 if (lnGenMode.value === 'book') {
 const lnTypeObj = lnTypes.find(t => t.id === lnSelectedType.value)
 const lnName = lnTypeObj?.name || ''
 const lnChar = (lnCharName.value + (lnCharTrait.value ? $t('generate.lnTraitSuffix', { trait: $tt(lnCharTrait.value) }) : '')).trim() || $t('generate.untitled')
 const lnWorld = lnWorldSetting.value || $t('generate.lnWorldByGenre', { genre: $tn(lnName) })
 const confirmedOutline = await showOutlineModal(lnSelectedType.value, lnChar, lnWorld, lnTargetWordCount.value)
 if (!confirmedOutline) return
 lnOutline = confirmedOutline
 }

 lnGenerating.value = true; lnStatus.value = ''; lnOk.value = false
 lnStreamingText.value = ''

 const traitDesc = lnCharTrait.value ? $t('generate.lnTraitSuffix', { trait: $tt(lnCharTrait.value) }) : ''
 const params = {
 novelTypeId: lnSelectedType.value,
 protagonistName: (lnCharName.value + traitDesc).trim() || $t('generate.untitled'),
 worldSetting: lnWorldSetting.value || (() => {
 const type = lnTypes.find(t => t.id === lnSelectedType.value)
 return type ? $t('generate.lnWorldByGenre', { genre: $tn(type.name) }) : $t('generate.lnWorldFallback')
 })(),
 targetWordCount: lnTargetWordCount.value,
 mode: lnGenMode.value,
 expertMode: lnExpertMode.value,
 outline: lnOutline,
 }

 novelStore.startGeneration(params,
 (chunk) => { lnStreamingText.value += chunk; lnScrollToBottom() },
 (event) => {
 if (event.type === 'outline') {
 lnStatus.value = $t('generate.statusOutline')
 } else if (event.type === 'novel_created') {
 lnStatus.value = $t('generate.statusOutline')
 } else if (event.type === 'status') {
 lnStatus.value = event.message
 } else if (event.type === 'chapter_start') {
 lnStatus.value = $t('generate.statusGeneratingChapter', { title: event.title || $t('generate.chapterTitle', { n: event.chapterNumber }) })
 } else if (event.type === 'thinking') {
  lnStatus.value = $t('generate.statusThinkingUnits', { n: event.length || 0 })
 } else if (event.type === 'quality_notice') {
 const issues = event.report?.issues?.join('；') || $t('generate.qualityFallback')
 lnStatus.value = $t('generate.statusQualityNotice', { n: event.chapterNumber, issues })
 } else if (event.type === 'expert_revision') {
  lnStreamingText.value = event.content || lnStreamingText.value
  lnStatus.value = $t('generate.statusReviewed', { n: event.chapterNumber })
 } else if (event.type === 'completed') {
 lnStatus.value = $t('generate.statusDone'); lnOk.value = true; lnGenerating.value = false
 } else if (event.type === 'paused') {
 lnStatus.value = '⏸️ ' + $t('generate.statusPaused'); lnGenerating.value = false
 } else if (event.type === 'token_exhausted') {
 lnStatus.value = $t('generate.statusStopped'); lnGenerating.value = false
 } else if (event.type === 'plan_needs_extension') {
 lnStatus.value = event.message || $t('generate.statusPlanExtend'); lnGenerating.value = false
} else if (event.type === 'error') {
 lnStatus.value = ' ' + (event.message || $t('generate.errGen')); lnGenerating.value = false
 notifyModelError(event.message)
 }
 }
 )
}

function lnScrollToBottom() {
 nextTick(() => { if (lnStreamRef.value) lnStreamRef.value.scrollTop = lnStreamRef.value.scrollHeight })
}

onMounted(async () => {
 if (!authStore.isLoggedIn) { router.push('/login'); return }
 try {
   const data = await novelStore.fetchFullTypes()
   fullTypes.value = data
 } catch {}
 try {
   skuCatalog.value = await novelStore.fetchSkuCatalog()
 } catch {}
 // 加载写作人格
 try {
   const list = await personaStore.fetchList()
   personas.value = list
   // 默认选中第一个系统预设
   if (list.length > 0 && !selectedPersonaId.value) {
     selectedPersonaId.value = list[0]._id
   }
 } catch {}
})
</script>

<style scoped>
.locked { opacity: 0.55; pointer-events: none; cursor: not-allowed; }
.generate-page {
 padding-top: var(--header-height);
}

/* --- Tab switcher --- */
.tabs {
 display: flex;
 background: var(--bg);
 border-radius: var(--radius);
 padding: 3px;
 margin: 0 16px 16px;
 border: 1px solid var(--card-border);
}
.tab {
 flex: 1;
 padding: 10px;
 text-align: center;
 font-size: 13px;
 font-weight: 600;
 cursor: pointer;
 border: none;
 background: transparent;
 font-family: inherit;
 color: var(--text-tertiary);
 border-radius: 6px;
 transition: all var(--transition);
}
.tab.active {
 background: var(--card);
 color: var(--text);
 box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.tab:hover:not(.active) {
 color: var(--text-secondary);
}

/* --- Genre Tabs --- */
.gender-tabs {
 display: flex;
 gap: 8px;
 margin-bottom: 14px;
}
.gender-tabs button {
 flex: 1;
 padding: 10px 14px;
 border: 1px solid var(--card-border);
 border-radius: var(--radius);
 font-size: 14px;
 font-weight: 500;
 background: var(--card);
 cursor: pointer;
 font-family: inherit;
 transition: all var(--transition);
 color: var(--text-secondary);
}
.gender-tabs button.active {
 border-color: var(--primary);
 background: var(--primary-light);
 color: var(--primary);
 font-weight: 600;
}

/* --- Type Grid --- */
.type-grid {
 display: grid;
 grid-template-columns: repeat(4, 1fr);
 gap: 8px;
}
.type-card {
 display: flex;
 flex-direction: column;
 align-items: center;
 gap: 4px;
 padding: 14px 6px;
 border: 1px solid var(--card-border);
 border-radius: var(--radius);
 background: var(--card);
 cursor: pointer;
 transition: all var(--transition);
}
.type-card:hover {
 border-color: var(--primary);
 box-shadow: 0 2px 8px rgba(63, 125, 90, 0.12);
}
.type-card.selected {
 border-color: var(--primary);
 background: var(--primary-light);
}
.type-icon {
 font-size: 22px;
 line-height: 1;
}
.type-name {
 font-size: 11px;
 font-weight: 500;
 color: var(--text-secondary);
 text-align: center;
 line-height: 1.3;
}
.type-info {
 margin-top: 8px;
 font-size: 13px;
 color: var(--primary);
 font-weight: 500;
 text-align: center;
}
/* --- 番茄式多选类型 SKU --- */
.sku-loading { font-size: 13px; color: var(--text-secondary); text-align: center; padding: 12px 0; }
.sku-layer { margin-top: 12px; }
.sku-layer-label {
 font-size: 12px;
 font-weight: 600;
 color: var(--text-secondary);
 margin-bottom: 6px;
}
.sku-multi-hint {
 font-weight: 400;
 font-size: 11px;
 color: var(--text-muted, #9aa);
 margin-left: 4px;
}
.sku-chips {
 display: flex;
 flex-wrap: wrap;
 gap: 6px;
}
.sku-chips-scroll {
 max-height: 132px;
 overflow-y: auto;
 padding-right: 4px;
}
.sku-chip {
 display: inline-flex;
 align-items: center;
 gap: 4px;
 padding: 5px 10px;
 font-size: 12px;
 line-height: 1.2;
 border: 1px solid var(--card-border);
 border-radius: 999px;
 background: var(--card);
 color: var(--text-secondary);
 cursor: pointer;
 transition: all var(--transition);
}
.sku-chip:hover { border-color: var(--primary); }
.sku-chip.selected {
 border-color: var(--primary);
 background: var(--primary-light);
 color: var(--primary);
 font-weight: 600;
}
.sku-chip.tone.selected { background: rgba(217, 138, 60, 0.14); }
.sku-chip-icon { font-size: 14px; line-height: 1; }
/* --- 人格风格六轴 --- */
.axes-grid {
 margin-top: 8px;
 padding: 10px;
 border: 1px dashed var(--card-border);
 border-radius: var(--radius);
 display: flex;
 flex-direction: column;
 gap: 10px;
}
.axes-hint { font-size: 11px; color: var(--text-secondary); }
.axis-row { display: flex; flex-direction: column; gap: 2px; }
.axis-name { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.axis-scale { display: flex; align-items: center; gap: 8px; }
.axis-scale input[type="range"] { flex: 1; }
.axis-end { font-size: 10px; color: var(--text-muted, #9aa); white-space: nowrap; min-width: 52px; }
.axis-end.low { text-align: left; }
.axis-end.high { text-align: right; }
.axis-val { font-size: 11px; color: var(--primary); font-weight: 600; text-align: right; }

/* --- Mode Radios --- */
.mode-radio-group {
 display: flex;
 gap: 10px;
}
.mode-radio {
 flex: 1;
 padding: 12px;
 border: 1px solid var(--card-border);
 border-radius: var(--radius);
 cursor: pointer;
 text-align: center;
 transition: all var(--transition);
 font-size: 14px;
 font-weight: 500;
 color: var(--text-secondary);
}
.mode-radio input { display: none; }
.mode-radio.active {
 border-color: var(--primary);
 background: var(--primary-light);
 color: var(--primary);
}
.mode-icon {
 font-size: 20px;
 display: block;
 margin-bottom: 4px;
}
.mode-label {
 font-size: 13px;
}

/* --- Word Count --- */
.word-count-input {
 display: flex;
 align-items: center;
 gap: 8px;
}
.word-count-input .input { flex: 1; }
.expert-mode-toggle { display: flex; align-items: flex-start; gap: 8px; margin-top: 14px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--primary-light); cursor: pointer; }
.expert-mode-toggle input { margin-top: 3px; flex: 0 0 auto; }
.expert-mode-toggle span { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.expert-mode-toggle strong { color: var(--text-primary); font-size: 13px; }
.expert-mode-toggle small { color: var(--text-light); font-size: 11px; line-height: 1.45; }
.research-links-box { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary, rgba(0,0,0,0.02)); }
.research-links-box .label-sm { margin-bottom: 6px; color: var(--text-secondary); font-size: 12px; }
.research-hint { margin: 0 0 12px; padding: 8px 12px; border-radius: 8px; background: var(--primary-light); color: var(--text-primary); font-size: 13px; }
.unit {
 font-size: 14px;
 color: var(--text-tertiary);
}
.word-count-presets {
 display: flex;
 gap: 6px;
 margin-top: 8px;
 flex-wrap: wrap;
}
.preset-btn {
 padding: 4px 14px;
 border: 1px solid var(--card-border);
 border-radius: 100px;
 font-size: 12px;
 cursor: pointer;
 transition: all var(--transition);
 color: var(--text-tertiary);
 background: var(--card);
 font-family: inherit;
}
.preset-btn.active {
 border-color: var(--primary);
 background: var(--primary-light);
 color: var(--primary);
 font-weight: 600;
}
.preset-btn:hover {
 border-color: var(--primary);
 color: var(--primary);
}
/* --- 每章字数（整本模式） --- */
.chapter-words-input {
 margin-top: 12px;
 padding: 10px 12px;
 border: 1px dashed var(--card-border);
 border-radius: 8px;
}
.chapter-words-label {
 display: flex;
 align-items: center;
 gap: 8px;
}
.chapter-words-title {
 font-size: 13px;
 font-weight: 600;
 color: var(--text-primary);
 white-space: nowrap;
}
.chapter-words-label .input {
 flex: 1;
 max-width: 140px;
}
.chapter-words-hint {
 margin-top: 6px;
 font-size: 11px;
 color: var(--text-light);
 line-height: 1.45;
}

/* --- Status --- */
.gen-status {
 margin-top: 12px;
 text-align: center;
}
.gen-token-usage {
 margin-top: 6px;
 text-align: center;
 font-size: 12px;
 color: var(--text-light);
}

/* --- Stream Output --- */
.stream-card {
 max-height: 60vh;
 overflow-y: auto;
}

/* --- Outline Stream --- */
.outline-stream-card {
 background: #fffbeb;
 border-color: #fde68a;
}

/* --- Initial Story Blueprint --- */
.blueprint-setup-card { border-color: #c7d7fe; background: #fbfcff; }
.blueprint-setup-desc { color: var(--text-secondary); font-size: 12px; line-height: 1.7; margin-bottom: 10px; }
.blueprint-setup-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.blueprint-json-editor { margin-top: 10px; min-height: 190px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; line-height: 1.55; }
.blueprint-confirmed { color: var(--success); font-size: 12px; }
.blueprint-setup-hint { color: var(--text-light); font-size: 12px; }
.blueprint-setup-error { margin-top: 8px; color: #cf1322; background: #fff1f0; border-radius: 6px; padding: 7px 9px; font-size: 12px; }
/* 深度思考模型的等待提示：把"正在思考多久了"讲清楚，减少用户误判卡死 */
.thinking-hint { margin-top: 8px; color: var(--text-secondary, #4a5568); font-size: 12px; line-height: 1.6; }
.thinking-tip { display: block; margin-top: 2px; color: var(--text-light); font-size: 11px; }

/* --- Light Novel Tab --- */
.ln-grid {
 grid-template-columns: repeat(3, 1fr) !important;
}
.ln-trait-section .label-sm {
 font-size: 13px;
 color: var(--text-secondary);
 margin-bottom: 8px;
 font-weight: 500;
}
.ln-traits {
 display: flex;
 gap: 6px;
 flex-wrap: wrap;
}
.ln-traits .preset-btn {
 font-size: 13px;
}

.ln-ref-card {
 border-color: var(--success-border);
 background: var(--success-bg);
}
.ln-ref-desc {
 font-size: 12px;
 color: var(--text-tertiary);
 margin-bottom: 10px;
}
.ln-ref-empty {
 font-size: 13px;
 color: var(--text-tertiary);
 text-align: center;
 padding: 16px;
}
.ln-ref-list {
 display: flex;
 flex-direction: column;
 gap: 6px;
 max-height: 240px;
 overflow-y: auto;
}
.ln-ref-item {
 display: flex;
 align-items: center;
 gap: 10px;
 padding: 10px 12px;
 border: 1px solid var(--card-border);
 border-radius: var(--radius);
 cursor: pointer;
 transition: all var(--transition);
 background: var(--card);
}
.ln-ref-item:hover {
 border-color: var(--primary);
}
.ln-ref-item.selected {
 border-color: var(--success);
 background: var(--success-bg);
}
.ref-check {
 font-size: 16px;
 flex-shrink: 0;
 width: 20px;
 text-align: center;
}
.ref-info {
 min-width: 0;
 flex: 1;
}
.ref-title {
 font-size: 13px;
 font-weight: 600;
 color: var(--text);
}
.ref-meta {
 font-size: 11px;
 color: var(--text-tertiary);
 margin-top: 1px;
}
.ref-count {
 margin-top: 8px;
 font-size: 12px;
 color: var(--success);
 font-weight: 500;
 text-align: center;
}

/* --- Template Match --- */
.tmpl-match-card {
 margin-top: 10px;
 padding: 12px;
 background: var(--info-bg);
 border: 1px solid var(--info-border);
 border-radius: var(--radius);
}
.tmpl-match-title {
 font-size: 12px;
 font-weight: 600;
 color: var(--info);
 margin-bottom: 6px;
}
.tmpl-match-list {
 display: flex;
 flex-direction: column;
 gap: 4px;
}
.tmpl-match-item {
 display: flex;
 align-items: center;
 gap: 8px;
 font-size: 12px;
}
.tmpl-name {
 font-weight: 500;
 color: var(--text);
}
.tmpl-score {
 font-size: 11px;
 padding: 1px 8px;
 border-radius: 100px;
 font-weight: 600;
}
.tmpl-score.high {
 background: var(--success-bg);
 color: var(--success);
}
.tmpl-score.mid {
 background: var(--warning-bg);
 color: var(--warning);
}
.tmpl-score.low {
 background: var(--error-bg);
 color: var(--error);
}
.tmpl-match-hint {
 font-size: 11px;
 color: var(--text-tertiary);
 margin-top: 6px;
}

/* --- Outline Modal --- */
.modal-overlay {
 position: fixed;
 inset: 0;
 z-index: 1000;
 background: rgba(15, 23, 42, 0.5);
 display: flex;
 align-items: center;
 justify-content: center;
 animation: fadeIn 200ms var(--ease);
 padding: 16px;
}
.outline-modal-card {
 background: var(--card);
 border-radius: var(--radius-xl);
 padding: 24px;
 width: 100%;
 max-width: 600px;
 box-shadow: 0 20px 60px rgba(0,0,0,0.15);
 animation: slideUp 250ms var(--ease);
}
.outline-modal-title {
 font-size: 17px;
 font-weight: 700;
 color: var(--text);
 margin-bottom: 6px;
}
.outline-modal-desc {
 font-size: 13px;
 color: var(--text-tertiary);
 margin-bottom: 14px;
}
.outline-modal-textarea {
 width: 100%;
 min-height: 300px;
 padding: 12px;
 border: 1px solid var(--card-border);
 border-radius: var(--radius);
 font-size: 13px;
 line-height: 1.6;
 resize: vertical;
 font-family: inherit;
 box-sizing: border-box;
}
.outline-modal-textarea:focus {
 border-color: var(--primary);
 box-shadow: 0 0 0 3px rgba(63,125,90,0.14);
 outline: none;
}
.outline-modal-token { margin-top:8px; font-size:12px; color:var(--text-light); text-align:right; }
/* 流式生成时的模型思考过程预览（正文开始前展示，自动滚动） */
.stream-reasoning-box {
 max-height: 160px;
 overflow-y: auto;
 margin-bottom: 10px;
 padding: 10px 12px;
 border: 1px dashed var(--card-border);
 border-radius: var(--radius);
 background: rgba(63,125,90,0.05);
 font-size: 12px;
 line-height: 1.6;
 color: var(--text-light);
 white-space: pre-wrap;
 word-break: break-word;
}
.outline-modal-actions {
 display: flex;
 gap: 10px;
 margin-top: 16px;
 justify-content: flex-end;
}
.outline-modal-actions .btn {
 min-width: 100px;
 text-align: center;
}
@keyframes fadeIn {
 from { opacity: 0; }
 to { opacity: 1; }
}
@keyframes slideUp {
 from { opacity: 0; transform: translateY(12px); }
 to { opacity: 1; transform: translateY(0); }
}

.ref-struct-desc {
 font-size: 13px;
 color: var(--text-secondary);
 margin-bottom: 10px;
 line-height: 1.5;
}
.upload-bar {
 display: flex;
 align-items: center;
 gap: 8px;
}
.file-name {
 font-size: 12px;
 color: var(--text-secondary);
 flex: 1;
 overflow: hidden;
 text-overflow: ellipsis;
 white-space: nowrap;
}
.struct-analyzing {
 display: flex;
 align-items: center;
 margin-top: 8px;
 font-size: 13px;
 color: var(--text-secondary);
}
.struct-result {
 margin-top: 8px;
}
.struct-preview {
 max-height: 300px;
 overflow-y: auto;
 background: #fafafa;
 border-radius: var(--radius);
 padding: 12px;
 border: 1px solid var(--card-border);
}
.struct-section {
 margin-bottom: 10px;
}
.struct-section:last-child {
 margin-bottom: 0;
}
.struct-section-title {
 font-size: 13px;
 font-weight: 600;
 color: var(--primary);
 margin-bottom: 4px;
}
.struct-section-body {
 font-size: 12px;
 color: var(--text-secondary);
 line-height: 1.6;
 white-space: pre-wrap;
}

/* --- Checkbox Row --- */
.checkbox-row {
 display: flex;
 align-items: center;
 gap: 6px;
 font-size: 13px;
 color: var(--text);
 cursor: pointer;
}
.checkbox-row input[type="checkbox"] {
 accent-color: var(--primary);
 width: 16px;
 height: 16px;
}

/* ---- 生成弹框 ---- */
.gen-modal-overlay {
 position: fixed;
 top: 0; left: 0; right: 0; bottom: 0;
 background: rgba(0,0,0,0.5);
 z-index: 1000;
 display: flex;
 align-items: center;
 justify-content: center;
 padding: 20px;
}
.gen-modal {
 background: var(--card, #fff);
 border-radius: 12px;
 width: 100%;
 max-width: 900px;
 max-height: 85vh;
 display: flex;
 flex-direction: column;
 box-shadow: 0 20px 60px rgba(0,0,0,0.3);
 animation: slideUp 250ms ease;
}
.gen-modal-header {
 display: flex;
 align-items: center;
 justify-content: space-between;
 padding: 16px 20px;
 border-bottom: 1px solid var(--card-border, #eee);
}
.gen-modal-title {
 font-size: 16px;
 font-weight: 700;
}
.gen-modal-close {
 background: none;
 border: none;
 font-size: 24px;
 cursor: pointer;
 color: var(--text-tertiary, #999);
 padding: 0 4px;
}
.gen-modal-close:hover { color: var(--text, #333); }
.gen-modal-body {
 flex: 1;
 overflow-y: auto;
 padding: 16px 20px;
}
.gen-modal-footer {
 padding: 12px 20px;
 border-top: 1px solid var(--card-border, #eee);
 display: flex;
 align-items: center;
 flex-wrap: wrap;
 gap: 12px;
}

.generated-apply-hint,
.generated-apply-message {
 font-size: 12px;
 color: var(--text-secondary, #666);
}
.generated-apply-message { color: var(--success, #2e8b57); }

/* 文本区域 */
.gen-text-section {
 margin-bottom: 16px;
 transition: opacity 0.3s;
}
.gen-text-section.grayed {
 opacity: 0.5;
}
.gen-text-label {
 font-size: 13px;
 font-weight: 600;
 color: var(--text-secondary, #666);
 margin-bottom: 8px;
}
.gen-text-content {
 background: var(--bg-secondary, #f5f5f5);
 border-radius: 8px;
 padding: 12px;
 font-size: 14px;
 line-height: 1.8;
 white-space: pre-wrap;
 word-break: break-word;
 max-height: 300px;
 overflow-y: auto;
}
.deslop-section .gen-text-content {
 background: var(--info-bg);
 border: 1px solid var(--info-border);
}

/* Diff 对比 */
.gen-diff-section {
 margin-top: 16px;
}
.gen-diff-content {
 background: var(--bg-secondary, #f5f5f5);
 border-radius: 8px;
 padding: 12px;
 font-size: 14px;
 line-height: 1.8;
 white-space: pre-wrap;
 word-break: break-word;
 max-height: 400px;
 overflow-y: auto;
}
.gen-diff-content del {
 background: #ffe0e0;
 color: #c0392b;
 text-decoration: line-through;
 padding: 0 2px;
 border-radius: 2px;
}
.gen-diff-content ins {
 background: #e0ffe0;
 color: #27ae60;
 text-decoration: none;
 padding: 0 2px;
 border-radius: 2px;
 font-weight: 500;
}

.deslop-status {
 font-size: 13px;
 color: var(--primary);
}

/* ---- 编辑引擎 ---- */
.btn-editorial {
 background: var(--accent) !important;
 color: #fff !important;
 border: none;
 padding: 8px 16px;
 border-radius: var(--radius, 8px);
 font-size: 14px;
 font-weight: 600;
 cursor: pointer;
 transition: all 0.2s;
}
.btn-editorial:hover { opacity: 0.9; transform: translateY(-1px); }
.editorial-section .gen-text-content {
 background: var(--accent-light);
 border: 1px solid var(--warning-border);
}
.editorial-stage-list {
 display: flex;
 flex-wrap: wrap;
 gap: 4px;
 align-items: center;
}
.editorial-stage-badge {
 font-size: 11px;
 padding: 2px 8px;
 border-radius: 100px;
 background: #f0f0f0;
 color: #999;
 border: 1px solid #e0e0e0;
 transition: all 0.3s;
}
.editorial-stage-badge.active {
 background: var(--accent);
 color: #fff;
 border-color: var(--accent);
 animation: editorialPulse 1.5s infinite;
}
.editorial-stage-badge.done {
 background: var(--success-bg);
 color: var(--success);
 border-color: var(--success-border);
}
.editorial-stage-badge.failed {
 background: #ffe0e0;
 color: #e74c3c;
 border-color: #ffc0c0;
 font-weight: 700;
}
.editorial-errors {
 margin-top: 8px;
 padding: 8px 12px;
 background: #fff5f5;
 border: 1px solid #ffe0e0;
 border-radius: 8px;
 max-height: 120px;
 overflow-y: auto;
}
.editorial-error-item {
 font-size: 12px;
 color: #c0392b;
 margin-bottom: 4px;
 line-height: 1.5;
}
.error-stage-name { font-weight: 700; color: #e74c3c; }
.error-stage-msg { color: #c0392b; }
@keyframes editorialPulse {
 0%,100% { opacity: 1; }
 50% { opacity: 0.6; }
}

/* 分析报告 */
.gen-editorial-analysis {
 margin-top: 16px;
 padding: 12px;
 background: #fafafa;
 border-radius: 8px;
 border: 1px solid #eee;
}
.analysis-bars {
 display: grid;
 grid-template-columns: 1fr 1fr;
 gap: 8px;
}
.analysis-bar-item {
 display: flex;
 align-items: center;
 gap: 8px;
 font-size: 12px;
}
.analysis-label {
 width: 80px;
 text-align: right;
 color: #666;
 flex-shrink: 0;
}
.analysis-bar-track {
 flex: 1;
 height: 10px;
 background: #eee;
 border-radius: 5px;
 overflow: hidden;
}
.analysis-bar-fill {
 height: 100%;
 border-radius: 5px;
 transition: width 0.5s;
}
.analysis-bar-fill.high { background: #e74c3c; }
.analysis-bar-fill.low { background: #27ae60; }
.analysis-value {
 width: 30px;
 color: #333;
 font-weight: 600;
 flex-shrink: 0;
}

@keyframes slideUp {
 from { transform: translateY(20px); opacity: 0; }
 to { transform: translateY(0); opacity: 1; }
}

/* ---- 写作人格 persona ---- */
.persona-desc {
 font-size: 12px;
 color: var(--text-tertiary);
 margin-bottom: 10px;
 line-height: 1.5;
}
.persona-grid {
 display: grid;
 grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
 gap: 8px;
}
.persona-card {
 padding: 10px 12px;
 border: 1px solid var(--card-border);
 border-radius: var(--radius);
 background: var(--card);
 cursor: pointer;
 transition: all var(--transition);
 display: flex;
 flex-direction: column;
 gap: 4px;
 min-height: 64px;
}
.persona-card:hover {
 border-color: var(--primary);
 box-shadow: 0 2px 8px rgba(63, 125, 90, 0.1);
}
.persona-card.selected {
 border-color: var(--primary);
 background: var(--primary-light);
}
.persona-card.disabled {
 opacity: 0.45;
}
.persona-card-head {
 display: flex;
 align-items: center;
 gap: 6px;
 flex-wrap: wrap;
}
.persona-name {
 font-size: 13px;
 font-weight: 600;
 color: var(--text);
}
.persona-tag {
 font-size: 10px;
 padding: 1px 6px;
 border-radius: 100px;
 font-weight: 600;
}
.persona-tag.sys { background: var(--info-bg); color: var(--info); }
.persona-tag.ai { background: var(--success-bg); color: var(--success); }
.persona-tag.ref { background: var(--warning-bg); color: var(--warning); }
.persona-card-desc {
 font-size: 11px;
 color: var(--text-tertiary);
 line-height: 1.4;
 overflow: hidden;
 text-overflow: ellipsis;
 display: -webkit-box;
 -webkit-line-clamp: 2;
 -webkit-box-orient: vertical;
}
.persona-add {
 align-items: center;
 justify-content: center;
 border-style: dashed;
 color: var(--text-tertiary);
 text-align: center;
}
.persona-add-icon {
 font-size: 22px;
 font-weight: 300;
}
.persona-add-text {
 font-size: 11px;
}
.persona-selected-info {
 margin-top: 10px;
 font-size: 12px;
 color: var(--text-secondary);
 display: flex;
 align-items: center;
 gap: 6px;
 flex-wrap: wrap;
}
.persona-override-badge {
 font-size: 10px;
 padding: 1px 6px;
 border-radius: 100px;
 background: var(--warning-bg);
 color: var(--warning);
 font-weight: 600;
}

/* persona 管理弹窗 */
.persona-modal-card {
 background: var(--card);
 border-radius: var(--radius-xl);
 padding: 20px;
 width: 100%;
 max-width: 640px;
 max-height: 85vh;
 display: flex;
 flex-direction: column;
 box-shadow: 0 20px 60px rgba(0,0,0,0.15);
 animation: slideUp 250ms var(--ease);
}
.persona-modal-head {
 display: flex;
 align-items: center;
 justify-content: space-between;
 margin-bottom: 14px;
}
.persona-modal-title {
 font-size: 16px;
 font-weight: 700;
 color: var(--text);
}
.persona-modal-body {
 flex: 1;
 overflow-y: auto;
 display: flex;
 flex-direction: column;
 gap: 12px;
}
.persona-toolbar {
 display: flex;
 gap: 8px;
 flex-wrap: wrap;
 align-items: center;
}
.persona-busy {
 font-size: 12px;
 color: var(--primary);
 display: inline-flex;
 align-items: center;
 gap: 6px;
}
.persona-ai-gen {
 padding: 10px 12px;
 background: var(--bg-secondary, #f5f5f5);
 border-radius: var(--radius);
 display: flex;
 flex-direction: column;
 gap: 8px;
}
.persona-ai-actions {
 display: flex;
 gap: 8px;
}
.persona-list {
 display: flex;
 flex-direction: column;
 gap: 8px;
}
.persona-list-item {
 padding: 10px 12px;
 border: 1px solid var(--card-border);
 border-radius: var(--radius);
 background: var(--card);
 cursor: pointer;
 transition: all var(--transition);
}
.persona-list-item.active {
 border-color: var(--primary);
 background: var(--primary-light);
}
.persona-list-head {
 display: flex;
 align-items: center;
 gap: 6px;
 flex-wrap: wrap;
 margin-bottom: 4px;
}
.persona-list-name {
 font-size: 13px;
 font-weight: 600;
 color: var(--text);
}
.persona-list-desc {
 font-size: 11px;
 color: var(--text-tertiary);
 line-height: 1.4;
 margin-bottom: 6px;
}
.persona-list-actions {
 display: flex;
 gap: 6px;
}
.btn-xs {
 padding: 3px 8px;
 font-size: 11px;
 border-radius: 6px;
}
.btn-danger {
 background: var(--error-bg, #ffe0e0);
 color: var(--error, #c0392b);
 border: 1px solid var(--error-border, #ffc0c0);
 cursor: pointer;
 font-family: inherit;
}
.btn-danger:hover { opacity: 0.85; }
.persona-edit-form {
 padding: 12px;
 background: var(--bg-secondary, #f5f5f5);
 border-radius: var(--radius);
 display: flex;
 flex-direction: column;
 gap: 8px;
}
.persona-edit-form .input,
.persona-edit-form .textarea {
 width: 100%;
 box-sizing: border-box;
}
.persona-edit-form .textarea {
 font-size: 12px;
 line-height: 1.6;
}
.persona-edit-actions {
 display: flex;
 gap: 8px;
 margin-top: 4px;
}
.label-sm {
 font-size: 12px;
 color: var(--text-secondary);
 font-weight: 500;
}

</style>
