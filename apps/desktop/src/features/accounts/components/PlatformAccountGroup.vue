<template>
  <section class="account-platform-group" :aria-labelledby="headingId">
    <header class="platform-group-header">
      <img v-if="isIconUrl(platformIcon)" :src="platformIcon" class="platform-mark-img" :alt="platformLabel" width="36" height="36" aria-hidden="true">
<div v-else class="platform-mark" aria-hidden="true">{{ platformIcon }}</div>
      <div class="platform-heading">
        <h2 :id="headingId">{{ platformLabel }}</h2>
        <div class="platform-summary" role="status" :aria-label="statusLabel">
          <span v-if="group.activeCount" class="summary-item is-active">{{ group.activeCount }} 个有效</span>
          <span v-if="group.inactiveCount" class="summary-item is-inactive">{{ group.inactiveCount }} 个离线</span>
          <span class="summary-total">共 {{ group.accounts.length }} 个账号</span>
        </div>
      </div>
      <button class="icon-button" type="button" title="添加此平台账号" aria-label="添加此平台账号" @click="$emit('add', group.platform)">
        <Plus />
      </button>
    </header>

    <div class="account-list">
      <article
        v-for="account in group.accounts"
        :key="account.id"
        class="account-row"
        :class="{ 'is-selected': selectedIds.has(account.id), 'is-default': account.is_default }"
      >
        <label class="select-account" :title="`选择 ${accountName(account)}`">
          <input
            :data-testid="`select-${account.id}`"
            type="checkbox"
            :checked="selectedIds.has(account.id)"
            @change="$emit('toggle-select', account.id)"
          >
        </label>

        <button
          class="favorite-button"
          :class="{ active: favoriteIds.has(account.id) }"
          type="button"
          :title="favoriteIds.has(account.id) ? '取消收藏' : '收藏账号'"
          :aria-label="favoriteIds.has(account.id) ? '取消收藏' : '收藏账号'"
          :data-testid="`favorite-${account.id}`"
          @click="$emit('toggle-favorite', account.id)"
        >
          <StarFilled v-if="favoriteIds.has(account.id)" />
          <Star v-else />
        </button>

        <div class="account-avatar">
          <img v-if="account.avatar || account.avatar_url" :src="account.avatar || account.avatar_url" alt="">
          <UserFilled v-else />
        </div>

        <div class="account-identity">
          <div class="account-name-line">
            <input
            class="account-name-input"
            :value="accountName(account)"
            :aria-label="`账号名称：${accountName(account)}`"
              spellcheck="false"
              @blur="$emit('rename', account, $event.target.value)"
              @keyup.enter="$event.target.blur()"
            >
            <span v-if="account.is_default" class="default-label">默认账号</span>
          </div>
          <div class="account-status">
            <span class="status-dot" :class="isActive(account) ? 'online' : 'offline'" aria-hidden="true"></span>
            <span class="account-status-text">{{ isActive(account) ? '登录有效' : '登录失效' }}</span>
            <span v-if="account.proxy?.configured" class="account-proxy-status" :title="proxyStatusLabel(account)">代理</span>
            <span v-if="account.created_at" class="account-date">{{ formatDate(account.created_at) }}</span>
          </div>
        </div>

        <div class="account-actions">
          <button v-if="!account.is_default" :data-testid="`set-default-${account.id}`" data-e2e-scan="manual" type="button" @click="$emit('set-default', account)">设为默认</button>
          <button :data-testid="`open-${account.id}`" data-e2e-scan="manual" type="button" @click="$emit('open', account)"><Link />打开</button>
          <button :data-testid="`check-${account.id}`" data-e2e-scan="manual" type="button" @click="$emit('check', account)"><CircleCheck />验证</button>
          <button :data-testid="`proxy-${account.id}`" data-e2e-scan="manual" type="button" title="配置账号代理" :aria-label="`配置 ${accountName(account)} 的代理`" @click="$emit('configure-proxy', account)"><Connection /></button>
          <button class="danger" :data-testid="`delete-${account.id}`" data-e2e-scan="manual" type="button" @click="$emit('remove', account)"><Delete />删除</button>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { CircleCheck, Connection, Delete, Link, Plus, Star, StarFilled, UserFilled } from '@element-plus/icons-vue'

const props = defineProps({
  group: { type: Object, required: true },
  platformLabel: { type: String, required: true },
  platformIcon: { type: String, default: '' },
  selectedIds: { type: Object, default: () => new Set() },
  favoriteIds: { type: Object, default: () => new Set() },
})

defineEmits([
  'add',
  'toggle-select',
  'toggle-favorite',
  'set-default',
  'rename',
  'open',
  'check',
  'configure-proxy',
  'remove',
])

const headingId = computed(() => `account-platform-${String(props.group.platform || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-')}`)
const statusLabel = computed(() => `${props.platformLabel}：${props.group.activeCount || 0} 个有效，${props.group.inactiveCount || 0} 个离线，共 ${props.group.accounts.length} 个账号`)

