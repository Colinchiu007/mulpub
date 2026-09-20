<template>
  <div v-if="showNotification" class="fr-toast" :class="notificationType === 'success' ? 'fr-toast--success' : 'fr-toast--error'">{{ notificationMsg }}</div>
<div class="cohere-content fr-page">
    <div class="fr-wrap">
      <div class="cohere-card fr-card">

        <!-- Step 0: Welcome -->
        <div v-if="currentStep === 0" class="fr-step">
          <div class="fr-step-icon-lg">🚀</div>
          <h2 class="fr-step-title">欢迎使用社媒管家</h2>
          <p class="fr-step-desc">
            三步完成配置，即可开始多平台一键发布
          </p>
          <div class="fr-step-list">
            <div class="fr-step-item">
              <span class="fr-step-num">①</span>
              <div><strong>环境检测</strong><br><span class="fr-step-item-desc">自动安装 Python 依赖和 Playwright</span></div>
            </div>
            <div class="fr-step-item">
              <span class="fr-step-num">②</span>
              <div><strong>添加账号</strong><br><span class="fr-step-item-desc">登录你的社交媒体平台账号</span></div>
            </div>
            <div class="fr-step-item">
              <span class="fr-step-num">③</span>
              <div><strong>首次发布</strong><br><span class="fr-step-item-desc">写一篇文章发布到各平台</span></div>
            </div>
          </div>
          <button class="cohere-btn-primary" @click="currentStep = 1">开始配置 →</button>
        </div>

        <!-- Step 1: Dependencies -->
        <div v-else-if="currentStep === 1" class="fr-step">
          <div class="fr-step-icon">⚙️</div>
          <h2 class="fr-step-title-sm">环境检测</h2>
          <p class="fr-step-desc">自动安装依赖，可能需要几分钟</p>

          <div class="fr-dep-list">
            <div v-for="(step, idx) in depSteps" :key="idx"
              class="fr-dep-item"
              :class="'fr-dep-item--' + step.status"
            >
              <span class="fr-dep-icon">
                <span v-if="step.status === 'done'">✅</span>
                <span v-else-if="step.status === 'active'">⏳</span>
                <span v-else-if="step.status === 'error'">❌</span>
                <span v-else>⬜</span>
              </span>
              <div class="fr-dep-body">
                <div class="fr-dep-label">{{ step.label }}</div>
                <div v-if="step.message" class="fr-dep-msg">{{ step.message }}</div>
              </div>
            </div>
          </div>

          <div v-if="allDepsDone" class="fr-step-actions">
            <p class="fr-ready-text">✅ 环境就绪</p>
            <button class="cohere-btn-primary" @click="currentStep = 2">下一步：添加账号 →</button>
          </div>
          <div v-if="depError" class="fr-step-actions">
            <p class="fr-error-text">❌ 安装出错：{{ depErrorMessage }}</p>
            <button class="cohere-btn-secondary" @click="retryDeps">重试</button>
            <button class="cohere-btn-primary fr-btn-skip" @click="currentStep = 2">跳过</button>
          </div>
        </div>

        <!-- Step 2: Add Account -->
        <div v-else-if="currentStep === 2" class="fr-step">
          <div class="fr-step-icon">🔑</div>
          <h2 class="fr-step-title-sm">添加你的第一个账号</h2>
          <p class="fr-step-desc">
            选择平台后，在弹出的页面中完成登录
          </p>

          <div class="fr-platform-grid">
            <button v-for="p in quickPlatforms" :key="p.id"
              class="fr-platform-btn"
              :class="{ 'fr-platform-btn--adding': addingPlatform === p.id }"
              :disabled="addingPlatform === p.id"
              @click="addAccount(p.id)">
              <img v-if="p.iconUrl" :src="p.iconUrl" :alt="p.label" width="20" height="20" class="fr-platform-icon">
              <span v-else>{{ p.icon }}</span> {{ p.label }}
            </button>
          </div>

          <div class="fr-step-next">
            <button class="cohere-btn-secondary" @click="currentStep = 3">已添加账号，下一步 →</button>
          </div>
        </div>

        <!-- Step 3: Quick Publish Tutorial -->
        <div v-else-if="currentStep === 3" class="fr-step">
          <div class="fr-step-icon">✍️</div>
          <h2 class="fr-step-title-sm">准备完毕！</h2>
          <p class="fr-step-desc">
            现在你可以开始多平台发布
          </p>

          <div class="fr-step-list">
            <div class="fr-step-item">
              <span>📝</span>
              <div><strong>写文章</strong><br><span class="fr-step-item-desc">在发布页面编辑标题和正文</span></div>
            </div>
            <div class="fr-step-item">
              <span>🎯</span>
              <div><strong>选平台</strong><br><span class="fr-step-item-desc">勾选要发布的平台</span></div>
            </div>
            <div class="fr-step-item">
              <span>🚀</span>
              <div><strong>一键发布</strong><br><span class="fr-step-item-desc">后台自动分发到所有选中的平台</span></div>
            </div>
          </div>

          <div class="fr-final-actions">
            <button class="cohere-btn-secondary" @click="$router.push('/accounts')">管理账号</button>
            <button class="cohere-btn-primary" @click="$router.push('/publish')">开始发布 →</button>
          </div>
        </div>

        <!-- Step progress dots -->
        <div class="fr-dots">
          <div v-for="i in 4" :key="i" class="fr-dot" :class="{ 'fr-dot--active': currentStep >= i-1 }"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// eslint-disable-next-line no-unused-vars
