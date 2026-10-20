<template>
  <div class="publish-dest-pipeline">
    <span class="publish-dest-config-label" :id="labelId">{{ t('publishDestination.configLabel') }}</span>
    <div ref="pickerEl" class="publish-dest-config-picker">
      <button
        type="button"
        class="publish-dest-config-trigger"
        :disabled="!options.length"
        role="combobox"
        aria-haspopup="listbox"
        :aria-expanded="menuOpen ? 'true' : 'false'"
        :aria-controls="menuOpen ? menuId : null"
        :aria-labelledby="labelId"
        data-testid="publish-dest-config-trigger"
        @click="toggle"
        @keydown="onTriggerKeydown"
      >
        <span class="publish-dest-config-value" data-testid="publish-dest-config-value">{{ displayText }}</span>
        <span class="publish-dest-config-caret" aria-hidden="true">▾</span>
      </button>
      <ul
        v-if="menuOpen"
        :id="menuId"
        ref="menuEl"
        class="publish-dest-config-menu"
        role="listbox"
        :aria-labelledby="labelId"
        data-testid="publish-dest-config-menu"
        @keydown="onMenuKeydown"
      >
        <li
          role="option"
          tabindex="-1"
          class="publish-dest-config-option"
          :class="{ 'is-selected': !modelValue }"
          :aria-selected="!modelValue"
          data-testid="publish-dest-config-option-default"
          @click="select('')"
        >{{ t('publishDestination.configDefaultOption') }}</li>
        <li
          v-for="c in options"
          :key="c.id"
          role="option"
          tabindex="-1"
          class="publish-dest-config-option"
          :class="{ 'is-selected': c.id === modelValue }"
          :aria-selected="c.id === modelValue"
          :data-testid="'publish-dest-config-option-' + c.id"
          @click="select(c.id)"
        >{{ c.name }}</li>
      </ul>
    </div>
    <p v-if="hint" class="publish-dest-config-hint" data-testid="publish-dest-config-hint">{{ hint }}</p>
  </div>
</template>

<script setup>
/**
 * PublishDestinationConfigPicker — 「去发布」浮窗的「配置选择」控件
 * （publish-config-picker，2026-10-21）。
 *
 * 为什么独立成组件（而不是塞在浮窗里）：
 *  - `PublishDestinationModal.vue` 触到 check-max-lines 的 500 行上限
 *    （NEW_OVER_LIMIT：新代码不得引入超大文件）。配置选择器自成一个「有名字的组合配置
 *    选择器」，抽出来后两边都短。
 *  - 浮窗只保留「取数 + 派发」，「哪些档案可选」「切流水线后旧选择还算不算数」交给
 *    `features/publish-destination/publish-destination-config.js` 的纯函数，不在本组件里
 *    另写一份判据。
 *
 * 交互契约（逐条对应 PRD §3.3）：
 *  - 选项 = 所选流水线的配置档案（`pipelineId` 过滤、updatedAt 倒序）。
 *  - 该流水线零配置 ⇒ 触发器显示「默认」、不可展开 ⇒ **下拉内容为空**（菜单节点不渲染）。
 *  - 有配置时菜单首项恒为「默认」（= 不套用任何配置），保证选完还能退回。
 *  - 加载中 / 加载失败 / 无配置三态互斥，各有可见说明，绝不静默。
 *  - 键盘可达（QM-6 评审 i2 采纳）：触发器上 ↓/↑ 展开并落到首/末项，菜单内 ↑/↓ 移动、
 *    Home/End 跳首末、Enter/Space 选中、Esc 关闭并把焦点还给触发器；Tab 关闭菜单。
 *    （原生 `<button>` 自带 Enter/Space 激活，故触发器只需处理方向键与 Esc。）
 *
 * 为什么自建下拉而不用 el-select：见 `openspec/changes/publish-config-picker/design.md` D2
 * （与左侧原生 select 同套视觉 + 本仓 Element Plus 显式按需装配的硬约束）。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveConfigSelection } from '@/features/publish-destination/publish-destination-config'

const props = defineProps({
  /** 选中的配置档案 id；空串 = 「默认」（不套用任何配置）。 */
  modelValue: { type: String, default: '' },
  /** 已归一化的配置档案列表（父组件负责归一化）。 */
  profiles: { type: Array, default: () => [] },
  /** 当前所选流水线 id（配置档案按它分域）。 */
  pipelineId: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  failed: { type: Boolean, default: false },
  labelId: { type: String, default: 'publish-dest-config-label' },
})

const emit = defineEmits(['update:modelValue'])

const { t } = useI18n()

const menuOpen = ref(false)
const pickerEl = ref(null)
const menuEl = ref(null)
/** 菜单内当前键盘焦点所在项的下标（0 = 「默认」项，其后是各条配置）。 */
const activeIndex = ref(-1)
const menuId = 'publish-dest-config-menu'

/** 选项与当前选中项一次算完：两条 computed 各算一次会把过滤/排序做两遍（QM-6 评审 i7 采纳）。 */
const selection = computed(() => resolveConfigSelection(
  props.profiles,
  props.pipelineId,
  props.modelValue,
))

const options = computed(() => selection.value.options)

const displayText = computed(() => (
  selection.value.selectedName || t('publishDestination.configDefaultOption')
))

