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
    <span v-if="count > 0" class="collection-tab-badge" data-testid="collection-tab-drafts-badge">{{ badgeText }}</span>
  </button>
</template>

<script setup>
/**
 * CollectionDraftsTab.vue — 采集页的「草稿箱」页签按钮
 *
 * 与 `QuickCollectTab.vue` / `CollectionCreatorTab.vue` 同一手法：
 * `Collection.vue` 是 `check-max-lines` targets **零容差**文件，页签的模板与
 * 角标逻辑全部收在这里，`Collection.vue` 只付出 1 行 import + 1 行标签。
 *
 * 角标显示草稿条数，与博主监控页签的 `pending` 角标同款，为 0 时不渲染
 * （不留空壳 —— 见 Collection.test.js 中「角标为 0 时不渲染徽标」回归锁）。
 *
 * 2026-10-17 collection-page-ui-ue-refine：`collection-tab-badge` 此前全仓
 * 无定义（本组件与 CreatorTab 都在渲染它）⇒ 角标是裸文本、无底色无圆角。
 * 定义已补进 collection-page.css；同时补 >99 截断为 `99+` —— 三位数以上会把
 * 药盒状页签容器撑宽，且「137」与「99+」对用户决策没有区别。
 */
import { computed } from 'vue'

const props = defineProps({
  active: { type: Boolean, default: false },
  count: { type: Number, default: 0 },
})
defineEmits(['select'])

/** 角标文案：>99 截断（保持页签容器宽度稳定） */
const badgeText = computed(() => (props.count > 99 ? '99+' : String(props.count)))
</script>
