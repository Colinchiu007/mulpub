<template>
  <button
    type="button"
    class="sidebar-toggle"
    :class="{ 'is-collapsed': collapsed }"
    data-testid="sidebar-toggle"
    :aria-pressed="collapsed ? 'true' : 'false'"
    :aria-label="actionLabel"
    :title="actionLabel"
    @click="$emit('toggle')"
  >
    <SidebarToggleIcon />
  </button>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SidebarToggleIcon from './icons/SidebarToggleIcon.vue'

/**
 * 全局「左侧菜单收起 / 展开」按钮（挂载于 TabBar 最左侧）。
 *
 * 语义与呈现分离：
 *  - `collapsed` 由父层从全局 store 传入，本组件**不持状态**；
 *  - 点击只 emit('toggle')，由 store 统一改状态、持久化并上报主进程；
 *  - aria-pressed 表示「当前是否已收起」，而 aria-label/title 描述**下一次点击会做什么**
 *    （收起态提示「展开左侧菜单」，展开态提示「收起左侧菜单」）。
 */
const props = defineProps({
  /** 左侧菜单当前是否已收起 */
  collapsed: { type: Boolean, default: false },
})

defineEmits(['toggle'])

const { t } = useI18n()

const actionLabel = computed(() =>
  t(props.collapsed ? 'tabBar.expandSidebar' : 'tabBar.collapseSidebar'),
)
</script>

<style scoped>
.sidebar-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  margin: 4px 2px 0 var(--spacing-2);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.sidebar-toggle:hover {
  background: var(--color-bg-card);
  color: var(--color-primary);
  border-color: var(--color-border);
}

.sidebar-toggle:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

/* 收起态：按钮落在窗口最左侧，用品牌色提示「当前处于收起态」 */
.sidebar-toggle.is-collapsed {
  color: var(--color-primary);
}

.sidebar-toggle-icon {
  display: block;
  width: 16px;
  height: 16px;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-toggle {
    transition: none;
  }
}
</style>
