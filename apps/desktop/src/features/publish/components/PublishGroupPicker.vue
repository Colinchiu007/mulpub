<template>
  <!-- items 为空即整块不渲染：CI 像素门禁跑的是空 profile（无分组），
       空态若也渲染就是给 publish 视图制造必然的基线漂移；同时也不给用户一个点不动的死控件。 -->
  <div
    v-if="items.length > 0"
    class="group-picker"
    role="group"
    :aria-label="labelText"
    data-testid="publish-group-picker"
  >
    <span class="group-picker__label">{{ labelText }}</span>
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="group-picker__chip"
      :class="{ 'is-empty': item.total === 0, 'is-all-selected': isAllSelected(item) }"
      :disabled="disabled"
      :title="chipTitle(item)"
      :data-testid="`group-apply-${item.id}`"
      :aria-label="applyLabel(item)"
      @click="$emit('apply-group', item.id)"
    >
      <span class="group-picker__name">{{ item.name }}</span>
      <span class="group-picker__count" :data-testid="`group-apply-count-${item.id}`">{{ item.applicable }}/{{ item.total }}</span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import i18n from '@/i18n'

defineProps({
  /** `buildGroupPickerItems` 的产物：[{id,name,applicable,total,selected?}]。
   *  `selected`（publish-target-select-all）是该组当前已选中成员数，供 tooltip 做
   *  点击前预告；缺省时 tooltip 只显示组名与可添加数（与 P2-8b 行为一致）。 */
  items: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
})

defineEmits(['apply-group'])

const labelText = computed(() => i18n.global.t('publishPage.groupPicker.label'))

// 数字是「当前可添加 / 组成员总数」：不相等就说明有点下去加不上的成员，
// 用户不必等通知也能预判；但可添加数为 0 时仍渲染（禁用会把"组里号都停用了"
// 伪装成"按钮坏了"）。
function applyLabel (item) {
  return i18n.global.t('publishPage.groupPicker.applyAria', { name: item.name })
}

// 点击前预告（publish-target-select-all §2.3）：把 P2-8b 的播报文案前移到 hover。
// 「已选/成员」只有在上游真的给了 selected 时才出现——没有就不编一个 0，
// 那会把"没统计"显示成"一个都没选"。
function chipTitle (item) {
  const parts = [item.name]
  if (typeof item.selected === 'number') {
    parts.push(i18n.global.t('publishPage.groupPicker.selectedCount', {
      selected: item.selected,
      total: item.total,
    }))
  }
  return parts.join(' · ')
}

// 已全选的 chip 用视觉态标示，但**不禁用**：再点是幂等 no-op，
// 禁用会把"已经加过了"伪装成"按钮坏了"（P2-8b §七 同源理由）。
function isAllSelected (item) {
  return typeof item.selected === 'number'
    && item.total > 0
    && item.selected >= item.total
}
</script>

<style scoped>
.group-picker { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.group-picker__label { color: var(--muted, #73777d); font-size: var(--font-size-xs); font-weight: 600; }
.group-picker__chip { display: inline-flex; align-items: center; gap: 6px; max-width: 220px; padding: 3px 9px; border: 1px solid var(--border-light, #e0e0e0); border-radius: 999px; background: var(--surface, #fff); color: var(--text-primary, #202124); font-size: var(--font-size-xs); cursor: pointer; }
.group-picker__chip:hover:not(:disabled) { border-color: var(--action-blue, #1890ff); }
.group-picker__chip:disabled { cursor: not-allowed; opacity: 0.6; }
.group-picker__chip.is-empty { border-style: dashed; }
/* 已全选：只改边框色不改尺寸/不改布局（视觉态不是禁用态）。 */
.group-picker__chip.is-all-selected { border-color: var(--action-blue, #1890ff); background: color-mix(in srgb, var(--action-blue, #1890ff) 8%, var(--surface, #fff)); }
.group-picker__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-picker__count { color: var(--muted, #8a8f98); }
</style>
