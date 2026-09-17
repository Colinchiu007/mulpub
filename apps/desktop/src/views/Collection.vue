<template>
  <div>
    <div class="cohere-page-header">
      <div>
        <div class="collection-tabs" role="tablist">
          <button role="tab" :aria-selected="activeTab === 'collect'" class="collection-tab-btn" :class="{ active: activeTab === 'collect' }" @click="switchTab('collect')">{{ $t('collection.tabCollect') }}</button>
          <button role="tab" :aria-selected="activeTab === 'records'" class="collection-tab-btn" :class="{ active: activeTab === 'records' }" data-testid="collection-tab-library" @click="switchTab('records')">{{ $t('collection.tabRecords') }}</button>
        </div>
        <div class="page-subtitle">从各平台采集内容，或快速创建草稿</div>
      </div>
      <div class="page-actions">
        <button class="cohere-btn-secondary" @click="importFromClipboard">📋 从剪贴板导入</button>
        <button class="cohere-btn-primary" @click="createDraft">＋ 新建草稿</button>
      </div>
    </div>

    <div v-if="activeTab === 'collect'" class="cohere-content">
      <!-- URL 采集输入 -->
      <div class="cohere-card" style="padding:var(--space-md);margin-bottom:var(--space-lg)">
        <div style="display:flex;gap:var(--space-sm);align-items:center;flex-wrap:wrap">
          <span style="font-size:1.2rem">🔗</span>
          <select v-model="collectSourceType" style="border:1px solid var(--border);border-radius:6px;padding:8px;font-size:14px">
            <option v-for="s in collectSources" :key="s.type" :value="s.type">{{ s.name }}</option>
          </select>
          <input
            v-model="linkUrl"
            placeholder="输入文章链接，自动采集标题、正文、封面..."
            style="flex:1;border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px"
            @keyup.enter="collectUrl"
          />
          <button data-testid="collection-collect-btn" class="cohere-btn-primary" @click="collectUrl" :disabled="collecting || oneClickRewriting">
            {{ collecting ? '采集中...' : '采集' }}
          </button>
          <button class="cohere-btn-primary" @click="collectAndRewrite" :disabled="collecting || oneClickRewriting">
            {{ oneClickRewriting ? $t('collection.oneClickRewriting') : $t('collection.oneClickRewrite') }}
          </button>
          <button v-if="collectError && RETRYABLE_CODES.has(collectError.code)" class="cohere-btn-secondary" @click="retryCollect" :disabled="collecting" style="font-size:13px;padding:8px 12px">
            🔄 重试
          </button>
        </div>
        <div v-if="collectError" style="margin-top:8px;padding:6px 10px;background:#fff3f3;border-radius:4px;font-size:12px;color:#d32f2f">
          {{ collectErrorDetail }}
          <button v-if="collectError && collectErrorRetryable" class="cohere-btn-secondary" @click="retryCollect" :disabled="collecting" style="font-size:12px;padding:4px 10px;margin-left:8px">
            🔄 重试
          </button>
        </div>
        <div v-if="videoCollectStage" data-testid="collection-video-stage" style="margin-top:8px;padding:6px 10px;background:#f0f7ff;border-radius:4px;font-size:12px;color:#1976d2">
          {{ videoStageText(videoCollectStage) }}
        </div>
        <div v-if="collectedResult" style="margin-top:var(--space-sm);padding:var(--space-sm);background:var(--soft-stone);border-radius:6px">
          <div style="font-weight:600;margin-bottom:4px">✅ {{ collectedResult.title || '无标题' }}</div>
          <div style="font-size:12px;color:var(--text-secondary)">
            {{ collectedResult.description ? collectedResult.description.slice(0, 120) + '...' : '' }}
            <span v-if="collectedResult.coverImage"> · 有封面图</span>
            <span v-if="collectedResult.mediaType === 'video'"> · 🎬 {{ $t('collection.videoTranscriptLabel') }}<template v-if="collectedResult.duration"> · {{ formatVideoDuration(collectedResult.duration) }}</template><template v-if="collectedResult.platform && PLATFORM_KEYS.includes(collectedResult.platform)"> · {{ platformLabel(collectedResult.platform) }}</template></span>
          </div>
          <!-- 改写策略选择（2026-09-15 补齐）：与 /rewrite 页同组件同契约，此前采集页改写无策略入口 -->
          <RewriteStrategyPicker
            style="margin-top:8px"
            v-model:strategy-mode="strategyMode"
            v-model:strategy-id="rewriteStrategyId"
            :strategies="rewriteStrategies"
            :preview-name="previewStrategyName"
            :disabled="rewriting || oneClickRewriting"
            :labels="{
              label: $t('rewritePage.strategyLabel'),
              auto: $t('rewritePage.strategyAuto'),
              manual: $t('rewritePage.strategyManual'),
              preview: $t('rewritePage.strategyPreview'),
              previewColon: $t('rewritePage.strategyPreviewColon'),
              placeholder: $t('rewritePage.strategySelectPlaceholder'),
            }"
          />
          <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
            <button class="cohere-btn-primary" @click="createFromCollected">创建草稿</button>
            <button
              class="cohere-btn-secondary"
              :disabled="addedToViral"
              :title="addedToViral ? $t('knowledgeBase.addedToViral') : $t('knowledgeBase.addToViral')"
              @click="addCollectedToViral"
            >
              {{ addedToViral ? '✓ ' + $t('knowledgeBase.addedToViral') : $t('knowledgeBase.addToViral') }}
            </button>
            <label style="display:inline-flex;align-items:center;gap:4px;font-size:13px;cursor:pointer" :class="{ 'o-disabled': rewriting || oneClickRewriting }">
              <input type="checkbox" v-model="useViralLibrary" class="coral-check" :disabled="rewriting || oneClickRewriting" /> 结合爆款库
            </label>
            <label style="display:inline-flex;align-items:center;gap:4px;font-size:13px;cursor:pointer" :class="{ 'o-disabled': rewriting || oneClickRewriting }">
              <input type="checkbox" v-model="usePersonalExperience" class="coral-check" :disabled="rewriting || oneClickRewriting" /> 结合个人经历
            </label>
            <select v-model="rewriteStyle" style="border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:13px" :disabled="rewriting || oneClickRewriting">
              <option v-for="s in getRewriteStyles()" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>
            <!-- 字数区间控制（2026-09-12）：替换原 keep/compress/expand 三档 -->
            <WordCountRangeInput
              v-model:min="rewriteWordCountMin"
              v-model:max="rewriteWordCountMax"
              :label="$t('collection.wordCountLabel')"
              :min-placeholder="$t('collection.wordCountMinPlaceholder')"
              :max-placeholder="$t('collection.wordCountMaxPlaceholder')"
              :unit="$t('collection.wordCountUnit')"
              :error="rewriteWordCountError"
              :disabled="rewriting || oneClickRewriting"
            />
            <button class="cohere-btn-secondary" @click="rewriteCollected" :disabled="rewriting || oneClickRewriting || !collectedResult || !!rewriteWordCountError">
              {{ rewriting ? $t('collection.rewriting') : $t('collection.rewrite') }}
            </button>
            <button v-if="rewriteError && RETRYABLE_CODES.has(rewriteError.code)" class="cohere-btn-secondary" @click="retryRewrite" :disabled="rewriting" style="font-size:13px">
              🔄 重试
            </button>
            <template v-if="rewriteResult">
              <button class="cohere-btn-secondary" @click="saveDraftAfterRewrite">💾 存入草稿</button>
              <button class="cohere-btn-primary" @click="goPublishAfterRewrite">🚀 去发布</button>
            </template>
            <button class="cohere-btn-secondary" @click="clearResult">取消</button>
            <div v-if="rewriteError" style="margin-top:6px;padding:6px 10px;background:#fff3f3;border-radius:4px;font-size:12px;color:#d32f2f">
              {{ rewriteError.message }}
            </div>
          </div>
          <!-- 改写结果对比：原文 vs 改写后 -->
          <div v-if="rewriteResult" class="rewrite-compare" style="margin-top:var(--space-sm);display:grid;grid-template-columns:1fr 1fr;gap:var(--space-sm)">
            <div>
              <div style="font-weight:600;font-size:13px;margin-bottom:4px">📄 {{ $t('collection.originalContent') }}</div>
              <textarea class="compare-textarea" readonly :value="(collectedResult && (collectedResult.content || collectedResult.description)) || ''"></textarea>
            </div>
            <div>
              <div style="font-weight:600;font-size:13px;margin-bottom:4px">✨ {{ $t('collection.rewrittenContent') }}</div>
              <textarea class="compare-textarea" v-model="rewriteResult"></textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- 批量采集区域 -->
      <div class="cohere-card" style="padding:var(--space-md);margin-bottom:var(--space-lg)">
        <div class="cohere-section-title" style="margin-bottom:var(--space-sm)">{{ $t('collection.batchCollectTitle') }}</div>

        <!-- RSS 批量采集 -->
        <div style="margin-bottom:var(--space-sm)">
          <div style="font-weight:600;font-size:13px;margin-bottom:4px">{{ $t('collection.rssBatch') }}</div>
          <div style="display:flex;gap:var(--space-sm);align-items:center">
            <input
              v-model="rssUrl"
              :placeholder="$t('collection.rssPlaceholder')"
              style="flex:1;border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px"
            />
            <button class="cohere-btn-primary" @click="collectBatch('rss')" :disabled="batchCollecting">
              {{ batchCollecting ? $t('collection.batchCollecting') : $t('collection.batchCollect') }}
            </button>
          </div>
        </div>

        <!-- URL 列表批量采集 -->
        <div style="margin-bottom:var(--space-sm)">
          <div style="font-weight:600;font-size:13px;margin-bottom:4px">{{ $t('collection.urlListBatch') }}</div>
          <textarea
            v-model="urlListInput"
            :placeholder="$t('collection.urlListPlaceholder')"
            rows="3"
            style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px;resize:vertical"
          ></textarea>
          <div style="display:flex;gap:var(--space-sm);align-items:center;margin-top:4px">
            <button class="cohere-btn-primary" @click="collectBatch('batch')" :disabled="batchCollecting || !urlListInput.trim()">
              {{ batchCollecting ? $t('collection.batchCollecting') : $t('collection.batchCollect') }}
            </button>
            <span style="font-size:12px;color:var(--text-secondary)">{{ $t('collection.urlListHint') }}</span>
          </div>
        </div>

        <!-- 批量采集进度 -->
        <div v-if="batchTaskId" style="margin-top:var(--space-sm);padding:var(--space-sm);background:var(--soft-stone);border-radius:6px">
          <div style="font-weight:600;font-size:13px;margin-bottom:4px">{{ $t('collection.batchProgress') }}</div>
          <div style="background:#e0e0e0;border-radius:4px;height:8px;overflow:hidden;margin-bottom:4px">
            <div :style="{ width: batchProgress + '%', background: 'var(--primary)', height:'100%', transition:'width 0.3s' }"></div>
          </div>
          <div style="font-size:12px;color:var(--text-secondary)">
            {{ batchProgressText }}
          </div>
          <button v-if="batchCollecting" class="cohere-btn-secondary" style="margin-top:4px;font-size:12px;padding:2px 8px" @click="cancelBatchCollect">
            {{ $t('collection.cancelBatch') }}
          </button>
        </div>
        <div v-if="batchError" style="margin-top:8px;padding:6px 10px;background:#fff3f3;border-radius:4px;font-size:12px;color:#d32f2f">
          {{ batchError }}
        </div>
      </div>

      <!-- 采集结果累计列表 -->
      <div v-if="collectedItems.length > 0" style="margin-bottom:var(--space-lg)">
        <div class="cohere-section-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>采集结果（{{ collectedItems.length }} 篇）</span>
          <button class="cohere-btn-secondary" style="font-size:12px;padding:2px 8px" @click="collectedItems = []; collectedResult = null">清空</button>
        </div>
        <div class="cohere-card-grid">
          <div v-for="item in collectedItems" :key="item.id" class="cohere-card" :style="{ borderLeft: item.id === collectedResult?.id ? '3px solid var(--primary)' : '' }">
            <div class="card-top">
              <div class="card-icon">{{ item.mediaType === 'video' ? '🎬' : '📰' }}</div>
              <div class="card-info">
                <div class="card-platform">{{ item.title || '无标题' }}</div>
                <div class="card-account">
                  {{ item.source || 'url' }} · {{ item.wordCount || (item.content || '').length }}字
                  <template v-if="item.mediaType === 'video' && item.duration"> · {{ formatVideoDuration(item.duration) }}</template>
                  <template v-if="item.mediaType === 'video' && item.platform && PLATFORM_KEYS.includes(item.platform)"> · {{ platformLabel(item.platform) }}</template>
                </div>
              </div>
            </div>
            <div class="card-actions">
              <button @click="collectedResult = item">查看</button>
              <button @click="createFromItem(item)">创建草稿</button>
              <button @click="sendItemToPipeline(item)">视频创作</button>
              <button @click="goPublishFromItem(item)">发布</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 快捷操作 -->
      <div class="cohere-stat-grid" style="margin-bottom:var(--space-lg)">
        <div class="cohere-stat-card" style="cursor:pointer" @click="createDraft">
          <div class="stat-value">✏️</div>
          <div class="stat-label">新建草稿</div>
        </div>
        <div class="cohere-stat-card" style="cursor:pointer" @click="importFromClipboard">
          <div class="stat-value">📋</div>
          <div class="stat-label">剪贴板导入</div>
        </div>
        <div class="cohere-stat-card" style="cursor:pointer" @click="openCollection('weibo')">
          <div class="stat-value">✧</div>
          <div class="stat-label">微博</div>
        </div>
        <div class="cohere-stat-card" style="cursor:pointer" @click="openCollection('zhihu')">
          <div class="stat-value">❓</div>
          <div class="stat-label">知乎</div>
        </div>
        <div class="cohere-stat-card" style="cursor:pointer" @click="openCollection('toutiao')">
          <div class="stat-value">📰</div>
          <div class="stat-label">今日头条</div>
        </div>
      </div>

      <!-- 草稿列表 -->
      <div class="cohere-section-title">草稿箱</div>
      <EmptyState
        v-if="drafts.length === 0"
        data-testid="collection-drafts-empty"
        icon="📝"
        :title="$t('collection.draftsEmptyTitle')"
        :description="$t('collection.draftsEmptyDesc')"
        :action-text="$t('collection.draftsEmptyAction')"
        @action="createDraft"
      />
      <div v-else class="cohere-card-grid">
        <div v-for="d in drafts" :key="d.id" class="cohere-card">
          <div class="card-top">
            <div class="card-icon">📄</div>
            <div class="card-info">
              <div class="card-platform">{{ d.title || '未命名草稿' }}</div>
              <div class="card-account">{{ d.created_at }} · {{ (d.content || '').length }}字</div>
            </div>
          </div>
          <div class="card-actions">
            <button @click="editDraft(d)">编辑</button>
            <button @click="goPublish(d)">发布</button>
            <button class="danger" @click="deleteDraft(d)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 文案库标签页（2026-09-16 合并：原「采集记录」+「文案库」两标签合一，以采集记录卡片为准） -->
    <div v-else-if="activeTab === 'records'" class="cohere-content" role="tabpanel" :aria-label="$t('collection.recordsTitle')">
      <div class="cohere-section-title" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <span>{{ $t('collection.recordsTitle') }} · {{ $t('collection.libraryCount', { count: libraryItems.length }) }}</span>
        <div class="library-filters" role="group" :aria-label="$t('collection.libraryFilterLabel')">
          <button
            v-for="f in LIBRARY_FILTERS"
            :key="f.value"
            type="button"
            class="library-filter-btn"
            :class="{ active: libraryFilter === f.value }"
            :aria-pressed="libraryFilter === f.value"
            :data-testid="'copy-library-filter-' + f.value"
            @click="libraryFilter = f.value"
          >{{ $t(f.labelKey) }}</button>
        </div>
        <button class="cohere-btn-secondary" style="font-size:12px;padding:2px 8px" :disabled="collectedItems.length === 0" @click="clearAllRecords">
          {{ $t('collection.recordsClearAll') }}
        </button>
      </div>
      <EmptyState
        v-if="libraryItems.length === 0"
        data-testid="collection-library-empty"
        icon="📰"
        :title="$t('collection.recordsEmptyTitle')"
        :description="$t('collection.recordsEmptyDesc')"
        :action-text="$t('collection.recordsEmptyAction')"
        @action="activeTab = 'collect'"
      />
      <EmptyState
        v-else-if="filteredLibraryItems.length === 0"
        compact
        data-testid="collection-library-filter-empty"
        icon="🔍"
        :title="$t('collection.libraryFilterEmptyTitle')"
        :description="$t('collection.libraryFilterEmptyDesc')"
        :action-text="$t('collection.libraryFilterEmptyAction')"
        @action="libraryFilter = 'all'"
      />
      <div v-else class="cohere-card-grid" data-testid="copy-library-list">
        <template v-for="entry in filteredLibraryItems" :key="entry.key">
          <!-- 采集正文卡片：信息与操作以原「采集记录」为准，新增【改写】跳转改写页直接改写 -->
          <div v-if="entry.origin === 'collect'" class="cohere-card collection-record-card" role="button" tabindex="0" :data-testid="'copy-library-item-' + entry.item.id" @click="openRecordForEdit(entry.item)" @keyup.enter="openRecordForEdit(entry.item)">
            <div class="card-top">
              <div class="card-icon">{{ entry.item.mediaType === 'video' ? '🎬' : '📰' }}</div>
              <div class="card-info">
                <div class="card-platform">{{ entry.item.title || $t('collection.recordsUntitled') }}</div>
                <div class="card-account">
                  {{ formatRecordSource(entry.item) }} · {{ formatRecordWordCount(entry.item) }}
                  <template v-if="entry.item.mediaType === 'video' && entry.item.duration"> · {{ formatVideoDuration(entry.item.duration) }}</template>
                  <template v-if="entry.item.mediaType === 'video' && entry.item.platform && PLATFORM_KEYS.includes(entry.item.platform)"> · {{ platformLabel(entry.item.platform) }}</template>
                  · {{ formatRecordTime(entry.item) }}
                </div>
              </div>
            </div>
            <div class="card-actions">
              <button @click.stop="openRecordForEdit(entry.item)">{{ $t('collection.recordsEdit') }}</button>
              <button @click.stop="createFromItem(entry.item)">{{ $t('collection.recordsCreateDraft') }}</button>
              <button @click.stop="sendItemToPipeline(entry.item)">{{ $t('collection.recordsToVideo') }}</button>
              <button @click.stop="goPublishFromItem(entry.item)">{{ $t('collection.recordsPublish') }}</button>
              <button class="primary" :data-testid="'copy-library-rewrite-' + entry.item.id" @click.stop="rewriteFromLibrary(entry)">{{ $t('collection.libraryRewrite') }}</button>
              <button class="danger" @click.stop="deleteRecord(entry.item)">{{ $t('collection.recordsDelete') }}</button>
            </div>
          </div>
          <!-- 改写文案卡片：来自文案库改写闭环（采集页内改写 / 改写页交接改写） -->
          <div v-else class="cohere-card collection-record-card" :data-testid="'copy-library-item-' + entry.record.id">
            <div class="card-top">
              <div class="card-icon">✨</div>
              <div class="card-info">
                <div class="card-platform card-platform-badge">
                  <span class="copy-origin-badge is-rewrite" :data-testid="'copy-library-badge-' + entry.record.id">{{ $t('collection.libraryOriginRewrite') }}</span>
                  <span class="copy-library-title">{{ entry.record.title || $t('collection.libraryUntitled') }}</span>
                </div>
                <div class="card-account">{{ rewriteMetaText(entry.record) }}</div>
              </div>
            </div>
            <div class="card-actions">
              <button @click.stop="previewRewrite = entry.record">{{ $t('collection.libraryView') }}</button>
              <button class="primary" :data-testid="'copy-library-rewrite-r' + entry.record.id" @click.stop="rewriteFromLibrary(entry)">{{ $t('collection.libraryRewrite') }}</button>
              <button class="danger" @click.stop="deleteLibraryRewrite(entry.record)">{{ $t('collection.recordsDelete') }}</button>
            </div>
          </div>
        </template>
      </div>

      <!-- 改写文案内容预览（只读） -->
      <div v-if="previewRewrite" class="copy-preview-overlay" data-testid="copy-preview-overlay" @click.self="previewRewrite = null">
        <div class="copy-preview-modal" role="dialog" aria-modal="true" :aria-label="$t('collection.libraryPreviewTitle')">
          <header class="copy-preview-header">
            <h3 class="copy-preview-title">{{ previewRewrite.title || $t('collection.libraryUntitled') }}</h3>
            <button
              type="button"
              class="copy-preview-close"
              :aria-label="$t('collection.libraryClose')"
              data-testid="copy-preview-close"
              @click="previewRewrite = null"
            >✕</button>
          </header>
          <div class="copy-preview-meta">
            <span class="copy-origin-badge is-rewrite">{{ $t('collection.libraryOriginRewrite') }}</span>
          </div>
          <pre class="copy-preview-content" data-testid="copy-preview-content">{{ previewRewrite.content }}</pre>
        </div>
      </div>
    </div>

    <!-- 去发布弹窗 -->
    <PublishDestinationModal
      v-if="showPublishModal"
      :visible="showPublishModal"
      @close="showPublishModal = false"
      @publish-article="onPublishArticle"
      @publish-video="onPublishVideo"
    />
  </div>
