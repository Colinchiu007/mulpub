<template>
  <div class="publish-history-page">
    <header class="history-header">
      <h1>{{ t('historyPage.pageTitle') }}</h1>
      <span>{{ t('historyPage.totalTasks', { count: totalRecords }) }}</span>
    </header>

    <div class="history-tabs" role="tablist" :aria-label="t('historyPage.tablistAria')">
      <button
        id="records-tab"
        class="history-tab"
        :class="{ active: activeTab === 'records' }"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'records'"
        aria-controls="records-panel"
        :tabindex="activeTab === 'records' ? 0 : -1"
        data-testid="records-tab"
        @click="activeTab = 'records'"
        @keydown="onTabKeydown($event, 0)"
      >
        {{ t('historyPage.tabRecords') }}
      </button>
      <button
        id="drafts-tab"
        class="history-tab"
        :class="{ active: activeTab === 'drafts' }"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'drafts'"
        aria-controls="drafts-panel"
        :tabindex="activeTab === 'drafts' ? 0 : -1"
        data-testid="drafts-tab"
        @click="openDrafts"
        @keydown="onTabKeydown($event, 1)"
      >
        {{ t('historyPage.tabDrafts') }}
      </button>
    </div>

    <section v-if="activeTab === 'records'" id="records-panel" class="history-panel" role="tabpanel" aria-labelledby="records-tab">
      <div class="history-tools" :class="{ 'selection-mode': selectionMode }">
        <template v-if="!selectionMode">
          <div class="history-search-row">
            <label class="history-search">
              <Search aria-hidden="true" />
              <input
                v-model="searchQuery"
                data-testid="history-search"
                type="search"
                :placeholder="t('historyPage.searchPlaceholder')"
                :aria-label="t('historyPage.searchAria')"
              >
            </label>
            <div class="history-command-bar">
              <button class="secondary-action" type="button" data-testid="start-selection" @click="selectionMode = true">
                <Operation />{{ t('historyPage.batchManage') }}
              </button>
              <div class="view-toggle" role="group" :aria-label="t('historyPage.viewAria')">
                <button
                  class="icon-action"
                  type="button"
                  :title="t('historyPage.gridView')"
                  :aria-label="t('historyPage.gridView')"
                  :aria-pressed="viewMode === 'grid'"
                  data-testid="view-grid"
                  @click="viewMode = 'grid'"
                >
                  <Grid />
                </button>
                <button
                  class="icon-action"
                  type="button"
                  :title="t('historyPage.listView')"
                  :aria-label="t('historyPage.listView')"
                  :aria-pressed="viewMode === 'list'"
                  data-testid="view-list"
                  @click="viewMode = 'list'"
                >
                  <List />
                </button>
              </div>
              <button class="secondary-action" type="button" data-testid="export-history" :disabled="filteredRecords.length === 0" @click="exportHistory">
                <Download />{{ t('historyPage.export') }}
              </button>
              <button class="primary-action" type="button" data-testid="new-publish" @click="goToEditor()">
                <CirclePlus />{{ t('historyPage.newPublish') }}
              </button>
            </div>
          </div>
          <div class="history-filters">
            <select v-model="publisherFilter" data-testid="publisher-filter" :aria-label="t('historyPage.filterPublisherAria')">
              <option value="">{{ t('historyPage.allPublishers') }}</option>
              <option v-for="publisher in publisherOptions" :key="publisher" :value="publisher">{{ publisher }}</option>
            </select>
            <select v-model="contentTypeFilter" data-testid="content-type-filter" :aria-label="t('historyPage.filterContentTypeAria')">
              <option value="">{{ t('historyPage.allContentTypes') }}</option>
              <option value="article">{{ t('historyPage.contentTypeArticle') }}</option>
              <option value="video">{{ t('historyPage.contentTypeVideo') }}</option>
              <option value="image">{{ t('historyPage.contentTypeImage') }}</option>
            </select>
            <select v-model="statusFilter" data-testid="status-filter" :aria-label="t('historyPage.filterStatusAria')">
              <option value="">{{ t('historyPage.allStatuses') }}</option>
              <option value="success">{{ t('historyPage.filterStatusSuccess') }}</option>
              <option value="failed">{{ t('historyPage.filterStatusFailed') }}</option>
              <option value="pending">{{ t('historyPage.filterStatusPending') }}</option>
            </select>
            <select v-model="publishModeFilter" data-testid="publish-mode-filter" :aria-label="t('historyPage.filterModeAria')">
              <option value="">{{ t('historyPage.allModes') }}</option>
              <option value="immediate">{{ t('historyPage.modeImmediate') }}</option>
              <option value="scheduled">{{ t('historyPage.modeScheduled') }}</option>
            </select>
            <select v-model="platformFilter" data-testid="platform-filter" :aria-label="t('historyPage.filterPlatformAria')">
              <option value="">{{ t('historyPage.allPlatforms') }}</option>
              <option v-for="platform in platformOptions" :key="platform" :value="platform">{{ platformName(platform) }}</option>
            </select>
            <select v-model="dateFilter" data-testid="date-filter" :aria-label="t('historyPage.filterDateAria')">
              <option value="">{{ t('historyPage.allDates') }}</option>
              <option value="today">{{ t('historyPage.dateToday') }}</option>
              <option value="7d">{{ t('historyPage.date7d') }}</option>
              <option value="30d">{{ t('historyPage.date30d') }}</option>
            </select>
          </div>
        </template>
        <div v-else class="selection-toolbar">
          <span class="selection-summary">
            <span aria-hidden="true" class="selection-box"></span>
            {{ t('historyPage.selectedSummary', { count: selectedIds.length }) }}
          </span>
          <button class="toolbar-button" type="button" :disabled="filteredRecords.length === 0" @click="toggleSelectAll">
            {{ allSelected ? t('historyPage.deselectAll') : t('historyPage.selectAll') }}
          </button>
          <button
            class="toolbar-button danger"
            type="button"
            data-testid="delete-selected-history"
            :disabled="selectedIds.length === 0 || deletingSelected"
            :title="selectedIds.length === 0 ? t('historyPage.deleteSelectedHint') : t('historyPage.deleteSelectedTitle')"
            @click="deleteSelectedRecords"
          >
            <Delete />{{ deletingSelected ? t('historyPage.deleting') : t('historyPage.delete') }}
          </button>
          <button class="toolbar-button" type="button" @click="cancelSelection"><Close />{{ t('historyPage.cancelSelection') }}</button>
          <div class="view-toggle" role="group" :aria-label="t('historyPage.viewAria')">
            <button class="icon-action" type="button" :title="t('historyPage.gridView')" :aria-label="t('historyPage.gridView')" :aria-pressed="viewMode === 'grid'" data-testid="view-grid" @click="viewMode = 'grid'"><Grid /></button>
            <button class="icon-action" type="button" :title="t('historyPage.listView')" :aria-label="t('historyPage.listView')" :aria-pressed="viewMode === 'list'" data-testid="view-list" @click="viewMode = 'list'"><List /></button>
          </div>
          <button class="secondary-action" type="button" data-testid="export-history" :disabled="filteredRecords.length === 0" @click="exportHistory"><Download />{{ t('historyPage.export') }}</button>
          <button class="primary-action" type="button" data-testid="new-publish" @click="goToEditor()"><CirclePlus />{{ t('historyPage.newPublish') }}</button>
        </div>
      </div>

      <div class="panel-toolbar">
        <span class="record-count">{{ t('historyPage.recordsCount', { count: filteredRecords.length }) }}</span>
        <span v-if="hasActiveFilters" class="filter-result">{{ t('historyPage.filteredFrom', { count: records.length }) }}</span>
        <span v-if="actionMessage" class="action-message" role="status">{{ actionMessage }}</span>
      </div>

      <div v-if="loading" class="state-panel state-panel--skeleton" data-testid="history-records-loading">
        <UiSkeleton variant="list" :count="5" />
      </div>
      <div v-else-if="loginRequired" class="state-panel state-login-gate" role="status" data-testid="history-login-gate">
        <p>{{ t('historyPage.loginRequiredTitle') }}</p>
        <span>{{ t('historyPage.loginRequiredHint') }}</span>
        <button class="primary-action" type="button" data-testid="history-sign-in" @click="signInFromGate">{{ t('historyPage.signInNow') }}</button>
      </div>
      <div v-else-if="errorMessage" class="state-panel state-error" role="alert">
        <p>{{ t('historyPage.recordsLoadFailed') }}</p>
        <span>{{ errorMessage }}</span>
        <button class="secondary-action" type="button" data-testid="retry-history" @click="loadRecords()">{{ t('historyPage.retry') }}</button>
      </div>
      <EmptyState
        v-else-if="records.length === 0"
        data-testid="publish-history-empty"
        :title="t('publishHistory.empty.records.title')"
        :description="t('publishHistory.empty.records.message')"
        :action-text="t('publishHistory.empty.records.action')"
        @action="goToEditor()"
      >
        <template #icon><Tickets /></template>
      </EmptyState>
      <div v-else-if="hasActiveFilters && loadingMore" class="state-panel" role="status">{{ t('historyPage.searchingAll') }}</div>
      <EmptyState
        v-else-if="filteredRecords.length === 0"
        compact
        data-testid="publish-history-filter-empty"
        :title="t('publishHistory.empty.filtered.title')"
        :description="t('publishHistory.empty.filtered.message')"
        :action-text="t('publishHistory.empty.filtered.action')"
        @action="clearFilters"
      >
        <template #icon><Search /></template>
      </EmptyState>
      <div v-else class="record-list" :class="{ 'grid-view': viewMode === 'grid' }">
        <article v-for="record in filteredRecords" :key="record.id" class="record-card">
          <label v-if="selectionMode" class="record-selector">
            <input
              v-model="selectedIds"
              type="checkbox"
              :value="record.id"
              :aria-label="t('historyPage.selectRecordAria', { title: recordTitle(record) })"
            >
          </label>
          <div class="record-preview">
            <img v-if="thumbnailUrl(record)" :src="thumbnailUrl(record)" alt="">
            <img v-else-if="isIconUrl(platformIcon(record.platform))" :src="platformIcon(record.platform)" class="platform-icon-thumb" :alt="platformName(record.platform)" width="20" height="20" aria-hidden="true">
