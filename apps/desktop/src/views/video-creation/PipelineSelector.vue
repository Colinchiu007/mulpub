<template>
  <div class="pipeline-selector">
    <!-- 加载状态：统一骨架屏（UiSkeleton + styles/skeleton.css 令牌） -->
    <div v-if="loading" class="loading-state" data-testid="pipeline-selector-loading">
      <div class="mp-skeleton-grid">
        <UiSkeleton v-for="i in 6" :key="i" variant="card" class="mp-skeleton-card" />
      </div>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="error-state">
      <span class="error-icon">⚠️</span>
      <p>{{ error }}</p>
      <button class="retry-btn" @click="$emit('retry')">{{ t('pipelineSelector.retry') }}</button>
    </div>

    <!-- 流水线网格 -->
    <div v-else class="pipeline-grid" data-testid="pipeline-grid">
      <div
        v-for="(pipeline, index) in pipelines"
        :key="pipeline.name"
        class="pipeline-card"
        :data-pipeline-id="pipeline.name"
        :class="[
          pipeline.category,
          {
            'is-unavailable': pipeline.available === false,
            'is-text-ineligible': isTextIneligible(pipeline),
            'has-bg': hasBg(pipeline.name),
          },
        ]"
        :style="cardDelayStyle(index)"
        tabindex="0"
        role="button"
        :aria-label="pipelineName(pipeline.name)"
        :aria-disabled="isTextIneligible(pipeline) ? 'true' : null"
        :title="isTextIneligible(pipeline) ? textIneligibleHint : null"
        @click="onCardActivate(pipeline)"
        @keydown.enter="onCardActivate(pipeline)"
      >
        <!-- 内置静态背景层（装饰性，对辅助技术隐藏） -->
        <div v-if="hasBg(pipeline.name)" class="card-bg" aria-hidden="true" data-testid="pipeline-card-bg">
          <img :src="bgUrl(pipeline.name)" alt="" loading="lazy" decoding="async" />
          <span class="card-bg-scrim"></span>
        </div>

        <div class="card-content">
          <div class="card-header">
            <span class="badge" :class="pipeline.category">{{ pipelineCategory(pipeline.category) }}</span>
            <span class="stability-dot" :class="getStability(pipeline.name)" :title="getStability(pipeline.name)"></span>
          </div>
          <h3 class="card-title">{{ pipelineName(pipeline.name) }}</h3>
          <p class="card-desc">{{ pipelineDescription(pipeline.name) }}</p>
          <div class="card-meta">
            <span class="stage-count">{{ $t('pipelineSelector.stages', { count: pipeline.stageCount ?? pipeline.stages?.length ?? 0 }) }}</span>
            <span class="cost-label" :class="pipeline.estimatedCost">{{ costLabel(pipeline.estimatedCost) }}</span>
            <span class="availability-badge" :class="pipeline.available === false ? 'dev' : 'ready'" :title="availabilityHint(pipeline.available !== false)">
              {{ availabilityLabel(pipeline.available !== false) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script>
import '@/styles/pipeline-selector.css'
import { PIPELINE_BG_IMAGES } from '@/story2video/pipeline-card-bg-assets'
import {
  getPipelineCategory,
  getPipelineDescription,
  getPipelineName,
  isTextBasedPipeline,
} from '@/i18n/pipeline-labels'

const CATEGORY_LABELS = {
  generated: 'catGenerated', talking_head: 'catTalkingHead', cinematic: 'catCinematic',
  animation: 'catAnimation', screen_recording: 'catScreenRecording', hybrid: 'catHybrid', custom: 'catCustom'
}
const COST_LABELS = { low: 'costLow', medium: 'costMedium', high: 'costHigh' }
const STABILITY_MAP = {
  'cinematic': 'production', 'animated-explainer': 'production', 'talking-head': 'beta',
  'documentary-montage': 'beta', 'clip-factory': 'beta', 'screen-demo': 'beta',
  'podcast-repurpose': 'experimental', 'localization-dub': 'experimental',
  'avatar-spokesperson': 'experimental', 'character-animation': 'experimental',
  'animation': 'experimental', 'hybrid': 'experimental', 'framework-smoke': 'experimental'
}

export default {
  name: 'PipelineSelector',
  props: {
    pipelines: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
    error: { type: String, default: null },
    // 带文案进入场景（如改写页跳转预填成功）：非文案型流水线灰显不可选
    textOnly: { type: Boolean, default: false },
  },
  emits: ['select', 'retry'],
  computed: {
    textIneligibleHint() {
      return this.t('pipelineSelector.textIneligible', '该流水线类型不适用')
    },
  },
  methods: {
    pipelineName(id) { return getPipelineName((key) => this.$t?.(key), id) },
    pipelineDescription(id) { return getPipelineDescription((key) => this.$t?.(key), id) },
    pipelineCategory(id) { return getPipelineCategory((key) => this.$t?.(key), id) },
    categoryLabel(cat) {
      const key = CATEGORY_LABELS[cat]
      return key ? this.$t('pipelineSelector.' + key) : cat
    },
    costLabel(cost) {
      const key = COST_LABELS[cost]
      return key ? this.$t('pipelineSelector.' + key) : cost
    },
    getStability(name) { return STABILITY_MAP[name] || 'experimental' },
    availabilityHint(available) { return this.$t(available ? 'pipelineSelector.availableHint' : 'pipelineSelector.inDevelopmentHint') },
    availabilityLabel(available) { return this.$t(available ? 'pipelineSelector.available' : 'pipelineSelector.inDevelopment') },
    t(key, fallback) {
      const value = this.$t?.(key)
      return typeof value === 'string' && value !== key ? value : (fallback || key)
    },
    hasBg(name) { return Boolean(PIPELINE_BG_IMAGES[name]) },
    bgUrl(name) { return PIPELINE_BG_IMAGES[name] || '' },
    cardDelayStyle(index) { return { '--i': String(index % 12) } },
    isTextIneligible(pipeline) {
      return this.textOnly && !isTextBasedPipeline(pipeline?.name)
    },
    onCardActivate(pipeline) {
      if (this.isTextIneligible(pipeline)) return
      this.$emit('select', pipeline)
    },
  },
}
</script>
