<template>
  <div class="member-center-subscription">
    <!-- 权益卡：当前方案 + 到期/宽限 + 权益清单 -->
    <section v-if="entitlement" class="member-center-card" data-testid="member-center-subscription-detail">
      <div class="member-center-card-title">
        {{ t('memberCenter.entitlementCardTitle') }}
        <span class="member-center-source-badge" :class="`source-${entitlement.source || 'online'}`">
          {{ entitlement.source === 'offline' ? t('memberCenter.sourceOffline') : t('memberCenter.sourceOnline') }}
        </span>
        <!-- v4 宽限期徽标：「降级不是悬崖」，到期 7 天内只读 + 队列收尾 -->
        <span
          v-if="grace.inGrace"
          class="member-center-grace-badge"
          data-testid="member-center-grace"
        >{{ t('memberCenter.graceTitle') }}</span>
      </div>
      <div class="member-center-plan-block">
        <span class="member-center-plan-name">{{ planLabel }}</span>
        <!-- 宽限期优先于普通到期展示：必须让用户知道「已到期、配额按免费档」 -->
        <span v-if="grace.inGrace" class="member-center-plan-meta">
          {{ t('memberCenter.graceHint', { plan: grace.previousPlanLabel, date: grace.untilText }) }}
        </span>
        <span v-else-if="entitlement.expiresAt" class="member-center-plan-meta">
          {{ t('memberCenter.expiresAt', { date: formatExpiresAt(entitlement.expiresAt) }) }}
        </span>
        <span v-else class="member-center-plan-meta">{{ t('memberCenter.noExpiry') }}</span>
      </div>
      <ul v-if="entitlement.features?.length" class="member-center-feature-list" data-testid="member-center-features">
        <li v-for="feature in entitlement.features" :key="feature" class="member-center-feature-item">
          <span class="member-center-feature-check" aria-hidden="true">✓</span>{{ featureLabelOf(t, feature) }}
        </li>
      </ul>
      <p v-else class="member-center-empty-hint">{{ t('memberCenter.entitlementEmptyHint') }}</p>
    </section>
    <section v-else class="member-center-card member-center-empty">
      <p class="member-center-empty-hint">{{ t('memberCenter.entitlementEmptyHint') }}</p>
    </section>

    <!--
      价目卡（2026-10-24 从壳层迁入 + 可购买化）。
      数据来自服务端 GET /api/v1/plans，随权益同步一并取。
      三态刻意区分，**不做硬编码兜底**：
        plans === null     → 取价失败或未取到（「暂不可用」）
        plans.length === 0 → 服务端确实没有配置套餐
        有数据             → 卡片列表（可购买）
      购买走**唯一入口** openPay（v4 评审 E6：严禁第二条并行支付路径）。
    -->
    <section class="member-center-plans" data-testid="member-center-plans" :aria-busy="plansLoading">
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
          :class="{
            'is-current': isCurrentPlan(plan.id),
            'is-buyable': canBuyPlan(plan.id),
          }"
          :data-testid="`plan-${plan.id}`"
          :role="canBuyPlan(plan.id) ? 'button' : undefined"
          :tabindex="canBuyPlan(plan.id) ? 0 : undefined"
          :aria-disabled="!canBuyPlan(plan.id)"
          @click="canBuyPlan(plan.id) && openPay({ plan: plan.id, period: 'month' })"
          @keydown.enter="canBuyPlan(plan.id) && openPay({ plan: plan.id, period: 'month' })"
        >
          <span class="member-center-plan-label">
            {{ isCurrentPlan(plan.id) ? t('memberCenter.planCurrentSuffix', { label: plan.label }) : plan.label }}
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
          <!-- 购买入口：与卡片同路径（同一 openPay），不做第二套按钮组 -->
          <span
            v-if="canBuyPlan(plan.id)"
            class="member-center-plan-buy"
          >{{ t('memberCenter.planBuyCta') }}</span>
          <span v-else-if="isCurrentPlan(plan.id)" class="member-center-plan-current">
            {{ t('memberCenter.planBuyCurrent') }}
          </span>
        </li>
      </ul>
    </section>

    <!-- 激活码兑换（2026-10-24 从壳层迁入） -->
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
          :maxlength="REDEEM_CODE_MAX_LENGTH"
          autocomplete="off"
          spellcheck="false"
          @input="redeemCode = redeemCode.toUpperCase()"
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

    <!-- 唯一支付入口（与价目卡/购买按钮共用） -->
    <WeChatPayDialog
      :open="payOpen"
      :plan="payPlan"
      :period="payPeriod"
      @close="closePay"
      @paid="onPaid"
    />
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIdentityStore } from '@/stores/identity'
import { useMemberStore } from '@/stores/member'
import { featureLabelOf, formatExpiresAt, graceState, planLabelOf } from './labels'
import { REDEEM_CODE_MAX_LENGTH, REDEEM_CODE_PATTERN, REDEEM_ERR_FORMAT_LOCAL } from './constants'