<span v-else aria-hidden="true">{{ platformIcon(record.platform) }}</span>
            <small>{{ contentTypeLabel(record) }}</small>
          </div>
          <div class="record-main">
            <div class="record-title-row">
              <h2>{{ recordTitle(record) }}</h2>
              <div class="record-actions">
                <button type="button" class="record-action" :data-testid="`detail-${record.id}`" @click="openRecord(record)">{{ t('historyPage.detail') }}</button>
                <button v-if="normalizedStatusGroup(record) === 'failed'" type="button" class="record-action retry" :data-testid="`retry-${record.id}`" @click="retryRecord(record)">{{ t('historyPage.retryRecord') }}</button>
              </div>
            </div>
            <div class="record-meta">
              <span><User />{{ publisherName(record) }}</span>
              <span><Clock />{{ formatTime(record.timestamp || record.createdAt || record.publishedAt) }}</span>
              <span>{{ publishModeLabel(record) }}</span>
            </div>
            <div class="record-delivery">
              <span class="status-badge" :class="statusClass(record)">{{ statusLabel(record) }}</span>
              <span v-if="deliveryModeValue(record)" class="delivery-mode-badge" :class="'delivery-mode-' + deliveryModeValue(record)" :title="deliveryModeHint(record)" :data-testid="`delivery-mode-${record.id}`">{{ deliveryModeLabel(record) }}</span>
              <span class="platform-name"><img v-if="isIconUrl(platformIcon(record.platform))" :src="platformIcon(record.platform)" class="platform-icon-thumb" :alt="platformName(record.platform)" width="16" height="16" aria-hidden="true"><span v-else aria-hidden="true">{{ platformIcon(record.platform) }}</span>{{ platformName(record.platform) }}</span>
            </div>
          </div>
          <div class="record-stats" :aria-label="t('historyPage.statsAria')">
            <div><span>{{ t('historyPage.metricAccounts') }}</span><strong>{{ metricValue(record.accountCount, 1) }}</strong></div>
            <div><span>{{ t('historyPage.metricTasks') }}</span><strong>{{ metricValue(record.taskCount, 1) }}</strong></div>
            <div><span>{{ t('historyPage.metricFailed') }}</span><strong class="failure-value">{{ failedCount(record) }}</strong></div>
            <div><span>{{ t('historyPage.metricViews') }}</span><strong>{{ metricValue(record.views) }}</strong></div>
            <div><span>{{ t('historyPage.metricComments') }}</span><strong>{{ metricValue(record.comments) }}</strong></div>
            <div><span>{{ t('historyPage.metricLikes') }}</span><strong>{{ metricValue(record.likes) }}</strong></div>
            <div><span>{{ t('historyPage.metricFavorites') }}</span><strong>{{ metricValue(record.favorites) }}</strong></div>
            <div><span>{{ t('historyPage.metricShares') }}</span><strong>{{ metricValue(record.shares) }}</strong></div>
          </div>
        </article>
      </div>
      <div v-if="hasMoreRecords && !loading && !errorMessage" class="pagination-footer">
        <button
          class="secondary-action"
          type="button"
          data-testid="load-more-history"
          :disabled="loadingMore"
          @click="loadMoreRecords"
        >
          {{ loadingMore ? t('historyPage.loadingMore') : t('historyPage.loadMore', { loaded: records.length, total: totalRecords }) }}
        </button>
      </div>
    </section>

    <section v-else id="drafts-panel" class="history-panel drafts-panel" role="tabpanel" aria-labelledby="drafts-tab">
      <div class="panel-toolbar">
        <span class="record-count">{{ t('historyPage.draftsCount', { count: drafts.length }) }}</span>
        <button class="secondary-action" type="button" data-testid="refresh-drafts" @click="loadDrafts">{{ t('historyPage.refresh') }}</button>
      </div>
      <div v-if="draftLoading" class="state-panel state-panel--skeleton" data-testid="history-drafts-loading">
        <UiSkeleton variant="list" :count="3" />
      </div>
      <div v-else-if="draftError" class="state-panel state-error" role="alert">
        <p>{{ t('historyPage.draftsLoadFailed') }}</p>
        <span>{{ draftError }}</span>
        <button class="secondary-action" type="button" @click="loadDrafts">重试</button>
      </div>
      <EmptyState
        v-else-if="drafts.length === 0"
        data-testid="publish-history-drafts-empty"
        :title="t('publishHistory.empty.drafts.title')"
        :description="t('publishHistory.empty.drafts.message')"
        :action-text="t('publishHistory.empty.drafts.action')"
        @action="goToEditor()"
      >
        <template #icon><FolderOpened /></template>
      </EmptyState>
      <div v-else class="record-list">
        <article v-for="draft in drafts" :key="draft.id" class="record-card draft-card">
          <div class="record-preview draft-preview" aria-hidden="true"><span>{{ t('historyPage.draftMark') }}</span></div>
          <div class="record-main">
            <div class="record-title-row"><h2>{{ draft.title || t('historyPage.unnamedDraft') }}</h2></div>
            <div class="record-meta">
              <span><Clock />{{ formatTime(draft.updated_at || draft.updatedAt || draft.created_at || draft.createdAt) }}</span>
              <span v-if="draft.content">{{ contentPreview(draft.content) }}</span>
            </div>
          </div>
          <button class="secondary-action" type="button" :data-testid="`edit-draft-${draft.id}`" @click="editDraft(draft.id)">{{ t('historyPage.continueEditing') }}</button>
        </article>
      </div>
    </section>
    <PublishTypeDialog
      :visible="showPublishTypeDialog"
      :platforms="publishTypePlatforms"
      @close="showPublishTypeDialog = false"
      @select="goToEditor"
    />    <div v-if="selectedRecord" class="record-detail-backdrop" role="presentation" @click.self="closeRecordDetail">
      <section class="record-detail-modal" role="dialog" aria-modal="true" aria-labelledby="record-detail-title">
        <header class="record-detail-header">
          <div><span class="record-detail-eyebrow">{{ t('historyPage.detailEyebrow') }}</span><h2 id="record-detail-title">{{ recordTitle(selectedRecord) }}</h2></div>
          <button type="button" class="record-detail-close" data-testid="close-record-detail" :aria-label="t('historyPage.closeDetail')" @click="closeRecordDetail">×</button>
        </header>
        <div v-if="detailLoading" class="record-detail-state" data-testid="history-detail-loading">
          <UiSkeleton variant="paragraph" :rows="4" />
        </div>
        <div v-else-if="detailError" class="record-detail-state state-error">{{ detailError }}</div>
        <dl v-else class="record-detail-grid">
          <div><dt>{{ t('historyPage.detailPublisher') }}</dt><dd>{{ publisherName(selectedRecord) }}</dd></div>
          <div><dt>{{ t('historyPage.detailPlatform') }}</dt><dd>{{ platformName(selectedRecord.platform) }}</dd></div>
          <div><dt>{{ t('historyPage.detailStatus') }}</dt><dd>{{ statusLabel(selectedRecord) }}</dd></div>
          <div><dt>{{ t('historyPage.detailContentType') }}</dt><dd>{{ contentTypeLabel(selectedRecord) }}</dd></div>
          <div><dt>{{ t('historyPage.detailMode') }}</dt><dd>{{ publishModeLabel(selectedRecord) }}</dd></div>
          <div><dt>{{ t('historyPage.detailTime') }}</dt><dd>{{ formatTime(selectedRecord.timestamp || selectedRecord.createdAt || selectedRecord.publishedAt) }}</dd></div>
          <div><dt>{{ t('historyPage.detailAccounts') }}</dt><dd>{{ metricValue(selectedRecord.accountCount, 1) }}</dd></div>
          <div><dt>{{ t('historyPage.detailTasks') }}</dt><dd>{{ metricValue(selectedRecord.taskCount, 1) }}</dd></div>
          <div><dt>{{ t('historyPage.detailFailed') }}</dt><dd>{{ failedCount(selectedRecord) }}</dd></div>
          <div><dt>{{ t('historyPage.detailViews') }}</dt><dd>{{ metricValue(selectedRecord.views) }}</dd></div>
          <div><dt>{{ t('historyPage.detailComments') }}</dt><dd>{{ metricValue(selectedRecord.comments) }}</dd></div>
          <div><dt>{{ t('historyPage.detailLikes') }}</dt><dd>{{ metricValue(selectedRecord.likes) }}</dd></div>
          <div><dt>{{ t('historyPage.detailFavorites') }}</dt><dd>{{ metricValue(selectedRecord.favorites) }}</dd></div>
          <div><dt>{{ t('historyPage.detailShares') }}</dt><dd>{{ metricValue(selectedRecord.shares) }}</dd></div>
          <div class="record-detail-content"><dt>{{ t('historyPage.detailContent') }}</dt><dd>{{ selectedRecord.content || selectedRecord.description || t('historyPage.noContentSummary') }}</dd></div>
        </dl>
      </section>
    </div>

    <!-- P2 效果闭环：手动录入表现数据 -->
    <el-dialog v-model="manualDialogVisible" :title="t('historyPage.manualEntryTitle')" width="420px">
      <el-form label-width="90px">
        <el-form-item :label="t('perfInsights.colAvgViews')"><el-input-number v-model="manualMetrics.views" :min="0" /></el-form-item>
        <el-form-item :label="t('perfInsights.colAvgLikes')"><el-input-number v-model="manualMetrics.likes" :min="0" /></el-form-item>
        <el-form-item :label="t('perfInsights.colAvgComments')"><el-input-number v-model="manualMetrics.comments" :min="0" /></el-form-item>
        <el-form-item :label="t('perfInsights.colAvgFavorites')"><el-input-number v-model="manualMetrics.favorites" :min="0" /></el-form-item>
        <el-form-item :label="t('perfInsights.colAvgShares')"><el-input-number v-model="manualMetrics.shares" :min="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="manualDialogVisible = false">{{ t('historyPage.manualEntryCancel') }}</el-button>
        <el-button type="primary" @click="submitManualSnapshot">{{ t('historyPage.manualEntrySave') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { CirclePlus, Clock, Close, Delete, Download, FolderOpened, Grid, List, Operation, Search, Tickets, User } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { getAppLocale } from '@/i18n'
import { useRouter } from 'vue-router'
import { draftList, historyDelete, historyGet, historyList, retryTask } from '@/api/publisher'
import { listTrackedContent, addManualSnapshot } from '@/api/knowledge-library'
import { formatDateTime } from '@/utils/datetime'
import { PLATFORM_ICONS, PLATFORM_NAMES } from '@multi-publish/shared-utils/src/platform-definitions'
import { getPlatformIconUrl } from '@/composables/usePlatformIconUrl'
import { usePlatformStore } from '@/stores/platforms'
import { useIdentity } from '@/composables/useIdentity'
import { isAuthGateResult } from '@/utils/auth-gate'
import { formatUserError } from '@/utils/user-facing-error'
import { confirmDanger } from '@/utils/confirm-danger'
import PublishTypeDialog from '@/features/publish/components/PublishTypeDialog.vue'

const { t } = useI18n()
const router = useRouter()
const platformStore = usePlatformStore()
platformStore.load()
const activeTab = ref('records')
const records = ref([])
const drafts = ref([])
const loading = ref(false)
const draftLoading = ref(false)
const errorMessage = ref('')
// 未登录门禁态：history:list 等通道要求登录（license-access-control AUTH_REQUIRED），
// 与「服务连接失败」必须区分展示，避免把权限拒绝伪装成网络故障（2026-09-15）。
const loginRequired = ref(false)
const { isAuthenticated: identityAuthenticated, signIn: identitySignIn } = useIdentity()
const draftError = ref('')
const selectionMode = ref(false)
const selectedIds = ref([])
const totalRecords = ref(0)
const loadingMore = ref(false)
const paginationExhausted = ref(false)
const searchQuery = ref('')
const publisherFilter = ref('')
const contentTypeFilter = ref('')
const statusFilter = ref('')
const publishModeFilter = ref('')
const viewMode = ref('list')
const platformFilter = ref('')
const dateFilter = ref('')
const selectedRecord = ref(null)
const detailLoading = ref(false)
const detailError = ref('')
const actionMessage = ref('')
const deletingSelected = ref(false)
const showPublishTypeDialog = ref(false)
const PAGE_SIZE = 50
let pendingFilterLoad = null
const loadedPageSignatures = new Set()

const publisherOptions = computed(() => [...new Set(records.value.map(publisherName))].sort((a, b) => a.localeCompare(b, getAppLocale() === 'en' ? 'en' : 'zh-CN')))
const platformOptions = computed(() => [...new Set(records.value.map(record => String(record?.platform || '')).filter(Boolean))].sort())
const publishTypePlatforms = computed(() => Object.entries(PLATFORM_NAMES).map(([id, label]) => ({
  id,
  label,
  icon: PLATFORM_ICONS[id] || '•',
})))
const hasActiveFilters = computed(() => Boolean(
  searchQuery.value || publisherFilter.value || contentTypeFilter.value || statusFilter.value || publishModeFilter.value || platformFilter.value || dateFilter.value,
))
const filteredRecords = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return records.value.filter(record => {
    if (query) {
      const searchable = [recordTitle(record), record.description, record.content, record.taskId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!searchable.includes(query)) return false
    }
    if (publisherFilter.value && publisherName(record) !== publisherFilter.value) return false
    if (contentTypeFilter.value && contentTypeValue(record) !== contentTypeFilter.value) return false
    if (statusFilter.value && normalizedStatusGroup(record) !== statusFilter.value) return false
    if (publishModeFilter.value && publishModeValue(record) !== publishModeFilter.value) return false
    if (platformFilter.value && String(record?.platform || '') !== platformFilter.value) return false
    if (dateFilter.value && !matchesDateFilter(record, dateFilter.value)) return false
    return true
  })
})
const allSelected = computed(() => (
  filteredRecords.value.length > 0
  && filteredRecords.value.every(record => selectedIds.value.includes(record.id))
))
const hasMoreRecords = computed(() => !paginationExhausted.value && records.value.length < totalRecords.value)

