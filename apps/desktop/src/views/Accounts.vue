<template>
  <div class="accounts-page">
    <h1 class="sr-only">{{ t('accountsPage.pageTitle') }}</h1>
    <section v-if="accountTab !== 'groups' && accountTab !== 'favorites'" class="account-controls" :aria-label="t('accountsPage.filterAria')">
      <div class="search-box platform-search-box">
        <Search class="search-icon" />
        <input v-model="platformSearchInput" type="search" :placeholder="t('accountsPage.searchPlatform')" :aria-label="t('accountsPage.searchPlatform')">
        <button v-if="platformSearchInput" class="clear-search" type="button" :title="t('accountsPage.clearPlatformSearch')" :aria-label="t('accountsPage.clearPlatformSearch')" @click="platformSearchInput = ''"><Close /></button>
      </div>
      <div class="search-box">
        <Search class="search-icon" />
        <input
          v-model="searchInput"
          type="search"
          :placeholder="t('accountsPage.searchAccountName')"
          :aria-label="t('accountsPage.searchAccountOrPlatform')"
          @input="onSearchInput"
        >
        <button v-if="searchInput" class="clear-search" type="button" :title="t('accountsPage.clearSearch')" :aria-label="t('accountsPage.clearSearch')" @click="clearSearch"><Close /></button>
      </div>

      <div class="account-toolbar-selects" :aria-label="t('accountsPage.advancedFilterAria')">
        <select v-model="ownerFilter" :aria-label="t('accountsPage.owner')" :disabled="ownerOptions.length === 0">
          <option value="">{{ ownerOptions.length ? t('accountsPage.owner') : t('accountsPage.ownerEmpty') }}</option>
          <option v-for="owner in ownerOptions" :key="owner" :value="owner">{{ owner }}</option>
        </select>
        <select v-model="publisherFilter" :aria-label="t('accountsPage.publisher')" :disabled="publisherOptions.length === 0">
          <option value="">{{ publisherOptions.length ? t('accountsPage.publisher') : t('accountsPage.publisherEmpty') }}</option>
          <option v-for="publisher in publisherOptions" :key="publisher" :value="publisher">{{ publisher }}</option>
        </select>
      </div>
      <div class="account-sort-controls" role="group" :aria-label="t('accountsPage.sortAria')">
        <select v-model="accountStore.sortBy" data-testid="account-sort" :aria-label="t('accountsPage.sortFieldAria')">
          <option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <button
          type="button"
          data-testid="account-sort-order"
          :aria-label="t('accountsPage.sortAction') + sortOrderLabel"
          :title="t('accountsPage.sortAction') + sortOrderLabel"
          @click="toggleSortOrder"
        >
          <span aria-hidden="true">{{ accountStore.sortOrder === 'desc' ? '↓' : '↑' }}</span>
          <span class="sr-only">{{ sortOrderLabel }}</span>
        </button>
      </div>
      <div class="account-view-toggle" role="group" :aria-label="t('accountsPage.viewAria')">
        <button type="button" data-testid="account-view-grid" :aria-pressed="accountViewMode === 'grid'" @click="accountViewMode = 'grid'">▦</button>
        <button type="button" data-testid="account-view-list" :aria-pressed="accountViewMode === 'list'" @click="accountViewMode = 'list'">☷</button>
      </div>
      <div class="account-command-bar" :aria-label="t('accountsPage.actionsAria')">
        <!-- 检测中只显示短标签：详细进度由 .batch-check-overlay 承载（同 v-if 条件，遮罩正盖住本按钮），
             而命令栏 flex:0 0 auto 不收缩，长进度文案会撑宽它并把整条工具栏挤到换行。 -->
        <button
          class="page-button secondary"
          type="button"
          data-testid="account-batch-check-all"
          :disabled="batchCheckAllBusy || totalAccounts === 0"
          :title="t('accountsPage.batchCheckAll')"
          @click="batchCheckAllLogins"
        >{{ batchCheckAllBusy ? t('accountsPage.batchCheckAllBusy') : t('accountsPage.batchCheckAll') }}</button>
        <button class="page-button secondary" type="button" data-testid="account-batch" @click="accountBatchMode = !accountBatchMode">{{ t('accountsPage.batchAction') }}</button>
        <button class="page-button primary" type="button" data-testid="account-add" @click="showAddDialog = true"><Plus />{{ t('accountsPage.addAccount') }}</button>
      </div>
      <div class="filter-tabs" role="tablist" :aria-label="t('accountsPage.statusAria')">
        <button
          v-for="(item, index) in filterOptions"
          :key="item.value"
          :id="`account-status-tab-${item.value}`"
          type="button"
          role="tab"
          :class="{ active: filter === item.value }"
          :aria-selected="filter === item.value"
          :aria-controls="'account-results'"
          :tabindex="filter === item.value ? 0 : -1"
          @click="setFilter(item.value)"
          @keydown="onFilterKeydown($event, index)"
        >
          {{ item.label }}
        </button>
      </div>
      <span class="account-count">{{ t('accountsPage.countSummary', { platforms: visiblePlatformCount, accounts: visibleAccountCount }) }}</span>
    </section>

    <div v-if="totalAccounts > 0 && accountBatchMode && accountTab !== 'groups' && accountTab !== 'favorites'" class="batch-toolbar">
      <label>
        <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll">
        <span>{{ t('accountsPage.selectAll') }}</span>
      </label>
      <template v-if="selectedCount > 0">
        <span class="selected-count">{{ t('accountsPage.selectedCount', { count: selectedCount }) }}</span>
        <button class="batch-status" type="button" :disabled="batchStatusBusy" @click="handleBatchSetActive(true)">{{ batchStatusBusy ? t('accountsPage.processing') : t('accountsPage.batchEnable') }}</button>
        <button class="batch-status" type="button" :disabled="batchStatusBusy" @click="handleBatchSetActive(false)">{{ batchStatusBusy ? t('accountsPage.processing') : t('accountsPage.batchDisable') }}</button>
        <button class="batch-delete" type="button" @click="handleBatchDelete"><Delete />{{ t('accountsPage.batchDelete') }}</button>
        <button class="batch-cancel" type="button" @click="clearSelection">{{ t('accountsPage.cancelSelection') }}</button>
      </template>
    </div>

    <!-- 登录状态条已移除：登录视图现在以全屏标签形式呈现，NavBar 有「保存账号」按钮 -->
    <!-- QR 预览已移除：扫码登录现在以全屏标签形式呈现 -->

    <main
      id="account-results"
      class="accounts-content"
      role="tabpanel"
      :aria-labelledby="`account-status-tab-${filter}`"
    >
      <RiskSuspendedBanner />
      <section v-if="accountTab === 'share'" class="module-placeholder" data-testid="account-share-panel">
        <div class="module-placeholder-icon" aria-hidden="true"><el-icon><Link /></el-icon></div>
        <h2>{{ t('accountsPage.shareTitle') }}</h2>
        <p>{{ t('accountsPage.shareHint') }}</p>
        <span class="module-placeholder-state" data-testid="account-share-state" role="status">{{ t('accountsPage.shareNotConnected') }}</span>
        <button class="page-button secondary" data-testid="account-share-create" type="button" disabled>{{ t('accountsPage.createShareLink') }}</button>
      </section>
      <AccountGroupsPanel
        v-else-if="accountTab === 'groups'"
        :groups="accountStore.groups || []"
        :accounts="accountStore.accounts"
        :platforms="allPlatforms"
        :platform-label="platformLabel"
        @create="createNewGroup"
        @delete="deleteGroup"
        @rename="renameGroup"
        @set-platform="setGroupPlatform"
        @toggle-account="toggleAccountInGroup"
      />
      <AccountFavoritesPanel
        v-else-if="accountTab === 'favorites'"
        :groups="accountStore.groups || []"
        @open-group="openFavoriteGroup"
      />
      <div v-else class="account-workspace">
        <aside class="platform-filter-panel" :aria-label="t('accountsPage.platformFilterAria')">
          <div class="platform-filter-heading">{{ t('accountsPage.platform') }}</div>
          <button
            type="button"
            :class="{ active: !platformFilter }"
            :aria-pressed="!platformFilter"
            data-testid="platform-filter-all"
            @click="setPlatformFilter('')"
          >
            <span class="platform-filter-icon">全</span>
            <span>{{ t('accountsPage.allPlatforms') }}</span>
            <strong>{{ filteredAccountCount }}</strong>
          </button>
          <button
            v-for="item in visiblePlatformOptions"
            :key="item.id"
            type="button"
            :class="{ active: platformFilter === item.id }"
            :aria-pressed="platformFilter === item.id"
            :data-testid="`platform-filter-${item.id}`"
            @click="setPlatformFilter(item.id)"
          >
            <img v-if="isIconUrl(platformIcon(item.id))" :src="platformIcon(item.id)" class="platform-filter-icon-img" :alt="platformLabel(item.id)" width="20" height="20">
