<template>
  <div class="tab-bar" data-testid="tab-bar">
    <!-- 全局左侧菜单收起/展开（PRD-SIDEBAR-COLLAPSE-TOGGLE-2026-10-18）：
         固定在最左侧、位于标签滚动区之外 —— 标签再多、横向滚动也滚不掉它；
         与 TabBar 同高（36px），不新增行高 ⇒ WebContentsView TOP=76px 契约不变。 -->
    <SidebarToggleButton :collapsed="sidebarCollapsed" @toggle="toggleSidebarCollapse" />
    <div class="tab-bar-tabs" role="tablist" aria-label="标签页">
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
        <span
          v-if="tab.loading"
          class="tab-spinner"
          role="img"
          :title="t('common.loading')"
          :aria-label="t('common.loading')"
          :data-testid="`tab-loading-${tab.tabId}`"
        ><SpinnerIcon :size="12" /></span>
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
import SpinnerIcon from './icons/SpinnerIcon.vue'
import SidebarToggleButton from './SidebarToggleButton.vue'
import { sidebarCollapsed, toggleSidebarCollapse } from '@/stores/sidebar-collapse'

const { t } = useI18n()

defineProps({})

defineEmits(['switch-tab', 'close-tab', 'create-tab'])

const tabStore = useTabStore()
const { tabs, activeTabId } = storeToRefs(tabStore)


  function getTabLabel(tab) {
    // 标签文字一律走 locales：这两处字面量是渲染端 CJK 扫描基线里的存量（阶段 3.1）。
    // '首页' 与 sidebar 那份 '主页' 指的是同一个 '/'，两份真源的收敛属阶段 3.2，
    // 本批只把字面量换成既有键，**不改可见文案**。
    if (tab.isHome) return t('nav.home')
    if (tab.title && tab.title.trim() && tab.title !== 'New Tab') return tab.title
    if (!tab.url || tab.url === 'about:blank') return t('tabs.newTabTitle')
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
  background: linear-gradient(180deg, var(--color-sidebar-bg-start), var(--color-bg-inset));
  border-bottom: 1px solid var(--color-border);
  padding: 0;
  user-select: none;
  -webkit-app-region: no-drag;
}

.tab-bar-tabs {
  flex: 1;
  display: flex;
  align-items: stretch;
  gap: var(--spacing-1);
  overflow-x: auto;
  scrollbar-width: none;
  padding: 4px var(--spacing-2) 0;
}

.tab-bar-tabs::-webkit-scrollbar {
  display: none;
}

.tab-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  min-width: 100px;
  max-width: 200px;
  padding: 0 var(--spacing-2) 0 var(--spacing-3);
  border: 1px solid transparent;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.tab-item:hover {
  background: var(--color-sidebar-hover-bg);
  color: var(--color-text-primary);
}

.tab-item.active {
  background: var(--color-bg-card);
  color: var(--color-text-strong);
  font-weight: 600;
  border-color: var(--color-border);
  border-bottom-color: var(--color-bg-card);
  box-shadow: var(--shadow-sm);
}

/* 活动标签顶部品牌色指示条（借鉴参考产品的标签强调线） */
.tab-item.active::before {
  content: '';
  position: absolute;
  top: 0;
  left: var(--spacing-2);
  right: var(--spacing-2);
  height: 2px;
  border-radius: 0 0 2px 2px;
  background: var(--color-primary);
}

.tab-icon {
  flex-shrink: 0;
  font-size: var(--font-size-sm);
  line-height: 1;
}

.tab-icon-img {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-xs);
  object-fit: contain;
}

.tab-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.tab-spinner {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  animation: spin 1s linear infinite;
  color: var(--color-primary);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 转圈属装饰性动效：系统要求减少动效时停转，开口圆环本身仍可辨为加载指示 */
@media (prefers-reduced-motion: reduce) {
  .tab-spinner { animation: none; }
}

.tab-close {
  flex-shrink: 0;
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.tab-close:hover {
  background: var(--color-border);
  color: var(--color-text-strong);
}

.tab-unsaved-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-warning);
  box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.25);
}

.tab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: var(--spacing-1) var(--spacing-2) 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-md);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.tab-add:hover {
  background: var(--color-bg-card);
  color: var(--color-primary);
  border-color: var(--color-border);
}
</style>
