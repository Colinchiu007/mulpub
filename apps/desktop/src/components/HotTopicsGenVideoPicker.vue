<template>
  <div ref="rootEl" class="gen-video-split" :class="{ 'is-open': open }" @keydown="onMenuKeydown">
    <button
      type="button"
      class="cohere-btn-primary item-gen-video-btn"
      :data-testid="ids.generate"
      :disabled="blocksInteraction"
      :title="t('hotTopics.genVideoDefaultPipelineHint')"
      @click="onGenerate"
    >{{ t('hotTopics.generateVideo') }}</button>
    <button
      ref="caretEl"
      type="button"
      class="cohere-btn-primary item-gen-video-caret"
      :data-testid="ids.picker"
      :aria-label="t('hotTopics.genVideoPipelinePickerAria')"
      :title="t('hotTopics.genVideoPipelinePickerAria')"
      aria-haspopup="menu"
      :aria-expanded="open ? 'true' : 'false'"
      :disabled="blocksInteraction"
      @click.stop="toggle"
    >
      <span class="gen-video-caret-icon" aria-hidden="true">▾</span>
    </button>

    <div
      v-if="open"
      ref="menuEl"
      class="gen-video-pipeline-menu"
      :class="{ 'is-top': placement === 'top' }"
      :style="menuMaxHeight ? { maxHeight: menuMaxHeight + 'px' } : null"
      role="menu"
      tabindex="-1"
      :aria-label="t('hotTopics.genVideoPipelinePickTitle')"
      :data-testid="ids.menu"
    >
      <div class="gen-video-pipeline-menu-title">{{ t('hotTopics.genVideoPipelinePickTitle') }}</div>
      <div v-if="loading" class="gen-video-pipeline-state" :data-testid="ids.loading">
        {{ t('hotTopics.genVideoPipelineLoading') }}
      </div>
      <div v-if="error" class="gen-video-pipeline-state is-error" :data-testid="ids.error">
        <span>{{ t('hotTopics.genVideoPipelineLoadFailed') }}</span>
        <button
          type="button"
          class="gen-video-pipeline-retry"
          :data-testid="ids.retry"
          @click.stop="loadPipelines(true)"
        >{{ t('hotTopics.genVideoPipelineRetry') }}</button>
      </div>
      <div
        v-if="!loading && !error && options.length === 0"
        class="gen-video-pipeline-state"
        :data-testid="ids.empty"
      >{{ t('hotTopics.genVideoPipelineEmpty') }}</div>
      <button
        v-for="opt in options"
        :key="opt.name"
        type="button"
        role="menuitem"
        class="gen-video-pipeline-item"
        :class="{ 'is-disabled': !opt.enabled }"
        :disabled="!opt.enabled"
        :data-testid="ids.optionPrefix + opt.name"
        :title="opt.description || opt.label"
        @click="pick(opt)"
      >
        <span class="gen-video-pipeline-item-name">{{ opt.label }}</span>
        <span v-if="opt.isDefault" class="pipeline-default-badge">{{ t('hotTopics.genVideoPipelineDefaultBadge') }}</span>
        <span v-if="!opt.enabled" class="pipeline-item-reason">{{ opt.reasonText }}</span>
      </button>
      <div v-if="!loading && !error && options.some(o => o.enabled)" class="gen-video-pipeline-menu-hint">
        {{ t('hotTopics.genVideoPipelineHint') }}
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * HotTopicsGenVideoPicker — 行内「生成视频」按钮组 + 下箭头流水线选择器
 * （hot-topics-pipeline-picker，2026-10-17）。
 *
 * 设计要点：
 * - 主按钮语义不变（默认 story2video-compose）；下箭头是「选择另一条流水线并立即开始」的入口。
 * - 不用 el-dropdown/el-popover：Element Plus 按需注册有机械锁，本地自建菜单零新依赖、零样式导入；
 *   菜单项用原生 button，天然支持 disabled/焦点/回车。
 * - 流水线清单来自主进程 pipelineList（唯一真源）；可执行性分类在
 *   features/hot-topics/gen-video-pipelines.js 的纯函数里，组件只负责展示与交互。
 */
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { pipelineList } from '@/api/publisher'
import {
  DEFAULT_GEN_VIDEO_PIPELINE,
  buildGenVideoPipelineOptions,
} from '@/features/hot-topics/gen-video-pipelines'
import {
  activePickerUid,
  nextPickerUid,
  computeGenVideoPickerPlacement,
  computeGenVideoPickerMenuSize,
  PICKER_MENU_MAX_HEIGHT,
} from '@/features/hot-topics/gen-video-picker-state'

