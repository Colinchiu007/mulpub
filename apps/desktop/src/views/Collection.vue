<template>
  <div>
    <div class="cohere-page-header">
      <div>
        <div class="collection-tabs" role="tablist">
          <button role="tab" :aria-selected="activeTab === 'collect'" class="collection-tab-btn" :class="{ active: activeTab === 'collect' }" @click="switchTab('collect')">{{ $t('collection.tabCollect') }}</button>
          <QuickCollectTab :active="activeTab === 'quick'" @select="switchTab('quick')" />
          <button role="tab" :aria-selected="activeTab === 'records'" class="collection-tab-btn" :class="{ active: activeTab === 'records' }" data-testid="collection-tab-library" @click="switchTab('records')">{{ $t('collection.tabRecords') }}</button>
          <CollectionCreatorTab :active="activeTab === 'creator'" @select="switchTab('creator')" />
        </div>
        <div class="page-subtitle">从各平台采集内容，或快速创建草稿</div>
      </div>
      <div class="page-actions">
        <button class="cohere-btn-secondary" @click="importFromClipboard"><el-icon><DocumentCopy /></el-icon> 从剪贴板导入</button>
        <button class="cohere-btn-primary" @click="createDraft">＋ 新建草稿</button>
      </div>
    </div>

    <div v-if="activeTab === 'collect'" class="cohere-content">
      <!-- URL 采集输入 -->
      <div class="cohere-card col-panel">
        <div class="col-toolbar">
          <span class="col-toolbar-icon"><el-icon><Link /></el-icon></span>
          <select v-model="collectSourceType" class="col-select">
            <option v-for="s in collectSources" :key="s.type" :value="s.type">{{ s.name }}</option>
          </select>
          <input
            v-model="linkUrl"
            placeholder="输入文章链接，自动采集标题、正文、封面..."
            class="col-input col-input--grow"
            @keyup.enter="collectUrl"
          />
          <button data-testid="collection-collect-btn" class="cohere-btn-primary" @click="collectUrl" :disabled="collecting || oneClickRewriting">
            {{ collecting ? '采集中...' : '采集' }}
          </button>
          <button class="cohere-btn-primary" @click="collectAndRewrite" :disabled="collecting || oneClickRewriting">
            {{ oneClickRewriting ? $t('collection.oneClickRewriting') : $t('collection.oneClickRewrite') }}
          </button>
          <button v-if="collectError && RETRYABLE_CODES.has(collectError.code)" class="cohere-btn-secondary col-btn-retry" @click="retryCollect" :disabled="collecting">
            🔄 重试
          </button>
        </div>
        <div v-if="collectError" class="col-error-banner">
          {{ collectErrorDetail }}
          <button v-if="collectError && collectErrorRetryable" class="cohere-btn-secondary col-btn-retry-sm" @click="retryCollect" :disabled="collecting">
            🔄 重试
          </button>
        </div>
        <div v-if="videoCollectStage" data-testid="collection-video-stage" class="col-stage-banner">
          {{ videoStageText(videoCollectStage) }}
        </div>
        <div v-if="collectedResult" class="col-result-box">
          <div class="col-result-title">✅ {{ collectedResult.title || '无标题' }}</div>
          <div class="col-result-meta">
            {{ collectedResult.description ? collectedResult.description.slice(0, 120) + '...' : '' }}
            <span v-if="collectedResult.coverImage"> · 有封面图</span>
            <span v-if="collectedResult.mediaType === 'video'"> · <el-icon><VideoCamera /></el-icon> {{ $t('collection.videoTranscriptLabel') }}<template v-if="collectedResult.duration"> · {{ formatVideoDuration(collectedResult.duration) }}</template><template v-if="collectedResult.platform && PLATFORM_KEYS.includes(collectedResult.platform)"> · {{ platformLabel(collectedResult.platform) }}</template></span>
          </div>
          <!-- 改写策略选择（2026-09-15 补齐）：与 /rewrite 页同组件同契约，此前采集页改写无策略入口 -->
          <RewriteStrategyPicker
            class="col-mt8"
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
          <div class="col-chip-row">
            <button class="cohere-btn-primary" @click="createFromCollected">创建草稿</button>
            <button
              class="cohere-btn-secondary"
              :disabled="addedToViral"
              :title="addedToViral ? $t('knowledgeBase.addedToViral') : $t('knowledgeBase.addToViral')"
              @click="addCollectedToViral"
            >
              {{ addedToViral ? '✓ ' + $t('knowledgeBase.addedToViral') : $t('knowledgeBase.addToViral') }}
            </button>
            <label class="col-check-label" :class="{ 'o-disabled': rewriting || oneClickRewriting }">
              <input type="checkbox" v-model="useViralLibrary" class="coral-check" :disabled="rewriting || oneClickRewriting" /> 结合爆款库
            </label>
            <label class="col-check-label" :class="{ 'o-disabled': rewriting || oneClickRewriting }">
              <input type="checkbox" v-model="usePersonalExperience" class="coral-check" :disabled="rewriting || oneClickRewriting" /> 结合个人经历
            </label>
            <select v-model="rewriteStyle" class="col-select-sm" :disabled="rewriting || oneClickRewriting">
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
            <button v-if="rewriteError && RETRYABLE_CODES.has(rewriteError.code)" class="cohere-btn-secondary col-btn-retry" @click="retryRewrite" :disabled="rewriting">
              🔄 重试
            </button>
            <template v-if="rewriteResult">
              <button class="cohere-btn-secondary" @click="saveDraftAfterRewrite"><el-icon><FolderAdd /></el-icon> 存入草稿</button>
              <button class="cohere-btn-primary" @click="goPublishAfterRewrite"><el-icon><Promotion /></el-icon> 去发布</button>
            </template>
            <button class="cohere-btn-secondary" @click="clearResult">取消</button>
            <div v-if="rewriteError" class="col-error-banner">
              {{ rewriteError.message }}
            </div>
          </div>
          <!-- 改写结果对比：原文 vs 改写后 -->
          <div v-if="rewriteResult" class="rewrite-compare col-compare">
            <div>
              <div class="col-compare-title"><el-icon><Document /></el-icon> {{ $t('collection.originalContent') }}</div>
              <textarea class="compare-textarea" readonly :value="(collectedResult && (collectedResult.content || collectedResult.description)) || ''"></textarea>
            </div>
            <div>
              <div class="col-compare-title"><el-icon><MagicStick /></el-icon> {{ $t('collection.rewrittenContent') }}</div>
              <textarea class="compare-textarea" v-model="rewriteResult"></textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- 批量采集区域 -->
      <div class="cohere-card col-panel">
        <div class="cohere-section-title col-section-title">{{ $t('collection.batchCollectTitle') }}</div>

        <!-- RSS 批量采集 -->
        <div class="col-block">
          <div class="col-block-title">{{ $t('collection.rssBatch') }}</div>
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

        <!-- URL 列表批量采集 -->
        <div class="col-block">
          <div class="col-block-title">{{ $t('collection.urlListBatch') }}</div>
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

        <!-- 知乎收藏夹批量采集/改写（2026-10-03：清单直选 + 采集并改写 + 批量动作） -->
        <div style="margin-bottom:var(--space-sm);padding-top:var(--space-sm);border-top:1px solid var(--border)">
          <div style="font-weight:600;font-size: var(--font-size-sm);margin-bottom:4px">{{ $t('collection.zhihuFavlist.title') }}</div>
          <div style="display:flex;gap:var(--space-sm);align-items:center;flex-wrap:wrap">
            <input
              v-model="zhihuAccessSecret"
              type="password"
              :placeholder="$t('collection.zhihuFavlist.secretPlaceholder')"
              style="flex:1;min-width:200px;border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size: var(--font-size-sm)"
            />
            <button class="cohere-btn-secondary" @click="loadZhihuFavlists" :disabled="zhihuFavlistLoading || !zhihuAccessSecret.trim()">
              {{ zhihuFavlistLoading ? $t('collection.zhihuFavlist.loading') : $t('collection.zhihuFavlist.loadBtn') }}
            </button>
          </div>
          <div v-if="zhihuFavlists.length" style="display:flex;gap:var(--space-sm);align-items:center;margin-top:8px;flex-wrap:wrap">
            <!-- 采集范围：指定收藏夹（默认）/ 全部收藏 -->
            <select v-model="zhihuFavScope" style="border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size: var(--font-size-sm)" data-testid="zhihu-fav-scope">
              <option value="favlist">{{ $t('collection.zhihuFav.scopeFavlist') }}</option>
              <option value="all">{{ $t('collection.zhihuFav.scopeAll') }}</option>
            </select>
            <select
              v-model="zhihuSelectedFavlist"
              :disabled="zhihuFavScope === 'all'"
              style="flex:1;min-width:200px;border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size: var(--font-size-sm);"
            >
              <option v-for="f in zhihuFavlists" :key="f.urlToken" :value="f.urlToken">
                {{ f.title }}{{ f.isPublic ? '' : '（私密）' }}
              </option>
            </select>
            <!-- 数量 N（1-100，默认 50）+ 全量（≤200）+ 包含已采集 -->
            <input
              v-model.number="zhihuFavCount"
              type="number" min="1" max="100"
              :disabled="zhihuFavFullMode"
              :placeholder="$t('collection.zhihuFav.countPlaceholder')"
              style="width:130px;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size: var(--font-size-sm)"
              data-testid="zhihu-fav-count"
            />
            <label style="display:flex;align-items:center;gap:4px;font-size: var(--font-size-xs)">
              <input v-model="zhihuFavFullMode" type="checkbox" data-testid="zhihu-fav-fullmode" />{{ $t('collection.zhihuFav.fullMode') }}
            </label>
            <label style="display:flex;align-items:center;gap:4px;font-size: var(--font-size-xs)">
              <input v-model="zhihuFavIncludeCollected" type="checkbox" data-testid="zhihu-fav-include-collected" />{{ $t('collection.zhihuFav.includeCollected') }}
            </label>
            <button class="cohere-btn-secondary" @click="loadZhihuFavItems" :disabled="zhihuFavListLoading || (zhihuFavScope === 'favlist' && !zhihuSelectedFavlist)">
              {{ zhihuFavListLoading ? $t('collection.zhihuFav.loadingContents') : $t('collection.zhihuFav.loadContents') }}
            </button>
          </div>
          <div v-if="zhihuFavScopeHint" style="margin-top:6px;font-size: var(--font-size-xs);color:var(--color-text-secondary)" data-testid="zhihu-fav-scope-hint">
            {{ zhihuFavScopeHint }}
          </div>
          <!-- 收藏夹清单（直选） -->
          <div v-if="zhihuFavItems.length" style="margin-top:10px;border:1px solid var(--border);border-radius:8px;max-height:320px;overflow-y:auto" data-testid="zhihu-fav-items">
            <div style="display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--border);font-size: var(--font-size-xs)">
              <label style="display:flex;align-items:center;gap:4px">
                <input type="checkbox" :checked="zhihuFavAllSelected" @change="toggleZhihuFavAll($event.target.checked)" />{{ $t('collection.zhihuFav.selectAll') }}
              </label>
              <span style="color:var(--color-text-secondary)">{{ $t('collection.zhihuFav.selectedCount', { count: String(zhihuFavSelectedItems.length) }) }}</span>
              <span style="flex:1"></span>
              <button class="cohere-btn-primary" @click="runZhihuFavCollectRewrite" :disabled="zhihuFavBatching || !zhihuFavSelectedItems.length" data-testid="zhihu-fav-collect-rewrite">
                {{ zhihuFavBatching ? $t('collection.zhihuFav.collecting') : $t('collection.zhihuFav.collectAndRewrite') }}
              </button>
              <button v-if="zhihuFavBatching" class="cohere-btn-secondary" @click="cancelZhihuFavBatch">{{ $t('collection.cancelBatch') }}</button>
            </div>
            <div v-for="(it, idx) in zhihuFavItems" :key="it.url + idx" style="display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--border-soft, #f0f0f0);font-size: var(--font-size-xs)">
              <input
                type="checkbox"
                :checked="zhihuFavChecked.has(it.url)"
                :disabled="it.collected && !zhihuFavIncludeCollected"
                @change="toggleZhihuFavItem(it)"
              />
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="it.title || it.url">{{ it.title || it.url }}</span>
              <span class="cohere-tag" style="font-size:var(--font-size-xs)">{{ zhihuKindLabel(it.kind) }}</span>
              <span style="color:var(--color-text-secondary)">{{ formatFavTime(it.favTime) }}</span>
              <span v-if="it.collected" style="color:var(--color-text-secondary)">· {{ $t('collection.zhihuFav.markCollected') }}</span>
            </div>
          </div>
          <!-- 旧整夹直采（保留兼容） -->
          <div style="display:flex;gap:var(--space-sm);align-items:center;margin-top:8px;flex-wrap:wrap">
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
          <div v-if="zhihuFavlistProgress" style="margin-top:8px;font-size: var(--font-size-xs);color:var(--color-text-secondary)">
            {{ zhihuFavlistProgress }}
          </div>
          <div v-if="zhihuFavlistError" style="margin-top:8px;padding:6px 10px;background:#fff3f3;border-radius:4px;font-size: var(--font-size-xs);color:#d32f2f">
            {{ zhihuFavlistError }}
          </div>
          <div style="font-size: var(--font-size-xs);color:var(--color-text-secondary);margin-top:4px">
            {{ $t('collection.zhihuFavlist.hint') }}
          </div>
        </div>

        <!-- 「采集并改写」进度卡（整体进度 + 可展开逐条清单，双边界事件驱动） -->
        <div v-if="zhihuFavBatching || zhihuFavProgressLines.length" class="col-result-box" data-testid="zhihu-fav-batch-progress">
          <div class="col-block-title">{{ $t('collection.zhihuFavlist.progressTitle') }}</div>
          <div class="col-progress-track">
            <div class="col-progress-fill" :style="{ width: zhihuFavProgressPercent + '%' }"></div>
          </div>
          <div class="col-result-meta">
            {{ $t('collection.zhihuFavlist.progressText', { done: String(zhihuFavProgressDone), total: String(zhihuFavProgressTotal) }) }}
          </div>
          <div v-if="zhihuFavSummary" class="col-result-meta" data-testid="zhihu-fav-summary" style="margin-top:4px">
            {{ zhihuFavSummary }}
          </div>
          <button v-if="zhihuFavProgressLines.length" class="cohere-btn-secondary" style="margin-top:6px;font-size:var(--font-size-xs)" @click="zhihuFavDetailOpen = !zhihuFavDetailOpen">
            {{ zhihuFavDetailOpen ? $t('collection.zhihuFavlist.collapseDetail') : $t('collection.zhihuFavlist.expandDetail') }}（{{ zhihuFavProgressLines.length }}）
          </button>
          <div v-if="zhihuFavDetailOpen" style="margin-top:6px;max-height:200px;overflow-y:auto;font-size:var(--font-size-xs)">
            <div v-for="(line, i) in zhihuFavProgressLines" :key="i" style="padding:2px 0">
              {{ line }}
            </div>
          </div>
        </div>

        <!-- 批量采集进度 -->
        <div v-if="batchTaskId" class="col-result-box">
          <div class="col-block-title">{{ $t('collection.batchProgress') }}</div>
          <div class="col-progress-track">
            <div class="col-progress-fill" :style="{ width: batchProgress + '%' }"></div>
          </div>
          <div class="col-result-meta">
            {{ batchProgressText }}
          </div>
          <button v-if="batchCollecting" class="cohere-btn-secondary col-btn-cancel" @click="cancelBatchCollect">
            {{ $t('collection.cancelBatch') }}
          </button>
        </div>
        <div v-if="batchError" class="col-error-banner">
          {{ batchError }}
        </div>
      </div>

      <!-- 采集结果累计列表 -->
      <div v-if="collectedItems.length > 0" class="col-list-wrap">
        <div class="cohere-section-title col-section-title col-section-title--flex">
          <span>采集结果（{{ collectedItems.length }} 篇）</span>
          <label style="display:flex;align-items:center;gap:4px;font-size: var(--font-size-xs)">
            <input type="checkbox" :checked="batchAllSelected" @change="toggleSelectAll($event.target.checked)" data-testid="batch-select-all" />{{ $t('collection.zhihuFavlist.selectAll') }}
          </label>
          <button class="cohere-btn-secondary col-btn-clear" @click="collectedItems = []; collectedResult = null">清空</button>
        </div>
        <!-- 批量操作条（勾选后浮出；Q20A 确认框在 composable 内） -->
        <div v-if="batch.selectedCount.value > 0" style="display:flex;gap:var(--space-sm);align-items:center;flex-wrap:wrap;margin:8px 0;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface, #fff)" data-testid="batch-action-bar">
          <span style="font-size: var(--font-size-sm)">{{ $t('collection.batch.selectedCount', { count: String(batch.selectedCount.value) }) }}</span>
          <!-- 图文平台/账号（发布图文用；按内容形态预筛） -->
          <template v-if="batchPlatformOptions.length">
            <select v-model="batchPlatformScope" style="border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:var(--font-size-xs)" data-testid="batch-platform-scope">
              <option v-for="p in batchPlatformOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
            </select>
            <label v-for="acc in batchAccountOptions" :key="acc.id" style="display:flex;align-items:center;gap:3px;font-size:var(--font-size-xs)">
              <input
                type="checkbox"
                :checked="batch.isBatchAccountSelected('imageText', batchPlatformScope, acc.id)"
                :disabled="acc.disabled"
                @change="batch.toggleBatchAccount('imageText', batchPlatformScope, acc.id)"
              />{{ acc.name || acc.id }}
            </label>
          </template>
          <span style="flex:1"></span>
          <button class="cohere-btn-primary" :disabled="batchPublishing" @click="batchPublishImages" data-testid="batch-publish-images">{{ $t('collection.batch.publishImages') }}</button>
          <button class="cohere-btn-primary" :disabled="batchPublishing" @click="batchGenerateVideos" data-testid="batch-generate-videos">{{ $t('collection.batch.generateVideos') }}</button>
          <button class="cohere-btn-primary" :disabled="batchPublishing || !batch.batchVideoPool.value.length" @click="batchPublishVideos" data-testid="batch-publish-videos">
            {{ $t('collection.batch.publishVideos') }}{{ batch.batchVideoPool.value.length ? `（${batch.batchVideoPool.value.length}）` : '' }}          </button>
        </div>
        <!-- 视频平台/账号（仅本批有产物时显示；发布视频用） -->
        <div v-if="batch.selectedCount.value > 0 && batch.batchVideoPool.value.length && batchVideoPlatformOptions.length" style="display:flex;gap:var(--space-sm);align-items:center;flex-wrap:wrap;margin:0 0 8px;padding:8px 12px;border:1px dashed var(--border);border-radius:8px">
          <span style="font-size:var(--font-size-xs);color:var(--color-text-secondary)">{{ $t('collection.batch.videoPlatformLabel') }}</span>
          <select v-model="batchVideoPlatformScope" style="border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:var(--font-size-xs)" data-testid="batch-video-platform-scope">
            <option v-for="p in batchVideoPlatformOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
          <label v-for="acc in batchVideoAccountOptions" :key="'v' + acc.id" style="display:flex;align-items:center;gap:3px;font-size:var(--font-size-xs)">
            <input
              type="checkbox"
              :checked="batch.isBatchAccountSelected('video', batchVideoPlatformScope, acc.id)"
              :disabled="acc.disabled"
              @change="batch.toggleBatchAccount('video', batchVideoPlatformScope, acc.id)"
            />{{ acc.name || acc.id }}
          </label>
        </div>
        <div v-if="batch.batchVideoPool.value.length" style="font-size:var(--font-size-xs);color:var(--color-text-secondary);margin:4px 0" data-testid="batch-video-pool">
          {{ $t('collection.batch.videoPoolNote', { count: String(batch.batchVideoPool.value.length) }) }}
        </div>
        <div class="cohere-card-grid">
          <div v-for="item in collectedItems" :key="item.id" class="cohere-card" :class="{ 'col-item--active': item.id === collectedResult?.id }">
            <div class="card-top">
              <input
                type="checkbox"
                :checked="batch.isSelected(item.id)"
                style="margin-right:6px"
                :data-testid="'batch-item-check-' + item.id"
                @change="batch.toggleSelect(item)"
              />
              <div class="card-icon"><el-icon><component :is="item.mediaType === 'video' ? VideoCamera : Document" /></el-icon></div>
              <div class="card-info">
                <div class="card-platform">{{ item.title || '无标题' }}</div>
                <div class="card-account">
                  {{ item.source || 'url' }} · {{ item.wordCount || (item.content || '').length }}字
                  <template v-if="item.mediaType === 'video' && item.duration"> · {{ formatVideoDuration(item.duration) }}</template>
                  <template v-if="item.mediaType === 'video' && item.platform && PLATFORM_KEYS.includes(item.platform)"> · {{ platformLabel(item.platform) }}</template>
                </div>
                <!-- 改写黑盒接通（C3b/D2）：改写结果可见 -->
                <div v-if="item.rewriteFailed" style="font-size:var(--font-size-xs);color:#e6a23c;margin-top:2px">{{ $t('collection.zhihuFav.rewriteFailedBadge') }}</div>
                <div v-else-if="item.rewrittenContent" style="font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" :title="item.rewrittenContent">{{ $t('collection.zhihuFav.rewrittenBadge') }}：{{ item.rewrittenContent.slice(0, 40) }}</div>
                <div v-if="item.imageFallbacks && item.imageFallbacks.length" style="font-size:var(--font-size-xs);color:var(--color-text-secondary)">{{ $t('collection.zhihuFav.imageFallbackBadge', { count: String(item.imageFallbacks.length) }) }}</div>
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
      <div class="cohere-stat-grid col-stat-grid-mb">
        <div class="cohere-stat-card col-stat-card-click" @click="createDraft">
          <div class="stat-value">✏️</div>
          <div class="stat-label">新建草稿</div>
        </div>
        <div class="cohere-stat-card col-stat-card-click" @click="importFromClipboard">
          <div class="stat-value"><el-icon><DocumentCopy /></el-icon></div>
          <div class="stat-label">剪贴板导入</div>
        </div>
        <div class="cohere-stat-card col-stat-card-click" @click="openCollection('weibo')">
          <div class="stat-value">✧</div>
          <div class="stat-label">微博</div>
        </div>
        <div class="cohere-stat-card col-stat-card-click" @click="openCollection('zhihu')">
          <div class="stat-value">❓</div>
          <div class="stat-label">知乎</div>
        </div>
        <div class="cohere-stat-card col-stat-card-click" @click="openCollection('toutiao')">
          <div class="stat-value">📰</div>
          <div class="stat-label">今日头条</div>
        </div>
      </div>

      <!-- 草稿列表 -->
      <div class="cohere-section-title">草稿箱</div>
      <EmptyState
        v-if="drafts.length === 0"
        data-testid="collection-drafts-empty"
        :title="$t('collection.draftsEmptyTitle')"
        :description="$t('collection.draftsEmptyDesc')"
        :action-text="$t('collection.draftsEmptyAction')"
        @action="createDraft"
      >
        <template #icon><el-icon><EditPen /></el-icon></template>
      </EmptyState>
      <div v-else class="cohere-card-grid">
        <div v-for="d in drafts" :key="d.id" class="cohere-card">
          <div class="card-top">
            <div class="card-icon"><el-icon><Document /></el-icon></div>
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
    <!-- 博主监控：独立组件，避免把 2700+ 行的采集页继续堆胖 -->
    <CreatorMonitor v-else-if="activeTab === 'creator'" />
    <!-- 快捷采集：启动器 + 指令管理；执行结果通过 onQuickCollected 走既有采集结果链路 -->
    <QuickCollectPanel v-else-if="activeTab === 'quick'" active @collected="onQuickCollected" />
    <div v-else-if="activeTab === 'records'" class="cohere-content" role="tabpanel" :aria-label="$t('collection.recordsTitle')">
      <div class="cohere-section-title col-section-title col-section-title--flex">
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
        <!-- 类别筛选（2026-10-03）：与来源筛选并列，选项来自统一内容类别真源 -->
        <div class="library-filters" role="group" :aria-label="$t('collection.categoryFilterLabel')">
          <button
            v-for="c in categoryFilterOptions"
            :key="c.value"
            type="button"
            class="library-filter-btn"
            :class="{ active: categoryFilter === c.value }"
            :aria-pressed="categoryFilter === c.value"
            :data-testid="'collection-category-filter-' + c.value"
            @click="categoryFilter = c.value"
          >{{ c.label }}</button>
        </div>
        <button class="cohere-btn-secondary col-btn-clear" :disabled="collectedItems.length === 0" @click="clearAllRecords">
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
        :title="$t('collection.libraryFilterEmptyTitle')"
        :description="$t('collection.libraryFilterEmptyDesc')"
        :action-text="$t('collection.libraryFilterEmptyAction')"
        @action="libraryFilter = 'all'; categoryFilter = 'all'"
      >
        <template #icon><el-icon><Search /></el-icon></template>
      </EmptyState>
      <div v-else class="cohere-card-grid" data-testid="copy-library-list">
        <template v-for="entry in filteredLibraryItems" :key="entry.key">
          <!-- 采集正文卡片：信息与操作以原「采集记录」为准，新增【改写】跳转改写页直接改写 -->
          <div v-if="entry.origin === 'collect'" class="cohere-card collection-record-card" role="button" tabindex="0" :data-testid="'copy-library-item-' + entry.item.id" @click="openRecordForEdit(entry.item)" @keyup.enter="openRecordForEdit(entry.item)">
            <div class="card-top">
              <div class="card-icon"><el-icon><component :is="entry.item.mediaType === 'video' ? VideoCamera : Document" /></el-icon></div>
              <div class="card-info">
                <div class="card-platform">{{ entry.item.title || $t('collection.recordsUntitled') }}</div>
                <div class="card-account">
                  {{ formatRecordSource(entry.item) }} · {{ formatRecordWordCount(entry.item) }}
                  <template v-if="entry.item.mediaType === 'video' && entry.item.duration"> · {{ formatVideoDuration(entry.item.duration) }}</template>
                  <template v-if="entry.item.mediaType === 'video' && entry.item.platform && PLATFORM_KEYS.includes(entry.item.platform)"> · {{ platformLabel(entry.item.platform) }}</template>
                  · {{ formatRecordTime(entry.item) }}
                </div>
                <!-- 类别标签（2026-10-03）：统一真源；未知类别置灰并说明已删除 -->
                <div class="card-tags" :data-testid="'collection-item-tags-' + entry.item.id">
                  <template v-if="editingTagsItem === entry.item">
                    <button
                      v-for="c in contentCategories"
                      :key="c.category_key"
                      type="button"
                      class="tag-toggle"
                      :class="{ 'tag-toggle--on': editingTags.includes(c.category_key) }"
                      :data-testid="'collection-tag-toggle-' + entry.item.id + '-' + c.category_key"
                      @click.stop="toggleEditingTag(c.category_key)"
                    >{{ c.name }}</button>
                    <button type="button" class="tag-save" :data-testid="'collection-tag-save-' + entry.item.id" @click.stop="submitEditTags">
                      {{ $t('collection.tagsSave') }}
                    </button>
                    <button type="button" class="tag-cancel" @click.stop="cancelEditTags">{{ $t('collection.tagsCancel') }}</button>
                  </template>
                  <template v-else>
                    <span
                      v-for="key in entryTags(entry)"
                      :key="key"
                      class="card-tag"
                      :class="{ 'card-tag--unknown': !isTagKnown(key) }"
                      :title="isTagKnown(key) ? entryTagLabel(key) : $t('collection.tagUnknownHint')"
                    >{{ entryTagLabel(key) }}</span>
                    <button type="button" class="card-tag-edit" :data-testid="'collection-edit-tags-' + entry.item.id" @click.stop="startEditTags(entry.item)">
                      {{ $t('collection.tagsEdit') }}
                    </button>
                  </template>
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
              <div class="card-icon"><el-icon><MagicStick /></el-icon></div>
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

    <!-- ASR 依赖安装引导弹窗（-6 语音转写引擎不可用时触发） -->
    <el-dialog
      v-model="asrInstallVisible"
      :title="$t('collection.asrInstallTitle')"
      width="520px"
      :close-on-click-modal="false"
      data-testid="asr-install-dialog"
    >
      <div class="asr-install-body">
        <p class="asr-install-intro">{{ $t('collection.asrInstallIntro') }}</p>
        <div v-if="asrInstallStage && asrInstallStage !== 'failed'" class="asr-install-progress" data-testid="asr-install-progress">
          <div class="asr-install-stage-text">
            <span v-if="asrInstallStage === 'checking'">{{ $t('collection.asrInstallChecking') }}</span>
            <span v-else-if="asrInstallStage === 'installing'">{{ $t('collection.asrInstallInstalling') }}</span>
            <span v-else-if="asrInstallStage === 'switching'">{{ $t('collection.asrInstallSwitching') }}</span>
            <span v-else-if="asrInstallStage === 'model-checking' || asrInstallStage === 'model-downloading'">{{ $t('collection.asrInstallModel') }}</span>
            <span v-else-if="asrInstallStage === 'done'">✅ {{ $t('collection.asrInstallDone') }}</span>
          </div>
          <div v-if="asrInstallDetail" class="asr-install-detail">{{ asrInstallDetail }}</div>
          <div class="asr-install-bar">
            <div class="asr-install-bar-fill" :style="{ width: (asrInstallStage === 'done' ? 100 : Math.max(asrInstallPercent, 8)) + '%' }"></div>
          </div>
        </div>
        <div v-if="asrInstallStage === 'failed'" class="asr-install-error" data-testid="asr-install-error">
          <p>❌ {{ asrInstallError || $t('collection.asrInstallFailed') }}</p>
          <p class="asr-install-manual">{{ $t('collection.asrInstallManualHint') }}</p>
          <code class="asr-install-cmd">pip install faster-whisper -i https://pypi.tuna.tsinghua.edu.cn/simple</code>
        </div>
      </div>
      <template #footer>
        <button
          v-if="asrInstallStage === 'failed'"
          class="cohere-btn-primary"
          data-testid="asr-install-retry-btn"
          @click="startAsrInstall"
        >{{ $t('collection.asrInstallRetry') }}</button>
        <button
          v-else-if="!asrInstallStage"
          class="cohere-btn-primary"
          data-testid="asr-install-confirm-btn"
          @click="startAsrInstall"
        >{{ $t('collection.asrInstallBtn') }}</button>
        <button
          v-if="asrInstallStage !== 'installing' && asrInstallStage !== 'model-downloading'"
          class="cohere-btn-secondary"
          @click="closeAsrInstallDialog"
        >{{ $t('collection.asrInstallCancel') }}</button>
      </template>
    </el-dialog>
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
import { Document, DocumentCopy, EditPen, FolderAdd, Link, MagicStick, Promotion, Search, VideoCamera } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { useNotify } from '@/composables/useNotify'
// M-3：批量轮询的失败兜底守卫（连续失败计数 + 总时长上限 + 统一收口）
import { useBatchPollGuard } from '@/composables/useBatchPollGuard'
import { useAsrInstall } from '@/composables/useAsrInstall'
import { resolveNotifyText } from '@/utils/notifyCore'
import { storeGetSetting, storeSetSetting, aiRewrite, aiListRewriteStrategies, aiGetRecommendedStrategies } from '@/api/publisher'
import { extractRewriteHistoryId, attachRewriteLineage } from '@/utils/rewrite-lineage'
import { formatUserError } from '@/utils/user-facing-error'
import { classifyCollectError } from '@/utils/collect-error'
import { useWordCountValidation } from '@/composables/useWordCountValidation'
import { addViralToLibrary } from '@/api/knowledge-library'
import PublishDestinationModal from '@/components/PublishDestinationModal.vue'
import WordCountRangeInput from '@/components/WordCountRangeInput.vue'
import RewriteStrategyPicker from '@/components/RewriteStrategyPicker.vue'
import { useCopyLibrary, collectFromKey, ORIGIN_COLLECT, ORIGIN_REWRITE, compareByCreatedAtDesc } from '@/composables/useCopyLibrary'
import { setRewriteHandoff } from '@/utils/rewrite-handoff'
import { safeHttpUrl } from '@multi-publish/shared-utils/src/safe-http-url'
import { normalizeCollectedItem, normalizeItemTags, itemTags, CollectionCreatorTab } from '@/features/collection/collected-item'
import { QuickCollectTab, QuickCollectPanel } from '@/features/collection/quick-collect-ui'
import { mapFavBatchResultsToItems, countOriginalFallback } from '@/features/collection/collection-batch'
import CreatorMonitor from '@/features/collection/CreatorMonitor.vue'
import { usePlatformStore } from '@/stores/platforms'
import { useAccountStore } from '@/stores/accounts'
import { useCollectionBatchPublish } from '@/composables/useCollectionBatchPublish'
import {
  contentCategoriesRef, loadContentCategories, watchContentCategories, categoryLabel,
} from '@/composables/useContentCategories'

