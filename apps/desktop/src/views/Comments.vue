<template>
  <div style="height:100%;display:flex;flex-direction:column">
    <!-- 页面头部 -->
    <div class="cohere-page-header" style="flex-shrink:0">
      <div>
        <div class="page-title">评论管理</div>
        <div class="page-subtitle">统一查看和回复各平台评论</div>
      </div>
    </div>

    <div style="flex:1;display:flex;overflow:hidden">
      <!-- 左侧平台列表 -->
      <aside style="width:200px;flex-shrink:0;border-right:1px solid var(--border,var(--border));background:var(--canvas,var(--bg));overflow-y:auto">
        <div
          v-for="p in platforms"
          :key="p.id"
          class="comment-platform-item"
          :class="{ active: activePlatform === p.id }"
          @click="openPlatform(p)"
        >
          <div class="platform-icon">{{ p.icon }}</div>
          <div style="flex:1;min-width:0">
            <div class="platform-name">{{ p.name }}</div>
            <div class="platform-url" v-if="p.comment_url">有评论页</div>
            <div class="platform-url" v-else style="color:var(--muted)">暂不支持</div>
          </div>
        </div>
      </aside>

      <!-- 右侧评论区域 -->
      <div style="flex:1;position:relative;background:var(--border-light,var(--border-light));display:flex;align-items:center;justify-content:center">
        <EmptyState
          v-if="!activePlatform"
          data-testid="comments-select-empty"
          icon="💬"
          :title="t('comments.empty.selectPlatform.title')"
          :description="t('comments.empty.selectPlatform.message')"
        />
        <EmptyState
          v-else-if="!commentUrl"
          data-testid="comments-unsupported-empty"
          icon="📭"
          :title="t('comments.empty.unsupported.title')"
          :description="t('comments.empty.unsupported.message', { platform: platformName(activePlatform) })"
        />
        <!-- 评论页在顶部全局标签栏（page-manager 体系）打开并渲染，本页仅负责平台选择与引导提示 -->
        <EmptyState
          v-else
          data-testid="comments-opened-empty"
          icon="🧭"
          :title="platformName(activePlatform)"
          :description="t('comments.openedInTab')"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { platformList } from '@/api/publisher'
import { useTabStore } from '@/stores/tab'

const { t } = useI18n()
const tabStore = useTabStore()
const activePlatform = ref(null)
const platforms = ref([])
const commentUrl = ref('')
const currentTabId = ref(null)

const platformNameMap = {
  wechat_mp: '微信公众号', zhihu: '知乎', weibo: '微博', douyin: '抖音',
  xiaohongshu: '小红书', tencent_video: '视频号', kuaishou: '快手',
  toutiao: '今日头条', bilibili: 'Bilibili', youtube: 'YouTube',
  tiktok: 'TikTok', baijiahao: '百家号',
}

function platformName (id) { return platformNameMap[id] || id }

async function loadPlatforms () {
  try {
    const res = await platformList()
    if (res && res.code === 0) {
      platforms.value = (res.data || []).filter(p => p.comment_url)
    }
  // eslint-disable-next-line no-unused-vars
  } catch (e) { /* ignore */ }
}

async function openPlatform (p) {
  // 保持「一次一个评论标签」：切换平台时先关闭上一个标签页
  if (currentTabId.value) {
    await tabStore.closeTab(currentTabId.value)
    currentTabId.value = null
  }

  activePlatform.value = p.id
  commentUrl.value = p.comment_url || ''

  if (!p.comment_url) return

  // 在顶部全局标签栏打开评论页（page-manager 体系承载渲染，替代原分屏监控页内嵌视图）
  const tabId = await tabStore.createTab({
    url: p.comment_url,
    platform: p.id,
    title: t('comments.tabTitle', { platform: platformName(p.id) }),
  })
  if (tabId) {
    currentTabId.value = tabId
  }
}

onMounted(() => {
  loadPlatforms()
})
</script>

<style scoped>
.comment-platform-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-light, var(--border));
  transition: background 0.15s;
}
.comment-platform-item:hover { background: var(--soft-stone, var(--bg)); }
.comment-platform-item.active { background: var(--soft-stone, #f0f0f5); }
.comment-platform-item .platform-icon { font-size: var(--font-size-lg); }
.comment-platform-item .platform-name { font-size: var(--font-size-sm); font-weight: 500; }
.comment-platform-item .platform-url { font-size: var(--font-size-xs); color: var(--action-blue, #1890ff); }
</style>