function normalizeRecords (result) {
  if (!result || result.code !== 0) {
    const error = new Error(result?.message || t('historyPage.recordsReadFailed'))
    if (result?.errorCode) error.errorCode = result.errorCode
    // 业务拒绝（权益不足/限流等）走 formatUserError 给出具体原因；其余保持通用文案。
    error.userMessage = formatUserError(result || {}, { fallback: t('historyPage.checkService') }).message
    throw error
  }
  const data = result.data
  if (Array.isArray(data)) return { total: data.length, records: data }
  const pageRecords = Array.isArray(data?.records) ? data.records : []
  const total = Number.isFinite(Number(data?.total)) ? Math.max(0, Number(data.total)) : pageRecords.length
  return { total, records: pageRecords }
}

// 登录门禁判定收敛到共享工具（Dashboard 等页面复用同一范式）。
function stableRecordId (record) {
  const id = record?.id
  return id === undefined || id === null || id === '' ? null : String(id)
}

function pageSignature (pageRecords) {
  return pageRecords.map(record => {
    const id = stableRecordId(record)
    if (id !== null) return `id:${id}`
    try {
      return `record:${JSON.stringify(record)}`
    } catch {
      return 'record:unserializable'
    }
  }).join('\u001e')
}

function appendDistinctRecords (currentRecords, pageRecords) {
  const seenIds = new Set(currentRecords.map(stableRecordId).filter(id => id !== null))
  return pageRecords.filter(record => {
    const id = stableRecordId(record)
    if (id === null) return true
    if (seenIds.has(id)) return false
    seenIds.add(id)
    return true
  })
}

