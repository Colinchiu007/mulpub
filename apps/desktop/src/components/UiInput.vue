<template>
  <div class="ui-input-wrap">
    <label v-if="label" class="ui-input-label" :for="controlId || undefined">{{ label }}</label>
    <input
      v-if="type !== 'textarea'"
      :id="controlId || undefined"
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
      :id="controlId || undefined"
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
import { computed, inject, useId } from "vue";
import { UI_FIELD_CONTROL_ID } from "./uiFieldControlId";

const props = defineProps({
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
  // 显式 id：调用方自己管关联时用它。不传时控件会生成一个稳定 id 并登记给外层 UiField，
  // 于是 `<label for>` 与控件的关联不再依赖"记得传 forId"（audit-29 / 阶段 4.3）。
  id: { type: String, default: "" },
});
defineEmits(["update:modelValue", "focus", "blur"]);

const channel = inject(UI_FIELD_CONTROL_ID, null);
const autoId = useId();
// 控件的 id 只由"自己显式传的 id"或"自己生成的稳定 id"决定 —— 不去读外层的标签目标，
// 否则同一个 UiField 里的第二个控件会复用第一个的 id（HTML 里重复 id，浏览器只关联到第一个）。
const controlId = computed(() => props.id || autoId);
// 登记发生在 setup：外层 UiField 的 label 于是与控件用同一个 id，
// 而不是像以前那样两边各写一份、其中一份常常是空的。
channel?.claim(controlId.value);
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