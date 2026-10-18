<template>
  <section class="target-selector" data-testid="publish-target-selector" aria-label="发布目标">
    <!-- 搜索行（publish-target-select-all，2026-10-17）：全选/清空按钮**塞进搜索行**而不是
         单开一行。理由不是排版偏好，是像素门禁：搜索行下方的一切（平台分组、账号清单、
         保存草稿/一键发布等主操作）都是纵向排布的，新增一行会把它们整体下移 —— 实测
         workflows 套件按 1% 阈值判红（publish-form 1.778%，6 条 publish 用例全红），
         且 diff 图显示红线覆盖整个右栏下半部。塞进同一行后，下方不动，只有本行内部变化。
         行内布局：搜索框 flex:1 + [全选][清空]（canSelectAll=false 时两个按钮都不渲染，
         行内就只剩搜索框本人 —— 与改前的 `[input, div]` 形态逐节点等价）。
         契约见 01-docs/PRD-PUBLISH-TARGET-SELECT-ALL-2026-10-17.md §六。 -->
    <div class="target-selector__search-row">
      <input v-model="search" class="target-selector__search" type="search" aria-label="搜索发布平台或账号" placeholder="搜索平台或账号" />
      <div
        v-if="canSelectAll"
        class="target-selector__bulk"
        data-testid="target-bulk-toolbar"
        role="group"
        :aria-label="bulkGroupAriaLabel"
      >
        <button
          type="button"
          class="target-selector__bulk-btn"
          data-testid="target-select-all"
          :disabled="disabled"
          :aria-label="selectAllAriaLabel"
          @click="$emit('select-all')"
        >{{ selectAllLabel }}</button>
        <button
          type="button"
          class="target-selector__bulk-btn"
          data-testid="target-clear-all"
          :disabled="disabled || selectedPlatforms.length === 0"
          @click="$emit('clear-all')"
        >{{ clearAllLabel }}</button>
      </div>
    </div>
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
   *  由上层算好再传：本组件保持哑组件，不碰 accountStore，也不自己判 groupsStatus。
   *  每项可带 `selected`（该组当前已选中成员数）供 tooltip 做点击前预告。 */
  accountGroups: { type: Array, default: () => [] },
  /** 全选/清空行的渲染开关与可发布平台数（publish-target-select-all）。
   *  由上层（usePublishTargetBulkTargets）算好再传：可发布 = 该平台当前至少有一个
   *  可勾选账号（经 getAvailableAccountIds → isAccountActive）。一个都选不了时
   *  整行不渲染——既不给死控件，也保持 CI 空 profile 下的视觉中性。 */
  canSelectAll: { type: Boolean, default: false },
  publishableCount: { type: Number, default: 0 },
  selectAllAriaLabel: { type: String, default: '' },
})

defineEmits(['toggle-platform', 'toggle-account', 'apply-group', 'add-account', 'refresh-accounts', 'select-all', 'clear-all'])

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

// 全选/清空文案（publish-target-select-all，2026-10-17；契约见 PRD §八）。
// 一律走 locale：渲染层非 locales 文件不得新增中文字符串字面量（CI Gate 7 --cjk）。
const selectAllLabel = computed(() => i18n.global.t('publishPage.targetBulk.selectAll'))
const clearAllLabel = computed(() => i18n.global.t('publishPage.targetBulk.clearAll'))
const bulkGroupAriaLabel = computed(() => i18n.global.t('publishPage.targetBulk.groupAria'))
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
/* 搜索行：搜索框 + 全选/清空同一行。行高由搜索框决定（padding 8px/字号 sm），
   两个 chip 按钮刻意做小（font-size-xs + padding 3px），保证它们**不撑高本行** ——
   一旦撑高，下方整栏仍会下移，等于把"塞进同一行"换来的一次性收益又还回去。 */
.target-selector__search-row { display: flex; align-items: center; gap: 6px; }
.target-selector__search { flex: 1 1 auto; min-width: 0; box-sizing: border-box; border: 1px solid var(--border-light, #e0e0e0); border-radius: 6px; padding: 8px 10px; color: var(--text-primary, #202124); background: var(--surface, #fff); font-size: var(--font-size-sm); }
.target-selector__search:focus { outline: 2px solid color-mix(in srgb, var(--action-blue, #1890ff) 25%, transparent); border-color: var(--action-blue, #1890ff); }
/* 全选/清空（publish-target-select-all）：小号文字按钮（非实心大按钮）——
   它活在搜索行里，不能抢「一键发布」主行动的焦点。 */
.target-selector__bulk { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
.target-selector__bulk-btn { padding: 1px 8px; border: 1px solid var(--border-light, #e0e0e0); border-radius: 999px; background: var(--surface, #fff); color: var(--action-blue, #1890ff); font-size: var(--font-size-xs); line-height: 1.6; white-space: nowrap; cursor: pointer; }
.target-selector__bulk-btn:hover:not(:disabled) { border-color: var(--action-blue, #1890ff); }
.target-selector__bulk-btn:disabled { cursor: not-allowed; opacity: .6; }
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