const router = useRouter()
const { notifyError, notifySuccess, notifyWarning, notifyInfo, notifyConfirm } = useNotify()
const tabStore = useTabStore()
const { t } = useI18n()
// 统一内容类别（2026-10-03）：采集库类别标签与热门选题/账号分组共用同一真源
const contentCategories = contentCategoriesRef()
let categoriesUnsubscribe = null
const categoryTagCtx = computed(() => ({
  knownCategoryKeys: contentCategories.value.map((c) => c.category_key),
}))
const drafts = ref([])
const linkUrl = ref('')
const collecting = ref(false)
const rewriting = ref(false)
const oneClickRewriting = ref(false)
const collectedResult = ref(null)
const collectError = ref(null)
const videoCollectStage = ref('')  // 视频采集分阶段提示: probe/downloading/extracting/transcribing

// ASR 依赖安装引导弹窗（-6 语音转写引擎不可用时触发，2026-09-19）
// M-16：进度事件订阅与 1200ms 自动重试计时器**由 composable 持有**并在自身
// onUnmounted 里清理。此前两者分别住在组件与裸 setTimeout 里，清理逻辑存在却
// 不在同一处 —— 新增计时器时极易「只加业务不加工」/「只加清理不加工」，本次
// 缺陷正是如此。状态也一并委托，组件侧不再持有这两类副作用的句柄。
const asrInstall = useAsrInstall({
  getApi,
  resolveNotifyText,
  formatUserError,
  notifySuccess,
  onRetry: (url) => { linkUrl.value = url; void collectUrl() },
})
const asrInstallVisible = asrInstall.visible // checking/installing/switching/model-checking/model-downloading/done/failed
const asrInstallStage = asrInstall.stage
const asrInstallDetail = asrInstall.detail
const asrInstallPercent = asrInstall.percent
const asrInstallError = asrInstall.error
const asrInstallPendingUrl = asrInstall.pendingUrl // 安装成功后自动重试的采集 URL（M-16 重构后由 composable 持有）
const startAsrInstall = asrInstall.start
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

