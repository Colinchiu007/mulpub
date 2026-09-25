<template>
  <aside class="mp-sidebar" data-testid="mp-sidebar" aria-label="主导航">
    <!-- 左上角品牌区：汤姆鱼 Logo + 应用版本号（版本号来自主进程 app:get-version） -->
    <header class="mp-sidebar-header">
      <img
        class="mp-sidebar-logo"
        :src="brandLogoUrl"
        :alt="t('sidebar.brandLogoAlt')"
        data-testid="mp-sidebar-logo"
      />
      <span
        v-if="version"
        class="mp-sidebar-version"
        :title="t('sidebar.appVersionTitle')"
        data-testid="mp-sidebar-version"
      >v{{ version }}</span>
      <button class="mp-sidebar-add" type="button" aria-label="新建发布" title="新建发布" @click="goToPublish">
        <Plus />
      </button>
    </header>

    <nav class="mp-primary-nav" aria-label="主导航">
      <router-link
        v-for="item in primaryItems"
        :key="item.key"
        :to="item.to"
        class="mp-primary-item"
        :class="{ active: isActive(item) }"
        @click.prevent="onNavClick(item.to)"
        :data-testid="`mp-primary-${item.key}`"
        :aria-current="isActive(item) ? 'page' : undefined"
      >
        <component :is="item.icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </router-link>

      <!-- 「更多」触发器：运营中心把更多组全部隐藏时不渲染（避免空面板）；
           选中态：菜单展开 或 子路由命中时保持高亮（收起后仍能感知当前页在「更多」内） -->
      <button
        v-if="moreItems.length"
        class="mp-primary-item mp-more-trigger"
        :class="{ active: moreOpen || hasActiveMoreItem }"
        type="button"
        aria-haspopup="true"
        :aria-expanded="moreOpen"
        data-testid="mp-primary-more"
        @click="moreOpen = !moreOpen"
      >
        <MoreFilled aria-hidden="true" />
        <span>更多</span>
        <ArrowDown :class="{ rotated: moreOpen }" aria-hidden="true" />
      </button>
      <div v-if="moreOpen && moreItems.length" class="mp-more-menu" role="menu">
        <router-link
          v-for="item in moreItems"
          :key="item.key"
          :to="item.to"
          role="menuitem"
          class="mp-more-item"
          :class="{ active: isActive(item) }"
          @click.prevent="onNavClick(item.to)"
          :aria-current="isActive(item) ? 'page' : undefined"
          :data-testid="`mp-more-item-${item.key}`"
        >
          <component :is="item.icon" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </router-link>
      </div>
    </nav>

    <footer class="mp-sidebar-footer">
      <!-- 服务连接信息：位于底部登录 banner 上方 -->
      <div class="mp-sidebar-service">
        <SidebarServiceStatus />
      </div>
      <!-- 新版本提示：仅在检测到新版本时渲染，紧随登录菜单按钮上方；点击后退出应用并安装 -->
      <SidebarUpdateButton />
      <!-- 登录区 banner：收起时只显示这一条，点击向上展开菜单（账号操作 / 设置 / 升级 Pro） -->
      <ProfileMenu
        @open-settings="emit('open-settings')"
        @upgrade="showUpgradeModal = true"
      />
      <UpgradeModal v-if="showUpgradeModal" @close="showUpgradeModal = false" />
    </footer>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowDown, MoreFilled, Plus } from '@element-plus/icons-vue'
import { SIDEBAR_MENU_DEFINITION } from '@/config/sidebar-menu'
import { resolveSidebarMenu } from '@/config/sidebar-menu-merge'
import UpgradeModal from '@/components/UpgradeModal.vue'
import ProfileMenu from '@/components/ProfileMenu.vue'
import SidebarServiceStatus from '@/components/SidebarServiceStatus.vue'
import SidebarUpdateButton from '@/components/SidebarUpdateButton.vue'
import { invokePageManager, getApi } from '@/api/electron-bridge'
import { useTabStore } from '@/stores/tab'
import { opsCenterSyncAppMenu, onOpsCenterRuntimeUpdated } from '@/api/ops-center-sync'
import { useAppVersion } from '@/composables/useAppVersion'
import { suspendEmbeddedViewsForOverlay, releaseEmbeddedViewsForOverlay } from '@/composables/useEmbeddedViewSuspension'
import brandLogoUrl from '@/assets/brand/tom-fish-logo.png'

const route = useRoute()
const router = useRouter()
const tabStore = useTabStore()
const { t } = useI18n()
const moreOpen = ref(false)
const showUpgradeModal = ref(false)
// 左上角品牌区展示的应用版本号（非 Electron 环境取不到时保持为空，不渲染该节点）
const { version, loadVersion } = useAppVersion()

const emit = defineEmits(['open-settings'])

/**
 * 运营中心「应用菜单」下发的配置（显示/隐藏 + 组内排序）。
 * null 表示未下发 / 拉取失败 / 结构非法 —— resolveSidebarMenu 会 fail-open 回退本地默认菜单。
 */
const appMenuConfig = ref(null)

/**
 * 拉取运营中心下发的应用菜单配置（IPC：ops-center-sync:appMenu）。
 * 任何异常都降级为本地默认菜单（fail-open）——运营侧配置异常不能让用户失去导航能力。
 * 首帧在 onMounted 拉取；此后由主进程广播的 ops-center:runtime-updated 触发重拉，
 * 运营侧改配置无需重启应用即可生效。
 */
