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
      <!-- 状态徽章区域 -->
      <div class="status-header">
        <div class="status-badge" :class="statusConfig.class">
          <span class="status-icon" aria-hidden="true">{{ statusConfig.icon }}</span>
          <span class="status-text">{{ statusConfig.text }}</span>
        </div>
      </div>

      <!-- 用户信息区 -->
      <div class="user-info-section">
        <div class="user-avatar-large">
          <span class="user-avatar">{{ hasSessionIdentity ? avatarInitial : '⚡' }}</span>
          <i class="user-avatar-dot" :class="`is-${identityStatus}`"></i>
        </div>
        <div class="user-details">
          <strong class="user-name">{{ hasSessionIdentity ? displayName : 'Multi-Publish' }}</strong>
          <span class="user-status">{{ statusLabel }}</span>
          <span v-if="statusNote" class="user-hint">{{ statusNote }}</span>
        </div>
      </div>

      <template v-if="hasSessionIdentity">
        <!-- 主要操作组 -->
        <div class="action-group-primary">
          <button
            class="profile-menu-action profile-menu-action-primary"
            type="button"
            role="menuitem"
            data-testid="profile-menu-member"
            @click="goMemberCenter"
          >
            <span class="profile-menu-action-icon" aria-hidden="true">👤</span>{{ t('memberCenter.menuEntry') }}
          </button>
          <button
            class="profile-menu-action"
            type="button"
            role="menuitem"
            data-testid="profile-menu-switch"
            :disabled="loading"
            @click="handleSwitchAccount"
          >
            <span class="profile-menu-action-icon" aria-hidden="true">🔄</span>{{ pendingAction === 'switch' ? t('memberCenter.switchingAccount') : t('memberCenter.switchAccount') }}
          </button>
          <button
            class="profile-menu-action"
            type="button"
            role="menuitem"
            data-testid="profile-menu-signout"
            :disabled="loading"
            @click="handleSignOut"
          >
            <span class="profile-menu-action-icon" aria-hidden="true">🚪</span>{{ pendingAction === 'sign-out' || isSigningOut ? t('memberCenter.signingOut') : t('memberCenter.signOut') }}
          </button>
        </div>
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
          <span class="profile-menu-action-icon" aria-hidden="true">🔐</span>{{ loading ? t('memberCenter.signingIn') : t('memberCenter.loginRetry') }}
        </button>
      </template>

      <div class="profile-menu-sep" role="separator"></div>

      <!-- 次要操作组 -->
      <div class="action-group-secondary">
        <button
          class="profile-menu-action"
          type="button"
          role="menuitem"
          data-testid="profile-menu-settings"
          @click="handleOpenSettings"
        >
          <span class="profile-menu-action-icon" aria-hidden="true">⚙️</span>{{ t('nav.settings') }}
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
      </div>

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
const shouldOpenMenuOnClick = computed(() => ['authenticated', 'offline_authenticated', 'refreshing', 'disabled', 'error', 'signing_in', 'signing_out'].includes(status.value))

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

const statusConfig = computed(() => {
  const currentStatus = status.value
  const identityError = error.value?.code
  
  if (identityError) {
    return { icon: '⚠️', text: t('memberCenter.statusError'), class: 'error' }
  }
  
  switch(currentStatus) {
    case 'expired':
    case 'signed_out':
      return { icon: '⚠️', text: t('memberCenter.statusExpired'), class: 'error' }
    case 'signing_in':
      return { icon: '⏳', text: t('memberCenter.statusSigningIn'), class: 'warning' }
    case 'authenticated':
    case 'offline_authenticated':
    case 'refreshing':
      return { icon: '✓', text: t('memberCenter.statusConnected'), class: 'success' }
    default:
      return { icon: '🔒', text: t('memberCenter.notLoggedIn'), class: 'neutral' }
  }
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
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(140deg, #ffcf80, #ef9e68);
  color: #5d3824;
  font-size: 18px;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: transform 0.3s ease;
}

.mp-avatar:hover {
  transform: rotate(5deg);
}

.mp-avatar-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 12px;
  height: 12px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #a7a8b5;
}

.mp-avatar-dot.is-online { 
  background: #6fbf73; 
  animation: pulse-green 2s infinite;
}

.mp-avatar-dot.is-busy,
.mp-avatar-dot.is-error { 
  background: #e6a23c; 
  animation: pulse-orange 2s infinite;
}

.mp-avatar-dot.is-offline {
  background: #dc2626;
}

.mp-avatar-dot.is-disabled {
  background: #9ca3af;
}

@keyframes pulse-green {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.7; }
}