// 归因链（PRD-PUBLISH-REWRITE-LINEAGE-2026-10-05）：本页「当前改写结果」对应的 rewrite_history 行 id。
// 写点只有 rewriteViaEngine 成功分支一处（它是唯一拿得到信封的地方），读点只有 saveDraftAfterRewrite 一处。
// 改写失败时不更新它——旧的 id 与界面上仍在的旧正文保持配对，比"内容没变但关联丢了"更正确。
let collectRewriteLineageId = null

// 清空改写结果必须同时清掉关联 id（QM-6 前端轴 F2）：两者是同一个产物的两半，
// 分头复位就会留下"新正文 + 旧 id"这种假归因。今天读点被 rewriteResult 非空门控挡住，
// 但那只是巧合——门控一旦改动（例如给空结果也留草稿入口），潜伏的串关联立刻变成事实。
function clearRewriteResult () {
  rewriteResult.value = ''
  collectRewriteLineageId = null
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
    // 归因链：这里是本页唯一能拿到信封的地方，所以「当前改写结果的 rewrite_history 行 id」
    // 只在此处写一次（由 saveDraftAfterRewrite 读一次）——三个调用点各写一遍必然漂移。
    collectRewriteLineageId = extractRewriteHistoryId(res)
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

// ─── 知乎收藏夹批量采集/改写 ───
const batchTaskId = ref(null)
const zhihuAccessSecret = ref('')
const zhihuFavlists = ref([])
const zhihuSelectedFavlist = ref('')
const zhihuFavlistLoading = ref(false)
const zhihuFavlistBatching = ref('') // '' | 'collect' | 'rewrite'
const zhihuFavlistProgress = ref('')
const zhihuFavlistError = ref('')
const zhihuFavlistResults = ref([]) // 批量采集结果（供批量改写用）

async function saveZhihuSecret () {
  try {
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
    // 1. 获取收藏夹内容 URL 列表
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
    // 2. 批量采集（主进程 BatchRateController 串行 + 间隔 + 退避）
    zhihuFavlistProgress.value = resolveNotifyText('collection.zhihuFavlist.collectingProgress', { count: urls.length }).text
    const r = await api.zhihuFavlistBatchCollect({ urls })
    if (r.code !== 0) {
      zhihuFavlistError.value = r.message || resolveNotifyText('collection.zhihuFavlist.loadFailed').text
      return
    }
    const { completed, failed, cancelled, circuitBroken } = r.data
    // 3. 结果入列表（2026-10-03 P0 修复：旧代码 `...x.data.data` 多取一层导致
    // title/content/sourceUrl 全丢成空壳；正确形状是 results[i].data 即采集结果本体，
    // sourceUrl 按清单 index 对齐回填。回归锁见 Collection.test.js zhihuFavlistBatchCollect 用例）
    const contentsList = (contentsData && contentsData.items) || []
    const items = (r.data.results || []).filter((x) => x && x.ok && x.data).map((x) => ({
      ...x.data,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      sourceUrl: (contentsList[x.index] && contentsList[x.index].url) || '',
    }))
    for (const item of items) {
      collectedItems.value.unshift(item)
    }
    saveCollectedItems()
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
  // 优先改写本次采集结果；无结果时改写已采集列表中有正文的条目
  const source = zhihuFavlistResults.value.length
    ? zhihuFavlistResults.value
    : collectedItems.value.filter((x) => (x.content || '').trim().length >= 20)
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
    const r = await api.zhihuFavlistBatchRewrite({ contents, style: rewriteStyle.value, length: 'keep' })
    if (r.code !== 0) {
      zhihuFavlistError.value = r.message || resolveNotifyText('collection.zhihuFavlist.loadFailed').text
      return
    }
    const { completed, failed, cancelled, circuitBroken } = r.data
    // 改写结果写回条目
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

// ═══════════════════════════════════════════════════════════════════
// 知乎收藏批量升级（2026-10-03 PRD-ZHIHU-FAV-BATCH）：
// 清单直选 → 采集并改写（进度双边界）→ 多选批量动作
// ═══════════════════════════════════════════════════════════════════
const zhihuFavScope = ref('favlist') // 'favlist' | 'all'
const zhihuFavCount = ref(50)
const zhihuFavFullMode = ref(false)
const zhihuFavIncludeCollected = ref(false)
const zhihuFavItems = ref([]) // 清单（元数据 + collected 标记）
const zhihuFavChecked = ref(new Set()) // 勾选的 url 集合
const zhihuFavListLoading = ref(false)
const zhihuFavBatching = ref(false)
const zhihuFavProgressLines = ref([])
const zhihuFavDetailOpen = ref(false)
const zhihuFavSummary = ref('')
const zhihuFavProgressDone = ref(0)
const zhihuFavProgressTotal = ref(0)
const zhihuFavScopeNote = ref('')
let zhihuFavProgressUnsubscribe = null

const platformStore = usePlatformStore()
const accountStore = useAccountStore()
const batch = useCollectionBatchPublish({
  platformStore,
  accountStore,
  notify: {
    confirm: async (key, opts) => notifyConfirm(key, opts),
    success: (k) => notifySuccess(k),
    warning: (k, opts) => notifyWarning(k, opts),
    // QM-6 M3 补充：error/warning 可能收到非 key 的原始 message（composable 的
    // Error.message），useNotify 对非 key 文案静默 → 改走显式 message 通道
    error: (k, opts) => {
      const text = resolveNotifyText(k, opts).text
      if (text && text !== k) notifyError(k, opts)
      else notifyWarning('collection.batch.actionFailed', { params: { message: k } })
    },
  },
})
const batchPlatformScope = ref('')
const batchPublishing = computed(() => false) // 预留：composable 执行中状态（确认框阻塞语义）
const batchPlatformOptions = computed(() => batch.usablePlatforms('imageText'))
const batchVideoPlatformOptions = computed(() => batch.usablePlatforms('video'))
const batchVideoPlatformScope = ref('')
const batchAllSelected = computed(() => collectedItems.value.length > 0 && batch.selectedCount.value === collectedItems.value.length)
function accountsOf (platformId) {
  const list = (accountStore.byPlatform && accountStore.byPlatform[platformId]) || []
  return list.map((a) => ({ ...a, disabled: a.disabled === true }))
}
const batchAccountOptions = computed(() => accountsOf(batchPlatformScope.value))
const batchVideoAccountOptions = computed(() => accountsOf(batchVideoPlatformScope.value))
// QM-6 M3 修复：所选平台必须写入 composable 的 batchSelection（否则 buildTargets 恒空，
// 三批量动作被 needAccount 拦死——评审发现测试直接手写 platforms 绕过了 UI 接线）
watch([batchPlatformScope, batchVideoPlatformScope], ([imgScope, vidScope]) => {
  if (imgScope) batch.batchSelection.value.imageText.platforms = [imgScope]
  if (vidScope) batch.batchSelection.value.video.platforms = [vidScope]
}, { immediate: true })
function toggleSelectAll (on) {
  batch.selectMany(collectedItems.value, on)
}
async function batchPublishImages () {
  const items = batch.selectedFrom(collectedItems.value)
  await batch.confirmAndPublishImages(items)
}
async function batchGenerateVideos () {
  const items = batch.selectedFrom(collectedItems.value)
  await batch.confirmAndGenerateVideos(items)
  await batch.refreshBatchVideos()
}
async function batchPublishVideos () {
  await batch.confirmAndPublishVideos()
}

const zhihuFavSelectedItems = computed(() => zhihuFavItems.value.filter((it) => zhihuFavChecked.value.has(it.url)))
const zhihuFavAllSelected = computed(() => zhihuFavItems.value.length > 0 && zhihuFavSelectedItems.value.length === zhihuFavItems.value.length)
const zhihuFavProgressPercent = computed(() => {
  if (!zhihuFavProgressTotal.value) return 0
  return Math.round((zhihuFavProgressDone.value / zhihuFavProgressTotal.value) * 100)
})
const zhihuFavScopeHint = computed(() => zhihuFavScopeNote.value || '')

/** 清单项「已采集」标记：与 collected_items 的 sourceUrl 集合比对（C2 去重真源） */
const collectedUrlSet = computed(() => new Set(collectedItems.value.map((it) => it.sourceUrl).filter(Boolean)))

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

/** 取消「采集并改写」（QM-6 M2：模板引用的函数必须存在；cancel IPC 通道已注册） */
function cancelZhihuFavBatch () {
  try {
    const api = getApi()
    if (api && typeof api.zhihuFavBatchCancel === 'function') {
      api.zhihuFavBatchCancel().catch(() => { /* 取消失败静默 */ })
    }
  } catch { /* 取消失败静默 */ }
}

/** 安全日志（渲染端轻量 console.warn，仅计数不落正文） */
function loggerWarnSafe (tag, msg) {
  console.warn('[' + tag + '] ' + msg)
}

/** 拉取收藏夹清单（scope=favlist 单夹 / scope=all 全部收藏聚合） */
async function loadZhihuFavItems () {
  zhihuFavListLoading.value = true
  zhihuFavlistError.value = ''
  zhihuFavScopeNote.value = ''
  zhihuFavChecked.value = new Set()
  try {
    await saveZhihuSecret()
    const api = getApi()
    const collectedUrls = collectedUrlSet.value
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
    // 数量不符明确提示（Q11）：申请 N 篇但实际更少
    const requested = zhihuFavFullMode.value ? 200 : zhihuFavCount.value
    if (!zhihuFavFullMode.value && items.length && items.length < requested) {
      zhihuFavScopeNote.value = (zhihuFavScopeNote.value ? zhihuFavScopeNote.value + '；' : '')
        + resolveNotifyText('collection.zhihuFavlist.fewerThanRequested', { actual: String(items.length), requested: String(requested) }).text
    }
    // 全量 200 封顶前端防御（Q21C：超出即中止并提示，不部分执行）
    if (zhihuFavFullMode.value && items.length > 200) {
      zhihuFavlistError.value = resolveNotifyText('collection.zhihuFavlist.fullModeCap').text
      return
    }
    // 已采集标记（C2）：后台比对，渲染层默认跳过 + forceRecollect 开关
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

/** 「采集并改写」编排（P0 修复 + Q16 直选式 + D2 自动改写 + Q26C 改写稿发布） */
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
      rewriteStyle: rewriteStyle.value,
      imageLocalization: true,
      forceRecollect: zhihuFavIncludeCollected.value,
      collectedUrls: [...collectedUrlSet.value],
      batchId: 'fb_' + Date.now().toString(36),
    })
    if (r.code !== 0) {
      zhihuFavlistError.value = r.message || resolveNotifyText('collection.zhihuFavlist.loadFailed').text
      return
    }
    const data = r.data || {}
    // 结果映射走唯一出口（P0 回归锁：禁止再出现 x.data.data 双层展开）。
    // ⚠ QM-6 C1 修复：handler 返回 data={completed,...,results:[{index,ok,data:{...}}]}，
    // 必须传 data.results（条目数组 data.items 没有 ok 字段，传 items 会被整批 continue 成零产出）
    const newItems = mapFavBatchResultsToItems(data.results || [], items, { source: 'zhihu-fav' })
    if ((data.completed || 0) > 0 && newItems.length === 0) {
      // 汇总与实际产出交叉校验（QM-6）：不一致说明契约断裂，宁可报错也不静默
      zhihuFavlistError.value = resolveNotifyText('collection.zhihuFavlist.mappingMismatch').text
      loggerWarnSafe('zhihu-fav-batch', 'completed=' + data.completed + ' but mapped 0 items')
    }
    for (const item of newItems) {
      collectedItems.value.unshift(normalizeCollectedItem(item, categoryTagCtx.value))
    }
    saveCollectedItems()
    zhihuFavlistResults.value = newItems
    // 改写黑盒接通（C3b/D2）：自动改写成功的条目同步进文案库（fromKey 幂等，同来源仅留最新）
    for (const item of newItems) {
      if (item.rewrittenContent && item.sourceUrl) {
        upsertCopyRewrite({
          fromKey: collectFromKey(item.id),
          fromTitle: item.title,
          title: item.title,
          content: item.rewrittenContent,
          sourceUrl: item.sourceUrl,
        }).catch(() => { /* 文案库写入失败不阻塞主流程 */ })
      }
    }
    zhihuFavSummary.value = resolveNotifyText('collection.zhihuFav.progressSummary', {
      success: String(data.completed || 0), failed: String(data.failed || 0),
      skipped: String(data.duplicateSkipped || 0), rewriteFailed: String(data.rewriteFailed || 0),
    }).text
      + (data.cancelled ? resolveNotifyText('collection.zhihuFavlist.batchDoneCancelledSuffix').text : '')
      + (data.circuitBroken ? resolveNotifyText('collection.zhihuFavlist.batchDoneCircuitBrokenSuffix').text : '')
    notifySuccess('collection.collectSuccess')
    // 刷新清单的已采集标记
    loadZhihuFavItems().catch(() => {})
  } catch (e) {
    zhihuFavlistError.value = String(e && e.message || e)
  } finally {
    zhihuFavBatching.value = false
  }
}

/** 订阅「采集并改写」进度事件（双边界：start/done + summary） */
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
      // QM-6 m9：进度行上限（>200 截断，防长任务 DOM 无界累积）
      if (zhihuFavProgressLines.value.length > 200) {
        zhihuFavProgressLines.value = zhihuFavProgressLines.value.slice(-200)
      }
    })
  }
}

