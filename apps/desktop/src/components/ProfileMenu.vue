<template>
  <div ref="root" class="profile-menu" data-testid="profile-menu">
    <button
      id="profile-menu-trigger"
      ref="trigger"
      type="button"
      class="yixiaoer-profile"
      data-testid="yixiaoer-profile"
      :class="{ 'yixiaoer-profile-open': open }"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-busy="loading"
      @click="handleTriggerClick"
      @keydown.down.prevent="openAndFocusFirst"
    >
      <span class="yixiaoer-avatar" aria-hidden="true">{{ hasSessionIdentity ? avatarInitial : '⚡' }}</span>
      <span class="yixiaoer-profile-copy">
        <strong :title="displayName">{{ displayName }}</strong>
        <small class="profile-license-badge" :class="`profile-license-${licenseStore.licenseType}`">{{ licenseLabel }}</small>
      </span>
    </button>

    <div
      v-if="open"
      ref="panel"
      class="profile-menu-panel"
      role="menu"
      aria-labelledby="profile-menu-trigger"
      data-testid="profile-menu-panel"
      @keydown="handleMenuKeydown"
    >
      <div class="profile-menu-heading">
        <strong>{{ hasSessionIdentity ? displayName : 'Multi-Publish' }}</strong>
        <span>{{ statusLabel }}</span>
      </div>

      <template v-if="hasSessionIdentity">
        <button
          class="profile-menu-action"
          type="button"
          role="menuitem"
          data-testid="profile-menu-member"
          @click="goMemberCenter"
        >
          {{ t('memberCenter.menuEntry') }}
        </button>
        <button
          class="profile-menu-action"
          type="button"
          role="menuitem"
          data-testid="profile-menu-switch"
          :disabled="loading"
          @click="handleSwitchAccount"
        >
          {{ pendingAction === 'switch' ? t('memberCenter.switchingAccount') : t('memberCenter.switchAccount') }}
        </button>
        <button
          class="profile-menu-action"
          type="button"
          role="menuitem"
          data-testid="profile-menu-signout"
          :disabled="loading"
          @click="handleSignOut"
        >
          {{ pendingAction === 'sign-out' || isSigningOut ? t('memberCenter.signingOut') : t('memberCenter.signOut') }}
        </button>
      </template>

      <template v-else>
        <p class="profile-menu-note">{{ statusNote }}</p>
        <button
          v-if="status !== 'disabled'"
          class="profile-menu-action profile-menu-action-primary"
          type="button"
          role="menuitem"
          data-testid="profile-menu-signin"
          :disabled="loading"
          @click="handleSignInFromMenu"
        >
          {{ loading ? t('memberCenter.signingIn') : t('memberCenter.loginRetry') }}
        </button>
      </template>

      <p v-if="errorMessage" class="profile-menu-error" role="alert">{{ errorMessage }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useIdentity } from '@/composables/useIdentity'
import { useLicenseStore } from '@/stores/license'
import { useDropdownBehavior } from '@/composables/useDropdownBehavior'
import {
  resolveIdentityErrorMessageKey,
  resolveIdentityStatusNoteKey,
} from '@/utils/identity-error-messages'

const router = useRouter()
const { t } = useI18n()
const licenseStore = useLicenseStore()
const { status, user, displayName, loading, error, signIn, switchAccount, signOut } = useIdentity()
const { open, root, trigger, panel, toggle, close, openAndFocusFirst, handleMenuKeydown } = useDropdownBehavior()

const pendingAction = ref(null)
const isSigningOut = computed(() => status.value === 'signing_out')
const hasSessionIdentity = computed(() => Boolean(user.value?.sub) && !['disabled', 'signed_out', 'expired'].includes(status.value))

const avatarInitial = computed(() => Array.from(displayName.value || 'M')[0].toUpperCase())
const licenseLabel = computed(() => {
  if (licenseStore.isPro) return t('memberCenter.licensePro')
  if (licenseStore.isTrial) return t('memberCenter.licenseTrial')
  return t('memberCenter.licenseFree')
})
const shouldOpenMenuOnClick = computed(() => ['authenticated', 'offline_authenticated', 'refreshing', 'disabled', 'error'].includes(status.value))

