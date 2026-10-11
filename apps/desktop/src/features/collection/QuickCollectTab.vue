<template>
  <button
    role="tab"
    :aria-selected="active"
    class="collection-tab-btn"
    :class="{ active }"
    data-testid="collection-tab-quick-collect"
    @click="$emit('select')"
  >
    {{ $t('collection.quickCollectTab') }}
  </button>
</template>

<script setup>
/**
 * QuickCollectTab.vue — 采集页的「快捷采集」页签按钮
 *
 * 独立成组件的原因与 `CollectionCreatorTab.vue` 相同：`Collection.vue` 是
 * `check-max-lines` 的 targets 零容差文件（2920 行），每加一行都在推高存量债。
 * 本组件把页签的模板与文案全部收在目录内，`Collection.vue` 只付出 1 行 import + 1 行标签。
 */
defineProps({
  active: { type: Boolean, default: false },
})
defineEmits(['select'])
</script>
