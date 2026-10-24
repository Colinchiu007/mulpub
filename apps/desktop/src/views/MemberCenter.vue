<template>
  <div class="member-center-view" data-testid="member-center-view">
    <!-- 页面头部 -->
    <div class="cohere-page-header">
      <div>
        <div class="page-title" data-testid="member-center-title">{{ t('memberCenter.title') }}</div>
        <div class="page-subtitle">{{ t('memberCenter.subtitle') }}</div>
      </div>
      <div class="page-actions">
        <button
          v-if="!hasSessionIdentity && status !== 'disabled'"
          class="cohere-btn-primary"
          data-testid="member-center-login"
          :disabled="loading"
          @click="handleSignIn"
        >
          {{ loading ? t('memberCenter.signingIn') : t('memberCenter.login') }}
        </button>
        <!-- P0-6 / v4 E1：升级入口统一为「路由跳订阅 tab」。
             UpgradeModal 已退役（死胡同 + 假陈述文案）；判定改用服务端
             entitlement.limits.plan_rank，**不再读本地 licenseStore**。 -->
        <button
          v-if="showUpgradeCta"
          class="cohere-btn-primary"
          data-testid="member-center-upgrade"
          @click="goToSubscription"
        >
          {{ t('memberCenter.upgradePro') }}
        </button>
      </div>
    </div>

    <!-- 身份服务未启用 -->
    <div v-if="status === 'disabled'" class="cohere-content member-center-single">
      <section class="member-center-card">
        <div class="member-center-disabled-title">{{ t('memberCenter.identityDisabled') }}</div>
        <p class="member-center-empty-hint">{{ t('memberCenter.identityDisabledHint') }}</p>
      </section>
    </div>

    <!-- 未登录空态 -->
    <div v-else-if="!hasSessionIdentity" class="cohere-content member-center-single">
      <section class="member-center-card member-center-empty" data-testid="member-center-empty">
        <div class="member-center-empty-icon" aria-hidden="true"><el-icon><Medal /></el-icon></div>
        <div class="member-center-empty-title">{{ t('memberCenter.notLoggedIn') }}</div>
        <p class="member-center-empty-hint">{{ t('memberCenter.notLoggedInHint') }}</p>
        <button class="cohere-btn-primary" :disabled="loading" @click="handleSignIn">
          {{ loading ? t('memberCenter.signingIn') : t('memberCenter.login') }}
        </button>
      </section>
    </div>

    <!-- 已登录：左侧七栏导航 + 右侧子视图 -->
    <div v-else class="cohere-content member-center-layout">
      <nav class="member-center-nav" data-testid="member-center-nav" aria-label="member-center">
        <button
          v-for="section in MEMBER_SECTIONS"
          :key="section.key"
          class="member-center-nav-item"
          :class="{ 'is-active': section.key === activeKey }"
          :data-testid="`member-center-nav-${section.key}`"
          type="button"
          @click="activate(section.key)"
        >
          <span class="member-center-nav-label">{{ t(section.navKey) }}</span>
          <span
            v-if="section.key === 'messages' && memberStore.unreadCount > 0"
            class="member-center-nav-badge"
            data-testid="member-center-nav-messages-badge"
          >{{ memberStore.unreadCount }}</span>
        </button>
      </nav>

      <!--
        右侧唯一内容区（2026-10-24 瘦身）：
        价目目录与激活码兑换已迁入「订阅与方案」子视图（P0-1）——
        壳层不再持有任何方案/购买/兑换内容，七个 tab 不再重复渲染。
      -->
      <div class="member-center-main" :data-testid="`member-center-${activeKey}`">
        <div v-if="errorMessage" class="member-center-error-box" role="alert">
          <p class="member-center-error">{{ errorMessage }}</p>
          <IdentityDiagnostics />
        </div>
        <component :is="activeView" @navigate="onChildNavigate" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { Medal } from '@element-plus/icons-vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useIdentity } from '@/composables/useIdentity'
import { useIdentityStore } from '@/stores/identity'
import { useMemberStore } from '@/stores/member'
import { resolveIdentityErrorMessageKey } from '@/utils/identity-error-messages'
import IdentityDiagnostics from '@/components/IdentityDiagnostics.vue'
import { MEMBER_VIEWS } from './member-center/views'
import { PLAN_RANK_MAX } from './member-center/constants'

