<template>
  <div class="create-view-history">
    <div v-if="historyLocalMode" class="history-local-mode-banner" data-testid="history-local-mode-banner">
      {{ historyLocalModeText || tr('localMode') }}
    </div>

    <div class="history-toolbar">
      <div
        class="history-status-tabs"
        role="tablist"
        :aria-label="tr('statusFilter')"
        @keydown="onTablistKeydown"
      >
        <button
          v-for="status in statusTabs"
          :key="status"
          ref="historyTabs"
          type="button"
          role="tab"
          class="history-status-tab"
          :class="{ active: activeFilter === status }"
          :data-status="status"
          :aria-selected="activeFilter === status ? 'true' : 'false'"
          :tabindex="activeFilter === status ? 0 : -1"
          @click="selectFilter(status)"
        >
          <span>{{ tr('tabs.' + status) }}</span>
          <span class="history-status-tab-count" aria-hidden="true">{{ statusCounts[status] }}</span>
        </button>
      </div>
      <div class="history-toolbar-right">

        <label class="history-sort-label" for="history-sort-select">{{ tr('sortBy') }}</label>

        <select

          id="history-sort-select"

          v-model="sortMode"

          class="history-sort-select"

          data-testid="history-sort-select"

          :aria-label="tr('sortBy')"

          @change="onSortModeChange"

        >

          <option v-for="mode in sortOptions" :key="mode" :value="mode">{{ tr('sortOptions.' + mode) }}</option>

        </select>

        <span class="history-count">{{ statusCounts.all }} {{ tr('records') }}</span>

      </div>
    </div>

    <div v-if="!historyLoading && filteredHistory.length > 0" class="history-batch-bar" data-testid="history-batch-bar">
      <label class="history-select-all">
        <input
          type="checkbox"
          data-testid="history-select-all"
          :checked="allSelected"
          :disabled="deleting"
          @change="toggleSelectAll"
        />
        <span>{{ allSelected ? tr('deselectAll') : tr('selectAll') }}</span>
      </label>
      <span class="history-selected-count" data-testid="history-selected-count">{{ tr('selectedCount', { count: selectedIdentities.length }) }}</span>
      <button
        type="button"
        class="s2v-btn-danger s2v-btn-sm"
        data-testid="history-batch-delete-button"
        :disabled="selectedIdentities.length === 0 || story2videoResuming || deleting"
        @click.stop="emitBatchDelete"
      >{{ tr('batchDelete') }}</button>
    </div>

    <div v-if="historyLoading" class="loading-state" data-testid="history-loading">
      <UiSkeleton variant="list" :count="5" />
    </div>
    <EmptyState
      v-else-if="history.length === 0"
      data-testid="create-history-empty"
      :title="tr('emptyTitle')"
      :description="tr('emptyHint')"
      :action-text="tr('emptyAction')"
      icon=""
      @action="$emit('create-content')"
    />
    <EmptyState
      v-else-if="filteredHistory.length === 0"
      compact
      data-testid="create-history-filter-empty"
      :title="tr('emptyFilter')"
      :action-text="tr('emptyFilterAction')"
      icon=""
      @action="$emit('reset-history-filter')"
    />

    <div v-else class="history-list" role="list">
      <div
        v-for="(item, index) in displayHistory"
        :key="historyIdentity(item, index)"
        class="history-item"
        :class="[
          'status-' + (item.status || 'unknown'),
          { 'is-running': item.status === 'running', 'is-interactive': historyItemOpenable(item), 'is-cancelled': item.status === 'cancelled' },
        ]"
        :data-history-id="historyIdentity(item, index)"
      >
        <div
          class="history-item-body"
          :class="{ 'is-interactive': historyItemOpenable(item) }"
          :role="historyItemOpenable(item) ? 'button' : undefined"
          :tabindex="historyItemOpenable(item) ? 0 : undefined"
          :aria-label="historyItemOpenable(item) ? tr('viewDetail') + ': ' + historyTitle(item) : undefined"
          @click="openDetail(item)"
          @keydown.enter.prevent="openDetail(item)"
          @keydown.space.prevent="openDetail(item)"
        >
          <div class="history-item-row history-item-heading">
            <span class="history-item-select" @click.stop>
              <input
                type="checkbox"
                class="history-select-checkbox"
                data-testid="history-select-checkbox"
                :checked="isSelected(item, index)"
                :disabled="story2videoResuming || deleting"
                @change="toggleSelect(item, index)"
              />
            </span>
            <div class="history-heading-copy">
              <span class="history-name" :title="publishTitle(item)">{{ publishTitle(item) }}</span>
              <span v-if="hasDuplicateTitle(item, index)" class="history-duplicate-title-tag" data-testid="history-duplicate-title-tag">{{ tr('duplicateTitle') }}</span>
              <span v-if="item.pipeline || item.name" class="history-pipeline-tag">
                {{ pipelineName(item.pipeline || item.name) }}
              </span>
            </div>
            <span class="history-status" :class="item.status || 'unknown'">
              <span aria-hidden="true">{{ historyStatusIcon(item.status) }}</span>
              {{ historyStatusLabel(item.status) }}
            </span>
          </div>

          <div class="history-card-main">
            <div class="history-thumbnail" :class="{ 'is-empty': !item.thumbnailUrl }" data-testid="history-thumbnail">
              <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" :alt="historyTitle(item)" @error="onThumbnailError(item)" />
              <span v-else>{{ tr('notGenerated') }}</span>
            </div>
            <div class="history-card-copy">
              <div class="history-item-row history-prompt-preview">
                <span class="history-field-label">{{ tr('contentPreview') }}</span>
                <span class="prompt-preview-text">{{ truncate(taskContent(item), 120) || tr('notGenerated') }}</span>
              </div>
              <div v-if="currentLocale() !== 'en' && firstSegmentTranslation(item)" class="prompt-translation-readonly">
                <span class="translation-label">{{ tr('translation') }}</span>
                <span class="translation-text">{{ truncate(firstSegmentTranslation(item), 140) }}</span>
              </div>
            </div>
          </div>

          <div v-if="item.status === 'running'" class="history-state-detail history-running-hint">
            {{ tr('runningHint') }}
          </div>
          <div v-if="item.status === 'paused'" class="history-state-detail history-paused-hint">
            <div class="history-state-detail-row">
              <span class="history-field-label">{{ tr('pausedStage') }}</span>
              <span>{{ localizedStage(item.pausedStage || activeStage(item)) || tr('notAvailable') }}</span>
            </div>
            <div v-if="pauseEnvironment(item)" class="history-state-detail-row">
              <span class="history-field-label">{{ tr('pauseEnvironment') }}</span>
              <span>{{ localizedEnvironment(pauseEnvironment(item)) }}</span>
            </div>
          </div>
          <div v-if="item.status === 'interrupted'" class="history-state-detail history-interrupted-hint">
            <div class="history-state-detail-row">
              <span class="history-field-label">{{ tr('interruptedStage') }}</span>
              <span>{{ localizedStage(item.pausedStage || activeStage(item)) || tr('notAvailable') }}</span>
            </div>
            <div class="history-state-detail-row">
              <span>{{ tr('interruptedHint') }}</span>
            </div>
          </div>
          <div v-if="item.status === 'failed'" class="history-state-detail history-failed-hint">
            <div class="history-state-detail-row">
              <span class="history-field-label">{{ tr('failedStage') }}</span>
              <span>{{ localizedStage(item.pausedStage || failedStage(item)) || tr('notAvailable') }}</span>
            </div>
            <div class="history-state-detail-row">
              <span class="history-field-label">{{ tr('errorSummary') }}</span>
              <span data-testid="history-failure-reason">{{ formatError(item) }}</span>
            </div>
            <div v-if="policyResumeHintFor(item)" class="history-state-detail-row history-policy-resume-hint" data-testid="history-policy-resume-hint">
              <span class="history-field-label">{{ tr('policyResumeBlockedLabel') }}</span>
              <span>{{ policyResumeHintFor(item) }}</span>
            </div>
          </div>

          <dl class="history-meta-grid">
            <div v-if="item.pipeline || item.name" class="history-meta-item">
              <dt>{{ tr('pipeline') }}</dt><dd>{{ pipelineName(item.pipeline || item.name) }}</dd>
            </div>
            <div v-if="displayTime(item)" class="history-meta-item">
              <dt>{{ tr('updatedAt') }}</dt><dd>{{ formatTime(displayTime(item)) }}</dd>
            </div>
            <div v-if="createdTime(item)" class="history-meta-item">
              <dt>{{ tr('createdAt') }}</dt><dd>{{ formatTime(createdTime(item)) }}</dd>
            </div>
            <div v-if="historyDuration(item) !== null" class="history-meta-item">
              <dt>{{ tr('duration') }}</dt><dd>{{ formatDuration(historyDuration(item)) }}</dd>
            </div>
            <div class="history-meta-item">
              <dt>{{ tr('videoDuration') }}</dt><dd>{{ videoDurationText(item) }}</dd>
            </div>
            <div v-if="item.mode" class="history-meta-item">
              <dt>{{ tr('mode') }}</dt><dd>{{ localizedMode(item) }}</dd>
            </div>
            <div v-if="historyTaskId(item)" class="history-meta-item">
              <dt>{{ item.projectId ? tr('projectId') : tr('taskId') }}</dt>
              <dd :title="historyTaskId(item)" data-testid="history-task-id">{{ historyTaskId(item) }}</dd>
            </div>
          </dl>

          <div v-if="Array.isArray(item.stages) && item.stages.length" class="history-progress">
            <span
              v-for="(stage, stageIndex) in item.stages"
              :key="stageIndex"
              class="history-progress-seg"
              :class="historyStageState(stage)"
              :title="historyStageTitle(stage)"
            >{{ historyStageLabel(stage) }}</span>
          </div>

          <span class="history-detail-hint">{{ item.status === 'cancelled' ? tr('cancelledHint') : (historyItemOpenable(item) ? tr('viewDetailHint') : '') }}</span>
        </div>

        <div class="history-item-footer">
          <div class="history-actions">
              <button
                v-if="['failed', 'paused', 'interrupted'].includes(item.status) && historyItemResumable(item)"
                type="button"
                class="s2v-btn-resume s2v-btn-sm"
                :disabled="story2videoResuming"
                @click.stop="$emit('resume-history', item)"
              >{{ story2videoResuming ? tr('resuming') : tr('resume') }}</button>
              <button
                v-else-if="item.status === 'running'"
                type="button"
                class="s2v-btn-resume s2v-btn-sm"
                :disabled="story2videoResuming"
                @click.stop="$emit('resume-history', item)"
              >{{ story2videoResuming ? tr('resuming') : tr('continue') }}</button>
              <button
                v-if="policyEditTarget(item)"
                type="button"
                class="s2v-btn-secondary s2v-btn-sm"
                data-testid="history-policy-edit-button"
                :disabled="story2videoResuming"
                @click.stop="$emit('open-result', item)"
              >{{ tr('policyEditAndRegenerate') }}</button>
              <button
                v-if="detailEditable(item)"
                type="button"
                class="s2v-btn-secondary s2v-btn-sm"
                data-testid="history-edit-recompose-button"
                @click.stop="$emit('open-result', item)"
              >{{ tr('editAndRecompose') }}</button>
              <button
                v-if="publishable(item)"
                type="button"
                class="s2v-btn-secondary s2v-btn-sm"
                data-testid="history-publish-button"
                @click.stop="$emit('publish-history', item)"
              >{{ tr('publish') }}</button>                <button
                  v-if="downloadable(item)"
                  type="button"
                  class="s2v-btn-secondary s2v-btn-sm"
                  data-testid="history-download-button"
                  :disabled="story2videoResuming"
                  @click.stop="$emit('download-history', item)"
                >{{ tr('downloadVideo') }}</button>
              <!-- 播客出期入口（刀 3 第 4 片）：可用性与「发布历史视频」逐字同判据（publishable），
                   两者都要有成片；缺 segments 的情况由父级现取项目后再决定，不在这里放宽。 -->
              <button
                v-if="publishable(item)"
                type="button"
                class="s2v-btn-secondary s2v-btn-sm"
                data-testid="history-podcast-episode-button"
                @click.stop="$emit('publish-podcast-episode', item)"
              >{{ $t('podcast.episode.entry') }}</button>

              <button
                type="button"
                class="s2v-btn-danger s2v-btn-sm"
                data-testid="history-delete-button"
                @click.stop="$emit('delete-history', item)"
              >{{ tr('delete') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import '@/styles/history-panel.css'
import { getAppLocale } from '@/i18n'
import zhLocale from '@/locales/zh'
import enLocale from '@/locales/en'
import { getPipelineMode, getPipelineName, getPipelineStage } from '@/i18n/pipeline-labels'
import { CONTENT_POLICY_ERROR_PATTERN, HISTORY_STATUSES, RESUME_BLOCKING_ERROR_PATTERN, SORT_MODES, SORT_OPTIONS, collectDuplicateTitleIdentities, COMPOSE_ERROR_KEY_MAP, contentPolicyScenes, filterHistoryByStatus, historyDisplayTime, historyStatusCounts } from './history-utils'
import { formatPipelineError } from '@/utils/pipeline-error-formatter'

// HISTORY_STATUSES 由 ./history-utils 统一导出（含 interrupted），单一来源，避免与测试合同漂移

export default {
  name: 'CreateViewHistory',
  props: {
    history: { type: Array, default: () => [] },
    historyLoading: { type: Boolean, default: false },
    historyLocalMode: { type: Boolean, default: false },
    historyLocalModeText: { type: String, default: '' },
    historyFilter: { type: String, default: 'all' },
    story2videoResuming: { type: Boolean, default: false },
    deleting: { type: Boolean, default: false },
  },
  emits: ['update:historyFilter', 'resume-history', 'open-result', 'delete-history', 'delete-history-batch', 'publish-history', 'publish-podcast-episode', 'download-history', 'create-content', 'reset-history-filter'],
  data () {
    return {
      activeFilter: HISTORY_STATUSES.includes(this.historyFilter) ? this.historyFilter : 'all',
      statusTabs: HISTORY_STATUSES,
      selectedIdentities: [],
        sortMode: SORT_MODES.UPDATED_DESC,
        sortOptions: SORT_OPTIONS,
    }
  },
  computed: {
    filteredHistory () { return filterHistoryByStatus(this.history, this.activeFilter, this.sortMode) },
    // 渲染上限：全量渲染 1000+ 条会卡顿，取前 500 条展示
    displayHistory () { return this.filteredHistory.slice(0, 500) },
    statusCounts () { return historyStatusCounts(this.history) },
    // 重复标题检测（2026-09-04）：基于完整 history（不受状态筛选影响），
    // 完全相同的显式标题（修剪后逐字相等）标记所有相关卡片。
    duplicateTitleIdentities () {
      return collectDuplicateTitleIdentities(this.history, {
        identityOf: (item, index) => this.historyIdentity(item, index),
      })
    },
    // 每张失败卡片只计算一次不可恢复提示文本，避免模板 v-if + 文本处重复跑正则。
    policyResumeHints () {
      const hints = new Map()
      this.displayHistory.forEach((item, index) => {
        if (!item || item.status !== 'failed') return
        const text = this.policyResumeBlockedText(item)
        if (text) hints.set(this.historyIdentity(item, index), text)
      })
      return hints
    },
    allSelected () {
      return this.displayHistory.length > 0 && this.displayHistory.every((item, index) => this.selectedIdentities.includes(this.historyIdentity(item, index)))
    },
    selectedItems () {
      return this.displayHistory.filter((item, index) => this.selectedIdentities.includes(this.historyIdentity(item, index)))
    },
  },
  watch: {
    historyFilter (value) { this.activeFilter = HISTORY_STATUSES.includes(value) ? value : 'all' },
    history () { this.pruneSelection() },
  },
  methods: {
    resolveLocaleRef (ref, locale, params) {
      if (typeof ref !== 'string' || !ref.startsWith('@')) return ref
      const keyPath = ref.slice(1).split('.')
      const trees = { zh: zhLocale, en: enLocale }
      let node = trees[locale] || trees.zh
      for (const seg of keyPath) {
        node = node?.[seg]
        if (node == null) return ref
      }
      const resolved = typeof node === 'string' ? node : ref
      if (params && resolved.includes('{')) {
        return resolved.replace(/\{([^{}]+)\}/g, (_, k) => String(params[k] ?? ''))
      }
      return resolved
    },
    formatError (item) {
      if (!item || !item.error) return this.tr('genericFailure')
      const result = formatPipelineError(item.error, { locale: this.currentLocale() })
      // 稳定错误码优先（2026-10-20 error-message-user-friendly-audit）：
      // run.errorCode/errorParams 由主进程落库，按码渲染本地化文案；
      // 缺失时回落 formatPipelineError 的文本归一化（兼容历史库存量数据）。
      // 错误码 → locale key 用显式映射表（COMPOSE_ERROR_KEY_MAP），不做字符串拼接猜测——
      // 拼错会静默渲染成 key 原文。
      const stableKey = COMPOSE_ERROR_KEY_MAP[item.errorCode] || ''
      const stableParams = item.errorParams && typeof item.errorParams === 'object' ? item.errorParams : null
      // ⛔ 优先级（CCG 外部评审 i5，2026-10-20）：稳定码在前、原文归一化在后。
      // 上一版写 `result.key || stableKey`（原文优先），与本 change 的 spec
      // （`openspec/changes/.../specs/user-facing-messages/spec.md`：「①稳定 errorCode → ②原文模式」）
      // 自相矛盾。语义上主进程的 errorCode 是权威分类，原文只是存量数据的兜底线索：
      // 两者若指向不同分支（例如码说 scene_media_unreadable、原文里恰好含 content policy 字样），
      // 原文优先会把权威分类覆盖掉，指向错误的建议。
      const key = stableKey || result.key
      // 参数合并：formatter 提取的参数（如 context）与主进程 messageParams 互补，
      // 前者为空字符串时仍保留键位，故用展开合并而不是「二选一」。
      const params = { ...(result.params || {}), ...(stableParams || {}) }
      if (result.message && !key) return result.message
      if (key) {
        try {
          // 先取原文再插值：不能先比 msg !== key——$t 无参时返回 key 本身，
          // 生产 vue-i18n 对字符串消息同样不会自动插值，必须显式带 params 调用。
          //
          // ⛔ 无数字变体选择（CCG 外部评审 i2，2026-10-20）：体积超限的主文案带
          // {actualMb}/{limitMb} 两个占位符。存量历史记录的原文
          // `Input media exceeds the total size limit` 本身不含数字，formatter 只能映射到 key、
          // params 里拿不到体积 ⇒ 直接套主文案会渲染成「已达 允许上限，超过 允许上限 上限」。
          // 体积未知时改用 _no_numbers 变体，只说「超过上限」，不假装知道具体数值。
          let resolvedKey = key
          const sizeKey = COMPOSE_ERROR_KEY_MAP.COMPOSE_INPUT_SIZE_EXCEEDED
          if (resolvedKey === sizeKey && !params.actualMb && !params.limitMb) {
            resolvedKey = key + '_no_numbers'
          }
          const raw = this.$t?.(resolvedKey)
          if (typeof raw === 'string' && raw && raw !== resolvedKey) {
            let msg = raw
            if (params) {
              for (const [k, v] of Object.entries(params)) {
                msg = msg.replace(new RegExp('\\{' + k + '\\}', 'g'), String(this.resolveLocaleRef(v, this.currentLocale(), params) ?? ''))
              }
            }
            // ⛔ 未解析占位符清零（CCG 外部评审 i2，2026-10-20）：上面的循环只替换 params 里**存在**的键。
            // compose 预检的存量原文（如 `Input media exceeds the total size limit`）本身不带体积数字，
            // formatter 只能映射到 key、给出的 params 里没有 actualMb/limitMb ⇒ 直接渲染会让用户看到
            // 字面「{actualMb}」，比原来的英文原文更糟。故按语义兜底（体积 → labels.unknownSize，
            // 场景 → labels.currentScene，与通知路径 normalizeStory2VideoParams 同口径），
            // 兜底也拿不到就清空 —— 任何情况下都不得让 {xxx} 出现在用户可见文案里。
            const fallbackRefs = {
              actualMb: '@story2video.labels.unknownSize',
              limitMb: '@story2video.labels.unknownSize',
              scene: '@story2video.labels.currentScene',
            }
            const uiLocale = this.currentLocale()
            msg = msg.replace(/\{([^{}]+)\}/g, (_m, name) => {
              const ref = fallbackRefs[name]
              if (!ref) return ''
              const fallback = this.resolveLocaleRef(ref, uiLocale, {})
              // resolveLocaleRef 解析失败时原样返回 ref 本身，此时宁可清空也不要把 key 抖给用户
              return typeof fallback === 'string' && !fallback.startsWith('@') ? fallback : ''
            })
            if (msg && msg !== key) return msg
          }
        } catch (_) { /* fallback */ }
      }
      if (result.message) return result.message
      return this.tr('genericFailure')
    },
    tr (path, params) {
      const key = 'create.history.' + path
      try {
        const value = this.$t?.(key, params)
        return typeof value === 'string' && value !== key ? value : key
      } catch (_) { return key }
    },
    currentLocale () { try { return getAppLocale() } catch (_) { return 'zh' } },
    
      onSortModeChange () { /* 排序模式变更，v-model 已更新 */ },
      hasDuplicateTitle (item, index) {
        return this.duplicateTitleIdentities.has(this.historyIdentity(item, index))
      },
      downloadable (item) {
        return Boolean(
          item
          && item.status === 'completed'
          && typeof item.videoPath === 'string'
          && item.videoPath.trim()
        )
      },
selectFilter (status) {
      if (!HISTORY_STATUSES.includes(status)) return
      this.clearSelection()
      this.activeFilter = status
      this.$emit('update:historyFilter', status)
    },
    onTablistKeydown (event) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const current = Math.max(0, HISTORY_STATUSES.indexOf(this.activeFilter))
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? HISTORY_STATUSES.length - 1
          : event.key === 'ArrowLeft' ? (current - 1 + HISTORY_STATUSES.length) % HISTORY_STATUSES.length
            : (current + 1) % HISTORY_STATUSES.length
      this.selectFilter(HISTORY_STATUSES[next])
      this.$nextTick(() => this.$refs.historyTabs?.[next]?.focus())
    },
    historyIdentity (item, index) { return String(item?.id || item?.projectId || item?.runId || index) },
    historyTaskId (item) { return item?.projectId || item?.id || item?.runId || '' },
    isSelected (item, index) { return this.selectedIdentities.includes(this.historyIdentity(item, index)) },
    toggleSelect (item, index) {
      const id = this.historyIdentity(item, index)
      const pos = this.selectedIdentities.indexOf(id)
      if (pos === -1) this.selectedIdentities.push(id)
      else this.selectedIdentities.splice(pos, 1)
    },
    selectAll () {
      this.selectedIdentities = this.displayHistory.map((item, index) => this.historyIdentity(item, index))
    },
    clearSelection () { this.selectedIdentities = [] },
    toggleSelectAll () {
      if (this.allSelected) this.clearSelection()
      else this.selectAll()
    },
    pruneSelection () {
      // 使用 filteredHistory（筛选+排序后）与 selectedIdentities 保持一致，
      // 避免 history 全量列表与 filteredHistory 的 index fallback 差异导致选中被错误清除。
      const valid = new Set(this.displayHistory.map((item, index) => this.historyIdentity(item, index)))
      this.selectedIdentities = this.selectedIdentities.filter(id => valid.has(id))
    },
    emitBatchDelete () {
      if (this.selectedIdentities.length === 0) return
      this.$emit('delete-history-batch', this.selectedItems.slice())
    },
    // 发布标题（原文案前 60 字免回）
    publishTitle (item) { return this.historyTitle(item) },
    // 任务标题回退链：发布标题（project.title / params.title）→ 原文案前 60 字 → 流水线名
    historyTitle (item) {
      if (!item) return this.tr('untitled')
      if (typeof item.title === 'string' && item.title.trim()) return item.title.trim()
      const paramsTitle = item.params && (item.params.title || item.params.publishTitle)
      if (typeof paramsTitle === 'string' && paramsTitle.trim()) return paramsTitle.trim()
      const content = this.taskContent(item)
      if (content) return this.truncate(content, 60)
      return this.pipelineName(item.pipeline || item.name) || this.tr('untitled')
    },
    // 已启动且非运行中的项目进入视频任务编辑页；running 只保留流水线控制入口。
    historyItemOpenable (item) {
      return this.detailEditable(item)
    },
    detailEditable (item) {
      // 只有「已创建可识别项目」的终态任务可编辑（spec：只有 runId 的纯 run 记录不得制造项目卡片）。
      // run-only 记录的 projectId 会被主进程回退为 runId（pipeline-engine 快照 projectId || id），
      // 仅凭 projectId 存在会误判为可编辑，点击后结果页加载项目必然失败。必须用 historyType 区分。
      return Boolean(
        item
        && item.historyType === 'story2video-project'
        && item.projectId
        && item.startedPipeline !== false
        && item.status !== 'running'
      )
    },
    // 可发布历史视频：已完成合成且有成片路径（videoPath）的项目。
    // 发布走视频首帧封面，不要求封面字段。
    publishable (item) {
      return Boolean(
        item
        && item.historyType === 'story2video-project'
        && item.projectId
        && item.status === 'completed'
        && typeof item.videoPath === 'string'
        && item.videoPath.trim()
      )
    },
    openDetail (item) {
      if (!this.historyItemOpenable(item)) return
      this.$emit('open-result', item)
    },
    firstSegmentPreview (item) {
      return (Array.isArray(item?.segments) ? item.segments : []).find(segment => segment?.text)?.text || ''
    },
    taskContent (item) {
      if (!item) return ''
      if (typeof item.sourceText === 'string' && item.sourceText.trim()) return item.sourceText
      if (typeof item.text === 'string' && item.text.trim()) return item.text
      // run-only 记录（无 project 匹配，快照携带 params）：params.text 回退，
      // 避免卡片文案预览显示「未生成」（2026-08-20 修复）
      const paramsText = item.params && item.params.text
      if (typeof paramsText === 'string' && paramsText.trim()) return paramsText.trim()
      return (Array.isArray(item.segments) ? item.segments : [])
        .map(segment => typeof segment?.text === 'string' ? segment.text.trim() : '')
        .filter(Boolean)
        .join(' ')
    },
    firstSegmentTranslation (item) {
      return (Array.isArray(item?.segments) ? item.segments : []).find(segment => segment?.promptTranslation)?.promptTranslation || ''
    },
    truncate (value, max) {
      const text = String(value || '')
      return text.length > max ? text.slice(0, max - 1) + '…' : text
    },
    onThumbnailError (item) {
      if (!item || typeof item !== 'object') return
      item.thumbnailUrl = null
      item.thumbnailStatus = 'failed'
    },
    pipelineName (id) { return getPipelineName(key => this.$t?.(key), id) },
    localizedMode (item) {
      return getPipelineMode(key => this.$t?.(key), item?.pipeline || item?.name) || String(item?.mode || '')
    },
    localizedStage (stage) { return stage ? getPipelineStage(key => this.$t?.(key), String(stage)) : '' },
    historyStatusLabel (status) { return this.tr('statuses.' + (status || 'unknown')) },
    historyStatusIcon (status) { return ({ completed: '✓', failed: '×', cancelled: '–', running: '↻', paused: 'Ⅱ', interrupted: '↯', pending: '○' })[status] || '•' },
    displayTime (item) { return historyDisplayTime(item) },
    createdTime (item) { return historyDisplayTime({ createdAt: item?.createdAt, created_at: item?.created_at }) },
    historyDuration (item) {
      const value = item?.activeMs ?? item?.duration
      return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null
    },
    videoDuration (item) {
      // duration is pipeline execution time for history runs; only explicit
      // media-duration fields are eligible for the video duration row.
      const candidates = [
        item?.videoDuration,
        item?.video_duration,
        item?.video?.duration,
        item?.composeDuration,
        item?.durationSeconds,
      ]
      for (const candidate of candidates) {
        if (candidate === null || candidate === undefined || candidate === '') continue
        const value = Number(candidate)
        if (Number.isFinite(value) && value >= 0) return value
      }
      return null
    },
    videoDurationText (item) {
      const value = this.videoDuration(item)
      return value === null ? this.tr('notGenerated') : this.formatSeconds(value)
    },
    formatSeconds (seconds) {
      const value = Number(seconds)
      if (!Number.isFinite(value) || value < 0) return this.tr('notGenerated')
      const totalSeconds = Math.round(value)
      const minutes = Math.floor(totalSeconds / 60)
      const remainder = totalSeconds % 60
      return minutes > 0 ? minutes + ' ' + this.tr('minutes') + ' ' + remainder + ' ' + this.tr('seconds') : remainder + ' ' + this.tr('seconds')
    },
    formatTime (value) {
      const date = new Date(value)
      if (!Number.isFinite(date.getTime())) return this.tr('notAvailable')
      return new Intl.DateTimeFormat(this.currentLocale() === 'en' ? 'en-US' : 'zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).format(date)
    },
    historyItemResumable (item) {
      if (!item || !['failed', 'paused', 'interrupted'].includes(item.status) || !(item.id || item.runId)) return false
      return !RESUME_BLOCKING_ERROR_PATTERN.test(String(item.error || ''))
    },
    policyResumeHintFor (item) {
      if (!item) return ''
      const cached = this.policyResumeHints.get(this.historyIdentity(item, -1))
      return cached !== undefined ? cached : this.policyResumeBlockedText(item)
    },
    policyEditTarget (item) {
      // 与 detailEditable 一致：仅真实 story2video 项目可编辑，run-only 记录（historyType=pipeline-run）
      // 的 projectId 是主进程回退的 runId，项目不存在，进入结果页必然加载失败。
      if (!item || item.status !== 'failed' || item.historyType !== 'story2video-project' || !item.projectId) return false
      return RESUME_BLOCKING_ERROR_PATTERN.test(String(item.error || ''))
    },
    policyResumeBlockedText (item) {
      if (!item || item.status !== 'failed' || !(item.id || item.runId)) return ''
      // 提示条只针对内容政策/需用户输入的具体原因；空结果失败（服务波动/账号问题）
      // 由门控正则拦截恢复但不显示「内容政策拦截」提示（2026-08-16 复审解耦）。
      if (!CONTENT_POLICY_ERROR_PATTERN.test(String(item.error || ''))) return ''
      const scenes = contentPolicyScenes(item.error, this.currentLocale())
      if (!scenes) return this.tr('policyResumeBlockedGeneric')
      try {
        const message = this.$t?.('create.history.policyResumeBlockedHint', { scenes })
        return typeof message === 'string' && message !== 'create.history.policyResumeBlockedHint' ? message : this.tr('policyResumeBlockedGeneric')
      } catch (_) {
        return this.tr('policyResumeBlockedGeneric')
      }
    },
    activeStage (item) {
      const stage = (Array.isArray(item?.stages) ? item.stages : []).find(value => ['running', 'paused', 'waiting_approval'].includes(value?.status))
      return stage ? (stage.name || stage.stage || '') : ''
    },
    failedStage (item) {
      const stage = (Array.isArray(item?.stages) ? item.stages : []).find(value => value?.status === 'failed')
      return stage ? (stage.name || stage.stage || '') : ''
    },
    pauseEnvironment (item) {
      return item?.pausedEnvironment || item?.pauseEnvironment || item?.environment || item?.checkpoint?.environment || item?.checkpoint?.type || ''
    },
    localizedEnvironment (value) {
      const normalized = String(value || '').replace(/-/g, '_')
      const known = {
        scene_asset_selection: 'environments.sceneAssetSelection',
        waiting_approval: 'environments.waitingApproval',
        needs_user_input: 'environments.needsUserInput',
        local: 'environments.local',
      }
      return known[normalized] ? this.tr(known[normalized]) : String(value)
    },
    historyStageState (stage) {
      const status = stage && typeof stage === 'object' ? stage.status : ''
      if (status === 'completed') return 'done'
      if (status === 'skipped') return 'skipped'
      if (status === 'running') return 'active'
      if (['failed', 'needs_user_input', 'cancelled'].includes(status)) return 'failed'
      return 'pending'
    },
    historyStageRawLabel (stage) { return typeof stage === 'object' ? (stage?.name || stage?.stage || '') : String(stage || '') },
    historyStageLabel (stage) {
      const label = this.localizedStage(this.historyStageRawLabel(stage))
      const progress = stage && typeof stage === 'object' ? stage.sceneProgress : null
      return progress && Number.isFinite(progress.completed) && Number.isFinite(progress.total) && progress.total > 0
        ? label + ' (' + progress.completed + '/' + progress.total + ')'
        : label
    },
    historyStageTitle (stage) {
      const status = stage && typeof stage === 'object' ? stage.status : ''
      return this.historyStageLabel(stage) + (status ? ' · ' + this.historyStatusLabel(status) : '')
    },
    formatDuration (milliseconds) {
      const value = Number(milliseconds)
      if (!Number.isFinite(value) || value < 0) return this.tr('notAvailable')
      const minutes = Math.floor(value / 60000)
      const seconds = Math.floor((value % 60000) / 1000)
      return minutes > 0 ? minutes + ' ' + this.tr('minutes') + ' ' + seconds + ' ' + this.tr('seconds') : seconds + ' ' + this.tr('seconds')
    },
  },
}
</script>

<style scoped>
.history-batch-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  margin: 8px 0;
  background: var(--s2v-surface, #f5f6f8);
  border-radius: 8px;
}
.history-select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.history-selected-count {
  font-size: var(--font-size-sm);
  color: var(--s2v-text-secondary, #6b7280);
}
.history-item-select {
  display: inline-flex;
  align-items: center;
  margin-right: 8px;
}
.history-select-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
}
</style>
