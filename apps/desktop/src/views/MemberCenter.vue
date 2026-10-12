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
        <button
          v-if="showUpgradeCta"
          class="cohere-btn-primary"
          data-testid="member-center-upgrade"
          @click="showUpgrade = true"
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

      <div class="member-center-main" :data-testid="`member-center-${activeKey}`">
        <!--
          价目目录（2026-10-07）：数据来自服务端 GET /api/v1/plans，随权益同步一并取，
          经 `identity:state-changed` 推送到 `identityStore.plans`。
          `plan-matrix.js` 是定价唯一真源——此前的金额是营销文档里手写的。

          三态刻意区分，**不做硬编码兜底**：
            plans === null            → 取价失败或未取到（显示「暂不可用」，不显示空目录）
            plans.length === 0        → 服务端确实没有配置套餐
            有数据                    → 显示真实价格
          购买入口仍保持关闭（见 UpgradeModal 的 paymentChannelUnavailable）。
        -->
        <section
          class="member-center-plans"
          data-testid="member-center-plans"
          :aria-busy="plansLoading"
        >
          <h3 class="member-center-plans-title">{{ t('memberCenter.plansTitle') }}</h3>
          <p v-if="plans === null" class="member-center-plans-unavailable" data-testid="plans-unavailable">
            {{ t('memberCenter.plansUnavailable') }}
          </p>
          <p v-else-if="plans.length === 0" class="member-center-plans-unavailable" data-testid="plans-empty">
            {{ t('memberCenter.plansEmpty') }}
          </p>
          <ul v-else class="member-center-plans-list">
            <li
              v-for="plan in plans"
              :key="plan.id"
              class="member-center-plan"
              :class="{ 'is-current': plan.id === currentPlanId }"
              :data-testid="`plan-${plan.id}`"
            >
              <span class="member-center-plan-label">
                {{ plan.id === currentPlanId ? t('memberCenter.planCurrentSuffix', { label: plan.label }) : plan.label }}
              </span>
              <span class="member-center-plan-price" :data-testid="`plan-${plan.id}-price`">
                <template v-if="plan.priceMonthlyCents === 0">{{ t('memberCenter.planFree') }}</template>
                <template v-else>
                  {{ formatPrice(plan.priceMonthlyCents, plan.currency) }} / {{ t('memberCenter.perMonth') }}
                  <span class="member-center-plan-yearly">
                    · {{ formatPrice(plan.priceYearlyCents, plan.currency) }} / {{ t('memberCenter.perYear') }}
                  </span>
                </template>
              </span>
            </li>
          </ul>
        </section>
        <section class="member-center-redeem" data-testid="member-center-redeem">
          <h3 class="member-center-plans-title">{{ t('memberCenter.redeemTitle') }}</h3>
          <p class="member-center-redeem-hint">{{ t('memberCenter.redeemHint') }}</p>
          <div class="member-center-redeem-row">
            <input
              v-model="redeemCode"
              class="member-center-redeem-input"
              data-testid="redeem-code-input"
              :placeholder="t('memberCenter.redeemPlaceholder')"
              :disabled="redeeming"
              autocomplete="off"
              spellcheck="false"
              @keyup.enter="submitRedeem"
            >
            <button
              class="member-center-redeem-submit"
              data-testid="redeem-code-submit"
              :disabled="!canSubmitRedeem"
              @click="submitRedeem"
            >
              {{ redeeming ? t('memberCenter.redeeming') : t('memberCenter.redeemAction') }}
            </button>
          </div>
          <p
            v-if="redeemResult"
            class="member-center-redeem-result"
            :class="'is-' + redeemResult.tone"
            :data-testid="'redeem-result-' + redeemResult.tone"
          >
            {{ redeemResult.text }}
          </p>
        </section>
        <div v-if="errorMessage" class="member-center-error-box">
          <p class="member-center-error" role="alert">{{ errorMessage }}</p>
          <IdentityDiagnostics />
        </div>
        <component :is="activeView" />
      </div>
    </div>

    <UpgradeModal v-if="showUpgrade" @close="showUpgrade = false" />
  </div>
</template>

<script setup>
import { Medal } from '@element-plus/icons-vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIdentity } from '@/composables/useIdentity'
import { useIdentityStore } from '@/stores/identity'
import { useLicenseStore } from '@/stores/license'
import { useMemberStore } from '@/stores/member'
import { resolveIdentityErrorMessageKey } from '@/utils/identity-error-messages'
import IdentityDiagnostics from '@/components/IdentityDiagnostics.vue'
import UpgradeModal from '@/components/UpgradeModal.vue'
import { MEMBER_VIEWS } from './member-center/views'

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
const licenseStore = useLicenseStore()
const memberStore = useMemberStore()
const { status, user, loading, error, signIn, switchAccount, signOut } = useIdentity()

const showUpgrade = ref(false)
const activeKey = ref('overview')

const hasSessionIdentity = computed(() => Boolean(user.value?.sub) && !['disabled', 'signed_out', 'expired'].includes(status.value))
const entitlement = computed(() => identityStore.entitlement)
// 价目目录（2026-10-07）：来自服务端 /api/v1/plans，null = 未取到/取价失败。
// **不提供硬编码兜底**——取不到就显示「暂不可用」，绝不拿记忆里的金额冒充。
const plans = computed(() => identityStore.plans)
const plansLoading = computed(() => status.value === 'signing_in' || status.value === 'refreshing')
const currentPlanId = computed(() => (entitlement.value && entitlement.value.plan) || 'free')

