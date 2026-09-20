<template>
  <article
    class="account-row account-card"
    :data-testid="`account-card-${account.id}`"
    :class="{ 'is-selected': selected, 'is-default': account.is_default }"
    :aria-label="`${accountDisplayName}（${platformLabel}）`"
    role="button"
    tabindex="0"
    :title="creatorHint || undefined"
    @click="onCardClick"
    @keydown.enter="onCardActivate"
    @keydown.space.prevent="onCardActivate"
  >
    <header class="account-card-header">
      <label v-if="batchMode" class="select-account" :title="t('accountsPage.accountCardLabels.selectAccount', { name: accountName(account) })" @click.stop>
        <input
          :data-testid="`select-${account.id}`"
          type="checkbox"
          :checked="selected"
          :aria-label="t('accountsPage.accountCardLabels.selectAccount', { name: accountName(account) })"
          @change="$emit('toggle-select', account.id)"
        >
      </label>
      <span class="platform-chip">
        <img v-if="isIconUrl(platformIcon)" :src="platformIcon" class="platform-icon-img" :alt="platformLabel" width="24" height="24" aria-hidden="true">
<span v-else class="platform-icon" aria-hidden="true">{{ platformIcon }}</span>
        {{ accountDisplayName }}
      </span>
      <button
        class="favorite-button"
        :class="{ active: favorite }"
        type="button"
        :title="favorite ? t('accountsPage.accountCardLabels.favoriteRemove') : t('accountsPage.accountCardLabels.favoriteAdd')"
        :aria-label="favorite ? t('accountsPage.accountCardLabels.favoriteRemove') : t('accountsPage.accountCardLabels.favoriteAdd')"
        :data-testid="`favorite-${account.id}`"
        @click.stop="$emit('toggle-favorite', account.id)"
      >
        <StarFilled v-if="favorite" />
        <Star v-else />
      </button>
    </header>

    <div class="account-profile">
      <div class="account-avatar">
        <img v-if="account.avatar || account.avatar_url" :src="account.avatar || account.avatar_url" alt="">
        <UserFilled v-else />
      </div>
      <span
        :class="['login-badge', statusClass(account)]"
        :data-testid="`account-status-${account.id}`"
        role="status"
        :aria-label="t('accountsPage.accountCardLabels.accountLoginStatus', { status: statusLabel(account) })"
      >{{ statusLabel(account) }}</span>
      <div class="account-identity">
        <button
          v-if="!editing"
          class="account-name-button"
          type="button"
          :title="t('accountsPage.accountCardLabels.renameAccount')"
          @click.stop="startEditing"
        >
          <span>{{ accountName(account) }}</span>
          <EditPen aria-hidden="true" />
        </button>
        <input
          v-else
          ref="nameInput"
          class="account-name-input"
          :value="accountName(account)"
          :aria-label="t('accountsPage.accountCardLabels.accountNameLabel', { name: accountName(account) })"
          spellcheck="false"
          @click.stop
          @blur="finishEditing"
          @keyup.enter="$event.target.blur()"
        >
        <div class="account-details">
          <span v-if="account.is_default" class="default-label">{{ t('accountsPage.accountCardLabels.defaultAccount') }}</span>
          <span v-if="account.created_at">{{ t('accountsPage.accountCardLabels.addedOn', { date: formatDate(account.created_at) }) }}</span>
          <span v-else>{{ t('accountsPage.accountCardLabels.accountSynced') }}</span>
          <span :data-testid="`account-check-${account.id}`">{{ loginCheckLabel(account) }}</span>
        </div>
        <div class="account-followers" :data-testid="`account-followers-${account.id}`">
          {{ t('accountsPage.accountCardLabels.followers') }}{{ followersLabel(account) }}
        </div>
        <div class="account-assignees" :aria-label="t('accountsPage.accountCardLabels.accountInfo')">
          <div :data-testid="`account-owner-${account.id}`"><span class="assignee-badge assignee-owner">{{ t('accountsPage.accountCardLabels.ownerLabel') }}</span><strong>{{ assigneeLabel(account, OWNER_KEYS) }}</strong></div>
          <div :data-testid="`account-publisher-${account.id}`"><span class="assignee-badge assignee-publisher">{{ t('accountsPage.accountCardLabels.publisherLabel') }}</span><strong>{{ assigneeLabel(account, PUBLISHER_KEYS) }}</strong></div>
          <div :data-testid="`account-proxy-${account.id}`"><span class="assignee-badge assignee-proxy">{{ t('accountsPage.accountCardLabels.proxyLabel') }}</span><strong>{{ proxyLabel(account) }}</strong></div>
        </div>
      </div>
    </div>

    <footer class="account-actions">
      <button :data-testid="`proxy-${account.id}`" data-e2e-scan="manual" type="button" @click.stop="$emit('configure-proxy', account)">
        <Setting />{{ t('accountsPage.accountCardLabels.settings') }}
      </button>
      <button
        :data-testid="`verify-${account.id}`"
        data-e2e-scan="manual"
        type="button"
        :disabled="verifying"
        @click.stop="$emit('check-login', account)"
      >
        <CircleCheck />{{ t('accountsPage.accountCardLabels.verify') }}
      </button>
      <button
        v-if="checkedExpiredIds?.has?.(account.id)"
        :data-testid="`login-${account.id}`"
        data-e2e-scan="manual"
        type="button"
        class="login-button"
        :title="t('accountsPage.accountCardLabels.goLogin')"
        @click.stop="$emit('open-login', account)"
      >
        <Monitor />{{ t('accountsPage.accountCardLabels.goLogin') }}
      </button>
      <button class="danger" :data-testid="`delete-${account.id}`" data-e2e-scan="manual" type="button" @click.stop="$emit('remove', account)">
        <Delete />{{ t('accountsPage.accountCardLabels.delete') }}
      </button>
    </footer>
  </article>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, Delete, EditPen, Monitor, Refresh, Setting, Star, StarFilled, UserFilled } from '@element-plus/icons-vue'

