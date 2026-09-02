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
 <div class="type-grid">
 <div v-for="cat in currentCats" :key="cat.name" class="type-card" :class="{ selected: selectedType === cat.name, locked: generationBusy }" @click="!generationBusy && (selectedType = cat.name)">
 <span class="type-icon">{{ cat.icon }}</span>
 <span class="type-name">{{ $tn(cat.name) }}</span>
 </div>
 </div>
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
     <span class="persona-name">{{ p.name }}</span>
     <span v-if="p.isSystem" class="persona-tag sys">{{ $t('generate.personaSys') }}</span>
     <span v-else-if="p.source === 'ai-generated'" class="persona-tag ai">AI</span>
   </div>
   <div class="persona-card-desc">{{ p.description || p.voice?.slice(0, 40) }}</div>
 </div>
 <div class="persona-card persona-add" :class="{ locked: generationBusy }" @click="!generationBusy && (showPersonaModal = true)">
   <span class="persona-add-icon">＋</span>
   <span class="persona-add-text">{{ $t('generate.personaManage') }}</span>
 </div>
</div>
<div v-if="selectedPersona" class="persona-selected-info">
 <span class="persona-selected-label">{{ $t('generate.personaCurrent') }}：</span>
 <strong>{{ selectedPersona.name }}</strong>
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
  <div class="section-title"> 初始故事蓝图</div>
  <div class="blueprint-setup-desc">在开始整本生成前，先把主线阶段、人物支线和可能的反转确认下来。AI 只会提出方案，确认后才用于正文。</div>
  <div class="blueprint-setup-actions">
   <button class="btn btn-secondary btn-sm" :disabled="generating || blueprintGenerating || !outline.trim()" :aria-busy="blueprintGenerating" @click="generateInitialBlueprint">{{ blueprintGenerating ? ' 正在规划蓝图...' : (initialBlueprint ? ' 重新生成蓝图' : ' 生成初始蓝图') }}</button>
   <span v-if="initialBlueprintConfirmed" class="blueprint-confirmed"> 已确认，将用于本次生成</span>
  </div>
  <div v-if="blueprintGenerating && blueprintReasoningText && !initialBlueprintJson" ref="blueprintReasoningRef" class="stream-reasoning-box">{{ blueprintReasoningText }}</div>
  <textarea v-if="initialBlueprintJson" ref="blueprintJsonTextarea" v-model="initialBlueprintJson" :disabled="generating || blueprintGenerating" class="textarea blueprint-json-editor" rows="10" placeholder="蓝图 JSON"></textarea>
  <div v-if="initialBlueprintJson && !initialBlueprintConfirmed" class="blueprint-setup-actions">
   <button class="btn btn-primary btn-sm" :disabled="generating || blueprintGenerating" @click="confirmInitialBlueprint">确认蓝图并继续</button>
   <span class="blueprint-setup-hint">可直接编辑上方 JSON 后确认</span>
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
 <span class="chapter-words-title">每章字数</span>
 <input v-model.number="chapterWordTarget" class="input" :disabled="generationBusy" type="number" min="2000" max="20000" step="500" />
 <span class="unit">字/章</span>
 </label>
 <div class="word-count-presets">
 <span v-for="p in chapterWordPresets" :key="p.value" class="preset-btn" :class="{ active: chapterWordTarget === p.value, locked: generationBusy }" @click="!generationBusy && (chapterWordTarget = p.value)">{{ p.label }}</span>
 </div>
 <div class="chapter-words-hint">预计约 {{ estimatedChapters }} 章{{ chapterWordTarget >= 6000 ? ' · 大章节奏：每章承载完整的线索链与冲突推进' : '' }}</div>
 </div>
 <label class="expert-mode-toggle">
 <input type="checkbox" v-model="expertMode" :disabled="generationBusy" />
 <span><strong>{{ $t('generate.expertMode') }}</strong><small>{{ $t('generate.expertModeDesc') }}</small></span>
 </label>
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
 累计 token：输入 {{ formatTokenCount(generationTokenUsage.inputTokens) }} / 输出 {{ formatTokenCount(generationTokenUsage.outputTokens) }}<span v-if="generationTokenUsage.cacheSavedTokens > 0">（缓存命中 {{ formatTokenCount(generationTokenUsage.cacheSavedTokens) }}）</span>
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
 <div class="gen-text-label">AI特征分析报告</div>
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
     <span v-if="personaBusy" class="persona-busy"><span class="spinner" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></span> {{ personaStatus || '处理中...' }}</span>
   </div>

   <!-- AI 生成输入区 -->
   <div v-if="aiGenInput.novelType !== '' || personaStatus" class="persona-ai-gen">
     <div class="label-sm">AI 生成写作人格</div>
     <input v-model="aiGenInput.novelType" class="input" placeholder="想写的小说类型，如：玄幻修仙、甜宠言情" />
     <textarea v-model="aiGenInput.hint" class="textarea" rows="2" placeholder="额外要求（可选），如：节奏紧凑、第一人称"></textarea>
     <div class="persona-ai-actions">
       <button class="btn btn-sm btn-primary" :disabled="personaBusy" @click="aiGeneratePersona">{{ $t('generate.personaAIGen') }}</button>
       <button class="btn btn-sm btn-secondary" @click="aiGenInput = { novelType: '', hint: '' }; personaStatus=''">{{ $t('common.cancel') }}</button>
     </div>
   </div>

   <!-- 列表 -->
   <div class="persona-list">
     <div v-for="p in personas" :key="p._id" class="persona-list-item" :class="{ active: selectedPersonaId === p._id }" @click="selectPersona(p)">
       <div class="persona-list-head">
         <span class="persona-list-name">{{ p.name }}</span>
         <span v-if="p.isSystem" class="persona-tag sys">{{ $t('generate.personaSys') }}</span>
         <span v-else-if="p.source === 'ai-generated'" class="persona-tag ai">AI</span>
       </div>
       <div class="persona-list-desc">{{ p.description || p.voice?.slice(0, 60) }}</div>
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
 <p class="outline-modal-desc">{{ outlineStreaming ? 'AI 正在实时生成大纲，完成后可编辑与确认…' : $t('generate.outlineDesc') }}</p>
 <div v-if="outlineStreaming && outlineReasoningText && !outlineModalText" ref="outlineReasoningRef" class="stream-reasoning-box">{{ outlineReasoningText }}</div>
 <textarea ref="outlineModalTextarea" v-model="outlineModalText" class="outline-modal-textarea" rows="12" @input="onOutlineInput"></textarea>
 <div v-if="outlineTokenUsage" class="outline-modal-token">{{ tokenUsageText(outlineTokenUsage) }}</div>
 <div class="outline-modal-actions">
 <button class="btn btn-secondary" @click="outlineReject()">{{ $t('common.cancel') }}</button>
 <button class="btn btn-primary" :disabled="outlineStreaming" @click="outlineConfirm()">{{ outlineStreaming ? '生成中…' : $t('generate.outlineConfirm') }}</button>
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
import { useI18n } from '../composables/useI18n'
import api from '../api'

