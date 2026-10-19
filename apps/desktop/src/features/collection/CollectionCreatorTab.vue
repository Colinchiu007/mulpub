<template>
  <button
    role="tab"
    :aria-selected="active"
    class="collection-tab-btn"
    :class="{ active }"
    data-testid="collection-tab-creator"
    @click="$emit('select')"
  >
    {{ $t('collection.creatorTab') }}
    <span v-if="pending > 0" class="collection-tab-badge" data-testid="collection-tab-creator-badge">{{ badgeText }}</span>
  </button>
</template>

<script setup>
/**
 * CollectionCreatorTab.vue — 采集页的「博主监控」页签按钮
 *
 * ## 为什么独立成组件
 *
 * `Collection.vue` 是 2920 行的存量挂账文件（登记值 2721、容差 200），
 * 而 main 上已有 **199 行未登记的历史漂移** —— 容差已被上游吃光。
 * 本特性每往里加一行都在把这条债推得更深，CI 会以
 * `LEDGER_GREW: 膨胀 2xx 行` 拦下，而那**不是本 PR 造成的**。
 *
 * 按仓库铁律（`check-max-lines` 的 `LEDGER_GREW` 处置），
 * 存量债的正解是**拆分**而不是 `--update` 把当前行数洗成新基线：
 * 挂账等于承认「接受漂移」，且会把别人那 199 行一并合法化。
 *
 * 因此本特性对 `Collection.vue` 的净增量压到 **1 行**（本组件的 import），
 * 其余全部收在这里。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCreatorPendingTotal } from '@/composables/useCreatorPendingTotal'

const props = defineProps({
  active: { type: Boolean, default: false },
})
defineEmits(['select'])

const { t } = useI18n()
const { creatorPendingTotal } = useCreatorPendingTotal()

const pending = computed(() => creatorPendingTotal.value)

/** 角标文案：>99 截断为 99+（2026-10-17 collection-page-ui-ue-refine，
 *  与 CollectionDraftsTab 同口径；三位数以上会撑宽药盒状页签容器）。 */
const badgeText = computed(() => (pending.value > 99 ? '99+' : String(pending.value)))
</script>