</template>

<script setup>
// eslint-disable-next-line no-unused-vars
import UiButton from "../components/UiButton.vue";
import { getApi } from '@/api/electron-bridge'
import { useI18n } from 'vue-i18n'
import { useTabStore } from '@/stores/tab'
import { PLATFORM_DASHBOARD_URLS, PLATFORM_NAMES } from '@multi-publish/shared-utils/src/platform-definitions'
// eslint-disable-next-line no-unused-vars
import UiInput from "../components/UiInput.vue";
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useNotify } from '@/composables/useNotify'
import { resolveNotifyText } from '@/utils/notifyCore'
import { storeGetSetting, storeSetSetting, aiRewrite, aiListRewriteStrategies, aiGetRecommendedStrategies } from '@/api/publisher'
import { formatUserError } from '@/utils/user-facing-error'
import { classifyCollectError } from '@/utils/collect-error'
import { useWordCountValidation } from '@/composables/useWordCountValidation'
import { addViralToLibrary } from '@/api/knowledge-library'
import PublishDestinationModal from '@/components/PublishDestinationModal.vue'
import WordCountRangeInput from '@/components/WordCountRangeInput.vue'
import RewriteStrategyPicker from '@/components/RewriteStrategyPicker.vue'
import { useCopyLibrary, collectFromKey, ORIGIN_COLLECT, ORIGIN_REWRITE, compareByCreatedAtDesc } from '@/composables/useCopyLibrary'
import { setRewriteHandoff } from '@/utils/rewrite-handoff'