const router = useRouter()
const novelStore = useNovelStore()
const authStore = useAuthStore()
const personaStore = usePersonaStore()
const { $t } = useI18n()

const streamRef = ref(null)

// ---- Tab ----
const activeTab = ref('generate')

// ---- 生成 ----
const gender = ref('male')
const selectedType = ref('')

const fullTypes = ref({ male: [], female: [] })
const currentCats = computed(() => fullTypes.value[gender.value] || [])

const protagonistName = ref('')
const worldSetting = ref('')
const outline = ref('')
const genMode = ref('book')
const targetWordCount = ref(50000)
// 每章字数（整本模式）：影响大纲规模、章节计划与每章输出预算。
const chapterWordTarget = ref(3000)
const expertMode = ref(false)
const initialBlueprint = ref(null)
const initialBlueprintJson = ref('')
const initialBlueprintConfirmed = ref(false)
const blueprintGenerating = ref(false)
const blueprintSetupError = ref('')
const blueprintWarning = ref('')

// ---- 写作人格 persona ----
const personas = ref([])
const selectedPersonaId = ref('')
const selectedPersona = computed(() => personas.value.find(p => p._id === selectedPersonaId.value) || null)
const showPersonaModal = ref(false)
// persona 编辑表单
const editingPersona = ref(null)
const personaForm = ref({ name: '', description: '', voice: '', tone: '', rules: '', vocab: '', overrideDeslop: false, applicableTypes: [] })
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
 personaForm.value = p
   ? { name: p.name, description: p.description, voice: p.voice, tone: p.tone, rules: p.rules, vocab: p.vocab, overrideDeslop: p.overrideDeslop, applicableTypes: p.applicableTypes || [] }
   : { name: '', description: '', voice: '', tone: '', rules: '', vocab: '', overrideDeslop: false, applicableTypes: [] }
}

