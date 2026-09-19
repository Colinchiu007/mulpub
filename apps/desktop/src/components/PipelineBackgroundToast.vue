<template>
  <Teleport to="body">
    <Transition name="pipeline-bg-toast">
      <div
        v-if="visible"
        class="pipeline-bg-toast"
        role="status"
        aria-live="polite"
        data-testid="pipeline-background-toast"
      >{{ text }}</div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { pipelineBackgroundToastVisible } from '@/stores/pipeline-background-toast'

const { t } = useI18n()

// 全局唯一实例（App.vue 挂载）。key 已在 zh/en locales 成对定义；
// vue-i18n 缺 key 时返回 key 原文，这里回退空串而非硬编码中文，
// 避免把 key 或未翻译文案泄漏到用户界面（i18n-user-facing-messages 规则）。
const visible = pipelineBackgroundToastVisible
const text = computed(() => {
  const translated = t('common.pipelineBackgroundToast')
  return typeof translated === 'string' && translated !== 'common.pipelineBackgroundToast'
    ? translated
    : ''
})
</script>

<style scoped>
.pipeline-bg-toast {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2100; /* 高于 UiModal overlay(2000)：弹窗刚关闭时提示仍居中可见 */
  max-width: min(480px, calc(100vw - 48px));
  padding: 14px 24px;
  border-radius: 10px;
  background: rgba(30, 30, 34, 0.92);
  color: #fff;
  font-size: 14px;
  line-height: 1.6;
  text-align: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  pointer-events: none;
  overflow-wrap: anywhere;
}

.pipeline-bg-toast-enter-active,
.pipeline-bg-toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.pipeline-bg-toast-enter-from,
.pipeline-bg-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.96);
}
</style>
