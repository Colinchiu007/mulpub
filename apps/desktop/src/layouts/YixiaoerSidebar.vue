<template>
  <aside class="yixiaoer-sidebar" data-testid="yixiaoer-sidebar" aria-label="主导航">
    <header class="yixiaoer-sidebar-header">
      <span class="yixiaoer-sidebar-brand" aria-hidden="true">MP</span>
      <strong class="yixiaoer-sidebar-title">Multi-Publish</strong>
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
      <div v-if="moreOpen" class="yixiaoer-more-menu" role="menu">
        <router-link v-for="item in moreItems" :key="item.key" :to="item.to" role="menuitem" class="yixiaoer-more-item">
          <component :is="item.icon" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </router-link>
      </div>
    </nav>

    <footer class="yixiaoer-sidebar-footer">
      <!-- 服务连接信息：位于底部登录 banner 上方 -->
      <div class="yixiaoer-sidebar-service">
        <SidebarServiceStatus />
      </div>
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  ArrowDown,
  Calendar,
  ChatDotRound,
  Collection,
  Cpu,
  DataAnalysis,
  FolderOpened,
  HomeFilled,
  MagicStick,
  Monitor,
  MoreFilled,
  Plus,
  Search,
  TrendCharts,
  User,
  VideoCamera,
} from '@element-plus/icons-vue'
import UpgradeModal from '@/components/UpgradeModal.vue'
import ProfileMenu from '@/components/ProfileMenu.vue'
import SidebarServiceStatus from '@/components/SidebarServiceStatus.vue'
import { invokePageManager } from '@/api/electron-bridge'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const moreOpen = ref(false)
const showUpgradeModal = ref(false)

const emit = defineEmits(['open-settings'])

// ── 左侧导航栏宽度同步到主进程（避免 WebContentsView 遮挡侧边栏）──
let _sidebarObserver = null
onMounted(() => {
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

const primaryItems = [
  { key: 'home', label: '主页', to: '/', icon: HomeFilled },
  { key: 'publish', label: '发布', to: '/publish/history', icon: VideoCamera },
  { key: 'accounts', label: '账号', to: '/accounts', icon: User },
  { key: 'dashboard', label: '数据', to: '/dashboard', icon: DataAnalysis },
  { key: 'create', label: '视频创作', to: '/create', icon: VideoCamera },
  { key: 'collection', label: '采集', to: '/collection', icon: Collection },
]

const moreItems = computed(() => [
  { key: 'monitor', label: '监控', to: '/monitor', icon: Monitor },
  { key: 'calendar', label: '发布日历', to: '/calendar', icon: Calendar },
  { key: 'comments', label: '私信评论', to: '/comments', icon: ChatDotRound },
  { key: 'cloud-publish', label: 'CLI', to: '/cloud-publish', icon: FolderOpened },
  { key: 'library', label: '素材库', to: '/library', icon: FolderOpened },
  { key: 'keywords', label: '关键词监控', to: '/keywords', icon: Search },
  { key: 'viral', label: '爆款分析', to: '/viral-analysis', icon: TrendCharts },
  { key: 'prompt-eval', label: '提示词评估', to: '/prompt-eval', icon: MagicStick },
  { key: 'rewrite', label: '文案改写', to: '/rewrite', icon: MagicStick },
  { key: 'hot-topics', label: t('hotTopics.menuLabel'), to: '/hot-topics', icon: TrendCharts },
  { key: 'model-providers', label: '模型提供商', to: '/model-providers', icon: Cpu },
  { key: 'knowledge-base', label: t('knowledgeBase.title'), to: '/knowledge-base', icon: Collection },
  { key: 'performance-insights', label: t('perfInsights.title'), to: '/performance-insights', icon: TrendCharts },
  { key: 'member-center', label: t('memberCenter.menuEntry'), to: '/member-center', icon: User },
])

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
  gap: 8px;
  padding: 16px 14px 14px;
}

.yixiaoer-sidebar-brand {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 7px;
  background: linear-gradient(140deg, #6c63ff, #4b43d6);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .4px;
}

.yixiaoer-sidebar-title {
  min-width: 0;
  overflow: hidden;
  color: #4d4f6f;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yixiaoer-sidebar-add {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  margin-left: auto;
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
  gap: 10px;
  padding: 12px 14px 14px;
  color: #9294ab;
  font-size: 11px;
}

.yixiaoer-sidebar-service {
  display: flex;
  padding: 0 2px;
}

.yixiaoer-primary-item:focus-visible,
.yixiaoer-more-item:focus-visible,
.yixiaoer-sidebar-add:focus-visible {
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
    padding-inline: 6px;
  }

  .yixiaoer-sidebar-brand,
  .yixiaoer-sidebar-title,
  .yixiaoer-sidebar-add,
  .yixiaoer-primary-item span,
  .yixiaoer-primary-item > svg:last-child,
  .yixiaoer-more-menu,
  .yixiaoer-sidebar-service {
    display: none;
  }

  .yixiaoer-sidebar-footer {
    padding-inline: 6px;
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