// 服务端价格单位是**分**（整数，无浮点误差），这里才做除法。
// 仅用于展示，不参与任何计算或比较。
function formatPrice(cents, currency) {
  if (!Number.isInteger(cents)) return '—'
  const symbol = currency === 'CNY' ? '¥' : currency + ' '
  return symbol + (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)
}

// --- 激活码核销 -----------------------------------------------------------
// 本地 license:activate 已在正式构建禁用（任意非空串都能换永久 Pro），兑换码
// 改由服务端 POST /api/v1/redeem 核销，按 durationDays 授予会员。
const redeemCode = ref('')
const redeeming = ref(false)
// tone: success / info / error。info 专门给「同码重放」——它不是失败，
// 但也不是新开通，文案必须说清楚，避免用户以为又赚了一次时长。
const redeemResult = ref(null)

const canSubmitRedeem = computed(
  () => redeemCode.value.trim().length > 0 && !redeeming.value,
)

// 服务端错误码 → i18n key。message 放的是 error.code（见 ipc-handlers/identity.js 的 safeError）
const REDEEM_ERROR_KEYS = {
  REDEEM_CODE_FORMAT: 'redeemErrFormat',
  REDEEM_CODE_NOT_FOUND: 'redeemErrNotFound',
  REDEEM_CODE_USED: 'redeemErrUsed',
  REDEEM_CODE_DISABLED: 'redeemErrDisabled',
  REDEEM_CODE_EXPIRED: 'redeemErrExpired',
  BUSINESS_USER_REQUIRED: 'redeemErrSignedOut',
  ENTITLEMENT_SESSION_MISMATCH: 'redeemErrSignedOut',
}

function formatPeriodEnd(iso) {
  if (typeof iso !== 'string' || !iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

// 成功文案不能留空洞占位：plan/end 缺失时退成一句不含变量的兜底，
// 否则会出现「已开通 ，有效期至 」这种明显坏掉的用户可见文案。
function redeemDetail(plan, end) {
  const parts = []
  if (plan) parts.push(plan)
  if (end) parts.push(end)
  return parts.join(' · ')
}

async function submitRedeem() {
  if (!canSubmitRedeem.value) return
  redeeming.value = true
  redeemResult.value = null
  try {
    const res = await memberStore.redeemCode(redeemCode.value.trim())
    if (!res) {
      // store 走 setError 分支：错误码已被规范化进 memberStore.error
      // （见 stores/member.js 的 setError），这里据此选文案。
      const key = REDEEM_ERROR_KEYS[memberStore.error] || 'redeemErrNetwork'
      redeemResult.value = { tone: 'error', text: t('memberCenter.' + key) }
      return
    }
    const end = formatPeriodEnd(res.periodEnd)
    const detail = redeemDetail(res.plan, end)
    if (!res.idempotent) {
      redeemResult.value = {
        tone: 'success',
        text: detail
          ? t('memberCenter.redeemSuccess', { plan: res.plan, end: detail })
          : t('memberCenter.redeemSuccessGeneric'),
      }
    } else if (res.hasActiveSubscription) {
      redeemResult.value = {
        tone: 'info',
        text: end
          ? t('memberCenter.redeemAlreadyUsed', { plan: res.plan, end })
          : t('memberCenter.redeemReplayExpired', { plan: res.plan || '' }),
      }
    } else {
      // 服务端返回 200 但 subscription 为 null：这个码此前已兑换过，且那份
      // 订阅已经到期。重放不会再加时长——这里必须明说，不能报「兑换成功」。
      redeemResult.value = { tone: 'info', text: t('memberCenter.redeemReplayExpired', { plan: res.plan || '' }) }
    }
    redeemCode.value = ''
    await identityStore.load()
  } catch (error) {
    redeemResult.value = { tone: 'error', text: t('memberCenter.redeemErrNetwork') }
  } finally {
    redeeming.value = false
  }
}
// A2 单一真源：登录且有服务端权益快照时，升级 CTA 以 entitlement.plan 为准，不再读本地 licenseStore。
const showUpgradeCta = computed(() => {
  if (!hasSessionIdentity.value) return false
  if (entitlement.value) return entitlement.value.plan !== 'pro'
  return !licenseStore.isPro
})
const activeSection = computed(() => MEMBER_SECTIONS.find((s) => s.key === activeKey.value) || MEMBER_SECTIONS[0])
const activeView = computed(() => MEMBER_VIEWS[activeSection.value.name])
const errorMessage = computed(() => {
  const entry = error.value
  if (!entry?.code) return ''
  const primary = t(resolveIdentityErrorMessageKey(entry.code))
  const cleanupCode = entry.cleanup?.code
  if (!cleanupCode) return primary
  const secondary = t(resolveIdentityErrorMessageKey(cleanupCode))
  return secondary === primary ? primary : `${primary} ${secondary}`
})

function activate(key) {
  activeKey.value = key
  if (key === 'messages') memberStore.loadNotifications()
  else if (key === 'account') memberStore.loadSessions()
}

async function handleSignIn() {
  await signIn()
}

// 账号操作透传给子视图（AccountSecurity）复用，壳层保留引用避免重复实现。
defineExpose({ status, user, identityStore, licenseStore, memberStore, switchAccount, signOut })
// identityStore 引用便于子视图共享同一 pinia 单例的调试。
void identityStore
</script>