async function savePersona() {
 const f = personaForm.value
 if (!f.name.trim()) return alert('请填写模板名称')
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
   alert(e.response?.data?.message || e.message || '保存失败')
 } finally {
   personaBusy.value = false
 }
}

async function deletePersona(p) {
 if (!confirm(`确认删除「${p.name}」？`)) return
 try {
   await personaStore.remove(p._id)
   personas.value = personaStore.personas
   if (selectedPersonaId.value === p._id) selectedPersonaId.value = ''
 } catch (e) {
   alert(e.response?.data?.message || e.message || '删除失败')
 }
}

async function clonePersona(p) {
 try {
   await personaStore.clone(p._id)
   personas.value = personaStore.personas
 } catch (e) {
   alert(e.response?.data?.message || e.message || '克隆失败')
 }
}

async function aiGeneratePersona() {
 if (!aiGenInput.value.novelType.trim()) return alert('请输入想写的小说类型')
 personaBusy.value = true
 personaStatus.value = 'AI 正在生成写作人格...'
 try {
   await personaStore.aiGenerate(aiGenInput.value.novelType, aiGenInput.value.hint)
   personas.value = personaStore.personas
   aiGenInput.value = { novelType: '', hint: '' }
   personaStatus.value = ''
 } catch (e) {
   personaStatus.value = ''
   alert(e.response?.data?.message || e.message || 'AI 生成失败')
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
  { id: 'persona', name: '人格', active: false, done: false, error: false, errorMsg: '' },
  { id: 'structural', name: '结构重构', active: false, done: false, error: false, errorMsg: '' },
  { id: 'polish', name: '风格一致性', active: false, done: false, error: false, errorMsg: '' },
  { id: 'deAI', name: '去AI化', active: false, done: false, error: false, errorMsg: '' },
])
const editorialStageErrors = computed(() => editorialStages.value.filter(s => s.error))

const analysisLabelMap = {
  explain: '解释型语言', sentence: '平均句式', repeat: '重复结构', flow: '流水账',
  dialogue: '对话模板化', environment: '环境重复', transition: 'AI连接词',
  summary: '总结结尾', worldbuilding: '世界观说明', psychology: '心理单一',
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
 if (number >= 10000) return `${(number / 10000).toFixed(1)}万`
 if (number >= 1000) return `${(number / 1000).toFixed(1)}k`
 return String(number)
}
function tokenUsageText(usage) {
 if (!usage) return ''
 return `消耗：输入 ${formatTokenCount(usage.inputTokens)} / 输出 ${formatTokenCount(usage.outputTokens)} token`
}