// ─── 知乎收藏夹批量采集/改写 ───
const batchProgress = ref(0)
const batchProgressText = ref('')
const batchError = ref('')
let batchPollTimer = null
// M-3 修复：轮询失败兜底已抽到 useBatchPollGuard。原先 catch 分支为空，
// IPC 持续失败时 batchCollecting 永久为 true，按钮锁死且用户看不到原因。
let batchPollGuard = null
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
  // 统一内容类别：全应用单例，这里只需触发一次加载 + 订阅运营变更
  loadContentCategories().catch(() => {})
  categoriesUnsubscribe = watchContentCategories()
  // 知乎收藏批量（2026-10-03）：平台目录 + 进度事件订阅
  // Promise.resolve 包裹：测试桩的 load() 可能返回 undefined，直接 .catch 会抛
  // "Cannot read properties of undefined (reading 'catch')"（QG Unit unhandled rejection 修复）
  if (!platformStore.loaded) { Promise.resolve(platformStore.load()).catch(() => {}) }
  if (!accountStore.accounts || !accountStore.accounts.length) { try { await Promise.resolve(accountStore.load()) } catch { /* 账号加载失败不阻塞 */ } }
  if (!batchPlatformScope.value && batchPlatformOptions.value.length) batchPlatformScope.value = batchPlatformOptions.value[0].id
  if (!batchVideoPlatformScope.value && batchVideoPlatformOptions.value.length) batchVideoPlatformScope.value = batchVideoPlatformOptions.value[0].id
  subscribeZhihuFavProgress()
})

