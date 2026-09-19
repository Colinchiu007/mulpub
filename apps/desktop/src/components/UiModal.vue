<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="visible"
        :class="['ui-modal-overlay', { 'ui-modal-overlay-progress': variant === 'progress' }]"
        :data-testid="testId || undefined"
        @click.self="handleOverlayClick"
      >
        <div
          :class="['ui-modal', sizeClass, { 'ui-modal-progress': variant === 'progress' }]"
          :style="{ maxWidth: computedMaxWidth }"
          role="dialog"
          :aria-modal="variant === 'progress' ? 'false' : 'true'"
          :aria-labelledby="title ? titleId : undefined"
          :aria-label="title ? undefined : closeAriaLabel"
          tabindex="-1"
          ref="modalRef"
        >
          <div class="ui-modal-header">
            <span v-if="title" :id="titleId" class="ui-modal-title">{{ title }}</span>
            <button
              type="button"
              class="ui-modal-close"
              data-testid="ui-modal-close"
              :aria-label="closeAriaLabel"
              :aria-disabled="closeDisabled ? 'true' : undefined"
              :disabled="closeDisabled"
              ref="closeButtonRef"
              @click="handleCloseClick"
            >&times;</button>
          </div>
          <div class="ui-modal-body">
            <slot />
          </div>
          <div v-if="$slots.footer" class="ui-modal-footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: "" },
  size: { type: String, default: "md" },
  width: { type: String, default: "" },
  variant: { type: String, default: "" },
  testId: { type: String, default: "" },
  closeOnOverlay: { type: Boolean, default: true },
  closeOnEsc: { type: Boolean, default: false },
  trapFocus: { type: Boolean, default: false },
  closeDisabled: { type: Boolean, default: false },
  closeAriaLabel: { type: String, default: "Close" },
});

const emit = defineEmits(["close"]);

const sizeMap = { sm: "360px", md: "480px", lg: "640px", xl: "800px" };
const sizeClass = computed(() => "ui-modal-" + props.size);
const computedMaxWidth = computed(() => props.width || sizeMap[props.size] || sizeMap.md);
const modalRef = ref(null);
const closeButtonRef = ref(null);
const titleId = `ui-modal-title-${Math.random().toString(36).slice(2, 10)}`;
let escapeListening = false;
let focusRestoreTarget = null;

function handleOverlayClick() {
  if (props.closeOnOverlay && !props.closeDisabled) emit("close");
}

function handleCloseClick() {
  if (!props.closeDisabled) emit("close");
}

function getFocusableElements() {
  if (!modalRef.value) return [];
  return Array.from(modalRef.value.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter(element => element.getClientRects().length > 0);
}

function focusProgressDialog() {
  if (!props.visible) return;
  nextTick(() => {
    if (!modalRef.value) return;
    if (props.variant === 'progress') {
      // 进度弹窗是 modeless 观察窗，打开时不抢占焦点，避免键盘用户误触发“关闭=后台化”。
      return;
    }
    modalRef.value.focus?.();
  });
}

function restoreFocus() {
  const target = focusRestoreTarget;
  focusRestoreTarget = null;
  if (target && typeof target.focus === 'function' && target.isConnected) nextTick(() => target.focus());
}

function handleKeydown(event) {
  if (event.key === 'Tab' && props.visible && props.trapFocus && props.variant !== 'progress') {
    const focusable = getFocusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      modalRef.value?.focus?.();
    } else if (event.shiftKey && document.activeElement === focusable[0]) {
      event.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
      event.preventDefault();
      focusable[0].focus();
    }
  }
  if (event.key === "Escape" && props.visible && props.closeOnEsc && !props.closeDisabled) {
    event.preventDefault();
    emit("close");
  }
}

function syncEscapeListener() {
  if (typeof document === "undefined") return;
  // 焦点循环和 Escape 关闭分别由显式开关控制；进度弹窗是 modeless，
  // 不注册全局键盘监听，底部固定操作条仍需保持可访问。
  const shouldListen = props.visible && props.variant !== "progress" && (props.closeOnEsc || props.trapFocus);
  if (shouldListen && !escapeListening) {
    document.addEventListener("keydown", handleKeydown);
    escapeListening = true;
  } else if (!shouldListen && escapeListening) {
    document.removeEventListener("keydown", handleKeydown);
    escapeListening = false;
  }
}