async function loadRecords (options = {}) {
  const append = options?.append === true
  if (append) loadingMore.value = true
  else loading.value = true
  errorMessage.value = ''
  loginRequired.value = false
  try {
    const offset = append ? records.value.length : 0
    const result = await historyList({ limit: PAGE_SIZE, offset })
    if (!append && isAuthGateResult(result)) {
      loginRequired.value = true
      return false
    }
    const page = normalizeRecords(result)
    const signature = pageSignature(page.records)
    const repeatedPage = append && loadedPageSignatures.has(signature)
    const recordsToAppend = repeatedPage ? [] : appendDistinctRecords(records.value, page.records)
    const addedCount = append ? recordsToAppend.length : page.records.length

    if (!append) {
      loadedPageSignatures.clear()
      loadedPageSignatures.add(signature)
      records.value = page.records
    } else if (!repeatedPage) {
      loadedPageSignatures.add(signature)
      records.value = [...records.value, ...recordsToAppend]
    }
    totalRecords.value = page.total
    paginationExhausted.value = page.records.length === 0
      || repeatedPage
      || (append && addedCount === 0)
      || records.value.length >= page.total
    selectedIds.value = selectedIds.value.filter(id => records.value.some(record => record.id === id))
    // P2 效果闭环：拉取表现快照，合并到记录（tracked_content 以 task_id 关联）
    void attachPerformanceSnapshots()
    if (!append && hasActiveFilters.value) void loadRemainingRecordsForFilters()
    return page.records.length > 0 && (!append || addedCount > 0)
  } catch (e) {
    if (!append) {
      records.value = []
      totalRecords.value = 0
      paginationExhausted.value = true
      loadedPageSignatures.clear()
    }
    errorMessage.value = e?.userMessage || t('historyPage.checkService')
    return false
  } finally {
    if (append) loadingMore.value = false
    else loading.value = false
  }
}

