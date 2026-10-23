<template>
  <div v-if="open" class="wechat-pay-mask" data-testid="wechat-pay-dialog">
    <div class="wechat-pay-card" role="dialog" aria-modal="true">
      <header class="wechat-pay-header">
        <h3 class="wechat-pay-title">{{ t('memberCenter.payDialogTitle') }}</h3>
        <button class="wechat-pay-close" data-testid="wechat-pay-close" :disabled="state === 'paid'" @click="close">
          {{ t('memberCenter.payClose') }}
        </button>
      </header>

      <p v-if="planLabel" class="wechat-pay-amount" data-testid="wechat-pay-amount">
        {{ t('memberCenter.payAmountLabel') }}：{{ planLabel }}
      </p>

      <!-- loading -->
      <p v-if="state === 'loading'" class="wechat-pay-hint" data-testid="wechat-pay-loading">
        {{ t('memberCenter.payCreating') }}
      </p>

      <!-- qrcode / polling -->
      <template v-else-if="state === 'qrcode' || state === 'polling'">
        <img v-if="qrDataUrl" class="wechat-pay-qr" :src="qrDataUrl" :alt="t('memberCenter.payScanHint')" data-testid="wechat-pay-qr">
        <p class="wechat-pay-hint" data-testid="wechat-pay-scan-hint">{{ t('memberCenter.payScanHint') }}</p>
        <p v-if="state === 'polling'" class="wechat-pay-sub" data-testid="wechat-pay-waiting">{{ t('memberCenter.payWaiting') }}</p>
      </template>

      <!-- paid -->
      <p v-else-if="state === 'paid'" class="wechat-pay-hint is-success" data-testid="wechat-pay-paid">
        {{ t('memberCenter.paySuccess') }}
      </p>

      <!-- expired -->
      <template v-else-if="state === 'expired'">
        <p class="wechat-pay-hint is-warn" data-testid="wechat-pay-expired">{{ t('memberCenter.payExpired') }}</p>
        <button class="wechat-pay-primary" data-testid="wechat-pay-refresh" @click="start">{{ t('memberCenter.payRefresh') }}</button>
      </template>

      <!-- timeout -->
      <template v-else-if="state === 'timeout'">
        <p class="wechat-pay-hint is-warn" data-testid="wechat-pay-timeout">{{ t('memberCenter.payTimeout') }}</p>
        <button class="wechat-pay-primary" data-testid="wechat-pay-restart" @click="start">{{ t('memberCenter.payRestart') }}</button>
      </template>

      <!-- failed / error -->
      <template v-else-if="state === 'failed' || state === 'error'">
        <p class="wechat-pay-hint is-warn" data-testid="wechat-pay-failed">
          {{ state === 'failed' ? t('memberCenter.payFailed') : errorText }}
        </p>
        <button class="wechat-pay-primary" data-testid="wechat-pay-retry" @click="start">{{ t('memberCenter.payRetry') }}</button>
      </template>
    </div>
  </div>
</template>

