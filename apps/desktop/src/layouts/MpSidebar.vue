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
import { invokePageManager } from '@/api/electron-bridge'
import { opsCenterSyncAppMenu } from '@/api/ops-center-sync'
import { useAppVersion } from '@/composables/useAppVersion'
import brandLogoUrl from '@/assets/brand/tom-fish-logo.png'

const route = useRoute()
const router = useRouter()
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

/** 「更多」组是否存在当前路由命中项（触发器常驻高亮依据，2026-09-21 选中态修复） */
const hasActiveMoreItem = computed(() => moreItems.value.some((item) => isActive(item)))

// 路由变化时若落在「更多」组 → 自动展开菜单，让选中项可见。
// 用 watch 而非仅 onMounted：真实应用初始路由是异步解析的，
// 硬刷新深链时 onMounted 早于 route.path 就绪，需路由解析后再展开（2026-09-21）。
watch(() => route.path, () => {
  if (hasActiveMoreItem.value) moreOpen.value = true
})

// ── 左侧导航栏宽度同步到主进程（避免 WebContentsView 遮挡侧边栏）──
let _sidebarObserver = null
onMounted(() => {
  // 深链/刷新落在「更多」组路由时自动展开菜单，让选中项可见（选中态修复配套）
  if (hasActiveMoreItem.value) moreOpen.value = true
  // 版本号是装饰性信息：失败/不可用时静默留空，不阻塞侧边栏渲染
  loadVersion()
  // 运营中心「应用菜单」配置：异步拉取；失败/未下发时保持默认菜单，不阻塞首屏
  loadAppMenu()
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
})

function isActive (item) {
  if (item.key === 'home') return route.path === '/'
  return route.path === item.to || route.path.startsWith(`${item.to}/`)
}

function goToPublish () {
  router.push('/publish')
}
</script>

<!-- 样式统一在 src/styles/sidebar.css（token 化，暗色可覆盖）；
     硬编码色 → token 映射表见该文件头部注释 -->
<style src="@/styles/sidebar.css"></style>