// 大纲生成改为 SSE 流式：弹窗立即打开，实时展示思考/正文内容并自动滚动到最新位置，
// 不再等待整个响应（思考模型耗时可达数十分钟，XHR 无超时限制）。
function showOutlineModal(selectedTypeId, charName, worldSetting, wordCount, perChapterWords) {
 return new Promise((resolve) => {
 outlineModalText.value = ''
 outlineTokenUsage.value = null
 outlineReasoningText.value = ''
 outlineUserEdited.value = false
 outlineStreaming.value = true
 genStatus.value = $t('generate.outlineGenerating')
 outlineModal.value = true

 const payload = {
 novelTypeId: selectedTypeId,
 protagonistName: charName,
 worldSetting: worldSetting,
 targetWordCount: wordCount,
 chapterWordTarget: perChapterWords || undefined,
 personaId: selectedPersonaId.value || undefined,
 }

 const token = localStorage.getItem('token')
 const xhr = new XMLHttpRequest()
 outlineXhr = xhr
 xhr.open('POST', '/api/novel/generate-outline')
 xhr.setRequestHeader('Authorization', `Bearer ${token}`)
 xhr.setRequestHeader('Content-Type', 'application/json')
 let lastIndex = 0
 let sseBuffer = ''

 xhr.onprogress = () => {
 sseBuffer += xhr.responseText.substring(lastIndex)
 lastIndex = xhr.responseText.length
 const lines = sseBuffer.split('\n')
 sseBuffer = lines.pop()
 for (const line of lines) {
 if (!line.startsWith('data: ')) continue
 try {
 const event = JSON.parse(line.substring(6))
 if (event.type === 'reasoning') {
 appendReasoning(outlineReasoningText, event.content)
 scrollReasoningBox(outlineReasoningRef)
 } else if (event.type === 'content') {
 outlineModalText.value += event.content
 scrollOutlineToBottom()
 } else if (event.type === 'completed') {
 // 用户未手动编辑时用最终结果整体覆盖（清掉失败重试可能残留的片段）
 if (!outlineUserEdited.value) outlineModalText.value = event.outline || outlineModalText.value
 outlineTokenUsage.value = event.tokenUsage || null
 outlineStreaming.value = false
 scrollOutlineToBottom()
 } else if (event.type === 'error') {
 outlineStreaming.value = false
 genStatus.value = event.message || '大纲生成失败'
 }
 } catch {}
 }
 }

 xhr.onloadend = () => {
 outlineStreaming.value = false
 outlineXhr = null
 if (!outlineModalText.value.trim()) {
 outlineModal.value = false
 genStatus.value = ''
 resolve(null)
 }
 }
 xhr.onerror = () => { outlineStreaming.value = false; genStatus.value = '大纲生成失败，请稍后重试' }
 xhr.send(JSON.stringify(payload))

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
  blueprintSetupError.value = '请先选择小说类型并确认大纲'
  return
 }
 blueprintGenerating.value = true
 blueprintSetupError.value = ''
 blueprintWarning.value = ''
 blueprintReasoningText.value = ''
 initialBlueprintConfirmed.value = false
 initialBlueprintJson.value = ''
 initialBlueprint.value = null

 const token = localStorage.getItem('token')
 const xhr = new XMLHttpRequest()
 blueprintXhr = xhr
 xhr.open('POST', '/api/novel/generate-blueprint')
 xhr.setRequestHeader('Authorization', `Bearer ${token}`)
 xhr.setRequestHeader('Content-Type', 'application/json')
 let lastIndex = 0
 let sseBuffer = ''

 xhr.onprogress = () => {
 sseBuffer += xhr.responseText.substring(lastIndex)
 lastIndex = xhr.responseText.length
 const lines = sseBuffer.split('\n')
 sseBuffer = lines.pop()
 for (const line of lines) {
 if (!line.startsWith('data: ')) continue
 try {
 const event = JSON.parse(line.substring(6))
 if (event.type === 'reasoning') {
 appendReasoning(blueprintReasoningText, event.content)
 scrollReasoningBox(blueprintReasoningRef)
 } else if (event.type === 'content') {
 initialBlueprintJson.value += event.content
 scrollBlueprintToBottom()
 } else if (event.type === 'completed') {
 initialBlueprint.value = event.blueprint || null
 initialBlueprintJson.value = JSON.stringify(initialBlueprint.value, null, 2)
 blueprintWarning.value = event.warning || ''
 blueprintTokenUsage.value = event.tokenUsage || null
 blueprintGenerating.value = false
 scrollBlueprintToBottom()
 } else if (event.type === 'error') {
 blueprintSetupError.value = event.message || '初始蓝图生成失败'
 blueprintGenerating.value = false
 }
 } catch {}
 }
 }

 xhr.onloadend = () => { blueprintGenerating.value = false; blueprintXhr = null }
 xhr.onerror = () => { blueprintSetupError.value = '初始蓝图生成失败，请稍后重试'; blueprintGenerating.value = false }
 xhr.send(JSON.stringify({
  novelTypeId: selectedType.value,
  protagonistName: protagonistName.value,
  worldSetting: worldSetting.value,
  targetWordCount: targetWordCount.value,
  chapterWordTarget: chapterWordTarget.value,
  outline: outline.value,
  personaId: selectedPersonaId.value || undefined,
 }))
}

function confirmInitialBlueprint() {
 try {
  const parsed = JSON.parse(initialBlueprintJson.value)
  if (!parsed || !Array.isArray(parsed.phases) || !parsed.phases.length) throw new Error('至少需要一个剧情阶段')
  initialBlueprint.value = parsed
  initialBlueprintConfirmed.value = true
  blueprintSetupError.value = ''
 } catch (e) {
  initialBlueprintConfirmed.value = false
  blueprintSetupError.value = `蓝图格式无效：${e.message}`
 }
}

function outlineConfirm() {
 if (outlineConfirmCallback) outlineConfirmCallback()
}
function outlineReject() {
 if (outlineRejectCallback) outlineRejectCallback()
}

const maxWordCount = computed(() => genMode.value === 'chapter' ? 20000 : 10000000)

const chapterWordPresets = [
 { label: '3000字/章', value: 3000 },
 { label: '5000字/章', value: 5000 },
 { label: '8000字/章', value: 8000 },
 { label: '10000字/章', value: 10000 },
]

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
 if (genMode.value === 'book') return [{ label: '5万字', value: 50000 }, { label: '10万字', value: 100000 }, { label: '30万字', value: 300000 }, { label: '50万字', value: 500000 }]
 return [{ label: '1000字', value: 1000 }, { label: '2000字', value: 2000 }, { label: '3000字', value: 3000 }, { label: '5000字', value: 5000 }]
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
  genStatus.value = blueprintSetupError.value || '请确认初始故事蓝图后再开始生成'
  preparingGeneration.value = false
  return
 }

 preparingGeneration.value = false
 generating.value = true; genStatus.value = ''; genOk.value = false
 streamingText.value = ''; outlineStreamingText.value = ''
 rawStreamingText.value = ''
 generatedNovelId.value = ''; generatedChapterNumber.value = 0
 generatedApplyBusy.value = false; generatedApplyMessage.value = ''
 showGenModal.value = true
 genModalTitle.value = `${selectedType.value} - ${protagonistName.value || '未命名'}`
 deslopDone.value = false; deslopText.value = ''; deslopRunning.value = false; diffHtml.value = ''
 editorialDone.value = false; editorialText.value = ''; editorialRunning.value = false; editorialAnalysis.value = null
 editorialStages.value.forEach(s => { s.active = false; s.done = false; s.error = false; s.errorMsg = '' })

 const params = {
 novelTypeId: selectedType.value,
 protagonistName: protagonistName.value,
 worldSetting: worldSetting.value,
 targetWordCount: targetWordCount.value,
 chapterWordTarget: genMode.value === 'book' ? chapterWordTarget.value : undefined,
 mode: genMode.value,
 expertMode: expertMode.value,
 outline: outline.value,
 personaId: selectedPersonaId.value || undefined,
 storyBlueprint: genMode.value === 'book' ? initialBlueprint.value : undefined,
 }

 novelStore.startGeneration(params,
 (chunk) => { rawStreamingText.value += chunk; streamingText.value += chunk; scrollToBottom() },
 (event) => {
 if (event.type === 'outline') {
 outlineStreamingText.value = event.content
 if (event.tokenUsage) outlineTokenUsage.value = event.tokenUsage
 } else if (event.type === 'novel_created') {
 genStatus.value = '大纲生成中...'
 generatedNovelId.value = event.novelId || generatedNovelId.value
 } else if (event.type === 'chapter_end') {
 generatedChapterNumber.value = Number(event.chapterNumber || generatedChapterNumber.value)
 } else if (event.type === 'token_usage') {
 // 累计 token 用量：不覆盖主状态文案，只更新用量徽标。
 generationTokenUsage.value = event.usage || null
 } else if (event.type === 'status') {
 genStatus.value = event.message
 } else if (event.type === 'chapter_start') {
 genStatus.value = `正在生成 ${event.title || '第' + event.chapterNumber + '章'}...`
 } else if (event.type === 'thinking') {
  genStatus.value = `模型正在整理本章结构（已处理 ${event.length || 0} 个思考单位）...`
 } else if (event.type === 'quality_notice') {
 const issues = event.report?.issues?.join('；') || '章节存在连贯性风险，已记录供后续章节参考'
 genStatus.value = `第${event.chapterNumber}章质量提示：${issues}`
 } else if (event.type === 'humanized') {
 // 服务器返回改写后文本，替换显示
 streamingText.value = event.content
 genStatus.value = `第${event.chapterNumber}章改写完成`
 scrollToBottom()
 } else if (event.type === 'expert_revision') {
  streamingText.value = event.content || streamingText.value
  genStatus.value = `第${event.chapterNumber}章已完成专家复核`
  scrollToBottom()
 } else if (event.type === 'completed') {
 genStatus.value = '生成完成！'; genOk.value = true; generating.value = false
 } else if (event.type === 'paused') {
 genStatus.value = '️ 已暂停'; generating.value = false
 } else if (event.type === 'token_exhausted') {
 genStatus.value = '生成已停止'; generating.value = false
 } else if (event.type === 'plan_needs_extension') {
 genStatus.value = event.message || '章节计划需要扩展'; generating.value = false
} else if (event.type === 'error') {
 genStatus.value = ' ' + (event.message || '生成失败'); generating.value = false
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
 deslopStatus.value = '正在去AI化...'

 const token = localStorage.getItem('token')
 const xhr = new XMLHttpRequest()
 xhr.open('POST', '/api/novel/deslop-stream')
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
 if (event.type === 'content') {
 deslopText.value += event.content
 nextTick(() => { if (deslopStreamRef.value) deslopStreamRef.value.scrollTop = deslopStreamRef.value.scrollHeight })
 } else if (event.type === 'status') {
 deslopStatus.value = event.message
 } else if (event.type === 'completed') {
 deslopText.value = event.content || deslopText.value
 deslopDone.value = true; deslopRunning.value = false
 deslopStatus.value = '去AI化完成'
 computeDiff()
 } else if (event.type === 'error') {
 deslopStatus.value = event.message || '去AI化失败'; deslopRunning.value = false
 }
 } catch {}
 }
 }

 xhr.onloadend = () => {
 if (deslopRunning.value) { deslopDone.value = true; deslopRunning.value = false; deslopStatus.value = '去AI化完成'; computeDiff() }
 }
 xhr.onerror = () => { deslopStatus.value = '去AI化失败'; deslopRunning.value = false }
 xhr.send(JSON.stringify({ text: streamingText.value, novelId: generatedNovelId.value || undefined }))
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

 if (!confirm(
 `确认执行编辑引擎？\n\n` +
 `文本长度：${textLen} 字\n` +
 `处理阶段（3次AI调用）：\n` +
 `  ⓪ 作者人格（本地生成）\n` +
 `  ① 结构重构（压缩+节奏+人物）\n` +
 `  ② 风格一致性（润色+一致性检查）\n` +
 `  ③ 去AI化（最终，注入人类特征）\n\n` +
 `预计耗时：约 ${estTimeMin} 分钟\n\n` +
 `去AI化放在最后一步，\n` +
 `避免后续润色重新引入AI特征。\n` +
 `处理期间请勿关闭页面。`
 )) return

 editorialRunning.value = true; editorialDone.value = false; editorialText.value = ''; editorialAnalysis.value = null
 // 重置阶段状态
 editorialStages.value.forEach(s => { s.active = false; s.done = false; s.error = false; s.errorMsg = '' })

 const token = localStorage.getItem('token')
 const xhr = new XMLHttpRequest()
 xhr.open('POST', '/api/novel/editorial-stream')
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
 if (event.type === 'content') {
 editorialText.value += event.content
 nextTick(() => { if (editorialStreamRef.value) editorialStreamRef.value.scrollTop = editorialStreamRef.value.scrollHeight })
 } else if (event.type === 'status') {
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
 } else if (event.type === 'completed') {
 editorialText.value = event.content || editorialText.value
 editorialAnalysis.value = event.analysis || null
 editorialDone.value = true; editorialRunning.value = false
 editorialStages.value.forEach(s => { if (!s.error) { s.done = true; s.active = false } })
 } else if (event.type === 'error') {
 editorialRunning.value = false
 alert(event.message || '编辑引擎处理失败')
 }
 } catch {}
 }
 }

 xhr.onloadend = () => {
 if (editorialRunning.value) {
 editorialDone.value = true; editorialRunning.value = false
 editorialStages.value.forEach(s => { if (!s.error) { s.done = true; s.active = false } })
 }
 }
 xhr.onerror = () => { editorialRunning.value = false; alert('编辑引擎请求失败') }
 xhr.send(JSON.stringify({ text: streamingText.value, novelId: generatedNovelId.value || undefined }))
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
 if (lnGenMode.value === 'book') return [{ label: '5万字', value: 50000 }, { label: '10万字', value: 100000 }, { label: '30万字', value: 300000 }, { label: '50万字', value: 500000 }]
 return [{ label: '1000字', value: 1000 }, { label: '2000字', value: 2000 }, { label: '3000字', value: 3000 }, { label: '5000字', value: 5000 }]
})

