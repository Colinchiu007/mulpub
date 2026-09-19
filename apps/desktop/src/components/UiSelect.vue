<template>
  <div class="ui-select-wrap">
    <label v-if="label" class="ui-select-label">{{ label }}</label>
    <div class="ui-select-inner">
      <select
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        class="ui-select"
        @change="$emit('update:modelValue', $event.target.value)"
      >
        <option v-if="placeholder" value="" disabled selected>{{ placeholder }}</option>
        <option
          v-for="opt in options"
          :key="opt.value ?? opt"
          :value="opt.value ?? opt"
          :disabled="opt.disabled"
        >
          {{ opt.label ?? opt }}
        </option>
      </select>
      <span class="ui-select-arrow">▾</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  modelValue: [String, Number],
  options: { type: Array, required: true },
  placeholder: String,
  label: String,
  disabled: Boolean,
});
defineEmits(["update:modelValue"]);
</script>

<style scoped>
.ui-select-wrap { margin-bottom: var(--apple-space-3); }
.ui-select-label {
  display: block;
  font-size: var(--apple-size-sm);
  font-weight: var(--apple-weight-semibold);
  color: var(--apple-ink-primary);
  margin-bottom: var(--apple-space-1);
}
.ui-select-inner {
  position: relative;
}
.ui-select {
  width: 100%;
  padding: var(--apple-space-2) var(--apple-space-8) var(--apple-space-2) var(--apple-space-3);
  border-radius: var(--apple-radius-sm);
  border: 1px solid var(--apple-border);
  font-size: var(--apple-size-sm);
  font-family: var(--apple-font-text);
  outline: none;
  background: var(--apple-surface-primary);
  color: var(--apple-ink-primary);
  cursor: pointer;
  transition: border-color var(--apple-duration-fast) var(--apple-ease-default),
              box-shadow var(--apple-duration-fast) var(--apple-ease-default);
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
}
.ui-select:focus {
  border-color: var(--apple-accent);
  box-shadow: 0 0 0 2px var(--apple-info-bg);
}
.ui-select:disabled { opacity: 0.5; cursor: not-allowed; background: var(--apple-surface-secondary); }
.ui-select-arrow {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--apple-ink-tertiary);
  pointer-events: none;
  font-size: 14px;
}
</style>