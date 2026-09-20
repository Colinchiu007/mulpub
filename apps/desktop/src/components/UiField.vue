<template>
  <div
    class="ui-field"
    :class="{ 'ui-field--inline': inline, 'ui-field--error': !!error }"
    :aria-invalid="error ? 'true' : undefined"
  >
    <label v-if="label" class="ui-field-label" :for="forId">
      {{ label }}
      <span v-if="required" class="ui-field-required" aria-hidden="true">*</span>
    </label>
    <div class="ui-field-control">
      <slot />
      <slot name="suffix" />
    </div>
    <!-- 错误位常驻固定行高：错误出现/消失不得引起布局跳动 -->
    <p class="ui-field-error" :class="{ 'is-empty': !error }">{{ error || '' }}</p>
    <p v-if="hint" class="ui-field-hint">{{ hint }}</p>
  </div>
</template>

<script setup>
// 纯展示容器：不读取 inject，显隐由调用方决定（保持 s2vOptionVisible 单一来源）。
defineOptions({ name: 'UiField' });

defineProps({
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
  required: Boolean,
  forId: { type: String, default: '' },
  inline: Boolean,
});
</script>

<style scoped>
/* 只消费 tokens.css 的权威 --color-* 令牌。 */
.ui-field { display: flex; flex-direction: column; min-width: 0; gap: var(--spacing-1, 4px); }
.ui-field--inline { flex-direction: row; align-items: center; gap: var(--spacing-2, 8px); }
.ui-field--inline .ui-field-control { flex: 1 1 auto; min-width: 0; }
.ui-field-label { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text, var(--text)); }
.ui-field--inline .ui-field-label { white-space: nowrap; }
.ui-field-required { color: var(--color-danger, #ef5757); margin-left: 2px; }
.ui-field-control { min-width: 0; }
.ui-field-error { margin: 0; min-height: 18px; line-height: 18px; font-size: var(--font-size-xs); color: var(--color-danger, #ef5757); overflow-wrap: anywhere; }
.ui-field-error.is-empty { visibility: hidden; }
.ui-field-hint { margin: 0; font-size: var(--font-size-xs); color: var(--color-text-secondary, #707080); line-height: 1.4; }
.ui-field--error :deep(select),
.ui-field--error :deep(input),
.ui-field--error :deep(textarea) { border-color: var(--color-danger, #ef5757); }
</style>