const router = useRouter()
const { notifyError, notifySuccess, notifyWarning, notifyInfo, notifyConfirm } = useNotify()
const tabStore = useTabStore()
const { t } = useI18n()
const drafts = ref([])
const linkUrl = ref('')
const collecting = ref(false)
const rewriting = ref(false)
const oneClickRewriting = ref(false)
const collectedResult = ref(null)
const collectError = ref(null)
const videoCollectStage = ref('')  // 视频采集分阶段提示: probe/downloading/extracting/transcribing
const rewriteError = ref(null)
const collectedItems = ref([])  // 累计采集列表
const addedToViral = ref(false)  // 当前采集结果是否已加入爆款库
const collectSourceType = ref('url')
const activeTab = ref('collect')  // 标签页: 'collect' | 'records'(文案库)
const collectSources = ref([
  { type: 'url', name: 'URL 正文提取' },
  { type: 'rss', name: 'RSS 订阅源' },
  { type: 'sitemap', name: 'Sitemap' },
  { type: 'api', name: '自定义 API' },
])
const rewriteStyle = ref('轻松易懂')
// 字数区间控制（2026-09-12）：替换原 keep/compress/expand 三档，默认 800-2000
const rewriteWordCountMin = ref(800)
const rewriteWordCountMax = ref(2000)
const rewriteResult = ref('')
const useViralLibrary = ref(true)
const usePersonalExperience = ref(false)
// 改写策略（2026-09-15 补齐）：与 RewriteView / AiWriterPanel 同契约
// —— 手动模式传所选 strategyId（空串降级 null），自动模式传 null 走引擎 _resolveStrategy 匹配
const strategyMode = ref('auto')
const rewriteStrategyId = ref('')
const rewriteStrategies = ref([])
const previewStrategyName = ref('--')
let strategyPreviewSeq = 0

// 改写走 Node 引擎（aiRewrite）：采集→入库→改写参考闭环的最后一块拼图。
// Python 链路（aggregationRewrite）对桌面 SQLite 爆款库不可见、不接收 knowledgeOptions。
// style 是语气偏好 → userSettings.tone（引擎 prompt 模板消费）；mode 统一 imitate（保留原文语义，改写引擎核心场景）。
// tone 值为引擎 prompt 模板的语气枚举（非用户可见 UI 文案，走常量；CJK 基线登记见 check-locale-sync）
// 长度由字数区间控制（main 已移除三档 length 下拉）：min/max → targetWordCount + targetLength 语义映射
const STYLE_TO_TONE = { '轻松易懂': 'casual', '正式严谨': 'formal', '吸引眼球': 'catchy', '深度分析': 'professional', '认知锚点': 'anchor' }

// ── 改写策略：列表加载 + 自动匹配预览（与 RewriteView 同模式）──
// 策略列表加载失败静默降级为空列表，改写仍可用自动匹配
async function loadRewriteStrategies () {
  try {
    const res = await aiListRewriteStrategies()
    if (res && res.code === 0) rewriteStrategies.value = res.data || []
  } catch (_e) { /* 自动匹配兜底 */ }
}

// 自动匹配预览：取推荐列表第一名；失败降级 '--'，不阻塞改写
// 序列号防竞态：并发请求只保留最后一次结果；携带采集结果的 platform（无采集时 undefined=通用），与实际改写匹配口径一致
async function refreshStrategyPreview () {
  const seq = ++strategyPreviewSeq
  const p = collectedResult.value && collectedResult.value.platform ? collectedResult.value.platform : undefined
  try {
    const res = await aiGetRecommendedStrategies({ platform: p })
    if (seq !== strategyPreviewSeq) return
    if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
      previewStrategyName.value = res.data[0].name || '--'
    } else {
      previewStrategyName.value = '--'
    }
  } catch (_e) {
    if (seq === strategyPreviewSeq) previewStrategyName.value = '--'
  }
}

