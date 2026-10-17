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
          <!-- 2026-10-17 remove-buyout-license：这里原本是 `¥99 /永久`。
               买断授权模型已整体移除，价格不再由本组件硬编码（权威源是服务端
               plan-matrix 的三档订阅，经 GET /api/v1/plans 下发、会员中心展示）。
               本组件只负责如实说明「当前不可在线购买」。 -->
          <div class="plan-price plan-price-soon">
            {{ t('memberCenter.paymentChannelUnavailable') }}
          </div>
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
          <div v-else class="plan-badge soon">
            {{ t('memberCenter.paymentChannelUnavailable') }}
          </div>
        </div>
      </div>

      <!-- Activation code section (existing) -->
      <div v-if="!isPro" class="activate-section">
        <div class="cohere-divider"></div>
        <div style="padding:var(--space-md)">
          <!--
            2026-10-07：正式包不再提供本地激活码输入。
            实测 `licenseManager.activate()` 只对 key 做 trim()，任意字符串
            （含 "   "）都能拿到 type=pro + expiresAt=null 永久 + 8 项全功能；
            而本节在 #3064 里被特意保留，恰好成了漏洞入口。
            正式包的激活码已迁移至账号核销（服务端 `POST /api/v1/redeem`，
            带 durationDays 与事务化到期结算），本地入口同时被
            `license:activate` 的 `app.isPackaged !== false` 拒收。
            这里如实说明去向，而不是留一个必然失败的输入框。
          -->
          <div class="payment-unavailable">
            {{ t('memberCenter.activationCodeMigrated') }}
          </div>
          <!--
            2026-10-07：产品侧决定暂不提供免费试用，正式构建不再显示试用入口。
            理由（取证结论）：`activateTrial()` 只在本地写 `type=trial` + 8 项
            PRO_FEATURES，而服务端 `plan-matrix` 只有 free/standard/pro，
            **trial 命中 0**——这份权益在服务端权威门禁
            （`requireEntitlement('cloud_publish', { onlineOnly: true })`）前不成立。
            保留入口只会造成「UI 显示 Pro、点击被服务端拦」的假入口，
            比明确告知伤害更大。

            `doTrial` / `licenseManager.activateTrial()` 一并保留不删：
            将来若做试用，正确做法是往 plan-matrix 加 trial plan 由服务端发放，
            届时这两个函数可直接复用，不必重写。
            IPC 侧同步拒收见 `ipc-handlers/license.js` 的 `license:activate-trial`。
          -->
          <div v-if="!trialAvailable" class="payment-unavailable" style="text-align:center">
            {{ t('memberCenter.trialUnavailable') }}
          </div>
          <div v-else style="text-align:center;padding:var(--space-sm)">
            <button class="cohere-btn-ghost" @click="doTrial" :disabled="trialLoading" style="font-size: var(--font-size-sm);color:var(--coral)">
              {{ trialLoading ? '激活中...' : '🎁 免费试用 7 天' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="isPro" class="modal-footer">
        <button class="cohere-btn-ghost" @click="doDeactivate" style="font-size: var(--font-size-xs);color:var(--coral)">注销许可证</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue"
import { useLicenseStore } from "@/stores/license"
import { useI18n } from "vue-i18n"
import { reportError } from "@/utils/report-error"

const emit = defineEmits(["close"])
const { t } = useI18n()




/**
 * 免费试用入口的可见性（2026-10-07）：**正式构建默认关闭**，产品侧决定暂不提供试用。
 *
 * 取证结论：本地 `activateTrial()` 写 `type=trial` + 8 项 PRO_FEATURES，但服务端
 * `plan-matrix` 只有 free/standard/pro，**trial 命中 0**。所以这份本地权益在服务端
 * 权威门禁（`requireEntitlement`）前并不成立——用户看到 Pro 界面，点下去被拦。
 * 详见模板处注释。
 *
 * 口径：只读 `import.meta.env.DEV`，
 * **不给组件开测试注入口**（否则组件测试会因注入口与真实行为不符而恒真）。
 */
const trialAvailable = import.meta.env.DEV

const store = useLicenseStore()

const trialLoading = ref(false)

const licenseType = computed(() => store.licenseType)
const isPro = computed(() => store.isPro)

async function doTrial() {
  trialLoading.value = true
  try {
    // `store.activateTrial()` 内部会经 IPC 调 `license:activate-trial`；
    // 失败时它自己会抛/返回，这里只在异常时上报，不再维护本地提示态
    // （原来的 activateSuccess/activateError 属于激活码 UI，已随买断模型移除）
    await store.activateTrial()
  } catch (e) {
    reportError('激活试用失败', e)
  } finally {
    trialLoading.value = false
  }
}

async function doDeactivate() {
  await store.deactivate()
}

onMounted(async () => {
  await store.load()
})

defineExpose({ doTrial, doDeactivate })
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
.plan-badge.soon { background: var(--soft-stone); color: var(--muted); }
.plan-price-soon { font-size: var(--font-size-sm); font-weight: 500; color: var(--muted); }
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
.payment-unavailable {
  margin-top: var(--space-md);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--muted);
}
.modal-footer { padding: var(--space-sm) var(--space-lg); text-align: center; }
</style>
