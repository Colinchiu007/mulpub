<template>
  <div class="word-count-inputs">
    <span class="word-count-label">{{ label }}</span>
    <input
      :value="min"
      type="number"
      class="cohere-input word-count-input"
      :min="0"
      :max="REWRITE_ENGINE_MAX_INPUT_CHARS - 1"
      :placeholder="minPlaceholder"
      :disabled="disabled"
      @input="$emit('update:min', toNumber($event.target.value))"
    />
    <span class="word-count-sep">-</span>
    <input
      :value="max"
      type="number"
      class="cohere-input word-count-input"
      :min="1"
      :max="REWRITE_ENGINE_MAX_OUTPUT_CHARS"
      :placeholder="maxPlaceholder"
      :disabled="disabled"
      @input="$emit('update:max', toNumber($event.target.value))"
    />
    <span class="word-count-unit">{{ unit }}</span>
    <span v-if="error" class="word-count-error">{{ error }}</span>
  </div>
</template>

<script setup>
/**
 * 字数区间输入（文案改写页 / 采集页共用）
 * min/max 双向绑定 + 校验错误展示；校验逻辑在 useWordCountValidation composable。
 * 原生 min/max 属性同步读上限常量（rewrite-limits-50000，2026-10-19）：
 * 写死 5999/6000 会让鼠标 spinner 用户无法设到 50000（QM-6 Claude 轴 MINOR-2）。
 */
import { REWRITE_ENGINE_MAX_INPUT_CHARS, REWRITE_ENGINE_MAX_OUTPUT_CHARS } from '@/utils/rewrite-engine-limits'
defineProps({
  label: { type: String, default: '' },
  min: { type: [Number, String], default: 800 },
  max: { type: [Number, String], default: 2000 },
  minPlaceholder: { type: String, default: '' },
  maxPlaceholder: { type: String, default: '' },
  unit: { type: String, default: '' },
  error: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})

defineEmits(['update:min', 'update:max'])

// v-model.number 语义：清空时回 ''，其余转数字
function toNumber(v) {
  if (v === '') return ''
  const n = Number(v)
  return Number.isNaN(n) ? '' : n
}
</script>

<style scoped>
/* 2026-10-17 collection-page-ui-ue-refine：错误字色 #d32f2f 是亮色硬编码
 * （暗色下对比不足且不在任何 hex 门禁内），收编为 --color-error-banner-text。 */
.word-count-inputs {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  flex-wrap: wrap;
}
.word-count-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  white-space: nowrap;
}
.word-count-input {
  width: 80px;
  height: var(--col-field-h-sm);
  padding: 0 var(--spacing-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-sm);
}
.word-count-input:focus {
  border-color: var(--color-primary);
  outline: none;
  box-shadow: 0 0 0 2px var(--color-primary-light);
}
.word-count-sep {
  color: var(--color-text-muted);
}
.word-count-unit {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.word-count-error {
  font-size: var(--font-size-xs);
  color: var(--color-error-banner-text);
}
</style>