// 切回自动模式时刷新预览：manual 期间推荐结果可能已过期（与 RewriteView 行为对齐）
watch(strategyMode, (m) => {
  if (m === 'auto') refreshStrategyPreview()
})
// 新采集结果到达 → 按新平台刷新推荐预览
watch(collectedResult, () => refreshStrategyPreview())

// 文案库旁路：采集页内的改写结果同步进「文案库」（写入失败静默，不影响改写主流程）
const { upsertRewrite: upsertCopyRewrite, removeRewrite, rewrites, load: loadCopyRewrites } = useCopyLibrary()

/**
 * 把页内改写结果同步到文案库（同一采集来源只保留最新一次改写结果）。
 * @param {string} content - 改写后的正文
 * @param {object} source - 采集条目（需含 id）
 */
async function recordRewriteToLibrary (content, source) {
  const text = String(content || '').trim()
  if (!text || !source || !source.id) return
  try {
    await upsertCopyRewrite({
      fromKey: collectFromKey(source.id),
      fromTitle: source.title || '',
      title: source.title || '',
      content: text,
      platform: source.platform || '',
      sourceUrl: source.sourceUrl || '',
    })
  } catch {
    // 文案库写入失败不阻塞改写主流程
  }
}

async function rewriteViaEngine (content) {
  let res
  try {
    // main 新增的字数控制（min/max）→ targetLength 语义映射：窄区间视为 short，宽高区间视为 long，其余 medium
    const minW = Number(rewriteWordCountMin.value) || 800
    const maxW = Number(rewriteWordCountMax.value) || 2000
    const wordCountTarget = maxW <= 800 ? 'short' : (minW >= 1500 || maxW >= 2500) ? 'long' : 'medium'
    const params = {
      mode: 'imitate',
      content: content,
      userSettings: {
        tone: STYLE_TO_TONE[rewriteStyle.value] || 'casual',
        targetWordCount: { min: minW, max: maxW },
        targetLength: wordCountTarget,
        knowledgeOptions: {
          useViralLibrary: useViralLibrary.value,
          usePersonalKnowledge: usePersonalExperience.value,
        },
      },
      // 策略传参契约（与 RewriteView / AiWriterPanel 一致）：手动=所选 id（未选 null），自动=null 走引擎匹配
      strategyId: strategyMode.value === 'manual' ? (rewriteStrategyId.value || null) : null,
    }
    res = await aiRewrite(params)
  } catch (e) {
    // IPC 异常归一化为 __error 形态，调用方 formatUserError 消费统一形状（审查 W-7）
    return { __error: { code: -99, message: (e && e.message) || String(e) } }
  }
  // aiRewrite 返回 { code, data: { success, result } }；归一化为旧 aggregationRewrite 的 { result_content } 消费形态
  if (res && res.code === 0 && res.data && res.data.success && res.data.result) {
    return { result_content: res.data.result, knowledgeRefs: res.data.knowledgeRefs || [] }
  }
  // 失败时透传原始 res（含 errorCode/message），供调用方 formatUserError 映射友好文案
  if (res && (res.code !== 0 || (res.data && res.data.success === false))) {
    return { __error: res }
  }
  return null
}
const showPublishModal = ref(false)
let genreDraftId = null
const rssUrl = ref('')
const urlListInput = ref('')
const batchCollecting = ref(false)
const batchTaskId = ref(null)
const batchProgress = ref(0)
const batchProgressText = ref('')
const batchError = ref('')
let batchPollTimer = null
// Lazy getters：推迟 i18n 解析到首次访问，避免模块顶层调用 getAppLocale()
// 在 Vite dev server 模块变换阶段 i18n 未就绪时抛出异常导致整个懒加载 chunk 失败。
// 与 c3c395570 (Accounts.vue) 同模式。
const _rewriteStyles = ref(null)
function getRewriteStyles() {
  if (!_rewriteStyles.value) {
    _rewriteStyles.value = [
      { label: resolveNotifyText('collection.rewriteStyleEasy').text, value: '轻松易懂' },
      { label: resolveNotifyText('collection.rewriteStyleFormal').text, value: '正式严谨' },
      { label: resolveNotifyText('collection.rewriteStyleEyeCatching').text, value: '吸引眼球' },
      { label: resolveNotifyText('collection.rewriteStyleDeep').text, value: '深度分析' },
      { label: resolveNotifyText('collection.rewriteStyleCognitive').text, value: '认知锚点' },
    ]
  }
  return _rewriteStyles.value
}

// ── 字数区间校验（共享 composable，与 RewriteView 一致）──
const { error: rewriteWordCountError } = useWordCountValidation(
  rewriteWordCountMin,
  rewriteWordCountMax,
  (key) => resolveNotifyText('collection.' + key).text
)

onMounted(async () => {
  await loadDrafts();
  await loadCollectedItems()
  void loadCopyRewrites()
  void loadRewriteStrategies()
  void refreshStrategyPreview()
})

onUnmounted(() => {
  stopBatchPolling()
})

async function loadDrafts () {
  const raw = await storeGetSetting('drafts')
  // API 不可用（bridge fallback 返回 null）或无数据时，保持当前 drafts 不覆盖
  if (raw == null) return
  try { drafts.value = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { drafts.value = [] }
}

async function saveDrafts () {
  await storeSetSetting('drafts', JSON.stringify(drafts.value))
}

function createDraft () {
  const draft = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: '',
    content: '',
    source: 'manual',
    created_at: new Date().toLocaleString('zh-CN'),
  }
  drafts.value.unshift(draft)
  saveDrafts()
  router.push('/publish?draft=' + draft.id)
}

async function importFromClipboard () {
  try {
    const text = await navigator.clipboard.readText()
    if (!text) { notifyWarning('collection.clipboardEmpty'); return }
    const lines = text.split('\n').filter(Boolean)
    const title = lines[0].slice(0, 64)
    const content = lines.slice(1).join('\n').slice(0, 10000)
    const draft = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: title || '从剪贴板导入',
      content: content || text.slice(0, 10000),
      source: 'clipboard',
      created_at: new Date().toLocaleString('zh-CN'),
    }
    drafts.value.unshift(draft)
    saveDrafts()
    notifySuccess('collection.importedLines', { params: { count: lines.length } })
  } catch (e) {
    // formatUserError 的 fallback 已含场景前缀，无需再拼接（避免「读取剪贴板失败: 读取剪贴板失败」双前缀）
    notifyError('collection.clipboardReadFailed', { message: formatUserError(e, { fallback: resolveNotifyText('collection.clipboardReadFailed').text }).message })
  }
}

async function openCollection (platform) {
  const url = PLATFORM_DASHBOARD_URLS[platform]
  if (!url) {
    notifyWarning('collection.platformUnsupported')
    return
  }
  // 在顶部全局标签栏打开平台页（page-manager 体系承载渲染，替代原分屏监控页内嵌视图）
  const tabId = await tabStore.createTab({
    url,
    platform,
    title: t('collection.platformTabTitle', { platform: PLATFORM_NAMES[platform] || platform }),
  })
  if (tabId) {
    notifySuccess('collection.openedPlatform', { params: { platform } })
  }
}

async function editDraft (d) {
  router.push('/publish?draft=' + d.id)
}

function goPublish (d) {
  router.push('/publish?draft=' + d.id)
}

async function deleteDraft (d) {
  const confirmed = await notifyConfirm('collection.confirmDeleteDraft', { title: resolveNotifyText('collection.confirmTitle').text })
  if (!confirmed) return
  drafts.value = drafts.value.filter(x => x.id !== d.id)
  saveDrafts()
  notifySuccess('collection.deleted')
}

// 错误码常量（与 IPC handler 同步）
const ERROR_CODES = {
  TIMEOUT: -1,
  SOURCE_UNREACHABLE: -2,
  QUOTA_EXHAUSTED: -3,
  CONTENT_UNEXTRACTABLE: -4,
  BACKEND_UNAVAILABLE: -5,
}
const RETRYABLE_CODES = new Set([-1, -2, -3, -5, -7])
// 抖音/小红书域名 → 视频采集通道（hostname 精确匹配，避免正则误判）
const VIDEO_PLATFORM_DOMAINS = ['douyin.com', 'v.douyin.com', 'xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com']
function isVideoPlatformUrl (url) {
  const u = String(url || '').trim()
  try {
    const parsed = new URL(u)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return VIDEO_PLATFORM_DOMAINS.includes(host) || host.endsWith('.douyin.com') || host.endsWith('.xiaohongshu.com')
  } catch { return false }
}
function formatVideoDuration (seconds) {
  if (!seconds || seconds <= 0) return ''
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m + ':' + String(s).padStart(2, '0')
}
const PLATFORM_KEYS = ['douyin', 'xiaohongshu']
function platformLabel (platform) {
  const key = { douyin: 'collection.platformDouyin', xiaohongshu: 'collection.platformXiaohongshu' }[platform]
  if (key) return resolveNotifyText(key).text
  return PLATFORM_KEYS.includes(platform) ? platform : (platform || '')
}
function videoStageText (stage) {
  const map = {
    probe: 'collection.videoStageProbe',
    downloading: 'collection.videoStageDownloading',
    extracting: 'collection.videoStageExtracting',
    transcribing: 'collection.videoStageTranscribing',
  }
  const key = map[stage]
  return key ? resolveNotifyText(key).text : ''
}