<span v-else class="platform-filter-icon">{{ platformIcon(item.id) }}</span>
            <span>{{ platformLabel(item.id) }}</span>
            <strong>{{ item.count }}</strong>
          </button>
          <section class="group-filter-section" data-testid="account-group-filter" :aria-label="t('accountsPage.groupFilterAria')">
            <div class="group-filter-heading">
              <span>{{ t('accountsPage.groups') }}</span>
              <label :title="t('accountsPage.sharedOnly')">
                <input v-model="sharedOnly" type="checkbox" data-testid="group-shared-only">
                <span>{{ t('accountsPage.sharedOnly') }}</span>
              </label>
            </div>
            <div class="search-box group-search-box">
              <Search class="search-icon" />
              <input v-model="groupSearchInput" type="search" :placeholder="t('accountsPage.searchGroup')" :aria-label="t('accountsPage.searchGroup')">
            </div>
            <button
              type="button"
              :class="{ active: !groupFilter }"
              data-testid="group-filter-all"
              @click="setGroupFilter('')"
            >
              <FolderOpened class="group-filter-icon" />
              <span>{{ t('accountsPage.allGroups') }}</span>
            </button>
            <button
              v-for="group in visibleGroups"
              :key="group.id"
              type="button"
              :class="{ active: groupFilter === group.id }"
              :data-testid="`group-filter-${group.id}`"
              @click="setGroupFilter(group.id)"
            >
              <FolderOpened class="group-filter-icon" />
              <span>{{ group.name }}</span>
              <strong>{{ group.accountIds?.length || 0 }}</strong>
            </button>
            <div v-if="visibleGroups.length === 0" class="group-empty" data-testid="account-group-empty">{{ t('accountsPage.noGroups') }}</div>
          </section>
        </aside>

        <section class="account-results-panel" :aria-label="t('accountsPage.accountListAria')">
          <div v-if="loading" class="loading-state" data-testid="accounts-loading">
            <div class="mp-skeleton-grid">
              <UiSkeleton v-for="i in 4" :key="i" variant="card" class="mp-skeleton-card" />
            </div>
          </div>
          <EmptyState
            v-else-if="authRequired && visibleAccounts.length === 0"
            data-testid="accounts-login-required"
            :title="t('accountsPage.loginRequiredTitle')"
            :description="t('accountsPage.loginRequiredHint')"
            :action-text="t('accountsPage.loginRequiredAction')"
            @action="handleRequireLogin"
          >
            <template #icon><UserFilled /></template>
          </EmptyState>
          <EmptyState
            v-else-if="loadError && visibleAccounts.length === 0"
            data-testid="accounts-error"
            :title="t('accountsPage.errorTitle')"
            :description="t('accountsPage.errorHint')"
            :action-text="t('accountsPage.errorAction')"
            @action="refresh"
          >
            <template #icon><WarningFilled /></template>
          </EmptyState>
          <EmptyState
            v-else-if="visibleAccounts.length === 0"
            data-testid="accounts-empty"
            :title="emptyStateTitle"
            :description="t('accountsPage.emptyMessage')"
            :action-text="t('accountsPage.emptyAction')"
            @action="showAddDialog = true"
          >
            <template #icon><UserFilled /></template>
          </EmptyState>
          <div v-else class="account-card-grid" :class="{ 'account-list-view': accountViewMode === 'list' }">
            <AccountManagementCard
              v-for="account in visibleAccounts"
              :key="account.id"
              :account="account"
              :platform-label="platformLabel(account.platform)"
              :platform-icon="platformIcon(account.platform)"
              :selected="accountStore.selectedIds.has(account.id)"
              :favorite="(accountStore.favoriteIds || emptyIds).has(account.id)"
              :batch-mode="accountBatchMode"
              :verifying="verifyingIds.has(account.id)"
              :creator-hint="t('accountsPage.creatorCardHint')"
              @toggle-select="toggleSelect"
              @toggle-favorite="toggleFavorite"
              @rename="renameAccount"
              @configure-proxy="openProxyDialog"
              @check-login="checkLogin"
              @open-login="reloginAccount"
              :checked-expired-ids="checkedExpiredIds"
              @remove="removeAccount"
            @open-creator="openCreatorCenter"
            />
          </div>
        </section>
      </div>
    </main>

    <!-- 一键检测中央进度提示：检测期间全屏遮罩 + 动态效果，避免长时间无反馈 -->
    <div
      v-if="batchCheckAllBusy"
      class="batch-check-overlay"
      role="status"
      aria-live="polite"
      data-testid="batch-check-overlay"
    >
      <div class="batch-check-card">
        <div class="batch-check-spinner" aria-hidden="true"></div>
        <div class="batch-check-title">{{ t('accountsPage.batchCheckAllTitle') }}</div>
        <div class="batch-check-progress">{{ batchCheckAllProgressText }}</div>
        <!-- 单独一行展示「正在检测哪些平台 + 已耗时」：并发下单个慢账号不再让反馈静止 -->
        <div v-if="batchCheckAllDetailText" class="batch-check-detail" data-testid="batch-check-detail">{{ batchCheckAllDetailText }}</div>
        <div class="batch-check-bar" aria-hidden="true">
          <div
            class="batch-check-bar-inner"
            :style="{ width: batchCheckPercent + '%' }"
          ></div>
        </div>
      </div>
    </div>

    <AccountLoginDialog
      :visible="showAddDialog"
      :platforms="allPlatforms"
      :model-value="newPlatform"
      :mode="selectedLoginMode"
      :busy="adding"
      :qr-available="qrAvailable"
      @update:model-value="newPlatform = $event"
      @update:mode="selectedLoginMode = $event"
      @submit="addAccount"
      @close="showAddDialog = false"
    />

    <AccountProxyDialog
      :visible="showProxyDialog"
      :account="proxyAccount"
      :busy="savingProxy"
      @save="saveProxy"
      @clear="clearProxy"
      @close="closeProxyDialog"
    />

    <AccountAuthorizationGuide
      :visible="showAuthorizationGuide"
      :platform-name="authPlatformName"
      @acknowledge="acknowledgeAuthorizationGuide"
    />

    <!-- 浮动关闭按钮已移除：登录标签可通过 TabBar × 关闭 -->>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Close, Delete, FolderOpened, Link, Plus, Search, UserFilled, WarningFilled } from '@element-plus/icons-vue'
import { useNotify } from '@/composables/useNotify'
import AccountAuthorizationGuide from '@/features/accounts/components/AccountAuthorizationGuide.vue'
import AccountFavoritesPanel from '@/features/accounts/components/AccountFavoritesPanel.vue'
import AccountGroupsPanel from '@/features/accounts/components/AccountGroupsPanel.vue'
import AccountLoginDialog from '@/features/accounts/components/AccountLoginDialog.vue'
import AccountManagementCard from '@/features/accounts/components/AccountManagementCard.vue'
import AccountProxyDialog from '@/features/accounts/components/AccountProxyDialog.vue'
import RiskSuspendedBanner from '@/features/accounts/components/RiskSuspendedBanner.vue'
import { useAccountActions } from '@/composables/useAccountActions'
import { accountBatchCheckLogin } from '@/api/publisher'
import { getApi } from '@/api/electron-bridge'
import { useAccountEvents } from '@/composables/useAccountEvents'
import { useAccountStore } from '@/stores/accounts'
import { usePlatformStore } from '@/stores/platforms'
import { useTabStore } from '@/stores/tab'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { PLATFORM_DASHBOARD_URLS, PLATFORM_LOGIN_URLS } from '@multi-publish/shared-utils/src/platform-definitions'
import { getPlatformIconUrl } from '@/composables/usePlatformIconUrl'
import { formatUserError } from '@/utils/user-facing-error'
import { resolveAccountDisplayName } from '@/utils/account-display-name'
import { useIdentityStore } from '@/stores/identity'
import { useLoginGate } from '@/composables/useLoginGate'

