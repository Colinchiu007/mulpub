<template>
  <div v-if="activeTab === 'favorites'" class="favorites-section">
    <EmptyState
      v-if="favorites.length === 0"
      data-testid="hot-topics-favorites-empty"
      icon="♡"
      :title="t('hotTopics.favoritesEmptyTitle')"
      :description="t('hotTopics.favoritesEmptyDesc')"
    />
    <div v-else class="topics-list">
      <div
        v-for="fav in favorites"
        :key="fav.topic?.id || fav.favoritedAt"
        class="topic-item favorite-item"
        data-testid="hot-topic-favorite-item"
      >
        <span class="rank-badge fav-star" aria-hidden="true">♥</span>
        <span
          class="topic-text"
          :title="fav.topic ? getTopicSummary(fav.topic) : ''"
        >{{ fav.topic ? displayTopic(fav.topic.topic) : '—' }}</span>
        <span v-if="fav.topic" class="tag category-tag" :class="'cat-' + fav.topic.category">{{ t('hotTopics.categories.' + fav.topic.category) }}</span>
        <span v-if="fav.topic" class="tag channel-tag">{{ t('hotTopics.channels.' + fav.topic.channel) }}</span>
        <span v-if="fav.topic && fav.topic.hotValue" class="hot-value">{{ formatHotValue(fav.topic.hotValue) }}</span>
        <span
          v-if="fav.favoritedAt"
          class="fav-date"
          :title="t('hotTopics.favoritedAt', { time: formatFavoritedAt(fav.favoritedAt) })"
        >{{ formatFavoritedAt(fav.favoritedAt) }}</span>
        <button
          class="cohere-btn-secondary item-unfav-btn"
          :data-testid="'hot-topic-favorite-unfav-' + favKey(fav)"
          @click="onRemove(fav)"
        >{{ t('hotTopics.unfavorite') }}</button>
        <button
          class="cohere-btn-secondary item-create-btn"
          :disabled="!fav.topic"
          :data-testid="'hot-topic-favorite-create-copy-' + favKey(fav)"
          @click="onCreateCopy(fav)"
        >{{ t('hotTopics.createCopy') }}</button>
        <!-- hot-topics-pipeline-picker（2026-10-17）：收藏行与热门行共用同一按钮组；
             选中流水线后 emit 带 topic + pipelineName，父级直接 startGenerateVideo(topic, pipeline) -->
        <HotTopicsGenVideoPicker
          :topic-id="favKey(fav)"
          :favorite="true"
          :busy="genVideoBusy"
          :disabled="!fav.topic"
          @generate="onGenerateVideo(fav)"
          @pick="(pipelineName) => onPickPipeline(fav, pipelineName)"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import EmptyState from '@/components/EmptyState.vue'
import HotTopicsGenVideoPicker from '@/components/HotTopicsGenVideoPicker.vue'

const { t } = useI18n()

const props = defineProps({
  activeTab: { type: String, default: 'hot' },
  favorites: { type: Array, default: () => [] },
  getTopicSummary: { type: Function, required: true },
  displayTopic: { type: Function, required: true },
  formatFavoritedAt: { type: Function, required: true },
  formatHotValue: { type: Function, required: true },
  // 收藏行与热门行共用同一「生成视频」编排，busy 时统一禁用（避免并发编排互踩）
  genVideoBusy: { type: Boolean, default: false },
})

const emit = defineEmits(['remove-favorite', 'create-copy', 'generate-video'])

/** 收藏条目稳定标识：话题 id 优先；损坏数据（topic 为 null）回退收藏时间 */
function favKey(fav) {
  return (fav.topic && fav.topic.id) || (fav.favoritedAt ? String(fav.favoritedAt) : 'unknown')
}

function onRemove(fav) {
  // 损坏数据（fav.topic 为 null）仍允许清理：传 favoritedAt 作备用 ID
  emit('remove-favorite', (fav.topic && fav.topic.id) || (fav.favoritedAt ? String(fav.favoritedAt) : undefined))
}

function onCreateCopy(fav) {
  if (!fav.topic) return
  emit('create-copy', fav.topic)
}

function onGenerateVideo(fav) {
  if (!fav.topic || props.genVideoBusy) return
  emit('generate-video', fav.topic)
}

/** 选择器选中某条流水线：把 topic + pipelineName 一起交给父级编排 */
function onPickPipeline(fav, pipelineName) {
  if (!fav.topic || props.genVideoBusy) return
  emit('generate-video', fav.topic, pipelineName)
}
</script>

<style scoped src="../styles/hot-topics-list.css"></style>
