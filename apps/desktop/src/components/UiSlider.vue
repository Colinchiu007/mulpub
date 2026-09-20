<template>
  <div class="ui-slider" :class="{ 'is-disabled': disabled }">
    <div class="ui-slider-head">
      <label v-if="label" class="ui-slider-label" :for="inputId">{{ label }}</label>
      <span v-else aria-hidden="true"></span>
      <span class="ui-slider-value" :data-testid="testid ? testid + '-value' : undefined">{{ displayValue }}</span>
    </div>
    <input
      :id="inputId"
      ref="rangeEl"
      class="ui-slider-input"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="clamped"
      :disabled="disabled"
      :data-testid="testid"
      :style="{ '--pct': pct + '%' }"
      :aria-valuetext="displayValue"
      @input="onInput"
      @change="onChange"
      @dblclick="resetToDefault"
      @keydown="onKeydown"
    />
    <div v-if="marks && marks.length" class="ui-slider-marks" aria-hidden="true">
      <span
        v-for="m in marks"
        :key="m.value"
        class="ui-slider-mark"
        :style="{ left: markOffset(m.value) + '%' }"
      >{{ m.label }}</span>
    </div>
    <p v-if="hint" class="ui-slider-hint">{{ hint }}</p>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';

defineOptions({ name: 'UiSlider' });

const props = defineProps({
  modelValue: { type: [Number, String], required: true },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  label: { type: String, default: '' },
  suffix: { type: String, default: '' },
  defaultValue: { type: Number, default: null },
  disabled: Boolean,
  marks: { type: Array, default: () => [] },
  hint: { type: String, default: '' },
  testid: { type: String, default: '' },
  id: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue', 'change']);

const rangeEl = ref(null);
const inputId = computed(() => props.id || `ui-slider-${Math.round((props.defaultValue ?? props.min) * 1000)}-${props.min}-${props.max}`);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : props.min;
};
const clamp = (v) => Math.min(props.max, Math.max(props.min, v));

// 越界值一律回落区间内，避免滑杆显示与语义脱节（fail-safe，不抛错）。
const clamped = computed(() => clamp(num(props.modelValue)));

// 小数位由步长推导：0.1 -> 1 位，0.05 -> 2 位，1 -> 0 位。
const decimals = computed(() => {
  const s = String(props.step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
});

const displayValue = computed(() => {
  const text = clamped.value.toFixed(decimals.value);
  return props.suffix ? `${text}${props.suffix}` : text;
});

const pct = computed(() => {
  const span = props.max - props.min;
  if (span <= 0) return 0;
  return ((clamped.value - props.min) / span) * 100;
});

const markOffset = (v) => {
  const span = props.max - props.min;
  if (span <= 0) return 0;
  return ((clamp(num(v)) - props.min) / span) * 100;
};

const write = (v, commit) => {
  const next = clamp(Math.round(v / props.step) * props.step);
  // 浮点步长乘除会带来 0.30000000000000004 之类尾差，按小数位归一后再回传。
  const fixed = Number(next.toFixed(decimals.value + 2));
  if (fixed !== clamped.value) emit('update:modelValue', fixed);
  if (commit) emit('change', fixed);
};

const onInput = (e) => write(num(e.target.value), false);
const onChange = (e) => write(num(e.target.value), true);

const resetToDefault = () => {
  if (props.disabled || props.defaultValue === null) return;
  write(num(props.defaultValue), true);
};

// 原生 range 的 PageUp/PageDown 步长等于 step，此处提升 10 倍以满足粗调需求。
const onKeydown = (e) => {
  if (props.disabled) return;
  const big = props.step * 10;
  if (e.key === 'PageUp') { e.preventDefault(); write(clamped.value + big, true); }
  else if (e.key === 'PageDown') { e.preventDefault(); write(clamped.value - big, true); }
  else if (e.key === 'Home') { e.preventDefault(); write(props.min, true); }
  else if (e.key === 'End') { e.preventDefault(); write(props.max, true); }
  else if (e.altKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); resetToDefault(); }
};

defineExpose({ resetToDefault, inputEl: rangeEl });
</script>

<style scoped>
/* 只消费 tokens.css 的权威 --color-* 令牌，禁止 @deprecated 的 --apple-*。 */
.ui-slider { display: flex; flex-direction: column; gap: var(--spacing-1, 4px); min-width: 0; }
.ui-slider-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--spacing-2, 8px); }
.ui-slider-label { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text, var(--text)); }
.ui-slider-value { font-size: var(--font-size-sm); color: var(--color-text-secondary, #707080); font-variant-numeric: tabular-nums; white-space: nowrap; }

.ui-slider-input {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 18px;
  margin: 0;
  background: transparent;
  cursor: pointer;
}
.ui-slider-input::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: var(--radius-full, 9999px);
  background: linear-gradient(
    to right,
    var(--color-primary, #5048E5) 0 var(--pct, 0%),
    var(--color-border, #efefef) var(--pct, 0%) 100%
  );
}
.ui-slider-input::-moz-range-track { height: 4px; border-radius: var(--radius-full, 9999px); background: var(--color-border, #efefef); }
.ui-slider-input::-moz-range-progress { height: 4px; border-radius: var(--radius-full, 9999px); background: var(--color-primary, #5048E5); }
.ui-slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6px;
  border: 1px solid var(--color-primary, #5048E5);
  border-radius: 50%;
  background: var(--color-bg-card, #fff);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: transform 0.15s cubic-bezier(0.33, 1, 0.68, 1);
}
.ui-slider-input::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 1px solid var(--color-primary, #5048E5);
  border-radius: 50%;
  background: var(--color-bg-card, #fff);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}
.ui-slider-input:hover:not(:disabled)::-webkit-slider-thumb { transform: scale(1.08); }
.ui-slider-input:focus { outline: none; }
.ui-slider-input:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--color-primary-dark-tint, #7b74ff); outline-offset: 2px; }
.ui-slider-input:focus-visible::-moz-range-thumb { outline: 2px solid var(--color-primary-dark-tint, #7b74ff); outline-offset: 2px; }
.is-disabled .ui-slider-input { cursor: not-allowed; opacity: 0.5; }

.ui-slider-marks { position: relative; height: 14px; }
.ui-slider-mark { position: absolute; transform: translateX(-50%); font-size: var(--font-size-xs); color: var(--color-text-muted, #86868b); white-space: nowrap; }
.ui-slider-hint { margin: 0; font-size: var(--font-size-xs); color: var(--color-text-secondary, #707080); line-height: 1.4; }

@media (prefers-reduced-motion: reduce) {
  .ui-slider-input::-webkit-slider-thumb { transition: none; }
  .ui-slider-input:hover:not(:disabled)::-webkit-slider-thumb { transform: none; }
}
</style>
