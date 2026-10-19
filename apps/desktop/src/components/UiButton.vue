<template>
  <component
    :is="tag"
    :class="classes"
    :disabled="isDisabled"
    :aria-disabled="isDisabled ? 'true' : undefined"
    :aria-busy="loading ? 'true' : undefined"
    :aria-label="ariaLabel || undefined"
    @click="onClick"
  >
    <span v-if="loading" class="ui-btn-spinner" aria-hidden="true"></span>
    <slot />
  </component>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  variant: { type: String, default: "primary" },
  size: { type: String, default: "md" },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  ariaLabel: { type: String, default: "" },
  tag: { type: String, default: "button" },
});

const emit = defineEmits(["click"]);

const isDisabled = computed(() => props.disabled || props.loading);

const classes = computed(() => [
  "ui-btn",
  "ui-btn-" + props.variant,
  "ui-btn-" + props.size,
  { "is-loading": props.loading },
]);

function onClick(event) {
  if (isDisabled.value) {
    event?.preventDefault?.();
    return;
  }
  emit("click", event);
}
</script>

<style scoped>
.ui-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-1);
  border: none;
  cursor: pointer;
  font-family: var(--font-family-text);
  font-weight: var(--font-weight-semibold);
  transition: all var(--duration-normal) var(--ease-default);
  text-decoration: none;
  line-height: 1;
}
.ui-btn:disabled { opacity: 0.5; cursor: not-allowed; }
/* 键盘焦点环（audit-25 / WCAG 2.4.7）：UiButton 根节点的 classes 恒含基类 ui-btn，
 * 所以一条基类规则即可覆盖全部 <UiButton> 用法（与 cohere 那族不同——那族模板只带变体类，
 * 见 styles/cohere-design-system.css 的 group selector 与 focus-ring.test.js 的清点判据）。
 * 颜色取 tokens.css 的 --color-focus-ring。 */
.ui-btn:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; transition: outline-color 0s, outline-width 0s, outline-offset 0s; }

.ui-btn.is-loading { opacity: 0.65; cursor: not-allowed; }

.ui-btn-spinner {
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ui-btn-spin 0.6s linear infinite;
}

@keyframes ui-btn-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ui-btn-spinner { animation: none; }
}

/* Sizes */
.ui-btn-sm { padding: var(--spacing-1) var(--spacing-3); font-size: var(--font-size-sm); border-radius: var(--radius-sm); }
.ui-btn-md { padding: var(--spacing-2) var(--spacing-5); font-size: var(--font-size-sm); border-radius: var(--radius-sm); }
.ui-btn-lg { padding: var(--spacing-3) var(--spacing-6); font-size: var(--font-size-base); border-radius: var(--radius-sm); }

/* Variants */
.ui-btn-primary { background: var(--color-primary); color: #fff; }
.ui-btn-primary:hover:not(:disabled) { background: var(--color-primary-hover); box-shadow: var(--shadow-sm); }

.ui-btn-secondary { background: transparent; color: var(--color-primary); border: 1px solid var(--color-primary); }
.ui-btn-secondary:hover:not(:disabled) { background: var(--color-info-soft); }

.ui-btn-ghost { background: transparent; color: var(--color-text-secondary); }
.ui-btn-ghost:hover:not(:disabled) { background: var(--color-bg-inset); color: var(--color-text-primary); }

.ui-btn-danger { background: var(--color-danger); color: #fff; }
.ui-btn-danger:hover:not(:disabled) { opacity: 0.85; box-shadow: var(--shadow-sm); }
</style>