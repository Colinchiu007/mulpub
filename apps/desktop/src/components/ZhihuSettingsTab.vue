<template>
  <div class="zhihu-settings" data-testid="zhihu-settings">
    <!-- 标题 + 一句话说明 -->
    <div style="margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:8px">{{ t('knowledgeBase.zhihuApi') }}</div>
      <div style="font-size: var(--font-size-xs);color:var(--muted);margin-bottom:12px">{{ t('knowledgeBase.zhihuInstructions') }}</div>
    </div>

    <!-- 当前状态：已配置 / 未配置 / 已保存但无法读取（三态，绝不把「读不出」说成「未配置」） -->
    <div class="zhihu-status" data-testid="zhihu-status">
      <span
        class="zhihu-badge"
        :class="{ ok: state.readable, warn: state.configured && !state.readable }"
        data-testid="zhihu-status-badge"
      >{{ statusLabel }}</span>
      <span v-if="state.readable" class="zhihu-masked" data-testid="zhihu-masked-secret">{{ state.maskedSecret }}</span>
      <span v-if="state.readable && state.updatedAt" class="zhihu-meta">{{ t('knowledgeBase.zhihuUpdatedAt') }}：{{ formatTime(state.updatedAt) }}</span>
      <span v-if="state.readable" class="zhihu-meta">
        {{ t('knowledgeBase.zhihuVerifiedAt') }}：{{ state.verifiedAt ? formatTime(state.verifiedAt) : t('knowledgeBase.zhihuNeverVerified') }}
      </span>
    </div>

    <!-- 旧版明文迁移提示（只读兼容期的收口引导） -->
    <div v-if="state.legacyDetected" class="zhihu-notice" data-testid="zhihu-legacy-notice">
      {{ t('knowledgeBase.zhihuLegacyNotice') }}
    </div>
    <!-- 已保存但解不开（换机 / 系统凭据保护不可用） -->
    <div v-if="state.configured && !state.readable" class="zhihu-notice warn" data-testid="zhihu-unreadable-hint">
      {{ t('knowledgeBase.zhihuUnreadableHint') }}
    </div>

    <!-- Access Secret 输入（不回显已存明文；保存成功后立即清空） -->
    <div class="cohere-form-item" style="margin-top:12px">
      <label class="cohere-form-label">{{ t('knowledgeBase.zhihuSecretLabel') }}</label>
      <div style="display:flex;gap:8px">
        <input
          :type="showSecret ? 'text' : 'password'"
          v-model="secretInput"
          class="cohere-input"
          style="flex:1"
          :placeholder="t('knowledgeBase.zhihuSecretPlaceholder')"
          data-testid="zhihu-secret-input"
          autocomplete="off"
          spellcheck="false"
        />
        <button
          class="cohere-btn-ghost"
          style="font-size: var(--font-size-xs);padding:4px 8px"
          data-testid="zhihu-toggle-visibility"
          @click="showSecret = !showSecret"
        >{{ showSecret ? t('knowledgeBase.zhihuHide') : t('knowledgeBase.zhihuShow') }}</button>
      </div>
    </div>

    <!-- 三个动作：测试连接 / 保存配置 / 清除配置（两步确认） -->
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="cohere-btn-secondary" data-testid="zhihu-test" @click="testConnection" :disabled="testing || saving || clearing">
        {{ testing ? t('knowledgeBase.zhihuTesting') : t('knowledgeBase.zhihuTestConnection') }}
      </button>
      <button class="cohere-btn-primary" data-testid="zhihu-save" @click="saveConfig" :disabled="saving || testing || clearing">
        {{ saving ? t('knowledgeBase.zhihuSaving') : t('knowledgeBase.zhihuSaveConfig') }}
      </button>
      <template v-if="!confirmingClear">
        <button
          class="cohere-btn-ghost"
          data-testid="zhihu-clear"
          :disabled="clearing || saving || testing || !state.configured"
          @click="confirmingClear = true"
        >{{ t('knowledgeBase.zhihuClearConfig') }}</button>
      </template>
      <template v-else>
        <button class="cohere-btn-danger" data-testid="zhihu-clear-confirm" :disabled="clearing" @click="clearConfig">
          {{ clearing ? t('knowledgeBase.zhihuClearing') : t('knowledgeBase.zhihuClearConfirm') }}
        </button>
        <button class="cohere-btn-ghost" data-testid="zhihu-clear-cancel" :disabled="clearing" @click="confirmingClear = false">
          {{ t('knowledgeBase.zhihuClearCancel') }}
        </button>
      </template>
    </div>

    <!-- 动作结果（成功/失败两态一律走语义令牌，暗色模式同步生效） -->
    <div
      v-if="statusMsg"
      class="zhihu-msg"
      :class="statusOk ? 'ok' : 'err'"
      data-testid="zhihu-status-msg"
    >{{ statusMsg }}</div>

    <!-- 使用说明 -->
    <div style="margin-top:24px;padding:12px;background:var(--soft-stone);border-radius:8px;font-size: var(--font-size-xs);color:var(--muted);line-height:1.8">
      <div style="font-weight:600;margin-bottom:4px;color:var(--text-primary)">{{ t('knowledgeBase.zhihuInstructions') }}：</div>
      <div>{{ t('knowledgeBase.zhihuInstrLine1') }}</div>
      <div>{{ t('knowledgeBase.zhihuInstrLine2') }}</div>
      <div>{{ t('knowledgeBase.zhihuInstrLine3') }}</div>
      <div>{{ t('knowledgeBase.zhihuInstrLine4') }}</div>
      <div>{{ t('knowledgeBase.zhihuInstrLine5') }}</div>
    </div>
  </div>
