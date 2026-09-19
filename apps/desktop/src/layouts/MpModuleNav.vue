<template>
  <nav
    v-if="tabs.length > 0"
    class="mp-module-nav"
    data-testid="mp-module-nav"
    aria-label="工作区导航"
  >
    <div
      class="mp-module-tabs"
      role="tablist"
      :aria-label="module === 'accounts' ? '账号模块' : module === 'home' ? '主页' : '发布模块'"
    >
      <router-link
        v-for="tab in tabs"
        :key="tab.key"
        :to="tab.to"
        class="mp-module-tab"
        :class="{ active: isTabActive(tab) }"
        :data-testid="`mp-tab-${tab.key}`"
        :aria-current="isTabActive(tab) ? 'page' : undefined"
        :aria-selected="isTabActive(tab)"
        role="tab"
      >
        {{ tab.label }}
      </router-link>
    </div>
  </nav>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const accountTabs = [
  { key: 'accounts', label: '账号管理', to: '/accounts' },
  { key: 'groups', label: '分组管理', to: { path: '/accounts', query: { tab: 'groups' } } },
  { key: 'share', label: '分享链接', to: { path: '/accounts', query: { tab: 'share' } } },
  { key: 'favorites', label: '收藏分组', to: { path: '/accounts', query: { tab: 'favorites' } } },
]

// 发布域快捷标签行（新建发布/发布记录/草稿箱）已按产品要求整体移除，
// 发布域导航职责由左侧边栏承担：发布域路由下本组件不渲染任何标签。

const homeTabs = [
  { key: 'home', label: '主页', to: '/' },
]

const module = computed(() => {
  if (route.path === '/') return 'home'
  if (route.path.startsWith('/accounts')) return 'accounts'
  return 'publish'
})
const tabs = computed(() => {
  if (module.value === 'home') return homeTabs
  if (module.value === 'accounts') return accountTabs
  return []
})

function isTabActive (tab) {
  if (module.value === 'home') return route.path === '/'
  if (module.value === 'accounts') {
    if (tab.key === 'accounts') return route.path === '/accounts' && !route.query?.tab
    return route.path === '/accounts' && route.query?.tab === tab.key
  }

  return false
}
</script>

<style scoped>
.mp-module-nav {
  position: relative;
  min-height: var(--mp-nav-height, 70px);
  display: flex;
  align-items: stretch;
  padding: 0 24px;
  box-sizing: border-box;
  background: #fff;
  border-bottom: 1px solid var(--mp-nav-border, #e8eaf2);
  color: var(--mp-muted, #8b8e9a);
}

.mp-module-tabs {
  min-width: 0;
  display: flex;
  align-items: stretch;
  gap: 26px;
}

.mp-module-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: var(--mp-nav-height, 70px);
  padding: 0;
  border: 0;
  color: var(--mp-muted, #8b8e9a);
  font-size: 16px;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
}

.mp-module-tab:hover,
.mp-module-tab:focus-visible {
  color: var(--mp-primary, #5048e5);
}

.mp-module-tab:focus-visible {
  outline: 2px solid #5048e5;
  outline-offset: 3px;
}

.mp-module-tab.active {
  color: var(--mp-primary, #5048e5);
  font-weight: 600;
}

.mp-module-tab.active::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: var(--mp-primary, #5048e5);
  content: '';
}

@media (max-width: 700px) {
  .mp-module-nav {
    padding: 0 14px;
  }

  .mp-module-tabs {
    gap: 18px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .mp-module-tabs::-webkit-scrollbar {
    display: none;
  }

  .mp-module-tab {
    min-height: calc(var(--mp-nav-height, 70px) - 8px);
    font-size: 14px;
  }

  .mp-module-nav {
    min-height: calc(var(--mp-nav-height, 70px) - 8px);
  }
}
</style>