// 异步组件：弹窗只在用户点「购买」后才需要。同步 import 会让会员中心的每次挂载
// 都连带加载二维码组件链（electron-bridge + labels），实测把 MemberCenter.test.js 的
// 未登录用例推到 7.4s / 10s 超时边缘（并行负载下会 flaky）。
const WeChatPayDialog = defineAsyncComponent(() => import('@/components/WeChatPayDialog.vue'))

const { t } = useI18n()
const identityStore = useIdentityStore()
const memberStore = useMemberStore()

const entitlement = computed(() => identityStore.entitlement)
const planLabel = computed(() => planLabelOf(t, entitlement.value?.plan))
const grace = computed(() => graceState(t, entitlement.value))

// 价目目录（2026-10-24 从壳层迁入）：来自服务端 /api/v1/plans，null = 未取到/取价失败。
// **不提供硬编码兜底**——取不到就显示「暂不可用」，绝不拿记忆里的金额冒充。
const plans = computed(() => identityStore.plans)
const plansLoading = computed(() => identityStore.status === 'signing_in' || identityStore.status === 'refreshing')

// ── 档位比较（v4 E1：服务端契约已就绪，渲染层切换）─────────────────
// plan_rank 来自 entitlement.limits（服务端 PLAN_RANK 下发）。
// 取不到 rank 时**不猜**：不标「当前」、不渲染购买（entitlement 未加载）。
const currentRank = computed(() => {
  const rank = entitlement.value?.limits?.plan_rank
  return Number.isInteger(rank) ? rank : null
})

function planRankOf(planId) {
  // 服务端 plans catalog 与 PLAN_RANK 同序（free/standard/pro）。
  // 这里只做 id→rank 的保守映射；未知 id 返回 null（不可购买、不标当前）。
  if (planId === 'free') return 0
  if (planId === 'standard') return 1
  if (planId === 'pro') return 2
  return null
}

function isCurrentPlan(planId) {
  if (currentRank.value === null) return false
  const rank = planRankOf(planId)
  return rank !== null && rank === currentRank.value
}

// 可购买条件：已登录 + 目标档 rank 严格高于当前档。
// 当前档显示「当前方案」；更高档才能买（到期后生效由服务端结算）。
function canBuyPlan(planId) {
  if (!identityStore.isAuthenticated) return false
  const rank = planRankOf(planId)
  if (rank === null || currentRank.value === null) return false
  return rank > currentRank.value
}

// 服务端价格单位是**分**（整数，无浮点误差），这里才做除法。
// 仅用于展示，不参与任何计算或比较。
function formatPrice(cents, currency) {
  if (!Number.isInteger(cents)) return '—'
  const symbol = currency === 'CNY' ? '¥' : currency + ' '
  return symbol + (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)
}

// ── 支付入口（唯一）───────────────────────────────────────────────
const payOpen = ref(false)
const payPlan = ref('')
const payPeriod = ref('month')

function openPay(option) {
  payPlan.value = option.plan
  payPeriod.value = option.period
  payOpen.value = true
}

function closePay() {
  payOpen.value = false
}

function onPaid() {
  // 权益刷新以服务端为准：重取 /me 快照，客户端**不自算**到期时间。
  // runExclusive 被占用时 load() 会静默返回 false——服务端落账后
  // state-changed 仍会推快照，UI 最终一致；这里不做重试（避免放大写）。
  if (typeof identityStore.load === 'function') {
    void identityStore.load()
  }
}

// ── 激活码核销（2026-10-24 从壳层迁入）────────────────────────────
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

