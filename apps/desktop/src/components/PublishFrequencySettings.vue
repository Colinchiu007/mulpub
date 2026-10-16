<template>
  <div class="pubfreq" data-testid="publish-frequency-settings">
    <h3 class="pubfreq__title">{{ t('settings.publishFrequency.title') }}</h3>
    <p class="pubfreq__hint">{{ t('settings.publishFrequency.subtitle') }}</p>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      :title="loadError"
      data-testid="pubfreq-load-error"
    />

    <template v-else>
      <!-- 当前生效口径（只读） -->
      <section class="pubfreq__section" data-testid="pubfreq-current">
        <div class="pubfreq__row">
          <span class="pubfreq__label">{{ t('settings.publishFrequency.currentTier') }}</span>
          <span class="pubfreq__value">{{ currentTierText }}</span>
        </div>
        <div class="pubfreq__row">
          <span class="pubfreq__label">{{ t('settings.publishFrequency.effectiveRange') }}</span>
          <span class="pubfreq__value">{{ effectiveRangeText }}</span>
        </div>
      </section>

      <!-- 覆盖项（保存后即时生效） -->
      <section class="pubfreq__section">
        <el-alert
          type="warning"
          :closable="false"
          :title="t('settings.publishFrequency.overrideScopeHint')"
          data-testid="pubfreq-override-scope"
        />
        <div class="pubfreq__field">
          <label class="pubfreq__label">{{ t('settings.publishFrequency.accountInterval') }}</label>
          <el-input-number v-model="form.accountMinutes" :min="0" :max="bounds.intervalMinutes" :step="1" :placeholder="t('settings.publishFrequency.unset')" data-testid="pubfreq-account-min" />
        </div>
        <div class="pubfreq__field">
          <label class="pubfreq__label">{{ t('settings.publishFrequency.platformInterval') }}</label>
          <el-input-number v-model="form.platformMinutes" :min="0" :max="bounds.intervalMinutes" :step="1" data-testid="pubfreq-platform-min" />
          <span class="pubfreq__field-hint">{{ t('settings.publishFrequency.platformIntervalHint') }}</span>
        </div>
        <div class="pubfreq__field">
          <label class="pubfreq__label">{{ t('settings.publishFrequency.dailyMaxLong') }}</label>
          <el-input-number v-model="form.dailyLong" :min="0" :max="bounds.dailyMax" :step="1" data-testid="pubfreq-daily-long" />
        </div>
        <div class="pubfreq__field">
          <label class="pubfreq__label">{{ t('settings.publishFrequency.dailyMaxClip') }}</label>
          <el-input-number v-model="form.dailyClip" :min="0" :max="bounds.dailyMax" :step="1" data-testid="pubfreq-daily-clip" />
        </div>
        <div class="pubfreq__field">
          <label class="pubfreq__label">{{ t('settings.publishFrequency.dailyMaxShort') }}</label>
          <el-input-number v-model="form.dailyShort" :min="0" :max="bounds.dailyMax" :step="1" data-testid="pubfreq-daily-short" />
        </div>
        <div class="pubfreq__field">
          <label class="pubfreq__label">{{ t('settings.publishFrequency.jitterOn') }}</label>
          <el-switch v-model="form.jitterOn" data-testid="pubfreq-jitter" />
          <span class="pubfreq__field-hint">{{ t('settings.publishFrequency.jitterHint') }}</span>
        </div>
        <el-alert
          type="info"
          :closable="false"
          :title="t('settings.publishFrequency.dailyMaxPendingConfirm')"
          data-testid="pubfreq-pending-confirm"
        />
        <div class="pubfreq__actions">
          <el-button type="primary" :loading="saving" data-testid="pubfreq-save" @click="onSave">
            {{ t('settings.publishFrequency.save') }}
          </el-button>
          <el-button :disabled="saving" data-testid="pubfreq-reset" @click="onReset">
            {{ t('settings.publishFrequency.reset') }}
          </el-button>
        </div>
      </section>

      <!-- 紧急放行（P2-2）：二次确认 + 每日上限 + 冷却 + 追加式审计 + 三态回显 -->
      <section class="pubfreq__section pubfreq__section--danger">
        <h4 class="pubfreq__subtitle">{{ t('settings.publishFrequency.emergencyTitle') }}</h4>
        <p class="pubfreq__hint">{{ t('settings.publishFrequency.emergencyHint') }}</p>
        <div class="pubfreq__row">
          <span class="pubfreq__label">{{ t('settings.publishFrequency.emergencyQuota') }}</span>
          <span class="pubfreq__value" data-testid="pubfreq-emergency-quota">{{ emergencyQuotaText }}</span>
        </div>
        <div class="pubfreq__field">
          <label class="pubfreq__label">{{ t('settings.publishFrequency.emergencyPlatform') }}</label>
          <el-select v-model="emergency.platform" :placeholder="t('settings.publishFrequency.emergencyPlatform')" data-testid="pubfreq-emergency-platform">
            <el-option v-for="p in platformKeys" :key="p" :label="p" :value="p" />
          </el-select>
        </div>
        <div class="pubfreq__field">
          <label class="pubfreq__label">{{ t('settings.publishFrequency.emergencyAccount') }}</label>
          <el-input v-model="emergency.accountId" :placeholder="t('settings.publishFrequency.emergencyAccountPlaceholder')" data-testid="pubfreq-emergency-account" />
        </div>
        <div class="pubfreq__field">
          <label class="pubfreq__label">{{ t('settings.publishFrequency.emergencyReason') }}</label>
          <el-input v-model="emergency.reason" maxlength="200" show-word-limit data-testid="pubfreq-emergency-reason" />
        </div>
        <el-button
          type="warning"
          :loading="releasing"
          :disabled="!emergency.platform"
          data-testid="pubfreq-emergency-submit"
          @click="onEmergencyRelease"
        >
          {{ t('settings.publishFrequency.emergencySubmit') }}
        </el-button>
        <p v-if="emergencyResult" class="pubfreq__result" :class="emergencyResultClass" data-testid="pubfreq-emergency-result">
          {{ emergencyResult }}
        </p>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
