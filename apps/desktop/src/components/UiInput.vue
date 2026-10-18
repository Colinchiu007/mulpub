<template>
  <div class="ui-input-wrap">
    <label v-if="label" class="ui-input-label">{{ label }}</label>
    <input
      v-if="type !== 'textarea'"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :maxlength="maxlength"
      class="ui-input"
      @input="$emit('update:modelValue', $event.target.value)"
      @focus="$emit('focus', $event)"
      @blur="$emit('blur', $event)"
    />
    <textarea
      v-else
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :rows="rows"
      :maxlength="maxlength"
      class="ui-input ui-textarea"
      @input="$emit('update:modelValue', $event.target.value)"
    ></textarea>
    <p v-if="hint" class="ui-input-hint">{{ hint }}</p>
  </div>
</template>

<script setup>
defineProps({
  modelValue: [String, Number],
  label: String,
  type: { type: String, default: "text" },
  placeholder: String,
  hint: String,
  disabled: Boolean,
  rows: { type: Number, default: 4 },
  // 原生 maxlength：无此 prop 时 input 上的 maxlength 会落到根 div（属性透传不进门），
  // 即「写了但不生效」—— publish-title 的字数上限正是靠这一条真正拦住输入。
  maxlength: { type: [Number, String], default: undefined },
});
defineEmits(["update:modelValue", "focus", "blur"]);
</script>

<style scoped>
.ui-input {
  width: 100%;
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  font-family: var(--font-family-text);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: var(--color-bg-card);
  transition: border-color var(--duration-fast) var(--ease-default),
              box-shadow var(--duration-fast) var(--ease-default);
  outline: none;
}
.ui-input::placeholder {
  color: var(--color-text-muted);
}
.ui-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-info-soft);
}
.ui-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--color-bg-inset);
}
</style>