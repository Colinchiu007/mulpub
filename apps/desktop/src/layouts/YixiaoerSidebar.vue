<template>
  <aside class="yixiaoer-sidebar" data-testid="yixiaoer-sidebar" aria-label="主导航">
    <header class="yixiaoer-sidebar-header">
      <ProfileMenu />
      <button class="yixiaoer-sidebar-add" type="button" aria-label="新建发布" title="新建发布" @click="goToPublish">
        <Plus />
      </button>
    </header>

    <nav class="yixiaoer-primary-nav" aria-label="蚁小二主导航">
      <router-link
        v-for="item in primaryItems"
        :key="item.key"
        :to="item.to"
        class="yixiaoer-primary-item"
        :class="{ active: isActive(item) }"
        :data-testid="`yixiaoer-primary-${item.key}`"
        :aria-current="isActive(item) ? 'page' : undefined"
      >
        <component :is="item.icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </router-link>

      <button
        class="yixiaoer-primary-item"
        type="button"
        data-testid="yixiaoer-primary-settings"
        aria-label="设置"
        title="设置"
        @click="emit('open-settings')"
      >
        <Setting aria-hidden="true" />
        <span>设置</span>
      </button>

      <button
        v-if="moreItems.length"
        class="yixiaoer-primary-item yixiaoer-more-trigger"
        :class="{ active: moreOpen }"
        type="button"
        aria-haspopup="true"
        :aria-expanded="moreOpen"
        data-testid="yixiaoer-primary-more"
        @click="moreOpen = !moreOpen"
      >
        <MoreFilled aria-hidden="true" />
        <span>更多</span>
        <ArrowDown :class="{ rotated: moreOpen }" aria-hidden="true" />
      </button>
      <div v-if="moreOpen && moreItems.length" class="yixiaoer-more-menu" role="menu">
        <router-link v-for="item in moreItems" :key="item.key" :to="item.to" role="menuitem" class="yixiaoer-more-item">
          <component :is="item.icon" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </router-link>
      </div>
    </nav>

    <footer class="yixiaoer-sidebar-footer">
      <div class="yixiaoer-sidebar-status-row">
        <span
          class="yixiaoer-sidebar-status"
          :class="'is-' + identityStatus"
          data-testid="yixiaoer-sidebar-status"
          :title="clientStatusTitle"
        >
          <i aria-hidden="true"></i>{{ clientStatusLabel }}
        </span>
      </div>
      <div class="yixiaoer-sidebar-footer-actions">
        <SidebarServiceStatus />
        <button v-if="!licenseStore.isPro" type="button" class="yixiaoer-upgrade-btn" data-testid="yixiaoer-upgrade" @click="showUpgradeModal = true">
          ⭐ 升级 Pro
        </button>
        <UpgradeModal v-if="showUpgradeModal" @close="showUpgradeModal = false" />
      </div>
    </footer>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowDown, MoreFilled, Plus, Setting } from '@element-plus/icons-vue'
import { SIDEBAR_MENU_DEFINITION } from '@/config/sidebar-menu'
import { resolveSidebarMenu } from '@/config/sidebar-menu-merge'
import { useLicenseStore } from '@/stores/license'
import { useIdentityStore } from '@/stores/identity'
import UpgradeModal from '@/components/UpgradeModal.vue'
import ProfileMenu from '@/components/ProfileMenu.vue'
import SidebarServiceStatus from '@/components/SidebarServiceStatus.vue'
import { invokePageManager } from '@/api/electron-bridge'
import { opsCenterSyncAppMenu } from '@/api/ops-center-sync'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const licenseStore = useLicenseStore()
const identityStore = useIdentityStore()
const moreOpen = ref(false)
const showUpgradeModal = ref(false)

const emit = defineEmits(['open-settings'])

