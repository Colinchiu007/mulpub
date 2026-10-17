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
        <!-- 阶段路标：加载出条目之前告诉用户下一步点哪个按钮（纯文案，不含任何可点控件）。
             这是删掉旧整夹直采两个常驻按钮后补的引导，见 zhihuFavStepHint 的注释。 -->
        <div v-if="zhihuFavStepHint" class="col-hint zb-mt6" data-testid="zhihu-fav-step-hint">
          {{ zhihuFavStepHint }}
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
const zhihuFavlistError = ref('')

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
 * 阶段引导（2026-10-17，change: zhihu-fav-step-hint）
 *
 * 动因：zhihu-fav-entries-consolidate 删掉旧整夹直采的两个**常驻**按钮后，
 * 在「加载收藏内容」之前界面上没有任何「下一步做什么」的路标 —— 而「采集并改写」
 * 按钮位于 `v-if="zhihuFavItems.length"` 内，未加载内容时根本不存在。用户看到的是一个
 * 会「沉默」的界面（旧入口虽然不可点，但配着「请先获取收藏夹…」的提示，路标是常驻的）。
 *
 * 这里只补**纯文案路标**，不恢复旧按钮（旧入口下线仍是既定结论）：
 *   ① 还没有收藏夹列表 → 指向「获取收藏夹」
 *   ② 有收藏夹但没有条目 → 指向「加载收藏内容」
 *   ③ 已有条目 → 返回空（按钮已出现，不打扰）
 * 凭据未配置时也返回空：那种情况下 zhihuConfigHint 已经在讲「请先配置」，
 * 再叠一条会让用户面对两条互相抢注意力的话。
 */
const zhihuFavStepHint = computed(() => {
  if (zhihuFavItems.value.length) return ''
  if (!zhihuSecretAvailable.value) return ''
  return zhihuFavlists.value.length
    ? resolveNotifyText('collection.zhihuFav.stepHintNeedContents').text
    : resolveNotifyText('collection.zhihuFav.stepHintNoFavlists').text
})

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
        else if (res.rewriteFailed) {
          note = resolveNotifyText('collection.zhihuFav.collectOkRewriteFailNote').text
          // 失败原因可诊断（2026-10-17，change: collected-results-fix）：
          // 后端把真实异常摘要（≤200 字符）放进 rewriteError；没有原因就保持原文案，
          // 有原因就追加，让用户分清「后端没起 / 接口报错 / 空结果」三种该做不同事的情况。
          if (res.rewriteError) note += '：' + String(res.rewriteError)
        } else if (res.fallbacks) note += resolveNotifyText('collection.zhihuFav.fallbackSuffix', { count: String(res.fallbacks) }).text
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
