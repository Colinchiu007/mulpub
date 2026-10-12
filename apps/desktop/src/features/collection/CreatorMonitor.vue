<script setup>
/**
 * CreatorMonitor.vue —「博主监控」tab
 *
 * 两个列表：
 *   · 博主列表：关注状态、能力徽章、待采集角标、暂停/恢复、立即检查
 *   · 发现列表：新作品、内容质量徽章、单条采集、送入 AI 写作
 *
 * 交互上的三条硬规则（与主进程一致，此处只做呈现）：
 *   1. 超限时**弹提示**，不静默截断；采集成功后若有剩余 MUST 告知剩余数
 *   2. 已采集项按钮置灰并显示时间 —— 状态持久，刷新不丢
 *   3. 单条采集零填参；批量走默认数量（一键 5 / 手动 50）
 *
 * ## 2026-10-12 修复：三条「用户看得见的错话」与本文件的关系
 *
 * ① **整页只有一句「缺少采集依赖。请执行：」**（命令位恒空）。
 *    真因在主进程（`phase5-ipc.js` 用了一个不存在的 `context.get`，加上
 *    `creatorCredentialProvider` 从未注册 ⇒ 11 个 creator 通道全部降级 ⇒
 *    `reason: 'service-unavailable'`）。但渲染层也有一半责任：它把
 *    「服务没起来」错误地渲染成「缺少采集依赖」。两件事的处置完全不同
 *    （重启应用 vs 装 Python 包），因此现在**按 reason 分因**：
 *    `service-unavailable` → `creatorErrServiceUnavailable`（不谈依赖）；
 *    真正的可选依赖缺失 → `creatorDependencyOptionalHint`（带确切命令、非阻塞）。
 *
 * ② **「关注」按钮点了没反应**。旧实现用 `window.prompt()` —— Electron 渲染进程
 *    不支持 `window.prompt`（调用即抛 `prompt() is and will not be supported`），
 *    于是添加博主这条路**整条不存在**。现改为应用内弹窗
 *    （`CreatorAddDialog.vue`，与同页 `QuickCollectCommandDialog.vue` 同构）。
 *
 * ③ **没有地方填 YouTube API Key**。旧文案让用户「请在设置中填写」，而设置页
 *    从没有这个字段 ⇒ 死路。现补 `CreatorCredentialDialog.vue`（PRD §7.4 的四态：
 *    未配置 / 密钥库不可用 / 解密失败 / 已配置），本文件只负责横幅与开合。
 *
 * 浮层形态与同页 `QuickCollectCommandDialog.vue` 保持一致：手写 mask + `role="dialog"`。
 * 该页不承载 `WebContentsView` 内嵌网页，故不适用「浮层互斥挂起」契约
 * （同页快捷采集弹窗先例一致；契约的判据是「浮层会被原生图层盖住」，此处不存在该前提）。
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import CreatorAddDialog from './CreatorAddDialog.vue'
import CreatorCredentialDialog from './CreatorCredentialDialog.vue'

const { t } = useI18n()

const creators = ref([])
const totalPending = ref(0)
const loading = ref(false)
const collecting = ref(false)
const activeCreatorId = ref(null)
const discoveries = ref([])
const discovering = ref(false)
/** 阻塞态文案：只有「主进程 creator 服务未就绪」才会走到这里 */
const degraded = ref('')
/** 凭证四态：{ status, fingerprint? }；null = 尚未取到 */
const credential = ref(null)
/** 依赖状态：{ discovery:{ready}, transcript:{ready,optional,reason,installHint} } */
const dependency = ref(null)
/** 添加博主弹窗 */
const addVisible = ref(false)
const addSubmitting = ref(false)
const addError = ref('')
/** 凭证弹窗 */
const credentialVisible = ref(false)

/** 取 IPC 桥。preload 可能尚未就绪或方法缺失——此时 MUST 给出明确降级态，
 *  而不是让 onMounted 抛出未捕获异常（那会变成「静默白屏 + 控制台报错」）。 */
function api () {
  const bridge = globalThis.electronAPI
  if (!bridge || typeof bridge.creatorList !== 'function') return null
  return bridge
}