function accountName (account) {
  return account.account_name || account.name || '未命名账号'
}

function isActive (account) {
  return account.status === 'active' || account.status === 'online'
}

function proxyStatusLabel (account) {
  const proxy = account?.proxy
  if (proxy?.invalid) return '代理配置无效'
  const endpoint = `${proxy?.hostMasked || ''}${proxy?.port ? `:${proxy.port}` : ''}`
  return endpoint ? `已绑定 ${String(proxy?.type || 'http').toUpperCase()} 代理 ${endpoint}` : '已绑定代理'
}

function formatDate (value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN')
}

function isIconUrl (value) {
  return typeof value === 'string' && (value.startsWith('/') || value.startsWith('data:') || value.startsWith('http'))
}
</script>

<style scoped>
.account-platform-group {
  background: var(--canvas, #fff);
  border: 1px solid var(--border-light, #e8e8ec);
  border-radius: 8px;
  overflow: hidden;
}
.platform-group-header {
  min-height: 64px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-light, #ececf0);
}
.platform-mark {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  flex: 0 0 36px;
  border-radius: 8px;
  background: #f2f1ff;
  color: #5048e5;
  font-size: 17px;
  font-weight: 700;
}
.platform-mark-img {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  border-radius: 8px;
  object-fit: contain;
}
.platform-heading { min-width: 0; flex: 1; }
.platform-heading h2 { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; }
.platform-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 3px; font-size: 12px; }
.summary-item::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 5px; border-radius: 50%; }
.summary-item.is-active { color: #23875b; }
.summary-item.is-active::before { background: #2aa876; }
.summary-item.is-inactive { color: #a66a22; }
.summary-item.is-inactive::before { background: #d99a43; }
.summary-total { color: var(--muted, #85858f); }
.icon-button {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  background: #fff;
  color: #5048e5;
  cursor: pointer;
}
.icon-button svg { width: 16px; height: 16px; }
.account-list { display: flex; flex-direction: column; }
.account-row {
  min-height: 62px;
  display: grid;
  grid-template-columns: 20px 28px 38px minmax(180px, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-light, #efeff2);
}
.account-row:last-child { border-bottom: none; }
.account-row:hover { background: #fafafd; }
.account-row.is-selected { background: #f5f4ff; }
.account-row.is-default { box-shadow: inset 3px 0 #5048e5; }
.select-account { display: grid; place-items: center; }
.select-account input { width: 15px; height: 15px; accent-color: #5048e5; }
.favorite-button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: #a4a4ad;
  cursor: pointer;
}
.favorite-button.active { color: #d99a43; }
.favorite-button svg { width: 16px; height: 16px; }
.account-avatar {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: #f1f2f5;
  color: #81838d;
}
.account-avatar img { width: 100%; height: 100%; object-fit: cover; }
.account-avatar svg { width: 18px; height: 18px; }
.account-identity { min-width: 0; }
.account-name-line { min-width: 0; display: flex; align-items: center; gap: 8px; }
.account-name-input {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  padding: 3px 5px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-primary, #25252b);
  font-size: 13px;
  font-weight: 500;
  outline: none;
}
.account-name-input:hover { background: #f5f5f7; }
.account-name-input:focus { border-color: #7068eb; background: #fff; }
.default-label { flex: 0 1 auto; padding: 2px 6px; border-radius: 4px; background: #eeecff; color: #5048e5; font-size: 11px; line-height: 16px; text-align: center; white-space: normal; }
.account-status { min-width: 0; display: flex; align-items: center; gap: 5px; margin-top: 3px; color: var(--muted, #85858f); font-size: 12px; }
.account-status-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account-proxy-status { color: #356f9f; font-size: 11px; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; }
.status-dot.online { background: #2aa876; }
.status-dot.offline { background: #b9bac2; }
.account-date { margin-left: 6px; }
.account-actions { display: flex; align-items: center; justify-content: flex-end; gap: 2px; }
.account-actions button {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #5048e5;
  font-size: 12px;
  cursor: pointer;
}
.account-actions button:hover { background: #f0efff; }
.account-actions button.danger { color: #c43d4d; }
.account-actions button.danger:hover { background: #fff0f2; }
.account-actions svg { width: 14px; height: 14px; }
.icon-button:focus-visible,
.favorite-button:focus-visible,
.account-actions button:focus-visible,
.account-name-input:focus-visible,
.select-account input:focus-visible {
  outline: 2px solid #5048e5;
  outline-offset: 2px;
}
@media (max-width: 900px) {
  .account-row { grid-template-columns: 20px 28px 38px minmax(0, 1fr); align-items: start; }
  .account-identity { grid-column: 4; grid-row: 1; }
  .account-actions { grid-column: 4 / -1; grid-row: 2; justify-content: flex-start; flex-wrap: wrap; }
}
@media (max-width: 600px) {
  .account-row { gap: 8px; padding: 9px 10px; }
  .account-actions { grid-column: 2 / -1; }
}
</style>
