<template>
  <UiModal
    :visible="visible"
    :title="title"
    size="xl"
    width="960px"
    variant="progress"
    test-id="collection-video-create-modal"
    :close-on-overlay="false"
    :close-on-esc="false"
    :close-disabled="busy"
    @close="$emit('close')"
  >
    <div class="collection-video-create-content" data-testid="collection-video-create-content">
      <!-- 当前跑的是哪条流水线（非默认流水线时尤其重要） -->
      <div
        v-if="pipelineLabel"
        class="collection-video-create-pipeline"
        data-testid="collection-video-create-pipeline"
      >{{ pipelineLabelText }}</div>

      <!-- 文案裁切披露：超上限时如实告知（否则用户以为视频用的是完整文案） -->
      <div
        v-if="textTruncated"
        class="collection-video-create-truncated"
        data-testid="collection-video-create-truncated"
      >⚠️ {{ $t('collection.videoCreate.textTruncated', { length: textTruncatedLength, max: textLimit }) }}</div>

      <!-- 配置档案套用失败的提示：视频照常出，但必须告诉用户「你选的配置没生效」 -->
      <div
        v-if="configWarning"
        class="collection-video-create-config-warning"
        data-testid="collection-video-create-config-warning"
      >⚠️ {{ configWarning }}</div>

      <StageProgress
        v-if="stages && stages.length"
        :stages="stages"
        :progress-percent="progressPercent"
        :elapsed-ms="elapsedMs"
        :summary="summary"
        testid-prefix="collection-video"
      />
    </div>
    <template #footer>
      <span
        v-if="errorText"
        class="collection-video-create-error"
        data-testid="collection-video-create-error"
      >{{ errorText }}</span>
      <UiButton
        variant="secondary"
        data-testid="collection-video-create-view"
        :disabled="!resultReady"
        @click="$emit('view')"
      >{{ $t('collection.videoCreate.view') }}</UiButton>
      <UiButton
        variant="secondary"
        data-testid="collection-video-create-publish"
        :disabled="!resultReady"
        @click="$emit('publish')"
      >{{ $t('collection.videoCreate.publish') }}</UiButton>
      <UiButton
        v-if="canRetry"
        variant="primary"
        data-testid="collection-video-create-retry"
        @click="$emit('retry')"
      >{{ $t('collection.videoCreate.retry') }}</UiButton>
      <UiButton
        v-if="canCancel"
        variant="secondary"
        data-testid="collection-video-create-cancel"
        @click="$emit('cancel')"
      >{{ $t('collection.videoCreate.cancel') }}</UiButton>
      <UiButton
        v-if="terminal"
        variant="secondary"
        data-testid="collection-video-create-close"
        @click="$emit('close')"
      >{{ $t('collection.videoCreate.close') }}</UiButton>
    </template>
  </UiModal>
</template>

<script setup>
/**
 * CollectionVideoProgressModal — 采集页「视频创作」执行进度浮层
 * （fix-collection-rewrite-publish-flow，2026-10-20）。
 *
 * 与「视频创作页进度浮层」「热门选题一键成片进度弹窗」同款（UiModal variant=progress
 * + StageProgress + 四按钮契约），保证三处浮层的视觉与按钮语义一致。
 *
 * 本组件是**纯受控渲染件**：不持有任何状态，所有数据由父组件传入，
 * 所有动作由父组件监听（emit）——进度浮层的状态机在
 * `composables/useCollectionVideoCreation.js` 里。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import UiModal from '@/components/UiModal.vue'
import UiButton from '@/components/UiButton.vue'
// 直连具体模块，**不走桶文件** `@/views/video-creation`（2026-10-24 修正）：
// 桶文件同时 re-export `PipelineSelector`，取它会把 `pipeline-selector.css`
// 提前注入到**采集页**的模块图里 ⇒ 全局层叠顺序翻转 ⇒ `create-view.css` 的
// 分类色 `border-left` 反而后到、压过 `pipeline-selector.css` 的 `.has-bg` 白边
// ⇒ 视频创作页的流水线卡片边框变色 ⇒ 视觉基线 GATE-7B 判红（实测 28.496% 漂移）。
// 见 features/collection/collection-css-cascade-order.test.js（契约锁）。
import StageProgress from '@/views/video-creation/StageProgress.vue'

const { t } = useI18n()

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  pipelineLabel: { type: String, default: '' },
  stages: { type: Array, default: () => [] },
  progressPercent: { type: Number, default: 0 },
  elapsedMs: { type: Number, default: null },
  summary: { type: String, default: '' },
  errorText: { type: String, default: '' },
  resultReady: { type: Boolean, default: false },
  terminal: { type: Boolean, default: false },
  canRetry: { type: Boolean, default: false },
  canCancel: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  textTruncated: { type: Boolean, default: false },
  textTruncatedLength: { type: Number, default: 0 },
  textLimit: { type: Number, default: 0 },
  configWarning: { type: String, default: '' },
})

const emit = defineEmits(['close', 'view', 'publish', 'retry', 'cancel'])

const resolvedTitle = computed(() => props.title || t('collection.videoCreate.title'))
const pipelineLabelText = computed(() => t('collection.videoCreate.pipelineLabel', { pipeline: props.pipelineLabel }))
</script>

<style scoped>
.collection-video-create-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.collection-video-create-pipeline {
  font-size: var(--font-size-sm, 13px);
  color: var(--muted, #73777d);
}

.collection-video-create-truncated {
  font-size: var(--font-size-sm, 13px);
  color: #b26a00;
  background: #fff7e6;
  border: 1px solid #ffe0a3;
  border-radius: 8px;
  padding: 8px 12px;
}

.collection-video-create-config-warning {
  font-size: var(--font-size-sm, 13px);
  color: #b26a00;
  background: #fff7e6;
  border: 1px solid #ffe0a3;
  border-radius: 8px;
  padding: 8px 12px;
}

.collection-video-create-error {
  color: #d9534f;
  font-size: var(--font-size-sm, 13px);
  margin-right: auto;
}
</style>
