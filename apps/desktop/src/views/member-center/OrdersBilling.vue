<template>
  <div class="member-center-orders">
    <section class="member-center-card">
      <div class="member-center-card-title">{{ t('memberCenter.ordersTitle') }}</div>

      <p v-if="loading" class="member-center-empty-hint" data-testid="orders-loading">
        {{ t('memberCenter.ordersLoading') }}
      </p>

      <!-- 加载失败必须与「没有订单」分开：把错误显示成空态会让用户以为自己的订单丢了 -->
      <template v-else-if="loadError">
        <p class="member-center-empty-hint is-error" role="alert" data-testid="orders-error">{{ loadError }}</p>
        <button class="orders-action" data-testid="orders-retry" @click="load">{{ t('memberCenter.ordersRetry') }}</button>
      </template>

      <template v-else-if="orders.length === 0">
        <p class="member-center-empty-hint" data-testid="member-center-orders-empty">
          {{ t('memberCenter.ordersEmptyHint') }}
        </p>
        <div class="orders-empty-actions">
          <button class="orders-action is-primary" data-testid="orders-empty-buy" @click="emit('navigate', 'subscription')">
            {{ t('memberCenter.ordersGoPay') }}
          </button>
          <button class="orders-action" data-testid="orders-empty-redeem" @click="emit('navigate', 'redeem')">
            {{ t('memberCenter.ordersGoRedeem') }}
          </button>
        </div>
      </template>

      <template v-else>
        <table class="orders-table" data-testid="orders-table">
          <thead>
            <tr>
              <th>{{ t('memberCenter.ordersColTime') }}</th>
              <th>{{ t('memberCenter.ordersColPlan') }}</th>
              <th>{{ t('memberCenter.ordersColAmount') }}</th>
              <th>{{ t('memberCenter.ordersColStatus') }}</th>
              <th aria-label="actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in orders" :key="order.id" :data-testid="`order-row-${order.id}`">
              <td>{{ formatTimestamp(order.createdAt) }}</td>
              <td>{{ planLabelOf(t, order.plan) }}</td>
              <td>{{ formatAmount(order) }}</td>
              <td>
                <span class="orders-status" :class="`is-${order.status}`" :data-testid="`order-status-${order.id}`">
                  {{ statusText(order.status) }}
                </span>
              </td>
              <td>
                <button
                  v-if="order.status === 'pending'"
                  class="orders-action"
                  :data-testid="`order-continue-${order.id}`"
                  @click="continuePay(order)"
                >
                  {{ t('memberCenter.ordersContinuePay') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="hasPending" class="orders-pending-hint" data-testid="orders-pending-hint">
          {{ t('memberCenter.ordersPendingHint') }}
        </p>
      </template>
    </section>

    <WeChatPayDialog
      :open="payOpen"
      :plan="payPlan"
      :period="payPeriod"
      :reuse-order-id="payOrderId"
      @close="payOpen = false"
      @paid="onPaid"
    />
  </div>
</template>

<script setup>
/**
 * OrdersBilling — 会员中心「订单与账单」。
 *
 * 落实 spec MODIFIED Requirement「会员中心订单页展示真实订单」：
 *   列 = 时间 / 套餐 / 金额 / 状态徽标；pending 给「继续支付」；空态给两个入口。
 *
 * 三条纪律：
 *   ① **失败 ≠ 空态**：请求失败必须单独渲染错误态 + 重试。把错误显示成「还没有订单」
 *      会让用户以为自己付过的订单丢了。
 *   ② **未登录不发请求**：登录前列表必然为空，发一次只会拿到 401 并在服务端留无主日志。
 *   ③ **不做退款入口**：本期非目标（PRD §7.5），退款走客服/运营。
 *
 * 「继续支付」用的是**同一 orderId**：服务端 `_reusePendingOrder` 六条前置校验后
 * 返回该订单的新 codeUrl，不新建订单行（否则点 N 次就多 N 条 pending）。
 */
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { invoke } from '@/api/electron-bridge'
import { useIdentityStore } from '@/stores/identity'
import { planLabelOf, formatTimestamp } from './labels'

// 弹窗按需加载：订单页大多数时候只是看列表，不需要二维码组件链
const WeChatPayDialog = defineAsyncComponent(() => import('@/components/WeChatPayDialog.vue'))

const emit = defineEmits(['navigate'])
const { t } = useI18n()
const identityStore = useIdentityStore()

const orders = ref([])
const loading = ref(false)
const loadError = ref('')

const payOpen = ref(false)
const payPlan = ref('')
const payPeriod = ref('')
const payOrderId = ref('')

const hasPending = computed(() => orders.value.some((order) => order.status === 'pending'))

const STATUS_KEYS = {
  pending: 'memberCenter.ordersStatusPending',
  paid: 'memberCenter.ordersStatusPaid',
  failed: 'memberCenter.ordersStatusFailed',
}

/**
 * 状态文案：已知三态走 locale；**未知值原样显示**而不是塞进某一档。
 * 把 `refunded` / `canceled` 之类映射成「已关闭」会让用户读到错误的账务状态。
 */
function statusText (status) {
  const key = STATUS_KEYS[status]
  return key ? t(key) : String(status || '')
}

/** 金额：分 → ¥x.xx，附计费周期。`amount` 不是整数时显示 `—`，不猜 0。 */
function formatAmount (order) {
  if (!Number.isInteger(order.amount)) return '—'
  const money = `¥${(order.amount / 100).toFixed(2)}`
  if (order.period === 'year') return `${money} / ${t('memberCenter.periodYear')}`
  if (order.period === 'month') return `${money} / ${t('memberCenter.periodMonth')}`
  return money
}

async function load () {
  if (!identityStore.isAuthenticated) {
    orders.value = []
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = ''
  const response = await invoke('wechatPayListOrders')
  loading.value = false
  if (!response || response.code !== 0 || !response.data) {
    loadError.value = (response && response.message) || t('memberCenter.ordersError')
    return
  }
  orders.value = Array.isArray(response.data.orders) ? response.data.orders : []
}

function continuePay (order) {
  payPlan.value = order.plan
  payPeriod.value = order.period || 'month'
  payOrderId.value = order.id
  payOpen.value = true
}

function onPaid () {
  // 支付成功后：关弹窗 + 重拉列表（状态由服务端 webhook 推进，本地不自行改状态）
  payOpen.value = false
  void load()
}

onMounted(load)
watch(() => identityStore.isAuthenticated, (authed) => {
  if (authed) void load()
  else { orders.value = []; loadError.value = '' }
})
</script>

<style scoped>
.orders-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}
.orders-table th,
.orders-table td {
  text-align: left;
  padding: 8px 6px;
  border-bottom: 1px solid var(--border-color-light, #eee);
}
.orders-status {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: var(--font-size-xs);
}
.orders-status.is-pending { background: #fff4e6; color: #d9480f; }
.orders-status.is-paid { background: #ebfbee; color: #2f9e44; }
.orders-status.is-failed { background: #f1f3f5; color: #868e96; }
.orders-empty-actions { display: flex; gap: 8px; margin-top: 8px; }
.orders-action {
  border: 1px solid #07c160;
  border-radius: 6px;
  background: #fff;
  color: #07c160;
  padding: 6px 14px;
  cursor: pointer;
}
.orders-action.is-primary { background: #07c160; color: #fff; }
.orders-pending-hint { margin: 10px 0 0; font-size: var(--font-size-xs); color: #d9480f; }
.member-center-empty-hint.is-error { color: #d9480f; }
</style>
