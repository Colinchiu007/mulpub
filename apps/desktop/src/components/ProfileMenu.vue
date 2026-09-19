<template>
  <div ref="root" class="profile-menu" data-testid="profile-menu">
    <button
      id="profile-menu-trigger"
      ref="trigger"
      type="button"
      class="mp-profile"
      :class="{ 'mp-profile-open': open }"
      data-testid="mp-profile"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-busy="loading"
      :title="clientStatusTitle"
      @click="handleTriggerClick"
      @keydown.down.prevent="openAndFocusFirst"
    >
      <span class="mp-avatar-wrap" aria-hidden="true">
        <span class="mp-avatar">{{ hasSessionIdentity ? avatarInitial : '⚡' }}</span>
        <i class="mp-avatar-dot" :class="`is-${identityStatus}`" data-testid="mp-profile-status"></i>
      </span>
      <span class="mp-profile-copy">
        <strong :title="displayName">{{ displayName }}</strong>
        <small class="profile-license-badge" :class="`profile-license-${licenseStore.licenseType}`">{{ licenseLabel }}</small>
      </span>
      <ArrowUp class="mp-profile-caret" :class="{ rotated: open }" aria-hidden="true" />
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

      <div class="profile-menu-sep" role="separator"></div>

      <button
        class="profile-menu-action"
        type="button"
        role="menuitem"
        data-testid="profile-menu-settings"
        @click="handleOpenSettings"
      >
        {{ t('nav.settings') }}
      </button>
      <button
        v-if="!licenseStore.isPro"
        class="profile-menu-action profile-menu-action-upgrade"
        type="button"
        role="menuitem"
        data-testid="profile-menu-upgrade"
        @click="handleUpgrade"
      >
        <span class="profile-menu-action-icon" aria-hidden="true">⭐</span>{{ t('memberCenter.upgradePro') }}
      </button>

      <p v-if="errorMessage" class="profile-menu-error" role="alert">{{ errorMessage }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowUp } from '@element-plus/icons-vue'
import { useIdentity } from '@/composables/useIdentity'
import { useLicenseStore } from '@/stores/license'
import { useDropdownBehavior } from '@/composables/useDropdownBehavior'
import {
  resolveIdentityErrorMessageKey,
  resolveIdentityStatusNoteKey,
} from '@/utils/identity-error-messages'

const emit = defineEmits(['open-settings', 'upgrade'])

const router = useRouter()
const { t } = useI18n()
const licenseStore = useLicenseStore()
const { status, user, displayName, loading, error, signIn, signInOrSwitch, switchAccount, signOut } = useIdentity()
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

// banner 头像右下角的存在状态点（与展开菜单内的状态文案同源，取代旧的侧边栏状态行）
const identityStatus = computed(() => {
  const current = status.value
  return ['authenticated', 'refreshing', 'offline_authenticated'].includes(current) ? 'online'
    : ['signing_in', 'signing_out'].includes(current) ? 'busy'
    : current === 'disabled' ? 'disabled'
    : ['signed_out', 'expired'].includes(current) ? 'offline'
    : 'error'
})

const clientStatusLabel = computed(() => {
  if (identityStatus.value === 'online') return t('memberCenter.statusConnected')
  if (identityStatus.value === 'busy') return status.value === 'signing_in'
    ? t('memberCenter.statusSigningIn')
    : t('memberCenter.statusSigningOut')
  if (identityStatus.value === 'disabled') return t('memberCenter.identityDisabled')
  if (identityStatus.value === 'offline') return status.value === 'expired'
    ? t('memberCenter.statusExpired')
    : t('memberCenter.notLoggedIn')
  return t('memberCenter.statusError')
})

const clientStatusTitle = computed(() => clientStatusLabel.value)

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
    const ok = await signInOrSwitch()
    if (!ok) openAndFocusFirst()
    return
  }
  if (shouldOpenMenuOnClick.value) openAndFocusFirst()
}

