<template>
  <div ref="rootRef" class="mp-platform-picker">
    <span v-if="label" :id="labelId" class="mp-platform-picker-label">{{ label }}</span>
    <button
      :id="triggerId"
      ref="triggerRef"
      type="button"
      class="mp-platform-picker-trigger"
      :class="{ 'is-open': open, 'is-empty': !selectedPlatform }"
      :disabled="disabled"
      :aria-haspopup="'listbox'"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="open ? listboxId : undefined"
      :aria-labelledby="label ? `${labelId} ${valueId}` : undefined"
      :aria-label="label ? undefined : (ariaLabels.trigger || undefined)"
      data-testid="platform-picker-trigger"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <PlatformIcon
        v-if="selectedPlatform"
        :platform="selectedPlatform.id"
        :label="selectedPlatform.label"
        size="sm"
      />
      <span :id="valueId" class="mp-platform-picker-value" :class="{ 'is-placeholder': !selectedPlatform }">
        {{ selectedPlatform ? selectedPlatform.label : placeholder }}
      </span>
      <span class="mp-platform-picker-caret" aria-hidden="true">▾</span>
    </button>

    <Teleport to="body">
      <Transition name="mp-platform-picker-pop">
        <div
          v-if="open"
          ref="popupRef"
          :id="popupId"
          class="mp-platform-picker-popup"
          :style="popupStyle"
          data-testid="platform-picker-popup"
        >
          <div class="mp-platform-picker-search">
            <Search class="mp-platform-picker-search-icon" aria-hidden="true" />
            <input
              :id="searchId"
              ref="searchRef"
              v-model="keyword"
              type="text"
              role="combobox"
              autocomplete="off"
              :placeholder="searchPlaceholder"
              :aria-label="ariaLabels.search || undefined"
              :aria-expanded="'true'"
              :aria-controls="listboxId"
              :aria-activedescendant="activeId ? optionDomId(activeId) : undefined"
              data-testid="platform-picker-search"
              @keydown="onSearchKeydown"
            >
            <button
              v-if="keyword"
              type="button"
              class="mp-platform-picker-search-clear"
              :aria-label="ariaLabels.clearSearch || undefined"
              data-testid="platform-picker-search-clear"
              @click="clearSearch"
            >×</button>
          </div>

          <div
            :id="listboxId"
            class="mp-platform-picker-list"
            role="listbox"
            :aria-label="ariaLabels.list || undefined"
            data-testid="platform-picker-list"
          >
            <div
              v-for="group in visibleGroups"
              :key="group.key"
              role="group"
              :aria-labelledby="group.label ? group.titleId : undefined"
              :data-testid="`platform-picker-group-${group.key}`"
            >
              <div v-if="group.label" :id="group.titleId" class="mp-platform-picker-group-title" aria-hidden="true">
                {{ group.label }}
              </div>
              <button
                v-for="item in group.items"
                :id="optionDomId(item.id)"
                :key="item.id"
                type="button"
                role="option"
                class="mp-platform-picker-option"
                :class="{ 'is-active': activeId === item.id, 'is-selected': modelValue === item.id }"
                :aria-selected="modelValue === item.id ? 'true' : 'false'"
                :aria-label="ariaLabels.option ? ariaLabels.option(item.label) : undefined"
                :data-testid="`platform-picker-option-${item.id}`"
                @click="select(item.id)"
                @mousemove="activeId = item.id"
              >
                <PlatformIcon :platform="item.id" :label="item.label" size="sm" />
                <span class="mp-platform-picker-option-label">{{ item.label }}</span>
                <Check
                  v-if="modelValue === item.id"
                  class="mp-platform-picker-option-check"
                  aria-hidden="true"
                />
              </button>
            </div>
            <p v-if="!visibleGroups.length" class="mp-platform-picker-empty" data-testid="platform-picker-empty">
              {{ normalized.length ? emptyText : noPlatformsText }}
            </p>
          </div>

          <div v-if="hint" class="mp-platform-picker-footer" aria-hidden="true">{{ hint }}</div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
/**
 * AccountPlatformPicker —— 应用内自绘的平台选择浮层。
 *
 * 为什么不用原生 <select>：原生控件展开后由操作系统绘制，CSS 无法介入，
 * 于是「把下拉调精致」在原生形态下走不通（展开态的圆角/配色/图标/高亮
 * 全部由系统决定）。自绘后这些才归本应用管。设计与边界见
 * 01-docs/PRD-ACCOUNT-PLATFORM-PICKER-UX-2026-10-21.md。
 *
 * 三条不可移动的语义：
 * 1. **只产出平台 id**，不碰登录流程（下游 addAccount() 自行处理）。
 * 2. **分组口径来自平台目录真源**（usePlatformStore().getCategoryGroup），
 *    不在本组件里另写一份"哪些是海外平台"的清单。
 * 3. **焦点必须可回收**：浮层在 body 上（避 UiModal 的 overflow 裁剪），
 *    关闭时要把焦点交还触发器，否则键盘用户会掉到文档开头。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, Search } from '@element-plus/icons-vue'
import PlatformIcon from '@/components/PlatformIcon.vue'
import { usePlatformStore } from '@/stores/platforms'

const props = defineProps({
  modelValue: { type: String, default: '' },
  /** 平台目录：[{ id, label }]，顺序即展示顺序（配置顺序 = 产品优先级）。 */
  platforms: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  label: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  searchPlaceholder: { type: String, default: '' },
  /** 搜索无结果时的空态文案。 */
  emptyText: { type: String, default: '' },
  /** 平台目录本身为空时的空态文案（与"搜索无结果"是两件事，文案不能混用）。 */
  noPlatformsText: { type: String, default: '' },
  hint: { type: String, default: '' },
  /** 分组显示名：{ domestic, international }。 */
  groupLabels: { type: Object, default: () => ({}) },
  /** 无障碍文案：{ trigger, search, clearSearch, list, option(函数) }。 */
  ariaLabels: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['update:modelValue'])