const props = defineProps({
  account: { type: Object, required: true },
  platformLabel: { type: String, required: true },
  platformIcon: { type: String, default: '' },
  selected: { type: Boolean, default: false },
  favorite: { type: Boolean, default: false },
  batchMode: { type: Boolean, default: false },
  verifying: { type: Boolean, default: false },
  creatorHint: { type: String, default: '' },
  checkedExpiredIds: { type: Object, default: () => new Set() },
})

const { t } = useI18n()

const emit = defineEmits([
  'toggle-select',
  'toggle-favorite',
  'set-default',
  'rename',
  'configure-proxy',
  'check-login',
  'open-login',
  'remove',
  'open-creator',
])

const editing = ref(false)
const nameInput = ref(null)
const accountDisplayName = computed(() => accountName(props.account))

/**
 * 卡片整体点击（对齐参考产品：点击账号卡片打开该账号创作者中心）。
 * 批量模式下点击卡片改为切换选中，避免误打开标签页。
 */
function onCardClick () {
  if (props.batchMode) {
    emit('toggle-select', props.account.id)
    return
  }
  emit('open-creator', props.account)
}

/** 键盘激活（Enter/Space）：仅响应卡片自身焦点，内部输入框回车不触发 */
function onCardActivate (event) {
  if (event.target !== event.currentTarget) return
  event.preventDefault()
  onCardClick()
}

function startEditing () {
  editing.value = true
  nextTick(() => {
    nameInput.value?.focus()
    nameInput.value?.select()
  })
}

function finishEditing (event) {
  editing.value = false
  const name = String(event.target.value || '').trim()
  if (!name || name === accountName(props.account)) return
  emit('rename', props.account, name)
}

const OWNER_KEYS = ['owner', 'owner_name', 'ownerName', 'account_owner', 'accountOwner', '负责人']
const PUBLISHER_KEYS = ['publisher', 'publisher_name', 'publisherName', 'operator', 'operator_name', 'operatorName', '运营人', '发布人']
const FOLLOWER_KEYS = ['followers', 'follower_count', 'followers_count', 'fans', 'fans_count', 'fansCount', '粉丝数']

function accountName (account) {
  return account.account_name || account.name || t('accountsPage.accountCardLabels.unnamedAccount')
}

function valueLabel (value) {
  if (value && typeof value === 'object') return value.name || value.label || value.nickname || value.value || ''
  return String(value ?? '').trim()
}

function firstValue (account, keys) {
  for (const key of keys) {
    const value = valueLabel(account?.[key])
    if (value) return value
  }
  return ''
}

