<template>
  <div class="account-module-tabs" role="tablist" :aria-label="t('accountsPage.moduleTabsAria')">
    <button
      v-for="(tab, index) in tabs"
      :id="`account-module-tab-${tab.key}`"
      :key="tab.key"
      type="button"
      role="tab"
      :class="['account-module-tab', { active: activeKey === tab.key }]"
      :aria-selected="activeKey === tab.key"
      :aria-controls="'account-results'"
      :tabindex="activeKey === tab.key ? 0 : -1"
      :data-testid="`account-module-tab-${tab.key}`"
      @click="select(tab.key)"
      @keydown="onKeydown($event, index)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<script setup>
/**
 * AccountModuleTabs — 账号域页内模块导航
 *
 * PRD-UI-FLOW-CLARITY S1a/S1b：此前该导航由全局外壳层 `MpModuleNav` 承担，
 * 而 `Accounts.vue` 全文件没有任何改写 `?tab=` 的控件 —— 删掉外壳层后
 * 除「账号管理」外的 tab 会完全不可达。本组件把导航能力搬进页面。
 *
 * 独立成组件的第二个原因：`Accounts.vue` 是 `check-max-lines` 的**点名还账文件**
 * （targets 1578 行、零增长容差），把模板 + 键盘导航 + 样式放进来才不撑破它。
 *
 * 「分享链接」tab 按 PRD §14 裁决 #4 下线（零能力占位），故只有 3 个 tab。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  /** 当前激活的模块 key（由父组件从 route.query.tab 归一化后传入） */
  activeKey: { type: String, default: 'accounts' },
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const TABS = computed(() => [
  { key: 'accounts', label: t('accountsPage.tabAccounts') },
  { key: 'groups', label: t('accountsPage.tabGroups') },
  { key: 'favorites', label: t('accountsPage.tabFavorites') },
])
const tabs = TABS

function select (key) {
  if (!tabs.value.some(tab => tab.key === key)) return
  if (props.activeKey === key) return
  const query = { ...route.query }
  // 'accounts' 是默认值 ⇒ 落成「无 tab 参数」，保持 URL 干净且与旧深链兼容
  if (key === 'accounts') delete query.tab
  else query.tab = key
  router.push({ path: '/accounts', query })
}

/**
 * 键盘导航按 tab 数量取模，任意 N 均正确。
 * ⚠️ 不可照抄 PublishHistory 的 onTabKeydown：那个是 2-tab 硬编码
 * （`Home?0 : End?1 : index===0?1:0`），3 个 tab 复用会跳错。
 */
function onKeydown (event, index) {
  const total = tabs.value.length
  if (!total) return
  let nextIndex = null
  if (event.key === 'ArrowRight') nextIndex = (index + 1) % total
  else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + total) % total
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = total - 1
  if (nextIndex === null) return
  event.preventDefault()
  const next = tabs.value[nextIndex]
  if (!next) return
  select(next.key)
  const container = event.currentTarget?.parentElement
  const targetEl = container?.querySelector?.(`#account-module-tab-${next.key}`)
  if (targetEl && typeof targetEl.focus === 'function') targetEl.focus()
}
</script>

<style scoped>
/* 层级高于下方 .filter-tabs（状态筛选）。
   PRD §6.2：窄屏（≤900px）复用横滚方案，禁止等分压缩导致中文 tab 文案被截断。 */
.account-module-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 24px 0;
  border-bottom: 1px solid #e8e8ec;
  margin-bottom: 12px;
}
.account-module-tab {
  min-height: 34px;
  padding: 6px 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #6f7079;
  font-size: var(--font-size-sm);
  white-space: nowrap;
  cursor: pointer;
}
.account-module-tab.active {
  border-bottom-color: #5048e5;
  color: #5048e5;
  font-weight: 500;
}
.account-module-tab:focus-visible { outline: 2px solid #5048e5; outline-offset: -2px; }
@media (max-width: 900px) {
  .account-module-tabs { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  .account-module-tabs::-webkit-scrollbar { display: none; }
  .account-module-tab { flex: 0 0 auto; }
}
</style>