</template>

<script setup>
/**
 * ZhihuSettingsTab — 设置 → 知乎 API
 *
 * 采集页「知乎收藏文章」用的开放平台 Access Secret 在这里配置。三条产品约束：
 *   ① **每个用户自己的**：密钥落在本机安全存储、按登录身份隔离，不进代码、不进安装包；
 *   ② **明文不回显**：本组件从不把已存密钥填进输入框（只显示首 4/末 4 位遮罩），
 *      保存成功后立刻清空输入框，避免明文长时间停留在 DOM 里；
 *   ③ **不做假成功**：保存/测试/清除的结论一律以主进程返回的 code 为准，
 *      失败时把主进程给出的原因原样展示（它比前端更清楚是密钥错、配额错还是系统凭据不可用）。
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi } from '@/api/electron-bridge'

const { t } = useI18n()

const state = ref({
  configured: false,
  readable: false,
  maskedSecret: '',
  updatedAt: null,
  verifiedAt: null,
  favlistCount: null,
  legacyDetected: false,
  source: 'none',
})
const secretInput = ref('')
const showSecret = ref(false)
const testing = ref(false)
const saving = ref(false)
const clearing = ref(false)
const confirmingClear = ref(false)
const statusMsg = ref('')
const statusOk = ref(true)

const statusLabel = computed(() => {
  if (state.value.configured && !state.value.readable) return t('knowledgeBase.zhihuStatusUnreadable')
  return state.value.readable ? t('knowledgeBase.zhihuStatusConfigured') : t('knowledgeBase.zhihuStatusNotConfigured')
})

function setStatus (msg, ok) {
  statusMsg.value = msg
  statusOk.value = ok
}

/** 本地时间展示（只用于「保存时间/最近验证」，精确到分钟即可） */
function formatTime (iso) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return ''
  }
}

/** 权限拦截（未登录/未激活）与网络异常分开说：前者用户能自己解决，后者不能 */
function describeError (e) {
  const msg = (e && e.message) ? e.message : String(e || '')
  if ((e && e.name === 'LicensePermissionError') || /许可证权限不足|LicensePermissionError/.test(msg)) {
    return t('knowledgeBase.zhihuPermissionDenied')
  }
  return msg
}

async function refresh () {
  const api = getApi()
  if (!api || typeof api.zhihuGetConfig !== 'function') return
  try {
    const res = await api.zhihuGetConfig()
    if (res && res.code === 0 && res.data) {
      state.value = { ...state.value, ...res.data }
      return
    }
    // 非 0（许可证 / 未登录 / 发送方校验）也要出声：静默会把「无权读」渲染成「未配置」，
    // 用户于是反复重配而问题不在密钥（QM-6 评审 MINOR，与采集页 MAJOR #2 同根）
    setStatus(describeError(new Error(res && res.message ? String(res.message) : t('knowledgeBase.zhihuConfigReadFailed'))), false)
  } catch (e) {
    // 读取失败按「未配置」渲染，但把原因留在状态行（不冒充成功、也不崩页面）
    setStatus(describeError(e), false)
  }
}