/** 统一吞掉调用期异常并转成降级提示；调用方不需要各自 try/catch */
async function call (fnName, payload) {
  const bridge = api()
  if (!bridge || typeof bridge[fnName] !== 'function') {
    degraded.value = t('collection.creatorErrServiceUnavailable')
    return null
  }
  try {
    return await bridge[fnName](payload)
  } catch (e) {
    degraded.value = (e && e.message) || t('collection.creatorErrCollectFailed', { message: '' })
    return null
  }
}

/** 领域 reason → 可操作文案。查表而非拼接，避免出现「命令位为空」那类半句话。 */
function followErrorText (reason) {
  switch (reason) {
  case 'creator:invalid_input': return t('collection.creatorErrInvalidInput')
  case 'creator:not_a_channel': return t('collection.creatorErrNotAChannel')
  case 'creator:channel_not_found': return t('collection.creatorErrChannelNotFound')
  case 'creator:credential_missing': return t('collection.creatorErrCredentialMissing')
  default: return ''
  }
}

/** IPC 统一返回 { code, reason, message }；非 0 一律走错误分支，
 *  绝不在前端凭「没抛异常」当作成功——降级返回也长这样。 */
function failFast (r) {
  if (r === null) return true          // 调用层已置降级态
  if (!r || r.code !== 0) {
    const reason = r && r.reason
    if (reason === 'service-unavailable') {
      // 只谈「服务没起来」。**不得**在这里渲染「缺少采集依赖」——
      // 那会把用户引向一条与真因无关的排查路径（2026-10-12 事故）。
      degraded.value = t('collection.creatorErrServiceUnavailable')
      return true
    }
    if (reason === 'creator:credential_missing') {
      ElMessage.error(t('collection.creatorErrCredentialMissing'))
      credentialVisible.value = true
      return true
    }
    ElMessage.error((r && r.message) || t('collection.creatorErrCollectFailed', { message: '' }))
    return true
  }
  return false
}

async function loadCreators () {
  loading.value = true
  try {
    const r = await call('creatorList')
    if (failFast(r)) return
    creators.value = r.items || []
    totalPending.value = r.totalPending || 0
    degraded.value = ''
    if (!activeCreatorId.value && creators.value.length) {
      activeCreatorId.value = creators.value[0].id
      await loadDiscoveries()
    }
  } finally {
    loading.value = false
  }
}

async function loadDiscoveries () {
  if (!activeCreatorId.value) { discoveries.value = []; return }
  discovering.value = true
  try {
    const r = await call('creatorDiscoveries', { creatorId: activeCreatorId.value, state: 'pending' })
    if (failFast(r)) return
    discoveries.value = r.items || []
  } finally {
    discovering.value = false
  }
}

/** 凭证状态：只读，**永不**含明文（主进程侧也不回传） */
async function loadCredential () {
  const r = await call('creatorCredentialStatus')
  if (r === null) return
  credential.value = r && r.code === 0 ? { status: r.status, fingerprint: r.fingerprint, reason: r.reason } : null
}

/** 依赖状态：发现腿（阻塞）与正文腿（可选、非阻塞）分开 */
async function loadDependency () {
  const r = await call('creatorDependencyStatus')
  if (r === null) return
  dependency.value = r && r.code === 0 ? { discovery: r.discovery, transcript: r.transcript } : null
}

/** 打开添加弹窗（旧实现是 window.prompt —— Electron 不支持，等于这条路径不存在） */
function openAddDialog () {
  addError.value = ''
  addVisible.value = true
}

async function submitAdd (rawInput) {
  const input = String(rawInput || '').trim()
  if (!input) return
  addSubmitting.value = true
  addError.value = ''
  try {
    const r = await call('creatorFollow', { input })
    if (r === null) { addError.value = degraded.value; return }
    if (!r || r.code !== 0) {
      if (r && r.reason === 'service-unavailable') {
        degraded.value = t('collection.creatorErrServiceUnavailable')
        addError.value = degraded.value
        return
      }
      if (r && r.reason === 'creator:credential_missing') {
        // 没配 Key 时解析不了频道：直接把凭证弹窗推到用户面前，而不是让他自己找
        credentialVisible.value = true
        addError.value = t('collection.creatorErrCredentialMissing')
        return
      }
      addError.value = followErrorText(r && r.reason) || (r && r.message) || t('collection.creatorErrCollectFailed', { message: '' })
      return
    }
    const name = (r.creator && (r.creator.display_name || r.creator.external_id)) || input
    addVisible.value = false
    ElMessage.success(t('collection.creatorAddSuccess', { name }))
    activeCreatorId.value = r.creator && r.creator.id
    // PRD §8.1：关注成功后**立即首次探测**（fetch_transcript=false），
    // 否则用户要等到下一个巡检周期才看到新作品，会以为「加了没用」。
    if (r.follow && r.follow.id) {
      await call('creatorCheckNow', { followId: r.follow.id })
    }
    await loadCreators()
    await loadDiscoveries()
  } finally {
    addSubmitting.value = false
  }
}