async function signInFromGate () {
  // 打开登录窗口的唯一正确入口：identity.signIn()（内部走 identityStore.signIn → 主进程 Logto OAuth）。
  // 用户主动取消（返回 false / 抛错）不打断页面，保持门禁态等待下一次尝试。
  try {
    await identitySignIn()
  } catch {
    /* 用户取消或登录窗关闭，保持引导态 */
  }
}

// 登录成功后自动重载发布记录，无需用户手动点重试。
watch(identityAuthenticated, (authed) => {
  if (authed && loginRequired.value) void loadRecords()
})

// ── P2 效果闭环：表现数据合并 ──
const manualDialogVisible = ref(false)
const manualTarget = ref(null)
const manualMetrics = ref({ views: null, likes: null, comments: null, favorites: null, shares: null })

async function attachPerformanceSnapshots () {
  try {
    const res = await listTrackedContent({ page: 1, pageSize: 100 })
    if (!res || res.code !== 0 || !res.data) return
    // publish_history 记录的 taskId 对应 tracked_content 的 publish_history_id 语义（发布任务 id）
    const byTask = new Map()
    for (const t of (res.data.items || [])) {
      if (t.publish_history_id) byTask.set(String(t.publish_history_id), t)
    }
    for (const record of records.value) {
      const tracked = byTask.get(String(record.taskId || record.id))
      if (tracked && tracked.latest_snapshot) {
        const snap = tracked.latest_snapshot
        record.views = snap.views
        record.likes = snap.likes
        record.comments = snap.comments
        record.favorites = snap.favorites
        record.shares = snap.shares
        record.recrawlStatus = tracked.recrawl_status
        record.trackedContentId = tracked.id
      }
    }
  } catch { /* 表现数据合并失败不影响历史列表主流程 */ }
}

function openManualEntry (record) {
  manualTarget.value = record
  manualMetrics.value = { views: null, likes: null, comments: null, favorites: null, shares: null }
  manualDialogVisible.value = true
}

async function submitManualSnapshot () {
  if (!manualTarget.value || !manualTarget.value.trackedContentId) return
  try {
    const res = await addManualSnapshot(manualTarget.value.trackedContentId, {
      views: Number(manualMetrics.value.views) || 0,
      likes: Number(manualMetrics.value.likes) || 0,
      comments: Number(manualMetrics.value.comments) || 0,
      favorites: Number(manualMetrics.value.favorites) || 0,
      shares: Number(manualMetrics.value.shares) || 0,
    })
    if (res && res.code === 0) {
      manualDialogVisible.value = false
      void attachPerformanceSnapshots()
    }
  } catch { /* 手动录入失败静默 */ }
}

function loadMoreRecords () {
  if (loadingMore.value || !hasMoreRecords.value) return
  return loadRecords({ append: true })
}

async function loadRemainingRecordsForFilters () {
  if (!hasActiveFilters.value || !hasMoreRecords.value || pendingFilterLoad) return pendingFilterLoad

  pendingFilterLoad = (async () => {
    while (hasActiveFilters.value && hasMoreRecords.value) {
      const loaded = await loadRecords({ append: true })
      if (!loaded) break
    }
  })().finally(() => {
    pendingFilterLoad = null
  })
  return pendingFilterLoad
}

watch(
  [searchQuery, publisherFilter, contentTypeFilter, statusFilter, publishModeFilter, platformFilter, dateFilter],
  () => {
    if (hasActiveFilters.value) void loadRemainingRecordsForFilters()
  },
)

async function loadDrafts () {
  draftLoading.value = true
  draftError.value = ''
  try {
    const result = await draftList()
    if (!result || result.code !== 0) throw new Error(result?.message || t('historyPage.draftsReadFailed'))
    drafts.value = Array.isArray(result.data) ? result.data : []
  } catch {
    drafts.value = []
    draftError.value = t('historyPage.checkService')
  } finally {
    draftLoading.value = false
  }
}

function openDrafts () {
  activeTab.value = 'drafts'
  loadDrafts()
}

function onTabKeydown (event, index) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : index === 0 ? 1 : 0
  if (nextIndex === 0) activeTab.value = 'records'
  else openDrafts()
  nextTick(() => {
    event.currentTarget?.parentElement?.querySelectorAll('[role="tab"]')?.[nextIndex]?.focus()
  })
}

function goToEditor (type) {
  if (!type) {
    showPublishTypeDialog.value = true
    return
  }
  showPublishTypeDialog.value = false
  router.push('/publish?type=' + encodeURIComponent(type))
}

function editDraft (id) {
  if (!id) return
  router.push('/publish?draft=' + encodeURIComponent(id))
}

function cancelSelection () {
  selectionMode.value = false
  selectedIds.value = []
}

function toggleSelectAll () {
  if (allSelected.value) {
    const visibleIds = new Set(filteredRecords.value.map(record => record.id))
    selectedIds.value = selectedIds.value.filter(id => !visibleIds.has(id))
    return
  }
  selectedIds.value = [...new Set([...selectedIds.value, ...filteredRecords.value.map(record => record.id)])]
}

function clearFilters () {
  searchQuery.value = ''
  publisherFilter.value = ''
  contentTypeFilter.value = ''
  statusFilter.value = ''
  publishModeFilter.value = ''
  platformFilter.value = ''
  dateFilter.value = ''
}

function platformName (platform) {
  return platformStore.getLabel(platform) || PLATFORM_NAMES[platform] || platform || t('historyPage.unknownPlatform')
}

function platformIcon (platform) {
  return getPlatformIconUrl(platform) || platformStore.getIcon(platform) || PLATFORM_ICONS[platform] || '•'
}

function isIconUrl (value) {
  return typeof value === 'string' && (value.startsWith('/') || value.startsWith('data:') || value.startsWith('http'))
}

function matchesDateFilter (record, filter) {
  const value = new Date(record?.timestamp || record?.createdAt || record?.publishedAt).getTime()
  if (!Number.isFinite(value)) return false
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  if (filter === 'today') return new Date(value).toDateString() === new Date(now).toDateString()
  if (filter === '7d') return value >= now - 7 * day
  if (filter === '30d') return value >= now - 30 * day
  return true
}

