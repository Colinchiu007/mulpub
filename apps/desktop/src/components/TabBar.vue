<template>
  <div class="tab-bar" data-testid="tab-bar" role="tablist" aria-label="标签页">
    <div class="tab-bar-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.tabId"
        type="button"
        class="tab-item"
        :class="{ active: tab.tabId === activeTabId, loading: tab.loading }"
        role="tab"
        :aria-selected="tab.tabId === activeTabId"
        :data-testid="`tab-${tab.tabId}`"
        @click="$emit('switch-tab', tab.tabId)"
      >
        <el-icon class="tab-icon" v-if="tab.isHome" aria-hidden="true"><HomeFilled /></el-icon>
        <img v-else-if="getPlatformIconUrl(tab)" :src="getPlatformIconUrl(tab)" class="tab-icon-img" :alt="getTabLabel(tab)" width="16" height="16" aria-hidden="true">
        <el-icon class="tab-icon" v-else aria-hidden="true"><Monitor /></el-icon>
        <span class="tab-title" :title="tab.title || tab.url">{{ tab.title || getTabLabel(tab) }}</span>
        <span v-if="tab.loading" class="tab-spinner" aria-hidden="true">⟳</span>
        <span
          v-if="tab.credentialSaveState === 'unsaved'"
          class="tab-unsaved-dot"
          :data-testid="`tab-unsaved-${tab.tabId}`"
          :title="t('tabBar.unsavedBadge')"
          :aria-label="t('tabBar.unsavedBadge')"
          role="img"
        ></span>
        <button
          v-if="!tab.isHome"
          type="button"
          class="tab-close"
          aria-label="关闭标签页"
          :data-testid="`tab-close-${tab.tabId}`"
          @click.stop="$emit('close-tab', tab.tabId)"
        >
          ×
        </button>
      </button>
    </div>
    <button
      type="button"
      class="tab-add"
      aria-label="新建标签页"
      data-testid="tab-add"
      title="新建标签页"
      @click="$emit('create-tab')"
    >
      +
    </button>
  </div>
</template>

<script setup>
import { HomeFilled, Monitor } from '@element-plus/icons-vue'
import { useTabStore } from '@/stores/tab'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { getPlatformIconUrl } from '@/composables/usePlatformIconUrl'

const { t } = useI18n()

defineProps({})

defineEmits(['switch-tab', 'close-tab', 'create-tab'])

const tabStore = useTabStore()
const { tabs, activeTabId } = storeToRefs(tabStore)


  function getTabLabel(tab) {
    if (tab.isHome) return '首页'
    if (tab.title && tab.title.trim() && tab.title !== 'New Tab') return tab.title
    if (!tab.url || tab.url === 'about:blank') return '新标签页'
    try {
      const url = new URL(tab.url)
      return url.hostname
    } catch {
      return tab.url
    }
  }
</script>

<style scoped>
.tab-bar {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  height: 36px;
  background: #e8eaf2;
  border-bottom: 1px solid #d5d7e0;
  padding: 0;
  user-select: none;
  -webkit-app-region: no-drag;
}

.tab-bar-tabs {
  flex: 1;
  display: flex;
  align-items: stretch;
  gap: 1px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 4px 0 0;
}

.tab-bar-tabs::-webkit-scrollbar {
  display: none;
}

.tab-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  min-width: 100px;
  max-width: 200px;
  padding: 0 8px 0 12px;
  border: none;
  border-radius: 8px 8px 0 0;
  background: transparent;
  color: #6b7280;
  font-size: var(--font-size-xs);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

.tab-item:hover {
  background: #d1d5db;
  color: #374151;
}

.tab-item.active {
  background: var(--color-bg-card);
  color: #1f2937;
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.tab-icon {
  flex-shrink: 0;
  font-size: var(--font-size-sm);
}

.tab-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.tab-spinner {
  flex-shrink: 0;
  animation: spin 1s linear infinite;
  font-size: var(--font-size-xs);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.tab-close {
  flex-shrink: 0;
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #9ca3af;
  font-size: var(--font-size-sm);
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.tab-close:hover {
  background: #e5e7eb;
  color: #374151;
}

.tab-unsaved-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.25);
}

.tab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin: 2px 6px 0 2px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #6b7280;
  font-size: var(--font-size-md);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.tab-add:hover {
  background: #d1d5db;
  color: #374151;
}
</style>
