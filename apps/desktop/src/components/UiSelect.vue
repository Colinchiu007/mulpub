<template>
  <div v-if="visible" class="ui-select-wrap">
    <label v-if="label" class="ui-select-label" :for="selectId">{{ label }}</label>
    <div class="ui-select-inner">
      <select
        :id="selectId"
        ref="selectEl"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? `${selectId}-error` : (hint ? `${selectId}-hint` : undefined)"
        :data-testid="testid"
        class="ui-select form-select"
        :class="{ 'is-error': !!error }"
        @change="onChange"
      >
        <option v-if="placeholder" value="" disabled selected>{{ placeholder }}</option>
        <slot>
          <option
            v-for="opt in options || []"
            :key="opt.value ?? opt"
            :value="opt.value ?? opt"
            :disabled="opt.disabled"
          >
            {{ opt.label ?? opt }}
          </option>
        </slot>
      </select>
      <span class="ui-select-arrow" aria-hidden="true">▾</span>
    </div>
    <p v-if="hint && !error" :id="`${selectId}-hint`" class="ui-select-hint">{{ hint }}</p>
    <p v-else-if="error" :id="`${selectId}-error`" class="ui-select-error" aria-live="polite">{{ error }}</p>
  </div>
</template>

<script setup>
// 详情页唯一合法的下拉控件：禁止再写裸 <select class="form-select">。
// 令牌纪律：只消费 tokens.css 的权威 --color-*，禁止 --apple-*（D2 决策）。
import { computed, inject, ref } from "vue";
import { S2V_PANEL_KEY } from "../views/video-creation/s2v-panel-contract";

defineOptions({ name: "UiSelect" });

const props = defineProps({
  modelValue: [String, Number, Boolean],
  // options 与默认 slot 二选一：既有调用方传数组，详情页的硬编码 <option> 走 slot。
  options: Array,
  placeholder: String,
  label: String,
  hint: String,
  error: String,
  disabled: Boolean,
  id: String,
  testid: String,
  // 运营后台隐藏守卫：为空时始终渲染；非空时走父子契约 s2vOptionVisible（fail-open），provider 缺失则 fail-closed 抛错。
  optionKey: { type: String, default: "" },
  // v-model.number / .trim 在自定义组件上不会自动生效，需显式接收并应用。
  modelModifiers: { type: Object, default: () => ({}) },
});
const emit = defineEmits(["update:modelValue", "change"]);

const panel = props.optionKey ? inject(S2V_PANEL_KEY) : null;
if (props.optionKey && !panel) {
  throw new Error(`[UiSelect] optionKey="${props.optionKey}" 需要父级 provide ${S2V_PANEL_KEY}，当前未提供`);
}
const visible = computed(() => {
  if (!props.optionKey) return true;
  const fn = panel?.fns?.s2vOptionVisible;
  return typeof fn === "function" ? Boolean(fn(props.optionKey)) : true;
});

const selectEl = ref(null);
const autoId = `ui-select-${Math.random().toString(36).slice(2, 8)}`;
const selectId = computed(() => props.id || autoId);

// Vue 编译 <option :value="24"> / :value="false" 时把原始类型挂在 el._value 上，el.value 只能拿到字符串。
// 必须按 Vue vModelSelect 同款算法回读，否则布尔 / 数值选项会被降级成字符串（字幕开关、水印透明度、fps 都会写坏）。
const readOptionValue = (option) => (option && "_value" in option ? option._value : option.value);
const applyModifiers = (value) => {
  let next = value;
  if (typeof next === "string") {
    if (props.modelModifiers.trim) next = next.trim();
    if (props.modelModifiers.number) next = next === "" ? "" : Number(next);
  }
  return next;
};
const onChange = (event) => {
  const el = event.target;
  const selected = Array.prototype.filter.call(el.options, (o) => o.selected).map(readOptionValue);
  const value = el.multiple ? selected : selected[0];
  emit("update:modelValue", applyModifiers(value));
  emit("change", event);
};

defineExpose({ selectEl });
</script>

<style scoped>
.ui-select-wrap { margin-bottom: var(--spacing-3, 12px); }
.ui-select-label {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text-secondary, #707080);
  margin-bottom: var(--spacing-1, 4px);
}
.ui-select-inner {
  position: relative;
}
.ui-select {
  width: 100%;
  padding: 8px 30px 8px 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--color-border, #efefef);
  font-size: var(--font-size-sm);
  outline: none;
  background: var(--color-bg-card, #fff);
  color: var(--color-text-strong, #1e1b4b);
  cursor: pointer;
  transition: border-color 0.15s cubic-bezier(0.33, 1, 0.68, 1),
              box-shadow 0.15s cubic-bezier(0.33, 1, 0.68, 1);
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
}
.ui-select:hover:not(:disabled) { border-color: var(--color-primary); }
.ui-select:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 14%, transparent);
}
.ui-select:focus-visible {
  outline: 2px solid var(--color-primary-dark-tint);
  outline-offset: 2px;
}
.ui-select:disabled { opacity: 0.5; cursor: not-allowed; background: var(--color-bg-muted, #f6f6f8); }
.ui-select.is-error,
.ui-select.is-error:focus { border-color: var(--color-danger, #ef5757); box-shadow: none; }
.ui-select-arrow {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-muted, #9898a8);
  pointer-events: none;
  font-size: var(--font-size-sm);
}
.ui-select-hint {
  margin: var(--spacing-1, 4px) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted, #9898a8);
}
.ui-select-error {
  margin: var(--spacing-1, 4px) 0 0;
  min-height: 18px;
  line-height: 18px;
  font-size: var(--font-size-xs);
  color: var(--color-danger, #ef5757);
}
.ui-select-error.is-empty { visibility: hidden; }
</style>
