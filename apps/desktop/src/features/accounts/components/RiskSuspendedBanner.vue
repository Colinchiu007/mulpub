<template>
  <section
    v-if="items.length"
    class="risk-suspended-banner"
    data-testid="risk-suspended-banner"
    role="status"
    aria-live="polite"
  >
    <div class="risk-suspended-header">
      <span class="risk-suspended-title">
        {{ headerText }}
      </span>
    </div>
    <ul class="risk-suspended-list">
      <li
        v-for="(it) in items"
        :key="keyOf(it)"
        class="risk-suspended-item"
        data-testid="risk-suspended-item"
      >
        <span class="risk-suspended-tag">{{ platformLabel(it.platform) }}</span>
        <!-- 粒度显示项（fix-risk-hold-false-positive P1-4）：
             平台级挂起（accountId==null）覆盖该平台全部账号，必须与账号级区分，
             否则用户会以为只影响一个账号、解封一个后发现其他账号仍不可用。 -->
        <span
          v-if="it.accountId == null"
          class="risk-suspended-scope"
          data-testid="risk-suspended-scope-all"
          :title="t('publish.riskHold.guidanceAllAccounts')"
        >{{ t('publish.riskHold.scopeAllAccounts') }}</span>
        <span v-else class="risk-suspended-account">{{ it.accountId }}</span>
        <!-- 时间显示项：挂起是持久态（重启存活、无自动过期），必须让用户看到「什么时候挂的」 -->
        <span
          v-if="formatTime(it.at)"
          class="risk-suspended-at"
          data-testid="risk-suspended-at"
        >{{ t('publish.riskHold.detectedAt', { time: formatTime(it.at) }) }}</span>
        <!-- 判定依据显示项：来自主进程的封闭词表记号（strong/weak）。
             老记录可能没有 strength（升级前持久化）—— 此时**不显示**依据标签，
             不猜、也不兜底成「平台风控拦截」。 -->
        <span
          v-if="evidenceKey(it)"
          class="risk-suspended-evidence"
          data-testid="risk-suspended-evidence"
        >{{ t(evidenceKey(it)) }}</span>
        <button
          type="button"
          class="risk-suspended-resume"
          :disabled="busyKeys.has(keyOf(it))"
          data-testid="risk-suspended-resume"
          @click="onResume(it)"
        >
          {{ t('publish.riskHold.resume') }}
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup>
/**
 * 风控挂起横幅（W1 §5 enforcement 消费端 · 账号列表锚点）
 * 订阅 useRiskStore 权威挂起清单，逐条展示并提供「恢复发布」入口。
 * 合规红线：恢复必须经人工确认（tracker.confirm），绝不自动恢复 / 自动换号。
 *
 * fix-risk-hold-false-positive（P1-4）新增三个显示项：粒度（全平台/单账号）、检测时间、判定依据。
 * 文案一律走 i18n（zh/en 成对，CI Gate 7）；本文件不得出现中文字面量。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRiskStore } from '@/stores/risk'
import { usePlatformStore } from '@/stores/platforms'
import { useNotify } from '@/composables/useNotify'

const { t } = useI18n()
const riskStore = useRiskStore()
const platformStore = usePlatformStore()
const { notifySuccess, notifyError } = useNotify()
const busyKeys = ref(new Set())

const items = computed(() => (Array.isArray(riskStore.suspended) ? riskStore.suspended : []))

// 条目全部是平台级挂起时，标题换成「该平台全部账号」的说法；
// 混合清单（既有平台级又有账号级）沿用通用说法，条目上的粒度标签负责区分。
const allPlatformScope = computed(() =>
  items.value.length > 0 && items.value.every((it) => it && it.accountId == null),
)
const headerText = computed(() => {
  const first = items.value[0] || {}
  const params = { count: items.value.length, platform: platformLabel(first.platform) }
  return t(allPlatformScope.value ? 'publish.riskHold.suspendedAllAccounts' : 'publish.riskHold.suspended', params)
})

function keyOf(it) {
  return it.platform + '::' + (it.accountId == null ? '*' : it.accountId)
}
function platformLabel(p) {
  return platformStore.getLabel(p) || p
}

/** 判定依据的 i18n key；无 strength（升级前的老记录）⇒ 返回空串，模板据此不渲染。 */
function evidenceKey(it) {
  if (!it || !it.strength) return ''
  return it.strength === 'strong' ? 'publish.riskHold.evidenceStrong' : 'publish.riskHold.evidenceWeak'
}

/** 挂起时刻 → 本地短时间（HH:mm）；非法/缺失时间返回空串（模板据此不渲染）。 */
function formatTime(at) {
  const n = Number(at)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = new Date(n)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return hh + ':' + mm
}

// 恢复：交给 riskStore.resume（内部弹人工确认框）。取消则静默保持挂起。
async function onResume(it) {
  const k = keyOf(it)
  if (busyKeys.value.has(k)) return
  busyKeys.value = new Set(busyKeys.value).add(k)
  try {
    const res = await riskStore.resume(it.platform, it.accountId)
    if (res && res.ok) {
      notifySuccess('publish.riskHold.resumed', { params: { platform: platformLabel(it.platform) }, module: 'publish' })
    } else if (res && res.reason === 'error') {
      notifyError('publish.riskHold.resumeFailed', { params: { message: res.message || '' }, module: 'publish' })
    }
    // reason==='cancelled' / 'invalid' → 用户选择保持暂停，静默
  } finally {
    const next = new Set(busyKeys.value)
    next.delete(k)
    busyKeys.value = next
  }
}
</script>

<style scoped>
.risk-suspended-banner {
  margin: 0 0 12px;
  padding: 12px 16px;
  border: 1px solid var(--el-color-warning-light-5, #f3d19e);
  border-radius: 8px;
  background: var(--el-color-warning-light-9, #fdf6ec);
}
.risk-suspended-header {
  margin-bottom: 8px;
}
.risk-suspended-title {
  font-size: var(--font-size-sm);
  color: var(--el-color-warning, #e6a23c);
  font-weight: 600;
}
.risk-suspended-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.risk-suspended-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
}
.risk-suspended-tag {
  font-size: var(--font-size-sm);
  font-weight: 500;
}
.risk-suspended-account {
  font-size: var(--font-size-xs);
  color: var(--el-text-color-secondary, #909399);
}
.risk-suspended-scope {
  font-size: var(--font-size-xs);
  padding: 0 6px;
  border-radius: 4px;
  color: var(--el-color-danger, #f56c6c);
  background: var(--el-color-danger-light-9, #fef0f0);
  border: 1px solid var(--el-color-danger-light-8, #fde2e2);
}
.risk-suspended-at,
.risk-suspended-evidence {
  font-size: var(--font-size-xs);
  color: var(--el-text-color-secondary, #909399);
}
.risk-suspended-resume {
  font-size: var(--font-size-xs);
  padding: 2px 10px;
  border-radius: 4px;
  border: 1px solid var(--el-color-warning, #e6a23c);
  color: var(--el-color-warning, #e6a23c);
  background: transparent;
  cursor: pointer;
}
.risk-suspended-resume:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
