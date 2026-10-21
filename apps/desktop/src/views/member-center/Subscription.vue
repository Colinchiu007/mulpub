<template>
  <div class="member-center-subscription">
    <section v-if="entitlement" class="member-center-card" data-testid="member-center-subscription-detail">
      <div class="member-center-card-title">
        {{ t('memberCenter.entitlementCardTitle') }}
        <span class="member-center-source-badge" :class="`source-${entitlement.source || 'online'}`">
          {{ entitlement.source === 'offline' ? t('memberCenter.sourceOffline') : t('memberCenter.sourceOnline') }}
        </span>
      </div>
      <div class="member-center-plan-block">
        <span class="member-center-plan-name">{{ planLabel }}</span>
        <span v-if="entitlement.expiresAt" class="member-center-plan-meta">
          {{ t('memberCenter.expiresAt', { date: formatExpiresAt(entitlement.expiresAt) }) }}
        </span>
        <span v-else class="member-center-plan-meta">{{ t('memberCenter.noExpiry') }}</span>
      </div>
      <ul v-if="entitlement.features?.length" class="member-center-feature-list" data-testid="member-center-features">
        <li v-for="feature in entitlement.features" :key="feature" class="member-center-feature-item">
          <span class="member-center-feature-check" aria-hidden="true">✓</span>{{ feature }}
        </li>
      </ul>
      <p v-else class="member-center-empty-hint">{{ t('memberCenter.entitlementEmptyHint') }}</p>
    </section>
    <section v-else class="member-center-card member-center-empty">
      <p class="member-center-empty-hint">{{ t('memberCenter.entitlementEmptyHint') }}</p>
    </section>

    <!-- 在线购买（微信 Native 扫码）。仅登录时渲染按钮；
         未登录不渲染 —— 按钮不出现比"点了才报未登录"更诚实。 -->
    <section v-if="canPurchase" class="member-center-card" data-testid="member-center-purchase">
      <div class="member-center-card-title">{{ t('memberCenter.plansTitle') }}</div>
      <p class="member-center-empty-hint">{{ t('memberCenter.subscriptionPayHint') }}</p>
      <div class="member-center-purchase-row">
        <button
          v-for="option in purchaseOptions"
          :key="option.plan + option.period"
          class="member-center-purchase-btn"
          :data-testid="`purchase-${option.plan}-${option.period}`"
          @click="openPay(option)"
        >
          {{ option.label }}
        </button>
      </div>
    </section>

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
import { planLabelOf, formatExpiresAt } from './labels'
// 异步组件：弹窗只在用户点「立即购买」后才需要。同步 import 会让会员中心的每次挂载
// 都连带加载二维码组件链（electron-bridge + labels），实测把 MemberCenter.test.js 的
// 未登录用例推到 7.4s / 10s 超时边缘（并行负载下会 flaky）。
const WeChatPayDialog = defineAsyncComponent(() => import('@/components/WeChatPayDialog.vue'))

const { t } = useI18n()
const identityStore = useIdentityStore()
const entitlement = computed(() => identityStore.entitlement)
const planLabel = computed(() => planLabelOf(t, entitlement.value?.plan))

// 可购买条件：已登录。服务端未配置支付通道时，点击后弹窗显示「支付通道暂未开放」
// （由 503 PAYMENT_PROVIDER_UNAVAILABLE 映射）。此处不预判 —— 预判需额外一次探测请求，
// 而它会在无支付通道的环境里白白产生 503 日志。
const canPurchase = computed(() => Boolean(identityStore.isAuthenticated))

// 档位清单是**编译期常量**，不是从 plan-matrix 取价：价格展示由上面的价目卡走服务端
// （GET /api/v1/plans → identityStore.plans）。这里只决定"买什么"，不显示金额。
const purchaseOptions = computed(() => [
  { plan: 'standard', period: 'month', label: `${planLabelOf(t, 'standard')} · ${t('memberCenter.periodMonth')}` },
  { plan: 'standard', period: 'year', label: `${planLabelOf(t, 'standard')} · ${t('memberCenter.periodYear')}` },
  { plan: 'pro', period: 'month', label: `${planLabelOf(t, 'pro')} · ${t('memberCenter.periodMonth')}` },
  { plan: 'pro', period: 'year', label: `${planLabelOf(t, 'pro')} · ${t('memberCenter.periodYear')}` },
])

const payOpen = ref(false)
const payPlan = ref('')
const payPeriod = ref('month')

function openPay (option) {
  payPlan.value = option.plan
  payPeriod.value = option.period
  payOpen.value = true
}

function closePay () {
  payOpen.value = false
}

function onPaid () {
  // 权益刷新以服务端为准：重取 /me 快照，客户端**不自算**到期时间。
  if (typeof identityStore.load === 'function') {
    void identityStore.load()
  }
}
</script>

<style scoped>
.member-center-purchase-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.member-center-purchase-btn {
  border: 1px solid #07c160;
  border-radius: 6px;
  background: #fff;
  color: #07c160;
  padding: 6px 14px;
  cursor: pointer;
}
</style>