/** 提示行：加载中 / 加载失败 / 该流水线尚无配置——三态互斥，绝不静默。 */
const hint = computed(() => {
  if (props.loading) return t('publishDestination.configLoading')
  if (props.failed) return t('publishDestination.configLoadFailed')
  if (!options.value.length) return t('publishDestination.configEmpty')
  return ''
})

/** 菜单项总数：「默认」1 项 + 各条配置。 */
const itemCount = computed(() => options.value.length + 1)

function toggle () {
  if (!options.value.length) return
  if (menuOpen.value) {
    closeMenu()
    return
  }
  menuOpen.value = true
  // 展开时把键盘焦点落在当前选中项（没有选中就落在「默认」）
  const current = options.value.findIndex(item => item.id === props.modelValue)
  activeIndex.value = current >= 0 ? current + 1 : 0
  void focusActive()
}

function closeMenu (refocus = false) {
  menuOpen.value = false
  activeIndex.value = -1
  if (refocus) {
    const trigger = pickerEl.value?.querySelector?.('.publish-dest-config-trigger')
    if (trigger && typeof trigger.focus === 'function') trigger.focus()
  }
}

function select (id) {
  emit('update:modelValue', id)
  closeMenu(true)
}

async function focusActive () {
  await nextTick()
  const items = menuEl.value?.querySelectorAll?.('[role="option"]')
  const target = items && items[activeIndex.value]
  if (target && typeof target.focus === 'function') target.focus()
}

function moveActive (delta) {
  if (!itemCount.value) return
  const count = itemCount.value
  activeIndex.value = (activeIndex.value + delta + count) % count
  void focusActive()
}

function onTriggerKeydown (event) {
  const key = event.key
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    event.preventDefault()
    if (menuOpen.value) {
      moveActive(key === 'ArrowDown' ? 1 : -1)
      return
    }
    // 展开并落到首项（↓）/ 末项（↑）
    menuOpen.value = true
    activeIndex.value = key === 'ArrowDown' ? 0 : itemCount.value - 1
    void focusActive()
    return
  }
  if (key === 'Escape' && menuOpen.value) {
    event.preventDefault()
    closeMenu(true)
  }
}

function onMenuKeydown (event) {
  const key = event.key
  if (key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)
    return
  }
  if (key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)
    return
  }
  if (key === 'Home') {
    event.preventDefault()
    activeIndex.value = 0
    void focusActive()
    return
  }
  if (key === 'End') {
    event.preventDefault()
    activeIndex.value = itemCount.value - 1
    void focusActive()
    return
  }
  if (key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
    return
  }
  if (key === 'Tab') {
    // Tab 走浏览顺序：菜单收起但**不**抢焦点（否则焦点被按回触发器，Tab 顺序被破坏）
    closeMenu(false)
  }
}

function onDocumentPointerDown (event) {
  const root = pickerEl.value
  if (root && typeof root.contains === 'function' && event && root.contains(event.target)) return
  closeMenu(false)
}

// 切换流水线 ⇒ 已选配置作废（配置属于某一条流水线，跨流水线套用是错误语义）
watch(() => props.pipelineId, () => {
  closeMenu(false)
})

// 选中的配置若已从库里消失（被删除/被改名），回落成「默认」，不留悬空选中态
watch(options, (list) => {
  if (!props.modelValue) return
  if (!list.some(item => item.id === props.modelValue)) emit('update:modelValue', '')
})

watch(menuOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) {
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  }
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  }
})

defineExpose({ options, displayText, hint, menuOpen, activeIndex })
</script>

<style scoped>
/* 触发器的视觉规格与浮窗里那个原生 <select> 保持一致（边框/圆角/字号/内边距）。
   scoped CSS 不跨组件，故此处复刻一份而不是靠父组件 :deep() —— 组件要能独立复用。 */
.publish-dest-config-label {
  font-size: var(--font-size-sm);
  color: var(--muted, #73777d);
  white-space: nowrap;
}

.publish-dest-config-picker {
  position: relative;
  flex: 1;
  max-width: 280px;
}

.publish-dest-config-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  font-size: var(--font-size-sm);
  border: 1px solid var(--border, #e5e5ea);
  border-radius: 8px;
  background: var(--surface, #fff);
  color: var(--text-primary, #25252b);
}
.publish-dest-config-trigger:focus { border-color: var(--coral, #f56c6c); outline: none; }
.publish-dest-config-trigger:disabled {
  cursor: default;
  color: var(--muted, #73777d);
  background: var(--soft-stone, #f5f5f5);
}

.publish-dest-config-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.publish-dest-config-caret {
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  line-height: 1;
  color: var(--muted, #73777d);
}

.publish-dest-config-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  max-height: 220px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e5e5ea);
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
}

.publish-dest-config-option {
  padding: 7px 10px;
  border-radius: 6px;
  font-size: var(--font-size-sm);
  color: var(--text-primary, #25252b);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.publish-dest-config-option:hover { background: var(--soft-stone, #f5f5f5); }
.publish-dest-config-option:focus { outline: 2px solid var(--coral, #f56c6c); outline-offset: -2px; }
.publish-dest-config-option.is-selected { color: var(--coral, #f56c6c); font-weight: 600; }

.publish-dest-config-hint {
  flex-basis: 100%;
  margin: 2px 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  color: var(--muted, #73777d);
}
</style>
