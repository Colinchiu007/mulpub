<template>
  <div class="member-center-account-security">
    <section class="member-center-card">
      <div class="member-center-card-title">{{ t('memberCenter.accountCardTitle') }}</div>
      <div class="member-center-account-row">
        <span class="member-center-avatar" aria-hidden="true">{{ avatarInitial }}</span>
        <div class="member-center-account-main">
          <strong class="member-center-account-name">{{ displayName }}</strong>
          <span v-if="user?.username" class="member-center-account-username">@{{ user.username }}</span>
        </div>
        <span class="member-center-status-badge" :class="`status-${status}`">{{ statusLabel }}</span>
      </div>
      <div class="member-center-card-actions">
        <!-- ⚠️ 判据方向：`pending` 初值是 null，且只在请求进行中等于本按钮的动作名。
             旧写法 `pending !== 'switch'` / `pending !== 'sign-out'` 把「空闲」当成「禁用」，
             于是这两个按钮在页面上永远是灰的（用户从会员中心根本点不动「切换账号 / 退出登录」）。
             方向与同文件 revoke-others 的 `revoking` 一致：只在自己那次请求进行中禁用。 -->
        <button class="cohere-btn-secondary" data-testid="member-center-switch" :disabled="loading || pending === 'switch'" @click="handleSwitch">
          {{ pending === 'switch' ? t('memberCenter.switchingAccount') : t('memberCenter.switchAccount') }}
        </button>
        <button class="cohere-btn-secondary" data-testid="member-center-signout" :disabled="loading || pending === 'sign-out'" @click="handleSignOut">
          {{ pending === 'sign-out' ? t('memberCenter.signingOut') : t('memberCenter.signOut') }}
        </button>
      </div>
    </section>

    <section class="member-center-card" data-testid="member-center-sessions">
      <div class="member-center-card-title">{{ t('memberCenter.sessionsTitle') }}</div>
      <div class="member-center-toolbar">
        <button class="cohere-btn-secondary" data-testid="member-center-revoke-others" :disabled="memberStore.loading || revoking || !memberStore.sessions.length" @click="handleRevoke">
          {{ revoking ? t('memberCenter.revokingOthers') : t('memberCenter.revokeOthers') }}
        </button>
      </div>
      <ul v-if="memberStore.sessions.length" class="member-center-list">
        <li v-for="(session, index) in memberStore.sessions" :key="session.id || index" class="member-center-list-item">
          <div class="member-center-list-main">
            <span class="member-center-list-title">{{ session.deviceName || session.deviceId || t('memberCenter.unknownDevice') }}</span>
            <span class="member-center-list-meta">{{ t('memberCenter.lastSeen') }}：{{ formatTimestamp(session.lastSeenAt || session.createdAt) }}</span>
          </div>
          <span v-if="index === 0" class="member-center-status-badge">{{ t('memberCenter.currentDevice') }}</span>
        </li>
      </ul>
      <div v-else class="member-center-empty">
        <p class="member-center-empty-hint">{{ t('memberCenter.sessionsEmptyHint') }}</p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIdentity } from '@/composables/useIdentity'
import { confirmDanger } from '@/utils/confirm-danger'
import { useMemberStore } from '@/stores/member'
import { avatarInitialOf, statusLabelOf, formatTimestamp } from './labels'

const { t } = useI18n()
const memberStore = useMemberStore()
const { status, user, displayName, loading, switchAccount, signOut } = useIdentity()

const pending = ref(null)
const revoking = ref(false)
const avatarInitial = computed(() => avatarInitialOf(displayName.value))
const statusLabel = computed(() => statusLabelOf(t, status.value))

async function handleSwitch() {
  pending.value = 'switch'
  try {
    await switchAccount()
  } finally {
    pending.value = null
  }
}

async function handleSignOut() {
  // audit-13：退出登录会中断会员权益/配额/云端同步，此前一点即退
  const confirmed = await confirmDanger({
    title: t('memberCenter.signOutConfirmTitle'),
    message: t('memberCenter.signOutConfirmMessage'),
  })
  if (!confirmed) return
  pending.value = 'sign-out'
  try {
    await signOut()
  } finally {
    pending.value = null
  }
}

async function handleRevoke() {
  // audit-13：撤销其他会话不可逆，且远程会话无法找回
  const confirmed = await confirmDanger({
    title: t('memberCenter.revokeOthersConfirmTitle'),
    message: t('memberCenter.revokeOthersConfirmMessage'),
  })
  if (!confirmed) return
  revoking.value = true
  try {
    await memberStore.revokeOtherSessions()
  } finally {
    revoking.value = false
  }
}
</script>