// 七栏信息架构（§4 A 布局）。导航结构由壳层自身持有（不随子视图 mock 变化），
// MEMBER_VIEWS 仅提供 key->组件 的注册表，测试可安全替换后者。
const MEMBER_SECTIONS = [
  { key: 'overview', name: 'Overview', navKey: 'memberCenter.navOverview' },
  { key: 'account', name: 'AccountSecurity', navKey: 'memberCenter.navAccount' },
  { key: 'subscription', name: 'Subscription', navKey: 'memberCenter.navSubscription' },
  { key: 'orders', name: 'OrdersBilling', navKey: 'memberCenter.navOrders' },
  { key: 'usage', name: 'UsageQuota', navKey: 'memberCenter.navUsage' },
  { key: 'messages', name: 'Messages', navKey: 'memberCenter.navMessages' },
  { key: 'help', name: 'HelpSupport', navKey: 'memberCenter.navHelp' },
]

const { t } = useI18n()
const identityStore = useIdentityStore()
const memberStore = useMemberStore()
const router = useRouter()
const route = useRoute()
const { status, user, loading, error, signIn, switchAccount, signOut } = useIdentity()

const activeKey = ref('overview')

// ── 登录态门控（供 watch / 模板共用；定义必须早于下方 immediate watch）──
const hasSessionIdentity = computed(() => Boolean(user.value?.sub) && !['disabled', 'signed_out', 'expired'].includes(status.value))

// ── P1-5 / P1-6：member store 生命周期与角标预取 ──────────────────
// 进入页面即预取未读数（角标准确）；失败静默——消息 tab 激活时会重新
// load 并在那里展示错误。不在这里弹错：那会让「只想看账号」的用户
// 被一条与当前视图无关的错误打扰。
//
// 用 watch 而非只 onMounted：App.vue 的 identityStore.load() 是异步的，
// 挂载时 store 可能还没加载完（user 仍为 null）。只在 onMounted 预取一次
// 会漏掉「挂载后才拿到身份」这一窗。首帧拿到身份才取，之后不重复取。
let notificationsPrefetched = false
watch(
  () => hasSessionIdentity.value,
  (ready) => {
    if (ready && !notificationsPrefetched) {
      notificationsPrefetched = true
      void memberStore.loadNotifications()
    }
  },
  { immediate: true },
)

onMounted(() => {
  // 从 URL query 读初始分区（深链浅实现：只读一次，不双向同步）
  const section = route.query.section
  if (typeof section === 'string' && MEMBER_SECTIONS.some((s) => s.key === section)) {
    activeKey.value = section
  }
})

// 登出 / 身份服务禁用 / 切换账号（sub 变化）→ 复位 member store。
// 不复位的后果：切号后新账号看到上个账号的会话设备与通知。
watch(
  () => [user.value?.sub, status.value],
  ([sub, nextStatus], [prevSub]) => {
    if (sub !== prevSub || nextStatus === 'signed_out' || nextStatus === 'disabled') {
      memberStore.$reset()
    }
  },
)

// ── 导航 ─────────────────────────────────────────────────────────
const activeSection = computed(() => MEMBER_SECTIONS.find((s) => s.key === activeKey.value) || MEMBER_SECTIONS[0])
const activeView = computed(() => MEMBER_VIEWS[activeSection.value.name])

// 子视图（订单页空态）的导航请求。`redeem` 不是独立分区——激活码卡片常驻在订阅页上方，
// 所以切到订阅分区即可，用户落眼就是激活码输入框。
function onChildNavigate (key) {
  activeKey.value = key === 'redeem' ? 'subscription' : key
}

function activate(key) {
  activeKey.value = key
  if (key === 'messages') memberStore.loadNotifications()
  else if (key === 'account') memberStore.loadSessions()
}

// 升级入口：路由跳订阅 tab（P0-6）。
// 订阅页有真实价目（服务端 plans）+ 可购买卡片 + 兑换码，是「能做事的地方」。
function goToSubscription () {
  router.push('/member-center?section=subscription')
}

async function handleSignIn() {
  await signIn()
}

// ── 升级 CTA 判定（v4 E1：服务端 plan_rank 契约）──────────────────
// plan_rank 来自 entitlement.limits（服务端 PLAN_RANK 下发，#4051）。
// **不读本地 licenseStore**——本地授权与服务端权益是两套真源，
// A2 早已定论同源展示 entitlement。rank 缺失/未加载 → 不猜、不显示。
const showUpgradeCta = computed(() => {
  if (!hasSessionIdentity.value) return false
  const rank = identityStore.entitlement?.limits?.plan_rank
  if (!Number.isInteger(rank)) return false
  return rank < PLAN_RANK_MAX
})

const errorMessage = computed(() => {
  const entry = error.value
  if (!entry?.code) return ''
  const primary = t(resolveIdentityErrorMessageKey(entry.code))
  const cleanupCode = entry.cleanup?.code
  if (!cleanupCode) return primary
  const secondary = t(resolveIdentityErrorMessageKey(cleanupCode))
  return secondary === primary ? primary : `${primary} ${secondary}`
})
</script>