const platformStore = usePlatformStore()

const open = ref(false)
const keyword = ref('')
const activeId = ref('')
/** 本次打开的方式（mouse / first / last）—— post-flush 的 watch 用它决定激活项落点。 */
const openEdge = ref('mouse')
const popupStyle = ref({})

const rootRef = ref(null)
const triggerRef = ref(null)
const popupRef = ref(null)
const searchRef = ref(null)

const uid = `mp-picker-${Math.random().toString(36).slice(2, 10)}`
const triggerId = `${uid}-trigger`
const labelId = `${uid}-label`
const valueId = `${uid}-value`
const searchId = `${uid}-search`
const listboxId = `${uid}-listbox`
const popupId = `${uid}-popup`

const optionDomId = (id) => `${uid}-option-${id}`

/** 平台目录归一：去重（同 id 只留首次）、补 label（缺失时回退 id，避免空白项）。 */
const normalized = computed(() => {
  const seen = new Set()
  const out = []
  for (const item of props.platforms || []) {
    if (!item || !item.id || seen.has(item.id)) continue
    seen.add(item.id)
    out.push({ id: item.id, label: item.label || item.id })
  }
  return out
})

/**
 * 搜索过滤：平台显示名与平台 id 都参与子串匹配（大小写不敏感）。
 * 纯空格输入等价于空输入 —— 否则用户随手打一个空格就会「所有平台都消失了」。
 */
const filtered = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (!needle) return normalized.value
  return normalized.value.filter((item) => (
    item.label.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle)
  ))
})

const visibleGroups = computed(() => {
  const groups = []
  for (const key of ['domestic', 'international']) {
    const items = filtered.value.filter((item) => platformStore.getCategoryGroup(item.id) === key)
    if (!items.length) continue
    groups.push({ key, label: props.groupLabels?.[key] || '', titleId: `${uid}-group-${key}`, items })
  }
  return groups
})

const flatItems = computed(() => visibleGroups.value.flatMap((group) => group.items))

const selectedPlatform = computed(() => normalized.value.find((item) => item.id === props.modelValue) || null)

watch(keyword, () => {
  const items = flatItems.value
  activeId.value = items.some((item) => item.id === activeId.value) ? activeId.value : (items[0]?.id || '')
})

// ── 定位 ────────────────────────────────────────────────────────────────────
// 浮层落在 body 上（UiModal 的 .ui-modal 是 overflow:hidden、body 是 overflow-y:auto，
// 留在弹窗内必然被裁掉），所以位置自己算：贴触发器下沿，空间不足时向上翻转。
function updatePosition () {
  const trigger = triggerRef.value
  const popup = popupRef.value
  if (!trigger || !popup) return
  const rect = trigger.getBoundingClientRect()
  const gap = 6
  const spaceBelow = window.innerHeight - rect.bottom - gap
  const spaceAbove = rect.top - gap
  const flipUp = spaceBelow < 260 && spaceAbove > spaceBelow
  const available = flipUp ? spaceAbove : spaceBelow
  // 宽度取「触发器宽度」与 300px 的较大者：取 320 会让浮层比触发器宽出一截（右边缘对不齐），
  // 300 则在本仓 360px 弹窗里恰好等于触发器宽度，左右两边都齐。
  const width = Math.max(rect.width, 300)
  popupStyle.value = {
    position: 'fixed',
    left: `${rect.left}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(160, Math.min(420, available))}px`,
    ...(flipUp
      ? { bottom: `${window.innerHeight - rect.top + gap}px` }
      : { top: `${rect.bottom + gap}px` }),
  }
}

/**
 * 视口变化时重算浮层位置。
 *
 * 用 requestAnimationFrame 合并同一帧内的多次触发：滚动/resize 事件可能在一帧里
 * 连发多次（尤其在触控板惯性滚动与窗口拖拽时），每次都读 getBoundingClientRect()
 * 并写 style 会造成「读—写」交替的强制同步布局（layout thrashing）。合并到一帧
 * 只算一次，肉眼无差别。
 */