// 服务端错误码 → i18n key。message 放的是 error.code（见 ipc-handlers/identity.js 的 safeError）。
// MEMBER_PERMISSION_REQUIRED 是前端 safeInvoke 规范化的权限错误码（§8 MAJOR-1）。
const REDEEM_ERROR_KEYS = {
  REDEEM_CODE_FORMAT: 'redeemErrFormat',
  REDEEM_CODE_NOT_FOUND: 'redeemErrNotFound',
  REDEEM_CODE_USED: 'redeemErrUsed',
  REDEEM_CODE_DISABLED: 'redeemErrDisabled',
  REDEEM_CODE_EXPIRED: 'redeemErrExpired',
  BUSINESS_USER_REQUIRED: 'redeemErrSignedOut',
  ENTITLEMENT_SESSION_MISMATCH: 'redeemErrSignedOut',
  MEMBER_PERMISSION_REQUIRED: 'redeemErrSignedOut',
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
  // P1-8 / MISS-9：本地前置校验与服务端正则**逐字符同型**（排除 I/O/0/1）。
  // 不满足就本地拦截——不发请求，不浪费一次服务端往返。
  const code = redeemCode.value.trim()
  if (!REDEEM_CODE_PATTERN.test(code)) {
    redeemResult.value = { tone: 'error', text: t(REDEEM_ERR_FORMAT_LOCAL) }
    return
  }
  redeeming.value = true
  redeemResult.value = null
  try {
    const res = await memberStore.redeemCode(code)
    if (!res) {
      // store 走 setError 分支：错误码已被规范化进 memberStore.error
      // （见 stores/member.js 的 safeInvoke），这里据此选文案。
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
</script>

<style scoped>
/* 价目卡（2026-10-24 从壳层迁入 + 可购买化） */
.member-center-plans {
  padding: var(--space-md) var(--space-lg);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  background: var(--surface);
}
.member-center-plans-title {
  margin: 0 0 12px;
  color: var(--ink);
  font-size: var(--font-size-sm);
  font-weight: 700;
}
.member-center-plans-unavailable {
  margin: 0;
  color: var(--muted);
  font-size: var(--font-size-sm);
}
.member-center-plans-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.member-center-plan {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--hairline);
  border-radius: 10px;
  background: var(--soft-stone);
}
/* 可购买卡：整卡可点（键盘可达由 tabindex/role 保证） */
.member-center-plan.is-buyable {
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.member-center-plan.is-buyable:hover,
.member-center-plan.is-buyable:focus-visible {
  border-color: #07c160;
  background: var(--surface);
}
.member-center-plan.is-current {
  border-color: var(--card-border);
  background: var(--surface);
}
.member-center-plan-label {
  color: var(--ink);
  font-size: var(--font-size-sm);
  font-weight: 700;
}
.member-center-plan-price {
  color: var(--ink);
  font-size: var(--font-size-sm);
  font-weight: 700;
}
.member-center-plan-yearly {
  color: var(--muted);
  font-size: var(--font-size-xs);
  font-weight: 400;
}
.member-center-plan-buy {
  flex: 0 0 auto;
  padding: 4px 12px;
  border: 1px solid #07c160;
  border-radius: 6px;
  color: #07c160;
  font-size: var(--font-size-xs);
  font-weight: 600;
}
.member-center-plan-current {
  flex: 0 0 auto;
  padding: 4px 12px;
  border-radius: 6px;
  background: var(--soft-stone);
  color: var(--muted);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

/* 兑换区（2026-10-24 从壳层迁入） */
.member-center-redeem {
  padding: var(--space-md) var(--space-lg);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  background: var(--surface);
}
.member-center-redeem-hint {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: var(--font-size-sm);
  line-height: 1.6;
}
.member-center-redeem-row {
  display: flex;
  gap: 8px;
}
.member-center-redeem-input {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--card-border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--font-size-sm);
}
.member-center-redeem-submit {
  flex: 0 0 auto;
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: var(--coral, #f56c6c);
  color: #fff;
  font-family: inherit;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
}
.member-center-redeem-submit:disabled {
  opacity: 0.5;
  cursor: default;
}
.member-center-redeem-result {
  margin: 10px 0 0;
  font-size: var(--font-size-sm);
  line-height: 1.6;
}
.member-center-redeem-result.is-success { color: var(--success, #059669); }
.member-center-redeem-result.is-info { color: var(--muted); }
.member-center-redeem-result.is-error { color: var(--danger, hsl(0 65% 42%)); }

/* 宽限期徽标（v4 新增） */
.member-center-grace-badge {
  padding: 1px 8px;
  border-radius: 10px;
  background: hsl(42 87% 88%);
  color: hsl(43 63% 33%);
  font-size: var(--font-size-xs);
  font-weight: 400;
}
</style>
