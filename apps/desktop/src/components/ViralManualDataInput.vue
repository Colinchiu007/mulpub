<template>
  <div class="viral-article-section">
    <details>
      <summary class="viral-details-summary">{{ $t('viralAnalysis.manualDataSummary') }}</summary>
      <div class="viral-article-form">
        <p class="viral-article-help">{{ $t('viralAnalysis.manualDataHelp') }}</p>
        <ol class="viral-article-steps">
          <li>{{ $t('viralAnalysis.manualDataStep1') }}</li>
          <li>{{ $t('viralAnalysis.manualDataStep2') }}</li>
          <li>{{ $t('viralAnalysis.manualDataStep3') }}</li>
        </ol>
        <label class="cohere-form-label">{{ $t('viralAnalysis.manualDataLabel') }}</label>
        <textarea
          class="cohere-input viral-article-textarea"
          data-testid="viral-article-textarea"
          :value="modelValue"
          :placeholder="sampleJson"
          rows="6"
          @input="$emit('update:modelValue', $event.target.value)"
        ></textarea>
        <div class="viral-article-actions">
          <UiButton class="viral-btn-sample" data-testid="viral-fill-sample" @click="$emit('fill-sample')">
            {{ $t('viralAnalysis.fillSample') }}
          </UiButton>
        </div>
        <div v-if="error" class="viral-article-error" data-testid="viral-article-data-error" role="alert">
          <span>⚠️</span><span>{{ error }}</span>
        </div>
      </div>
    </details>
  </div>
</template>

<script>
import UiButton from './UiButton.vue'
import { buildViralSampleJson } from '@/utils/viral-sample-data'

/**
 * ViralManualDataInput — 爆款分析页「手动输入文章数据」区块（可选输入）
 *
 * 从 ViralAnalysis.vue 拆出（债务门禁 FILES_OVER_1000：视图文件只降不升），
 * 展示与交互语义与拆分前完全一致：
 * - 功能价值解释 + 三步使用说明（准备数据 → 填示例对照修改 → 点爆款分析）；
 * - textarea 占位符 = 示例 JSON（与「填入示例数据」同源，见 viral-sample-data）；
 * - 格式错误横幅：由父视图判定并通过 `error` 传入，非空才渲染（role=alert）。
 *
 * 状态归属：文章数据与错误文案都由父视图持有（v-model + `error` prop），
 * 本组件不持有业务状态；点按钮只发 `fill-sample` 事件，填什么由父视图决定。
 */
export default {
  components: { UiButton },
  props: {
    /** 文章数据 JSON 文本（v-model） */
    modelValue: { type: String, default: '' },
    /** 格式错误提示文案；空串表示无错误（横幅不渲染） */
    error: { type: String, default: '' },
  },
  emits: ['update:modelValue', 'fill-sample'],
  computed: {
    /** 示例 JSON：locale 只存标题列表，花括号在此组装（规避 vue-i18n 插值吞括号） */
    sampleJson () {
      return buildViralSampleJson(this.$t('viralAnalysis.manualDataSampleTitles'))
    },
  },
}
</script>

<style scoped>
/* 与拆分前同源；scoped 样式不跨组件继承，故父视图的 .viral-details-summary 需在此重复一份 */
.viral-article-section { margin-top: var(--space-md); }
.viral-details-summary { cursor: pointer; font-size: var(--font-size-sm); color: var(--color-text-muted); transition: color 0.2s; }
.viral-details-summary:hover { color: var(--color-primary); }
.viral-article-form { margin-top: var(--space-sm); max-width: 720px; }
.viral-article-textarea { font-size: var(--font-size-sm); font-family: monospace; resize: vertical; width: 100%; box-sizing: border-box; }
.viral-article-help { font-size: var(--font-size-sm); color: var(--color-text-muted); margin: 0 0 var(--space-sm); line-height: 1.6; }
.viral-article-steps { margin: 0 0 var(--space-sm); padding-left: 20px; font-size: var(--font-size-sm); color: var(--color-text-primary); line-height: 1.8; }
.viral-article-actions { margin-top: var(--space-sm); display: flex; gap: var(--space-sm); }
.viral-btn-sample { font-size: var(--font-size-sm); }
.viral-article-error {
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: var(--space-sm); padding: var(--space-sm) var(--space-md);
  border-radius: var(--r-xs); border: 1px solid var(--color-border);
  background: var(--color-danger-soft); color: var(--color-danger);
  font-size: var(--font-size-sm); line-height: 1.6;
}
</style>