const props = defineProps({
  topicId: { type: String, required: true },
  busy: { type: Boolean, default: false },
  // 收藏 tab 的行用另一组 testid（与既有收藏行契约一致）
  favorite: { type: Boolean, default: false },
  // 话题数据损坏（topic 为 null）的行：两个按钮都禁用，但不影响清理收藏
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['generate', 'pick'])

const { t } = useI18n()

// ── 全局单面板：模块级 uid 指针，保证同一时刻只有一个下拉打开 ──
const uid = nextPickerUid()
const rootEl = ref(null)
const caretEl = ref(null)
const menuEl = ref(null)

const loading = ref(false)
const error = ref(false)
const loaded = ref(false)
const options = ref([])
// 展开方向与可用高度：内容区滚动容器空间不足时翻转并压缩面板高度（防止被裁掉）
const placement = ref('bottom')
const menuMaxHeight = ref(null)

const open = computed(() => activePickerUid.value === uid)
/** 交互闸门：编排在途或话题数据损坏时，主按钮与下箭头一起禁用（菜单也会被关掉）。 */
const blocksInteraction = computed(() => props.busy || props.disabled)

const ids = computed(() => {
  const prefix = props.favorite ? 'hot-topic-favorite' : 'hot-topic'
  return {
    generate: `${prefix}-generate-video-${props.topicId}`,
    picker: `${prefix}-gen-video-picker-${props.topicId}`,
    menu: `hot-topic-gen-video-pipeline-menu-${props.topicId}`,
    loading: `hot-topic-gen-video-pipeline-loading-${props.topicId}`,
    error: `hot-topic-gen-video-pipeline-error-${props.topicId}`,
    empty: `hot-topic-gen-video-pipeline-empty-${props.topicId}`,
    retry: `hot-topic-gen-video-pipeline-retry-${props.topicId}`,
    optionPrefix: `hot-topic-gen-video-pipeline-option-${props.topicId}-`,
  }
})

/** 回退项：流水线清单不可用时仍保留默认流水线，主流程不因 IPC 失败而不可用。 */
function fallbackOptions() {
  return buildGenVideoPipelineOptions([{ name: DEFAULT_GEN_VIDEO_PIPELINE, available: true }], t)
}

function focusableItems() {
  const root = menuEl.value
  if (!root || typeof root.querySelectorAll !== 'function') return []
  return Array.from(root.querySelectorAll('.gen-video-pipeline-item:not([disabled])'))
}

function focusFirstEnabled() {
  const first = focusableItems()[0]
  if (first && typeof first.focus === 'function') first.focus()
}

function focusItemByDelta(delta) {
  const items = focusableItems()
  if (items.length === 0) return
  const active = typeof document !== 'undefined' ? document.activeElement : null
  const index = items.indexOf(active)
  const next = index < 0 ? 0 : (index + delta + items.length) % items.length
  items[next].focus()
}

/**
 * 找到会裁剪面板的滚动视口（最近的 overflow-y auto/scroll 祖先）。
 * 热门选题页的 `.cohere-content` 是页面滚动容器：它只有可视区高度，
 * 面板绝对定位到行下方时会超出它而被裁切（2026-10-17 实测）。
 */
function resolveViewportBounds() {
  if (typeof window === 'undefined') return { top: 0, bottom: 0 }
  let el = rootEl.value ? rootEl.value.parentElement : null
  while (el) {
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null
    if (style && /(auto|scroll)/.test(style.overflowY)) {
      const rect = el.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom }
    }
    el = el.parentElement
  }
  return { top: 0, bottom: window.innerHeight }
}

function updatePlacement() {
  const root = rootEl.value
  if (!root || typeof root.getBoundingClientRect !== 'function') {
    placement.value = 'bottom'
    menuMaxHeight.value = null
    return
  }
  const viewport = resolveViewportBounds()
  const buttonRect = root.getBoundingClientRect()
  placement.value = computeGenVideoPickerPlacement({
    buttonRect,
    // 用理想高度判定方向：面板实际高度会随可用空间压缩，不能用压缩后的高度决策
    menuHeight: PICKER_MENU_MAX_HEIGHT,
    viewportTop: viewport.top,
    viewportBottom: viewport.bottom,
  })
  const size = computeGenVideoPickerMenuSize({
    placement: placement.value,
    buttonRect,
    viewportTop: viewport.top,
    viewportBottom: viewport.bottom,
  })
  menuMaxHeight.value = size < PICKER_MENU_MAX_HEIGHT ? size : null
}

async function loadPipelines(force = false) {
  if (loading.value) return
  if (loaded.value && !force) return
  loading.value = true
  error.value = false
  try {
    const res = await pipelineList()
    const list = res && res.code === 0 && Array.isArray(res.data) ? res.data : null
    if (!list) throw new Error('invalid pipeline list')
    options.value = buildGenVideoPipelineOptions(list, t)
    loaded.value = true
  } catch (_) {
    error.value = true
    options.value = fallbackOptions()
  } finally {
    loading.value = false
    if (open.value) {
      await nextTick()
      focusFirstEnabled()
      updatePlacement()
    }
  }
}