onUnmounted(() => {
  stopBatchPolling()
  // M-16：视频采集的阶段推进是一串 setTimeout，之前只在两处 finally 里停。
  // 用户在采集途中离开页面时，那些计时器继续对**已卸载的组件**写
  // videoCollectStage —— 轻则无意义地跑完，重则踩到已销毁的响应式链。
  stopVideoStageProgression()
  if (categoriesUnsubscribe) { categoriesUnsubscribe(); categoriesUnsubscribe = null }
  if (zhihuFavProgressUnsubscribe) { zhihuFavProgressUnsubscribe(); zhihuFavProgressUnsubscribe = null }
})

// ===== 分享文本链接解析（2026-09-19；2026-09-29 六平台扩展 + CJK 排除字符类）=====
// 抖音/小红书/B站/知乎/视频号/百家号的「复制链接」是「文案 + emoji + 短链 + 引导语」的混合文本，
// 直接当 URL 用会解析失败。采集前先提取真实 http(s) 链接：
// - URL 匹配字符类排除 CJK 字符/标点/全角/emoji（借鉴 Evil0ctal Apache-2.0 方案）：
//   中文天然终止匹配，修复「URL 与中文无空格粘连」时中文被吞进 URL 的缺陷
// - 多链接时优先取视频平台域名（douyin/xiaohongshu/bilibili/zhihu/channels/baijiahao）
// - 提取后回填输入框（用户可见真实链接），短链保持原样交后端 302 解析
const VIDEO_PLATFORM_HOST_PATTERNS = [
  /(^|\.)douyin\.com$/i,
  /(^|\.)iesdouyin\.com$/i,
  /(^|\.)xiaohongshu\.com$/i,
  /(^|\.)xhslink\.com$/i,
  /(^|\.)bilibili\.com$/i,
  /(^|\.)b23\.tv$/i,
  /(^|\.)zhihu\.com$/i,
  /(^|\.)channels\.weixin\.qq\.com$/i,
  /(^|\.)baijiahao\.baidu\.com$/i,
  /(^|\.)mbd\.baidu\.com$/i,
]
// CJK 排除字符类：空白/引号/尖括号/反斜杠 + 弯引号 + CJK 标点 + CJK 扩展A + 汉字 + 全角 + emoji
// （u flag 是 \u{...} 语法的前提）
const SHARE_TEXT_URL_RE = /https?:\/\/[^\s<>"'`\\\u2018\u2019\u201c\u201d\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef\u{1f000}-\u{1faff}]+/giu
// 尾部粘连标点清理（中英文句读，防止 URL 吞掉句号逗号；URL 体内的括号/引号合法保留）
const SHARE_TEXT_TRAILING_JUNK_RE = /[.,;:!?)\]}>'"\u3001\u3002\uff0c\uff01\uff1f\uff09\u3011\u300b\u201d\u2019]+$/
function extractUrlFromShareText (text) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  // 提取全部 http(s) 链接（CJK 字符天然终止匹配，容忍中文/emoji 混排）
  const matches = raw.match(SHARE_TEXT_URL_RE) || []
  if (!matches.length) return ''
  const cleaned = matches
    .map((u) => u.replace(SHARE_TEXT_TRAILING_JUNK_RE, ''))
    // 协议校验走共享判据（href-scheme-contract 单一口径；#2637 遗漏的一处，2026-10-09 补齐）
    .filter((u) => safeHttpUrl(u))
  if (!cleaned.length) return ''
  // 优先返回视频平台链接
  for (const url of cleaned) {
    try {
      const host = new URL(url).hostname.toLowerCase()
      if (VIDEO_PLATFORM_HOST_PATTERNS.some((re) => re.test(host))) return url
    } catch { /* 非法 URL 跳过 */ }
  }
  return cleaned[0]
}