// 视频采集：按预估时间推进阶段提示（Phase 1 假进度，真实进度留待 Phase 2 任务轮询）
let videoStageTimers = []
function startVideoStageProgression () {
  stopVideoStageProgression()
  const stages = [
    { stage: 'probe', ms: 5000 },
    { stage: 'downloading', ms: 60000 },
    { stage: 'extracting', ms: 10000 },
    { stage: 'transcribing', ms: Infinity },
  ]
  let elapsed = 0
  videoCollectStage.value = stages[0].stage
  for (let i = 1; i < stages.length; i++) {
    elapsed += stages[i - 1].ms
    const next = stages[i].stage
    videoStageTimers.push(setTimeout(() => { videoCollectStage.value = next }, elapsed))
  }
}
function stopVideoStageProgression () {
  videoStageTimers.forEach(t => clearTimeout(t))
  videoStageTimers = []
  videoCollectStage.value = ''
}

// 采集错误细分提示：按 classifyCollectError 的 reason 渲染「具体原因 + 建议」文案，
// 重试按钮按 retryable 显示（invalid_url/internal_url/protocol 类输入错误重试无意义）。
const collectErrorDetail = computed(() => {
  if (!collectError.value) return ''
  const raw = collectError.value.message || collectError.value
  const { reason, detailKey } = classifyCollectError(raw)
  // 视频管线错误：后端 detail 已含具体中文提示（如「视频过长（15:32），采集仅支持 10 分钟内的短视频」），
  // 剥掉错误码前缀后直接透传，避免模板文案丢失实际时长/大小等关键信息。
  if (reason.startsWith('video_') || reason.startsWith('asr_')) {
    // [A-Z_0-9-]+ 字符类已含 - 与数字，可同时匹配 VIDEOCLONE_XXX: / -8: / -422: 前缀
    const detail = typeof raw === 'string' ? raw.replace(/^[A-Z_0-9-]+:\s*/, '') : ''
    if (detail) return detail
  }
  const fullKey = 'collection.' + detailKey
  const resolved = resolveNotifyText(fullKey)
  if (resolved.resolved) return resolved.text
  // 分类文案缺失时回退原始消息（不暴露技术文本的兜底已由 formatUserError 处理）
  return typeof raw === 'string' ? raw : resolveNotifyText('collection.collectFailed', { message: '' }).text
})
const collectErrorRetryable = computed(() => {
  if (!collectError.value) return false
  const raw = collectError.value.message || collectError.value
  return classifyCollectError(raw).retryable
})

// 检测采集结果是否为反爬安全验证页面（如百度家号返回「百度安全验证」标题）
function isSecurityChallenge (res) {
  if (!res || !res.title) return false
  const title = String(res.title)
  const content = String(res.content || '')
  // 安全验证页特征：标题含「安全验证」/「百度安全」或被正文长度极短且含提示语
  if (title.includes('安全验证') || title.includes('百度安全') || title.includes('百度安全检测')) return true
  if (content.length < 60 && (content.includes('安全验证') || content.includes('网络不给力') || content.includes('请稍后重试'))) return true
  return false
}

// 聚合路径失败 — 无论任何错误码，都回退到 urlCollectFetch 降级

// 反爬站点路由：知乎/百家号对裸 HTTP 请求有风控（trafilatura/axios 直连触发反爬检测），
// 必须直接走 Node 端 stealth 浏览器通道，跳过 Python 聚合层裸连——
// 先裸连失败再回退会白白多触发一次风控（提高封 IP 风险）。
async function needsStealthRoute (api, url) {
  if (!api || typeof api.urlCollectNeedsStealth !== 'function') return false
  try {
    const res = await api.urlCollectNeedsStealth(url)
    return !!(res && res.code === 0 && res.data && res.data.needsStealth)
  } catch {
    // 查询失败不阻塞采集，按非反爬站点走默认聚合路径
    return false
  }
}

// stealth 通道采集结果 → 采集条目（与聚合路径的字段映射保持一致）
function stealthResultToItem (result, sourceUrl) {
  const data = (result && result.data) || {}
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: data.title || '',
    content: data.content || '',
    description: (data.description || data.content || '').slice(0, 120),
    coverImage: data.coverImage || '',
    publishTime: data.publishTime || '',
    source: data.source || 'url',
    sourceUrl,
    wordCount: data.word_count || (data.content ? data.content.length : 0),
  }
}

async function collectUrl () {
  const api = getApi()
  if (!linkUrl.value || !linkUrl.value.trim()) {
    notifyWarning('collection.enterLink')
    return
  }
  collecting.value = true
  collectedResult.value = null
  rewriteResult.value = ''
  collectError.value = null
  try {
    const trimmedUrl = linkUrl.value.trim()
    // 抖音/小红书链接 → 视频采集通道（下载 + ASR 转写）
    if (isVideoPlatformUrl(trimmedUrl)) {
      if (api && api.aggregationCollectVideo) {
        startVideoStageProgression()
        let res
        try {
          res = await api.aggregationCollectVideo({ url: linkUrl.value.trim() })
        } finally {
          stopVideoStageProgression()
        }
        if (res && res.code !== undefined && res.code !== 0) {
          collectError.value = { code: res.code, message: res.message }
          notifyError('collection.collectFailed', { message: formatUserError(res, { fallback: resolveNotifyText('collection.collectFailed').text }).message })
          return
        }
        if (res && res.title) {
          const item = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            title: res.title,
            content: res.content || res.transcript || '',
            description: (res.content || res.transcript || '').slice(0, 120),
            source: collectSourceType.value,
            sourceUrl: linkUrl.value,
            wordCount: res.word_count || 0,
            mediaType: res.media_type || 'video',
            duration: res.duration || 0,
            platform: (res.metadata && res.metadata.platform) || '',
          }
          collectedResult.value = item
          addedToViral.value = false
          collectedItems.value.unshift(item)
          saveCollectedItems()
          notifySuccess('collection.collectSuccess')
          return
        }
        collectError.value = { code: -99, message: resolveNotifyText('collection.collectFailed').text }
        notifyError('collection.collectFailed', { message: collectError.value.message })
        return
      }
      // 视频通道不可用 → 不回退到图文采集（图文链路无法处理视频），直接提示
      collectError.value = { code: -99, message: resolveNotifyText('collection.collectUnavailable').text }
      notifyWarning('collection.collectUnavailable')
      return
    }
    // 反爬站点（知乎/百家号）→ 直接走 Node stealth 浏览器通道，跳过 Python 聚合层裸连
    if (api && api.urlCollectFetch && await needsStealthRoute(api, trimmedUrl)) {
      const result = await api.urlCollectFetch(trimmedUrl)
      if (result.code !== 0) {
        collectError.value = { code: result.code, message: result.message || (result.data && result.data.error) || '' }
        notifyError('collection.collectFailed', { message: formatUserError(result, { fallback: resolveNotifyText('collection.collectFailed').text }).message })
        return
      }
      const item = stealthResultToItem(result, linkUrl.value)
      collectedResult.value = item
      addedToViral.value = false
      collectedItems.value.unshift(item)
      saveCollectedItems()
      notifySuccess('collection.collectSuccess')
      return
    }
    // 优先走 Python aggregation API（content-aggregator v1 引擎）
    if (api && api.aggregationCollect) {
      let res = await api.aggregationCollect({
        url: linkUrl.value.trim(),
        source_type: collectSourceType.value,
        rewrite: false,
      })
      // aggregationCollect 失败 → 清空结果，回退到 urlCollectFetch 降级路径
      if (res && res.code !== undefined && res.code !== 0) {
        res = null // 清空结果，让后续逻辑走 urlCollectFetch 回退
      }
      // 反爬安全验证页防御：部分站点（如百家号）直接 HTTP 会返回「百度安全验证」
      // 页面（标题=百度安全验证、正文为「网络不给力」等提示），并非真实内容。
      // 检测到安全验证特征 → 视作采集失败，回退到 Node 端 stealth 浏览器重采。
      if (res && isSecurityChallenge(res)) {
        res = null
      }
      if (res && res.title) {
        const item = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          title: res.title,
          content: res.content || '',
          description: res.content ? res.content.slice(0, 120) : '',
          source: collectSourceType.value,
          sourceUrl: linkUrl.value,
          wordCount: res.word_count || 0,
        }
        collectedResult.value = item
        addedToViral.value = false
        collectedItems.value.unshift(item)
        saveCollectedItems()
        notifySuccess('collection.collectSuccess')
        return
      }
    }
    // 回退到旧的 url-collect（Node.js 端）
    if (api && api.urlCollectFetch) {
      const result = await api.urlCollectFetch(linkUrl.value.trim())
      if (result.code !== 0) {
        // IPC 失败返回 { code, message, data }：message 为主，旧版/异常时兜底 data.error
        collectError.value = { code: result.code, message: result.message || (result.data && result.data.error) || '' }
        notifyError('collection.collectFailed', { message: formatUserError(result, { fallback: resolveNotifyText('collection.collectFailed').text }).message })
        return
      }
      const item = {
        ...result.data,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      }
      collectedResult.value = item
      addedToViral.value = false
      collectedItems.value.unshift(item)
      saveCollectedItems()
      notifySuccess('collection.collectSuccess')
      return
    }
    notifyWarning('collection.collectUnavailable')
  } catch (e) {
    collectError.value = { code: -99, message: formatUserError(e, { fallback: resolveNotifyText('collection.collectFailed').text }).message }
    notifyError('collection.collectRequestFailed', { message: collectError.value.message })
  } finally {
    collecting.value = false
  }
}