function close() {
  if (activePickerUid.value === uid) activePickerUid.value = null
}

function toggle() {
  if (blocksInteraction.value) return
  if (open.value) {
    close()
    return
  }
  activePickerUid.value = uid
  if (!loaded.value && !error.value) {
    void loadPipelines()
  } else {
    void nextTick(() => {
      focusFirstEnabled()
      updatePlacement()
    })
  }
}

function onGenerate() {
  if (blocksInteraction.value) return
  emit('generate')
}

function pick(opt) {
  if (!opt || !opt.enabled) return
  close()
  emit('pick', opt.name)
}

function onMenuKeydown(event) {
  const key = event?.key
  if (!open.value) return
  if (key === 'Escape') {
    event.preventDefault()
    close()
    const arrow = caretEl.value
    if (arrow && typeof arrow.focus === 'function') arrow.focus()
    return
  }
  if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
    event.preventDefault()
    if (key === 'Home') {
      const first = focusableItems()[0]
      if (first) first.focus()
    } else if (key === 'End') {
      const items = focusableItems()
      if (items.length > 0) items[items.length - 1].focus()
    } else {
      focusItemByDelta(key === 'ArrowDown' ? 1 : -1)
    }
  }
}

function onDocumentPointerDown(event) {
  const root = rootEl.value
  if (root && typeof root.contains === 'function' && event && root.contains(event.target)) return
  close()
}

/** 页面任意滚动都收起面板：面板绝对定位在行内，滚动后容易脱离按钮或被容器裁切。 */
function onWindowScroll() {
  close()
}

/** 窗口尺寸变化时重算展开方向与高度：可用空间随视口改变（QM-6 评审 i2）。 */
function onWindowResize() {
  if (!open.value) return
  updatePlacement()
}

watch(open, (isOpen) => {
  if (typeof document === 'undefined') return
  if (isOpen) {
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', onWindowScroll, true)
      window.addEventListener('resize', onWindowResize)
    }
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', onWindowScroll, true)
      window.removeEventListener('resize', onWindowResize)
    }
  }
})

watch(blocksInteraction, (blocked) => {
  if (blocked) close()
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('scroll', onWindowScroll, true)
    window.removeEventListener('resize', onWindowResize)
  }
  close()
})

defineExpose({ open, loadPipelines, options, loading, error })
</script>

<style scoped>
.gen-video-split {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

/* 小下箭头：与主按钮同色系，仅收窄内边距；不改变行高 */
.item-gen-video-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 6px;
  min-width: 0;
  line-height: 1;
}
.gen-video-caret-icon {
  font-size: var(--font-size-xs);
  line-height: 1;
  transition: transform 0.15s ease;
}
.gen-video-split.is-open .gen-video-caret-icon { transform: rotate(180deg); }

.gen-video-pipeline-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  min-width: 260px;
  max-width: 340px;
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 10px 28px color-mix(in srgb, #000 18%, transparent);
}
.gen-video-pipeline-menu:focus { outline: none; }
/* 下方空间不足时翻转：贴在按钮上方展开，避免被页面滚动容器裁切 */
.gen-video-pipeline-menu.is-top {
  top: auto;
  bottom: calc(100% + 6px);
}

.gen-video-pipeline-menu-title {
  padding: 4px 8px 6px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-muted);
}

.gen-video-pipeline-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.gen-video-pipeline-state.is-error { color: var(--color-danger); flex-wrap: wrap; }

.gen-video-pipeline-retry {
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-primary);
  border-radius: 6px;
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  cursor: pointer;
}
.gen-video-pipeline-retry:hover { border-color: var(--color-primary); }

.gen-video-pipeline-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
}
.gen-video-pipeline-item:hover:not([disabled]),
.gen-video-pipeline-item:focus-visible {
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-card));
  outline: none;
}
.gen-video-pipeline-item[disabled] { cursor: not-allowed; opacity: 0.66; }

.gen-video-pipeline-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pipeline-default-badge {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 9px;
  font-size: var(--font-size-xs);
  line-height: 18px;
  color: var(--color-primary-dark-tint, var(--color-primary));
  background: color-mix(in srgb, var(--color-primary) 12%, var(--color-bg-card));
}

.pipeline-item-reason {
  flex-shrink: 0;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.gen-video-pipeline-menu-hint {
  padding: 6px 8px 2px;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  border-top: 1px solid var(--color-border);
  margin-top: 4px;
}
</style>