// ── 左侧导航栏宽度同步到主进程（避免 WebContentsView 遮挡侧边栏）──
let _sidebarObserver = null
onMounted(() => {
  // 运营中心「应用菜单」配置：异步拉取；失败/未下发时保持默认菜单，不阻塞首屏
  loadAppMenu()
  const el = document.querySelector('.yixiaoer-sidebar')
  if (el) {
    const syncWidth = () => {
      const w = el.getBoundingClientRect().width
      if (w > 0) invokePageManager('setSidebarWidth', Math.round(w))
    }
    syncWidth()
    _sidebarObserver = new ResizeObserver(syncWidth)
    _sidebarObserver.observe(el)
  }
})
onUnmounted(() => {
  if (_sidebarObserver) {
    _sidebarObserver.disconnect()
    _sidebarObserver = null
  }
})

const identityStatus = computed(() => {
  const status = identityStore.status
  return ['authenticated', 'refreshing', 'offline_authenticated'].includes(status) ? 'online'
    : ['signing_in', 'signing_out'].includes(status) ? 'busy'
    : status === 'disabled' ? 'disabled'
    : ['signed_out', 'expired'].includes(status) ? 'offline'
    : 'error'
})

const clientStatusLabel = computed(() => {
  if (identityStatus.value === 'online') return t('memberCenter.statusConnected')
  if (identityStatus.value === 'busy') return identityStore.status === 'signing_in'
    ? t('memberCenter.statusSigningIn')
    : t('memberCenter.statusSigningOut')
  if (identityStatus.value === 'disabled') return t('memberCenter.identityDisabled')
  if (identityStatus.value === 'offline') return identityStore.status === 'expired'
    ? t('memberCenter.statusExpired')
    : t('memberCenter.notLoggedIn')
  return t('memberCenter.statusError')
})

const clientStatusTitle = computed(() => clientStatusLabel.value)

/**
 * 运营中心「应用菜单」下发的配置（显示/隐藏 + 组内排序）。
 * null 表示未下发 / 拉取失败 / 结构非法 —— resolveSidebarMenu 会 fail-open 回退本地默认菜单。
 */
const appMenuConfig = ref(null)

/**
 * 拉取运营中心下发的应用菜单配置（IPC：ops-center-sync:appMenu）。
 * 任何异常都降级为本地默认菜单（fail-open）——运营侧配置异常不能让用户失去导航能力。
 * 注：桌面端主进程在启动 3s 后自动同步一次；运营侧改配置后需重新同步或重启才生效（无推送）。
 */
async function loadAppMenu () {
  try {
    const res = await opsCenterSyncAppMenu()
    const data = res && res.code === 0 && res.data && typeof res.data === 'object' ? res.data : null
    appMenuConfig.value = data
  } catch {
    appMenuConfig.value = null
  }
}

const resolvedMenu = computed(() => resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, appMenuConfig.value))

/** 菜单文案：一律取 i18n（labelI18nKey）；key 缺失时退回菜单标识，避免渲染空白 */
function withLocalizedLabel (item) {
  return { ...item, label: item.labelI18nKey ? t(item.labelI18nKey) : (item.label || item.key) }
}

/** 一级导航可见项（运营配置排序 + 隐藏项已过滤） */
const primaryItems = computed(() =>
  resolvedMenu.value.primary.filter((item) => item.visible).map(withLocalizedLabel),
)

/** 「更多」折叠菜单可见项（同上） */
const moreItems = computed(() =>
  resolvedMenu.value.more.filter((item) => item.visible).map(withLocalizedLabel),
)

function isActive (item) {
  if (item.key === 'home') return route.path === '/'
  return route.path === item.to || route.path.startsWith(`${item.to}/`)
}

function goToPublish () {
  router.push('/publish')
}
</script>

<style scoped>
.yixiaoer-sidebar {
  width: var(--yixiaoer-sidebar-width, 200px);
  min-width: var(--yixiaoer-sidebar-width, 200px);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: linear-gradient(180deg, #f4f2ff 0%, #f0efff 100%);
  color: #7a7d99;
  border-right: 1px solid #e9e8f6;
}

.yixiaoer-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 14px 18px;
}

.yixiaoer-sidebar-add {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  border: 1px solid #bab9d3;
  border-radius: 50%;
  background: transparent;
  color: #777997;
  cursor: pointer;
}

.yixiaoer-sidebar-add svg {
  width: 14px;
  height: 14px;
}