function followersLabel (account) {
  const value = firstValue(account, FOLLOWER_KEYS)
  return value || t('accountsPage.accountCardLabels.noData')
}

function assigneeLabel (account, keys) {
  return firstValue(account, keys) || t('accountsPage.accountCardLabels.notSet')
}

function proxyLabel (account) {
  const proxy = account?.proxy || account?.proxy_url || account?.proxyUrl
  const value = valueLabel(proxy)
  return value || t('accountsPage.accountCardLabels.notSet')
}

function accountStatusKind (account) {
  const status = String(account?.status || '').trim().toLowerCase()
  if (status === 'active' || status === 'online') return 'online'
  if (status === 'expired') return 'expired'
  if (status === 'inactive' || status === 'offline') return 'offline'
  if (status === 'error' || status === 'failed' || status === 'failure') return 'error'
  return 'unknown'
}

function isActive (account) {
  return accountStatusKind(account) === 'online'
}

function statusLabel (account) {
  const kind = accountStatusKind(account)
  if (kind === 'online') return t('accountsPage.accountCardLabels.statusLoggedIn')
  if (kind === 'expired') return t('accountsPage.accountCardLabels.statusExpired')
  if (kind === 'offline') return t('accountsPage.accountCardLabels.statusLoggedIn')
  if (kind === 'error') return t('accountsPage.accountCardLabels.statusError')
  return t('accountsPage.accountCardLabels.statusNoCheck')
}

function statusClass (account) {
  return accountStatusKind(account)
}

const LAST_CHECK_KEYS = ['last_login_check_at', 'lastLoginCheckAt', 'login_checked_at', 'loginCheckedAt', 'last_checked_at', 'lastCheckedAt', 'checked_at', 'checkedAt']
const CHECK_REASON_KEYS = ['login_check_error', 'loginCheckError', 'last_login_error', 'lastLoginError', 'status_reason', 'statusReason']

function loginCheckLabel (account) {
  for (const key of LAST_CHECK_KEYS) {
    const value = account?.[key]
    if (value === null || value === undefined || value === '') continue
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return t('accountsPage.accountCardLabels.lastCheck', { date: date.toLocaleString('zh-CN') })
  }
  for (const key of CHECK_REASON_KEYS) {
    const value = valueLabel(account?.[key])
    if (value) return t('accountsPage.accountCardLabels.checkAbnormal', { reason: value })
  }
  return t('accountsPage.accountCardLabels.statusNoCheck')
}

function formatDate (value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? t('accountsPage.accountCardLabels.unknownDate') : date.toLocaleDateString('zh-CN')
}

function isIconUrl (value) {
  return typeof value === 'string' && (value.startsWith('/') || value.startsWith('data:') || value.startsWith('http'))
}
</script>

