<template>
  <div class="workbench">
    <!-- 左：章节栏（纯手动收起，不受窗口尺寸影响） -->
    <aside class="wb-chapters" :class="{ collapsed: chaptersCollapsed }" :style="chaptersStyle">
      <button
        v-if="chaptersCollapsed"
        class="reopen"
        :title="$t('desktop.workbench.expandChaptersTip')"
        @click="toggleChapters"
      >›</button>

      <template v-else>
        <div class="wb-head">
          <button class="icon-btn" :title="$t('desktop.workbench.collapseChaptersTip')" @click="toggleChapters">‹</button>
          <span class="wb-title">{{ title || $t('desktop.workbench.title') }}</span>
        </div>
        <div class="wb-search">
          <input v-model.trim="keyword" class="wb-input" :placeholder="$t('desktop.workbench.chapterSearch')" />
        </div>
        <div class="wb-body">
          <slot name="chapters" :keyword="keyword" />
        </div>
        <div class="wb-foot">
          <slot name="chaptersFooter" />
        </div>
      </template>
    </aside>

    <!-- 中：正文 / 页面主体 -->
    <div class="wb-main">
      <slot />
    </div>

    <!-- 右：检查器（页签记忆） -->
    <aside class="wb-inspector">
      <div class="wb-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="wb-tab"
          :class="{ active: inspectorTab === tab.key }"
          @click="setInspectorTab(tab.key)"
        >{{ tab.label }}</button>
      </div>
      <div class="wb-inspector-body">
        <slot name="inspector" :tab="inspectorTab" />
      </div>
    </aside>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from '@client/composables/useI18n'
import { useDesktopPrefs } from '../composables/useDesktopPrefs'

const props = defineProps({
  title: { type: String, default: '' },
})

const { $t } = useI18n()
const { chaptersCollapsed, chaptersWidth, toggleChapters, inspectorTab, setInspectorTab } = useDesktopPrefs()

// 页签文案随语言切换（用 computed 而不是常量，否则切换语言不会重新渲染）
const tabs = computed(() => [
  { key: 'context', label: $t('desktop.workbench.tabContext') },
  { key: 'usage', label: $t('desktop.workbench.tabUsage') },
  { key: 'quality', label: $t('desktop.workbench.tabQuality') },
])

const keyword = ref('')
const chaptersStyle = computed(() => (chaptersCollapsed.value ? {} : { width: `${chaptersWidth.value}px`, flexBasis: `${chaptersWidth.value}px` }))
</script>

<style scoped>
.workbench {
  height: 100%;
  display: flex;
  min-height: 0;
  background: var(--bg);
}

/* 章节栏 */
.wb-chapters {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--card);
  border-right: 1px solid var(--card-border);
  transition: width var(--transition), flex-basis var(--transition);
}
.wb-chapters.collapsed { width: 0 !important; flex-basis: 0 !important; border-right: 0; overflow: hidden; }
.wb-chapters .reopen {
  position: absolute; top: 12px; left: 0; z-index: 20;
  width: 22px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--card-border); border-left: 0;
  border-radius: 0 6px 6px 0;
  background: var(--card); color: var(--text-tertiary); cursor: pointer;
}
.wb-head {
  height: 44px; flex: 0 0 44px;
  display: flex; align-items: center; gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid var(--card-border);
}
.wb-title { font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon-btn {
  width: 26px; height: 26px; flex: 0 0 26px;
  display: grid; place-items: center;
  border: 1px solid var(--card-border); border-radius: var(--radius);
  background: var(--card); color: var(--text-secondary); cursor: pointer;
}
.icon-btn:hover { background: var(--bg-alt); }
.wb-search { padding: 8px 10px; }
.wb-input {
  width: 100%; padding: 6px 9px;
  border: 1px solid var(--card-border); border-radius: var(--radius);
  background: var(--bg); font-family: inherit; font-size: 12.5px; color: var(--text);
}
.wb-body { flex: 1; overflow: auto; min-height: 0; padding: 0 6px 8px; }
.wb-foot { padding: 9px; border-top: 1px solid var(--card-border); }

/* 主区 */
.wb-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.wb-main > :deep(*) { flex: 1; min-height: 0; }

/* 检查器 */
.wb-inspector {
  width: 320px; flex: 0 0 320px;
  display: flex; flex-direction: column;
  min-height: 0;
  background: var(--card);
  border-left: 1px solid var(--card-border);
}
.wb-tabs { display: flex; border-bottom: 1px solid var(--card-border); }
.wb-tab {
  flex: 1; padding: 10px 0;
  border: 0; background: transparent;
  color: var(--text-tertiary); font-family: inherit; font-size: 12px; cursor: pointer;
}
.wb-tab.active { color: var(--primary); font-weight: 600; box-shadow: inset 0 -2px 0 var(--primary); }
.wb-inspector-body { flex: 1; overflow: auto; min-height: 0; padding: 12px; }

@media (max-width: 1200px) {
  .wb-inspector { display: none; }
}
</style>
