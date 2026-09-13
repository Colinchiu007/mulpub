<template>
  <Teleport to="body">
    <Transition name="back-to-top">
      <button
        v-if="visible"
        type="button"
        class="back-to-top"
        data-testid="back-to-top"
        :aria-label="accessibilityLabel"
        @click="handleClick"
      >
        <svg
          class="back-to-top__icon"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M12 19V6M12 6l-6 6M12 6l6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span
          v-if="label"
          class="back-to-top__tooltip"
          data-testid="back-to-top-tooltip"
          aria-hidden="true"
        >{{ label }}</span>
      </button>
    </Transition>
  </Teleport>
</template>

<script setup>
/**
 * BackToTop —— 全局「回到顶部」浮标按钮（2026-09-14 新增）
 *
 * 挂载方式：App.vue 全局唯一实例（与 PipelineBackgroundToast / UpdateNotification 同级），
 * 不在各视图内单独引入，避免长页面遗漏与重复实现
 * （见 docs/frontend-interaction-spec.md §2 交互原语唯一实现清单）。
 *
 * 显隐判定：以「当前滚动容器 scrollTop > threshold」为唯一条件。
 * 内容不足一屏时 scrollTop 恒为 0，按钮自然不出现，因此无需页面白名单。
 *
 * 多滚动容器：scroll 事件不冒泡，这里在容器上以捕获阶段（capture）监听，
 * 可以同时拿到主滚动容器自身与任意嵌套 overflow:auto 子容器的滚动，
 * 并以「最后一个产生滚动的容器」为点击时的回滚目标。
 *
 * 已排除场景：全屏路由 /first-run（挂载点位于 v-else 分支，不渲染）、
 * 登录标签页（该分支下 router-view 不渲染，滚动容器无内容）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const props = defineProps({
  /** 显示阈值（px）：滚动距离超过该值才出现，避免轻微滚动就弹按钮 */
  threshold: { type: Number, default: 320 },
  /** 主滚动容器选择器；默认取 App.vue 的 <main class="yixiaoer-workspace"> */
  containerSelector: { type: String, default: '[data-testid="yixiaoer-workspace"]' },
})

const { t } = useI18n()
const route = useRoute()

const visible = ref(false)

/** 主滚动容器（挂载期解析一次，卸载时移除监听） */
let containerEl = null
/** 最后一个产生滚动的容器，作为点击回滚目标 */
let activeScroller = null
/** 点击后短暂加锁，避免平滑滚动期间重复触发 */
let unlockTimer = null
let locked = false

// 文案 key 已在 zh/en locales 成对定义；vue-i18n 缺 key 时返回 key 原文，
// 这里回退空串而非硬编码中文，避免把 key 或未翻译文案泄漏到界面
// （i18n-user-facing-messages 规则，与 PipelineBackgroundToast 一致）。
const label = computed(() => {
  const translated = t('common.backToTop')
  return typeof translated === 'string' && translated !== 'common.backToTop' ? translated : ''
})

// 无障碍名兜底：locale 异常时仍保证按钮有可访问名，不让读屏用户遇到无名按钮。
const accessibilityLabel = computed(() => label.value || 'Back to top')

function resolveScroller () {
  if (activeScroller && activeScroller.isConnected) return activeScroller
  return containerEl
}

/** 尊重系统「减少动态效果」设置，避免前庭敏感用户被平滑滚动影响 */
function prefersReducedMotion () {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function onScroll (event) {
  const target = event.target
  if (!target || typeof target.scrollTop !== 'number') return
  if (target.scrollTop > props.threshold) {
    activeScroller = target
    visible.value = true
  } else if (activeScroller === target) {
    // 同一容器滚回阈值以内（含平滑滚动自然到位）→ 收起
    activeScroller = null
    visible.value = false
  }
}

function handleClick () {
  if (locked) return
  const scroller = resolveScroller()
  if (!scroller) return
  locked = true
  clearTimeout(unlockTimer)
  unlockTimer = setTimeout(() => { locked = false }, 600)
  try {
    scroller.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  } catch (error) {
    // 兜底：运行环境不支持 scrollTo(options) 时退化为直接赋值，保证功能可用
    console.warn('[back-to-top] smooth scroll failed, fallback to instant', error)
    scroller.scrollTop = 0
  }
}

// 路由切换后新页面通常停在顶部，按钮不应残留
watch(() => route.fullPath, () => {
  visible.value = false
  activeScroller = null
  locked = false
  clearTimeout(unlockTimer)
})

onMounted(() => {
  containerEl = document.querySelector(props.containerSelector)
  if (!containerEl) {
    console.warn('[back-to-top] scroll container not found:', props.containerSelector)
    return
  }
  containerEl.addEventListener('scroll', onScroll, true)
})

onBeforeUnmount(() => {
  clearTimeout(unlockTimer)
  unlockTimer = null
  if (containerEl) {
    containerEl.removeEventListener('scroll', onScroll, true)
    containerEl = null
  }
  activeScroller = null
})
</script>

<style scoped>
.back-to-top {
  position: fixed;
  right: var(--spacing-6);
  bottom: var(--spacing-6);
  z-index: 1900; /* 低于 UiModal overlay / UpdateNotification(2000)，弹窗打开时被遮罩覆盖 */

  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: var(--radius-lg);

  background: var(--color-float-surface);
  color: var(--color-float-icon);
  cursor: pointer;
  box-shadow: var(--shadow-float);
  transition: background-color 160ms ease-out, color 160ms ease-out, transform 120ms ease-out;
}

.back-to-top:hover {
  background: var(--color-float-surface-hover);
  color: var(--color-float-icon-hover);
}

.back-to-top:active {
  background: var(--color-float-surface-active);
  transform: scale(0.94);
}

/* 键盘可达性：仅键盘聚焦时显示描边，鼠标点击不出现 */
.back-to-top:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.back-to-top__icon {
  display: block;
}

/* ── 文字提示气泡：位于按钮左侧，右侧带指向按钮的小三角 ── */
.back-to-top__tooltip {
  position: absolute;
  top: 50%;
  right: calc(100% + 10px);
  transform: translateY(-50%);

  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-float-tooltip-bg);
  color: var(--color-float-tooltip-text);
  font-size: var(--font-size-xs);
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;

  opacity: 0;
  visibility: hidden;
  transition: opacity 140ms ease-out, visibility 140ms ease-out;
}

/* 小三角：指向右侧按钮 */
.back-to-top__tooltip::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 100%;
  margin-top: -4px;
  border-width: 4px;
  border-style: solid;
  border-color: transparent transparent transparent var(--color-float-tooltip-bg);
}

/* 鼠标悬浮与键盘聚焦共用同一提示展示，保证键盘用户可获得同等信息 */
.back-to-top:hover .back-to-top__tooltip,
.back-to-top:focus-visible .back-to-top__tooltip {
  opacity: 1;
  visibility: visible;
}

/* ── 进出场：自右下方向淡入淡出 ── */
.back-to-top-enter-active,
.back-to-top-leave-active {
  transition: opacity 180ms ease-out, transform 180ms ease-out;
}

.back-to-top-enter-from,
.back-to-top-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .back-to-top,
  .back-to-top__tooltip,
  .back-to-top-enter-active,
  .back-to-top-leave-active {
    transition: none;
  }

  .back-to-top:active {
    transform: none;
  }
}
</style>