async function handleSignInFromMenu() {
  // signInOrSwitch: 被拒（残留旧会话）时自动降级为切换账号，避免卡死
  const ok = await signInOrSwitch()
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

// 设置入口：关闭菜单后交回宿主（侧边栏 → App.vue 打开设置弹窗）
function handleOpenSettings() {
  close()
  emit('open-settings')
}

// 升级入口：关闭菜单后交回宿主（侧边栏 → 打开升级弹窗）
function handleUpgrade() {
  close()
  emit('upgrade')
}
</script>

<style scoped>
.profile-menu {
  position: relative;
  width: 100%;
  min-width: 0;
  flex: 0 0 auto;
  display: block;
}

/* 底部 banner 形态：整行卡片，收起时只显示这一条 */
.mp-profile {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid #e3e1f2;
  border-radius: 10px;
  background: rgba(255, 255, 255, .72);
  box-shadow: 0 2px 8px rgba(99, 91, 195, .06);
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}

.mp-profile:hover,
.mp-profile:focus-visible,
.mp-profile-open {
  border-color: #bab9d3;
  background: rgba(255, 255, 255, .94);
}

.mp-profile:focus-visible {
  outline: 2px solid #5149e8;
  outline-offset: 1px;
}

.mp-avatar-wrap {
  position: relative;
  display: inline-grid;
  flex: 0 0 auto;
}

.mp-avatar {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(140deg, #ffcf80, #ef9e68);
  color: #5d3824;
  font-size: var(--font-size-sm);
  font-weight: 700;
}

.mp-avatar-dot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 10px;
  height: 10px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #a7a8b5;
}

.mp-avatar-dot.is-online { background: #6fbf73; }

.mp-avatar-dot.is-busy,
.mp-avatar-dot.is-error { background: #e6a23c; }

.mp-profile-copy {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.mp-profile-copy strong {
  overflow: hidden;
  color: #4d4f6f;
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mp-profile-caret {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: #a5a6bd;
  transition: transform .15s ease;
}

.mp-profile-caret.rotated {
  transform: rotate(180deg);
}

.profile-license-badge {
  width: fit-content;
  padding: 1px 5px;
  border-radius: 8px;
  background: #e3e1f2;
  color: #9293a6;
  font-size: var(--font-size-xs);
}

.profile-license-pro {
  background: #fdecc8;
  color: #8a6d1f;
}

.profile-license-trial {
  background: #d9f0ff;
  color: #27618a;
}

/* 面板向上展开，且与 banner 等宽（不溢出侧边栏） */
.profile-menu-panel {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 140;
  box-sizing: border-box;
  max-height: min(70vh, 420px);
  overflow-y: auto;
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
  font-size: var(--font-size-xs);
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

.profile-menu-action:hover,
.profile-menu-action:focus-visible {
  border-color: var(--primary);
  color: var(--primary);
}

.profile-menu-action-primary {
  border-color: var(--primary);
  color: var(--primary);
}

.profile-menu-action:disabled {
  cursor: wait;
  opacity: 0.6;
}

/* 升级 Pro 与「设置 / 账号操作」共用同一菜单项版式，仅以金色强调 */
.profile-menu-action-upgrade {
  border-color: #d9c98a;
  background: linear-gradient(180deg, #fff7e0, #ffeec2);
  color: #8a6d1f;
  font-weight: 600;
}

.profile-menu-action-upgrade:hover,
.profile-menu-action-upgrade:focus-visible {
  border-color: #c9b46a;
  color: #7a5d15;
}

.profile-menu-action-icon {
  margin-right: 6px;
}

.profile-menu-sep {
  margin-top: 10px;
  border-top: 1px solid var(--hairline);
}

.profile-menu-note,
.profile-menu-error {
  margin: 10px 0 0;
}

.profile-menu-error {
  color: var(--error);
  font-size: var(--font-size-xs);
}

@media (max-width: 900px) {
  .mp-profile-copy {
    display: none;
  }
}
</style>