async function testConnection () {
  const api = getApi()
  if (!api || typeof api.zhihuTestConnection !== 'function') return
  testing.value = true
  statusMsg.value = ''
  try {
    const typed = secretInput.value.trim()
    const res = await api.zhihuTestConnection(typed ? typed : undefined)
    if (res && res.code === 0 && res.data && res.data.ok) {
      const count = Number.isFinite(res.data.favlistCount) ? res.data.favlistCount : 0
      setStatus(t('knowledgeBase.zhihuTestSuccess') + ' ' + String(count), true)
      await refresh()
    } else {
      setStatus(t('knowledgeBase.zhihuTestFailed') + '：' + ((res && res.message) || ''), false)
    }
  } catch (e) {
    setStatus(t('knowledgeBase.zhihuTestFailed') + '：' + describeError(e), false)
  } finally {
    testing.value = false
  }
}

async function saveConfig () {
  const api = getApi()
  if (!api || typeof api.zhihuSaveConfig !== 'function') return
  const typed = secretInput.value.trim()
  if (!typed) {
    setStatus(t('knowledgeBase.zhihuSecretRequired'), false)
    return
  }
  saving.value = true
  statusMsg.value = ''
  try {
    const res = await api.zhihuSaveConfig(typed)
    if (res && res.code === 0) {
      // 明文用完即弃：清空输入框，只留遮罩
      secretInput.value = ''
      setStatus(t('knowledgeBase.zhihuSaveSuccess'), true)
      await refresh()
    } else {
      setStatus(t('knowledgeBase.zhihuSaveFailed') + '：' + ((res && res.message) || ''), false)
    }
  } catch (e) {
    setStatus(t('knowledgeBase.zhihuSaveFailed') + '：' + describeError(e), false)
  } finally {
    saving.value = false
  }
}

async function clearConfig () {
  const api = getApi()
  if (!api || typeof api.zhihuClearConfig !== 'function') return
  clearing.value = true
  statusMsg.value = ''
  try {
    const res = await api.zhihuClearConfig()
    if (res && res.code === 0 && res.data && res.data.cleared) {
      setStatus(t('knowledgeBase.zhihuClearSuccess'), true)
      await refresh()
    } else {
      setStatus(t('knowledgeBase.zhihuClearFailed') + '：' + ((res && res.message) || ''), false)
    }
  } catch (e) {
    setStatus(t('knowledgeBase.zhihuClearFailed') + '：' + describeError(e), false)
  } finally {
    clearing.value = false
    confirmingClear.value = false
  }
}

onMounted(refresh)
</script>

<style scoped>
/* 设计系统只全局定义了 primary/secondary；ghost 与 danger 在本仓是**各组件自带**的
   （先例：PersonalKnowledgePanel.vue / ModelProviders.vue）。这里显式自带一份，
   不做「引用了不存在的全局类」那种看起来有样式、实际裸奔的写法。 */
.cohere-btn-ghost {
  padding: 4px 8px;
  background: none;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--text-primary);
}

.cohere-btn-ghost:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.cohere-btn-danger {
  padding: 8px 20px;
  background: var(--color-danger);
  color: var(--color-bg-card);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.cohere-btn-danger:hover {
  filter: brightness(0.9);
}

.cohere-btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.zhihu-msg {
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: var(--font-size-xs);
}

.zhihu-msg.ok {
  color: var(--color-success);
  background: var(--color-success-soft);
}

.zhihu-msg.err {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

.zhihu-status {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: var(--font-size-xs);
}

.zhihu-badge {
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--border-light, #eee);
  color: var(--text-muted, #707080);
  font-weight: 500;
}

.zhihu-badge.ok {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.zhihu-badge.warn {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.zhihu-masked {
  font-family: var(--font-mono, monospace);
  color: var(--text-primary);
  letter-spacing: 0.5px;
}

.zhihu-meta {
  color: var(--muted);
}

.zhihu-notice {
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: var(--font-size-xs);
  background: var(--soft-stone, #f5f5f5);
  color: var(--text-primary);
}

.zhihu-notice.warn {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}
</style>
