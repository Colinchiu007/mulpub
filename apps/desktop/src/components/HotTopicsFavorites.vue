<template>
  <div v-if="activeTab === 'favorites'" class="favorites-section">
    <div v-if="favorites.length === 0" class="empty-box" data-testid="hot-topics-favorites-empty">
      <div class="empty-title">{{ t('hotTopics.favoritesEmptyTitle') }}</div>
      <div class="empty-desc">{{ t('hotTopics.favoritesEmptyDesc') }}</div>
    </div>
    <div v-else class="topics-list">
      <div
        v-for="fav in favorites"
        :key="fav.topic?.id || fav.favoritedAt"
        class="topic-item favorite-item"
        data-testid="hot-topic-favorite-item"
      >
        <span class="rank-badge fav-star">♡</span>
        <span
          class="topic-text"
          :title="fav.topic ? getTopicSummary(fav.topic) : ''"
        >{{ fav.topic ? displayTopic(fav.topic.topic) : '—' }}</span>
        <span v-if="fav.topic" class="tag category-tag" :class="'cat-' + fav.topic.category">{{ t('hotTopics.categories.' + fav.topic.category) }}</span>
        <span v-if="fav.topic" class="tag channel-tag">{{ t('hotTopics.channels.' + fav.topic.channel) }}</span>
        <span v-if="fav.favoritedAt" class="fav-date">{{ formatFavoritedAt(fav.favoritedAt) }}</span>
        <button class="cohere-btn-secondary item-create-btn" @click="onRemove(fav)">
          {{ t('hotTopics.unfavorite') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  activeTab: { type: String, default: 'hot' },
  favorites: { type: Array, default: () => [] },
  getTopicSummary: { type: Function, required: true },
  displayTopic: { type: Function, required: true },
  formatFavoritedAt: { type: Function, required: true },
})

const emit = defineEmits(['remove-favorite'])

function onRemove(fav) {
  // 损坏数据（fav.topic 为 null）仍允许清理：传 favoritedAt 作备用 ID
  emit('remove-favorite', (fav.topic && fav.topic.id) || (fav.favoritedAt ? String(fav.favoritedAt) : undefined))
}
</script>

