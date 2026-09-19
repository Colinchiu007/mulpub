<template>
  <teleport to="body">
    <div
      v-if="visible"
      class="publish-dest-overlay"
      data-testid="publish-dest-overlay"
      @click.self="close"
    >
      <div
        class="publish-dest-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-dest-title"
        data-testid="publish-dest-modal"
      >
        <header class="publish-dest-header">
          <h3 id="publish-dest-title" class="publish-dest-title">{{ title }}</h3>
          <button
            type="button"
            class="publish-dest-close"
            :aria-label="closeAria"
            title="关闭"
            data-testid="publish-dest-close"
            @click="close"
          >✕</button>
        </header>

        <p v-if="subtitle" class="publish-dest-subtitle">{{ subtitle }}</p>

        <div class="publish-dest-banners">
          <!-- 直接发图文 -->
          <button
            type="button"
            class="publish-dest-banner"
            data-testid="publish-dest-article"
            @click="chooseArticle"
          >
            <span class="banner-icon">🖼️</span>
            <span class="banner-title">直接发图文</span>
            <span class="banner-desc">打开图文发布页，改写内容将自动填入文案输入框</span>
          </button>

          <!-- 生成视频 -->
          <div class="publish-dest-banner-group" data-testid="publish-dest-video-group">
            <button
              type="button"
              class="publish-dest-banner"
              data-testid="publish-dest-video"
              @click="chooseVideo"
            >
              <span class="banner-icon">🎬</span>
              <span class="banner-title">生成视频</span>
              <span class="banner-desc">打开视频创作流水线页，改写文本将自动填入文案输入框</span>
            </button>
            <div class="publish-dest-pipeline">
              <label class="pipeline-label" for="publish-dest-pipeline-select">流水线选择</label>
              <select
                id="publish-dest-pipeline-select"
                v-model="selectedPipeline"
                class="pipeline-select"
                data-testid="publish-dest-pipeline-select"
              >
                <option value="">-- 选择流水线 --</option>
                <option
                  v-for="p in pipelineOptions"
                  :key="p.value"
                  :value="p.value"
                >{{ p.label }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '选择发布去向' },
  subtitle: { type: String, default: '改写内容已存入草稿箱，请选择下一步操作' },
  closeAria: { type: String, default: '关闭' },
  pipelineOptions: {
    type: Array,
    default: () => [
      { value: 'story2video-compose', label: '故事讲述' },
    ],
  },
  defaultPipeline: { type: String, default: 'story2video-compose' },
})

const emit = defineEmits(['close', 'publish-article', 'publish-video'])

const selectedPipeline = ref(props.defaultPipeline)

function close () {
  emit('close')
}

function chooseArticle () {
  emit('publish-article')
}

function chooseVideo () {
  emit('publish-video', selectedPipeline.value || 'story2video-compose')
}
</script>

<style scoped>
.publish-dest-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(23, 23, 32, 0.45);
  padding: 20px;
}

.publish-dest-modal {
  width: min(560px, 100%);
  max-height: 86vh;
  overflow-y: auto;
  background: var(--surface, #fff);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.22);
  padding: 22px 24px 26px;
}

.publish-dest-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.publish-dest-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary, #25252b);
}

.publish-dest-close {
  border: none;
  background: transparent;
  color: var(--muted, #73777d);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}
.publish-dest-close:hover { background: var(--soft-stone, #f5f5f5); color: var(--text-primary); }

.publish-dest-subtitle {
  margin: 8px 0 18px;
  font-size: 13px;
  color: var(--muted, #73777d);
}

.publish-dest-banners {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.publish-dest-banner {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 20px 18px;
  border: 2px solid var(--border, #e5e5ea);
  border-radius: 14px;
  background: var(--surface, #fff);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
  font: inherit;
}
.publish-dest-banner:hover {
  border-color: var(--coral, #f56c6c);
  box-shadow: 0 8px 24px rgba(245, 108, 108, 0.12);
  transform: translateY(-1px);
}
.publish-dest-banner:focus-visible {
  outline: 2px solid var(--coral, #f56c6c);
  outline-offset: 2px;
}

.banner-icon { font-size: 30px; line-height: 1; }
.banner-title { font-size: 16px; font-weight: 600; color: var(--text-primary, #25252b); }
.banner-desc { font-size: 12.5px; color: var(--muted, #73777d); line-height: 1.5; }

.publish-dest-banner-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.publish-dest-pipeline {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 18px 2px;
}

.pipeline-label {
  font-size: 13px;
  color: var(--muted, #73777d);
  white-space: nowrap;
}

.pipeline-select {
  flex: 1;
  max-width: 280px;
  padding: 8px 12px;
  border: 1px solid var(--border, #e5e5ea);
  border-radius: 8px;
  font-size: 13px;
  background: var(--surface, #fff);
  color: var(--text-primary, #25252b);
}
.pipeline-select:focus { border-color: var(--coral, #f56c6c); outline: none; }
</style>
