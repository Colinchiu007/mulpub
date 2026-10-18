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
          <h3 id="publish-dest-title" class="publish-dest-title">{{ resolvedTitle }}</h3>
          <button
            type="button"
            class="publish-dest-close"
            :aria-label="resolvedCloseAria"
            :title="resolvedCloseAria"
            data-testid="publish-dest-close"
            @click="close"
          >✕</button>
        </header>

        <!-- S2「已存草稿」披露节点（PRD-UI-FLOW-CLARITY §9 验收 #8）：
             这是全流程里**唯一**告诉用户"刚才那步已经静默存了一份草稿"的地方，
             此前既无 role 也无 data-testid，任何断言都锁不住它。
             补 role="status"（屏幕阅读器播报）+ 固定 testid（可被回归测试断言）。 -->
        <p
          v-if="resolvedSubtitle"
          class="publish-dest-subtitle"
          role="status"
          data-testid="publish-dest-draft-saved"
        >{{ resolvedSubtitle }}</p>

        <div class="publish-dest-banners">
          <!-- 直接发图文 -->
          <button
            type="button"
            class="publish-dest-banner"
            data-testid="publish-dest-article"
            @click="chooseArticle"
          >
            <span class="banner-icon">🖼️</span>
            <span class="banner-title">{{ t('publishDestination.article') }}</span>
            <span class="banner-desc">{{ t('publishDestination.articleDesc') }}</span>
          </button>

          <!-- 生成视频 -->
          <div class="publish-dest-banner-group" data-testid="publish-dest-video-group">
            <button
              type="button"
              class="publish-dest-banner"
              data-testid="publish-dest-video"
              @click="chooseVideo"
            >
              <span class="banner-icon"><el-icon><VideoCamera /></el-icon></span>
              <span class="banner-title">{{ t('publishDestination.video') }}</span>
              <span class="banner-desc">{{ t('publishDestination.videoDesc') }}</span>
            </button>
            <div class="publish-dest-pipeline">
              <label class="pipeline-label" for="publish-dest-pipeline-select">{{ t('publishDestination.pipelineLabel') }}</label>
              <select
                id="publish-dest-pipeline-select"
                v-model="selectedPipeline"
                class="pipeline-select"
                data-testid="publish-dest-pipeline-select"
              >
                <!-- S2：空选项设为 disabled —— 原实现允许选中空值，随后 chooseVideo 里
                     用 `|| 'story2video-compose'` 静默回落到默认流水线（PRD §1.2 混淆点）。
                     用户以为没选，实际发出了另一条流水线的创作请求。现在空选项只作占位，
                     不可选中，选择必须显式。 -->
                <option value="" disabled>{{ t('publishDestination.pipelineEmptyOption') }}</option>
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
import { VideoCamera } from '@element-plus/icons-vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

// S2：本组件此前全部文案是**硬编码中文**，而 `publishDestination.*` 的 locale 键
// （title/subtitle/close/article/...）早已存在却无人使用 —— 英文界面下这里一直显示中文。
// 现改为「props 留空则取 locale」，调用方仍可显式覆盖。
const { t } = useI18n()

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  closeAria: { type: String, default: '' },
  pipelineOptions: {
    type: Array,
    default: () => [
      { value: 'story2video-compose', label: '故事讲述' },
    ],
  },
  defaultPipeline: { type: String, default: 'story2video-compose' },
})

const resolvedTitle = computed(() => props.title || t('publishDestination.title'))
// 这条文案是「已存草稿」披露的唯一载体，不得为空
const resolvedSubtitle = computed(() => props.subtitle || t('publishDestination.subtitle'))
const resolvedCloseAria = computed(() => props.closeAria || t('publishDestination.close'))

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
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--text-primary, #25252b);
}

.publish-dest-close {
  border: none;
  background: transparent;
  color: var(--muted, #73777d);
  font-size: var(--font-size-base);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}
.publish-dest-close:hover { background: var(--soft-stone, #f5f5f5); color: var(--text-primary); }

.publish-dest-subtitle {
  margin: 8px 0 18px;
  font-size: var(--font-size-sm);
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

.banner-icon { font-size: var(--font-size-xl); line-height: 1; }
.banner-title { font-size: var(--font-size-base); font-weight: 600; color: var(--text-primary, #25252b); }
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
  font-size: var(--font-size-sm);
  color: var(--muted, #73777d);
  white-space: nowrap;
}

.pipeline-select {
  flex: 1;
  max-width: 280px;
  padding: 8px 12px;
  border: 1px solid var(--border, #e5e5ea);
  border-radius: 8px;
  font-size: var(--font-size-sm);
  background: var(--surface, #fff);
  color: var(--text-primary, #25252b);
}
.pipeline-select:focus { border-color: var(--coral, #f56c6c); outline: none; }
</style>
