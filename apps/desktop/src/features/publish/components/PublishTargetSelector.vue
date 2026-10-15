<template>
  <section class="target-selector" data-testid="publish-target-selector" aria-label="发布目标">
    <input v-model="search" class="target-selector__search" type="search" aria-label="搜索发布平台或账号" placeholder="搜索平台或账号" />
    <PublishGroupPicker
      :items="accountGroups"
      :disabled="disabled"
      @apply-group="(groupId) => $emit('apply-group', groupId)"
    />
    <div class="target-selector__list" role="list" aria-label="可选发布平台">
      <div v-if="filteredGroups.length === 0" class="target-selector__empty">没有匹配的平台</div>
      <div v-for="group in filteredGroups" :key="group.label" class="target-group">
        <h3 class="target-group__label">{{ group.label }}</h3>
        <div v-for="platform in group.items" :key="platform.id" class="target-platform">
          <label class="target-platform__row">
            <input
              :data-testid="'platform-' + platform.id"
              type="checkbox"
              :checked="selectedPlatforms.includes(platform.id)"
              :disabled="platform.disabled || disabled"
              @change="$emit('toggle-platform', platform.id)"
            />
            <span>{{ platform.label }}</span>
            <span
              v-if="isPlatformRiskSuspended(platform.id)"
              class="target-account__risk"
              :data-testid="'target-platform-risk-flag-' + platform.id"
              :title="riskGuidanceText"
              role="status"
            >{{ riskBadgeText }}</span>
          </label>

          <div v-if="selectedPlatforms.includes(platform.id)" class="target-accounts">
            <template v-if="platform.accounts && platform.accounts.length > 0">
              <label
                v-for="account in platform.accounts"
                :key="account.id"
                class="target-account"
                :class="{ 'is-disabled': account.disabled }"
              >
                <input
                  :data-testid="'account-' + platform.id + '-' + account.id"
                  type="checkbox"
                  :checked="isAccountSelected(platform.id, account.id)"
                  :disabled="disabled || account.disabled"
                  @change="$emit('toggle-account', platform.id, account.id)"
                />
                <span data-testid="account-display-name">{{ accountDisplayName(account, platform.label) }}</span>
                <span v-if="account.is_default" class="target-account__default">默认</span>
                <span
                  v-if="account.disabled"
                  class="target-account__disabled"
                  data-testid="target-account-disabled-flag"
                  role="status"
                >{{ disabledFlagText }}</span>
                <span
                  v-if="isAccountRiskSuspended(platform.id, account.id)"
                  class="target-account__risk"
                  :data-testid="'target-account-risk-flag-' + platform.id + '-' + account.id"
                  :title="riskGuidanceText"
                  role="status"
                >{{ riskBadgeText }}</span>
              </label>
            </template>
            <template v-else>
              <div class="target-accounts__empty-row">
                <span class="target-accounts__empty">请先添加账号</span>
                <!-- 空态出口（publish-add-account-entry，2026-10-15）：不跳去账号页，
                     直接打开该平台登录页的新标签。契约见 PRD §二.2。 -->
                <button
                  type="button"
                  class="target-accounts__add"
                  :data-testid="'add-account-' + platform.id"
                  :disabled="disabled"
                  :aria-label="addAccountAriaLabel(platform.label)"
                  @click="$emit('add-account', platform.id)"
                >{{ addAccountLabel }}</button>
              </div>
              <!-- 回补入口：用户在新标签登录并「保存账号」后，切回本页点它重拉账号列表。
                   单独一行是与「添加」的主次之分（PRD §二.1）。 -->
              <button
                type="button"
                class="target-accounts__refresh"
                :data-testid="'refresh-accounts-' + platform.id"
                :disabled="disabled || refreshingAccounts"
                :aria-busy="refreshingAccounts ? 'true' : null"
                @click="$emit('refresh-accounts', platform.id)"
              >{{ refreshingAccounts ? refreshingLabel : refreshLabel }}</button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import i18n from '@/i18n'
import PublishGroupPicker from './PublishGroupPicker.vue'
import { resolveAccountDisplayName } from '@/utils/account-display-name'

// 显示名一律走账号卡片同一入口（name_source=manual 原样显示、auto 过噪声守卫、
// 都不合格才回落平台名）。此前这里只读 `account.name`，而 auth-view-manager 写进
// `name` 的就是 document.title，于是发布页选择器显示的是「首页 - 知乎」这类网页标题。
const unnamedAccountText = computed(() => i18n.global.t('accountsPage.accountCardLabels.unnamedAccount'))
function accountDisplayName (account, platformLabel) {
  return resolveAccountDisplayName(account, { platformLabel }) || account.id?.slice(0, 8) || unnamedAccountText.value
}

const props = defineProps({
  groups: { type: Array, default: () => [] },
  selectedPlatforms: { type: Array, default: () => [] },
  selectedAccounts: { type: Object, default: () => ({}) },
  disabled: { type: Boolean, default: false },
  /** 账号列表重拉中（publish-add-account-entry）：禁用刷新链接防重复点击，
   *  文案切「刷新中...」。由上层（Publish.vue → usePublishAddAccount.refreshing）提供。 */
  refreshingAccounts: { type: Boolean, default: false },
  /** 风控挂起清单（P0-2 发布页可见性）：[{platform, accountId}]，accountId 为 null 表示平台级挂起。
   *  数据源是 useRiskStore（Publish.vue 注入），组件保持哑组件不直接耦合 store。 */
  riskSuspended: { type: Array, default: () => [] },
  /** 「按组添加」的可操作分组（`buildGroupPickerItems` 的产物，空数组即整块不渲染）。
   *  由上层算好再传：本组件保持哑组件，不碰 accountStore，也不自己判 groupsStatus。 */
  accountGroups: { type: Array, default: () => [] },
})