function retryCollect () {
  collectUrl()
}

async function collectAndRewrite () {
  // 一键采集+改写：先采集URL，成功后自动触发改写
  if (rewriteWordCountError.value) {
    notifyWarning('collection.wordCountInvalid')
    return
  }
  if (!linkUrl.value || !linkUrl.value.trim()) {
    notifyWarning('collection.enterLink')
    return
  }
  const api = getApi()
  // 前置校验：API能力检查（采集走 aggregationCollect；改写已切 Node 引擎 aiRewrite）
  if (!api || !api.aggregationCollect) {
    notifyWarning('collection.collectUnavailable')
    return
  }
  oneClickRewriting.value = true
  collecting.value = true
  rewriteError.value = null
  collectError.value = null
  rewriteResult.value = ''
  collectedResult.value = null
  try {
    const trimmedUrl = linkUrl.value.trim()
    // 抖音/小红书链接 → 视频采集通道（与 collectUrl 一致），转写文案作为改写输入
    if (isVideoPlatformUrl(trimmedUrl)) {
      if (!api.aggregationCollectVideo) {
        collectError.value = { code: -99, message: resolveNotifyText('collection.collectUnavailable').text }
        notifyWarning('collection.collectUnavailable')
        return
      }
      startVideoStageProgression()
      let videoRes
      try {
        videoRes = await api.aggregationCollectVideo({ url: linkUrl.value.trim() })
      } finally {
        stopVideoStageProgression()
      }
      if (videoRes && videoRes.code !== undefined && videoRes.code !== 0) {
        collectError.value = { code: videoRes.code, message: videoRes.message }
        notifyError('collection.collectFailed', { message: formatUserError(videoRes, { fallback: resolveNotifyText('collection.collectFailed').text }).message })
        return
      }
      if (videoRes && videoRes.title) {
        const videoItem = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          title: videoRes.title,
          content: videoRes.content || videoRes.transcript || '',
          description: (videoRes.content || videoRes.transcript || '').slice(0, 120),
          source: collectSourceType.value,
          sourceUrl: linkUrl.value,
          wordCount: videoRes.word_count || 0,
          mediaType: videoRes.media_type || 'video',
          duration: videoRes.duration || 0,
          platform: (videoRes.metadata && videoRes.metadata.platform) || '',
        }
        collectedResult.value = videoItem
        addedToViral.value = false
        collectedItems.value.unshift(videoItem)
        saveCollectedItems()
        notifySuccess('collection.collectSuccess')
        // Step 2: 用转写文案自动改写
        collecting.value = false
        rewriting.value = true
        try {
          const rewrite = await rewriteViaEngine(videoRes.content || videoRes.transcript || '')
          if (rewrite && rewrite.result_content) {
            rewriteResult.value = rewrite.result_content
            recordRewriteToLibrary(rewrite.result_content, videoItem)
            notifySuccess('collection.rewriteSuccess')
          } else {
            // 后端业务错误（resolve 返回）同样必须过 formatUserError：稳定 errorCode → locale 友好文案，
            // 禁止把后端原始 message（可能含环境变量名等技术细节）直出 UI（user-facing-messages 规范）
            const errorSource = rewrite && rewrite.__error ? rewrite.__error : (rewrite || {})
            const formatted = formatUserError(errorSource, { fallback: resolveNotifyText('collection.rewriteFailed').text })
            rewriteError.value = { code: rewrite && rewrite.code != null ? rewrite.code : -99, message: formatted.message }
            notifyError('collection.rewriteFailed', { message: rewriteError.value.message })
          }
        } catch (e) {
          rewriteError.value = { code: -99, message: formatUserError(e, { fallback: resolveNotifyText('collection.rewriteFailed').text }).message }
          notifyError('collection.rewriteFailed', { message: rewriteError.value.message })
        } finally {
          rewriting.value = false
        }
        return
      }
      collectError.value = { code: -99, message: resolveNotifyText('collection.collectFailed').text }
      notifyError('collection.collectFailed', { message: collectError.value.message })
      return
    }
    // 反爬站点（知乎/百家号）→ 直接走 Node stealth 浏览器通道采集，跳过 Python 聚合层裸连
    if (api.urlCollectFetch && await needsStealthRoute(api, trimmedUrl)) {
      const stealthResult = await api.urlCollectFetch(trimmedUrl)
      if (stealthResult.code !== 0) {
        collectError.value = { code: stealthResult.code, message: stealthResult.message || (stealthResult.data && stealthResult.data.error) || '' }
        notifyError('collection.collectFailed', { message: formatUserError(stealthResult, { fallback: resolveNotifyText('collection.collectFailed').text }).message })
        return
      }
      const stealthItem = stealthResultToItem(stealthResult, linkUrl.value)
      collectedResult.value = stealthItem
      addedToViral.value = false
      collectedItems.value.unshift(stealthItem)
      saveCollectedItems()
      notifySuccess('collection.collectSuccess')
      collecting.value = false
      // Step 2: 自动改写
      rewriting.value = true
      try {
        const rewrite = await api.aggregationRewrite({
          content: stealthItem.content || stealthItem.description || '',
          style: rewriteStyle.value,
          min_word_count: Number(rewriteWordCountMin.value),
          max_word_count: Number(rewriteWordCountMax.value),
        })
        if (rewrite && rewrite.result_content) {
          rewriteResult.value = rewrite.result_content
          recordRewriteToLibrary(rewrite.result_content, stealthItem)
          notifySuccess('collection.rewriteSuccess')
        } else {
          const formatted = formatUserError(rewrite || {}, { fallback: resolveNotifyText('collection.rewriteFailed').text })
          rewriteError.value = { code: rewrite && rewrite.code != null ? rewrite.code : -99, message: formatted.message }
          notifyError('collection.rewriteFailed', { message: rewriteError.value.message })
        }
      } catch (e) {
        rewriteError.value = { code: -99, message: formatUserError(e, { fallback: resolveNotifyText('collection.rewriteFailed').text }).message }
        notifyError('collection.rewriteFailed', { message: rewriteError.value.message })
      } finally {
        rewriting.value = false
      }
      return
    }
    // Step 1: 采集
    let res = await api.aggregationCollect({
      url: linkUrl.value.trim(),
      source_type: collectSourceType.value,
      rewrite: false,
    })
    if (res && res.code !== undefined && res.code !== 0) {
      res = null
    }
    if (!res || !res.title) {
      // 回退到旧 urlCollectFetch
      if (api.urlCollectFetch) {
        const fallback = await api.urlCollectFetch(linkUrl.value.trim())
        if (fallback.code !== 0) {
          collectError.value = { code: fallback.code, message: fallback.message || (fallback.data && fallback.data.error) || '' }
          notifyError('collection.collectFailed', { message: formatUserError(fallback, { fallback: resolveNotifyText('collection.collectFailed').text }).message })
          return
        }
        res = fallback.data
      } else {
        notifyWarning('collection.collectUnavailable')
        return
      }
    }
    collecting.value = false
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: res.title,
      content: res.content || '',
      description: (res.content || '').slice(0, 120),
      source: collectSourceType.value,
      sourceUrl: linkUrl.value,
      wordCount: res.word_count || 0,
    }
    collectedResult.value = item
    addedToViral.value = false
    collectedItems.value.unshift(item)
    saveCollectedItems()
    notifySuccess('collection.collectSuccess')
    // Step 2: 自动改写
    rewriting.value = true
    try {
      const rewrite = await rewriteViaEngine(res.content || res.description || '')
      if (rewrite && rewrite.result_content) {
        rewriteResult.value = rewrite.result_content
        recordRewriteToLibrary(rewrite.result_content, item)
        notifySuccess('collection.rewriteSuccess')
      } else {
        // 同上：业务错误 resolve 分支也必须走 formatUserError（i18n + 友好度强制机制）
        const errorSource = rewrite && rewrite.__error ? rewrite.__error : (rewrite || {})
        const formatted = formatUserError(errorSource, { fallback: resolveNotifyText('collection.rewriteFailed').text })
        rewriteError.value = { code: rewrite && rewrite.code != null ? rewrite.code : -99, message: formatted.message }
        notifyError('collection.rewriteFailed', { message: rewriteError.value.message })
      }
    } catch (e) {
      rewriteError.value = { code: -99, message: formatUserError(e, { fallback: resolveNotifyText('collection.rewriteFailed').text }).message }
      notifyError('collection.rewriteFailed', { message: rewriteError.value.message })
    } finally {
      rewriting.value = false
    }
  } catch (e) {
    collectError.value = { code: -99, message: formatUserError(e, { fallback: resolveNotifyText('collection.collectFailed').text }).message }
    notifyError('collection.collectRequestFailed', { message: collectError.value.message })
  } finally {
    collecting.value = false
    oneClickRewriting.value = false
  }
}

