<template>
  <div class="word-count-inputs">
    <span class="word-count-label">{{ label }}</span>
    <input
      :value="min"
      type="number"
      class="cohere-input word-count-input"
      min="0"
      max="5999"
      :placeholder="minPlaceholder"
      :disabled="disabled"
      @input="$emit('update:min', toNumber($event.target.value))"
    />
    <span class="word-count-sep">-</span>
    <input
      :value="max"
      type="number"
      class="cohere-input word-count-input"
      min="1"
      max="6000"
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
 */
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
.word-count-inputs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.word-count-label {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.word-count-input {
  width: 80px;
  padding: 4px 8px;
  font-size: 13px;
}
.word-count-sep {
  color: var(--muted);
}
.word-count-unit {
  font-size: 13px;
  color: var(--muted);
}
.word-count-error {
  font-size: 12px;
  color: #d32f2f;
}
</style>
