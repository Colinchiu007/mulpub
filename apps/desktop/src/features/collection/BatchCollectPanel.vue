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
        <div class="zb-row">
          <input
            v-model="zhihuAccessSecret"
            type="password"
            :placeholder="$t('collection.zhihuFavlist.secretPlaceholder')"
            class="col-input zb-secret"
          />
          <button class="cohere-btn-secondary" @click="loadZhihuFavlists" :disabled="zhihuFavlistLoading || !zhihuAccessSecret.trim()">
            {{ zhihuFavlistLoading ? $t('collection.zhihuFavlist.loading') : $t('collection.zhihuFavlist.loadBtn') }}
          </button>
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
        <!-- 旧整夹直采（保留兼容） -->
        <div class="zb-row zb-mt8">
          <button class="cohere-btn-secondary" @click="zhihuFavlistBatchCollect" :disabled="zhihuFavlistBatching || !zhihuSelectedFavlist">
            {{ zhihuFavlistBatching === 'collect' ? $t('collection.zhihuFavlist.collecting') : $t('collection.zhihuFavlist.collectBtn') }}
          </button>
          <button class="cohere-btn-secondary" @click="zhihuFavlistBatchRewrite" :disabled="zhihuFavlistBatching || !zhihuSelectedFavlist">
            {{ zhihuFavlistBatching === 'rewrite' ? $t('collection.zhihuFavlist.rewriting') : $t('collection.zhihuFavlist.rewriteBtn') }}
          </button>
          <button v-if="zhihuFavlistBatching" class="cohere-btn-secondary" @click="cancelZhihuFavlistBatch">
            {{ $t('collection.cancelBatch') }}
          </button>
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
import { ref, computed, onUnmounted } from 'vue'
import { getApi } from '@/api/electron-bridge'
import { useNotify } from '@/composables/useNotify'
import { resolveNotifyText } from '@/utils/notifyCore'
import { useBatchPollGuard } from '@/composables/useBatchPollGuard'
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

const emit = defineEmits(['collected', 'error'])

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
    } catch {
      // M-3：连续失败达阈值即收口；已收集的条目保留不清空（错误经 guard 统一上抛）
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
const zhihuAccessSecret = ref('')
const zhihuFavlists = ref([])
const zhihuSelectedFavlist = ref('')
const zhihuFavlistLoading = ref(false)
const zhihuFavlistBatching = ref('')
const zhihuFavlistProgress = ref('')
const zhihuFavlistError = ref('')
const zhihuFavlistResults = ref([])

async function saveZhihuSecret () {
  try {
    const { storeSetSetting } = await import('@/api/publisher')
    await storeSetSetting('zhihu_access_secret', zhihuAccessSecret.value.trim())
  } catch { /* 保存失败不阻塞 */ }
}

async function loadZhihuFavlists () {
  if (!zhihuAccessSecret.value.trim()) {
    zhihuFavlistError.value = resolveNotifyText('collection.zhihuFavlist.secretRequired').text
    return
  }
  zhihuFavlistLoading.value = true
  zhihuFavlistError.value = ''
  try {
    await saveZhihuSecret()
    const api = getApi()
    const r = await api.zhihuFavlistList()
    if (r.code !== 0) {
      zhihuFavlistError.value = r.message || resolveNotifyText('collection.zhihuFavlist.loadFailed').text
      return
    }
    zhihuFavlists.value = r.data || []
    if (!zhihuFavlists.value.length) {
      zhihuFavlistError.value = resolveNotifyText('collection.zhihuFavlist.empty').text
    }
  } catch (e) {
    zhihuFavlistError.value = String(e && e.message || e)
  } finally {
    zhihuFavlistLoading.value = false
  }
}

async function zhihuFavlistBatchCollect () {
  if (!zhihuSelectedFavlist.value) return
  zhihuFavlistBatching.value = 'collect'
  zhihuFavlistError.value = ''
  zhihuFavlistProgress.value = resolveNotifyText('collection.zhihuFavlist.fetchingContents').text
  try {
    const api = getApi()
    const contents = await api.zhihuFavlistContents({ urlToken: zhihuSelectedFavlist.value })
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
  // 优先改写本次采集结果；无结果时改写父级传入的有正文条目（与迁移前同一语义）
  const source = zhihuFavlistResults.value.length
    ? zhihuFavlistResults.value
    : (props.rewriteFallbackItems || []).filter((x) => (x.content || '').trim().length >= 20)
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
    await saveZhihuSecret()
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
.zb-secret { flex: 1; min-width: 200px; }
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