const filterOptions = computed(() => [
  { value: 'all', label: t('accountsPage.filterAll') },
  { value: 'active', label: t('accountsPage.filterActive') },
  { value: 'inactive', label: t('accountsPage.filterInactive') },
  { value: 'favorite', label: t('accountsPage.filterFavorite') },
])
const sortOptions = computed(() => [
  { value: 'name', label: t('accountsPage.sortName') },
  { value: 'platform', label: t('accountsPage.sortPlatform') },
  { value: 'created_at', label: t('accountsPage.sortCreated') },
  { value: 'last_used_at', label: t('accountsPage.sortLastUsed') },
  { value: 'followers', label: t('accountsPage.sortFollowers') },
  { value: 'status', label: t('accountsPage.sortStatus') },
])
const emptyIds = new Set()

const platformStore = usePlatformStore()
const tabStore = useTabStore()
const accountStore = useAccountStore()
const identityStore = useIdentityStore()
const { ensureLogin } = useLoginGate()
const route = useRoute()
const router = useRouter()
const { t, te } = useI18n()
const { notifyError, notifySuccess, notifyWarning, notifyInfo, notifyConfirm } = useNotify()
const accountActions = useAccountActions()
const loading = ref(false)
const showAddDialog = ref(false)
const showProxyDialog = ref(false)
const proxyAccount = ref(null)
const savingProxy = ref(false)
const adding = ref(false)
// completingLogin 已移除（NavBar 保存按钮替代）
const showAuthorizationGuide = ref(false)
const newPlatform = ref('')
const selectedLoginMode = ref('browser')
const accountViewMode = ref('grid')
const batchStatusBusy = ref(false)
const filter = ref('all')
const platformFilter = ref(accountStore.filterPlatform || '')
const groupFilter = ref('')
const groupSearchInput = ref('')
const sharedOnly = ref(false)
const searchInput = ref('')
const platformSearchInput = ref('')
const accountBatchMode = ref(false)
const batchCheckAllBusy = ref(false)
// 一键检测进度（进度卡顿修复 2026-09-22）：checked 只反映已完成数，
// current 记录「正在检测」的平台（并发下可多个），配合秒表让等待可感知；
// 此前只在使用完成边界刷新计数，单个耗时账号会让遮罩看起来死住。
const batchCheckProgress = ref({ checked: 0, total: 0, current: [] })
const batchCheckElapsedSec = ref(0)
let batchCheckTicker = null
let batchCheckStartedAt = 0

function stopBatchCheckTicker () {
  if (batchCheckTicker) {
    clearInterval(batchCheckTicker)
    batchCheckTicker = null
  }
}
const batchCheckCurrentLabels = computed(() => {
  const ids = batchCheckProgress.value.current || []
  // 同平台多账号并发时 current 会重复，展示去重以免出现「抖音、抖音」
  return [...new Set(ids)].map(id => platformLabel(id))
})
const batchCheckAllProgressText = computed(() => {
  const p = batchCheckProgress.value
  if (!p.total) return t('accountsPage.batchCheckAllBusy')
  return t('accountsPage.batchCheckAllProgress', {
    checked: p.checked,
    total: p.total,
    platform: batchCheckCurrentLabels.value[0] || '',
  })
})
const batchCheckAllDetailText = computed(() => {
  const p = batchCheckProgress.value
  if (!p.total) return ''
  const parts = []
  if (batchCheckCurrentLabels.value.length) {
    parts.push(t('accountsPage.batchCheckAllCurrent', { platforms: batchCheckCurrentLabels.value.join('、') }))
  }
  parts.push(t('accountsPage.batchCheckAllElapsed', { seconds: batchCheckElapsedSec.value }))
  return parts.join(' · ')
})
const batchCheckPercent = computed(() => {
  const p = batchCheckProgress.value
  if (!p.total) return 0
  return Math.min(100, Math.round((p.checked / p.total) * 100))
})
const verifyingIds = ref(new Set())
  /** 当前会话中被 checkLogin 确认失效的账号 ID */
  const checkedExpiredIds = ref(new Set())
const pendingAuthAction = ref(null)
const ownerFilter = ref('')
const publisherFilter = ref('')
let searchTimer = null
let resolveAuthorizationGuide = null

platformStore.load()

const accountEvents = useAccountEvents({
  onCompleted: async (_data, mode) => {
    // 成功提示由 useAccountEvents.complete() 统一弹出（「xx 登录凭证已自动保存」），
    // 此处不再重复提示，仅刷新账号列表。避免登录成功后顶部弹出两个重复提示。
    pendingAuthAction.value = null
    await refresh()
  },
  onStatusChanged: async data => {
    await refresh()
    if (Number(data?.expiredCount) > 0) notifyWarning('accountsPage.expiredWarning', { params: { count: data.expiredCount } })
  },
  onError: error => {
    notifyError('accountsPage.eventFailed', { message: formatUserError(error, { fallback: t('accountsPage.eventFailed') }).message })
  },
})
const {
  loginVisible,
  loginMode,
  platform: loginPlatform,
  qrStatus,
  qrImage,
  markOpening,
  start: startAccountEvents,
  stop: stopAccountEvents,
} = accountEvents

const authViewVisible = computed({
  get: () => loginVisible.value,
  set: value => { loginVisible.value = Boolean(value) },
})
const authPlatformName = computed(() => loginPlatform.value ? platformLabel(loginPlatform.value) : t('accountsPage.loginTitle'))
const accountTab = computed(() => String(route.query?.tab || 'accounts'))
const loginStateText = computed(() => {
  if (loginMode.value !== 'qrcode') return t('accountsPage.loginStateBrowser')
  return {
    opening: t('accountsPage.loginStateOpening'),
    waiting: t('accountsPage.loginStateWaiting'),
    detected: t('accountsPage.loginStateDetected'),
    completed: t('accountsPage.loginStateCompleted'),
    closed: t('accountsPage.loginStateClosed'),
  }[qrStatus.value] || t('accountsPage.loginStateRunning')
})
const qrImageSource = computed(() => {
  const image = qrImage.value
  const source = typeof image === 'string' ? image : image?.src || image?.dataUrl || image?.url
  return typeof source === 'string' && /^(data:image\/(?:png|jpeg|jpg|webp);|https:\/\/|blob:)/i.test(source) ? source : ''
})

const allPlatforms = computed(() => platformStore.platforms.map(item => ({ id: item.id, label: item.label })))
const totalAccounts = computed(() => accountStore.accounts.length)
const qrAvailable = computed(() =>
  platformStore.supportsQrCode(newPlatform.value) || newPlatform.value === 'kuaishou'
)
const sortOrderLabel = computed(() => accountStore.sortOrder === 'desc' ? t('accountsPage.sortDesc') : t('accountsPage.sortAsc'))

function shouldShowAuthorizationGuide () {
  try { return localStorage.getItem('account-authorization-guide-seen') !== '1' } catch (_) { return true }
}

function acknowledgeAuthorizationGuide () {
  showAuthorizationGuide.value = false
  try { localStorage.setItem('account-authorization-guide-seen', '1') } catch (_) { /* 隐私模式下仍允许继续 */ }
  if (resolveAuthorizationGuide) {
    resolveAuthorizationGuide()
    resolveAuthorizationGuide = null
  }
}

function waitForAuthorizationGuide () {
  if (!shouldShowAuthorizationGuide()) return Promise.resolve()
  showAuthorizationGuide.value = true
  return new Promise(resolve => { resolveAuthorizationGuide = resolve })
}

watch(filter, value => {
  accountStore.filterStatus = value
}, { flush: 'sync', immediate: true })

watch(() => accountStore.filterPlatform, value => {
  platformFilter.value = value || ''
}, { flush: 'sync', immediate: true })

watch(platformFilter, value => {
  if ((accountStore.filterPlatform || '') !== value) accountStore.filterPlatform = value
}, { flush: 'sync' })

function toggleSortOrder () {
  accountStore.sortOrder = accountStore.sortOrder === 'desc' ? 'asc' : 'desc'
}

function platformLabel (id) {
  return platformStore.getLabel(id) || id
}

function platformIcon (id) {
  // 优先使用真实 SVG 图标 URL
  const iconUrl = getPlatformIconUrl(id)
  if (iconUrl) return iconUrl
  // 回退到 store 中的图标（可能是旧 emoji 或 path）
  const icon = platformStore.getIcon(id)
  if (typeof icon === 'string' && icon.trim()) return icon
  // 最终回退：取平台名首字符
  return (platformLabel(id) || '?').slice(0, 1)
}