import UiButton from "../components/UiButton.vue";
import { getApi } from '@/api/electron-bridge'
// eslint-disable-next-line no-unused-vars
import UiInput from "../components/UiInput.vue";
import { ref, onMounted, onBeforeUnmount } from 'vue'
// 简单通知
const notificationMsg = ref('')
const notificationType = ref('success')
const showNotification = ref(false)

// eslint-disable-next-line no-unused-vars
function notify(msg, type = 'success') {
  notificationMsg.value = msg
  notificationType.value = type
  showNotification.value = true
  setTimeout(() => { showNotification.value = false }, 3000)
}
import { onFirstRunStatus, firstRunCheck, authOpenLogin, accountAdd } from '@/api/publisher'
import { getPlatformIconUrl } from '@/composables/usePlatformIconUrl'

const currentStep = ref(0)
const addingPlatform = ref('')
const allDepsDone = ref(false)
const depError = ref(false)
const depErrorMessage = ref('')

const depSteps = ref([
  { label: 'Python 依赖', status: 'pending', message: '' },
  { label: 'Playwright 浏览器', status: 'pending', message: '' },
])

const quickPlatforms = [
  { id: 'wechat_mp', label: '微信公众号', icon: '💬', iconUrl: getPlatformIconUrl('wechat_mp') },
  { id: 'zhihu', label: '知乎', icon: '❓', iconUrl: getPlatformIconUrl('zhihu') },
  { id: 'weibo', label: '微博', icon: '✧', iconUrl: getPlatformIconUrl('weibo') },
  { id: 'douyin', label: '抖音', icon: '🎵', iconUrl: getPlatformIconUrl('douyin') },
  { id: 'xiaohongshu', label: '小红书', icon: '📕', iconUrl: getPlatformIconUrl('xiaohongshu') },
  { id: 'youtube', label: 'YouTube', icon: '▶', iconUrl: getPlatformIconUrl('youtube') },
]

let cancelListen = null

const stepIndex = { python: 0, playwright: 1 }

onMounted(async () => {
  const checkResult = await firstRunCheck()
  if (checkResult?.code === 0 && checkResult.data?.setupDone) {
    allDepsDone.value = true
    depSteps.value.forEach(s => { s.status = 'done' })
    currentStep.value = 1  // skip deps
  }
  cancelListen = onFirstRunStatus((payload) => {
    if (!payload) return
    if (payload.type === 'step' && stepIndex[payload.data?.step] !== undefined) {
      depSteps.value[stepIndex[payload.data.step]].status = 'active'
      depSteps.value[stepIndex[payload.data.step]].message = payload.data.message || ''
    } else if (payload.type === 'done') {
      depSteps.value.forEach(s => { s.status = 'done' })
      allDepsDone.value = true
    } else if (payload.type === 'error') {
      const idx = depSteps.value.findIndex(s => s.status === 'active')
      if (idx >= 0) {
        depSteps.value[idx].status = 'error'
        depSteps.value[idx].message = payload.data?.data || '未知错误'
      }
      depError.value = true
      depErrorMessage.value = payload.data?.data || '安装失败'
    }
  })
})

onBeforeUnmount(() => {
  if (cancelListen) cancelListen()
})

