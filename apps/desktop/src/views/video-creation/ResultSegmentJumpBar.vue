<template>
  <!--
    分段快捷定位固定竖条（右侧 sticky，不随页面滚动）。

    2026-10-20 PRD-S2V-RESULT-UX-POLISH §3.3 / §3.6 起单独成组件，并补两件事：
    1. **roving tabindex**：169 段时逐个 Tab 要按 169 次；整组只占 1 个 Tab 位，
       组内用方向键 / Home / End 移动焦点并跳转。
    2. **跳转中态**：大跨度跳转要渲染上百张卡，`pending` 项给「点了在做事」的即时反馈。
  -->
  <aside v-if="segments.length > 1" class="segment-jump-sidebar">
    <div class="segment-jump-bar" data-testid="segment-jump-bar">
      <span class="segment-jump-label">{{ tOrKey('story2video.sceneMaterial.segmentJumpLabel') }}</span>
      <div
        class="segment-jump-numbers"
        role="group"
        :aria-label="tOrKey('story2video.sceneMaterial.segmentJumpLabel')"
        @keydown="onKeydown"
      >
        <button
          v-for="(segment, index) in segments"
          :key="segment.id"
          type="button"
          class="segment-jump-number"
          :class="{ active: index === activeIndex, pending: index === pendingIndex }"
          :tabindex="index === focusIndex ? 0 : -1"
          :aria-current="index === activeIndex ? 'true' : undefined"
          :aria-label="$t('story2video.sceneMaterial.segmentJumpAriaLabel', { n: index + 1 })"
          :disabled="pendingIndex === index"
          @click="$emit('jump', index)"
          @focus="$emit('update:focus-index', index)"
        >{{ index + 1 }}</button>
      </div>
      <div class="segment-jump-nav">
        <UiButton
          size="sm"
          variant="ghost"
          :disabled="activeIndex <= 0"
          data-testid="segment-jump-prev"
          @click="$emit('step', -1)"
        >{{ tOrKey('story2video.sceneMaterial.segmentJumpPrev') }}</UiButton>
        <UiButton
          size="sm"
          variant="ghost"
          :disabled="activeIndex >= segments.length - 1"
          data-testid="segment-jump-next"
          @click="$emit('step', 1)"
        >{{ tOrKey('story2video.sceneMaterial.segmentJumpNext') }}</UiButton>
      </div>
    </div>
  </aside>
</template>

<script>
import UiButton from '@/components/UiButton.vue'

import { resolveJumpFocusTarget } from './composables/useSegmentNavigation'

export default {
  name: 'ResultSegmentJumpBar',
  components: { UiButton },
  props: {
    segments: { type: Array, default: () => [] },
    activeIndex: { type: Number, default: -1 },
    // 大跨度跳转进行中的目标下标（-1 = 空闲）
    pendingIndex: { type: Number, default: -1 },
    // roving tabindex 的焦点重置点
    focusIndex: { type: Number, default: 0 },
  },
  emits: ['jump', 'step', 'update:focus-index'],
  methods: {
    onKeydown (event) {
      // 纯逻辑在 composable（可直接单测）；本组件只负责 preventDefault + 焦点跟随
      const next = resolveJumpFocusTarget({
        key: event && event.key,
        current: this.focusIndex,
        total: this.segments.length,
      })
      if (next === null) return
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
      this.$emit('update:focus-index', next)
      this.$emit('jump', next)
      this.$nextTick(() => {
        const container = event && event.currentTarget
        const buttons = container && container.querySelectorAll ? container.querySelectorAll('.segment-jump-number') : []
        const target = buttons[next]
        if (target && typeof target.focus === 'function') target.focus()
      })
    },
    tOrKey (key, params) {
      const translated = this.$t(key, params)
      return translated === key ? key : translated
    },
  },
}
</script>

<style scoped>
.segment-jump-sidebar { position: sticky; top: 12px; }
.segment-jump-bar { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
.segment-jump-label { font-size: var(--font-size-xs); color: var(--text-muted); }
.segment-jump-numbers { display: flex; flex-wrap: wrap; gap: 6px; }
.segment-jump-number { min-width: 28px; height: 28px; padding: 0 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: var(--font-size-xs); cursor: pointer; }
.segment-jump-number:hover { border-color: var(--primary); color: var(--primary); }
.segment-jump-number.active { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 600; }
/* 跳转中的数字：opacity 降低 + progress 光标，明确「点了在做事」 */
.segment-jump-number.pending { opacity: 0.55; cursor: progress; }
.segment-jump-nav { display: flex; gap: 6px; }
</style>