let repositionFrame = null
function onViewportChange () {
  if (!open.value) return
  if (repositionFrame !== null) return
  const run = () => {
    repositionFrame = null
    updatePosition()
  }
  repositionFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : null
  if (repositionFrame === null) run()
}

function cancelPendingReposition () {
  if (repositionFrame === null) return
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(repositionFrame)
  repositionFrame = null
}

// ── 开关 ────────────────────────────────────────────────────────────────────
/**
 * 打开后的「落定后处理」：定位 + 聚焦 + 设定激活项。
 *
 * 用 **post-flush 的 watch** 驱动，而不是在 openPicker 里直接 nextTick：
 * post-flush 保证**本次渲染（含 Teleport 到 body 的子节点）已落定**，因此这里读到的
 * popupRef / searchRef 一定非空 —— 不再依赖「nextTick 与 Teleport 挂载的先后」这种
 * 隐含时序假设（QM-6 第二轮 i3）。内层再套一次 nextTick 只是把这件事写死两遍，
 * 代价是一个微任务。
 */
watch(open, (isOpen) => {
  if (!isOpen) return
  updatePosition()
  searchRef.value?.focus()
  const items = flatItems.value
  const edge = openEdge.value
  if (edge === 'first') {
    activeId.value = items[0]?.id || ''
  } else if (edge === 'last') {
    activeId.value = items[items.length - 1]?.id || ''
  } else {
    activeId.value = items.some((item) => item.id === props.modelValue) ? props.modelValue : ''
  }
}, { flush: 'post' })

/**
 * @param {'mouse'|'first'|'last'} edge
 *   mouse —— 鼠标点开：不预置任何激活项（避免出现「鼠标并不在那儿却像被悬停」的幽灵高亮），
 *            但把当前已选中的平台设为激活项，让用户一眼看到「我现在在哪个平台上」。
 *   first/last —— 键盘打开（ArrowDown / ArrowUp）：按 combobox 惯例直接落到首/末项。
 */
function openPicker (edge = 'mouse') {
  if (props.disabled) return
  openEdge.value = edge
  open.value = true
  keyword.value = ''
  document.addEventListener('pointerdown', onOutsidePointerDown, true)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
  // 定位 / 聚焦 / 激活项由上面的 post-flush watch 统一处理（见该处注释）。
}

function closePicker (restoreFocus = true) {
  if (!open.value) return
  open.value = false
  keyword.value = ''
  activeId.value = ''
  document.removeEventListener('pointerdown', onOutsidePointerDown, true)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
  cancelPendingReposition()
  if (restoreFocus) nextTick(() => triggerRef.value?.focus())
}

function toggle () {
  if (open.value) closePicker()
  else openPicker('mouse')
}

function onOutsidePointerDown (event) {
  const target = event.target
  if (rootRef.value?.contains(target)) return
  if (popupRef.value?.contains(target)) return
  closePicker(false)
}

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutsidePointerDown, true)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
  cancelPendingReposition()
})

// ── 选择 ────────────────────────────────────────────────────────────────────
function select (id) {
  // 脏 id 不外发：平台 id 会一路流到主进程的登录路由，脏值等于让用户点了没反应。
  if (!normalized.value.some((item) => item.id === id)) return
  emit('update:modelValue', id)
  closePicker(true)
}

function clearSearch () {
  keyword.value = ''
  searchRef.value?.focus()
}

// ── 键盘 ────────────────────────────────────────────────────────────────────
function onTriggerKeydown (event) {
  if (props.disabled) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    openPicker('first')
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    openPicker('last')
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    closePicker(true)
  }
}

function moveActive (delta) {
  const items = flatItems.value
  if (!items.length) {
    activeId.value = ''
    return
  }
  const index = items.findIndex((item) => item.id === activeId.value)
  const next = index === -1
    ? (delta > 0 ? 0 : items.length - 1)
    : Math.min(items.length - 1, Math.max(0, index + delta))
  activeId.value = items[next].id
  scrollActiveIntoView()
}

function scrollActiveIntoView () {
  if (!activeId.value || !popupRef.value) return
  // 用 getElementById 而不是 querySelector('#'+id)：平台 id 来自平台目录，
  // 理论上可以含 `.` / `:` 这类 CSS 选择器里非法（或语义不同）的字符 ——
  // 拼进选择器会让 querySelector 抛 SyntaxError（QM-6 第二轮 i4）。
  // getElementById 不做选择器解析，天然没有这个问题。
  const el = document.getElementById(optionDomId(activeId.value))
  el?.scrollIntoView?.({ block: 'nearest' })
}

function onSearchKeydown (event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    activeId.value = flatItems.value[0]?.id || ''
    scrollActiveIntoView()
  } else if (event.key === 'End') {
    event.preventDefault()
    activeId.value = flatItems.value[flatItems.value.length - 1]?.id || ''
    scrollActiveIntoView()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (activeId.value) select(activeId.value)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closePicker(true)
  } else if (event.key === 'Tab') {
    closePicker(false)
  }
}
</script>
<style scoped src="./AccountPlatformPicker.css"></style>
