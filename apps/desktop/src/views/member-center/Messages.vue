<template>
  <div class="member-center-messages" data-testid="member-center-messages">
    <section class="member-center-card">
      <div class="member-center-card-title">{{ t('memberCenter.messagesTitle') }}</div>
      <div class="member-center-toolbar">
        <button class="cohere-btn-secondary" data-testid="member-center-mark-read" :disabled="marking || !memberStore.unreadCount" @click="handleMarkRead">
          {{ marking ? t('memberCenter.markingRead') : t('memberCenter.markAllRead') }}
        </button>
      </div>
      <ul v-if="memberStore.notifications.length" class="member-center-list">
        <li v-for="(item, index) in memberStore.notifications" :key="item.id || index" class="member-center-list-item">
          <div class="member-center-list-main">
            <span class="member-center-list-title" :class="{ 'is-unread': !item.read }">{{ item.title || t('memberCenter.untitledMessage') }}</span>
            <span v-if="item.body" class="member-center-list-meta">{{ item.body }}</span>
            <span class="member-center-list-meta">{{ formatTimestamp(item.createdAt) }}</span>
          </div>
        </li>
      </ul>
      <div v-else class="member-center-empty">
        <p class="member-center-empty-hint">{{ t('memberCenter.messagesEmptyHint') }}</p>
      </div>
      <!-- P0-5：错误码经 resolveMemberErrorKey 本地化后展示。
           裸码（MEMBER_REQUEST_FAILED 等）直接渲染是修复前的形态。 -->
      <p v-if="memberErrorKey" class="member-center-error" role="alert">{{ t(memberErrorKey) }}</p>
    </section>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMemberStore } from '@/stores/member'
import { formatTimestamp, resolveMemberErrorKey } from './labels'

const { t } = useI18n()
const memberStore = useMemberStore()
const marking = ref(false)

// 未知码/空值在 resolveMemberErrorKey 内兜底为通用失败文案。
const memberErrorKey = computed(() => (memberStore.error ? resolveMemberErrorKey(memberStore.error) : ''))

async function handleMarkRead() {
  marking.value = true
  try {
    await memberStore.markNotificationsRead()
  } finally {
    marking.value = false
  }
}
</script>