async function openRecord (record) {
  selectedRecord.value = record
  detailLoading.value = true
  detailError.value = ''
  try {
    const result = await historyGet(record.id)
    if (result?.code === 0 && result.data) selectedRecord.value = { ...record, ...result.data }
    else if (result?.message) detailError.value = formatUserError(result, { fallback: t('historyPage.detailLoadFailed') }).message
  } catch {
    detailError.value = t('historyPage.detailLoadFailed')
  } finally {
    detailLoading.value = false
  }
}

function closeRecordDetail () {
  selectedRecord.value = null
  detailError.value = ''
}

async function retryRecord (record) {
  const taskId = record?.taskId || record?.id
  if (!taskId) return
  actionMessage.value = ''
  try {
    const result = await retryTask(taskId)
    actionMessage.value = result?.code === 0 ? t('historyPage.retrySubmitted') : formatUserError(result, { fallback: t('historyPage.retryFailed') }).message
    if (result?.code === 0) await loadRecords()
  } catch {
    actionMessage.value = t('historyPage.retryFailedRetry')
  }
}

async function deleteSelectedRecords () {
  const ids = [...selectedIds.value]
  if (ids.length === 0 || deletingSelected.value) return

  const confirmed = await confirmDanger({
    title: t('historyPage.deleteSelectedConfirmTitle'),
    message: t('historyPage.deleteSelectedConfirmMessage', { count: ids.length }),
    confirmText: t('historyPage.deleteSelectedConfirmButton'),
  })
  if (!confirmed) return

  deletingSelected.value = true
  actionMessage.value = ''
  try {
    const result = await historyDelete(ids)
    if (!result || result.code !== 0) {
      actionMessage.value = formatUserError(result, { fallback: t('historyPage.deleteFailed') }).message
      return
    }
    selectedIds.value = []
    await loadRecords()
    actionMessage.value = t('historyPage.deletedCount', { count: result.data?.deleted || ids.length })
  } catch {
    actionMessage.value = t('historyPage.deleteFailedRetry')
  } finally {
    deletingSelected.value = false
  }
}

function recordTitle (record) {
  return record?.title || record?.name || t('historyPage.unnamedTask')
}

function publisherName (record) {
  return record?.publisher || record?.author || record?.operator || t('historyPage.systemAccount')
}

function statusValue (record) {
  if (record?.success === false) return 'failed'
  return String(record?.status || 'success').toLowerCase()
}

function normalizedStatusGroup (record) {
  const value = statusValue(record)
  if (['success', 'completed', 'published'].includes(value)) return 'success'
  if (['failed', 'error'].includes(value)) return 'failed'
  return 'pending'
}

function statusLabel (record) {
  const labels = {
    success: 'statusAllSuccess',
    completed: 'statusAllSuccess',
    published: 'statusAllSuccess',
    failed: 'statusFailed',
    error: 'statusFailed',
    running: 'statusRunning',
    pending: 'statusWaiting',
    scheduled: 'statusScheduled',
  }
  return t('historyPage.' + (labels[statusValue(record)] || 'statusPending'))
}

function statusClass (record) {
  return normalizedStatusGroup(record)
}

function contentTypeValue (record) {
  const value = String(record?.contentType || record?.type || '').toLowerCase()
  if (['video', 'short_video', 'short-video'].includes(value)) return 'video'
  if (['image', 'gallery'].includes(value)) return 'image'
  if (value) return 'article'
  // 使用 platformStore.getContentCategory 统一判断视频平台
  const category = platformStore.getContentCategory(record?.platform)
  if (category === 'VIDEO' || category === 'MIXED') return 'video'
  return 'article'
}

function contentTypeLabel (record) {
  const keys = { article: 'contentTypeArticle', video: 'contentTypeVideo', image: 'contentTypeImage' }
  return t('historyPage.' + keys[contentTypeValue(record)])
}

function publishModeValue (record) {
  const value = String(record?.publishMode || record?.mode || '').toLowerCase()
  return ['scheduled', 'schedule', 'timed'].includes(value) || statusValue(record) === 'scheduled'
    ? 'scheduled'
    : 'immediate'
}

function publishModeLabel (record) {
  return t(publishModeValue(record) === 'scheduled' ? 'historyPage.modeScheduled' : 'historyPage.modeImmediate')
}

function deliveryModeValue (record) {
  const mode = record && record.result && record.result.mode
  return mode === 'api' || mode === 'dom' || mode === 'fallback' ? mode : ''
}

function deliveryModeLabel (record) {
  const keys = { api: 'publish.api.modeApi', dom: 'publish.api.modeDom', fallback: 'publish.api.modeFallback' }
  return t(keys[deliveryModeValue(record)] || 'publish.api.modeApi')
}

function deliveryModeHint (record) {
  const keys = { api: 'publish.api.modeApiHint', dom: 'publish.api.modeDomHint', fallback: 'publish.api.modeFallbackHint' }
  return t(keys[deliveryModeValue(record)] || 'publish.api.modeApiHint')
}

function thumbnailUrl (record) {
  return record?.thumbnail || record?.thumbnailUrl || record?.cover || record?.coverUrl || ''
}

function failedCount (record) {
  if (record?.failedCount !== undefined && record?.failedCount !== null) return record.failedCount
  return normalizedStatusGroup(record) === 'failed' ? 1 : 0
}

function metricValue (value, fallback = '-') {
  if (value === undefined || value === null || value === '') return fallback
  return value
}

const formatTime = (value) => formatDateTime(value, { emptyText: t('historyPage.unknownTime'), invalidText: String(value ?? '') })

function contentPreview (content) {
  const text = String(content).replace(/\s+/g, ' ').trim()
  return text.length > 48 ? text.slice(0, 48) + '...' : text
}