.yixiaoer-sidebar-add:hover,
.yixiaoer-sidebar-add:focus-visible {
  border-color: #5149e8;
  color: #5149e8;
}

.yixiaoer-primary-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 10px;
}

.yixiaoer-primary-item {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border-radius: 8px;
  color: #777a96;
  font-size: 14px;
  text-decoration: none;
  transition: background .15s ease, color .15s ease;
}

.yixiaoer-primary-item svg {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
}

.yixiaoer-primary-item:hover,
.yixiaoer-primary-item:focus-visible {
  background: rgba(255, 255, 255, .65);
  color: #5149e8;
}

.yixiaoer-primary-item.active {
  background: rgba(255, 255, 255, .9);
  color: #5149e8;
  font-weight: 600;
  box-shadow: 0 2px 9px rgba(99, 91, 195, .08);
}

.yixiaoer-more-trigger {
  width: 100%;
  border: 0;
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.yixiaoer-more-trigger > svg:last-child {
  width: 13px;
  height: 13px;
  margin-left: auto;
  transition: transform .15s ease;
}

.yixiaoer-more-trigger > svg:last-child.rotated {
  transform: rotate(180deg);
}

.yixiaoer-more-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: -1px 0 2px 22px;
  padding: 4px 0 4px 12px;
  border-left: 1px solid #d9d7ed;
}

.yixiaoer-more-item {
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-radius: 6px;
  color: #8587a1;
  font-size: 12px;
  text-decoration: none;
}

.yixiaoer-more-item svg {
  width: 14px;
  height: 14px;
}

.yixiaoer-more-item:hover,
.yixiaoer-more-item:focus-visible {
  background: rgba(255, 255, 255, .68);
  color: #5149e8;
}

.yixiaoer-sidebar-footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  color: #9294ab;
  font-size: 11px;
}

.yixiaoer-sidebar-status-row {
  display: flex;
}

.yixiaoer-sidebar-footer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.yixiaoer-upgrade-btn {
  flex-shrink: 0;
  height: 26px;
  padding: 0 12px;
  border: 1px solid #d9c98a;
  border-radius: 13px;
  background: linear-gradient(180deg, #fff7e0, #ffeec2);
  color: #8a6d1f;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: filter .15s ease;
}

.yixiaoer-upgrade-btn:hover,
.yixiaoer-upgrade-btn:focus-visible {
  filter: brightness(.97);
  outline: 2px solid #5149e8;
  outline-offset: 2px;
}

.yixiaoer-sidebar-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.yixiaoer-sidebar-status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a7a8b5;
}

.yixiaoer-sidebar-status.is-online i {
  background: #6fbf73;
}

.yixiaoer-sidebar-status.is-online {
  color: #6f9c6f;
}

.yixiaoer-sidebar-status.is-busy i,
.yixiaoer-sidebar-status.is-error i {
  background: #e6a23c;
}

.yixiaoer-sidebar-status.is-busy,
.yixiaoer-sidebar-status.is-error {
  color: #b08a3e;
}

.yixiaoer-sidebar-settings {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid #c5c4d9;
  border-radius: 50%;
  background: transparent;
  color: #8587a1;
  cursor: pointer;
}

.yixiaoer-sidebar-settings svg {
  width: 12px;
  height: 12px;
}

.yixiaoer-primary-item:focus-visible,
.yixiaoer-more-item:focus-visible,
.yixiaoer-sidebar-add:focus-visible,
.yixiaoer-sidebar-settings:focus-visible {
  outline: 2px solid #5149e8;
  outline-offset: 2px;
}

@media (max-width: 900px) {
  .yixiaoer-sidebar {
    width: 68px;
    min-width: 68px;
  }

  .yixiaoer-sidebar-header {
    justify-content: center;
    padding-inline: 8px;
  }

  .yixiaoer-sidebar-add,
  .yixiaoer-primary-item span,
  .yixiaoer-primary-item > svg:last-child,
  .yixiaoer-more-menu,
  .yixiaoer-sidebar-footer {
    display: none;
  }

  .yixiaoer-primary-nav {
    padding-inline: 8px;
  }

  .yixiaoer-primary-item {
    justify-content: center;
    padding-inline: 0;
  }
}
</style>