async function startLNGen() {
 if (!lnSelectedType.value) return alert('请选择轻小说类型')

 // 轻小说整本模式：先生成大纲
 let lnOutline = ''
 if (lnGenMode.value === 'book') {
 const lnTypeObj = lnTypes.find(t => t.id === lnSelectedType.value)
 const lnName = lnTypeObj?.name || ''
 const lnChar = (lnCharName.value + (lnCharTrait.value ? `（${lnCharTrait.value}属性）` : '')).trim() || '未命名'
 const lnWorld = lnWorldSetting.value || `${lnName}题材的日式轻小说世界`
 const confirmedOutline = await showOutlineModal(lnSelectedType.value, lnChar, lnWorld, lnTargetWordCount.value)
 if (!confirmedOutline) return
 lnOutline = confirmedOutline
 }

 lnGenerating.value = true; lnStatus.value = ''; lnOk.value = false
 lnStreamingText.value = ''

 const traitDesc = lnCharTrait.value ? `（${lnCharTrait.value}属性）` : ''
 const params = {
 novelTypeId: lnSelectedType.value,
 protagonistName: (lnCharName.value + traitDesc).trim() || '未命名',
 worldSetting: lnWorldSetting.value || (() => {
 const type = lnTypes.find(t => t.id === lnSelectedType.value)
 return type ? `${type.name}题材的日式轻小说世界` : '日式轻小说世界'
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
 lnStatus.value = '大纲生成中...'
 } else if (event.type === 'novel_created') {
 lnStatus.value = '大纲生成中...'
 } else if (event.type === 'status') {
 lnStatus.value = event.message
 } else if (event.type === 'chapter_start') {
 lnStatus.value = `正在生成 ${event.title || '第' + event.chapterNumber + '章'}...`
 } else if (event.type === 'thinking') {
  lnStatus.value = `模型正在整理本章结构（已处理 ${event.length || 0} 个思考单位）...`
 } else if (event.type === 'quality_notice') {
 const issues = event.report?.issues?.join('；') || '章节存在连贯性风险，已记录供后续章节参考'
 lnStatus.value = `第${event.chapterNumber}章质量提示：${issues}`
 } else if (event.type === 'expert_revision') {
  lnStreamingText.value = event.content || lnStreamingText.value
  lnStatus.value = `第${event.chapterNumber}章已完成专家复核`
 } else if (event.type === 'completed') {
 lnStatus.value = '生成完成！'; lnOk.value = true; lnGenerating.value = false
 } else if (event.type === 'paused') {
 lnStatus.value = '⏸️ 已暂停'; lnGenerating.value = false
 } else if (event.type === 'token_exhausted') {
 lnStatus.value = '生成已停止'; lnGenerating.value = false
 } else if (event.type === 'plan_needs_extension') {
 lnStatus.value = event.message || '章节计划需要扩展'; lnGenerating.value = false
} else if (event.type === 'error') {
 lnStatus.value = ' ' + (event.message || '生成失败'); lnGenerating.value = false
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
