<script setup>
/**
 * CreatorMonitor.vue —「博主监控」tab
 *
 * 两个列表：博主列表（关注/能力徽章/待采集角标/暂停恢复/立即检查）+ 发现列表
 * （新作品/质量徽章/单条采集/送入 AI 写作）。三条硬规则与主进程一致：超限弹提示不静默截断、
 * 已采集状态持久、单条采集零填参。
 *
 * 文案映射（凭证横幅 / follow 错误分因 / 平台 label / 依赖提示）全部在
 * `creator-monitor-copy.js`（纯函数，check-max-lines 拆分产物 + 可独立单测）。
 *
 * 历史（2026-10-12 两轮修复的锚点，详见 PRD §17 与 PRD-CREATOR-MULTI-PLATFORM）：
 * ① `service-unavailable` 与「可选依赖缺失」按 reason 分因，不得共用一句话；
 * ② 添加博主 MUST 走应用内弹窗（Electron 渲染进程不支持 window.prompt）；
 * ③ 凭证四态 + read_failed 有专门文案与配置入口，不指向不存在的设置项。
 *
 * 浮层形态与同页 `QuickCollectCommandDialog.vue` 一致：手写 mask + `role="dialog"`；
 * 该页不承载 `WebContentsView`，不适用「浮层互斥挂起」契约（同页先例一致）。
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import CreatorAddDialog from './CreatorAddDialog.vue'
import {
  credentialBannerKey as credentialBannerKeyOf,
  followErrorKey,
  followErrorKeyWithPlatform,
  platformLocaleKey,
  transcriptHintText,
  platformLabelOf,
} from './creator-monitor-copy'
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
/** 平台清单（creator:platforms）：{ id,label,supported,hasSession }[] */
const platforms = ref([])
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

function platformLabel (id) {
  const p = (platforms.value || []).find((x) => x.id === id)
  if (p && p.label) return p.label
  const key = platformLocaleKey(id)
  return key ? t(key) : id
}

/** 领域 reason → 文案（查表逻辑在 creator-monitor-copy.js，本层只做 t() 与平台名注入） */
function followErrorText (reason, platform) {
  const key = followErrorKey(reason) || followErrorKeyWithPlatform(reason)
  return key ? t(key, { platform: platformLabel(platform || 'youtube') }) : ''
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

async function submitAdd (form) {
  // 多平台（PRD §5.1）：弹窗回传 { input, platform }；旧测试直接传字符串则按 youtube
  const isString = typeof form === 'string'
  const input = String(isString ? form : (form && form.input) || '').trim()
  const platform = isString ? 'youtube' : ((form && form.platform) || 'youtube')
  if (!input) return
  addSubmitting.value = true
  addError.value = ''
  try {
    const r = await call('creatorFollow', { input, platform })
    if (r === null) { addError.value = degraded.value; return }
    if (!r || r.code !== 0) {
      if (r && r.reason === 'service-unavailable') {
        degraded.value = t('collection.creatorErrServiceUnavailable')
        addError.value = degraded.value
        return
      }
      if (r && r.reason === 'creator:credential_missing') {
        // 多平台：缺的是「平台登录态」（抖音/小红书去账号管理登录；YouTube 打开凭证弹窗）
        if (platform === 'youtube') credentialVisible.value = true
        addError.value = platform === 'youtube'
          ? t('collection.creatorErrCredentialMissing')
          : t('collection.creatorErrCredentialMissingForPlatform', { platform: platformLabel(platform) })
        return
      }
      addError.value = followErrorText(r && r.reason, platform) || (r && r.message) || t('collection.creatorErrCollectFailed', { message: '' })
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

/** 凭证横幅（映射表在 creator-monitor-copy.js） */
const credentialBannerKey = computed(() => credentialBannerKeyOf(credential.value))

/** 正文腿缺依赖：非阻塞提示（拼装在 creator-monitor-copy.js） */
const transcriptHint = computed(() => transcriptHintText(dependency.value, t))

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
  await loadPlatforms()
})
defineExpose({ loadCreators, loadDiscoveries, loadCredential, loadDependency, loadPlatforms })

/** 平台清单 + 各平台登录态（添加弹窗的平台选择与未登录提示的数据源） */
async function loadPlatforms () {
  const r = await call('creatorPlatforms')
  if (r === null) return
  if (r && r.code === 0 && Array.isArray(r.platforms)) platforms.value = r.platforms
}
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
            <span class="creator-name">
              <!-- 平台徽标（PRD §7）：多平台列表混排时必须一眼可分 -->
              <span class="creator-platform-tag" :data-testid="'creator-platform-' + (c.platform || 'youtube')" :data-platform="c.platform || 'youtube'">
                {{ platformLabel(c.platform || 'youtube') }}
              </span>
              {{ c.display_name || c.external_id }}
            </span>
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
      :platforms="platforms"
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
.creator-platform-tag {
  display: inline-block;
  padding: 0 6px;
  margin-right: 6px;
  border: 1px solid var(--border, #dcdfe6);
  border-radius: 4px;
  font-size: var(--font-size-xs);
  font-weight: 400;
  vertical-align: middle;
}
.creator-badge, .creator-quality, .creator-badge-num, .creator-collected { font-size: var(--font-size-xs); }
.creator-paused { color: var(--el-color-danger, #f56c6c); font-size: var(--font-size-xs); }
.creator-degraded { display: flex; gap: 8px; align-items: center; padding: 8px; border: 1px solid var(--el-color-warning, #e6a23c); border-radius: 4px; }
.creator-credential-banner { display: flex; gap: 8px; align-items: center; padding: 8px; border: 1px solid var(--el-color-info, #909399); border-radius: 4px; }
.creator-dependency-hint { margin: 0; color: var(--el-text-color-secondary, #909399); font-size: var(--font-size-xs); }
.creator-empty { display: flex; flex-direction: column; gap: 4px; color: var(--el-text-color-secondary, #909399); }
.creator-actions { display: flex; gap: 8px; }
</style>
