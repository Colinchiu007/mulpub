<template>
  <div ref="root" class="profile-menu" data-testid="profile-menu">
    <button
      id="profile-menu-trigger"
      ref="trigger"
      type="button"
      class="mp-profile"
      :class="{ 'mp-profile-open': open, 'mp-profile-busy': busy }"
      data-testid="mp-profile"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-busy="loading || busy"
      :disabled="busy"
      :title="clientStatusTitle"
      @click="handleTriggerClick"
      @keydown.down.prevent="openAndFocusFirst"
    >
      <span class="mp-avatar-wrap" aria-hidden="true">
        <span v-if="revealingLogin" class="mp-avatar-spinner" data-testid="mp-profile-spinner"></span>
        <span v-else class="mp-avatar"><template v-if="hasSessionIdentity">{{ avatarInitial }}</template><el-icon v-else><User /></el-icon></span>
        <i class="mp-avatar-dot" :class="`is-${identityStatus}`" data-testid="mp-profile-status"></i>
      </span>
      <span class="mp-profile-copy">
        <strong :title="revealingLogin ? t('memberCenter.signingIn') : displayName">{{ revealingLogin ? t('memberCenter.signingIn') : displayName }}</strong>
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
        <span class="profile-menu-status" :class="`is-${identityStatus}`">
          <i class="profile-menu-status-dot" aria-hidden="true"></i>{{ statusLabel }}
        </span>
      </div>

      <template v-if="hasSessionIdentity">
        <button
          class="profile-menu-action"
          type="button"
          role="menuitem"
          data-testid="profile-menu-member"
          @click="goMemberCenter"
        >
          <User class="profile-menu-action-icon" aria-hidden="true" />
          <span>{{ t('memberCenter.menuEntry') }}</span>
        </button>
        <button
          class="profile-menu-action"
          type="button"
          role="menuitem"
          data-testid="profile-menu-switch"
          :disabled="loading"
          @click="handleSwitchAccount"
        >
          <Refresh class="profile-menu-action-icon" aria-hidden="true" />
          <span>{{ pendingAction === 'switch' ? t('memberCenter.switchingAccount') : t('memberCenter.switchAccount') }}</span>
        </button>
        <button
          class="profile-menu-action"
          type="button"
          role="menuitem"
          data-testid="profile-menu-signout"
          :disabled="loading"
          @click="handleSignOut"
        >
          <SwitchButton class="profile-menu-action-icon" aria-hidden="true" />
          <span>{{ pendingAction === 'sign-out' || isSigningOut ? t('memberCenter.signingOut') : t('memberCenter.signOut') }}</span>
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
          <Key class="profile-menu-action-icon" aria-hidden="true" />
          <span>{{ loading ? t('memberCenter.signingIn') : t('memberCenter.loginRetry') }}</span>
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
        <Setting class="profile-menu-action-icon" aria-hidden="true" />
        <span>{{ t('nav.settings') }}</span>
      </button>
      <button
        v-if="!licenseStore.isPro"
        class="profile-menu-action profile-menu-action-upgrade"
        type="button"
        role="menuitem"
        data-testid="profile-menu-upgrade"
        @click="handleUpgrade"
      >
        <Medal class="profile-menu-action-icon" aria-hidden="true" />
        <span>{{ t('memberCenter.upgradePro') }}</span>
      </button>

      <p v-if="errorMessage" class="profile-menu-error" role="alert">
        <CircleCloseFilled class="profile-menu-error-icon" aria-hidden="true" />{{ errorMessage }}
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowUp, CircleCloseFilled, Key, Medal, Refresh, Setting, SwitchButton, User } from '@element-plus/icons-vue'
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
// 点击登录到认证窗口真正可见之间存在网络 discovery / 授权页加载的空窗期，
// 用本地 busy 立刻给出反馈并禁用触发器，避免重复点击与「点了没反应」的错觉。
const busy = ref(false)
const isSigningOut = computed(() => status.value === 'signing_out')
const hasSessionIdentity = computed(() => Boolean(user.value?.sub) && !['disabled', 'signed_out', 'expired'].includes(status.value))
// 登录空窗期（从点击到认证窗口真正可见）在触发器上给出明确反馈：
// 头像转圈 + 文案「正在打开登录...」，避免2 秒网络等待期被误认为「点了没反应」。
const revealingLogin = computed(() => busy.value || status.value === 'signing_in')

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
    if (busy.value) return
    busy.value = true
    try {
      const ok = await signInOrSwitch()
      if (!ok) openAndFocusFirst()
    } finally {
      busy.value = false
    }
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