async function addAccount (platform) {
  addingPlatform.value = platform
  try {
    const api = getApi()
    if (api?.authOpenLogin) {
      const res = await authOpenLogin(platform)
      if (res?.cancelled) return
      if (res.code !== 0) window.alert(res.message || '添加失败')
      else window.alert('账号添加成功，继续添加或进入下一步')
    } else {
      const res = await accountAdd(platform)
      if (res.code !== 0) window.alert(res.message || '添加失败')
      else window.alert('请在弹出的浏览器窗口中完成登录')
    }
  } catch (e) { window.alert(e.message) }
  finally { addingPlatform.value = '' }
}

function retryDeps () {
  depError.value = false
  depSteps.value.forEach(s => { if (s.status === 'error') s.status = 'pending'; s.message = '' })
  // Re-trigger setup
  firstRunCheck()
}
</script>
<style scoped>
/* T1-3c：原 55 处内联样式全部类化；颜色一律 var(--color-*)（tokens.css 语义槽）。
 * 依赖步骤状态底色等价映射：teal-soft→--color-success-soft、pale-blue→--color-primary-light、
 * coral-soft→--color-danger-soft、soft-stone→--color-bg-inset（T1-1 转发等值）。 */
.fr-toast {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  padding: 12px 24px;
  border-radius: var(--r-sm);
  color: var(--color-on-primary);
  font-size: var(--font-size-base);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.fr-toast--success { background: var(--color-success); }
.fr-toast--error { background: var(--color-notice-error); }

.fr-page { display: flex; align-items: center; justify-content: center; }
.fr-wrap { max-width: 600px; width: 100%; margin: 40px auto; }
.fr-card { cursor: default; padding: var(--space-xxl); }

.fr-step { text-align: center; }
.fr-step-icon-lg { font-size: 64px; margin-bottom: var(--space-lg); }
.fr-step-icon { font-size: 48px; margin-bottom: var(--space-lg); }
.fr-step-title { font-size: var(--font-size-xl); font-weight: 600; color: var(--color-primary); margin-bottom: 8px; }
.fr-step-title-sm { font-size: var(--font-size-lg); font-weight: 500; color: var(--color-primary); margin-bottom: 8px; }
.fr-step-desc { font-size: var(--font-size-sm); color: var(--color-text-muted); margin-bottom: var(--space-xl); }

.fr-step-list { display: flex; flex-direction: column; gap: 12px; text-align: left; max-width: 400px; margin: 0 auto var(--space-xl); }
.fr-step-item { display: flex; gap: 12px; padding: 12px; background: var(--color-bg-inset); border-radius: var(--r-sm); }
.fr-step-num { font-size: var(--font-size-md); }
.fr-step-item-desc { font-size: var(--font-size-sm); color: var(--color-text-muted); }

.fr-dep-list { display: flex; flex-direction: column; gap: var(--space-md); }
.fr-dep-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px; border-radius: var(--r-sm); text-align: left; }
.fr-dep-item--done { background: var(--color-success-soft); }
.fr-dep-item--active { background: var(--color-primary-light); }
.fr-dep-item--error { background: var(--color-danger-soft); }
.fr-dep-item--pending { background: var(--color-bg-inset); }
.fr-dep-icon { font-size: var(--font-size-lg); line-height: 24px; }
.fr-dep-body { flex: 1; }
.fr-dep-label { font-weight: 500; font-size: var(--font-size-sm); }
.fr-dep-msg { font-size: var(--font-size-sm); color: var(--color-text-muted); margin-top: 4px; }

.fr-step-actions { margin-top: var(--space-xl); }
.fr-ready-text { color: var(--color-success); margin-bottom: var(--space-lg); }
.fr-error-text { color: var(--color-danger); margin-bottom: var(--space-md); }
.fr-btn-skip { margin-left: 12px; }

.fr-platform-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; max-width: 450px; margin: 0 auto var(--space-xl); }
.fr-platform-btn {
  padding: 14px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--r-sm);
  background: var(--color-bg-canvas);
  cursor: pointer;
  font-size: var(--font-size-sm);
  display: flex;
  align-items: center;
  gap: 8px;
}
.fr-platform-btn--adding { opacity: 0.6; }
.fr-platform-icon { vertical-align: middle; }
.fr-step-next { margin-top: var(--space-md); }

.fr-final-actions { display: flex; gap: 12px; justify-content: center; }

.fr-dots { display: flex; justify-content: center; gap: 8px; margin-top: var(--space-xl); }
.fr-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-border); transition: background 0.3s; }
.fr-dot--active { background: var(--color-primary); }
</style>