// 项目约定：Vue 组件一律经 @/api/publisher 访问 IPC，禁止直接调 window.electronAPI
import {
  getPublishFrequencyPolicy,
  setPublishFrequencyPolicy,
  emergencyReleasePublishWait,
  getPublishEmergencyStatus,
} from '@/api/publisher'

const { t } = useI18n()

const loading = ref(false)
const saving = ref(false)
const releasing = ref(false)
const loadError = ref('')
const raw = ref(null)

// 合法域上界由 getPolicy 下发，真源是策略模块（change: publish-frequency-unwired-surfaces）。
// 这里**不写数字兜底**：模板原先硬编码 :max="999" / :max="10080"，于是渲染层与主进程
// （env 与设置页覆盖当时都没有对应上界）各有各的合法域，改一侧忘另一侧永远不会红。
// 装载失败时表单不渲染；万一载荷缺字段则留 undefined（el-input-number 视为不设上界），
// 权威上界仍由主进程 resolvePolicyOverrides 在保存时拒绝 —— UI 的界只是提前告知。
const bounds = reactive({ dailyMax: undefined, intervalMinutes: undefined })

const form = reactive({
  // null = 该项未覆盖（继续用各平台自己的默认档）。**不用 0 / 默认值预填**，
  // 否则用户「什么都不改直接保存」会把所有平台的差异化档位压平（评审 i3）。
  accountMinutes: null,
  platformMinutes: null,
  dailyLong: null,
  dailyClip: null,
  dailyShort: null,
  jitterOn: null,
})

const emergency = reactive({ platform: '', accountId: '', reason: '' })
const emergencyResult = ref('')
const emergencyResultClass = ref('')

const platformKeys = computed(() => Object.keys((raw.value && raw.value.platforms) || {}).sort())

/** 当前档位文案：按平台档位分组给出代表性取值（不逐平台罗列，避免 15 行噪音） */
const currentTierText = computed(() => {
  const platforms = (raw.value && raw.value.platforms) || {}
  const keys = Object.keys(platforms)
  if (keys.length === 0) return '—'
  const byTier = new Map()
  for (const k of keys) {
    const v = platforms[k] || {}
    const sig = `${v.accountMinMs}/${v.platformMinMs}/${v.accountDailyMax}`
    if (!byTier.has(sig)) byTier.set(sig, { tier: v.tier, sample: k, v, count: 0 })
    byTier.get(sig).count += 1
  }
  return [...byTier.values()]
    .map((g) => t('settings.publishFrequency.tierSummary', {
      tier: g.tier,
      count: g.count,
      sample: g.sample,
      account: fmtMin(g.v.accountMinMs),
      platform: fmtMin(g.v.platformMinMs),
      daily: g.v.accountDailyMax,
    }))
    .join(t('settings.publishFrequency.tierSeparator'))
})

/** 实际等待区间 = [账号档, 账号档 × (1 + 抖动比例)) */
const effectiveRangeText = computed(() => {
  const platforms = (raw.value && raw.value.platforms) || {}
  const ratios = Number(raw.value && raw.value.jitterRatio) || 0
  const keys = Object.keys(platforms)
  if (keys.length === 0) return '—'
  const mins = keys.map((k) => Number(platforms[k].accountMinMs) || 0)
  const lo = Math.min(...mins)
  const hi = Math.max(...mins)
  return `${fmtMin(lo)}–${fmtMin(Math.round(hi * (1 + ratios)))}`
})

