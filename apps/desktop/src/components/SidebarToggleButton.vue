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
    <SidebarToggleIcon :collapsed="collapsed" />
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
 *
 * 可发现性（sidebar-toggle-ux）：初版交付后用户反馈「太不明显，根本注意不到」。
 * 诊断与实测见 openspec/changes/sidebar-toggle-ux/，要点：
 *  - 图标语义化（面板+箭头，两态图形不同）承担主要识别，颜色只作冗余编码；
 *  - 图标色用 `--color-text-primary`：亮色 4.40:1 → **15.99:1**，暗色 7.79:1 → 12.80:1；
 *  - 常态描边**不能**用 `--color-border`：实测它对 TabBar 背景只有 1.04:1（等于不存在），
 *    改用品牌色倾向的半透明描边，并保留 hover 加深作二级反馈；
 *  - 收起态加 2px 品牌色锚点：收起后按钮是唯一恢复入口，不能只靠颜色变化。
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
  /* ::before 竖条的定位基准 */
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 30 → 32：为 18px 图标留出内边距。margin 不动，36px 行高契约不变 */
  width: 32px;
  height: 28px;
  margin: 4px 2px 0 var(--spacing-2);
  padding: 0;
  /* 品牌色倾向的半透明描边：既让边界可辨，又不至于在 36px TabBar 里做成一块补丁。
     不用 --color-border —— 实测它对 TabBar 背景只有 1.04:1，肉眼等于没有 */
  border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
  border-radius: var(--radius-sm);
  /* 常态就有底色：不允许「只有 hover 才显现」 */
  background: var(--color-bg-card);
  /* 图形对比度主判据：亮 15.99:1 / 暗 12.80:1（WCAG AA 需 ≥4.5:1） */
  color: var(--color-text-primary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.sidebar-toggle:hover {
  /* 与 TabBar 内既有元素同语言的悬停底色 */
  background: var(--color-sidebar-hover-bg);
  color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
}

.sidebar-toggle:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

/* 收起态：侧栏已隐藏，按钮落在窗口最左侧，是用户唯一的恢复入口。
   仅靠颜色从 primary 变 secondary 几乎不可察觉，故加一条 2px 品牌色锚点
   （实测对按钮底色亮 6.18:1 / 暗 5.13:1，达非文本 UI 组件 3:1 要求）。
   用 absolute 定位：不占用布局空间，32×28 的命中区不变。 */
.sidebar-toggle.is-collapsed::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 1px;
  background: var(--color-primary);
}

.sidebar-toggle.is-collapsed {
  color: var(--color-primary);
}

.sidebar-toggle-icon {
  display: block;
  /* 16 → 18：视觉权重提升，配合 32px 宽按钮留 7px 内边距 */
  width: 18px;
  height: 18px;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-toggle {
    transition: none;
  }
}
</style>
