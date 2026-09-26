<template>
  <section class="target-selector" data-testid="publish-target-selector" aria-label="发布目标">
    <input v-model="search" class="target-selector__search" type="search" aria-label="搜索发布平台或账号" placeholder="搜索平台或账号" />
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
              </label>
            </template>
            <span v-else class="target-accounts__empty">请先添加账号</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import i18n from '@/i18n'
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
})

defineEmits(['toggle-platform', 'toggle-account'])

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
</style>