@keyframes pulse-orange {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.3); opacity: 0.7; }
}

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
  font-size: 12px;
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

/* 面板向上展开，且与侧边栏等宽（不溢出） */
.profile-menu-panel {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 140;
  box-sizing: border-box;
  max-height: min(70vh, 480px);
  overflow-y: auto;
  padding: 16px;
  border: 1px solid var(--card-border);
  border-radius: var(--r-sm);
  background: var(--surface);
  box-shadow: 0 12px 32px rgba(30, 27, 75, 0.14);
  color: var(--ink);
  transform-origin: bottom left;
  animation: panelSlideIn 0.2s ease-out;
}

@keyframes panelSlideIn {
  from {
    opacity: 0;
    transform: scaleY(0.95) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scaleY(1) translateY(0);
  }
}

.profile-menu-heading {
  display: grid;
  gap: 2px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--hairline);
}

/* 状态徽章 */
.status-header {
  margin-bottom: 16px;
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--r-md);
  font-size: 13px;
  font-weight: 600;
  border: 1px solid transparent;
}

.status-badge.error {
  background: #FEF2F2;
  color: #DC2626;
  border: 1px solid #FEB6B6;
}

.status-badge.warning {
  background: #FFFBEB;
  color: #CA8A04;
  border: 1px solid #FDE047;
}

.status-badge.success {
  background: #ECFDF5;
  color: #059669;
  border: 1px solid #A7F3D0;
}

.status-badge.neutral {
  background: #F3F4F6;
  color: #6B7280;
  border: 1px solid #E5E7EB;
}

.status-icon {
  font-size: 16px;
  line-height: 1;
}

.status-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 用户信息区 */
.user-info-section {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: linear-gradient(135deg, rgba(99, 91, 195, 0.04), rgba(255, 255, 255, 0));
  border-radius: var(--r-lg);
  margin-bottom: 16px;
}

.user-avatar-large {
  position: relative;
  flex: 0 0 auto;
}

.user-avatar {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(140deg, #ffcf80, #ef9e68);
  color: #5d3824;
  font-size: 18px;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: transform 0.3s ease;
}

.user-avatar:hover {
  transform: rotate(5deg);
}

.user-avatar-dot {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 14px;
  height: 14px;
  border: 3px solid var(--surface);
  border-radius: 50%;
}

.user-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.user-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-status {
  font-size: 12px;
  color: var(--text-muted);
}

.user-hint {
  font-size: 11px;
  color: var(--text-secondary);
}

.profile-menu-action {
  width: 100%;
  margin-top: 8px;
  padding: 10px 14px;
  border: 1px solid var(--card-border);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  transition: all 0.2s ease;
  position: relative;
}

.profile-menu-action:hover,
.profile-menu-action:focus-visible {
  border-color: var(--primary);
  color: var(--primary);
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(81, 73, 232, 0.15);
}

.profile-menu-action-primary {
  background: linear-gradient(135deg, var(--primary), #6367f1);
  color: white;
  border-color: var(--primary);
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(81, 73, 232, 0.25);
}

.profile-menu-action-primary:hover,
.profile-menu-action-primary:focus-visible {
  background: linear-gradient(135deg, #4f46e5, #6366f1);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(81, 73, 232, 0.3);
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
  border-radius: var(--r-md);
}

.profile-menu-action-upgrade:hover,
.profile-menu-action-upgrade:focus-visible {
  border-color: #c9b46a;
  color: #7a5d15;
  background: linear-gradient(180deg, #fff3cc, #ffe099);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(138, 109, 31, 0.2);
}

.profile-menu-action-icon {
  margin-right: 8px;
  font-size: 14px;
  display: inline-block;
  width: 16px;
  text-align: center;
}

.action-group-primary {
  margin-bottom: 12px;
}

.action-group-secondary {
  margin-top: 12px;
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
  font-size: 12px;
}

@media (max-width: 900px) {
  .mp-profile-copy {
    display: none;
  }
}
</style>