const statusLabel = computed(() => {
  if (status.value === 'authenticated') return t('memberCenter.statusConnected')
  if (status.value === 'offline_authenticated') return t('memberCenter.statusOffline')
  if (status.value === 'refreshing') return t('memberCenter.statusRefreshing')
  if (status.value === 'signing_in') return t('memberCenter.statusSigningIn')
  if (status.value === 'expired') return t('memberCenter.statusExpired')
  if (status.value === 'error') return hasSessionIdentity.value ? t('memberCenter.statusConnected') : t('memberCenter.statusError')
  if (isSigningOut.value) return t('memberCenter.statusSigningOut')
  if (status.value === 'disabled') return t('memberCenter.identityDisabled')
  return t('memberCenter.notLoggedIn')
})

const statusNote = computed(() => t(resolveIdentityStatusNoteKey(status.value)))

const errorMessage = computed(() => {
  const entry = error.value
  if (!entry?.code) return ''
  const primary = t(resolveIdentityErrorMessageKey(entry.code))
  const cleanupCode = entry.cleanup?.code
  if (!cleanupCode) return primary
  const secondary = t(resolveIdentityErrorMessageKey(cleanupCode))
  return secondary === primary ? primary : `${primary} ${secondary}`
})

async function handleTriggerClick() {
  if (open.value) {
    close()
    return
  }
  // 未登录（含会话过期）→ 直接打开登录弹窗；失败时展开菜单展示错误
  const idleUnauthenticated = status.value === 'signed_out' || status.value === 'expired'
  if (idleUnauthenticated && !loading.value) {
    const ok = await signIn()
    if (!ok) openAndFocusFirst()
    return
  }
  if (shouldOpenMenuOnClick.value) openAndFocusFirst()
}

async function handleSignInFromMenu() {
  const ok = await signIn()
  if (ok) close()
}

async function handleSwitchAccount() {
  pendingAction.value = 'switch'
  try {
    const ok = await switchAccount()
    if (ok) close()
  } finally {
    pendingAction.value = null
  }
}

async function handleSignOut() {
  pendingAction.value = 'sign-out'
  try {
    const ok = await signOut()
    if (ok) close()
  } finally {
    pendingAction.value = null
  }
}

function goMemberCenter() {
  close()
  router.push('/member-center')
}
</script>

<style scoped>
.profile-menu {
  position: relative;
  min-width: 0;
  display: flex;
  flex: 1;
}

.yixiaoer-profile {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 8px;
}

.yixiaoer-profile:hover,
.yixiaoer-profile:focus-visible,
.yixiaoer-profile-open {
  background: rgba(255, 255, 255, 0.6);
}

.yixiaoer-profile:focus-visible {
  outline: 2px solid #5149e8;
  outline-offset: 1px;
}

.yixiaoer-avatar {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 50%;
  background: linear-gradient(140deg, #ffcf80, #ef9e68);
  color: #5d3824;
  font-size: 13px;
  font-weight: 700;
}

.yixiaoer-profile-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yixiaoer-profile-copy strong {
  overflow: hidden;
  color: #4d4f6f;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-license-badge {
  width: fit-content;
  padding: 1px 5px;
  border-radius: 8px;
  background: #e3e1f2;
  color: #9293a6;
  font-size: 10px;
}

.profile-license-pro {
  background: #fdecc8;
  color: #8a6d1f;
}

.profile-license-trial {
  background: #d9f0ff;
  color: #27618a;
}

.profile-menu-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 140;
  box-sizing: border-box;
  width: min(240px, calc(100vw - 24px));
  padding: 12px;
  border: 1px solid var(--card-border);
  border-radius: var(--r-sm);
  background: var(--surface);
  box-shadow: 0 12px 32px rgba(30, 27, 75, 0.14);
  color: var(--ink);
}

.profile-menu-heading {
  display: grid;
  gap: 2px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--hairline);
}

.profile-menu-heading strong {
  min-width: 0;
  overflow-wrap: anywhere;
}

.profile-menu-heading span,
.profile-menu-note {
  color: var(--text-muted);
  font-size: 12px;
}

.profile-menu-action {
  width: 100%;
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid var(--card-border);
  border-radius: var(--r-xs);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  text-align: left;
}

.profile-menu-action-primary {
  border-color: var(--primary);
  color: var(--primary);
}

.profile-menu-action:disabled {
  cursor: wait;
  opacity: 0.6;
}

.profile-menu-note,
.profile-menu-error {
  margin: 10px 0 0;
}

.profile-menu-error {
  color: var(--error);
  font-size: 12px;
}

@media (max-width: 900px) {
  .yixiaoer-profile-copy {
    display: none;
  }

  .profile-menu-panel {
    left: 0;
  }
}
</style>