async function rewriteCollected () {
  if (!collectedResult.value) return
  if (rewriteWordCountError.value) {
    notifyWarning('collection.wordCountInvalid')
    return
  }
  const api = getApi()
  if (!api) {
    notifyWarning('collection.collectUnavailable')
    return
  }
  rewriting.value = true
  rewriteError.value = null
  try {
    const result = await rewriteViaEngine(collectedResult.value.content || collectedResult.value.description || '')
    if (result && result.result_content) {
      rewriteResult.value = result.result_content
      recordRewriteToLibrary(result.result_content, collectedResult.value)
      notifySuccess('collection.rewriteSuccess')
    } else {
      // 同上：业务错误 resolve 分支也必须走 formatUserError（i18n + 友好度强制机制）
      const errorSource = result && result.__error ? result.__error : (result || {})
      const formatted = formatUserError(errorSource, { fallback: resolveNotifyText('collection.rewriteFailed').text })
      rewriteError.value = { code: result && result.code != null ? result.code : -99, message: formatted.message }
      notifyError('collection.rewriteFailed', { message: rewriteError.value.message })
    }
  } catch (e) {
    rewriteError.value = { code: -99, message: formatUserError(e, { fallback: resolveNotifyText('collection.rewriteFailed').text }).message }
    notifyError('collection.rewriteFailed', { message: rewriteError.value.message })
  } finally {
    rewriting.value = false
  }
}

function retryRewrite () {
  rewriteCollected()
}

function clearResult () {
  collectedResult.value = null
  rewriteResult.value = ''
  rewriteError.value = null
  collectError.value = null
}

function getDraftFromItem (data) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: data.title || '',
    content: data.content || data.description || '',
    coverImage: data.coverImage || '',
    source: data.source || 'url',
    sourceUrl: data.sourceUrl || linkUrl.value || '',
    created_at: new Date().toLocaleString('zh-CN'),
  }
}

async function saveDraftAfterRewrite () {
  if (!rewriteResult.value) return
  const draft = getDraftFromItem({ ...collectedResult.value, content: rewriteResult.value })
  drafts.value.unshift(draft)
  await saveDrafts()
  genreDraftId = draft.id
  notifySuccess('collection.draftCreated')
}

async function goPublishAfterRewrite () {
  if (!rewriteResult.value) return
  if (!genreDraftId) {
    await saveDraftAfterRewrite()
  }
  if (genreDraftId) {
    showPublishModal.value = true
  }
}

function onPublishArticle () {
  showPublishModal.value = false
  if (genreDraftId) {
    router.push('/publish?draft=' + genreDraftId)
  }
}

function onPublishVideo (pipelineId) {
  showPublishModal.value = false
  if (!genreDraftId) return
  router.push({ path: '/create', query: { draft: genreDraftId, pipeline: pipelineId || 'story2video-compose' } })
}

function createFromCollected () {
  if (!collectedResult.value) return
  const draft = getDraftFromItem(collectedResult.value)
  drafts.value.unshift(draft)
  saveDrafts()
  collectedResult.value = null
  linkUrl.value = ''
  notifySuccess('collection.draftCreated')
  router.push('/publish?draft=' + draft.id)
}

async function addCollectedToViral () {
  if (!collectedResult.value) return
  const item = collectedResult.value
  // 将采集结果映射为爆款库条目
  const viralItem = {
    title: item.title || '',
    content: item.content || item.description || '',
    url: item.sourceUrl || linkUrl.value || '',
    author: item.author || '',
    source: 'collection',
    platform: item.platform || '',
    tags: item.tags || [],
    cover_url: item.coverImage || '',
  }
  const res = await addViralToLibrary(viralItem)
  if (res && res.code === 0) {
    addedToViral.value = true
    notifySuccess('knowledgeBase.addSuccess')
  } else {
    notifyWarning('knowledgeBase.loadFailed')
  }
}

function createFromItem (item) {
  collectedResult.value = item
  createFromCollected()
}

function sendItemToPipeline (item) {
  // 发送到 Story2Video 流水线：将采集内容作为文案输入
  collectedResult.value = item
  const draft = getDraftFromItem(item)
  drafts.value.unshift(draft)
  saveDrafts()
  notifySuccess('collection.draftCreated')
  router.push('/create?draft=' + draft.id)
}

function goPublishFromItem (item) {
  collectedResult.value = item
  const draft = getDraftFromItem(item)
  drafts.value.unshift(draft)
  saveDrafts()
  notifySuccess('collection.draftCreated')
  router.push('/publish?draft=' + draft.id)
}

// ─── 采集记录标签页 ──────────────────────────────────────

// 采集记录持久化键名（与草稿箱分开存储）
const COLLECTED_ITEMS_KEY = 'collected_items'

async function loadCollectedItems () {
  const raw = await storeGetSetting(COLLECTED_ITEMS_KEY)
  if (raw == null) return
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    collectedItems.value = Array.isArray(parsed) ? parsed : []
  } catch {
    collectedItems.value = []
  }
}

async function saveCollectedItems () {
  // 采集时间补全：新建条目在落盘时打上 createdAt，作为「采集记录 / 文案库」的时间展示依据。
  // 历史条目（无 createdAt）在首次再次落盘时补记为本次时间（旧数据无真实采集时间可考）。
  const now = new Date().toISOString()
  for (const item of collectedItems.value) {
    if (item && !item.createdAt) item.createdAt = now
  }
  await storeSetSetting(COLLECTED_ITEMS_KEY, JSON.stringify(collectedItems.value))
}

/** 合法标签页：采集 / 文案库（2026-09-16 原三个标签合并为两个） */
const TAB_KEYS = ['collect', 'records']

function switchTab (tab) {
  if (!TAB_KEYS.includes(tab)) return
  activeTab.value = tab
}

// 点击采集记录，创建草稿并进入内容编辑页
function openRecordForEdit (item) {
  if (!item || !item.id) return
  const draft = getDraftFromItem(item)
  drafts.value.unshift(draft)
  saveDrafts()
  notifySuccess('collection.recordsEditCreated')
  router.push('/publish?draft=' + draft.id)
}

async function deleteRecord (item) {
  const confirmed = await notifyConfirm('collection.recordsDeleteConfirm', { title: resolveNotifyText('collection.confirmTitle').text })
  if (!confirmed) return
  collectedItems.value = collectedItems.value.filter(x => x.id !== item.id)
  if (collectedResult.value && collectedResult.value.id === item.id) {
    collectedResult.value = null
    rewriteResult.value = ''
  }
  await saveCollectedItems()
  notifySuccess('collection.recordsDeleted')
}

async function clearAllRecords () {
  const confirmed = await notifyConfirm('collection.recordsClearAllConfirm', { title: resolveNotifyText('collection.confirmTitle').text })
  if (!confirmed) return
  // 只清 collected_items（采集正文）；改写文案（copy_library_rewrites）保留，需逐条删除
  collectedItems.value = []
  collectedResult.value = null
  rewriteResult.value = ''
  await saveCollectedItems()
  notifySuccess('collection.recordsCleared')
}

function formatRecordSource (item) {
  const map = { url: 'URL', rss: 'RSS', sitemap: 'Sitemap', api: 'API', batch: 'batch' }
  const s = item.source || 'url'
  return map[s] || s
}

function formatRecordWordCount (item) {
  const wc = item.wordCount || (item.content || '').length
  return resolveNotifyText('collection.recordsWordCount', { count: wc }).text
}

function formatRecordTime (item) {
  if (item.createdAt) return item.createdAt
  if (item.collectedAt) return item.collectedAt
  return item.created_at || ''
}

// ─── 文案库合并视图（采集正文 + 改写文案，2026-09-16 两标签合一）───