const emergencyQuotaText = computed(() => {
  const st = raw.value && raw.value.emergencyStatus
  if (!st) return '—'
  return t('settings.publishFrequency.emergencyQuotaValue', { max: st.max })
})

function fmtMin (ms) {
  const n = Math.round((Number(ms) || 0) / 60000)
  return `${n} min`
}

async function load () {
  loading.value = true
  loadError.value = ''
  try {
    const res = await getPublishFrequencyPolicy()
    if (!res || res.code !== 0) {
      loadError.value = (res && res.message) || t('settings.publishFrequency.loadFailed')
      return
    }
    raw.value = res.data
    bounds.dailyMax = Number.isFinite(res.data && res.data.dailyMaxUpperBound)
      ? res.data.dailyMaxUpperBound : undefined
    bounds.intervalMinutes = Number.isFinite(res.data && res.data.intervalMaxMinutes)
      ? res.data.intervalMaxMinutes : undefined
    applyOverridesToForm(res.data)
    // 评审 i8：每日上限来自 publishFreq:emergencyStatus（getPolicy 不返回它）。
    // 此前只读 res.data.emergencyStatus ⇒ 该行恒显示「—」。取不到时保持 null，界面显示 —
    // （不编造一个数字糊弄用户）。
    try {
      const st = await getPublishEmergencyStatus()
      if (st && st.code === 0 && st.data) raw.value = { ...raw.value, emergencyStatus: st.data }
    } catch (e) {
      /* 状态取不到不影响策略展示，界面按 — 显示 */
    }
  } catch (e) {
    loadError.value = (e && e.message) || t('settings.publishFrequency.loadFailed')
  } finally {
    loading.value = false
  }
}

/** 严格数值归一：null / undefined / '' / 非数值一律返回 null。
 *  ⚠️ 不能用 `Number.isFinite(Number(v))` 判空 —— `Number(null) === 0`，会把「未填」
 *  当成 0 提交（评审 i3 的隐患本体：一次静默压平）。 */