<style scoped>
.account-card {
  position: relative;
  min-width: 0;
  min-height: 252px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--border-light, #e8e8ec);
  border-radius: 8px;
  background: var(--canvas, #fff);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.account-card:hover {
  border-color: #d8d6ef;
  box-shadow: 0 5px 18px rgba(40, 40, 55, 0.07);
}

.account-card.is-selected {
  border-color: var(--primary, #5048e5);
  box-shadow: 0 0 0 2px rgba(80, 72, 229, 0.1);
}

.account-card.is-default::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
  background: var(--primary, #5048e5);
  content: '';
}

.account-card-header {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 12px;
}

.select-account {
  display: grid;
  place-items: center;
}

.select-account input {
  width: 15px;
  height: 15px;
  accent-color: var(--primary, #5048e5);
}

.platform-chip {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--text-muted, #707080);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.platform-icon {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  flex: 0 0 24px;
  border-radius: 6px;
  background: #f1f0ff;
  color: var(--primary, #5048e5);
  font-size: var(--font-size-xs);
  font-weight: 700;
}
.platform-icon-img {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  border-radius: 4px;
  object-fit: contain;
}

.favorite-button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  margin-left: auto;
  border: 0;
  background: transparent;
  color: #a4a4ad;
  cursor: pointer;
}

.favorite-button.active { color: #d99a43; }
.favorite-button svg { width: 16px; height: 16px; }

.account-profile {
  min-width: 0;
  display: flex;
  align-items: center;
  flex: 1;
  flex-direction: column;
  padding: 8px 18px 18px;
  text-align: center;
}

.account-avatar {
  width: 62px;
  height: 62px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid #e5e5ea;
  border-radius: 50%;
  background: #f1f2f5;
  color: #81838d;
}

.account-avatar img { width: 100%; height: 100%; object-fit: cover; }
.account-avatar svg { width: 27px; height: 27px; }

.login-badge {
  margin-top: -4px;
  border: 2px solid #fff;
  border-radius: 4px;
  padding: 2px 7px;
  font-size: var(--font-size-xs);
  line-height: 16px;
}

.login-badge.online { background: #e7f7ef; color: #18794e; }
.login-badge.offline { background: #f2f2f4; color: #777985; }
.login-badge.expired { background: #fff1f0; color: #b42318; }
.login-badge.error { background: #fff1f0; color: #b42318; }
.login-badge.unknown { background: #f7f7f8; color: #777985; }

.account-identity {
  width: 100%;
  min-width: 0;
  margin-top: 8px;
}

.account-name-button,
.account-name-input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 6px;
  background: transparent;
  color: var(--text-primary, #25252b);
  font-size: var(--font-size-base);
  font-weight: 600;
  outline: none;
  text-align: center;
}

.account-name-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  cursor: text;
}
.account-name-button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account-name-button svg { width: 13px; height: 13px; flex: 0 0 13px; color: #a4a4ad; opacity: 0; }
.account-name-button:hover { background: #f7f7f9; }
.account-name-button:hover svg { opacity: 1; }
.account-name-input:hover { background: #f7f7f9; }
.account-name-input:focus { border-color: var(--primary, #5048e5); background: var(--color-bg-card); }

.account-details {
  min-height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
  color: var(--text-muted, #85858f);
  font-size: var(--font-size-xs);
}

.account-followers {
  margin-top: 2px;
  color: var(--text-muted, #85858f);
  font-size: var(--font-size-xs);
}

.account-assignees {
  width: min(100%, 220px);
  display: grid;
  gap: 6px;
  margin-top: 12px;
  text-align: left;
}

.account-assignees > div {
  min-width: 0;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  color: var(--text-muted, #85858f);
  font-size: var(--font-size-xs);
}

.account-assignees > div > span {
  padding: 2px 5px;
  border-radius: 4px;
  text-align: center;
}

/* 参考产品契约：负责人蓝 / 运营人灰 / 代理紫 */
.account-assignees .assignee-owner { background: #e8f1ff; color: #2b6cb0; }
.account-assignees .assignee-publisher { background: #f5f5f7; color: #85858f; }
.account-assignees .assignee-proxy { background: #eeecff; color: var(--primary, #5048e5); }

.account-assignees strong {
  overflow: hidden;
  color: #686a73;
  font-size: var(--font-size-xs);
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.default-label {
  border-radius: 4px;
  padding: 2px 6px;
  background: #eeecff;
  color: var(--primary, #5048e5);
}

.account-actions {
  min-height: 42px;
  display: flex;
  align-items: stretch;
  border-top: 1px solid var(--border-light, #efeff2);
}

.account-actions button {
  min-width: 0;
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  gap: 4px;
  border: 0;
  border-right: 1px solid var(--border-light, #efeff2);
  padding: 5px 6px;
  background: transparent;
  color: #555761;
  font-size: var(--font-size-xs);
  cursor: pointer;
}

.account-actions button:last-child { border-right: 0; }
.account-actions button:hover { background: #f7f6ff; color: var(--primary, #5048e5); }
.account-actions button.danger { color: #c43d4d; }
.account-actions button.danger:hover { background: #fff0f2; }
.account-actions svg { width: 13px; height: 13px; }

.account-card:focus-visible,
.favorite-button:focus-visible,
.account-actions button:focus-visible,
.account-name-button:focus-visible,
.account-name-input:focus-visible,
.select-account input:focus-visible {
  outline: 2px solid var(--primary, #5048e5);
  outline-offset: 2px;
}

@media (max-width: 600px) {
  .account-card { min-height: 232px; }
  .account-actions { flex-wrap: wrap; }
  .account-actions button { flex-basis: 50%; border-bottom: 1px solid var(--border-light, #efeff2); }
}
</style>