<script setup>
/**
 * WeChatPayDialog — 微信 Native 扫码支付弹窗。
 *
 * 状态机（PRD §7.3 的 8 态，逐一枚举后才写代码）：
 *   loading → qrcode ⇄ polling → paid | failed | expired | timeout | error
 *
 * 三条纪律：
 *   ① **轮询只读**：本组件不推进任何订单/订阅状态，只反映服务端已写入的事实。
 *      权威源是服务端 webhook（见 openspec/changes/wechat-native-payment/specs）。
 *   ② **关闭即停轮询**：`onBeforeUnmount` + `close()` 都必须清定时器，否则弹窗关掉后
 *      后台每 3 秒打一次 IPC，直到应用退出。
 *   ③ **不展示 code_url 原文**：只有主进程渲染出的 SVG data URL（见 preload/wechat-pay.js）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { invoke } from '@/api/electron-bridge'
import { planLabelOf } from '@/views/member-center/labels'

const props = defineProps({
  open: { type: Boolean, default: false },
  plan: { type: String, default: '' },
  period: { type: String, default: 'month' },
  // 「继续支付」时传入既有订单号：主进程把它透传给服务端 `_reusePendingOrder`，
  // 复用同一订单重取 codeUrl（不新建订单行）
  reuseOrderId: { type: String, default: '' },
})
const emit = defineEmits(['close', 'paid'])

const { t } = useI18n()

const POLL_INTERVAL_MS = 3000
// 30 分钟硬上限：与 PRD §6.1「pending 订单 30 分钟未 paid」同源。二维码本身通常 2 小时有效，
// 但让用户盯着一个 2 小时的码没有意义，30 分钟足够完成支付。
const POLL_TIMEOUT_MS = 30 * 60 * 1000

const state = ref('loading')
const qrDataUrl = ref('')
const orderId = ref('')
const errorText = ref('')
let pollTimer = null
let deadline = 0

const planLabel = computed(() => {
  if (!props.plan) return ''
  return `${planLabelOf(t, props.plan)} · ${props.period === 'year' ? t('memberCenter.periodYear') : t('memberCenter.periodMonth')}`
})

function stopPolling () {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function fail (message) {
  stopPolling()
  errorText.value = typeof message === 'string' && message ? message : t('memberCenter.payFailed')
  state.value = 'error'
}

async function pollOnce () {
  if (!orderId.value) return
  if (Date.now() > deadline) {
    stopPolling()
    state.value = 'timeout'
    return
  }
  const response = await invoke('wechatPayOrderStatus', { orderId: orderId.value })
  // 非 0 码（503 / 鉴权失效 / IPC 异常）**不能直接 return**：那会让 setInterval 永远留着，
  // 弹窗关掉后仍每 3 秒打一次 IPC 直到应用退出。必须停表并给出可读错误。
  if (!response || response.code !== 0 || !response.data) {
    fail(response && response.message)
    return
  }
  const status = response.data.status
  if (status === 'paid') {
    stopPolling()
    state.value = 'paid'
    emit('paid', { orderId: orderId.value, plan: response.data.plan || props.plan })
    return
  }
  if (status === 'failed' || status === 'canceled') {
    stopPolling()
    state.value = 'expired'
  }
}

function startPolling () {
  stopPolling()
  deadline = Date.now() + POLL_TIMEOUT_MS
  state.value = 'polling'
  pollTimer = setInterval(() => { void pollOnce() }, POLL_INTERVAL_MS)
}

async function start () {
  stopPolling()
  qrDataUrl.value = ''
  orderId.value = ''
  errorText.value = ''
  state.value = 'loading'
  // 有 orderId 才是「继续支付」：只在有值时带上该键，保持新建订单的调用形状不变
  const orderPayload = { plan: props.plan, period: props.period }
  if (props.reuseOrderId) orderPayload.orderId = props.reuseOrderId
  const response = await invoke('wechatPayCreateOrder', orderPayload)
  if (!response || response.code !== 0 || !response.data) {
    // 服务端未开放支付通道时返回 503 PAYMENT_PROVIDER_UNAVAILABLE，走这里
    fail(response && response.message === 'PAYMENT_PROVIDER_UNAVAILABLE'
      ? t('memberCenter.payChannelUnavailable')
      : t('memberCenter.payFailed'))
    return
  }
  if (!response.data.qrDataUrl) {
    fail(t('memberCenter.payFailed'))
    return
  }
  qrDataUrl.value = response.data.qrDataUrl
  orderId.value = response.data.orderId || ''
  state.value = 'qrcode'
  if (orderId.value) startPolling()
}

function close () {
  // paid 态不允许直接关（让用户看到成功反馈）；其余态随时可关，关即停轮询
  if (state.value === 'paid') return
  stopPolling()
  emit('close')
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    void start()
  } else {
    stopPolling()
  }
}, { immediate: true })

onBeforeUnmount(stopPolling)
</script>

<style scoped>
.wechat-pay-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
}
.wechat-pay-card {
  width: 360px;
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.wechat-pay-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.wechat-pay-title { margin: 0; font-size: var(--font-size-md); }
.wechat-pay-close { border: none; background: transparent; cursor: pointer; color: #888; }
.wechat-pay-amount { margin: 0; font-size: var(--font-size-sm); color: #555; }
.wechat-pay-qr { width: 220px; height: 220px; }
.wechat-pay-hint { margin: 0; font-size: var(--font-size-sm); color: #555; text-align: center; }
.wechat-pay-hint.is-success { color: #2f9e44; }
.wechat-pay-hint.is-warn { color: #d9480f; }
.wechat-pay-sub { margin: 0; font-size: var(--font-size-xs); color: #999; }
.wechat-pay-primary {
  border: none;
  border-radius: 6px;
  padding: 8px 18px;
  background: #07c160;
  color: #fff;
  cursor: pointer;
}
</style>
