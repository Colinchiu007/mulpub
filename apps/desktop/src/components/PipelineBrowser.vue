<template>
  <div class="pipeline-browser">
    <h2 class="section-title">视频创作流水线</h2>
    <p class="section-desc">选择一种视频创作模式，AI 将自动完成从脚本到成片的全流程</p>

    <div v-if="loading" class="loading-state loading-state--skeleton" data-testid="pipeline-browser-loading">
      <div class="mp-skeleton-grid">
        <UiSkeleton v-for="i in 6" :key="i" variant="card" class="mp-skeleton-card" />
      </div>
    </div>

    <div v-else-if="error" class="error-state">
      <span>⚠️</span>
      <span>{{ error }}</span>
    </div>

    <div v-else class="pipeline-grid">
      <div
        v-for="p in pipelines"
        :key="p.name"
        class="pipeline-card"
        :data-pipeline-id="p.name"
        :class="[p.stability || 'experimental', { 'is-unavailable': p.available === false }]"
        @click="$emit('select', p)"
        tabindex="0"
        role="button"
        :aria-label="pipelineName(p.name)"
        @keydown.enter="$emit('select', p)"
      >
        <div class="card-header">
          <span class="badge" :class="p.category">{{ pipelineCategory(p.category) }}</span>
          <span class="stability-dot" :class="p.stability || 'experimental'" :title="'稳定性: ' + (p.stability || 'experimental')"></span>
        </div>
        <h3 class="card-title">{{ pipelineName(p.name) }}</h3>
        <p class="card-desc">{{ pipelineDescription(p.name, p.description) }}</p>
        <div class="card-footer">
          <span class="version">v{{ p.version || "?" }}</span>
          <span class="availability-badge" :class="p.available === false ? 'dev' : 'ready'" :title="availabilityHint(p.available !== false)">
            {{ availabilityLabel(p.available !== false) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import {
  getPipelineCategory,
  getPipelineDescription,
  getPipelineName,
} from '@/i18n/pipeline-labels'
import { formatUserError } from '@/utils/user-facing-error'

export default {
  name: "PipelineBrowser",
  emits: ["select"],
  data() {
    return {
      pipelines: [],
      loading: true,
      error: null,
    };
  },
  async mounted() {
    try {
      const { pipelineList } = await import("@/api/publisher")
      const result = await pipelineList()
      if (result?.code === 0) {
        this.pipelines = result.data || []
      } else {
        this.error = formatUserError(result, { fallback: '加载失败' }).message
      }
    } catch (e) {
      // Fallback for vitest/dev
      this.pipelines = [];
      this.error = formatUserError(e, { fallback: '加载失败' }).message;
    } finally {
      this.loading = false;
    }
  },
  methods: {
    translate(key) {
      return typeof this.$t === 'function' ? this.$t(key) : key
    },
    pipelineName(name) {
      return getPipelineName((key) => this.translate(key), name)
    },
    pipelineCategory(category) {
      return getPipelineCategory((key) => this.translate(key), category)
    },
    pipelineDescription(name, fallback) {
      const description = getPipelineDescription((key) => this.translate(key), name)
      const value = description && description !== name ? description : (fallback || '')
      return value
        ? value.substring(0, 120) + (value.length > 120 ? '...' : '')
        : this.translate('pipelines.descriptions.unavailable')
    },
    availabilityLabel(available) {
      return this.translate(available ? 'pipelines.availability.ready' : 'pipelines.availability.dev')
    },
    availabilityHint(available) {
      return this.translate(available ? 'pipelines.availability.readyHint' : 'pipelines.availability.notImplementedHint')
    },
  },
};
</script>

<style scoped>
.pipeline-browser { padding: 16px; }
.section-title { font-size: 1.4rem; margin-bottom: 4px; }
.section-desc { color: var(--text-muted); margin-bottom: 20px; font-size: 0.9rem; }
.pipeline-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.pipeline-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px;
  cursor: pointer; transition: all 0.2s;
}
.pipeline-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); transform: translateY(-2px); }
.pipeline-card.experimental { border-left: 3px solid var(--stability-experimental); }
.pipeline-card.beta { border-left: 3px solid var(--stability-beta); }
.pipeline-card.production { border-left: 3px solid var(--stability-production); }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.badge {
  font-size: 0.7rem; padding: 2px 8px; border-radius: 4px;
  text-transform: uppercase; font-weight: 600;
}
.badge.generated { background: var(--pipe-generated-bg); color: var(--pipe-generated-text); }
.badge.assembly { background: var(--pipe-animation-bg); color: var(--pipe-animation-text); }
.badge.hybrid { background: var(--pipe-screen-recording-bg); color: var(--pipe-screen-recording-text); }
.card-title { font-size: 1.05rem; margin: 0 0 6px 0; }
.card-desc { font-size: 0.82rem; color: var(--text-muted); line-height: 1.4; margin: 0 0 12px 0; }
.card-footer { display: flex; justify-content: space-between; align-items: center; }
.version { font-size: 0.75rem; color: var(--text-light); }
.availability-badge { font-size: 11px; padding: 1px 8px; border-radius: 10px; font-weight: 600; }
.availability-badge.ready { background: var(--pipe-screen-recording-bg); color: var(--pipe-screen-recording-text); }
.availability-badge.dev { background: var(--pipe-animation-bg); color: var(--pipe-animation-text); }
.pipeline-card.is-unavailable { opacity: 0.72; }
.pipeline-card.is-unavailable:hover { transform: none; box-shadow: none; }
.stability-dot {
  width: 8px; height: 8px; border-radius: 50%; display: inline-block;
}
.stability-dot.experimental { background: var(--stability-experimental); }
.stability-dot.beta { background: var(--stability-beta); }
.stability-dot.production { background: var(--stability-production); }
.loading-state, .error-state { display: flex; align-items: center; gap: 8px; padding: 24px; color: var(--text-muted); }
/* 骨架屏栅格需要块级布局（.mp-skeleton-grid 由 styles/skeleton.css 提供） */
.loading-state--skeleton { display: block; }
.spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--hairline); border-top-color: var(--stability-beta); border-radius: 50%; animation: spin 0.6s linear infinite; }
.error-state { color: var(--error); }
@keyframes spin { to { transform: rotate(360deg); } }

/* 键盘导航焦点样式（原先误置于样式块结束标签之后，规则从未生效，本次一并修复） */
.pipeline-card:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
</style>