function toNumOrNull (v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function applyOverridesToForm (data) {
  const ov = data && data.overrides && typeof data.overrides === 'object' ? data.overrides : {}
  const toMin = (ms) => {
    const n = toNumOrNull(ms)
    return n === null ? null : Math.round(n / 60000)
  }
  // ⚠️ 评审 i3：**无覆盖时不得回填「首个平台」的档位**。
  // 覆盖对象是**全局**的（accountMinMs 对所有平台生效），用 wechat_mp 的值回填会让用户
  // 「什么都不改直接保存」就把 short 档（3 分钟 / 20 条）静默压平成 20 分钟 / 3 条，
  // 还提示「已保存并立即生效」。故无覆盖即留空（null），由 buildPolicy 略过未填字段。
  form.accountMinutes = toMin(ov.accountMinMs)
  form.platformMinutes = toMin(ov.platformMinMs)
  const dm = ov.dailyMax && typeof ov.dailyMax === 'object' ? ov.dailyMax : {}
  form.dailyLong = toNumOrNull(dm.long)
  form.dailyClip = toNumOrNull(dm.clip)
  form.dailyShort = toNumOrNull(dm.short)
  form.jitterOn = ov.jitterRatio === undefined || ov.jitterRatio === null ? null : ov.jitterRatio > 0
}

/**
 * 组装覆盖对象：与主进程 resolvePolicyOverrides 的字段名逐一对应（不得自创字段名）。
 * **只提交用户真正填了的字段** —— 未填字段省略 = 该维度继续用各平台自己的默认档，
 * 这样「只改抖动」不会顺手把三档日配额也压成一个值（评审 i3）。全部未填 ⇒ 提交 null（清空覆盖）。
 */
function buildPolicy () {
  const policy = {}
  const acc = toNumOrNull(form.accountMinutes)
  if (acc !== null) policy.accountMinMs = Math.round(acc * 60000)
  const plat = toNumOrNull(form.platformMinutes)
  if (plat !== null) policy.platformMinMs = Math.round(plat * 60000)
  const daily = {}
  const dl = toNumOrNull(form.dailyLong)
  if (dl !== null) daily.long = Math.round(dl)
  const dc = toNumOrNull(form.dailyClip)
  if (dc !== null) daily.clip = Math.round(dc)
  const ds = toNumOrNull(form.dailyShort)
  if (ds !== null) daily.short = Math.round(ds)
  if (Object.keys(daily).length > 0) policy.dailyMax = daily
  if (form.jitterOn !== null && form.jitterOn !== undefined) policy.jitterRatio = form.jitterOn ? 0.4 : 0
  return Object.keys(policy).length > 0 ? policy : null
}

async function onSave () {
  saving.value = true
  try {
    const res = await setPublishFrequencyPolicy(buildPolicy())
    if (!res || res.code !== 0) {
      // 主进程是「全有或全无」判据的唯一真源：非法时它整体拒绝且不写库，此处如实回显
      ElMessage.error((res && res.message) || t('settings.publishFrequency.saveInvalid'))
      return
    }
    ElMessage.success(t('settings.publishFrequency.saveOk'))
    await load()
  } catch (e) {
    ElMessage.error((e && e.message) || t('settings.publishFrequency.saveInvalid'))
  } finally {
    saving.value = false
  }
}

async function onReset () {
  saving.value = true
  try {
    const res = await setPublishFrequencyPolicy(null)
    if (!res || res.code !== 0) {
      ElMessage.error((res && res.message) || t('settings.publishFrequency.saveInvalid'))
      return
    }
    ElMessage.success(t('settings.publishFrequency.resetOk'))
    await load()
  } catch (e) {
    ElMessage.error((e && e.message) || t('settings.publishFrequency.saveInvalid'))
  } finally {
    saving.value = false
  }
}

async function onEmergencyRelease () {
  try {
    await ElMessageBox.confirm(
      t('settings.publishFrequency.emergencyConfirm'),
      t('settings.publishFrequency.emergencyTitle'),
      { type: 'warning' },
    )
  } catch (_) {
    return // 用户取消：不执行、不提示（取消不是失败）
  }

  releasing.value = true
  emergencyResult.value = ''
  try {
    const res = await emergencyReleasePublishWait({
      platform: emergency.platform,
      accountId: emergency.accountId || null,
      reason: emergency.reason || undefined,
    })
    if (!res || res.code !== 0) {
      emergencyResultClass.value = 'is-error'
      emergencyResult.value = (res && res.message) || t('settings.publishFrequency.loadFailed')
      return
    }
    const d = res.data || {}
    if (d.released) {
      emergencyResultClass.value = 'is-ok'
      emergencyResult.value = t('settings.publishFrequency.emergencyOk')
      emergency.reason = ''
    } else {
      emergencyResultClass.value = 'is-warn'
      // 四态各自明确回显，不静默也不含糊
      const map = {
        exhausted: 'emergencyExhausted',
        cooldown: 'emergencyCooldown',
        no_waiting_window: 'emergencyNoWait',
        disabled: 'emergencyDisabled',
        no_guard: 'emergencyNoWait',
      }
      const key = map[d.reason] || 'emergencyNoWait'
      emergencyResult.value = t(
        `settings.publishFrequency.${key}`,
        { max: d.max, minutes: Math.max(1, Math.ceil((d.retryAfterMs || 0) / 60000)) },
      )
    }
    await load()
  } catch (e) {
    emergencyResultClass.value = 'is-error'
    emergencyResult.value = (e && e.message) || t('settings.publishFrequency.loadFailed')
  } finally {
    releasing.value = false
  }
}

onMounted(load)

// load / buildPolicy 是稳定的对外契约（供父组件刷新与复用）；
// emergency / form 仅为测试与诊断读取内部状态，**不属于**对外契约，勿在别处依赖。
defineExpose({ load, buildPolicy, emergency, form })
</script>

<style scoped>
.pubfreq { display: flex; flex-direction: column; gap: 16px; }
.pubfreq__title { margin: 0; font-size: var(--font-size-md); font-weight: 600; }
.pubfreq__subtitle { margin: 0; font-size: var(--font-size-base); font-weight: 600; }
.pubfreq__hint { margin: 0; font-size: var(--font-size-xs); color: var(--el-text-color-secondary); line-height: 1.6; }
.pubfreq__section { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.pubfreq__section--danger { border-color: var(--el-color-warning-light-5); }
.pubfreq__row { display: flex; gap: 10px; align-items: baseline; }
.pubfreq__label { min-width: 220px; font-size: var(--font-size-sm); color: var(--el-text-color-regular); }
.pubfreq__value { font-size: var(--font-size-sm); color: var(--el-text-color-primary); }
.pubfreq__field { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pubfreq__field-hint { font-size: var(--font-size-xs); color: var(--el-text-color-secondary); }
.pubfreq__actions { display: flex; gap: 10px; }
.pubfreq__result { margin: 0; font-size: var(--font-size-sm); }
.pubfreq__result.is-ok { color: var(--el-color-success); }
.pubfreq__result.is-warn { color: var(--el-color-warning); }
.pubfreq__result.is-error { color: var(--el-color-danger); }
</style>