async function loadAppMenu () {
  try {
    const res = await opsCenterSyncAppMenu()
    const data = res && res.code === 0 && res.data && typeof res.data === 'object' ? res.data : null
    // 仅在取到有效配置时整体替换：重拉失败时保留上一份，避免已生效的运营配置被瞬时网络异常抹掉
    if (data) appMenuConfig.value = data
  } catch {
    /* 保留现有配置；首帧失败时 appMenuConfig 仍为 null，即本地默认菜单 */
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

/**
 * 侧边栏高亮依据的路径（方案 B：共享侧边栏跟随当前聚焦标签）：
 * - 聚焦内嵌主页实例（home-shell）时，用主进程回传的该实例真实 SPA 路由 activeTab.spaRoute；
 * - 否则（首页虚拟标签 / 普通网页标签）用主窗口 vue-router 当前路径 route.path。
 */
const navPath = computed(() => {
  if (tabStore.activeTabIsHomeShell) {
    const sr = tabStore.activeTab && tabStore.activeTab.spaRoute
    return (typeof sr === 'string' && sr) ? sr.split('?')[0] : '/'
  }
  return route.path
})

/**
 * 侧边栏导航点击：把「点了没反应」变为「当前标签可见跳转」。
 * - 聚焦内嵌主页实例（home-shell）→ 经 IPC 定向让该实例自身 router.push，主窗口隐藏路由保持不动；
 * - 聚焦普通网页标签 → 先切回首页标签再导航，让变化可见；
 * - 聚焦首页标签 → 维持原有主窗口路由跳转。
 */
async function onNavClick (to) {
  if (typeof to !== 'string' || !to) return
  if (tabStore.activeTabIsHomeShell) {
    const api = getApi()
    try {
      const res = api && api.pageManager && typeof api.pageManager.navigateActiveHomeShell === 'function'
        ? await api.pageManager.navigateActiveHomeShell(to)
        : null
      if (res && res.data && res.data.handled) return
    } catch (error) {
      console.warn('[sidebar] navigate home-shell failed', error)
    }
  }
  if (!tabStore.isHomeTab) {
    const homeTab = tabStore.tabs.find((tab) => tab.isHome)
    if (homeTab && tabStore.activeTabId !== homeTab.tabId) {
      try { await tabStore.switchToTab(homeTab.tabId) } catch (error) { console.warn('[sidebar] switch home failed', error) }
    }
  }
  try { await router.push(to) } catch (error) { console.warn('[sidebar] navigate failed', error) }
}

/** 「更多」组是否存在当前路由命中项（触发器常驻高亮依据，2026-09-21 选中态修复） */
const hasActiveMoreItem = computed(() => moreItems.value.some((item) => isActive(item)))

// 路由变化时若落在「更多」组 → 自动展开菜单，让选中项可见。
// 用 watch 而非仅 onMounted：真实应用初始路由是异步解析的，
// 硬刷新深链时 onMounted 早于 route.path 就绪，需路由解析后再展开（2026-09-21）。
watch(navPath, () => {
  if (hasActiveMoreItem.value) moreOpen.value = true
})

// 弹窗互斥（2026-09-23 Bug 修复）：升级弹窗是渲染层全屏遮罩浮层，浏览器标签
// （外部网页 WebContentsView）活动时会被原生图层整个压住；打开期间挂起内嵌视图。
watch(showUpgradeModal, (open) => {
  if (open) suspendEmbeddedViewsForOverlay('upgrade-modal')
  else releaseEmbeddedViewsForOverlay('upgrade-modal')
})

// ── 左侧导航栏宽度同步到主进程（避免 WebContentsView 遮挡侧边栏）──
let _sidebarObserver = null
let _unsubscribeRuntimeUpdated = null
onMounted(() => {
  // 深链/刷新落在「更多」组路由时自动展开菜单，让选中项可见（选中态修复配套）
  if (hasActiveMoreItem.value) moreOpen.value = true
  // 版本号是装饰性信息：失败/不可用时静默留空，不阻塞侧边栏渲染
  loadVersion()
  // 运营中心「应用菜单」配置：异步拉取；失败/未下发时保持默认菜单，不阻塞首屏
  loadAppMenu()
  // 主进程每次应用运营配置后广播此事件 → 重拉菜单，免去「改完必须重启应用」
  _unsubscribeRuntimeUpdated = onOpsCenterRuntimeUpdated(() => { loadAppMenu() })
  const el = document.querySelector('.mp-sidebar')
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
  // 订阅必须成对释放：侧边栏会随窗口重建再次挂载，泄漏监听器会导致重复拉取
  if (_unsubscribeRuntimeUpdated) {
    try { _unsubscribeRuntimeUpdated() } catch { /* 释放失败不影响卸载 */ }
    _unsubscribeRuntimeUpdated = null
  }
})

function isActive (item) {
  const path = navPath.value
  if (item.key === 'home') return path === '/'
  return path === item.to || path.startsWith(item.to + '/')
}

function goToPublish () {
  onNavClick('/publish')
}
</script>

<!-- 样式统一在 src/styles/sidebar.css（token 化，暗色可覆盖）；
     硬编码色 → token 映射表见该文件头部注释 -->
<style src="@/styles/sidebar.css"></style>