.mp-profile-busy {
  cursor: wait;
  opacity: .72;
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

/* 登录空窗期头像转圈：与头像同尺寸的同位替换，给点击以即时可见反馈 */
.mp-avatar-spinner {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid rgba(99, 91, 195, .22);
  border-top-color: #5149e8;
  animation: mp-profile-spin .8s linear infinite;
}

@keyframes mp-profile-spin {
  to { transform: rotate(360deg); }
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

/* 面板向上展开，且与 banner 等宽（不溢出侧边栏）；展开时淡入 + 轻微上浮 */
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
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: 0 12px 32px rgba(30, 27, 75, 0.16);
  color: var(--ink);
  transform-origin: bottom center;
  animation: profile-menu-pop .16s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes profile-menu-pop {
  from { opacity: 0; transform: translateY(6px) scale(.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .profile-menu-panel {
    animation: none;
  }

  .mp-avatar-spinner {
    animation-duration: 2.4s;
  }
}

.profile-menu-heading {
  display: grid;
  gap: 4px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--hairline);
}

.profile-menu-heading strong {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

/* 状态胶囊：带状态色小圆点，取代旧的裸文字状态行 */
.profile-menu-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  width: fit-content;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--text-muted) 14%, transparent);
  color: var(--text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.6;
}

.profile-menu-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.profile-menu-status.is-online { background: color-mix(in srgb, #6fbf73 16%, transparent); color: #3f8f45; }
.profile-menu-status.is-busy { background: color-mix(in srgb, #e6a23c 18%, transparent); color: #a86f16; }
.profile-menu-status.is-error { background: color-mix(in srgb, var(--error) 14%, transparent); color: var(--error); }

[data-theme="dark"] .profile-menu-status.is-online { color: #86d68b; }
[data-theme="dark"] .profile-menu-status.is-busy { color: #f0c274; }

.profile-menu-note {
  margin: 10px 0 0;
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}

/* 菜单项：扁平行式（去盒子感），仅 hover/focus 时显浅底高亮 */
.profile-menu-action {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-top: 2px;
  padding: 9px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
  text-align: left;
  transition: background .15s ease, color .15s ease;
}

.profile-menu-action:hover,
.profile-menu-action:focus-visible {
  background: color-mix(in srgb, var(--primary) 8%, transparent);
  color: var(--primary);
}

.profile-menu-action:disabled {
  cursor: wait;
  opacity: .55;
}

.profile-menu-action-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: currentColor;
}

/* 主操作（重试登录）：实心品牌色填充，锚定视觉焦点 */
.profile-menu-action-primary {
  justify-content: center;
  margin-top: 8px;
  background: var(--primary);
  color: #fff;
  font-weight: 600;
}

.profile-menu-action-primary:hover,
.profile-menu-action-primary:focus-visible {
  background: var(--color-primary-hover);
  color: #fff;
}

/* 升级 Pro：柔和金底（无边框），与菜单项同版式，仅以金色强调 */
.profile-menu-action-upgrade {
  background: color-mix(in srgb, #eab308 16%, var(--surface));
  color: #8a6d1f;
  font-weight: 600;
}

.profile-menu-action-upgrade:hover,
.profile-menu-action-upgrade:focus-visible {
  background: color-mix(in srgb, #eab308 26%, var(--surface));
  color: #7a5d15;
}

[data-theme="dark"] .profile-menu-action-upgrade { color: #f0c96a; }
[data-theme="dark"] .profile-menu-action-upgrade:hover,
[data-theme="dark"] .profile-menu-action-upgrade:focus-visible { color: #f7d888; }

.profile-menu-sep {
  margin: 8px 0 4px;
  border-top: 1px solid var(--hairline);
}

/* 错误提示：收进带左侧色条的 alert 容器，语义清晰不悬空 */
.profile-menu-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 10px 0 0;
  padding: 8px 10px;
  border-left: 3px solid var(--error);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--error) 10%, var(--surface));
  color: var(--error);
  font-size: var(--font-size-xs);
  line-height: 1.5;
}

.profile-menu-error-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  margin-top: 1px;
}

@media (max-width: 900px) {
  .mp-profile-copy {
    display: none;
  }
}
</style>
