<template>
  <UiModal
    v-if="visible"
    :visible="visible"
    :title="t('publishPage.topicTag.managerTitle')"
    size="lg"
    test-id="topic-tag-manager-dialog"
    :close-on-esc="true"
    @close="requestClose"
  >
    <div class="ttm-subtitle">{{ t('publishPage.topicTag.managerSubtitle') }}</div>

    <input
      v-model="searchText"
      data-testid="topic-tag-search"
      class="ttm-search"
      type="text"
      :placeholder="t('publishPage.topicTag.searchPlaceholder')"
    >

    <div v-if="groups.length === 0" class="ttm-empty">
      {{ t('publishPage.topicTag.emptyGroups') }}
    </div>
    <div v-else-if="filteredGroups.length === 0" class="ttm-empty">
      {{ t('publishPage.topicTag.emptySearch') }}
    </div>

    <div
      v-for="group in filteredGroups"
      v-else
      :key="group.id"
      class="ttm-group"
      data-testid="topic-tag-group"
    >
      <div class="ttm-group-header">
        <span class="ttm-group-name">{{ group.name }}</span>
        <span class="ttm-group-count">{{ group.topics.length }}</span>
      </div>
      <div class="ttm-chips">
        <button
          v-for="topic in group.topics"
          :key="topic"
          type="button"
          class="ttm-chip"
          data-testid="topic-tag-chip"
          :class="{ selected: selected.has(topic) }"
          @click="toggleTopic(topic)"
        >{{ topic }}</button>
      </div>
      <label class="ttm-select-all">
        <input
          type="checkbox"
          data-testid="topic-tag-group-select-all"
          :checked="isGroupAllSelected(group)"
          @change="toggleGroupAll(group)"
        >
        <span>{{ t('publishPage.topicTag.selectAllGroup') }}</span>
      </label>
    </div>

    <!-- 新建分组：弹内联输入（弹窗内不套第二层模态） -->
    <div v-if="creatingGroup" class="ttm-new-group-row">
      <input
        ref="newGroupInputRef"
        v-model="newGroupName"
        data-testid="topic-tag-new-group-input"
        class="ttm-search"
        type="text"
        :placeholder="t('publishPage.topicTag.newGroupPlaceholder')"
        @keydown.enter.prevent="confirmNewGroup"
        @keydown.esc="cancelNewGroup"
      >
      <UiButton size="sm" data-testid="topic-tag-new-group-confirm" @click="confirmNewGroup">
        {{ t('publishPage.topicTag.newGroupConfirm') }}
      </UiButton>
      <UiButton size="sm" variant="ghost" @click="cancelNewGroup">{{ t('publishPage.coverCrop.cancel') }}</UiButton>
      <span v-if="newGroupError" class="ttm-error">{{ newGroupError }}</span>
    </div>

    <template #footer>
      <div class="ttm-footer">
        <UiButton variant="ghost" size="sm" data-testid="topic-tag-new-group" @click="startNewGroup">
          + {{ t('publishPage.topicTag.newGroup') }}
        </UiButton>
        <div class="ttm-footer-spacer"></div>
        <span class="ttm-selected-count">{{ t('publishPage.topicTag.selectedCount', { count: selected.size }) }}</span>
        <UiButton
          data-testid="topic-tag-apply"
          :disabled="selected.size === 0"
          @click="applySelected"
        >
          {{ t('publishPage.topicTag.apply') }}
        </UiButton>
      </div>
    </template>
  </UiModal>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from './UiButton.vue'
import UiModal from './UiModal.vue'
import { releaseEmbeddedViewsForOverlay, suspendEmbeddedViewsForOverlay } from '@/composables/useEmbeddedViewSuspension'
import { loadTopicTagPresets, saveTopicTagPresets } from '@/features/publish/topic-tag-presets'

const props = defineProps({
  visible: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'apply'])
const { t } = useI18n()

// 应用级浮层互斥合同（overlay-view-suspension）：内嵌 WebContentsView 是原生图层，
// 不挂起会被浏览器/登录标签整块盖住。owner 登记：topic-tag-manager-dialog。
// generation 守卫：suspend IPC 在途时组件卸载（onBeforeUnmount 先 release），
// 迟到 resolve 的 suspend 不得再落 owner——否则挂起计数永久泄漏。
const OVERLAY_OWNER = 'topic-tag-manager-dialog'
let overlayHeld = false
let overlayGeneration = 0

async function suspendOverlay () {
  const generation = ++overlayGeneration
  try {
    const ok = await suspendEmbeddedViewsForOverlay(OVERLAY_OWNER)
    // 在途期间发生了 release/卸载（generation 已变）：立即补偿释放，防计数泄漏
    if (ok && generation !== overlayGeneration) {
      await releaseEmbeddedViewsForOverlay(OVERLAY_OWNER)
      return
    }
    if (ok) overlayHeld = true
  } catch (_) { /* 挂起失败不阻断浮层本身（composable 内部已降级） */ }
}