function csvCell (value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function exportHistory () {
  const headers = [
    t('historyPage.csvHeaderTitle'),
    t('historyPage.csvHeaderPublisher'),
    t('historyPage.csvHeaderPlatform'),
    t('historyPage.csvHeaderContentType'),
    t('historyPage.csvHeaderStatus'),
    t('historyPage.csvHeaderMode'),
    t('historyPage.csvHeaderTime'),
    t('historyPage.csvHeaderAccounts'),
    t('historyPage.csvHeaderTasks'),
    t('historyPage.csvHeaderFailed'),
    t('historyPage.csvHeaderViews'),
    t('historyPage.csvHeaderComments'),
    t('historyPage.csvHeaderLikes'),
    t('historyPage.csvHeaderFavorites'),
    t('historyPage.csvHeaderShares'),
  ]
  const rows = filteredRecords.value.map(record => [
    recordTitle(record),
    publisherName(record),
    platformName(record.platform),
    contentTypeLabel(record),
    statusLabel(record),
    publishModeLabel(record),
    formatTime(record.timestamp || record.createdAt || record.publishedAt),
    metricValue(record.accountCount, 1),
    metricValue(record.taskCount, 1),
    failedCount(record),
    metricValue(record.views),
    metricValue(record.comments),
    metricValue(record.likes),
    metricValue(record.favorites),
    metricValue(record.shares),
  ])
  const csv = '\ufeff' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `publish-history-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

onMounted(loadRecords)
</script>

<style scoped>
.publish-history-page {
  min-height: 100%;
  padding: 20px 24px 40px;
  background: var(--color-bg-inset);
  color: var(--text-primary, #25252b);
}

.history-header,
.history-tabs,
.history-search-row,
.history-command-bar,
.selection-toolbar,
.panel-toolbar,
.record-title-row,
.record-meta,
.record-delivery,
.view-toggle {
  display: flex;
  align-items: center;
}

.history-header {
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
}

.history-header h1 { margin: 0; color: var(--text-primary, #25252b); font-size: var(--font-size-lg); line-height: 28px; }
.history-header > span { color: var(--text-muted, #707080); font-size: var(--font-size-xs); }
.action-message { margin-left: auto; color: var(--text-muted, #707080); font-size: var(--font-size-xs); }

.history-tabs {
  gap: 24px;
  border-bottom: 1px solid var(--border-light, #e8e8ec);
  background: var(--color-bg-card);
  padding: 0 4px;
}

.history-tab {
  min-height: 44px;
  border: 0;
  border-bottom: 3px solid transparent;
  margin-bottom: -1px;
  padding: 8px 0 7px;
  background: transparent;
  color: var(--text-muted, #707080);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.history-tab.active { border-bottom-color: var(--primary, #5048e5); color: var(--primary, #5048e5); font-weight: 700; }
.history-panel { min-width: 0; background: transparent; }

.history-tools {
  margin-top: 16px;
  border: 1px solid var(--border-light, #e8e8ec);
  border-radius: 8px;
  padding: 16px;
  background: var(--color-bg-card);
}

.history-tools.selection-mode { min-height: 58px; display: flex; align-items: center; justify-content: flex-end; }
.history-search-row { justify-content: space-between; gap: 20px; }

.history-search {
  position: relative;
  width: min(100%, 450px);
  display: flex;
  align-items: center;
}

.history-search svg { position: absolute; left: 12px; width: 17px; height: 17px; color: #92939c; }
.history-search input {
  width: 100%;
  height: 38px;
  box-sizing: border-box;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  padding: 7px 12px 7px 38px;
  background: var(--color-bg-inset);
  color: var(--text-primary, #25252b);
  font-size: var(--font-size-sm);
  outline: none;
}
.history-search input:focus { border-color: var(--primary, #5048e5); box-shadow: 0 0 0 2px rgba(80, 72, 229, 0.1); }

.history-command-bar,
.selection-toolbar { justify-content: flex-end; flex-wrap: wrap; gap: 10px; }

.history-filters { display: grid; grid-template-columns: repeat(4, minmax(140px, 190px)); gap: 12px; margin-top: 14px; }
.history-filters select {
  width: 100%;
  height: 36px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  padding: 0 32px 0 12px;
  background: var(--color-bg-inset);
  color: #4f505a;
  font-size: var(--font-size-sm);
}

.primary-action,
.secondary-action,
.toolbar-button,
.icon-action {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 6px;
  padding: 0 13px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.primary-action { border: 1px solid var(--primary, #5048e5); background: var(--primary, #5048e5); color: #fff; }
.secondary-action,
.toolbar-button,
.icon-action { border: 1px solid var(--border, #dedee5); background: var(--color-bg-card); color: #4f505a; }
.primary-action svg,
.secondary-action svg,
.toolbar-button svg { width: 15px; height: 15px; }
.primary-action:hover { background: #443ccf; }
.secondary-action:hover:not(:disabled),
.toolbar-button:hover:not(:disabled),
.icon-action:hover { border-color: var(--primary, #5048e5); color: var(--primary, #5048e5); }
.secondary-action:disabled,
.toolbar-button:disabled { opacity: 0.5; cursor: not-allowed; }
.toolbar-button.danger { color: #c43d4d; }

.view-toggle { gap: 2px; border-radius: 6px; padding: 2px; background: var(--color-bg-inset); }
.icon-action { width: 32px; min-height: 32px; border: 0; padding: 0; background: transparent; }
.icon-action[aria-pressed='true'] { background: var(--color-bg-card); color: var(--primary, #5048e5); box-shadow: 0 1px 3px rgba(28, 28, 35, 0.12); }
.icon-action svg { width: 16px; height: 16px; }

.selection-toolbar { width: 100%; }
.selection-summary { min-height: 36px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--border, #dedee5); border-radius: 6px; padding: 0 12px; color: #6b6c76; font-size: var(--font-size-sm); }
.selection-box { width: 15px; height: 15px; border: 1px solid #8e87ed; border-radius: 4px; }

.panel-toolbar { min-height: 44px; justify-content: space-between; gap: 12px; padding: 0 4px; }
.record-count,
.filter-result { color: var(--text-muted, #707080); font-size: var(--font-size-xs); }
.filter-result { color: var(--primary, #5048e5); }

.state-panel {
  min-height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 9px;
  border: 1px solid var(--border-light, #e8e8ec);
  border-radius: 8px;
  padding: 32px;
  background: var(--color-bg-card);
  color: var(--text-muted, #707080);
  text-align: center;
}
.state-panel p { margin: 0; color: var(--text-primary, #25252b); font-size: var(--font-size-base); font-weight: 600; }
.state-panel span { font-size: var(--font-size-sm); }
.state-panel .primary-action, .state-panel .secondary-action { margin-top: 8px; }
.state-error p { color: #b33b3b; }

.record-list { display: flex; flex-direction: column; gap: 16px; }
.pagination-footer { display: flex; justify-content: center; padding: 18px 0 4px; }
.record-card {
  min-width: 0;
  min-height: 156px;
  display: flex;
  align-items: center;
  gap: 14px;
  border: 1px solid var(--border-light, #e8e8ec);
  border-radius: 8px;
  padding: 18px 20px;
  background: var(--color-bg-card);
}
.record-card:hover { border-color: #d8d6ef; box-shadow: 0 3px 12px rgba(40, 40, 55, 0.05); }
.record-selector { flex: 0 0 18px; }
.record-selector input { width: 16px; height: 16px; accent-color: var(--primary, #5048e5); }

.record-preview {
  position: relative;
  width: 200px;
  height: 112px;
  display: grid;
  place-items: center;
  overflow: hidden;
  flex: 0 0 200px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: var(--color-bg-inset);
  color: var(--primary, #5048e5);
  font-size: var(--font-size-xl);
}
.record-preview img { width: 100%; height: 100%; object-fit: cover; }
.record-preview small { position: absolute; right: 5px; bottom: 5px; border-radius: 4px; padding: 2px 5px; background: rgba(26, 27, 34, 0.78); color: #fff; font-size: var(--font-size-xs); }
.draft-preview { background: #f1f5f9; color: #64748b; font-size: var(--font-size-md); font-weight: 700; }

.record-main { min-width: 0; flex: 1; }
.record-title-row { justify-content: space-between; gap: 12px; }
.record-title-row h2 { overflow: hidden; margin: 0; color: var(--text-primary, #25252b); font-size: var(--font-size-base); font-weight: 700; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.record-meta { flex-wrap: wrap; gap: 8px 14px; margin-top: 7px; color: var(--text-muted, #707080); font-size: var(--font-size-xs); }
.record-meta span { display: inline-flex; align-items: center; gap: 4px; }
.record-meta svg { width: 13px; height: 13px; }
.record-delivery { flex-wrap: wrap; gap: 10px; margin-top: 11px; }
.status-badge { border-radius: 4px; padding: 3px 7px; font-size: var(--font-size-xs); font-weight: 600; }
.status-badge.success { background: #e8f7ef; color: #15803d; }
.status-badge.failed { background: #fcebea; color: #b42318; }
.status-badge.pending { background: #fff6df; color: #9a6700; }
.platform-name { display: inline-flex; align-items: center; gap: 5px; color: #5d5e68; font-size: var(--font-size-xs); font-weight: 600; }
.delivery-mode-badge { border-radius: 4px; padding: 3px 7px; font-size: var(--font-size-xs); font-weight: 600; }
.delivery-mode-badge.delivery-mode-api { background: #eaf2fe; color: #1d4ed8; }
.delivery-mode-badge.delivery-mode-dom { background: #f1f0f7; color: #5b21b6; }
.delivery-mode-badge.delivery-mode-fallback { background: #fff6df; color: #9a6700; }

.record-stats { min-width: 430px; display: grid; grid-template-columns: repeat(8, minmax(42px, 1fr)); border-left: 1px solid var(--border-light, #efeff2); padding-left: 14px; }
.record-stats div { min-width: 0; display: flex; align-items: center; flex-direction: column; gap: 7px; text-align: center; }
.record-stats span { color: #90919b; font-size: var(--font-size-xs); white-space: nowrap; }
.record-stats strong { color: var(--text-primary, #25252b); font-size: var(--font-size-sm); }
.record-stats .failure-value { color: #e24a5a; }

.record-list.grid-view { display: grid; grid-template-columns: repeat(auto-fill, minmax(390px, 1fr)); align-items: start; }
.grid-view .record-card { align-items: flex-start; flex-wrap: wrap; }
.grid-view .record-preview { width: 108px; height: 82px; flex-basis: 108px; }
.grid-view .record-stats { width: 100%; min-width: 0; border-top: 1px solid var(--border-light, #efeff2); border-left: 0; padding-top: 12px; padding-left: 0; }
.drafts-panel { padding-top: 8px; }

.primary-action:focus-visible,
.secondary-action:focus-visible,
.toolbar-button:focus-visible,
.icon-action:focus-visible,
.history-tab:focus-visible,
.record-selector input:focus-visible,
.history-filters select:focus-visible {
  outline: 2px solid var(--primary, #5048e5);
  outline-offset: 2px;
}

@media (max-width: 1180px) {
  .history-search-row { align-items: stretch; flex-direction: column; }
  .history-search { width: 100%; max-width: none; }
  .history-command-bar { justify-content: flex-start; }
  .record-card { align-items: flex-start; flex-wrap: wrap; }
  .record-stats { width: 100%; min-width: 0; border-top: 1px solid var(--border-light, #efeff2); border-left: 0; padding-top: 12px; padding-left: 0; }
}

@media (max-width: 720px) {
  .publish-history-page { padding: 16px 12px 28px; }
  .history-header { align-items: flex-start; }
  .history-tools { padding: 12px; }
  .history-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .history-command-bar,
  .selection-toolbar { justify-content: flex-start; }
  .record-card { align-items: flex-start; flex-wrap: wrap; padding: 12px; }
  .record-selector { padding-top: 5px; }
  .record-preview { width: 78px; height: 66px; flex-basis: 78px; }
  .record-main { width: auto; flex: 1 1 0; }
  .record-title-row h2 { white-space: normal; }
  .record-stats { grid-template-columns: repeat(4, 1fr); gap: 12px 0; }
  .record-list.grid-view { grid-template-columns: 1fr; }
  .draft-card .secondary-action { width: 100%; }
}

@media (max-width: 460px) {
  .history-filters { grid-template-columns: 1fr; }
  .history-command-bar > .secondary-action,
  .history-command-bar > .primary-action { flex: 1 1 auto; }
  .record-preview { width: 68px; height: 60px; flex-basis: 68px; }
  .record-meta { gap: 6px 10px; }
}
</style>

<style scoped>
.record-actions { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.record-action { min-height: 26px; padding: 2px 8px; border: 1px solid #e5e7ef; border-radius: 5px; background: var(--color-bg-card); color: #68708b; font-size: var(--font-size-xs); cursor: pointer; }
.record-action:hover { border-color: #5048e5; color: #5048e5; }
.record-action.retry { color: #c43d4d; }
.record-detail-backdrop { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 24px; background: rgba(25, 28, 48, .32); }
.record-detail-modal { width: min(640px, 100%); max-height: min(720px, 90vh); overflow: auto; border-radius: 14px; background: var(--color-bg-card); box-shadow: 0 18px 60px rgba(23, 30, 65, .24); }
.record-detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 22px 24px; border-bottom: 1px solid #edf0f7; }
.record-detail-eyebrow { color: #8b92a7; font-size: var(--font-size-xs); }
.record-detail-header h2 { margin: 4px 0 0; color: #20243e; font-size: var(--font-size-md); }
.record-detail-close { width: 30px; height: 30px; border: 0; border-radius: 50%; background: #f4f5fa; color: #68708b; font-size: var(--font-size-lg); cursor: pointer; }
.record-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 0; padding: 24px; }
.record-detail-grid > div { min-width: 0; border-radius: 8px; padding: 12px; background: #f8f9fc; }
.record-detail-grid dt { color: #8b92a7; font-size: var(--font-size-xs); }
.record-detail-grid dd { margin: 5px 0 0; color: #252a45; font-size: var(--font-size-sm); }
.record-detail-content { grid-column: 1 / -1; }
.record-detail-state { padding: 44px 24px; color: #68708b; text-align: center; }
@media (max-width: 640px) { .record-detail-grid { grid-template-columns: 1fr; } .record-detail-content { grid-column: auto; } .record-title-row { align-items: flex-start; flex-direction: column; } }
</style>