async function unfollow (c) {
  await ElMessageBox.confirm(t('collection.creatorUnfollow'), '', { type: 'warning' })
  const r = await call('creatorUnfollow', { followId: c.follow_id || c.id })
  if (failFast(r)) return
  await loadCreators()
}

async function togglePause (c) {
  const r = await call('creatorToggle', { followId: c.follow_id || c.id, enabled: !c.enabled })
  if (failFast(r)) return
  await loadCreators()
}

async function checkNow (c) {
  const r = await call('creatorCheckNow', { followId: c.follow_id || c.id })
  if (failFast(r)) return
  ElMessage.success(t('collection.creatorBatchSuccess', { collected: r.inserted || 0 }))
  await loadCreators()
  await loadDiscoveries()
}

/** 一键采集：默认数量由主进程决定（oneClick=5），超限时主进程拒绝并回 max */
async function collectAll () {
  if (!activeCreatorId.value) return
  const c = creators.value.find(x => x.id === activeCreatorId.value)
  collecting.value = true
  try {
    const r = await call('creatorCollect', { followId: (c && (c.follow_id || c.id)) })
    if (r && r.reason === 'creator:count_exceeds_limit') {
      ElMessage.warning(t('collection.creatorErrCountExceedsLimit', { max: r.max }))
      return
    }
    if (failFast(r)) return
    ElMessage.success(t('collection.creatorBatchSuccess', { collected: r.collected || 0 }))
    // MUST 告知剩余，不静默截断
    if (r.truncated && r.remain > 0) {
      ElMessage.info(t('collection.creatorTruncated', {
        found: r.available, collected: r.collected, remain: r.remain,
      }))
    }
    await loadCreators()
    await loadDiscoveries()
  } finally {
    collecting.value = false
  }
}

/** 单条采集：零填参，不受数量上限约束 */
async function collectOne (d) {
  const r = await call('creatorCollectOne', { discoveryId: d.id })
  if (failFast(r)) return
  ElMessage.success(t('collection.creatorBatchSuccess', { collected: 1 }))
  await loadCreators()
  await loadDiscoveries()
}

/** 凭证保存成功后：刷新状态 + 重试一次列表（此前的失败多半就是因为没 Key） */
async function onCredentialSaved () {
  await loadCredential()
  await loadCreators()
}

const hasDiscoveries = computed(() => discoveries.value.length > 0)

/** 凭证横幅：主进程未就绪时不显示（那条信息由 degraded 横幅承担，避免两条自相矛盾） */
const credentialBannerKey = computed(() => {
  const c = credential.value
  if (!c) return ''
  if (c.status === 'ok') return ''
  if (c.status === 'unavailable' && c.reason === 'credential-service-unavailable') return ''
  if (c.status === 'not_configured') return 'collection.creatorCredentialStatusNotConfigured'
  if (c.status === 'unavailable') return 'collection.creatorCredentialStatusUnavailable'
  if (c.status === 'decrypt_failed') return 'collection.creatorCredentialStatusDecryptFailed'
  if (c.status === 'read_failed') return 'collection.creatorCredentialStatusReadFailed'
  return ''
})

/** 正文腿缺依赖：**非阻塞**提示，带确切命令（PRD §16 禁止静默降级） */
const transcriptHint = computed(() => {
  const d = dependency.value
  if (!d || !d.transcript || d.transcript.ready) return ''
  return t('collection.creatorDependencyOptionalHint', { command: d.transcript.installHint || '' })
})

