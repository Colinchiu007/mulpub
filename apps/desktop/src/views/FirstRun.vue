<template>
  <div v-if="showNotification" class="fr-toast" :class="notificationType === 'success' ? 'fr-toast--success' : 'fr-toast--error'">{{ notificationMsg }}</div>
<div class="cohere-content fr-page">
    <div class="fr-wrap">
      <div class="cohere-card fr-card">

        <!-- Step 0: Welcome -->
        <div v-if="currentStep === 0" class="fr-step">
          <div class="fr-step-icon-lg"><el-icon><Promotion /></el-icon></div>
          <h2 class="fr-step-title">{{ $t('onboarding.welcome') }}</h2>
          <p class="fr-step-desc">
            三步完成配置，即可开始多平台一键发布
          </p>
          <div class="fr-step-list">
            <div class="fr-step-item">
              <span class="fr-step-num">①</span>
              <div><strong>{{ $t("onboarding.runtimeTitle") }}</strong><br><span class="fr-step-item-desc">{{ $t("onboarding.runtimeShortDesc") }}</span></div>
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
          <div class="fr-step-icon"><el-icon><Setting /></el-icon></div>
          <h2 class="fr-step-title-sm">{{ $t("onboarding.runtimeTitle") }}</h2>
          <p class="fr-step-desc">
            {{ $t("onboarding.runtimeNote") }}
          </p>
          <div class="fr-step-actions">
            <button class="cohere-btn-primary" @click="currentStep = 2">下一步：添加账号 →</button>
          </div>
        </div>

        <!-- Step 2: Add Account -->
        <div v-else-if="currentStep === 2" class="fr-step">
          <div class="fr-step-icon"><el-icon><Key /></el-icon></div>
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
              <span><el-icon><EditPen /></el-icon></span>
              <div><strong>写文章</strong><br><span class="fr-step-item-desc">在发布页面编辑标题和正文</span></div>
            </div>
            <div class="fr-step-item">
              <span><el-icon><Aim /></el-icon></span>
              <div><strong>选平台</strong><br><span class="fr-step-item-desc">勾选要发布的平台</span></div>
            </div>
            <div class="fr-step-item">
              <span><el-icon><Promotion /></el-icon></span>
              <div><strong>一键发布</strong><br><span class="fr-step-item-desc">后台自动分发到所有选中的平台</span></div>
            </div>
          </div>

          <div class="fr-final-actions">
            <!-- 出口必须落首启标记：否则下次启动又回到向导（UX 审计 1.4）。
                 标记写失败不挡用户离开 —— 把人困在向导里比"下次还要再走一遍"更糟，
                 失败态以提示与日志出声（见 finishAndGo）。 -->
            <button class="cohere-btn-secondary" :disabled="finishing" data-testid="first-run-exit-accounts" @click="finishAndGo('/accounts')">管理账号</button>
            <button class="cohere-btn-primary" :disabled="finishing" data-testid="first-run-exit-publish" @click="finishAndGo('/publish')">开始发布 →</button>
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
import { Aim, EditPen, Key, Promotion, Setting } from '@element-plus/icons-vue'
import UiButton from "../components/UiButton.vue";
import { getApi } from '@/api/electron-bridge'
// eslint-disable-next-line no-unused-vars
import UiInput from "../components/UiInput.vue";
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

// 欢迎语文案走 locale 单一来源（onboarding.welcome，zh/en 成对）：
// 曾在此处硬编码欢迎语，改名时漏改即造成「一个产品两个名字」，
// 且硬编码中文会被 check-locale-sync --cjk 判为新增硬编码。改由 locale 承担。
const { t: $t } = useI18n()
// 简单通知
const notificationMsg = ref('')
const notificationType = ref('success')
const showNotification = ref(false)

// eslint-disable-next-line no-unused-vars
const router = useRouter()

function notify(msg, type = 'success') {
  notificationMsg.value = msg
  notificationType.value = type
  showNotification.value = true
  setTimeout(() => { showNotification.value = false }, 3000)
}
import { firstRunComplete, authOpenLogin, accountAdd } from '@/api/publisher'
import { useRouter } from 'vue-router'
import { getPlatformIconUrl } from '@/composables/usePlatformIconUrl'

const currentStep = ref(0)
const addingPlatform = ref('')
const finishing = ref(false)

const quickPlatforms = [
  { id: 'wechat_mp', label: '微信公众号', icon: '💬', iconUrl: getPlatformIconUrl('wechat_mp') },
  { id: 'zhihu', label: '知乎', icon: '❓', iconUrl: getPlatformIconUrl('zhihu') },
  { id: 'weibo', label: '微博', icon: '✧', iconUrl: getPlatformIconUrl('weibo') },
  { id: 'douyin', label: '抖音', icon: '🎵', iconUrl: getPlatformIconUrl('douyin') },
  { id: 'xiaohongshu', label: '小红书', icon: '📕', iconUrl: getPlatformIconUrl('xiaohongshu') },
  { id: 'youtube', label: 'YouTube', icon: '▶', iconUrl: getPlatformIconUrl('youtube') },
]

// 首启向导不再订阅主进程推送，也不再显示"环境检测通过"：
// P2-E 之后主进程首启流程不做任何安装或检测（它现在只负责告知"还需不需要引导"），
// 而旧实现把推送 type:done 当成"两项依赖都 ✅"来点亮 —— 那是给用户看的假证据。
// 依赖状态从 UI 里整条撤下，进度改由用户自己点「下一步」推进。

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

/**
 * 向导出口：先落首启标记再离开。
 * 三条口径：
 *  1. 标记不落就离开 ⇒ 下次启动又回到向导，所以这是唯一写者入口（主进程已不再自动落，见 1.4）。
 *  2. 标记写失败**不挡用户离开** —— 把人困在向导里比"下次还要再走一遍"更糟；但必须出声
 *     （toast + console.warn），不得静默，否则用户只会反复重启排障。
 *  3. 这条链由点击处理函数 await，异常必须自己收口：浮出去的 promise 会变成 Unhandled Rejection。
 */
async function finishAndGo (path) {
  if (finishing.value) return
  finishing.value = true
  try {
    const res = await firstRunComplete()
    if (!res || res.code !== 0) {
      notify($t('onboarding.saveFailedNotice'), 'error')
      console.warn('[first-run] mark write rejected: ' + ((res && res.message) || 'unknown'))
    }
  } catch (error) {
    notify($t('onboarding.saveFailedNotice'), 'error')
    console.warn('[first-run] mark write threw: ' + ((error && error.message) || String(error)))
  } finally {
    finishing.value = false
  }
  // QM-6 i3：这句原先落在 try/finally **之外**，与本函数注释第 3 条（"异常必须自己收口，
  // 浮出去的 promise 会变成 Unhandled Rejection"）自相矛盾 —— 导航守卫 reject/redirect 时
  // 它会逃逸成未处理 rejection，而用户停在原地却看不到任何解释。
  try {
    await router.push(path)
  } catch (error) {
    console.warn('[first-run] navigation after wizard exit failed: ' + ((error && error.message) || String(error)))
  }
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

/* 原 .fr-dep-* 十条规则随「环境检测」步骤一起撤下（ux-audit-first-run-launch）：
 * 那两行状态从未对应任何真实检测；历史形态用 `git log -p --follow` 取证。
 * 这里必须用 CSS 块注释而不是双斜线行注释 —— 写成行注释时 vitest 全绿（它不编译 style 块），
 * 只有 build:dir 里的 vite/postcss 会炸；QM-1 正是拦这一类的闸。 */

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
