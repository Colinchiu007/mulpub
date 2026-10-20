<template>
  <!--
    无成片任务的预览区占位区块 + 失败摘要卡（2026-10-20 PRD-S2V-RESULT-UX-POLISH §3.2）。

    为什么单独拆出来：
    1. 旧版占位区块只有一句通用说明（「可先编辑分段内容，再重新合成」），回答不了用户
       真正的问题「为什么没生成成品视频」；补上失败原因后逻辑量够单独成组件。
    2. `ResultView.vue` 是 max-lines 的 targets 点名还账对象（零增长容差），
       模板 + 文案拼装 + 原因码映射放在宿主里会直接顶穿行数门禁。

    组件职责：把「数据」翻译成「用户能读懂的失败解释」。它不发起任何 IPC，
    行动位一律 emit 给宿主（宿主才知道 recompose 与跳转怎么走）。
  -->
  <div class="video-section video-section--placeholder" data-testid="result-preview-placeholder">
    <div class="video-preview-placeholder">
      <h2 class="video-preview-placeholder__title">{{ placeholder.title }}</h2>
      <p class="video-preview-placeholder__description">{{ placeholder.description }}</p>

      <div v-if="hasCounts" class="failure-summary" data-testid="failure-summary">
        <p class="failure-summary__counts" data-testid="failure-summary-counts">{{ countsText }}</p>
        <p v-if="reasonsText" class="failure-summary__reasons" data-testid="failure-summary-reasons">{{ reasonsText }}</p>
        <p v-else-if="failure.hasFailure" class="failure-summary__hint" data-testid="failure-summary-no-reason">{{ noReasonText }}</p>
        <p v-if="failure.policyFlaggedCount > 0" class="failure-summary__policy" data-testid="failure-summary-policy">{{ policyText }}</p>
      </div>

      <div class="video-preview-placeholder__actions">
        <UiButton
          v-if="failure.hasFailure"
          size="sm"
          variant="secondary"
          data-testid="failure-summary-jump"
          :disabled="jumpPending"
          @click="$emit('jump-first-failed')"
        >{{ jumpLabel }}</UiButton>
        <UiButton
          v-if="placeholder.actionEnabled"
          size="sm"
          variant="secondary"
          data-testid="preview-placeholder-recompose"
          :disabled="recomposeDisabled"
          @click="$emit('recompose')"
        >{{ placeholder.actionLabel }}</UiButton>
      </div>
    </div>
  </div>
</template>

<script>
import UiButton from '@/components/UiButton.vue'

import { FAILURE_REASON_LABEL_KEYS } from './composables/useResultPreviewMedia'

export default {
  name: 'ResultPreviewPlaceholder',
  components: { UiButton },
  props: {
    // buildPreviewPlaceholder() 的产物（title/description/actionLabel/actionEnabled）
    placeholder: { type: Object, required: true },
    // buildFailureSummary() 的产物（total/failedCount/reasons/firstFailedIndex/...）
    failure: { type: Object, default: () => ({}) },
    // 重新合成不可用（进行中 / 有分段在忙）
    recomposeDisabled: { type: Boolean, default: false },
    // 跳转进行中
    jumpPending: { type: Boolean, default: false },
  },
  emits: ['recompose', 'jump-first-failed'],
  computed: {
    hasCounts () {
      return Number(this.failure && this.failure.total) > 0
    },
    countsText () {
      return this.tOrKey('story2video.sceneMaterial.failureSummaryCounts', {
        total: this.failure.total,
        failed: this.failure.failedCount,
        completed: this.failure.completedCount,
      })
    },
    reasonsText () {
      const reasons = Array.isArray(this.failure && this.failure.reasons) ? this.failure.reasons : []
      if (!reasons.length) return ''
      const items = reasons
        .map(reason => this.tOrKey('story2video.sceneMaterial.failureSummaryReasonItem', {
          label: this.reasonLabel(reason.code),
          count: reason.count,
        }))
        .join('、')
      return this.tOrKey('story2video.sceneMaterial.failureSummaryReasons', { reasons: items })
    },
    noReasonText () {
      return this.tOrKey('story2video.sceneMaterial.failureSummaryNoReason')
    },
    policyText () {
      return this.tOrKey('story2video.sceneMaterial.failureSummaryPolicyNote', {
        count: this.failure.policyFlaggedCount,
      })
    },
    jumpLabel () {
      return this.tOrKey('story2video.sceneMaterial.failureSummaryJump')
    },
  },
  methods: {
    // 失败原因码 → 可读文案。未知码统一回落「其他原因」，**不编造**具体成因。
    // 映射表在 composable（单一真源，zh/en 键已成对登记），此处只做一次 $t。
    reasonLabel (code) {
      const map = FAILURE_REASON_LABEL_KEYS
      const key = map[String(code || '')] || map.unknown
      return this.tOrKey('story2video.sceneMaterial.' + key)
    },
    tOrKey (key, params) {
      const translated = this.$t(key, params)
      return translated === key ? key : translated
    },
  },
}
</script>

<style scoped>
.video-preview-placeholder { display: flex; width: 100%; min-height: 240px; max-height: 68vh; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 32px 24px; border-radius: 8px; background: var(--bg); border: 1px dashed var(--border); text-align: center; }
.video-preview-placeholder__title { margin: 0; font-size: var(--font-size-md); font-weight: 600; color: var(--text); }
.video-preview-placeholder__description { margin: 0; max-width: 52em; font-size: var(--font-size-sm); line-height: 1.6; color: var(--text-muted); }
.video-preview-placeholder__actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 4px; }
/* 失败摘要：段数统计（主）→ 聚合原因（次）→ 政策提示（警示）三级文案层级 */
.failure-summary { display: flex; flex-direction: column; gap: 6px; max-width: 60em; padding: 10px 14px; border-radius: 8px; background: var(--bg-elevated, rgba(0, 0, 0, 0.03)); text-align: left; }
.failure-summary__counts { margin: 0; font-size: var(--font-size-sm); font-weight: 600; color: var(--text); }
.failure-summary__reasons,
.failure-summary__hint { margin: 0; font-size: var(--font-size-sm); line-height: 1.6; color: var(--text-muted); }
.failure-summary__policy { margin: 0; font-size: var(--font-size-sm); line-height: 1.6; color: var(--warning-text, #b45309); }
</style>