/**
 * 能力徽章与质量徽章的文案映射。
 * **必须用查表而非字符串拼接**：拼接出来的 key 对 check-locale-sync.js --keys
 * 不可静态解析，会被判成「zh/en 缺失该 key」而使 Gate 7 变红（QG Static 曾因此失败）。
 * 注意该检查器扫描的是**整个文件文本**，所以连注释里也不能出现拼接形式的 key 片段
 * ——否则同样会被提取。查表让每个 key 都以字面量出现，一眼可校验。
 */
const CAP_LABEL_KEY = {
  official: 'collection.creatorCapOfficial',
  best_effort: 'collection.creatorCapBestEffort',
  unsupported: 'collection.creatorCapUnsupported',
}
const QUALITY_LABEL_KEY = {
  full: 'collection.creatorQualityFull',
  partial: 'collection.creatorQualityPartial',
  stub: 'collection.creatorQualityStub',
}
const capKey = (tier) => CAP_LABEL_KEY[tier] || CAP_LABEL_KEY.best_effort
const qualityKey = (q) => QUALITY_LABEL_KEY[q] || QUALITY_LABEL_KEY.stub

onMounted(async () => {
  await loadCreators()
  await loadCredential()
  await loadDependency()
})
defineExpose({ loadCreators, loadDiscoveries, loadCredential, loadDependency })
</script>

<template>
  <div class="creator-monitor" data-testid="creator-monitor">
    <div v-if="degraded" class="creator-degraded" data-testid="creator-degraded">
      <span>{{ degraded }}</span>
      <button class="cohere-btn-secondary" data-testid="creator-retry" @click="loadCreators">
        {{ $t('collection.creatorRetry') }}
      </button>
    </div>

    <!-- 凭证四态横幅：只在非 ok 且服务已就绪时出现 -->
    <div v-if="credentialBannerKey" class="creator-credential-banner" data-testid="creator-credential-banner">
      <span data-testid="creator-credential-status-text">{{ $t(credentialBannerKey) }}</span>
      <button class="cohere-btn-secondary" data-testid="creator-credential-open" @click="credentialVisible = true">
        {{ $t('collection.creatorCredentialOpen') }}
      </button>
    </div>

    <!-- 正文腿缺依赖：非阻塞，仅告知（发现与采集不受影响） -->
    <p v-if="transcriptHint" class="creator-dependency-hint" data-testid="creator-dependency-hint">
      {{ transcriptHint }}
    </p>

    <!-- 博主列表 -->
    <section class="creator-panel">
      <header class="creator-panel-head">
        <h3>{{ $t('collection.creatorListTitle') }}</h3>
        <button class="cohere-btn-secondary" data-testid="creator-add" @click="openAddDialog">
          {{ $t('collection.creatorAddSubmit') }}
        </button>
      </header>

      <p v-if="!loading && creators.length === 0" class="creator-empty" data-testid="creator-empty">
        <strong>{{ $t('collection.creatorEmptyTitle') }}</strong>
        <span>{{ $t('collection.creatorEmptyDesc') }}</span>
      </p>

      <ul v-else class="creator-list" data-testid="creator-list">
        <li
          v-for="c in creators"
          :key="c.id"
          class="creator-item"
          :class="{ active: c.id === activeCreatorId, disabled: c.enabled === 0 }"
          :data-testid="'creator-item-' + c.id"
          @click="activeCreatorId = c.id; loadDiscoveries()"
        >
          <img v-if="c.avatar_url" class="creator-avatar" :src="c.avatar_url" alt="" />
          <div class="creator-meta">
            <span class="creator-name">{{ c.display_name || c.external_id }}</span>
            <span class="creator-badge" :data-tier="c.capability_tier">
              {{ $t(capKey(c.capability_tier)) }}
            </span>
            <span v-if="c.status === 'fatal_paused' || c.status === 'auto_paused'" class="creator-paused">
              {{ $t(c.status === 'fatal_paused' ? 'collection.creatorFatalPaused' : 'collection.creatorAutoPaused',
                     { times: c.consecutive_failures || 0, reason: c.paused_reason || '' }) }}
            </span>
          </div>
          <span v-if="c.pendingCount > 0" class="creator-badge-num" data-testid="creator-pending">
            {{ $t('collection.creatorPendingBadge', { count: c.pendingCount }) }}
          </span>
          <div class="creator-actions" @click.stop>
            <button data-testid="creator-check-now" @click="checkNow(c)">
              {{ $t('collection.creatorCheckNow') }}
            </button>
            <button data-testid="creator-toggle" @click="togglePause(c)">
              {{ $t(c.enabled === 0 ? 'collection.creatorResume' : 'collection.creatorPause') }}
            </button>
            <button data-testid="creator-unfollow" @click="unfollow(c)">
              {{ $t('collection.creatorUnfollow') }}
            </button>
          </div>
        </li>
      </ul>
    </section>

    <!-- 发现列表 -->
    <section class="creator-panel">
      <header class="creator-panel-head">
        <h3>{{ $t('collection.creatorTab') }}</h3>
        <button
          class="cohere-btn-primary"
          data-testid="creator-collect-all"
          :disabled="collecting || !hasDiscoveries"
          @click="collectAll"
        >
          {{ collecting ? '…' : $t('collection.creatorCollectNew') }}
        </button>
      </header>

      <p v-if="!discovering && discoveries.length === 0" class="creator-empty" data-testid="creator-no-new">
        {{ $t('collection.creatorNoNewWorks', { interval: '60' }) }}
      </p>

      <ul v-else class="creator-discoveries" data-testid="creator-discoveries">
        <li v-for="d in discoveries" :key="d.id" class="creator-discovery" :data-testid="'discovery-' + d.id">
          <img v-if="d.thumbnail_url" class="creator-thumb" :src="d.thumbnail_url" alt="" />
          <div class="creator-meta">
            <span class="creator-title">{{ d.title }}</span>
            <span class="creator-quality" :data-quality="d.content_quality">
              {{ $t(qualityKey(d.content_quality)) }}
            </span>
          </div>
          <div class="creator-actions">
            <button
              v-if="d.collect_state === 'pending'"
              data-testid="creator-collect-one"
              @click="collectOne(d)"
            >
              {{ $t('collection.creatorCollectOne') }}
            </button>
            <span v-else class="creator-collected" data-testid="creator-collected">
              {{ $t('collection.creatorCollectedAt', { time: d.collected_at || '' }) }}
            </span>
          </div>
        </li>
      </ul>
    </section>

    <CreatorAddDialog
      v-model:visible="addVisible"
      :submitting="addSubmitting"
      :error="addError"
      @submit="submitAdd"
    />
    <CreatorCredentialDialog
      v-model:visible="credentialVisible"
      :status="credential"
      @saved="onCredentialSaved"
    />
  </div>