/** 文案筛选：全部 / 采集 / 改写 */
const LIBRARY_FILTERS = [
  { value: 'all', labelKey: 'collection.libraryFilterAll' },
  { value: ORIGIN_COLLECT, labelKey: 'collection.libraryOriginCollect' },
  { value: ORIGIN_REWRITE, labelKey: 'collection.libraryOriginRewrite' },
]
const libraryFilter = ref('all')
const previewRewrite = ref(null)

/**
 * 合并文案库列表：采集正文（collected_items 中有正文的条目，保留完整字段）
 * + 改写文案（copy_library_rewrites），按时间倒序统一排序。
 * ⚠️ 过滤条件与时间回退链须与 useCopyLibrary.buildCopyLibraryItems 保持一致
 * （此处不复用该函数是因为模板需要 entry.item 原始引用而非扁平副本）。
 * entry = { key, origin, item(采集原文), record(改写记录), createdAt }
 */
const libraryItems = computed(() => {
  const collect = collectedItems.value
    .filter((it) => it && it.id && (it.content || it.description))
    .map((it) => ({ key: ORIGIN_COLLECT + ':' + it.id, origin: ORIGIN_COLLECT, item: it, record: null, createdAt: it.createdAt || it.collectedAt || it.created_at || '' }))
  const rewrite = rewrites.value
    .filter((it) => it && it.id && it.content)
    .map((it) => ({ key: ORIGIN_REWRITE + ':' + it.id, origin: ORIGIN_REWRITE, item: null, record: it, createdAt: it.createdAt || '' }))
  return [...rewrite, ...collect].sort(compareByCreatedAtDesc)
})

const filteredLibraryItems = computed(() => (
  libraryFilter.value === 'all' ? libraryItems.value : libraryItems.value.filter((e) => e.origin === libraryFilter.value)
))

/** 改写卡片元信息：字数 · 改写时间 · 改写自 */
function rewriteMetaText (record) {
  const parts = [resolveNotifyText('collection.libraryWordCount', { count: record.wordCount || (record.content || '').length }).text]
  if (record.createdAt) {
    const d = new Date(record.createdAt)
    const time = Number.isNaN(d.getTime()) ? String(record.createdAt) : d.toLocaleString()
    parts.push(resolveNotifyText('collection.libraryRewrittenAt', { time }).text)
  }
  if (record.fromTitle) parts.push(resolveNotifyText('collection.libraryFrom', { title: record.fromTitle }).text)
  return parts.join(' · ')
}

/**
 * 【改写】按钮（合并版文案库）：把文案经 sessionStorage 交接给改写页并跳转，
 * 改写页挂载后自动填入正文（仿写模式、平台带入）并直接开始改写；
 * 改写成功后由改写页按 fromKey 回写文案库（同一来源只保留最新结果）。
 */
function rewriteFromLibrary (entry) {
  if (!entry) return
  const src = entry.origin === ORIGIN_REWRITE ? entry.record : entry.item
  const content = String((src && (src.content || src.description)) || '').trim()
  if (!content) {
    notifyWarning('collection.libraryRewriteNoContent')
    return
  }
  const ok = setRewriteHandoff({
    content,
    title: (src && src.title) || '',
    platform: (src && src.platform) || '',
    sourceUrl: (src && src.sourceUrl) || '',
    fromKey: entry.origin === ORIGIN_REWRITE ? ORIGIN_REWRITE + ':' + String(src.id) : collectFromKey(src.id),
    fromTitle: (src && src.title) || '',
  })
  if (!ok) {
    notifyError('collection.rewriteHandoffFailed')
    return
  }
  router.push('/rewrite?from=collection')
}

/** 删除一条改写文案（仅移除改写记录，不动采集原文） */
async function deleteLibraryRewrite (record) {
  if (!record || !record.id) return
  const confirmed = await notifyConfirm('collection.recordsDeleteConfirm', { title: resolveNotifyText('collection.confirmTitle').text })
  if (!confirmed) return
  await removeRewrite(record.id)
  notifySuccess('collection.recordsDeleted')
}

// ─── 批量采集 ─────────────────────────────────────────────

async function collectBatch (sourceType) {
  const api = getApi()
  if (!api || !api.aggregationCollectBatch) {
    notifyWarning('collection.collectUnavailable')
    return
  }

  let payload = { source_type: sourceType }
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
    batchError.value = formatUserError(e, { fallback: resolveNotifyText('collection.batchCollectFailed').text }).message
    notifyError('collection.batchCollectFailed', { message: batchError.value })
    batchCollecting.value = false
  }
}

function startBatchPolling () {
  stopBatchPolling()
  batchPollTimer = setInterval(async () => {
    if (!batchTaskId.value) return
    const api = getApi()
    if (!api || !api.aggregationTaskStatus) return
    try {
      const res = await api.aggregationTaskStatus(batchTaskId.value)
      const data = res && res.data ? res.data : res
      const status = data.status || res.status
      const total = data.total || 0
      const completed = data.completed !== undefined ? data.completed : data.done || 0

      if (status === 'completed' || status === 'success') {
        batchProgress.value = 100
        batchProgressText.value = resolveNotifyText('collection.batchComplete').text
        batchCollecting.value = false
        const items = data.items || data.results || []
        items.forEach((item) => {
          collectedItems.value.unshift({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            title: item.title || '',
            content: item.content || '',
            description: (item.content || '').slice(0, 120),
            source: 'batch',
            sourceUrl: item.source_url || item.sourceUrl || '',
          wordCount: item.word_count || 0,
          })
        })
        saveCollectedItems()
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
          batchProgressText.value = resolveNotifyText('collection.batchProgressText', { params: { completed, total } }).text
        }
      }
    } catch (e) {
      // 轮询失败不立即中断，继续下次轮询
    }
  }, 2000)
}

function stopBatchPolling () {
  if (batchPollTimer) {
    clearInterval(batchPollTimer)
    batchPollTimer = null
  }
}

function cancelBatchCollect () {
  batchCollecting.value = false
  batchTaskId.value = null
  stopBatchPolling()
  notifyInfo('collection.batchCancelled')
}
</script>

<style scoped>
.coral-check { accent-color: var(--coral); }

.rewrite-compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
}
.rewrite-compare > div {
  min-width: 0;
}
.compare-textarea {
  width: 100%;
  min-height: 180px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.6;
  box-sizing: border-box;
  font-family: inherit;
  background: #fff;
}
.compare-textarea:focus { border-color: var(--coral); outline: none; }
.compare-textarea[readonly] { background: var(--soft-stone); color: var(--text-secondary); }

@media (max-width: 768px) {
  .rewrite-compare { grid-template-columns: 1fr; }
}
.o-disabled { opacity: 0.55; pointer-events: none; }

.collection-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  background: var(--soft-stone, #f5f5f5);
  border-radius: 8px;
  padding: 3px;
  width: fit-content;
}
.collection-tab-btn {
  padding: 6px 16px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  color: var(--text-secondary, #666);
  transition: all 0.2s;
}
.collection-tab-btn:hover {
  color: var(--text-primary, #333);
}
.collection-tab-btn.active {
  background: #fff;
  color: var(--primary, #ea580c);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.collection-record-card { cursor: pointer; transition: box-shadow 0.2s; }
.collection-record-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
.collection-record-card:focus-visible { outline: 2px solid var(--primary, #ea580c); outline-offset: 2px; }

/* ── 文案库合并视图样式（原 CopyLibraryPanel 迁入）── */
.library-filters {
  display: flex;
  gap: 4px;
  background: var(--soft-stone, #f5f5f5);
  border-radius: 8px;
  padding: 3px;
}
.library-filter-btn {
  padding: 4px 12px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-secondary, #666);
  transition: all 0.15s;
}
.library-filter-btn:hover { color: var(--text-primary, #333); }
.library-filter-btn.active {
  background: #fff;
  color: var(--primary, #ea580c);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.card-platform-badge { display: flex; align-items: center; gap: 6px; }
.copy-library-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.copy-origin-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
}
.copy-origin-badge.is-rewrite { background: #fef2f2; color: var(--coral, #ea580c); }

.copy-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(23, 23, 32, 0.45);
  padding: 20px;
}
.copy-preview-modal {
  width: min(720px, 100%);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--surface, #fff);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.22);
  padding: 18px 24px 22px;
}
.copy-preview-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.copy-preview-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary, #25252b); }
.copy-preview-close {
  border: none;
  background: transparent;
  color: var(--muted, #73777d);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}
.copy-preview-close:hover { background: var(--soft-stone, #f5f5f5); color: var(--text-primary); }
.copy-preview-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 10px 0 12px; font-size: 12px; color: var(--muted, #73777d); }
/* 长文本展示契约：显式换行 + 任意位置断词，避免长串英文/链接撑破弹窗 */
.copy-preview-content {
  margin: 0;
  overflow-y: auto;
  min-height: 0;
  padding: 12px;
  border-radius: 10px;
  background: var(--soft-stone, #f7f7f8);
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary, #25252b);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.collection-record-card .card-actions button.danger {
  color: #d32f2f;
}
.collection-record-card .card-actions button.danger:hover {
  background: #fde8e8;
}
</style>