defineEmits(['toggle-platform', 'toggle-account', 'apply-group', 'add-account', 'refresh-accounts'])

const search = ref('')
const filteredGroups = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return props.groups
  return props.groups
    .map(group => ({
      ...group,
      items: (group.items || []).filter(platform => {
        const platformMatch = (platform.id + ' ' + platform.label).toLowerCase().includes(keyword)
        const accountMatch = (platform.accounts || []).some(account => {
          return (account.id + ' ' + accountDisplayName(account, platform.label)).toLowerCase().includes(keyword)
        })
        return platformMatch || accountMatch
      }),
    }))
    .filter(group => group.items.length > 0)
})

const disabledFlagText = computed(() => i18n.global.t('accountsPage.accountCardLabels.disabledFlag'))

// 空态出口文案（publish-add-account-entry，2026-10-15；契约见 PRD §七）。
const addAccountLabel = computed(() => i18n.global.t('publishPage.addAccount.label'))
const refreshLabel = computed(() => i18n.global.t('publishPage.addAccount.refreshLabel'))
const refreshingLabel = computed(() => i18n.global.t('publishPage.addAccount.refreshing'))
function addAccountAriaLabel (platformLabel) {
  return i18n.global.t('publishPage.addAccount.ariaLabel', { platform: platformLabel })
}

// P0-2 风控挂起可见性：挂起清单判账号级/平台级命中（与 risk-suspender-store 键语义一致——
// 平台级（accountId==null）命中该平台所有账号；账号级仅命中对应账号）。
const riskBadgeText = computed(() => i18n.global.t('publish.riskHold.badge'))
const riskGuidanceText = computed(() => i18n.global.t('publish.riskHold.guidance'))

function isAccountRiskSuspended (platformId, accountId) {
  return (props.riskSuspended || []).some(entry => {
    if (!entry || entry.platform !== platformId) return false
    // 平台级挂起（accountId==null）覆盖该平台全部账号
    if (entry.accountId == null) return true
    return entry.accountId === accountId
  })
}

function isPlatformRiskSuspended (platformId) {
  return (props.riskSuspended || []).some(entry =>
    entry && entry.platform === platformId && entry.accountId == null)
}

function isAccountSelected (platformId, accountId) {
  const value = props.selectedAccounts?.[platformId]
  return Array.isArray(value) ? value.includes(accountId) : value === accountId
}
</script>

<style scoped>
.target-selector { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.target-selector__search { width: 100%; box-sizing: border-box; border: 1px solid var(--border-light, #e0e0e0); border-radius: 6px; padding: 8px 10px; color: var(--text-primary, #202124); background: var(--surface, #fff); font-size: var(--font-size-sm); }
.target-selector__search:focus { outline: 2px solid color-mix(in srgb, var(--action-blue, #1890ff) 25%, transparent); border-color: var(--action-blue, #1890ff); }
.target-selector__list { min-height: 0; max-height: clamp(220px, 38vh, 430px); overflow-y: auto; padding-right: 4px; scrollbar-gutter: stable; }
.target-selector__empty, .target-accounts__empty { color: var(--muted, #8a8f98); font-size: var(--font-size-xs); }
/* 空态出口（publish-add-account-entry）：提示文字与「添加」同一行，刷新链接单独一行。
   按钮刻意用小号文字按钮（非实心大按钮）——它活在平台列表里，不能抢已选平台的焦点。 */
.target-accounts__empty-row { display: inline-flex; align-items: center; gap: 8px; }
.target-accounts__add { padding: 1px 8px; border: 1px solid var(--border-light, #e0e0e0); border-radius: 4px; background: var(--surface, #fff); color: var(--action-blue, #1890ff); font-size: var(--font-size-xs); line-height: 1.6; cursor: pointer; }
.target-accounts__add:hover:not(:disabled) { border-color: var(--action-blue, #1890ff); }
.target-accounts__refresh { display: block; padding: 0; border: 0; background: none; color: var(--muted, #8a8f98); font-size: var(--font-size-xs); text-align: left; cursor: pointer; }
.target-accounts__refresh:hover:not(:disabled) { color: var(--action-blue, #1890ff); text-decoration: underline; }
.target-accounts__add:disabled, .target-accounts__refresh:disabled { cursor: not-allowed; opacity: .6; }
.target-group { display: grid; gap: 8px; }
.target-group__label { margin: 0; color: var(--muted, #73777d); font-size: var(--font-size-xs); font-weight: 600; }
.target-platform { display: grid; gap: 6px; }
.target-platform__row, .target-account { display: inline-flex; align-items: center; gap: 8px; min-height: 28px; cursor: pointer; font-size: var(--font-size-sm); color: var(--text-primary, #202124); }
.target-platform__row input, .target-account input { accent-color: var(--coral, #f56c6c); }
.target-accounts { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-left: 24px; padding-left: 10px; border-left: 2px solid var(--border-light, #eef0f2); }
.target-account { min-height: 24px; font-size: var(--font-size-xs); color: var(--muted, #5f6368); }
.target-account__default { color: var(--action-blue, #1890ff); font-size: var(--font-size-xs); }
.target-account.is-disabled { opacity: 0.6; cursor: not-allowed; }
.target-account__disabled { color: var(--muted, #8a8f98); font-size: var(--font-size-xs); }
.target-account__risk { color: var(--el-color-warning, #e6a23c); font-size: var(--font-size-xs); cursor: help; }
</style>
