<template>
  <div class="cohere-card col-panel">
    <div class="cohere-section-title col-section-title">{{ $t('collection.batchCollectTitle') }}</div>

    <!-- RSS 批量采集（默认展开组） -->
    <div class="col-block">
      <button
        type="button"
        class="col-group-title"
        data-testid="batch-group-title-rss"
        :aria-expanded="expandedBatch === 'rss'"
        aria-controls="batch-panel-rss"
        @click="expandBatch('rss')"
      >{{ $t('collection.rssBatch') }}</button>
      <div v-show="expandedBatch === 'rss'" id="batch-panel-rss" class="zb-panel">
        <div class="col-source-row">
          <input
            v-model="rssUrl"
            :placeholder="$t('collection.rssPlaceholder')"
            class="col-input col-input--grow"
          />
          <button class="cohere-btn-primary" @click="collectBatch('rss')" :disabled="batchCollecting">
            {{ batchCollecting ? $t('collection.batchCollecting') : $t('collection.batchCollect') }}
          </button>
        </div>
      </div>
    </div>

    <!-- URL 列表批量采集 -->
    <div class="col-block">
      <button
        type="button"
        class="col-group-title"
        data-testid="batch-group-title-urllist"
        :aria-expanded="expandedBatch === 'urlList'"
        aria-controls="batch-panel-urllist"
        @click="expandBatch('urlList')"
      >{{ $t('collection.urlListBatch') }}</button>
      <div v-show="expandedBatch === 'urlList'" id="batch-panel-urllist" class="zb-panel">
        <textarea
          v-model="urlListInput"
          :placeholder="$t('collection.urlListPlaceholder')"
          rows="3"
          class="col-input col-input--block col-textarea"
        ></textarea>
        <div class="col-url-actions">
          <button class="cohere-btn-primary" @click="collectBatch('batch')" :disabled="batchCollecting || !urlListInput.trim()">
            {{ batchCollecting ? $t('collection.batchCollecting') : $t('collection.batchCollect') }}
          </button>
          <span class="col-hint">{{ $t('collection.urlListHint') }}</span>
        </div>
      </div>
    </div>

    <!-- 知乎收藏夹批量采集/改写 -->
    <div class="col-block">
      <button
        type="button"
        class="col-group-title"
        data-testid="batch-group-title-zhihu"
        :aria-expanded="expandedBatch === 'zhihu'"
        aria-controls="batch-panel-zhihu"
        @click="expandBatch('zhihu')"
      >{{ $t('collection.zhihuFavlist.title') }}</button>
      <div v-show="expandedBatch === 'zhihu'" id="batch-panel-zhihu" class="zb-panel">
        <!-- 凭据状态条（2026-10-15）：Access Secret 改在「设置 → 知乎 API」配置
             （本机加密 + 按登录用户隔离），此处只显示状态并提供就地入口，不再就地输入。 -->
        <div class="zb-row">
          <span
            class="zb-config-badge"
            :class="{ ok: zhihuSecretAvailable }"
            data-testid="zhihu-config-badge"
          >{{ zhihuSecretAvailable ? $t('collection.zhihuFavlist.configBadge') : (zhihuConfigError ? $t('collection.zhihuFavlist.configDenied') : $t('collection.zhihuFavlist.configNotConfigured')) }}</span>
          <span
            v-if="zhihuSecretAvailable && zhihuConfig.maskedSecret"
            class="col-hint"
            data-testid="zhihu-config-masked"
          >{{ zhihuConfig.maskedSecret }}</span>
          <button class="cohere-btn-secondary" @click="loadZhihuFavlists" :disabled="zhihuFavlistLoading || !zhihuSecretAvailable">
            {{ zhihuFavlistLoading ? $t('collection.zhihuFavlist.loading') : $t('collection.zhihuFavlist.loadBtn') }}
          </button>
          <button class="cohere-btn-ghost" data-testid="zhihu-go-settings" @click="openZhihuSettings">
            {{ $t('collection.zhihuFavlist.goSettings') }}
          </button>
        </div>
        <div v-if="zhihuConfigHint" class="col-hint zb-mt6" data-testid="zhihu-config-hint">
          {{ zhihuConfigHint }}
        </div>
        <div v-if="zhihuFavlists.length" class="zb-row zb-mt8">
          <select v-model="zhihuFavScope" class="zb-select" data-testid="zhihu-fav-scope">
            <option value="favlist">{{ $t('collection.zhihuFav.scopeFavlist') }}</option>
            <option value="all">{{ $t('collection.zhihuFav.scopeAll') }}</option>
          </select>
          <select
            v-model="zhihuSelectedFavlist"
            :disabled="zhihuFavScope === 'all'"
            class="col-input zb-select-grow"
          >
            <option v-for="f in zhihuFavlists" :key="f.urlToken" :value="f.urlToken">
              {{ f.title }}{{ f.isPublic ? '' : '（私密）' }}
            </option>
          </select>
          <input
            v-model.number="zhihuFavCount"
            type="number" min="1" max="100"
            :disabled="zhihuFavFullMode"
            :placeholder="$t('collection.zhihuFav.countPlaceholder')"
            class="zb-select zb-count"
            data-testid="zhihu-fav-count"
          />
          <label class="zb-check"><input v-model="zhihuFavFullMode" type="checkbox" data-testid="zhihu-fav-fullmode" />{{ $t('collection.zhihuFav.fullMode') }}</label>
          <label class="zb-check"><input v-model="zhihuFavIncludeCollected" type="checkbox" data-testid="zhihu-fav-include-collected" />{{ $t('collection.zhihuFav.includeCollected') }}</label>
          <button class="cohere-btn-secondary" @click="loadZhihuFavItems" :disabled="zhihuFavListLoading || (zhihuFavScope === 'favlist' && !zhihuSelectedFavlist)">
            {{ zhihuFavListLoading ? $t('collection.zhihuFav.loadingContents') : $t('collection.zhihuFav.loadContents') }}
          </button>
        </div>
        <div v-if="zhihuFavScopeHint" class="col-hint zb-mt6" data-testid="zhihu-fav-scope-hint">
          {{ zhihuFavScopeHint }}
        </div>
        <!-- 收藏夹清单（直选） -->
        <div v-if="zhihuFavItems.length" class="zb-list" data-testid="zhihu-fav-items">
          <div class="zb-list-head">
            <label class="zb-check"><input type="checkbox" :checked="zhihuFavAllSelected" @change="toggleZhihuFavAll($event.target.checked)" />{{ $t('collection.zhihuFav.selectAll') }}</label>
            <span class="col-hint">{{ $t('collection.zhihuFav.selectedCount', { count: String(zhihuFavSelectedItems.length) }) }}</span>
            <span class="zb-flex1"></span>
            <button class="cohere-btn-primary" @click="runZhihuFavCollectRewrite" :disabled="zhihuFavBatching || !zhihuFavSelectedItems.length" data-testid="zhihu-fav-collect-rewrite">
              {{ zhihuFavBatching ? $t('collection.zhihuFav.collecting') : $t('collection.zhihuFav.collectAndRewrite') }}
            </button>
            <button v-if="zhihuFavBatching" class="cohere-btn-secondary" @click="cancelZhihuFavBatch">{{ $t('collection.cancelBatch') }}</button>
          </div>
          <div v-for="(it, idx) in zhihuFavItems" :key="it.url + idx" class="zb-list-row">
            <input
              type="checkbox"
              :checked="zhihuFavChecked.has(it.url)"
              :disabled="it.collected && !zhihuFavIncludeCollected"
              @change="toggleZhihuFavItem(it)"
            />
            <span class="zb-item-title" :title="it.title || it.url">{{ it.title || it.url }}</span>
            <span class="cohere-tag zb-kind">{{ zhihuKindLabel(it.kind) }}</span>
            <span class="col-hint">{{ formatFavTime(it.favTime) }}</span>
            <span v-if="it.collected" class="col-hint">· {{ $t('collection.zhihuFav.markCollected') }}</span>
          </div>
        </div>
        <!-- 旧整夹直采（保留兼容）：采集要「选了夹」或「全部收藏」，改写只需有可改写来源。
             判据（zhihu-fav-buttons-dead）：两个按钮的可用性必须各自成立——原实现让改写
             共用采集的 `!zhihuSelectedFavlist`，导致没选夹时两个按钮一起恒灰、点击零反应。
             `data-testid="zhihu-favlist-collect|rewrite|target-hint|rewrite-hint"` 是**测试契约**
             （可用性回归锁按它们定位）：改名必须同步改 `batch-collect-panel-behavior.test.js`，
             且保持 `zhihu-*` 前缀惯例。 -->
        <div class="zb-row zb-mt8">
          <button class="cohere-btn-secondary" data-testid="zhihu-favlist-collect" @click="zhihuFavlistBatchCollect" :disabled="zhihuFavlistBatching || !zhihuFavTargetReady">
            {{ zhihuFavlistBatching === 'collect' ? $t('collection.zhihuFavlist.collecting') : $t('collection.zhihuFavlist.collectBtn') }}
          </button>
          <button class="cohere-btn-secondary" data-testid="zhihu-favlist-rewrite" @click="zhihuFavlistBatchRewrite" :disabled="zhihuFavlistBatching || !zhihuFavRewriteReady">
            {{ zhihuFavlistBatching === 'rewrite' ? $t('collection.zhihuFavlist.rewriting') : $t('collection.zhihuFavlist.rewriteBtn') }}
          </button>
          <button v-if="zhihuFavlistBatching" class="cohere-btn-secondary" @click="cancelZhihuFavlistBatch">
            {{ $t('collection.cancelBatch') }}
          </button>
        </div>
        <!-- 不可点时必须给出**可见原因**（disabled 的 button 不派发 click，静默等于「点了没反应」） -->
        <div v-if="!zhihuFavTargetReady" class="col-hint zb-mt4" data-testid="zhihu-favlist-target-hint">
          {{ $t('collection.zhihuFavlist.pickFavlistFirst') }}
        </div>
        <div v-if="!zhihuFavRewriteReady" class="col-hint zb-mt4" data-testid="zhihu-favlist-rewrite-hint">
          {{ $t('collection.zhihuFavlist.rewriteNeedsSource') }}
        </div>
        <div v-if="zhihuFavlistProgress" class="col-hint zb-mt8">{{ zhihuFavlistProgress }}</div>
        <div v-if="zhihuFavlistError" class="col-error-banner zb-mt8">{{ zhihuFavlistError }}</div>
        <div class="col-hint zb-mt4">{{ $t('collection.zhihuFavlist.hint') }}</div>
      </div>
    </div>

    <!-- 「采集并改写」进度（统一 ColProgressBlock） -->
    <ColProgressBlock
      v-if="zhihuFavBatching || zhihuFavProgressLines.length"
      :title="$t('collection.zhihuFavlist.progressTitle')"
      :percent="zhihuFavProgressPercent"
      :text="$t('collection.zhihuFavlist.progressText', { done: String(zhihuFavProgressDone), total: String(zhihuFavProgressTotal) })"
      :summary="zhihuFavSummary"
      :detail-lines="zhihuFavProgressLines"
      testid="zhihu-fav-batch-progress"
    />

    <!-- 批量采集进度（同一 ColProgressBlock） -->
    <ColProgressBlock
      v-if="batchTaskId"
      :title="$t('collection.batchProgress')"
      :percent="batchProgress"
      :text="batchProgressText"
      :cancelable="batchCollecting"
      @cancel="cancelBatchCollect"
    />
    <div v-if="batchError" class="col-error-banner">{{ batchError }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { getApi } from '@/api/electron-bridge'
import { useNotify } from '@/composables/useNotify'
import { resolveNotifyText } from '@/utils/notifyCore'
import { useBatchPollGuard } from '@/composables/useBatchPollGuard'
import { settingsDialogRevision } from '@/stores/settings-dialog'
import { mapFavBatchResultsToItems } from '@/features/collection/collection-batch'
import { normalizeCollectedItem } from '@/features/collection/collected-item'
import ColProgressBlock from './ColProgressBlock.vue'

const props = defineProps({
  /** 去重真源：父级 collectedItems 的 sourceUrl 集合（C2 已采集标记） */
  collectedUrlSet: { type: Object, required: true },
  /** 归一化上下文（统一内容类别），父级传入保持单一来源 */
  categoryTagCtx: { type: Object, required: true },
  /** 改写风格（知乎批量改写通道沿用采集页全局选择） */
  rewriteStyle: { type: String, required: true },
  /** 整夹改写无自身结果时的回退源：父级有正文的采集条目（原实现在列表内就地改写，受控迁移后经 prop 传入） */
  rewriteFallbackItems: { type: Array, default: () => [] },
})

// 事件契约必须显式声明（顺带修复的既有缺陷，2026-10-16）：父级 Collection.vue:144 一直在监听
// `@collected-rewrites`，而本组件原先只声明 ['collected','error'] ⇒ 靠 fallthrough 侥幸可用，
// 一旦根节点变成多节点（fragment），监听器会静默失效（组件照 emit、父级收不到）。
const emit = defineEmits(['collected', 'error', 'collected-rewrites'])

const { notifyWarning, notifyError, notifySuccess, notifyInfo } = useNotify()

// ─── 折叠分组（Q10-b：互斥手风琴，默认 rss） ───
const expandedBatch = ref('rss')
function expandBatch (key) {
  expandedBatch.value = key
}

// ─── RSS / URL 列表批量 ───
const rssUrl = ref('')
const urlListInput = ref('')
const batchCollecting = ref(false)
const batchProgress = ref(0)
const batchProgressText = ref('')
const batchError = ref('')
const batchTaskId = ref(null)
let batchPollTimer = null
let batchPollGuard = null

function stopBatchPolling () {
  if (batchPollTimer) {
    clearInterval(batchPollTimer)
    batchPollTimer = null
  }
}

async function collectBatch (sourceType) {
  const api = getApi()
  if (!api || !api.aggregationCollectBatch) {
    notifyWarning('collection.collectUnavailable')
    return
  }

  const payload = { source_type: sourceType }
  if (sourceType === 'rss') {
    if (!rssUrl.value.trim()) {
      notifyWarning('collection.enterRss')
      return
    }
    payload.rss_url = rssUrl.value.trim()
  } else {
    const urls = urlListInput.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (urls.length === 0) {
      notifyWarning('collection.enterUrlList')
      return
    }
    payload.urls = urls
  }

  batchCollecting.value = true
  batchError.value = ''
  batchProgress.value = 0
  batchProgressText.value = ''
  batchTaskId.value = null

  try {
    const res = await api.aggregationCollectBatch(payload)
    if (res && res.task_id) {
      batchTaskId.value = res.task_id
      startBatchPolling()
    } else if (res && res.data && res.data.task_id) {
      batchTaskId.value = res.data.task_id
      startBatchPolling()
    } else if (res && res.code !== undefined && res.code !== 0) {
      batchError.value = res.message || resolveNotifyText('collection.batchCollectFailed').text
      notifyError('collection.batchCollectFailed', { message: batchError.value })
      batchCollecting.value = false
    } else {
      batchError.value = resolveNotifyText('collection.batchCollectFailed').text
      notifyError('collection.batchCollectFailed', { message: batchError.value })
      batchCollecting.value = false
    }
  } catch (e) {
    batchError.value = e && e.message ? String(e.message) : String(e)
    notifyError('collection.batchCollectFailed', { message: batchError.value })
    batchCollecting.value = false
  }
}

function startBatchPolling () {
  stopBatchPolling()
  batchPollGuard = useBatchPollGuard({ onFail: failBatchPolling })
  batchPollGuard.reset()
  batchPollTimer = setInterval(async () => {
    if (!batchTaskId.value) return
    const api = getApi()
    if (!api || !api.aggregationTaskStatus) return
    if (batchPollGuard.checkDuration()) {
      failBatchPolling(resolveNotifyText('collection.batchPollTimeout').text)
      return
    }
    try {
      const res = await api.aggregationTaskStatus(batchTaskId.value)
      batchPollGuard.onSuccess()
      const data = res && res.data ? res.data : res
      const status = data.status || res.status
      const total = data.total || 0
      const completed = data.completed !== undefined ? data.completed : data.done || 0

      if (status === 'completed' || status === 'success') {
        batchProgress.value = 100
        batchProgressText.value = resolveNotifyText('collection.batchComplete').text
        batchCollecting.value = false
        const items = data.items || data.results || []
        const mapped = items.map((item) => normalizeCollectedItem({
          title: item.title || '',
          content: item.content || '',
          source: 'batch',
          sourceUrl: item.source_url || item.sourceUrl || '',
          wordCount: item.word_count || 0,
        }, props.categoryTagCtx))
        emit('collected', mapped)
        notifySuccess('collection.batchSuccess', { params: { count: items.length } })
        stopBatchPolling()
      } else if (status === 'failed' || status === 'error') {
        batchError.value = data.message || resolveNotifyText('collection.batchCollectFailed').text
        notifyError('collection.batchCollectFailed', { message: batchError.value })
        batchCollecting.value = false
        stopBatchPolling()
      } else {
        if (total > 0) {
          batchProgress.value = Math.round((completed / total) * 100)
        }
      }
    } catch (e) {
      // M-3：连续失败达阈值即收口；已收集的条目保留不清空（错误经 guard 统一上抛）
      void e
      const { failed, count } = batchPollGuard.recordFailure()
      if (failed) {
        failBatchPolling(
          resolveNotifyText('collection.batchPollUnreachable', { params: { count } }).text,
        )
      }
    }
  }, 2000)
}

function failBatchPolling (message) {
  batchError.value = message
  notifyError('collection.batchCollectFailed', { message: batchError.value })
  batchCollecting.value = false
  stopBatchPolling()
}

function cancelBatchCollect () {
  batchCollecting.value = false
  batchTaskId.value = null
  stopBatchPolling()
  notifyInfo('collection.batchCancelled')
}

// ─── 知乎收藏夹批量采集/改写（整夹兼容路径） ───
// 凭据状态（2026-10-15）：Access Secret 由「设置 → 知乎 API」写入（safeStorage 加密 +
// 按登录用户隔离），本组件只读状态、不再持有明文——旧实现在就地输入框里要求用户
// 每次粘贴密钥，且保存后不回填，用户每开一次页面都要再粘一次。
const zhihuConfig = ref({
  configured: false, readable: false, maskedSecret: '', updatedAt: null,
  verifiedAt: null, favlistCount: null, legacyDetected: false, source: 'none',
})
// 读取被拒的原因（许可证 / 未登录 / 发送方校验）：非空时状态条改说原因，
// 不再渲染成「未配置」——后者会让已配置但当前无权读的用户重复配置（QM-6 评审 MAJOR #2）
const zhihuConfigError = ref('')
const zhihuFavlists = ref([])
const zhihuSelectedFavlist = ref('')
const zhihuFavlistLoading = ref(false)
const zhihuFavlistBatching = ref('')
const zhihuFavlistProgress = ref('')
const zhihuFavlistError = ref('')
const zhihuFavlistResults = ref([])

/** 可出站的凭据是否存在：加密配置可用，或旧版明文仍在（兼容期）。判据与服务端同一来源。 */
const zhihuSecretAvailable = computed(() => zhihuConfig.value.source !== 'none')

/** 状态条下方的解释文案（可用时不打扰；旧版明文时提示迁移；读不出与未配置分开说） */
const zhihuConfigHint = computed(() => {
  // 读取被拒（许可证/未登录/发送方校验）优先说原因：静默塌成「未配置」会把
  // 「已配置、只是当前无权读」的用户引向重复配置（QM-6 评审 MAJOR #2）
  if (zhihuConfigError.value) return zhihuConfigError.value
  if (zhihuSecretAvailable.value) {
    return zhihuConfig.value.source === 'legacy'
      ? resolveNotifyText('collection.zhihuFavlist.configLegacy').text
      : ''
  }
  return zhihuConfig.value.configured
    ? resolveNotifyText('collection.zhihuFavlist.configUnreadable').text
    : resolveNotifyText('collection.zhihuFavlist.configMissing').text
})

async function loadZhihuConfig () {
  const api = getApi()
  if (!api || typeof api.zhihuGetConfig !== 'function') return
  try {
    const r = await api.zhihuGetConfig()
    if (r && r.code === 0 && r.data) {
      zhihuConfig.value = { ...zhihuConfig.value, ...r.data }
      zhihuConfigError.value = ''
      return
    }
    // 非 0：读取通道被拒（-3 许可证/未登录；-2 发送方校验；-1 存储异常）。
    // 必须与「确实没配」区分开——两者都是「不可用」，但用户该做的事完全不同。
    zhihuConfigError.value = r && r.message ? String(r.message) : ''
    zhihuConfig.value = { ...zhihuConfig.value, configured: false, readable: false, source: 'none' }
  } catch (e) {
    // 抛异常路径（同步权限拒绝）同样出声，不冒充「未配置」
    zhihuConfigError.value = e && e.message ? String(e.message) : ''
    zhihuConfig.value = { ...zhihuConfig.value, configured: false, readable: false, source: 'none' }
  }
}

/** 就地打开「设置 → 知乎 API」（死胡同文案的反面：提示必须带出口） */
async function openZhihuSettings () {
  const { requestSettingsDialog } = await import('@/stores/settings-dialog')
  requestSettingsDialog('zhihu')
}

async function loadZhihuFavlists () {
  if (!zhihuSecretAvailable.value) {
    zhihuFavlistError.value = zhihuConfigHint.value
    return
  }
  zhihuFavlistLoading.value = true
  zhihuFavlistError.value = ''
  try {
    const api = getApi()
    const r = await api.zhihuFavlistList()
    if (r.code !== 0) {
      zhihuFavlistError.value = r.message || resolveNotifyText('collection.zhihuFavlist.loadFailed').text
      return
    }
    zhihuFavlists.value = r.data || []
    if (!zhihuFavlists.value.length) {
      zhihuFavlistError.value = resolveNotifyText('collection.zhihuFavlist.empty').text
    } else if (!zhihuFavlists.value.some((f) => f && f.urlToken === zhihuSelectedFavlist.value)) {
      // 自动选中第一项（zhihu-fav-buttons-dead）：`<select>` 视觉上会显示第一项，而 v-model
      // 仍是空串 ⇒ 用户「看起来已经选了」，按钮却因 `!zhihuSelectedFavlist` 恒灰。
      // 真实选择态必须由代码显式建立，不能靠浏览器默认渲染来暗示。
      zhihuSelectedFavlist.value = zhihuFavlists.value[0].urlToken
    }
  } catch (e) {
    zhihuFavlistError.value = String(e && e.message || e)
  } finally {
    zhihuFavlistLoading.value = false
  }
}

async function zhihuFavlistBatchCollect () {
  // 原为 `if (!zhihuSelectedFavlist.value) return` —— **静默返回**，即使被调用也毫无反馈。
  // 改为出声，并复用与按钮同一判据（含「全部收藏」模式，该模式不需要选中具体收藏夹）。
  if (!zhihuFavTargetReady.value) {
    zhihuFavlistError.value = resolveNotifyText('collection.zhihuFavlist.pickFavlistFirst').text
    return
  }
  zhihuFavlistBatching.value = 'collect'
  zhihuFavlistError.value = ''
  zhihuFavlistProgress.value = resolveNotifyText('collection.zhihuFavlist.fetchingContents').text
  try {
    const api = getApi()
    // 与 `loadZhihuFavItems` 同语义（消除两处口径漂移）：全部收藏走 unified-contents，指定夹走 contents
    const contents = zhihuFavScope.value === 'all'
      ? await api.zhihuFavlistUnifiedContents({
        count: zhihuFavFullMode.value ? 200 : zhihuFavCount.value,
        fullMode: zhihuFavFullMode.value,
      })
      : await api.zhihuFavlistContents({ urlToken: zhihuSelectedFavlist.value })
    if (contents.code !== 0) {
      zhihuFavlistError.value = contents.message || resolveNotifyText('collection.zhihuFavlist.loadFailed').text
      return
    }
    const contentsData = (contents && contents.data) || {}
    const urls = (contentsData.items || []).map((it) => it.url).filter(Boolean)
    if (!urls.length) {
      zhihuFavlistError.value = resolveNotifyText('collection.zhihuFavlist.emptyFavlist').text
      return
    }
    zhihuFavlistProgress.value = resolveNotifyText('collection.zhihuFavlist.collectingProgress', { count: urls.length }).text
    const r = await api.zhihuFavlistBatchCollect({ urls })
    if (r.code !== 0) {
      zhihuFavlistError.value = r.message || resolveNotifyText('collection.zhihuFavlist.loadFailed').text
      return
    }
    const { completed, failed, cancelled, circuitBroken } = r.data
    const contentsList = (contentsData && contentsData.items) || []
    const items = (r.data.results || []).filter((x) => x && x.ok && x.data).map((x) => ({
      ...x.data,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      sourceUrl: (contentsList[x.index] && contentsList[x.index].url) || '',
    }))
    emit('collected', items)
    zhihuFavlistResults.value = items
    zhihuFavlistProgress.value = resolveNotifyText('collection.zhihuFavlist.batchDone', {
      completed: String(completed), failed: String(failed),
    }).text + (cancelled ? resolveNotifyText('collection.zhihuFavlist.batchDoneCancelledSuffix').text : '') + (circuitBroken ? resolveNotifyText('collection.zhihuFavlist.batchDoneCircuitBrokenSuffix').text : '')
    notifySuccess('collection.collectSuccess')
  } catch (e) {
    zhihuFavlistError.value = String(e && e.message || e)
  } finally {
    zhihuFavlistBatching.value = ''
  }
}
async function zhihuFavlistBatchRewrite () {
  // 与按钮可用性共用同一判据（`zhihuFavRewriteSource`），消除「按钮说能点、handler 说没内容」的双真源
  const source = zhihuFavRewriteSource.value
  if (!source.length) {
    zhihuFavlistError.value = resolveNotifyText('collection.zhihuFavlist.noRewritable').text
    return
  }
  zhihuFavlistBatching.value = 'rewrite'
  zhihuFavlistError.value = ''
  zhihuFavlistProgress.value = resolveNotifyText('collection.zhihuFavlist.rewritingProgress', { count: source.length }).text
  try {
    const api = getApi()
    const contents = source.map((x) => ({ content: x.content }))
    const r = await api.zhihuFavlistBatchRewrite({ contents, style: props.rewriteStyle, length: 'keep' })
    if (r.code !== 0) {
      zhihuFavlistError.value = r.message || resolveNotifyText('collection.zhihuFavlist.loadFailed').text
      return
    }
    const { completed, failed, cancelled, circuitBroken } = r.data
    const results = r.data.results || []
    let idx = 0
    for (const res of results) {
      if (res && res.ok && res.data && res.data.result_content && source[idx]) {
        source[idx].rewrittenContent = res.data.result_content
      }
      idx++
    }
    zhihuFavlistProgress.value = resolveNotifyText('collection.zhihuFavlist.batchDone', {
      completed: String(completed), failed: String(failed),
    }).text + (cancelled ? resolveNotifyText('collection.zhihuFavlist.batchDoneCancelledSuffix').text : '') + (circuitBroken ? resolveNotifyText('collection.zhihuFavlist.batchDoneCircuitBrokenSuffix').text : '')
    notifySuccess('collection.rewriteSuccess')
  } catch (e) {
    zhihuFavlistError.value = String(e && e.message || e)
  } finally {
    zhihuFavlistBatching.value = ''
  }
}

async function cancelZhihuFavlistBatch () {
  try {
    const api = getApi()
    await api.zhihuFavlistCancel(zhihuFavlistBatching.value)
  } catch { /* 取消失败静默 */ }
}

// ─── 知乎收藏批量升级（清单直选 + 采集并改写） ───
const zhihuFavScope = ref('favlist')
const zhihuFavCount = ref(50)
const zhihuFavFullMode = ref(false)
const zhihuFavIncludeCollected = ref(false)
const zhihuFavItems = ref([])
const zhihuFavChecked = ref(new Set())
const zhihuFavListLoading = ref(false)
const zhihuFavBatching = ref(false)
const zhihuFavProgressLines = ref([])
const zhihuFavSummary = ref('')
const zhihuFavProgressDone = ref(0)
const zhihuFavProgressTotal = ref(0)
const zhihuFavScopeNote = ref('')
let zhihuFavProgressUnsubscribe = null

const zhihuFavSelectedItems = computed(() => zhihuFavItems.value.filter((it) => zhihuFavChecked.value.has(it.url)))
const zhihuFavAllSelected = computed(() => zhihuFavItems.value.length > 0 && zhihuFavSelectedItems.value.length === zhihuFavItems.value.length)
const zhihuFavProgressPercent = computed(() => {
  if (!zhihuFavProgressTotal.value) return 0
  return Math.round((zhihuFavProgressDone.value / zhihuFavProgressTotal.value) * 100)
})
const zhihuFavScopeHint = computed(() => zhihuFavScopeNote.value || '')

/**
 * 「整夹直采」的目标是否就绪（zhihu-fav-buttons-dead，2026-10-16）。
 *
 * 为什么要单独抽判据：原实现把按钮写成 `:disabled="... || !zhihuSelectedFavlist"`，
 * 而 `zhihuSelectedFavlist` 初始为 '' 且**代码从不自动赋值**（只有用户手动点下拉框才会变），
 * 下拉框本身又在 `v-if="zhihuFavlists.length"` 内 ⇒ 未加载清单时用户看不到下拉框、无从选择
 * ⇒ **按钮恒灰、点击零事件零提示**（用户报障「点采集/改写没反应」的第一性原因）。
 * 另外「全部收藏」模式下下拉框被 disabled，用户永远无法满足「必须选中一个夹」的判据 ⇒ 该模式死锁。
 */
const zhihuFavTargetReady = computed(() => zhihuFavScope.value === 'all' || !!zhihuSelectedFavlist.value)

/**
 * 改写来源（与 `zhihuFavlistBatchRewrite` 共用同一判据，消除双真源）：
 * 优先本次采集结果，其次父级传入的有正文条目。
 */
const zhihuFavRewriteSource = computed(() => (
  zhihuFavlistResults.value.length
    ? zhihuFavlistResults.value
    : (props.rewriteFallbackItems || []).filter((x) => (x.content || '').trim().length >= 20)
))

/**
 * 改写是否可发起：**只看有没有可改写来源，与是否选收藏夹无关**。
 * 原实现让「改写」共用采集的 `!zhihuSelectedFavlist` 判据 ⇒ 没选夹时改写也恒灰，
 * 而改写根本不读收藏夹（它改写的是已采结果/父级条目）。
 */
const zhihuFavRewriteReady = computed(() => zhihuFavRewriteSource.value.length > 0)

function zhihuKindLabel (kind) {
  const keyMap = { answer: 'kindAnswer', article: 'kindArticle', column: 'kindColumn', pin: 'kindPin', video: 'kindVideo', unknown: 'kindUnknown' }
  const key = keyMap[kind] || 'kindUnknown'
  return resolveNotifyText('collection.zhihuFav.' + key).text
}

function formatFavTime (favTime) {
  const n = Number(favTime)
  if (!n) return ''
  try {
    return new Date(n * 1000).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function toggleZhihuFavAll (on) {
  const s = new Set()
  if (on) {
    for (const it of zhihuFavItems.value) {
      if (!(it.collected && !zhihuFavIncludeCollected.value)) s.add(it.url)
    }
  }
  zhihuFavChecked.value = s
}

function toggleZhihuFavItem (it) {
  const s = new Set(zhihuFavChecked.value)
  if (s.has(it.url)) s.delete(it.url)
  else s.add(it.url)
  zhihuFavChecked.value = s
}

function cancelZhihuFavBatch () {
  try {
    const api = getApi()
    if (api && typeof api.zhihuFavBatchCancel === 'function') {
      api.zhihuFavBatchCancel().catch(() => { /* 取消失败静默 */ })
    }
  } catch { /* 取消失败静默 */ }
}

async function loadZhihuFavItems () {
  zhihuFavListLoading.value = true
  zhihuFavlistError.value = ''
  zhihuFavScopeNote.value = ''
  zhihuFavChecked.value = new Set()
  try {
    const api = getApi()
    const collectedUrls = props.collectedUrlSet
    let items = []
    if (zhihuFavScope.value === 'all') {
      const r = await api.zhihuFavlistUnifiedContents({
        count: zhihuFavFullMode.value ? 200 : zhihuFavCount.value,
        fullMode: zhihuFavFullMode.value,
      })
      if (r.code !== 0) {
        zhihuFavlistError.value = r.message || resolveNotifyText('collection.zhihuFavlist.loadFailed').text
        return
      }
      items = (r.data && r.data.items) || []
      const notes = []
      if (r.data && r.data.favlistsCapped) notes.push(resolveNotifyText('collection.zhihuFavlist.favlistsCapped').text)
      if (r.data && r.data.fullModeCapped) notes.push(resolveNotifyText('collection.zhihuFavlist.fullModeCap').text)
      zhihuFavScopeNote.value = notes.join('；')
    } else {
      const r = await api.zhihuFavlistContents({ urlToken: zhihuSelectedFavlist.value })
      if (r.code !== 0) {
        zhihuFavlistError.value = r.message || resolveNotifyText('collection.zhihuFavlist.loadFailed').text
        return
      }
      items = (r.data && r.data.items) || []
    }
    const requested = zhihuFavFullMode.value ? 200 : zhihuFavCount.value
    if (!zhihuFavFullMode.value && items.length && items.length < requested) {
      zhihuFavScopeNote.value = (zhihuFavScopeNote.value ? zhihuFavScopeNote.value + '；' : '')
        + resolveNotifyText('collection.zhihuFavlist.fewerThanRequested', { actual: String(items.length), requested: String(requested) }).text
    }
    if (zhihuFavFullMode.value && items.length > 200) {
      zhihuFavlistError.value = resolveNotifyText('collection.zhihuFavlist.fullModeCap').text
      return
    }
    zhihuFavItems.value = items.map((it) => ({ ...it, collected: collectedUrls.has(it.url) }))
    if (!zhihuFavItems.value.length) {
      zhihuFavlistError.value = resolveNotifyText('collection.zhihuFavlist.emptyItems').text
    }
  } catch (e) {
    zhihuFavlistError.value = String(e && e.message || e)
  } finally {
    zhihuFavListLoading.value = false
  }
}

async function runZhihuFavCollectRewrite () {
  const picked = zhihuFavSelectedItems.value
  if (!picked.length) {
    zhihuFavlistError.value = resolveNotifyText('collection.zhihuFavlist.noSelection').text
    return
  }
  zhihuFavBatching.value = true
  zhihuFavlistError.value = ''
  zhihuFavSummary.value = ''
  zhihuFavProgressLines.value = []
  zhihuFavProgressDone.value = 0
  zhihuFavProgressTotal.value = picked.length
  try {
    const api = getApi()
    // IPC 参数纯 JSON 纪律（QM-6 M4）：逐字段显式归一，不经任何 reactive 引用
    const items = picked.map((it) => ({
      url: String(it.url || ''),
      kind: String(it.kind || ''),
      title: String(it.title || ''),
      favTime: Number(it.favTime) || 0,
    }))
    const r = await api.zhihuFavBatchRun({
      items,
      rewriteStyle: props.rewriteStyle,
      imageLocalization: true,
      forceRecollect: zhihuFavIncludeCollected.value,
      collectedUrls: [...props.collectedUrlSet],
      batchId: 'fb_' + Date.now().toString(36),
    })
    if (r.code !== 0) {
      zhihuFavlistError.value = r.message || resolveNotifyText('collection.zhihuFavlist.loadFailed').text
      return
    }
    const data = r.data || {}
    const newItems = mapFavBatchResultsToItems(data.results || [], items, { source: 'zhihu-fav' })
    if ((data.completed || 0) > 0 && newItems.length === 0) {
      zhihuFavlistError.value = resolveNotifyText('collection.zhihuFavlist.mappingMismatch').text
      console.warn('[zhihu-fav-batch] completed=' + data.completed + ' but mapped 0 items')
    }
    const normalized = newItems.map((item) => normalizeCollectedItem(item, props.categoryTagCtx))
    emit('collected', normalized)
    zhihuFavlistResults.value = newItems
    // 改写成功条目随 emit 上抛，由父级写文案库（fromKey 幂等由父级 collectFromKey 保证）
    emit('collected-rewrites', newItems.filter((x) => x.rewrittenContent && x.sourceUrl))
    zhihuFavSummary.value = resolveNotifyText('collection.zhihuFav.progressSummary', {
      success: String(data.completed || 0), failed: String(data.failed || 0),
      skipped: String(data.duplicateSkipped || 0), rewriteFailed: String(data.rewriteFailed || 0),
    }).text
      + (data.cancelled ? resolveNotifyText('collection.zhihuFavlist.batchDoneCancelledSuffix').text : '')
      + (data.circuitBroken ? resolveNotifyText('collection.zhihuFavlist.batchDoneCircuitBrokenSuffix').text : '')
    notifySuccess('collection.collectSuccess')
    loadZhihuFavItems().catch(() => {})
  } catch (e) {
    zhihuFavlistError.value = String(e && e.message || e)
  } finally {
    zhihuFavBatching.value = false
  }
}

function subscribeZhihuFavProgress () {
  const api = getApi()
  if (api && typeof api.onZhihuFavBatchProgress === 'function') {
    zhihuFavProgressUnsubscribe = api.onZhihuFavBatchProgress((p) => {
      if (!p || typeof p !== 'object') return
      if (p.phase === 'start') {
        zhihuFavProgressLines.value.push(`[${(p.index ?? 0) + 1}/${p.total}] ${resolveNotifyText('collection.zhihuFav.collectingNote', { url: p.url }).text}`)
      } else if (p.phase === 'done') {
        zhihuFavProgressDone.value = Math.min((p.index ?? 0) + 1, p.total || zhihuFavProgressTotal.value)
        const res = p.result || {}
        let note = resolveNotifyText('collection.zhihuFav.doneNote').text
        if (res.registerOnly) note = resolveNotifyText('collection.zhihuFav.registerOnlyNote').text
        else if (res.rewriteFailed) note = resolveNotifyText('collection.zhihuFav.collectOkRewriteFailNote').text
        else if (res.fallbacks) note += resolveNotifyText('collection.zhihuFav.fallbackSuffix', { count: String(res.fallbacks) }).text
        zhihuFavProgressLines.value.push(`[${(p.index ?? 0) + 1}/${p.total}] ${note}`)
      } else if (p.phase === 'summary') {
        zhihuFavProgressTotal.value = p.total || zhihuFavProgressTotal.value
      }
      // 进度行上限（>200 截断，防长任务 DOM 无界累积）
      if (zhihuFavProgressLines.value.length > 200) {
        zhihuFavProgressLines.value = zhihuFavProgressLines.value.slice(-200)
      }
    })
  }
}

subscribeZhihuFavProgress()

// 凭据状态：挂载即读一次；用户去设置里配好后关闭弹窗，再刷一次状态
// （settingsDialogRevision 就是为「弹窗内改了配置、弹窗外的页面要跟上」而存在的信号）
onMounted(loadZhihuConfig)
watch(settingsDialogRevision, () => { loadZhihuConfig() })

onUnmounted(() => {
  if (zhihuFavProgressUnsubscribe) { zhihuFavProgressUnsubscribe(); zhihuFavProgressUnsubscribe = null }
  stopBatchPolling()
})

defineExpose({ expandBatch })
</script>

<style scoped>
/* 折叠组标题（互斥手风琴，Q10-b） */
.col-group-title {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--r-xs, 6px);
  background: var(--color-bg-inset);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  cursor: pointer;
  text-align: left;
}
.col-group-title:hover { border-color: var(--color-primary); }
.col-group-title[aria-expanded="true"] { border-color: var(--color-primary); color: var(--color-primary); }
.zb-panel { padding-top: 8px; }

/* 知乎区块内联样式类化（zb-* 前缀，T1-3d 先例延续） */
.zb-row { display: flex; gap: var(--space-sm); align-items: center; flex-wrap: wrap; }
.zb-panel { margin-bottom: var(--space-sm); }
.zb-mt4 { margin-top: 4px; }
.zb-mt6 { margin-top: 6px; }
.zb-mt8 { margin-top: 8px; }
.zb-flex1 { flex: 1; }
/* 凭据状态徽标（zhihu-api-settings）：中性=未配置、成功色=可用；旧版明文态由下方 hint 说明。
   色值一律走语义令牌（collection-tokens.test.js 禁止本区块出现 hex 字面量）。 */
.zb-config-badge {
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--color-bg-inset);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: 500;
}
.zb-config-badge.ok {
  border-color: var(--color-success);
  color: var(--color-success);
  background: var(--color-success-soft);
}
/* ghost 按钮在本仓是各组件自带的局部类（见 components/PersonalKnowledgePanel.vue），
   这里显式自带一份，避免「引用了不存在的全局类」导致的裸样式按钮 */
.cohere-btn-ghost {
  padding: 6px 10px;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--r-xs, 6px);
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
}
.cohere-btn-ghost:hover { border-color: var(--color-primary); color: var(--color-primary); }
.zb-select { border: 1px solid var(--color-border); border-radius: var(--r-xs, 6px); padding: 8px 10px; font-size: var(--font-size-sm); }
.zb-select-grow { flex: 1; min-width: 200px; }
.zb-count { width: 130px; }
.zb-check { display: flex; align-items: center; gap: 4px; font-size: var(--font-size-xs); }
.zb-list { margin-top: 10px; border: 1px solid var(--color-border); border-radius: 8px; max-height: 320px; overflow-y: auto; }
.zb-list-head { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--color-border); font-size: var(--font-size-xs); }
.zb-list-row { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--color-border-soft, var(--color-border)); font-size: var(--font-size-xs); }
.zb-item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zb-kind { font-size: var(--font-size-xs); }
</style>