watch(() => [props.visible, props.closeOnEsc, props.trapFocus, props.closeDisabled, props.variant], syncEscapeListener, { immediate: true });
watch(() => props.visible, (visible, previousVisible) => {
  if (visible && !previousVisible) {
    focusRestoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusProgressDialog();
  } else if (!visible && previousVisible) {
    restoreFocus();
  }
});
onMounted(() => {
  syncEscapeListener();
  if (props.visible) {
    focusRestoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusProgressDialog();
  }
});
onBeforeUnmount(() => {
  if (typeof document !== "undefined" && escapeListening) {
    document.removeEventListener("keydown", handleKeydown);
    escapeListening = false;
  }
  restoreFocus();
});
</script>

<style scoped>
.ui-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--apple-space-6);
  backdrop-filter: blur(4px);
  overflow: auto;
}

.ui-modal {
  background: var(--apple-surface-primary);
  border-radius: var(--apple-radius-lg);
  box-shadow: var(--apple-shadow-lg);
  width: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 48px);
}

.ui-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--apple-space-5) var(--apple-space-6) 0;
  flex-shrink: 0;
}

.ui-modal-title {
  font-size: var(--apple-size-lg);
  font-weight: var(--apple-weight-semibold);
  color: var(--apple-ink-primary);
  font-family: var(--apple-font-display);
}

.ui-modal-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: var(--apple-surface-tertiary);
  color: var(--apple-ink-secondary);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--apple-duration-fast) var(--apple-ease-default);
}
.ui-modal-close:hover { background: var(--apple-error-bg); color: var(--apple-error); }
.ui-modal-close:disabled { opacity: 0.45; cursor: not-allowed; }

.ui-modal-body { padding: var(--apple-space-5) var(--apple-space-6); min-height: 0; overflow-y: auto; }
.ui-modal-footer {
  padding: var(--apple-space-4) var(--apple-space-6);
  border-top: 1px solid var(--apple-border-subtle);
  display: flex;
  justify-content: flex-end;
  gap: var(--apple-space-2);
  flex-shrink: 0;
}

/* Progress dialogs sit below the page action bar so its existing controls remain usable. */
.ui-modal-overlay-progress {
  z-index: 100;
  align-items: center;
  padding: var(--apple-space-6) var(--apple-space-6) calc(var(--pipeline-action-bar-space, 88px) + var(--apple-space-6));
  overflow: hidden;
}

.ui-modal-progress {
  max-height: calc(100dvh - var(--pipeline-action-bar-space, 88px) - 48px);
}

/* sticky 契约：.ui-modal-body 是 .stages-sticky-header（top: 0）的滚动容器，
   CSS sticky 约束矩形会被滚动容器自身 padding 收缩——保留 padding-top 会让粘性
   进度条停在距 body 顶部 padding-top 处，向上滚出的阶段内容先经过这条无遮盖的
   缝露出来（小窗口下标题与进度条之间漏出底层文字）。置 0 使进度条紧贴标题区。 */
.ui-modal-progress .ui-modal-body {
  padding-top: 0;
}

/* Transition */
.modal-enter-active, .modal-leave-active { transition: opacity var(--apple-duration-normal) var(--apple-ease-default); }
.modal-enter-active .ui-modal, .modal-leave-active .ui-modal { transition: transform var(--apple-duration-normal) var(--apple-ease-default); }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .ui-modal, .modal-leave-to .ui-modal { transform: scale(0.96) translateY(4px); }

@media (max-width: 768px) {
  .ui-modal-overlay { padding: 12px; }
  .ui-modal-overlay-progress {
    padding: 12px 12px calc(var(--pipeline-action-bar-space-mobile, 136px) + 12px);
  }
  .ui-modal-progress {
    max-height: calc(100dvh - var(--pipeline-action-bar-space-mobile, 136px) - 24px);
  }
}
</style>