// ===== ASR 依赖安装引导（2026-09-19）=====
// -6（语音转写引擎不可用）→ 弹窗说明 + 一键自动安装（pip 多镜像 + 模型下载，进度实时展示）
function openAsrInstallDialog (pendingUrl) {
  asrInstall.prepare(pendingUrl)
}
function closeAsrInstallDialog () {
  asrInstall.close()
}

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
// 视频通道路由（2026-09-29 六平台扩展）：域名级（整站视频/短链）+ 路径级（域名下仅特定路径是视频页）
// 知乎问题/专栏、B站空间等非视频路径继续走图文链路，不破坏既有采集
const VIDEO_DOMAIN_SUFFIXES = ['douyin.com', 'iesdouyin.com', 'xiaohongshu.com', 'xhslink.com', 'b23.tv', 'channels.weixin.qq.com']
const VIDEO_PATH_RULES = [
  { suffix: 'bilibili.com', prefix: '/video/' },
  { suffix: 'zhihu.com', prefix: '/zvideo/' },
  { suffix: 'baijiahao.baidu.com', prefix: '/s' },  // 文章页可能内嵌视频；无视频时后端报 NO_VIDEO 回退图文
  { suffix: 'mbd.baidu.com', prefix: '/' },         // 百家号移动分享页
]
function isVideoPlatformUrl (url) {
  const u = String(url || '').trim()
  try {
    const parsed = new URL(u)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    const hostMatches = (domain) => host === domain || host.endsWith('.' + domain)
    if (VIDEO_DOMAIN_SUFFIXES.some(hostMatches)) return true
    return VIDEO_PATH_RULES.some((r) => hostMatches(r.suffix) && parsed.pathname.startsWith(r.prefix))
  } catch { return false }
}
function formatVideoDuration (seconds) {
  if (!seconds || seconds <= 0) return ''
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m + ':' + String(s).padStart(2, '0')
}
const PLATFORM_KEYS = ['douyin', 'xiaohongshu', 'bilibili', 'zhihu', 'channels', 'baijiahao']
function platformLabel (platform) {
  const key = {
    douyin: 'collection.platformDouyin',
    xiaohongshu: 'collection.platformXiaohongshu',
    bilibili: 'collection.platformBilibili',
    zhihu: 'collection.platformZhihu',
    channels: 'collection.platformChannels',
    baijiahao: 'collection.platformBaijiahao',
  }[platform]
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

// 百家号文章不含视频（后端 VIDEOCLONE_NO_VIDEO，detail 形如
// "VIDEOCLONE_NO_VIDEO: 该链接不含视频"）→ 提示后落回图文采集链路，不报错中断
function isNoVideoCollectError (res) {
  const message = String((res && res.message) || '')
  return message.includes('VIDEOCLONE_NO_VIDEO')
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
  // 分享文本解析：粘贴的是「文案+短链+引导语」混合文本时，先提取真实链接
  const trimmedInput = linkUrl.value.trim()
  if (/\s/.test(trimmedInput) || safeHttpUrl(trimmedInput) === null) {
    const extracted = extractUrlFromShareText(trimmedInput)
    if (extracted) {
      linkUrl.value = extracted
      notifyInfo('collection.shareLinkExtracted')
    } else if (safeHttpUrl(trimmedInput) === null) {
      // 无 http 前缀且提取不到链接 → 走原有图文链路报错
      notifyWarning('collection.shareLinkNone')
      return
    }
  }
  collecting.value = true
  collectedResult.value = null
  clearRewriteResult()
  collectError.value = null
  try {
    const trimmedUrl = linkUrl.value.trim()
    // 六平台视频链接（抖音/小红书/B站/知乎 zvideo/视频号/百家号）→ 视频采集通道（下载 + ASR 转写）
    if (isVideoPlatformUrl(trimmedUrl)) {
      if (api && api.aggregationCollectVideo) {
        startVideoStageProgression()
        let res
        try {
          res = await api.aggregationCollectVideo({ url: linkUrl.value.trim() })
        } finally {
          stopVideoStageProgression()
        }
        let noVideoFallback = false
        if (res && res.code !== undefined && res.code !== 0) {
          // -6 ASR 引擎不可用 → 弹出安装引导弹窗（自动 pip 安装 + 模型下载）
          if (res.code === -6) {
            openAsrInstallDialog(linkUrl.value.trim())
            return
          }
          // 百家号文章不含视频（VIDEOCLONE_NO_VIDEO）→ 提示后落回图文采集链路
          // （stealth → aggregation → url-collector），不报错中断
          if (isNoVideoCollectError(res)) {
            notifyInfo('collection.fallbackToArticle')
            noVideoFallback = true
          } else {
            collectError.value = { code: res.code, message: res.message }
            notifyError('collection.collectFailed', { message: formatUserError(res, { fallback: resolveNotifyText('collection.collectFailed').text }).message })
            return
          }
        }
        if (!noVideoFallback) {
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
        // noVideoFallback：落回下方图文采集链路继续
      } else {
        // 视频通道不可用 → 不回退到图文采集（图文链路无法处理视频），直接提示
        collectError.value = { code: -99, message: resolveNotifyText('collection.collectUnavailable').text }
        notifyWarning('collection.collectUnavailable')
        return
      }
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
  clearRewriteResult()
  collectedResult.value = null
  try {
    const trimmedUrl = linkUrl.value.trim()
    // 六平台视频链接 → 视频采集通道（与 collectUrl 一致），转写文案作为改写输入
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
      let noVideoFallback = false
      if (videoRes && videoRes.code !== undefined && videoRes.code !== 0) {
        // 百家号文章不含视频（VIDEOCLONE_NO_VIDEO）→ 提示后落回图文采集链路（与 collectUrl 一致）
        if (isNoVideoCollectError(videoRes)) {
          notifyInfo('collection.fallbackToArticle')
          noVideoFallback = true
        } else {
          collectError.value = { code: videoRes.code, message: videoRes.message }
          notifyError('collection.collectFailed', { message: formatUserError(videoRes, { fallback: resolveNotifyText('collection.collectFailed').text }).message })
          return
        }
      }
      if (!noVideoFallback) {
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
      // noVideoFallback：落回下方图文采集链路继续
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
          // 归因链（QM-6 后端轴 W-2）：Python 改写链路不写桌面 rewrite_history，
          // 没有可承载的 id。这里必须显式清掉上一次引擎改写留下的 id ——
          // 否则"存草稿"会把旧引擎的关联挂到这份 Python 产物上，属于凭空伪造关联。
          collectRewriteLineageId = null
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
  clearRewriteResult()
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
  // 归因链：草稿是"改写产物"这件事只有在这里能被记下来（getDraftFromItem 本身是通用投影，
  // 非改写路径也在用它，所以判据挂在这一层而不是那一层）
  attachRewriteLineage(draft, collectRewriteLineageId)
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
    // P0 契约：互动/发布时间透传；未知保持 undefined（store 侧存 NULL），严禁压平为 0
    likes: item.engagement?.likes ?? undefined,
    comments: item.engagement?.comments ?? undefined,
    published_at: item.publishTime || '',
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
  // 类别标签收口（2026-10-03）：9 处构造点字段齐全程度不一，逐个改最容易漏，
  // 因此统一在**落盘前**归一 —— 无论从哪条路径进来的条目，写进真源的 tags 都是校验过的。
  let droppedCount = 0
  for (const item of collectedItems.value) {
    if (!item || typeof item !== 'object') continue
    const r = normalizeItemTags(item.tags, categoryTagCtx.value)
    if (r.dropped.length) droppedCount += r.dropped.length
    item.tags = r.tags
    if (r.dropped.length) item._droppedTags = r.dropped
    else delete item._droppedTags
  }
  if (droppedCount > 0) {
    console.warn('[collection] dropped invalid category tags on save, count=' + droppedCount)
  }
  await storeSetSetting(COLLECTED_ITEMS_KEY, JSON.stringify(collectedItems.value))
}

/** 合法标签页：采集 / 快捷采集 / 文案库 / 博主监控（2026-09-16 原三个标签合并为两个） */
const TAB_KEYS = ['collect', 'quick', 'records', 'creator']

function switchTab (tab) {
  if (!TAB_KEYS.includes(tab)) return
  activeTab.value = tab
}

/**
 * 快捷采集结果落地：与手动采集**同一条链路**（归一化 → 入列表 → 落盘 → 展示）。
 * 结果卡复用采集页既有那张（改写策略 / 字数区间 / 爆款库 / 草稿 / 发布），
 * 因此这里只做"入库 + 切页签"，不另建第二套结果 UI。
 * @param {object} item 主进程返回的采集条目（含 quickCollect 溯源）
 */
function onQuickCollected (item) {
  if (!item || typeof item !== 'object') return
  const normalized = normalizeCollectedItem(item, categoryTagCtx.value)
  collectedResult.value = normalized
  addedToViral.value = false
  collectedItems.value.unshift(normalized)
  saveCollectedItems()
  switchTab('collect')
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
    clearRewriteResult()
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
  clearRewriteResult()
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

// ─── 类别筛选（2026-10-03）：与来源筛选并列，选项来自统一内容类别真源 ───
/** 'all' = 全部；'__untagged__' = 未打标签；其余为类别 key */
const UNTAGGED_FILTER = '__untagged__'
const categoryFilter = ref('all')
const categoryFilterOptions = computed(() => [
  { value: 'all', label: t('collection.categoryFilterAll') },
  { value: UNTAGGED_FILTER, label: t('collection.categoryFilterUntagged') },
  ...contentCategories.value.map((c) => ({ value: c.category_key, label: c.name })),
])

/** 条目的类别标签（兼容缺失字段的历史数据） */
function entryTags (entry) {
  return entry && entry.item ? itemTags(entry.item) : []
}

/** 标签显示名：未知类别显示为 key 本身并标灰（类别已被运营删除） */
function entryTagLabel (key) {
  return categoryLabel(key, t)
}

function isTagKnown (key) {
  return contentCategories.value.some((c) => c.category_key === key)
}

/** 设置条目类别标签并落盘 */
async function setItemTags (item, tags) {
  if (!item) return
  const r = normalizeItemTags(tags, categoryTagCtx.value)
  item.tags = r.tags
  if (r.dropped.length) {
    item._droppedTags = r.dropped
    console.warn('[collection] dropped invalid category tags: ' + r.dropped.join(','))
  } else {
    delete item._droppedTags
  }
  await saveCollectedItems()
  if (r.dropped.length) notifyWarning('collection.tagsDropped', { message: r.dropped.join('、') })
  else notifySuccess('collection.tagsSaved')
}

const editingTagsItem = ref(null)
const editingTags = ref([])

function startEditTags (item) {
  editingTagsItem.value = item
  editingTags.value = [...itemTags(item)]
}

function cancelEditTags () {
  editingTagsItem.value = null
  editingTags.value = []
}

function toggleEditingTag (key) {
  const idx = editingTags.value.indexOf(key)
  if (idx >= 0) editingTags.value.splice(idx, 1)
  else editingTags.value.push(key)
}

function submitEditTags () {
  const item = editingTagsItem.value
  if (item) setItemTags(item, [...editingTags.value])
  cancelEditTags()
}

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

const filteredLibraryItems = computed(() => {
  const byOrigin = libraryFilter.value === 'all'
    ? libraryItems.value
    : libraryItems.value.filter((e) => e.origin === libraryFilter.value)
  if (categoryFilter.value === 'all') return byOrigin
  const tags = byOrigin.map(entryTags)
  return byOrigin.filter((entry, i) => (
    categoryFilter.value === UNTAGGED_FILTER ? tags[i].length === 0 : tags[i].includes(categoryFilter.value)
  ))
})

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
  batchPollGuard = useBatchPollGuard({ onFail: failBatchPolling })
  batchPollGuard.reset()
  batchPollTimer = setInterval(async () => {
    if (!batchTaskId.value) return
    const api = getApi()
    if (!api || !api.aggregationTaskStatus) return
    // M-3：总时长上限，防「每轮都成功但任务永不终结」的活锁
    if (batchPollGuard.checkDuration()) {
      failBatchPolling(resolveNotifyText('collection.batchPollTimeout').text)
      return
    }
    try {
      const res = await api.aggregationTaskStatus(batchTaskId.value)
      batchPollGuard.onSuccess()   // 成功即清零：只统计「连续」失败
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
          collectedItems.value.unshift(normalizeCollectedItem({
            title: item.title || '',
            content: item.content || '',
            source: 'batch',
            sourceUrl: item.source_url || item.sourceUrl || '',
            wordCount: item.word_count || 0,
          }, categoryTagCtx.value))
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
      // M-3：连续失败达阈值即收口；已收集的 collectedItems 保留不清空。
      const { failed, count } = batchPollGuard.recordFailure()
      if (failed) {
        failBatchPolling(
          resolveNotifyText('collection.batchPollUnreachable', { params: { count } }).text,
        )
      }
    }
  }, 2000)
}

// M-3：轮询无法继续时的统一收口（超时上限 / 连续失败 / 主进程报 failed 三条路径共用）
function failBatchPolling (message) {
  batchError.value = message
  notifyError('collection.batchCollectFailed', { message: batchError.value })
  batchCollecting.value = false
  stopBatchPolling()
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
/* ========== 精致化主题 - 2026-09-20 ========== */

.cohere-content {
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  min-height: 100%;
  padding-bottom: 40px;
}

.cohere-card {
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.cohere-card:hover {
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.08), 0 4px 8px rgba(0, 0, 0, 0.04);
  transform: translateY(-3px);
  border-color: rgba(234, 88, 12, 0.25);
}

.col-panel {
  padding: 28px;
  margin-bottom: 20px;
  background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
  border: 1px solid rgba(229, 231, 235, 0.6);
  border-radius: 20px;
  position: relative;
  overflow: hidden;
}

.col-panel::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #ea580c 0%, #fb923c 50%, #fdba74 100%);
  background-size: 200% 100%;
  animation: col-panel-ribbon 3s infinite ease-in-out;
}

@keyframes col-panel-ribbon {
  0%, 100% { background-position: 100% 0; }
  50% { background-position: 0 0; }
}


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
  font-size: var(--font-size-sm);
  line-height: 1.6;
  box-sizing: border-box;
  font-family: inherit;
  background: var(--color-bg-card);
}
.compare-textarea:focus { border-color: var(--coral); outline: none; }
.compare-textarea[readonly] { background: var(--soft-stone); color: var(--color-text-secondary); }

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
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  color: var(--text-secondary, #666);
  transition: all 0.2s;
}
.collection-tab-btn:hover {
  color: var(--text-primary, #333);
}
.collection-tab-btn.active {
  background: var(--color-bg-card);
  color: var(--primary, #ea580c);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.collection-record-card { cursor: pointer; transition: box-shadow 0.2s; }
.collection-record-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
.collection-record-card:focus-visible { outline: 2px solid var(--primary, #ea580c); outline-offset: 2px; }

/* ── 类别标签（2026-10-03）：统一内容类别真源 ── */
.card-tags {
  display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 6px;
}
.card-tag {
  padding: 2px 8px; border-radius: 10px; background: var(--soft-stone, #f2f3f5);
  color: #3a3a44; font-size: var(--font-size-xs, 12px);
}
/* 类别已被运营删除：标签保留但置灰，悬停说明原因，且不参与筛选 */
.card-tag--unknown { background: #ececee; color: #a8a8b3; text-decoration: line-through; }
.card-tag-edit {
  padding: 2px 8px; border: 1px solid #dcdee3; border-radius: 4px;
  background: #fff; color: var(--color-primary); font-size: var(--font-size-xs, 12px); cursor: pointer;
}
.tag-toggle {
  padding: 2px 9px; border: 1px solid #dcdee3; border-radius: 11px;
  background: #fff; color: #3a3a44; font-size: var(--font-size-xs, 12px); cursor: pointer;
}
.tag-toggle--on { border-color: var(--color-primary); color: var(--color-primary); }
.tag-save, .tag-cancel {
  padding: 2px 9px; border: 1px solid #dcdee3; border-radius: 4px;
  background: #fff; font-size: var(--font-size-xs, 12px); cursor: pointer;
}
.tag-save { border-color: var(--color-primary); color: var(--color-primary); }

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
  font-size: var(--font-size-sm);
  cursor: pointer;
  color: var(--text-secondary, #666);
  transition: all 0.15s;
}
.library-filter-btn:hover { color: var(--text-primary, #333); }
.library-filter-btn.active {
  background: var(--color-bg-card);
  color: var(--primary, #ea580c);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.card-platform-badge { display: flex; align-items: center; gap: 6px; }
.copy-library-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.copy-origin-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: var(--font-size-xs);
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
.copy-preview-title { margin: 0; font-size: var(--font-size-base); font-weight: 600; color: var(--text-primary, #25252b); }
.copy-preview-close {
  border: none;
  background: transparent;
  color: var(--muted, #73777d);
  font-size: var(--font-size-base);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}
.copy-preview-close:hover { background: var(--soft-stone, #f5f5f5); color: var(--color-text-primary); }
.copy-preview-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 10px 0 12px; font-size: var(--font-size-xs); color: var(--muted, #73777d); }
/* 长文本展示契约：显式换行 + 任意位置断词，避免长串英文/链接撑破弹窗 */
.copy-preview-content {
  margin: 0;
  overflow-y: auto;
  min-height: 0;
  padding: 12px;
  border-radius: 10px;
  background: var(--soft-stone, #f7f7f8);
  font-size: var(--font-size-sm);
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

/* T1-3d：原 52 处内联样式全部类化；颜色一律 var(--color-*)（tokens.css 语义槽：
 * --color-error-banner、--color-info、--color-progress-track 为 T1-3d 新增收编槽）。 */
.col-panel { padding: var(--space-md); margin-bottom: var(--space-lg); }
.col-toolbar { display: flex; gap: var(--space-sm); align-items: center; flex-wrap: wrap; }
.col-toolbar-icon { font-size: 1.2rem; }
.col-select { border: 1px solid var(--color-border); border-radius: 6px; padding: 8px; font-size: var(--font-size-sm); }
.col-select-sm { border: 1px solid var(--color-border); border-radius: var(--r-xs); padding: 4px 8px; font-size: var(--font-size-sm); }
.col-input { border: 1px solid var(--color-border); border-radius: 6px; padding: 8px 12px; font-size: var(--font-size-sm); }
.col-input--grow { flex: 1; }
.col-input--block { width: 100%; }
.col-textarea { resize: vertical; }
.col-btn-retry { font-size: var(--font-size-sm); padding: 8px 12px; }
.col-btn-retry-sm { font-size: var(--font-size-xs); padding: 4px 10px; margin-left: 8px; }
.col-btn-cancel, .col-btn-clear { font-size: var(--font-size-xs); padding: 2px 8px; }
.col-btn-cancel { margin-top: 4px; }
.col-error-banner { margin-top: 8px; padding: 6px 10px; background: var(--color-error-banner-bg); border-radius: var(--r-xs); font-size: var(--font-size-xs); color: var(--color-error-banner-text); }
.col-stage-banner { margin-top: 8px; padding: 6px 10px; background: var(--color-info-soft); border-radius: var(--r-xs); font-size: var(--font-size-xs); color: var(--color-info-text); }
.col-result-box { margin-top: var(--space-sm); padding: var(--space-sm); background: var(--color-bg-inset); border-radius: 6px; }
.col-result-title { font-weight: 600; margin-bottom: 4px; }
.col-result-meta { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.col-mt8 { margin-top: 8px; }
.col-chip-row { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.col-check-label { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-sm); cursor: pointer; }
.col-compare { margin-top: var(--space-sm); }
.col-compare-title { font-weight: 600; font-size: var(--font-size-sm); margin-bottom: 4px; }
.col-section-title { margin-bottom: var(--space-sm); }
.col-section-title--flex { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.col-block { margin-bottom: var(--space-sm); }
.col-block-title { font-weight: 600; font-size: var(--font-size-sm); margin-bottom: 4px; }
.col-source-row { display: flex; gap: var(--space-sm); align-items: center; }
.col-url-actions { display: flex; gap: var(--space-sm); align-items: center; margin-top: 4px; }
.col-hint { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.col-progress-track { background: var(--color-progress-track); border-radius: var(--r-xs); height: 8px; overflow: hidden; margin-bottom: 4px; }
.col-progress-fill { background: var(--color-primary); height: 100%; transition: width 0.3s; }
.col-list-wrap { margin-bottom: var(--space-lg); }
.col-item--active { border-left: 3px solid var(--color-primary); }
.col-stat-grid-mb { margin-bottom: var(--space-lg); }
.col-stat-card-click { cursor: pointer; }

/* ASR 依赖安装引导弹窗 */
.asr-install-intro { margin: 0 0 12px; line-height: 1.6; color: var(--color-text-primary, #333); }
.asr-install-stage-text { font-weight: 600; margin-bottom: 8px; }
.asr-install-detail { font-size: var(--font-size-xs); color: var(--color-text-secondary, #888); margin-bottom: 8px; word-break: break-all; max-height: 60px; overflow: hidden; }
.asr-install-bar { height: 8px; border-radius: 4px; background: var(--color-bg-secondary, #eee); overflow: hidden; }
.asr-install-bar-fill { height: 100%; border-radius: 4px; background: var(--color-primary, #4f46e5); transition: width 0.3s ease; }
.asr-install-error p { margin: 0 0 6px; color: var(--color-danger, #dc2626); }
.asr-install-manual { color: var(--color-text-secondary, #888) !important; font-size: var(--font-size-xs); }
.asr-install-cmd { display: block; padding: 8px 10px; background: var(--color-bg-secondary, #f5f5f5); border-radius: 6px; font-size: var(--font-size-xs); word-break: break-all; user-select: all; }

</style>