/** 判断图标值是否为图片 URL（需要以 <img> 渲染） */
function isIconUrl (value) {
  return typeof value === 'string' && (value.startsWith('/') || value.startsWith('data:') || value.startsWith('http'))
}

const OWNER_FIELD_KEYS = ['owner', 'owner_name', 'ownerName', 'account_owner', 'accountOwner', '负责人']
const PUBLISHER_FIELD_KEYS = ['publisher', 'publisher_name', 'publisherName', 'operator', 'operator_name', 'operatorName', 'publishers', '发布人']

function normalizeAssigneeValues (value) {
  if (Array.isArray(value)) return value.flatMap(normalizeAssigneeValues)
  if (value && typeof value === 'object') return normalizeAssigneeValues(value.name || value.label || value.nickname || value.value)
  const normalized = String(value || '').trim()
  return normalized ? [normalized] : []
}

function accountAssigneeValues (account, keys) {
  return keys.flatMap(key => normalizeAssigneeValues(account?.[key]))
}

function assigneeOptions (keys) {
  const values = new Set()
  for (const account of accountStore.accounts || []) {
    for (const value of accountAssigneeValues(account, keys)) values.add(value)
  }
  return [...values].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

function matchesAssignee (account, keys, expected) {
  return !expected || accountAssigneeValues(account, keys).includes(expected)
}

const ownerOptions = computed(() => assigneeOptions(OWNER_FIELD_KEYS))
const publisherOptions = computed(() => assigneeOptions(PUBLISHER_FIELD_KEYS))
const accountsBeforePlatformFilter = computed(() => {
  void filter.value
  const source = accountStore.accountsBeforePlatformFilter
    || accountStore.filteredAccounts
    || accountStore.accounts
    || []
  const selectedGroup = groupFilter.value
    ? (accountStore.groups || []).find(group => group.id === groupFilter.value)
    : null
  return source.filter(account => (
    (!selectedGroup || (selectedGroup.accountIds || []).includes(account.id))
    && matchesAssignee(account, OWNER_FIELD_KEYS, ownerFilter.value)
    && matchesAssignee(account, PUBLISHER_FIELD_KEYS, publisherFilter.value)
  ))
})
const visibleAccounts = computed(() => {
  const accounts = accountsBeforePlatformFilter.value
  return platformFilter.value
    ? accounts.filter(account => account.platform === platformFilter.value)
    : accounts
})
const groupedPlatforms = computed(() => {
  const groups = new Map()
  for (const account of visibleAccounts.value) {
    if (!groups.has(account.platform)) groups.set(account.platform, { platform: account.platform, accounts: [], activeCount: 0, inactiveCount: 0 })
    const group = groups.get(account.platform)
    group.accounts.push(account)
    if (account.status === 'active' || account.status === 'online') group.activeCount += 1
    else group.inactiveCount += 1
  }
  return [...groups.values()].sort((a, b) => b.activeCount - a.activeCount || b.accounts.length - a.accounts.length)
})
const filteredAccountCount = computed(() => accountsBeforePlatformFilter.value.length)
const visibleAccountCount = computed(() => visibleAccounts.value.length)
const visiblePlatformCount = computed(() => new Set(visibleAccounts.value.map(account => account.platform)).size)
const platformOptions = computed(() => {
  const counts = new Map()
  for (const account of accountsBeforePlatformFilter.value) {
    counts.set(account.platform, (counts.get(account.platform) || 0) + 1)
  }
  return [...counts.entries()].map(([id, count]) => ({ id, count }))
})

const visiblePlatformOptions = computed(() => {
  const query = platformSearchInput.value.trim().toLowerCase()
  if (!query) return platformOptions.value
  return platformOptions.value.filter(item => (
    item.id.toLowerCase().includes(query)
    || platformLabel(item.id).toLowerCase().includes(query)
  ))
})
const visibleGroups = computed(() => {
  const query = groupSearchInput.value.trim().toLowerCase()
  return (accountStore.groups || []).filter(group => {
    if (sharedOnly.value && group.shared !== true && group.is_shared !== true) return false
    if (!query) return true
    return String(group.name || '').toLowerCase().includes(query)
  })
})
// 加载失败原因（store 已格式化为当前语言的友好文案）；空字符串表示无错误
const loadError = computed(() => String(accountStore.error || ''))
// 未登录（后端以 -3 / AUTH_REQUIRED 拒绝）：走登录引导，而非「加载失败 + 重试」错误态
const authRequired = computed(() => {
  const code = accountStore.errorCode
  return (code === 'AUTH_REQUIRED' || code === 'NOT_SIGNED_IN') && !identityStore.isAuthenticated
})
const emptyStateTitle = computed(() => {
  if (totalAccounts.value === 0) return t('accountsPage.emptyNone')
  if (filter.value === 'favorite') return t('accountsPage.emptyNoFavorite')
  if (groupFilter.value) return t('accountsPage.emptyNoGroup')
  return t('accountsPage.emptyNoMatch')
})
const visibleAccountIds = computed(() => visibleAccounts.value.map(account => account.id))
const selectedVisibleIds = computed(() => visibleAccountIds.value.filter(id => accountStore.selectedIds.has(id)))
const selectedCount = computed(() => selectedVisibleIds.value.length)
const isAllSelected = computed(() => visibleAccountIds.value.length > 0 && selectedCount.value === visibleAccountIds.value.length)

function setFilter (value) {
  filter.value = value
}

function setPlatformFilter (value) {
  platformFilter.value = value
}

function setGroupFilter (value) {
  groupFilter.value = value
}

function onFilterKeydown (event, index) {
  const lastIndex = filterOptions.value.length - 1
  let nextIndex = index
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = index === lastIndex ? 0 : index + 1
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = index === 0 ? lastIndex : index - 1
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = lastIndex
  else return

  event.preventDefault()
  const tablist = event.currentTarget?.parentElement
  setFilter(filterOptions.value[nextIndex].value)
  nextTick(() => {
    const tabs = tablist?.querySelectorAll('[role="tab"]')
    tabs?.[nextIndex]?.focus()
  })
}

function onSearchInput () {
  clearTimeout(searchTimer)
  stopBatchCheckTicker()
  searchTimer = setTimeout(() => { accountStore.searchQuery = searchInput.value }, 300)
}

function clearSearch () {
  searchInput.value = ''
  accountStore.searchQuery = ''
}

function toggleSelect (id) {
  accountStore.toggleSelect(id)
}

function toggleSelectAll () {
  accountStore.selectAll(visibleAccountIds.value)
}

function clearSelection () {
  accountStore.clearSelection()
}

function toggleFavorite (id) {
  accountStore.toggleFavorite(id)
}

function createNewGroup (name, platformFilter = '') {
  accountStore.createGroup(name.trim(), platformFilter)
  notifySuccess('accountsPage.groupCreated')
}

function renameGroup (groupId, name) {
  if (!accountStore.renameGroup(groupId, name)) {
    notifyError('accountsPage.groupNameInvalid')
    return
  }
  notifySuccess('accountsPage.groupRenamed')
}

function setGroupPlatform (groupId, platformFilter) {
  accountStore.setGroupPlatform(groupId, platformFilter)
}

async function deleteGroup (groupId) {
  const confirmed = await notifyConfirm('accountsPage.confirmDeleteGroup', { title: t('accountsPage.confirmTitle') })
  if (!confirmed) return
  accountStore.deleteGroup(groupId)
  notifySuccess('accountsPage.groupDeleted')
}

function toggleAccountInGroup (groupId, accountId) {
  accountStore.toggleAccountInGroup(groupId, accountId)
}

function openFavoriteGroup (group) {
  setGroupFilter(group.id)
  router.replace({ path: '/accounts', query: {} })
}

async function handleRequireLogin () {
  const ok = await ensureLogin({ message: t('accountsPage.loginRequiredHint') })
  if (ok) await refresh()
}

async function refresh () {
  loading.value = true
  try {
    await accountStore.load()
    if (accountStore.error) notifyError('accountsPage.loadFailed', { message: accountStore.error })
  } finally {
    loading.value = false
  }
}

async function addAccount () {
  if (!newPlatform.value) {
    notifyWarning('accountsPage.selectPlatform')
    return
  }
  const platform = newPlatform.value
  const mode = selectedLoginMode.value
  adding.value = true
  showAddDialog.value = false
  pendingAuthAction.value = 'add'
  if (mode === 'browser') await waitForAuthorizationGuide()
  markOpening(mode, platform)
  try {
    const result = await accountActions.openLogin(mode, platform)
    if (result?.cancelled) {
      pendingAuthAction.value = null
    } else if (result?.code !== 0) {
      pendingAuthAction.value = null
      notifyError('accountsPage.addFailed', { message: formatUserError(result, { fallback: t('accountsPage.addFailed') }).message })
    }
    if (result?.code === 0) newPlatform.value = ''
  } catch (error) {
    pendingAuthAction.value = null
    notifyError('accountsPage.addAccountFailed', { message: formatUserError(error, { fallback: t('accountsPage.addAccountFailed') }).message })
  } finally {
    adding.value = false
  }
}



// completeAuthView 已移除：登录完成后 CDP 自动检测 + NavBar「保存账号」按钮替代

function addAccountForPlatform (platform) {
  newPlatform.value = platform
  selectedLoginMode.value = 'browser'
  showAddDialog.value = true
}

async function reloginAccount (account) {
  if (!account?.platform) return
  pendingAuthAction.value = 'relogin'
  loginMode.value = 'browser'
  try {
    const result = await accountActions.openLogin('browser', account.platform, account.id)
    if (result?.cancelled) {
      checkedExpiredIds.value.delete(account.id)
      pendingAuthAction.value = null
    } else if (result?.code !== 0) {
      pendingAuthAction.value = null
      notifyError('accountsPage.reloginFailed', { message: formatUserError(result, { fallback: result?.message || t('accountsPage.reloginFailed') }).message })
    }
    // 登录成功由 useAccountEvents.onCompleted 处理（notifySuccess + refresh）
  } catch (error) {
    pendingAuthAction.value = null
    notifyError('accountsPage.reloginFailed', { message: formatUserError(error, { fallback: t('accountsPage.reloginFailed') }).message })
  }
}

// closeAuthView 已移除：登录标签通过 TabBar × 关闭

async function setDefault (account) {
  try {
    const result = await accountStore.setDefault(account.id, account.platform)
    if (result?.code === 0) notifySuccess('accountsPage.setDefaultSuccess', { params: { platform: platformLabel(account.platform) } })
    else notifyError('accountsPage.setDefaultFailed', { message: formatUserError(result, { fallback: t('accountsPage.setDefaultFailed') }).message })
  } catch (error) {
    notifyError('accountsPage.setDefaultFailed', { message: formatUserError(error, { fallback: t('accountsPage.setDefaultFailed') }).message })
  }
}

async function renameAccount (account, nextName) {
  const name = nextName.trim()
  // 「未改动」判定必须与卡片实际显示值同源。用 raw `account_name || name` 比较时，用户输入
  // 恰好等于那串被守卫隐藏的脏值会静默 no-op 且零反馈 —— 屏幕上根本没显示那串字。
  if (!name || name === resolveAccountDisplayName(account, { platformLabel: platformLabel(account.platform) })) return
  try {
    const result = await accountStore.renameAccount(account.id, name)
    if (result?.code !== 0) notifyError('accountsPage.renameFailed', { message: formatUserError(result, { fallback: t('accountsPage.renameFailed') }).message })
  } catch (error) {
    notifyError('accountsPage.renameFailed', { message: formatUserError(error, { fallback: t('accountsPage.renameFailed') }).message })
  }
}

function openPlatform (account) {
  const url = platformStore.getDashboardUrl(account.platform)
  if (url) window.open(url, '_blank')
}

function openProxyDialog (account) {
  proxyAccount.value = account
  showProxyDialog.value = true
}

function closeProxyDialog () {
  if (savingProxy.value) return
  showProxyDialog.value = false
  proxyAccount.value = null
}

async function saveProxy (proxy) {
  if (!proxyAccount.value) return
  savingProxy.value = true
  try {
    const result = await accountActions.setProxy(proxyAccount.value, proxy)
    if (result?.code !== 0) {
      notifyError('accountsPage.saveProxyFailed', { message: formatUserError(result, { fallback: t('accountsPage.saveProxyFailed') }).message })
      return
    }
    notifySuccess('accountsPage.proxySaved')
    await refresh()
    closeProxyDialog()
  } catch (error) {
    notifyError('accountsPage.saveProxyFailed', { message: formatUserError(error, { fallback: t('accountsPage.saveProxyFailed') }).message })
  } finally {
    savingProxy.value = false
  }
}

async function clearProxy () {
  if (!proxyAccount.value) return
  savingProxy.value = true
  try {
    const result = await accountActions.setProxy(proxyAccount.value, null)
    if (result?.code !== 0) {
      notifyError('accountsPage.clearProxyFailed', { message: formatUserError(result, { fallback: t('accountsPage.clearProxyFailed') }).message })
      return
    }
    notifySuccess('accountsPage.proxyCleared')
    await refresh()
    closeProxyDialog()
  } catch (error) {
    notifyError('accountsPage.clearProxyFailed', { message: formatUserError(error, { fallback: t('accountsPage.clearProxyFailed') }).message })
  } finally {
    savingProxy.value = false
  }
}

async function checkLogin (account) {
  const id = account?.id
  if (!id || !account?.platform) return
  if (verifyingIds.value.has(id)) return
  verifyingIds.value = new Set([...verifyingIds.value, id])
  // 立即显示"检测中…"提示，让用户知道操作已触发
  const platformName = platformLabel(account.platform) || account.platform
  notifyInfo('accountsPage.verifyingLogin', { params: { platform: platformName } })
  try {
    const result = await accountActions.checkLogin(account)
    const verdict = result?.code === 0 ? result.data?.valid : undefined
    if (verdict === true) {
      notifySuccess('accountsPage.loginValid', { message: t('accountsPage.loginValid', { platform: platformName }) })
    } else if (verdict === undefined) {
      // 三态契约：既非有效也非失效 = 本轮未取到定论。不得冒充「已失效」弹出去登录引导，
      // 也不得反向清除既有的会话失效标记 —— 与批量侧同一口径，证据缺席时什么都不改。
      notifyInfo('accountsPage.loginUnconfirmed', { params: { platform: platformName } })
    } else {
      checkedExpiredIds.value.add(id)
      // 使用错误码映射到 i18n 文案，避免后端硬编码消息直接展示
      const errorCode = result?.data?.code || 'CHECK_LOGIN_COOKIE_EXPIRED'
      const reasonKey = 'accountsPage.accountCheckStatus.' + errorCode
      const reason = te(reasonKey) ? t(reasonKey) : t('accountsPage.loginExpired')
      const confirmed = await notifyConfirm('accountsPage.loginExpiredConfirm', {
        title: t('accountsPage.confirmTitle'),
        message: t('accountsPage.loginExpiredMessage', { platform: platformName, reason: reason }),
        confirmButtonText: t('accountsPage.goLogin'),
        cancelButtonText: t('accountsPage.cancel'),
        type: 'warning',
      })
      if (confirmed) {
        // 使用 reloginAccount 走完整认证流程（auth:open-login），
        // 而非 openLoginPage 的普通浏览器标签页（无凭证捕获机制，登录成功也无法保存）
        await reloginAccount(account)
      }
    }
  } catch (error) {
    notifyError('accountsPage.verifyFailed', { message: formatUserError(error, { fallback: t('accountsPage.verifyFailed') }).message })
  } finally {
    const next = new Set(verifyingIds.value)
    next.delete(id)
    verifyingIds.value = next
  }
}

/**
 * 一键检测所有账号的登录状态（对齐首页登录失效提醒区域的批量检测语义）。
 * 调用主进程 accounts:batch-check-login（空数组 = 当前用户全部账号），
 * 检测期间所有账号卡片进入 verifying 态；完成后按结果更新本地 status
 * 并汇总提示正常/失效数量。不弹逐账号确认框，失效账号由用户在卡片上
 * 单独点击「验证」走 relogin 流程。
 */
async function batchCheckAllLogins () {
  if (batchCheckAllBusy.value) return
  const accounts = accountStore.accounts || []
  if (accounts.length === 0) {
    notifyWarning('accountsPage.batchCheckAllNoAccounts')
    return
  }
  batchCheckAllBusy.value = true
  batchCheckProgress.value = { checked: 0, total: accounts.length, current: [] }
  batchCheckElapsedSec.value = 0
  batchCheckStartedAt = Date.now()
  stopBatchCheckTicker()
  batchCheckTicker = setInterval(() => {
    batchCheckElapsedSec.value = Math.max(0, Math.floor((Date.now() - batchCheckStartedAt) / 1000))
  }, 1000)
  verifyingIds.value = new Set(accounts.map(a => a.id))
  notifyInfo('accountsPage.batchCheckAllStarted', { params: { count: accounts.length } })
  // 订阅主进程进度事件（accounts:batch-check-progress）：主进程在每个账号
  // 开始检测前推 start、完成后推 done，渲染层据此维护「正在检测哪些平台」。
  const api = getApi()
  let offProgress = null
  try {
    if (api?.onAccountsBatchCheckProgress) {
      offProgress = api.onAccountsBatchCheckProgress((data) => {
        if (!data || !batchCheckAllBusy.value) return
        const total = Number(data.total) || accounts.length
        const checked = Number(data.checked) || 0
        const platform = String(data.platform || '')
        const inflight = (batchCheckProgress.value.current || []).slice()
        if (data.phase === 'done') {
          const at = inflight.indexOf(platform)
          if (at !== -1) inflight.splice(at, 1)
        } else if (platform && !inflight.includes(platform)) {
          inflight.push(platform)
        }
        batchCheckProgress.value = { checked, total, current: inflight }
      })
    }
  } catch (_) { /* 事件订阅失败不阻断检测 */ }
  try {
    const result = await accountBatchCheckLogin(accounts.map(a => a.id))
    const results = result?.code === 0 ? result.data?.results : []
    if (!Array.isArray(results)) throw new Error('invalid batch-check response')
    let validCount = 0
    const invalidIds = []
    let unconfirmedCount = 0
    const persistFailedIds = []
    const checkedAt = result.data?.checkedAt || new Date().toISOString()
    for (const item of results) {
      if (!item?.accountId) continue
      // 三态口径：valid === true 正常 / valid === false 失效 / valid === undefined 本轮未取到定论。
      // 未取到定论既不计入失效数量、也不加入失效集合 —— 不冒充任何一侧结论；
      // 且主进程此时不会改写真源，loginStatus 回传的是**保持后的原状态**（单向证据规则）。
      if (item.valid === true) {
        validCount++
        checkedExpiredIds.value.delete(item.accountId)
      } else if (item.valid === false) {
        invalidIds.push(item.accountId)
        checkedExpiredIds.value.add(item.accountId)
      } else {
        unconfirmedCount++
        checkedExpiredIds.value.delete(item.accountId)
      }
      const account = accounts.find(a => a.id === item.accountId)
      if (account) {
        // 这里只做本次会话的乐观展示。持久化由主进程在 accounts:batch-check-login
        // 内部通过 AccountManager.persistLoginState 单点写回后端 accounts.json。
        // 渲染层不得再自行写 status —— 历史实现写的是 Electron 本地 SQLite
        // （store:update-account），而读取端是后端 accounts.json，两边 id 都不互通，
        // 这正是「一键检测后重进账号页又显示已登录」的根因。
        // 状态只跟随主进程真源结论：loginStatus 缺席（现状读不到）时保持原样，
        // 渲染层不再从 valid 三元推导，否则单向证据规则在展示层又被绕开一次。
        if (item.loginStatus) account.status = item.loginStatus
        // 未改写真源时不得本地伪造一个新的定论时间，否则「最近检查」会指向一次没有结论的检测
        if (item.statusChanged !== false) account.last_validated = checkedAt
      }
      if (item.persisted && item.persisted.ok === false) persistFailedIds.push(item.accountId)
    }
    if (invalidIds.length === 0 && unconfirmedCount === 0) {
      notifySuccess('accountsPage.batchCheckAllAllValid', { params: { count: validCount } })
    } else {
      notifyWarning('accountsPage.batchCheckAllDone', { params: { valid: validCount, invalid: invalidIds.length, unconfirmed: unconfirmedCount } })
    }
    if (persistFailedIds.length > 0) {
      // 固化失败必须可见，否则用户会再次遇到「检测过了但重进又变回去」。
      notifyError('accountsPage.batchCheckAllPersistFailed', { params: { count: persistFailedIds.length } })
    }
  } catch (error) {
    notifyError('accountsPage.batchCheckAllFailed', { message: formatUserError(error, { fallback: t('accountsPage.batchCheckAllFailed') }).message })
  } finally {
    if (offProgress) { try { offProgress() } catch (_) { /* ignore */ } }
    stopBatchCheckTicker()
    batchCheckElapsedSec.value = 0
    batchCheckProgress.value = { checked: 0, total: 0, current: [] }
    verifyingIds.value = new Set()
    batchCheckAllBusy.value = false
  }
}

/**
 * 打开创作者中心（在新标签页中全屏显示）
 */
async function openCreatorCenter(account) {
  if (!account?.platform) {
    notifyError('accountsPage.accountIncomplete')
    return
  }
  const url = PLATFORM_DASHBOARD_URLS[account.platform]
  if (!url) {
    notifyWarning('accountsPage.creatorUnsupported')
    return
  }
  await tabStore.createTab({ url, platform: account.platform, accountId: account.id, title: t('accountsPage.creatorTabTitle', { platform: platformLabel(account.platform) }) })
}

async function openLoginPage (account) {
  if (!account?.platform) {
    notifyError('accountsPage.accountIncomplete')
    return
  }
  const url = PLATFORM_LOGIN_URLS[account.platform]
  if (!url) {
    notifyWarning('accountsPage.loginUnsupported')
    return
  }
  // 失效账号打开登录页必须用干净会话：旧身份 Cookie（如微信 wxuin）会让平台
  // 在二维码环节静默拒绝（getqrcode 200 空体）；有效账号仍恢复 Cookie 以便免登录
  const cleanSession = account?.status === 'expired'
  await tabStore.createTab({ url, platform: account.platform, accountId: account.id, cleanSession, title: t('accountsPage.loginTab', { platform: platformLabel(account.platform) }) })
}

async function removeAccount (account) {
  const confirmed = await notifyConfirm('accountsPage.confirmDeleteAccount', {
    title: t('accountsPage.confirmDeleteTitle'),
    params: { platform: platformLabel(account.platform), name: resolveAccountDisplayName(account, { platformLabel: platformLabel(account.platform) }) },
  })
  if (!confirmed) return
  try {
    const result = await accountActions.remove(account.id)
    if (result?.code !== 0) {
      notifyError('accountsPage.deleteFailed', { message: formatUserError(result, { fallback: t('accountsPage.deleteFailed') }).message })
      return
    }
    notifySuccess('accountsPage.accountDeleted')
    await refresh()
  } catch (error) {
    if (error !== 'cancel' && error?.message !== 'canceled') notifyError('accountsPage.operationFailed', { message: t('accountsPage.operationFailed') + formatUserError(error, { fallback: t('accountsPage.unknownError') }).message })
  }
}

async function handleBatchDelete () {
  const ids = [...selectedVisibleIds.value]
  const count = ids.length
  if (count === 0) return
  const confirmed = await notifyConfirm('accountsPage.confirmBatchDelete', {
    title: t('accountsPage.confirmBatchDeleteTitle'),
    params: { count },
    confirmButtonText: t('accountsPage.confirmDeleteBtn'),
    cancelButtonText: t('accountsPage.cancelBtn'),
  })
  if (!confirmed) return
  try {
    const result = await accountStore.batchDelete(ids)
    const { success, failed } = result || {}
    if (!Number.isInteger(success) || !Number.isInteger(failed) || success < 0 || failed < 0 || success + failed !== count) {
      throw new Error(t('accountsPage.batchDeleteInvalid'))
    }
    if (failed === 0) notifySuccess('accountsPage.deletedCount', { params: { count: success } })
    else if (success > 0) notifyWarning('accountsPage.deletedPartial', { params: { success, failed } })
    else notifyError('accountsPage.deletedFailed', { params: { count: failed } })
  } catch (error) {
    if (error !== 'cancel' && error?.message !== 'canceled') notifyError('accountsPage.batchDeleteFailed', { message: t('accountsPage.batchDeleteFailed') + formatUserError(error, { fallback: t('accountsPage.unknownError') }).message })
  }
}

// 入参是布尔而不是登录态词表字符串：启用态与登录态是两个正交概念。
async function handleBatchSetActive (isActive) {
  const ids = [...selectedVisibleIds.value]
  if (ids.length === 0 || batchStatusBusy.value) return
  batchStatusBusy.value = true
  const action = isActive ? 'enable' : 'disable'
  try {
    const result = await accountStore.batchSetActive(isActive, ids)
    const { success = 0, failed = 0 } = result || {}
    if (failed === 0) notifySuccess(isActive ? 'accountsPage.enabledCount' : 'accountsPage.disabledCount', { params: { count: success } })
    else if (success > 0) notifyWarning('accountsPage.statusPartial', { params: { action, success, failed } })
    else notifyError('accountsPage.statusFailed', { params: { action } })
  } catch (error) {
    notifyError('accountsPage.statusFailed', { message: formatUserError(error, { fallback: t('accountsPage.statusFailed', { action }) }).message })
  } finally {
    batchStatusBusy.value = false
  }
}

onMounted(() => {
  accountStore.loadGroups()
  startAccountEvents()
  refresh()
})

onUnmounted(() => {
  clearTimeout(searchTimer)
  stopBatchCheckTicker()
  if (resolveAuthorizationGuide) resolveAuthorizationGuide()
  resolveAuthorizationGuide = null
  stopAccountEvents()
})
</script>

<style scoped>
.accounts-page { min-height: 100%; background: var(--color-bg-inset); color: var(--text-primary, #28282f); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.accounts-header { min-height: 72px; box-sizing: border-box; padding: 18px 24px 12px; background: var(--color-bg-card); border-bottom: 1px solid #edf0f7; }
.accounts-header .page-title { color: #1f2340; font-size: var(--font-size-lg); font-weight: 700; }
.accounts-header .page-actions { margin-top: 0; }
.accounts-header { gap: 16px; }
.page-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.page-button {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  background: var(--color-bg-card);
  color: #4d4e57;
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.page-button svg { width: 15px; height: 15px; }
.page-button.primary { border-color: #5048e5; background: #5048e5; color: #fff; }
.page-button:disabled { opacity: 0.58; cursor: not-allowed; }
.page-button.danger { border-color: #d85a68; background: #d85a68; color: #fff; }
.page-button:focus-visible,
.clear-search:focus-visible,
.filter-tabs button:focus-visible,
.batch-toolbar button:focus-visible,
.login-state button:focus-visible,
.floating-close-button:focus-visible {
  outline: 2px solid #5048e5;
  outline-offset: 2px;
}
.account-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 14px 24px 10px;
  border-bottom: 1px solid var(--border-light, #e8e8ec);
  background: var(--color-bg-card);
}
.search-box { position: relative; display: flex; align-items: center; }
.search-box input {
  width: 100%;
  height: 36px;
  padding: 7px 34px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 6px;
  background: var(--color-bg-card);
  color: #28282f;
  font-size: var(--font-size-sm);
  outline: none;
}
.search-box input:focus { border-color: #5048e5; box-shadow: 0 0 0 2px rgba(80, 72, 229, 0.1); }
.search-icon { position: absolute; left: 11px; z-index: 1; width: 15px; height: 15px; color: #92939c; }
.clear-search { position: absolute; right: 6px; width: 26px; height: 26px; display: grid; place-items: center; border: 0; background: transparent; color: #92939c; cursor: pointer; }
.clear-search svg { width: 13px; height: 13px; }
.filter-tabs { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 7px; background: var(--color-bg-inset); }
.filter-tabs button { min-height: 30px; padding: 4px 9px; border: 0; border-radius: 5px; background: transparent; color: #6f7079; font-size: var(--font-size-sm); white-space: nowrap; cursor: pointer; }
.filter-tabs button.active { background: var(--color-bg-card); color: #5048e5; box-shadow: 0 1px 3px rgba(28, 28, 35, 0.12); }
.account-count { color: #85858f; font-size: var(--font-size-xs); white-space: nowrap; }
.batch-toolbar { min-height: 42px; display: flex; align-items: center; gap: 12px; padding: 6px 24px; border-bottom: 1px solid #e8e8ec; background: var(--color-bg-inset); }
.batch-toolbar label { display: inline-flex; align-items: center; gap: 7px; font-size: var(--font-size-sm); cursor: pointer; }
.batch-toolbar input { width: 15px; height: 15px; accent-color: #5048e5; }
.selected-count { color: #5048e5; font-size: var(--font-size-sm); font-weight: 600; }
.batch-toolbar button { min-height: 28px; display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border: 0; border-radius: 4px; background: transparent; font-size: var(--font-size-xs); cursor: pointer; }
.batch-toolbar svg { width: 14px; height: 14px; }
.batch-status { border: 1px solid #c9c5ff !important; color: #5048e5; background: #fff !important; }
.batch-status:disabled { opacity: .55; cursor: not-allowed; }
.batch-delete { color: #c43d4d; }
.batch-cancel { color: #5f6069; }
.login-state { position: fixed; top: 56px; left: 280px; right: 0; z-index: 9700; height: 44px; box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 7px 24px; border-bottom: 1px solid #dcd9ff; background: #f3f2ff; color: #3d378f; }
.login-state > svg { width: 20px; height: 20px; }
.login-state div { display: flex; align-items: baseline; gap: 9px; flex: 1; min-width: 0; overflow: hidden; }
.login-state strong { flex: 0 0 auto; font-size: var(--font-size-sm); }
.login-state span { min-width: 0; overflow: hidden; color: #6e69a0; font-size: var(--font-size-xs); text-overflow: ellipsis; white-space: nowrap; }
.login-state-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
.login-qr-preview { position: fixed; top: 108px; right: 24px; z-index: 9701; width: 188px; display: grid; justify-items: center; gap: 8px; padding: 12px; border: 1px solid #dcd9ff; border-radius: 8px; background: var(--color-bg-card); box-shadow: 0 8px 24px rgba(46, 43, 110, 0.16); color: #6e69a0; font-size: var(--font-size-xs); text-align: center; }
.login-qr-preview img { width: 164px; height: 164px; object-fit: contain; border-radius: 4px; background: var(--color-bg-card); }
.login-state-actions button { border: 0; background: transparent; color: #5048e5; font-size: var(--font-size-xs); cursor: pointer; }
.login-state-actions .complete-login { min-height: 28px; padding: 4px 9px; border: 1px solid #5048e5; border-radius: 5px; background: #5048e5; color: #fff; }
.login-state-actions button:disabled { opacity: 0.58; cursor: not-allowed; }
.accounts-content { min-height: 520px; padding: 0; }
.module-placeholder { min-height: 320px; display: grid; place-items: center; align-content: center; gap: 8px; padding: 32px; background: var(--color-bg-inset); color: #707080; text-align: center; }
.module-placeholder h2 { margin: 0; color: #25252b; font-size: var(--font-size-md); }
.module-placeholder p { max-width: 480px; margin: 0; font-size: var(--font-size-sm); line-height: 1.6; }
.module-placeholder-icon { font-size: var(--font-size-xl); opacity: .72; }
.module-placeholder-state { border-radius: 999px; padding: 3px 9px; background: #ececf1; color: #777985; font-size: var(--font-size-xs); }
.module-placeholder .page-button { margin-top: 4px; }
.account-workspace { min-height: 520px; display: grid; grid-template-columns: 240px minmax(0, 1fr); }
.platform-filter-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-right: 1px solid var(--border-light, #e8e8ec);
  padding: 16px 12px 24px;
  background: var(--color-bg-card);
}
.platform-filter-heading { padding: 0 8px 7px; color: #85858f; font-size: var(--font-size-xs); }
.platform-filter-panel button {
  min-width: 0;
  min-height: 42px;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 6px;
  padding: 6px 9px;
  background: transparent;
  color: #595a64;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
}
.platform-filter-panel button:hover { background: #f6f6f9; }
.platform-filter-panel button.active { background: #efedff; color: #5048e5; font-weight: 600; }
.platform-filter-panel button:focus-visible { outline: 2px solid #5048e5; outline-offset: 2px; }
.platform-filter-panel button > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.platform-filter-panel button strong { color: #9697a0; font-size: var(--font-size-xs); font-weight: 500; }
.platform-filter-icon { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; background: #f3f3f6; font-size: var(--font-size-xs); }
.platform-filter-panel button.active .platform-filter-icon { background: var(--color-bg-card); }
.group-filter-section { display: flex; flex-direction: column; gap: 4px; margin-top: 18px; padding-top: 14px; border-top: 1px solid #eff0f4; }
.group-filter-heading { display: flex; align-items: center; justify-content: space-between; padding: 0 8px 5px; color: #85858f; font-size: var(--font-size-xs); }
.group-filter-heading label { display: inline-flex; align-items: center; gap: 5px; color: #999ba6; font-size: var(--font-size-xs); cursor: pointer; }
.group-filter-heading input { width: 14px; height: 14px; accent-color: #5048e5; }
.group-search-box { padding: 0 0 2px; }
.group-search-box input { height: 32px; padding: 5px 28px; border-color: #e9eaf0; background: #fafbfe; font-size: var(--font-size-xs); }
.group-search-box .search-icon { left: 9px; width: 14px; height: 14px; }
.group-filter-section button { min-height: 36px; grid-template-columns: 24px minmax(0, 1fr) auto; padding: 5px 9px; font-size: var(--font-size-xs); }
.group-filter-icon { width: 17px; height: 17px; color: #8e91a5; }
.group-filter-section button.active .group-filter-icon { color: #5048e5; }
.group-empty { padding: 12px 8px 4px; color: #9b9ca6; font-size: var(--font-size-xs); text-align: center; }
.account-results-panel { min-width: 0; padding: 24px 32px 32px; background: var(--color-bg-inset); }
.account-card-grid { display: grid; align-items: start; }
.loading-state, .empty-state { min-height: 260px; display: flex; align-items: center; justify-content: center; color: #85858f; font-size: var(--font-size-sm); }
.empty-state { flex-direction: column; gap: 10px; }
.empty-state svg { width: 38px; height: 38px; color: #b3b4bc; }
.empty-state h2 { margin: 0; color: #696a73; font-size: var(--font-size-base); font-weight: 600; }
.floating-close-button {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 9999;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 0;
  border-radius: 6px;
  background: #d34d5d;
  color: #fff;
  font-size: var(--font-size-sm);
  box-shadow: 0 5px 16px rgba(45, 31, 35, 0.22);
  cursor: pointer;
}
.floating-close-button svg { width: 15px; height: 15px; }
@media (max-width: 900px) {
  .account-count { margin-left: 0; }
  .account-workspace { grid-template-columns: 1fr; }
  .platform-filter-panel { overflow-x: auto; flex-direction: row; border-right: 0; border-bottom: 1px solid var(--border-light, #e8e8ec); padding: 10px 12px; }
  .platform-filter-heading { display: none; }
  .platform-filter-panel button { min-width: max-content; grid-template-columns: 26px auto auto; }
  .account-results-panel { padding: 14px 12px 24px; }
  .floating-close-button { display: none; }
}
@media (max-width: 1360px) {
  .login-state { left: 0; }
}
</style>

<style scoped>
/* 工具栏收缩预算：原先用 8 列 grid 排布，最小内容宽度约 1600px，而常见窗口
   （1920 物理 / 125% 缩放 = 1536 CSS，减 200 侧边栏 = 1336）容纳不下；grid 没有换行机制，
   只能横向溢出并把最右侧轨道压到 min-content——中文可在任意字符间断行，
   「全部/已登录/未登录/收藏」因此被压成逐字竖排。改为 flex-wrap + 显式收缩分工：
   按钮与图标组一律不收缩，只有两个搜索框和筛选下拉参与收缩（下拉用省略号收口），
   窗口实在不足时整条工具栏换行兜底，不再出现逐字竖排。 */
.account-controls { gap: 10px; padding: 14px 20px 10px; }
.account-controls > * { min-width: 0; }
.account-sort-controls, .account-view-toggle, .account-command-bar, .filter-tabs, .account-count { flex: 0 0 auto; }
.account-count { margin-left: auto; }
/* 账号卡片网格列口径单一来源：加载骨架 mp-skeleton-grid 与真实卡片栅格 account-card-grid 消费同一组 CSS 变量，
   两端列数与间距天然一致；width 100% 让骨架栅格在 flex 居中的 loading-state 内仍占满面板，
   避免 auto-fill 在不确定宽度下塌缩成 1 列（即"加载中 1 列 → 加载完突然多列"布局跳动的根因）。 */
.account-results-panel { --account-grid-columns: repeat(auto-fill, minmax(280px, 1fr)); --account-grid-gap: 24px; }
.account-card-grid { grid-template-columns: var(--account-grid-columns); gap: var(--account-grid-gap); }
.loading-state .mp-skeleton-grid { width: 100%; grid-template-columns: var(--account-grid-columns); gap: var(--account-grid-gap); }
.platform-search-box { flex: 1 1 112px; min-width: 84px; }
.account-controls > .search-box:not(.platform-search-box) { flex: 1 1 112px; min-width: 84px; }
.account-command-bar { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; }
.account-command-bar .page-button { white-space: nowrap; padding: 5px 8px; }
.account-toolbar-selects { display: flex; align-items: center; flex: 1 1 180px; min-width: 148px; gap: 8px; }
.account-sort-controls { display: inline-flex; align-items: center; gap: 4px; }
.account-sort-controls select { width: 92px; min-width: 0; height: 36px; border: 1px solid #e8ebf2; border-radius: 8px; padding: 0 10px; background: #f8f9fc; color: #5f6475; font-size: var(--font-size-sm); text-overflow: ellipsis; }
.account-sort-controls button { width: 36px; height: 36px; border: 1px solid #e8ebf2; border-radius: 8px; background: #f8f9fc; color: #5048e5; font-size: var(--font-size-md); line-height: 1; cursor: pointer; }
.account-sort-controls button:focus-visible { outline: 2px solid #5048e5; outline-offset: 2px; }
.account-toolbar-selects select { flex: 1 1 0; min-width: 0; height: 36px; border: 1px solid #e8ebf2; border-radius: 8px; padding: 0 8px; background: #f8f9fc; color: #9aa0b2; font-size: var(--font-size-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.account-view-toggle { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid #e8ebf2; border-radius: 8px; background: #f8f9fc; }
.account-view-toggle button { width: 32px; height: 30px; border: 0; border-radius: 6px; background: transparent; color: #8b92a7; font-size: var(--font-size-md); cursor: pointer; }
.account-view-toggle button[aria-pressed="true"] { background: var(--color-bg-card); color: #5048e5; box-shadow: 0 1px 3px rgba(44, 48, 77, .12); }
.account-card-grid.account-list-view { display: flex; flex-direction: column; gap: 12px; }
.account-list-view :deep(.account-card) { min-height: 0; flex-direction: row; align-items: center; }
.account-list-view :deep(.account-card-header) { flex: 0 0 170px; }
.account-list-view :deep(.account-profile) { flex: 1; flex-direction: row; gap: 14px; padding: 10px 18px; text-align: left; }
.account-list-view :deep(.account-identity) { margin-top: 0; }
.account-list-view :deep(.account-name-button) { justify-content: flex-start; text-align: left; }
.account-list-view :deep(.account-details) { justify-content: flex-start; }
.account-list-view :deep(.account-actions) { flex: 0 0 300px; border-top: 0; border-left: 1px solid var(--border-light, #efeff2); }
@media (max-width: 1100px) { .account-toolbar-selects { display: none; } }
@media (max-width: 720px) { .account-view-toggle { display: none; } }
@media (max-width: 900px) {
  .account-toolbar-selects { flex-wrap: wrap; }
  .account-sort-controls { flex-wrap: wrap; }
  .account-command-bar { justify-content: flex-start; flex-wrap: wrap; }
  .filter-tabs { max-width: 100%; overflow-x: auto; }
}

/* 一键检测中央进度提示：全屏半透明遮罩 + 居中卡片 + 旋转动画 + 进度条 */
.batch-check-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(30, 30, 45, 0.45);
  backdrop-filter: blur(2px);
}

.batch-check-card {
  width: min(360px, calc(100vw - 48px));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 32px 28px;
  border-radius: 14px;
  background: var(--color-bg-card);
  box-shadow: 0 16px 48px rgba(30, 30, 55, 0.22);
  text-align: center;
}

.batch-check-spinner {
  width: 42px;
  height: 42px;
  border: 4px solid #e6e4f7;
  border-top-color: #5048e5;
  border-radius: 50%;
  animation: batch-check-spin 0.9s linear infinite;
}

@keyframes batch-check-spin {
  to { transform: rotate(360deg); }
}

.batch-check-detail {
  color: #6b6b78;
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.batch-check-title {
  color: #2b2b35;
  font-size: var(--font-size-base);
  font-weight: 600;
}

.batch-check-progress {
  min-height: 18px;
  color: #85858f;
  font-size: var(--font-size-sm);
}

.batch-check-bar {
  width: 100%;
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: #f0f0f5;
}

.batch-check-bar-inner {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #6a62f0, #5048e5);
  transition: width 0.3s ease;
}
</style>