async function releaseOverlay () {
  overlayGeneration++
  if (!overlayHeld) return
  overlayHeld = false
  await releaseEmbeddedViewsForOverlay(OVERLAY_OWNER)
}

// 弹窗内临时态：每次打开重建（勾选不跨会话、不持久化）
const groups = ref([])
const searchText = ref('')
const selected = ref(new Set())
const creatingGroup = ref(false)
const newGroupName = ref('')
const newGroupError = ref('')
const newGroupInputRef = ref(null)

function rebuildState () {
  groups.value = loadTopicTagPresets().groups
  searchText.value = ''
  selected.value = new Set()
  creatingGroup.value = false
  newGroupName.value = ''
  newGroupError.value = ''
}

// 搜索过滤（PRD §4.3）：大小写不敏感子串；命中分组名显示该组全部话题，
// 命中话题名保留该组（仅显示命中话题），两者都不命中隐藏该组。
const filteredGroups = computed(() => {
  const query = searchText.value.trim().toLowerCase()
  if (!query) return groups.value
  return groups.value
    .map(group => {
      if (group.name.toLowerCase().includes(query)) return group
      const topics = group.topics.filter(topic => topic.toLowerCase().includes(query))
      return topics.length > 0 ? { ...group, topics } : null
    })
    .filter(Boolean)
})

function toggleTopic (topic) {
  const next = new Set(selected.value)
  if (next.has(topic)) next.delete(topic)
  else next.add(topic)
  selected.value = next
}

function isGroupAllSelected (group) {
  return group.topics.length > 0 && group.topics.every(topic => selected.value.has(topic))
}

function toggleGroupAll (group) {
  const next = new Set(selected.value)
  const allSelected = isGroupAllSelected(group)
  for (const topic of group.topics) {
    if (allSelected) next.delete(topic)
    else next.add(topic)
  }
  selected.value = next
}

function startNewGroup () {
  creatingGroup.value = true
  newGroupName.value = ''
  newGroupError.value = ''
  nextTick(() => newGroupInputRef.value?.focus())
}

function cancelNewGroup () {
  creatingGroup.value = false
  newGroupError.value = ''
}

function confirmNewGroup () {
  const name = newGroupName.value.trim()
  if (!name) {
    newGroupError.value = t('publishPage.topicTag.groupNameEmpty')
    return
  }
  if (groups.value.some(group => group.name.toLowerCase() === name.toLowerCase())) {
    newGroupError.value = t('publishPage.topicTag.groupNameDuplicate')
    return
  }
  const next = [{ name, topics: [] }, ...groups.value]
  if (saveTopicTagPresets(next)) {
    groups.value = loadTopicTagPresets().groups
  }
  cancelNewGroup()
}

function applySelected () {
  if (selected.value.size === 0) return
  emit('apply', [...selected.value])
  emit('close')
}

function requestClose () {
  emit('close')
}

// 打开重建临时态 + 挂起；关闭释放。immediate 覆盖「以 visible=true 首次挂载」。
watch(() => props.visible, (open) => {
  if (open) {
    rebuildState()
    suspendOverlay()
  } else {
    releaseOverlay()
  }
}, { immediate: true })

// 卸载兜底：父组件直接 v-if 掉本组件时不经过 visible=false（浮层互斥合同要求）。
onBeforeUnmount(() => { releaseOverlay() })
</script>

<style scoped>
.ttm-subtitle { margin: 0 0 var(--spacing-3); font-size: var(--font-size-sm); color: var(--muted); }
.ttm-search {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-3);
}
.ttm-empty { padding: 24px 12px; text-align: center; color: var(--muted); font-size: var(--font-size-sm); }
.ttm-group { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--spacing-3) var(--spacing-4); margin-bottom: var(--spacing-3); }
.ttm-group-header { display: flex; align-items: center; gap: 8px; margin-bottom: var(--spacing-2); }
.ttm-group-name { font-weight: 600; font-size: var(--font-size-sm); }
.ttm-group-count { font-size: var(--font-size-xs); color: var(--muted); }
.ttm-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: var(--spacing-2); }
.ttm-chip {
  padding: 4px 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-bg-card);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}
.ttm-chip:hover { border-color: var(--coral); }
.ttm-chip.selected { background: var(--coral); border-color: var(--coral); color: #fff; }
.ttm-select-all { display: flex; align-items: center; gap: 6px; font-size: var(--font-size-sm); color: var(--muted); cursor: pointer; }
.ttm-new-group-row { display: flex; align-items: center; gap: 8px; margin-top: var(--spacing-2); }
.ttm-new-group-row .ttm-search { flex: 1; margin-bottom: 0; }
.ttm-error { font-size: var(--font-size-xs); color: var(--color-danger); white-space: nowrap; }
.ttm-footer { display: flex; align-items: center; gap: var(--spacing-2); width: 100%; }
.ttm-footer-spacer { flex: 1; }
.ttm-selected-count { font-size: var(--font-size-sm); color: var(--muted); }
</style>
