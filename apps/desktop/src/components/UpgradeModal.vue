<template>
  <div class="upgrade-overlay" @click.self="emit('close')">
    <div class="upgrade-modal">
      <div class="modal-header">
        <span style="font-weight:600;font-size: var(--font-size-base)">升级 Pro 版</span>
        <button class="cohere-btn-ghost" @click="emit('close')" style="font-size: var(--font-size-xs);padding:2px 6px">✕</button>
      </div>

      <div class="modal-body">
        <div class="plan-card free-card" :class="{ active: licenseType === 'free' }">
          <div class="plan-name">免费版</div>
          <div class="plan-price">¥0</div>
          <ul class="feature-list">
            <li>✓ 单平台发布</li>
            <li>✓ 基础平台支持</li>
            <li>✗ 批量发布</li>
            <li>✗ 定时发布</li>
            <li>✗ 内容模板</li>
            <li>✗ 数据分析</li>
          </ul>
          <div v-if="licenseType === 'free'" class="plan-badge current">当前方案</div>
        </div>

        <div class="plan-card pro-card" :class="{ active: isPro }">
          <div class="plan-name">Pro 版</div>
          <div class="plan-price">¥99 <span style="font-size: var(--font-size-xs);color:var(--muted)">/永久</span></div>
          <ul class="feature-list">
            <li>✓ 全平台发布</li>
            <li>✓ 批量发布</li>
            <li>✓ 定时发布</li>
            <li>✓ 内容模板</li>
            <li>✓ AI 辅助写作</li>
            <li>✓ 数据分析看板</li>
            <li>✓ API 开放平台</li>
          </ul>
          <div v-if="isPro" class="plan-badge active">已激活</div>
          <button v-else-if="!showPaymentFlow" class="upgrade-btn" @click="startPayment">立即升级</button>
        </div>
      </div>

      <!-- Payment flow -->
      <div v-if="showPaymentFlow" class="payment-flow">
        <div class="cohere-divider"></div>
        <div style="padding:var(--space-md)">
          <!-- Step 1: Select payment method -->
          <div v-if="paymentStep === 'select'" style="text-align:center">
            <div style="font-weight:600;font-size: var(--font-size-sm);margin-bottom:var(--space-md)">选择支付方式</div>
            <div class="payment-methods">
              <div class="payment-method-card" :class="{ active: selectedMethod === 'alipay' }" @click="selectedMethod = 'alipay'">
                <span style="font-size: var(--font-size-xl)">💳</span>
                <span>支付宝</span>
              </div>
              <div class="payment-method-card" :class="{ active: selectedMethod === 'wechat' }" @click="selectedMethod = 'wechat'">
                <span style="font-size: var(--font-size-xl)">💚</span>
                <span>微信支付</span>
              </div>
            </div>
            <button class="upgrade-btn" @click="submitOrder" :disabled="orderLoading" style="max-width:200px;margin:var(--space-md) auto">
              {{ orderLoading ? '创建订单...' : '确认支付 ¥99' }}
            </button>
            <div style="margin-top:var(--space-sm)">
              <button class="cohere-btn-ghost" @click="showPaymentFlow = false" style="font-size: var(--font-size-xs)">返回</button>
            </div>
          </div>

          <!-- Step 2: QR code / simulated payment -->
          <div v-if="paymentStep === 'paying'" style="text-align:center">
            <div style="font-weight:600;font-size: var(--font-size-sm);margin-bottom:var(--space-sm)">扫码支付</div>
            <div class="qr-placeholder">
              <span style="font-size:48px">{{ selectedMethod === 'alipay' ? '💳' : '💚' }}</span>
              <div style="font-size: var(--font-size-xs);color:var(--muted);margin-top:8px">
                请使用{{ selectedMethod === 'alipay' ? '支付宝' : '微信' }}扫码完成支付
              </div>
            </div>
            <div style="margin-top:var(--space-md);display:flex;gap:8px;justify-content:center">
              <button class="upgrade-btn" @click="simulatePayment" :disabled="simulating" style="max-width:160px">
                {{ simulating ? '处理中...' : '模拟支付成功（开发模式）' }}
              </button>
            </div>
            <div style="margin-top:var(--space-sm)">
              <button class="cohere-btn-ghost" @click="cancelOrder" style="font-size: var(--font-size-xs)">取消订单</button>
            </div>
          </div>

          <!-- Step 3: Success -->
          <div v-if="paymentStep === 'success'" style="text-align:center;padding:var(--space-lg)">
            <div style="font-size:48px;margin-bottom:var(--space-sm)">🎉</div>
            <div style="font-weight:600;font-size: var(--font-size-base);color:var(--success)">支付成功！</div>
            <div style="font-size: var(--font-size-sm);color:var(--muted);margin-top:4px">Pro 版已激活，尽情使用全部功能</div>
          </div>

          <!-- Step 3: Failed -->
          <div v-if="paymentStep === 'failed'" style="text-align:center;padding:var(--space-lg)">
            <div style="font-size:48px;margin-bottom:var(--space-sm)">😞</div>
            <div style="font-weight:600;font-size: var(--font-size-base);color:var(--coral)">支付失败</div>
            <div style="font-size: var(--font-size-sm);color:var(--muted);margin-top:4px">{{ paymentError || '请重试或选择其他支付方式' }}</div>
            <button class="cohere-btn-ghost" @click="resetPayment" style="margin-top:var(--space-sm);font-size: var(--font-size-xs)">重新选择支付方式</button>
          </div>
        </div>
      </div>

      <!-- Activation code section (existing) -->
      <div v-if="!showPaymentFlow && !isPro" class="activate-section">
        <div class="cohere-divider"></div>
        <div style="padding:var(--space-md)">
          <div style="font-weight:600;font-size: var(--font-size-sm);margin-bottom:var(--space-sm)">已有激活码？</div>
          <div style="display:flex;gap:8px;margin-bottom:var(--space-md)">
            <input
              v-model="licenseKey"
              class="upgrade-input"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-family:monospace;font-size: var(--font-size-sm);outline:none"
              @keyup.enter="doActivate"
            />
            <button class="upgrade-btn" @click="doActivate" :disabled="activating" style="max-width:100px">
              {{ activating ? '验证中...' : '激活' }}
            </button>
          </div>
          <div v-if="activateError" style="color:var(--coral);font-size: var(--font-size-sm);margin-bottom:var(--space-sm)">{{ activateError }}</div>
          <div v-if="activateSuccess" style="color:var(--success);font-size: var(--font-size-sm);margin-bottom:var(--space-sm)">激活成功！</div>
          <div class="cohere-divider"></div>
          <div style="text-align:center;padding:var(--space-sm)">
            <button class="cohere-btn-ghost" @click="doTrial" :disabled="trialLoading" style="font-size: var(--font-size-sm);color:var(--coral)">
              {{ trialLoading ? '激活中...' : '🎁 免费试用 7 天' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="isPro && !showPaymentFlow" class="modal-footer">
        <button class="cohere-btn-ghost" @click="doDeactivate" style="font-size: var(--font-size-xs);color:var(--coral)">注销许可证</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue"
import { useLicenseStore } from "@/stores/license"
import { paymentCreateOrder, paymentSimulate, paymentCancel } from "@/api/publisher"
import { reportError } from "@/utils/report-error"
import { formatUserError } from "@/utils/user-facing-error"

const emit = defineEmits(["close"])

const store = useLicenseStore()
const showPaymentFlow = ref(false)
const selectedMethod = ref("alipay")
const paymentStep = ref("select") // select | paying | success | failed
const orderId = ref("")
const orderLoading = ref(false)
const simulating = ref(false)
const paymentError = ref("")

const licenseKey = ref("")
const activating = ref(false)
const trialLoading = ref(false)
const activateError = ref("")
const activateSuccess = ref(false)

const licenseType = computed(() => store.licenseType)
const isPro = computed(() => store.isPro)

function startPayment() {
  showPaymentFlow.value = true
  paymentStep.value = "select"
  selectedMethod.value = "alipay"
}

async function submitOrder() {
  orderLoading.value = true
  try {
    const res = await paymentCreateOrder({ plan: "pro", method: selectedMethod.value })
    if (res.code === 0) {
      orderId.value = res.data.id
      paymentStep.value = "paying"
    } else {
      paymentError.value = formatUserError(res, { fallback: '创建订单失败，请稍后重试' }).message
      paymentStep.value = "failed"
    }
  } catch(e) {
    paymentError.value = formatUserError(e, { fallback: '创建订单失败，请稍后重试' }).message
    paymentStep.value = "failed"
  }
  orderLoading.value = false
}

async function simulatePayment() {
  simulating.value = true
  try {
    const res = await paymentSimulate(orderId.value)
    if (res.code === 0) {
      paymentStep.value = "success"
      await store.load()
    } else {
      paymentError.value = formatUserError(res, { fallback: '支付确认失败，请稍后重试' }).message
      paymentStep.value = "failed"
    }
  } catch(e) {
    paymentError.value = formatUserError(e, { fallback: '支付确认失败，请稍后重试' }).message
    paymentStep.value = "failed"
  }
  simulating.value = false
}

async function cancelOrder() {
  await paymentCancel(orderId.value)
  resetPayment()
}

function resetPayment() {
  paymentStep.value = "select"
  orderId.value = ""
  paymentError.value = ""
}

async function doActivate() {
  if (!licenseKey.value.trim()) {
    activateError.value = "请输入激活码"
    return
  }
  activating.value = true
  activateError.value = ""
  activateSuccess.value = false
  try {
    const ok = await store.activate(licenseKey.value.trim())
    if (ok) {
      activateSuccess.value = true
    } else {
      activateError.value = "激活码无效或已被使用"
    }
  } catch (e) {
    reportError('激活许可证失败', e)
  } finally {
    activating.value = false
  }
}

async function doTrial() {
  trialLoading.value = true
  try {
    const ok = await store.activateTrial()
    if (ok) {
      activateSuccess.value = true
    } else {
      activateError.value = "试用激活失败"
    }
  } catch (e) {
    reportError('激活试用失败', e)
  } finally {
    trialLoading.value = false
  }
}

async function doDeactivate() {
  await store.deactivate()
  showPaymentFlow.value = false
}

onMounted(async () => {
  await store.load()
})

defineExpose({ doActivate, doTrial, doDeactivate, licenseKey })
</script>

<style scoped>
.upgrade-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}
.upgrade-modal {
  background: var(--surface, #fff);
  border-radius: 16px;
  width: 640px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.15);
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border);
}
.modal-body {
  display: flex;
  gap: var(--space-md);
  padding: var(--space-lg);
}
.plan-card {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: var(--space-md);
  position: relative;
  transition: all 0.2s;
}
.plan-card.active {
  border-color: var(--coral);
  box-shadow: 0 0 0 1px var(--coral);
}
.plan-name { font-weight: 600; font-size: var(--font-size-base); margin-bottom: 4px; }
.plan-price { font-size: var(--font-size-xl); font-weight: 700; margin-bottom: var(--space-sm); }
.feature-list { list-style: none; padding: 0; margin: 0; font-size: var(--font-size-sm); line-height: 2; }
.feature-list li { color: var(--text-primary); }
.plan-badge { display: inline-block; font-size: var(--font-size-xs); padding: 2px 8px; border-radius: 4px; margin-top: var(--space-sm); }
.plan-badge.current { background: var(--soft-stone); color: var(--muted); }
.plan-badge.active { background: var(--success-bg, #d1fae5); color: var(--success, #059669); }
.upgrade-btn {
  display: block;
  padding: 8px 16px;
  background: var(--coral, #f56c6c);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: 500;
  transition: opacity 0.15s;
  width: 100%;
}
.upgrade-btn:hover { opacity: 0.9; }
.upgrade-btn:disabled { opacity: 0.5; cursor: default; }
.payment-flow, .activate-section { padding: 0 var(--space-lg) var(--space-lg); }
.payment-methods { display: flex; gap: var(--space-md); justify-content: center; margin-bottom: var(--space-md); }
.payment-method-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: var(--space-md) var(--space-lg);
  border: 2px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 120px;
}
.payment-method-card:hover { border-color: var(--coral-light, #f9a8a8); }
.payment-method-card.active { border-color: var(--coral); background: var(--coral-bg, #fef2f2); }
.qr-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 200px;
  margin: var(--space-md) auto;
  border: 2px dashed var(--border);
  border-radius: 12px;
  background: var(--bg, #f8f4ff);
}
.upgrade-input:focus { border-color: var(--coral) !important; }
.modal-footer { padding: var(--space-sm) var(--space-lg); text-align: center; }
</style>
