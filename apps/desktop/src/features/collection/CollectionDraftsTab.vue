<template>
  <button
    role="tab"
    :aria-selected="active"
    class="collection-tab-btn"
    :class="{ active }"
    data-testid="collection-tab-drafts"
    @click="$emit('select')"
  >
    {{ $t('collection.draftsTab') }}
    <span v-if="count > 0" class="collection-tab-badge" data-testid="collection-tab-drafts-badge">{{ count }}</span>
  </button>
</template>

<script setup>
/**
 * CollectionDraftsTab.vue — 采集页的「草稿箱」页签按钮
 *
 * 与 `QuickCollectTab.vue` / `CollectionCreatorTab.vue` 同一手法：
 * `Collection.vue` 是 `check-max-lines` targets **零容差**文件（2920 行），
 * 页签的模板与角标逻辑全部收在这里，`Collection.vue` 只付出 1 行 import + 1 行标签。
 *
 * 角标显示草稿条数，与博主监控页签的 `pending` 角标同款，为 0 时不渲染
 * （不留空壳 —— 见 Collection.test.js 中「角标为 0 时不渲染徽标」回归锁）。
 */
defineProps({
  active: { type: Boolean, default: false },
  count: { type: Number, default: 0 },
})
defineEmits(['select'])
</script>
