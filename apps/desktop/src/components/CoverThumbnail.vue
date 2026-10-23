<template>
  <!-- 三态互斥：加载中 / 有图 / 读取失败。路径为空时整块不渲染（正常空态，不是错误）。 -->
  <div
    v-if="loading"
    class="cover-thumbnail cover-thumbnail--state"
    data-testid="cover-thumbnail-loading"
    aria-busy="true"
  >{{ t('publishPage.coverPreview.loading') }}</div>

  <div
    v-else-if="dataUrl"
    class="cover-thumbnail"
    data-testid="cover-thumbnail"
    role="button"
    tabindex="0"
    :aria-label="t('publishPage.coverPreview.ariaLabel')"
    :title="t('publishPage.coverPreview.hint')"
    @click="$emit('open')"
    @keydown.enter.prevent="$emit('open')"
    @keydown.space.prevent="$emit('open')"
  >
    <img class="cover-thumbnail__img" :src="dataUrl" alt="" draggable="false" loading="eager" decoding="async">
    <span class="cover-thumbnail__zoom" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
        <circle cx="6.6" cy="6.6" r="4.4" /><path d="M10 10l3.4 3.4M4.6 6.6h4M6.6 4.6v4" />
      </svg>
    </span>
  </div>

  <!--
    失败态刻意保留同尺寸占位框而不是整块消失：整块消失会让用户以为「封面没设置上」，
    从而重复点击生成 —— 那正是本需求要消灭的困惑。具体原因留在 title 上供排障。
  -->
  <div
    v-else-if="error"
    class="cover-thumbnail cover-thumbnail--state cover-thumbnail--error"
    data-testid="cover-thumbnail-unavailable"
    :title="error"
  >{{ t('publishPage.coverPreview.unavailable') }}</div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

defineProps({
  dataUrl: { type: String, default: '' },
  error: { type: String, default: '' },
  loading: { type: Boolean, default: false },
})
defineEmits(['open'])

const { t } = useI18n()
</script>

<style scoped>
/* 144×81 = 16:9 基准框；object-fit: cover 让竖图/方图都不变形（超出裁切）。 */
.cover-thumbnail {
  position: relative;
  width: 144px;
  height: 81px;
  flex: 0 0 auto;
  border: 1px solid var(--border-light, #d9dce8);
  border-radius: 6px;
  overflow: hidden;
  background: #1f2126;
  cursor: zoom-in;
}
.cover-thumbnail__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-thumbnail__zoom {
  position: absolute;
  right: 4px;
  bottom: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.cover-thumbnail:hover .cover-thumbnail__zoom,
.cover-thumbnail:focus-visible .cover-thumbnail__zoom { opacity: 1; }
.cover-thumbnail:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.cover-thumbnail--state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  font-size: var(--font-size-xs, 12px);
  line-height: 1.3;
  text-align: center;
  color: var(--muted, #73777d);
  background: var(--surface, #fff);
  cursor: default;
}
.cover-thumbnail--error { color: var(--color-danger, #d93025); border-color: var(--color-danger, #d93025); }
</style>
