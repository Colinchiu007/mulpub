<template>
  <div class="col-progress-box" :data-testid="testid">
    <div class="col-progress-title">{{ title }}</div>
    <div class="col-progress-track">
      <div class="col-progress-fill" :style="{ width: Math.min(100, Math.max(0, percent)) + '%' }"></div>
    </div>
    <div class="col-progress-text">{{ text }}</div>
    <div v-if="summary" class="col-progress-summary" data-testid="zhihu-fav-summary">{{ summary }}</div>
    <button v-if="detailLines && detailLines.length" type="button" class="cohere-btn-secondary col-progress-detail-btn" @click="detailOpen = !detailOpen">
      {{ detailLabel }}（{{ detailLines.length }}）
    </button>
    <div v-if="detailOpen && detailLines && detailLines.length" class="col-progress-detail">
      <div v-for="(line, i) in detailLines" :key="i" class="col-progress-line">{{ line }}</div>
    </div>
    <button v-if="cancelable" type="button" class="cohere-btn-secondary col-progress-cancel" @click="$emit('cancel')">
      {{ cancelLabel }}
    </button>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  title: { type: String, required: true },
  percent: { type: Number, default: 0 },
  text: { type: String, default: '' },
  summary: { type: String, default: '' },
  cancelable: { type: Boolean, default: false },
  detailLines: { type: Array, default: null },
  testid: { type: String, default: '' },
})

defineEmits(['cancel'])

const { t } = useI18n()
const detailOpen = ref(false)
const detailLabel = computed(() => (detailOpen.value ? t('collection.zhihuFavlist.collapseDetail') : t('collection.zhihuFavlist.expandDetail')))
const cancelLabel = computed(() => t('collection.cancelBatch'))
</script>

<style scoped>
.col-progress-box { margin-top: var(--space-sm); padding: var(--space-sm); background: var(--color-bg-inset); border-radius: var(--r-xs, 6px); }
.col-progress-title { font-weight: 600; font-size: var(--font-size-sm); margin-bottom: 4px; }
.col-progress-track { background: var(--color-progress-track); border-radius: var(--r-xs, 6px); height: 8px; overflow: hidden; margin-bottom: 4px; }
.col-progress-fill { background: var(--color-primary); height: 100%; transition: width 0.3s; }
.col-progress-text { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.col-progress-summary { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: 4px; }
.col-progress-detail-btn { margin-top: 6px; font-size: var(--font-size-xs); }
.col-progress-detail { margin-top: 6px; max-height: 200px; overflow-y: auto; font-size: var(--font-size-xs); }
.col-progress-line { padding: 2px 0; }
.col-progress-cancel { margin-top: 6px; font-size: var(--font-size-xs); }
</style>