</template>

<style scoped>
.creator-monitor { display: flex; flex-direction: column; gap: 16px; }
.creator-panel { border: 1px solid var(--border, #e5e7eb); border-radius: 8px; padding: 12px; }
.creator-panel-head { display: flex; justify-content: space-between; align-items: center; }
.creator-list, .creator-discoveries { list-style: none; margin: 8px 0 0; padding: 0; }
.creator-item, .creator-discovery { display: flex; gap: 12px; align-items: center; padding: 8px; border-bottom: 1px solid var(--border, #f3f4f6); cursor: pointer; }
.creator-item.active { background: var(--el-fill-color-light, #f5f7fa); }
.creator-item.disabled { opacity: 0.6; }
.creator-avatar, .creator-thumb { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; }
.creator-meta { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.creator-name, .creator-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.creator-badge, .creator-quality, .creator-badge-num, .creator-collected { font-size: var(--font-size-xs); }
.creator-paused { color: var(--el-color-danger, #f56c6c); font-size: var(--font-size-xs); }
.creator-degraded { display: flex; gap: 8px; align-items: center; padding: 8px; border: 1px solid var(--el-color-warning, #e6a23c); border-radius: 4px; }
.creator-credential-banner { display: flex; gap: 8px; align-items: center; padding: 8px; border: 1px solid var(--el-color-info, #909399); border-radius: 4px; }
.creator-dependency-hint { margin: 0; color: var(--el-text-color-secondary, #909399); font-size: var(--font-size-xs); }
.creator-empty { display: flex; flex-direction: column; gap: 4px; color: var(--el-text-color-secondary, #909399); }
.creator-actions { display: flex; gap: 8px; }
</style>
