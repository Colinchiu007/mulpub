<template>
  <div>
    <template v-if="publishTab === 'drafts'">
      <section class="publish-drafts-page" data-testid="publish-drafts-page" aria-labelledby="publish-drafts-title">
        <header class="publish-drafts-header">
          <div>
            <div id="publish-drafts-title" class="page-title">{{ t('publishPage.draftsTitle') }}</div>
            <div class="page-subtitle">{{ t('publishPage.draftsSubtitle') }}</div>
          </div>
          <UiButton data-testid="publish-drafts-back" variant="secondary" @click="goToPublish">{{ t('publishPage.backToPublish') }}</UiButton>
        </header>

        <div v-if="loadingDrafts" class="publish-drafts-state" data-testid="publish-drafts-loading">
          <UiSkeleton variant="list" :count="3" />
        </div>
        <div v-else-if="drafts.length === 0" class="publish-drafts-state" data-testid="publish-drafts-empty">
          <strong>{{ t('publishPage.noDrafts') }}</strong>
          <span>{{ t('publishPage.draftsHint') }}</span>
        </div>
        <div v-else class="publish-drafts-list">
          <article v-for="draft in drafts" :key="draft.id" class="publish-draft-card">
            <div class="publish-draft-info">
              <strong>{{ draft.title || t('publishPage.untitled') }}</strong>
              <span>{{ draft.updatedAt || draft.updated_at ? new Date(draft.updatedAt || draft.updated_at).toLocaleString(getAppLocale() === 'en' ? 'en-US' : 'zh-CN') : t('publishPage.updatedUnknown') }}</span>
              <span v-if="draft.platforms?.length" class="cohere-tag cohere-tag-info">{{ t('publishPage.platformCount', { count: draft.platforms.length }) }}</span>
            </div>
            <div class="publish-draft-actions">
              <UiButton :data-testid="`edit-draft-${draft.id}`" variant="ghost" size="sm" @click="editDraft(draft)">{{ t('publishPage.continueEdit') }}</UiButton>
              <UiButton :data-testid="`delete-draft-${draft.id}`" variant="ghost" size="sm" @click="removeDraft(draft.id)">{{ t('publishPage.delete') }}</UiButton>
            </div>
          </article>
        </div>
      </section>
    </template>

    <template v-else>
    <div class="cohere-page-header">
      <div class="publish-header-row">
        <div class="flex-spacer">
          <div class="page-title">
            {{ t('publishPage.publishTitle') }}<span v-if="hasExplicitPublishType" class="publish-type-context"> · {{ publishTypeLabel }}</span>
          </div>
          <div class="page-subtitle">{{ batchMode ? t('publishPage.batchSubtitle') : t('publishPage.singleSubtitle') }}</div>
        </div>
        <div class="publish-mode-tabs" v-if="!batchMode">
          <button
            type="button"
            class="publish-mode-tab"
            :class="{ active: activeMode === 'video' }"
            @click="activeMode = 'video'"
          >
            ▶ {{ t('publishPage.modeVideo') }}
          </button>
          <button
            type="button"
            class="publish-mode-tab"
            :class="{ active: activeMode === 'article' }"
            @click="activeMode = 'article'"
          >
            ▤ {{ t('publishPage.modeArticle') }}
          </button>
        </div>
        <label class="cohere-toggle batch-mode-toggle">
          <input data-testid="publish-batch-mode" type="checkbox" v-model="batchMode" class="coral-check" @change="checkBatchAccess" />
          <span>{{ t('publishPage.batchMode') }}</span>
        </label>
      </div>
    </div>

    <!-- 批量模式：文章列表 -->
    <template v-if="batchMode">
      <div class="cohere-content batch-articles">
        <div v-for="(a, idx) in articles" :key="a._key" class="cohere-card cohere-card-static">
          <!-- 文章编号 + 删除 -->
          <div class="article-card-row">
            <span class="cohere-tag cohere-tag-info">#{{ idx + 1 }}</span>
            <span v-if="a.publishTime" class="cohere-tag cohere-tag-warning">⏰ {{ t('publishPage.scheduled') }}</span>
            <div class="flex-spacer"></div>
            <UiButton :data-testid="`batch-copy-${idx}`" variant="ghost" size="sm" @click="duplicateArticle(idx)" :title="t('publishPage.copy')">📋</UiButton>
            <UiButton :data-testid="`batch-delete-${idx}`" variant="ghost" size="sm" @click="removeArticle(idx)" v-if="articles.length > 1" :title="t('publishPage.delete')" class="coral-text">✕</UiButton>
          </div>

          <!-- 文章编辑 -->
          <div class="cohere-form">
            <div class="cohere-form-item">
              <div class="title-row">
                <label class="cohere-form-label no-margin-bottom">{{ t('publishPage.title') }}</label>
                <button class="cohere-btn-ghost template-pick-button" @click="showTemplatePicker = true; templateTargetIdx = idx">
                  📝 {{ t('publishPage.template') }}
                </button>
              </div>
              <UiInput v-model="a.title" :placeholder="t('publishPage.titlePlaceholder')" />
            </div>
            <div class="cohere-form-item">
              <label class="cohere-form-label">{{ t('publishPage.content') }}</label>
              <UiInput type="textarea" v-model="a.content" :placeholder="t('publishPage.contentPlaceholder')" :rows="5" />
            </div>
            <div class="cohere-form-item batch-metadata-grid">
              <div>
                <label class="cohere-form-label">{{ t('publishPage.tags') }}</label>
                <UiInput v-model="a.tagsText" :placeholder="t('publishPage.tagsPlaceholder')" />
              </div>
              <div>
                <label class="cohere-form-label">{{ t('publishPage.topics') }}</label>
                <UiInput v-model="a.topicsText" :placeholder="t('publishPage.topicsPlaceholder')" />
              </div>
              <div>
                <label class="cohere-form-label">{{ t('publishPage.mentions') }}</label>
                <UiInput v-model="a.mentionsText" :placeholder="t('publishPage.mentionsPlaceholder')" />
              </div>
            </div>
            <div class="cohere-form-item">
              <label class="cohere-form-label">{{ t('publishPage.publishTarget') }}</label>
              <div class="batch-platform-targets">
                <label v-for="p in platforms" :key="p.id" class="batch-platform-option">
                  <input type="checkbox" :value="p.id" v-model="a.platforms" class="coral-check" />
                  {{ p.label }}
                </label>
                <template v-for="p in platforms" :key="p.id + '-accounts'">
                  <div v-if="a.platforms.includes(p.id) && getAccounts(p.id).length > 0" class="batch-account-targets">
                    <span class="batch-account-label">{{ p.label }}{{ t('publishPage.accountSuffix') }}</span>
                    <label v-for="account in getAccounts(p.id)" :key="account.id" class="batch-account-option">
                      <input
                        type="checkbox"
                        :checked="isBatchAccountSelected(a, p.id, account.id)"
                        @change="toggleBatchAccount(a, p.id, account.id)"
                      />
                      <span>{{ account.name || account.id?.slice(0, 8) }}</span>
                    </label>
                  </div>
                </template>
              </div>
            </div>
            <div class="cohere-form-item">
              <label class="cohere-form-label">{{ t('publishPage.schedule') }}</label>
              <UiInput type="datetime-local" v-model="a.publishTime" class="input-max-260" />
              <span class="publish-time-hint">{{ t('publishPage.scheduleHint') }}</span>
            </div>
          </div>
        </div>

        <!-- 模板面板 -->
        <div v-if="showTemplatePicker && templateTargetIdx >= 0" class="stack-gap">
          <TemplatePicker @close="showTemplatePicker = false" @apply="applyTemplate" />
        </div>

        <!-- 操作 -->
        <div class="row-actions">
          <UiButton variant="secondary" @click="addArticle">{{ t('publishPage.addArticle') }}</UiButton>
          <div class="flex-spacer"></div>
          <UiButton data-testid="publish-batch-submit" @click="handleBatchPublish" :disabled="batchPublishing || articles.length === 0">
            {{ batchPublishing ? t('publishPage.publishing') : t('publishPage.batchPublish', { count: totalPlatformTasks }) }}
          </UiButton>
        </div>

        <!-- 进度 -->
        <div v-if="batchProgress.length > 0" class="cohere-card cohere-card-static">
          <div class="progress-title">{{ t('publishPage.batchProgressTitle') }}</div>
          <div class="progress-toolbar">
            <span class="cohere-tag cohere-tag-success">✅ {{ t('publishPage.doneCount', { count: batchDone }) }}</span>
            <span class="cohere-tag cohere-tag-danger">❌ {{ t('publishPage.failCount', { count: batchFail }) }}</span>
            <UiButton
              v-if="failedBatchTasks.length > 0"
              variant="secondary"
              size="sm"
              :disabled="retryingFailed || batchPublishing"
              :title="t('publishPage.retryFailed')"
              @click="retryFailedBatch"
            >
              <Refresh class="batch-retry-icon" />
              {{ retryingFailed ? t('publishPage.retrying') : t('publishPage.retryFailedCount', { count: failedBatchTasks.length }) }}
            </UiButton>
          </div>
          <ul class="cohere-timeline">
            <li v-for="item in batchProgress" :key="item.time + item.text" class="cohere-timeline-item" :class="item.type">
              <span class="tl-time">{{ item.time }}</span>
              <span class="tl-text">{{ item.text }}</span>
            </li>
          </ul>
        </div>
      </div>
    </template>

    <!-- 非批量模式：原有界面 -->
    <template v-else>
      <div class="cohere-content cohere-content-split">
        <div class="flex-main">
          <template v-if="activeMode === 'video'">
            <div class="cohere-card cohere-card-static">
              <div class="cohere-form">
                <div class="cohere-form-item">
                  <label class="cohere-form-label">{{ t('publishPage.videoFile') }}</label>
                  <el-upload
                    drag
                    :auto-upload="false"
                    :limit="1"
                    accept="video/*"
                    class="video-upload-zone"
                    :on-change="handleVideoFileChange"
                  >
                    <el-icon class="el-icon--upload" :size="48"><upload-filled /></el-icon>
                    <div class="el-upload__text">{{ t('publishPage.dragVideo') }}<em>{{ t('publishPage.clickSelect') }}</em></div>
                    <template #tip><div class="el-upload__tip">{{ t('publishPage.dragVideoHint') }}</div></template>
                  </el-upload>
                  <div class="video-ai-entry">
                    <UiButton variant="ghost" size="sm" data-testid="goto-ai-video-btn" @click="router.push('/create')">
                      {{ t('publishPage.aiVideoEntry') }}
                    </UiButton>
                    <span class="video-ai-entry__hint">{{ t('publishPage.aiVideoEntryHint') }}</span>
                  </div>
                </div>
                <div class="cohere-form-item">
                  <label class="cohere-form-label">{{ t('publishPage.title') }}</label>
                  <UiInput data-testid="publish-title" v-model="article.title" :placeholder="t('publishPage.videoTitlePlaceholder')" />
                </div>
                <div class="cohere-form-item">
                  <label class="cohere-form-label">{{ t('publishPage.videoDescLabel') }}</label>
                  <UiInput data-testid="publish-desc" type="textarea" v-model="article.content" :placeholder="t('publishPage.videoDescPlaceholder')" :rows="4" />
                </div>
                <div class="cohere-form-item">
                  <label class="cohere-form-label">{{ t('publishPage.cover') }}</label>
                  <div class="video-cover-row">
                    <el-upload
                      v-model:file-list="coverFileList"
                      class="publish-media-upload"
                      :auto-upload="false"
                      :limit="1"
                      accept="image/*"
                      :on-change="handleCoverFileChange"
                      :on-remove="handleCoverFileRemove"
                    >
                      <button type="button" class="media-upload-trigger">{{ t('publishPage.selectCover') }}</button>
                      <template #tip><div class="el-upload__tip">{{ t('publishPage.coverTip') }}</div></template>
                    </el-upload>
                    <UiButton v-if="article.video_path" variant="ghost" size="sm" @click="handleExtractVideoCover">
                      {{ t('publishPage.extractCover') }}
                    </UiButton>
                    <UiButton variant="ghost" size="sm" :disabled="aiCoverGenerating" @click="showAiCoverDialog = true">
                      {{ t('publishPage.aiGenerateCover') }}
                    </UiButton>
                    <UiButton v-if="article.cover_path" variant="ghost" size="sm" @click="openCoverCrop">
                      {{ t('publishPage.coverCrop.title') }}
                    </UiButton>
                    <div
                      data-testid="cover-state"
                      :data-cover-path="article.cover_path || ''"
                      :data-cover-url="article.cover_url || ''"
                      hidden
                    ></div>
                  </div>
                  <UiInput v-model="article.cover_url" :placeholder="t('publishPage.coverUrlPlaceholder')" class="stack-gap-top" />
                </div>
                <div class="cohere-form-item publish-metadata-grid">
                  <div>
                    <label class="cohere-form-label">{{ t('publishPage.tags') }}</label>
                    <UiInput v-model="tagsText" :placeholder="t('publishPage.tagsPlaceholder')" />
                  </div>
                  <div>
                    <label class="cohere-form-label">{{ t('publishPage.topics') }}</label>
                    <UiInput v-model="topicsText" :placeholder="t('publishPage.topicsPlaceholder')" />
                  </div>
                  <div>
                    <label class="cohere-form-label">{{ t('publishPage.mentions') }}</label>
                    <UiInput v-model="mentionsText" :placeholder="t('publishPage.mentionsPlaceholder')" />
                  </div>
                </div>
                <div class="cohere-form-item">
                  <label class="cohere-form-label">{{ t('publishPage.schedule') }}</label>
                  <UiInput type="datetime-local" v-model="article.publishTime" class="input-max-260" />
                  <span class="publish-time-hint">{{ t('publishPage.scheduleHint') }}</span>
                </div>
                <div class="cohere-form-item">
                  <label class="cohere-form-label">{{ t('publishPage.aiDeclaration') }}</label>
                  <label class="ai-declaration-row" data-testid="ai-declaration">
                    <input type="checkbox" v-model="article.aiGenerated" class="coral-check" data-testid="ai-declaration-checkbox" />
                    <span>{{ t('publishPage.aiDeclarationHint') }}</span>
                  </label>
                </div>
                <div class="cohere-form-item">
                  <button class="publish-section-toggle" type="button" @click="showDiffPanel = !showDiffPanel">
                    <span>{{ t('publishPage.diffContent') }}</span>
                    <span class="publish-section-toggle__state">{{ showDiffPanel ? t('publishPage.collapse') : t('publishPage.expand') }}</span>
                  </button>
                  <PlatformOverridePanel v-if="showDiffPanel" :platforms="selectedOverridePlatforms" :model-value="diffEdits" @update:model-value="replaceDiffEdits" />
                </div>
              </div>
            </div>
          </template>
          <template v-else>
          <div class="cohere-card cohere-card-static">
            <div class="cohere-form">
              <div class="cohere-form-item">
                <div class="title-row">
                  <label class="cohere-form-label no-margin-bottom">{{ t('publishPage.title') }}</label>
                  <button class="cohere-btn-ghost template-pick-button" @click="showTemplatePicker = !showTemplatePicker; templateTargetIdx = -1">
                    {{ showTemplatePicker ? t('publishPage.close') : '📝 ' + t('publishPage.template') }}
                  </button>
                  <button
                    type="button"
                    class="cohere-btn-ghost template-pick-button"
                    data-testid="open-ai-writer"
                    aria-controls="ai-writer-panel"
                    :aria-expanded="showAiWriter"
                    @click="showAiWriter = !showAiWriter"
                  >
                    {{ showAiWriter ? t('publishPage.close') : t('publishPage.aiWriter') }}
                  </button>
                </div>
                <UiInput data-testid="publish-title" v-model="article.title" :placeholder="t('publishPage.titlePlaceholder')" />
              </div>
              <div v-if="showTemplatePicker && templateTargetIdx < 0" class="stack-gap">
                <TemplatePicker @close="showTemplatePicker = false" @apply="applyTemplate" />
              </div>
              <div v-if="showAiWriter && templateTargetIdx < 0" class="stack-gap">
                <AiWriterPanel
                  :sourceContent="article.content"
                  @close="showAiWriter = false"
                  @apply-title="article.title = $event; showAiWriter = false"
                  @apply-content="article.content = $event + '\n'; showAiWriter = false"
                />
              </div>
              <div class="cohere-form-item">
                <label class="cohere-form-label">{{ t('publishPage.author') }}</label>
                <UiInput v-model="article.author" :placeholder="t('publishPage.authorPlaceholder')" class="input-max-300" />
              </div>
              <div class="cohere-form-item">
                <label class="cohere-form-label">{{ t('publishPage.images') }}</label>
                <el-upload
                  v-model:file-list="imageFileList"
                  class="publish-media-upload"
                  :auto-upload="false"
                  :limit="9"
                  multiple
                  accept="image/*"
                  :on-change="handleImageFileChange"
                  :on-remove="handleImageFileRemove"
                >
                  <button type="button" class="media-upload-trigger">{{ t('publishPage.selectImages') }}</button>
                  <template #tip><div class="el-upload__tip">{{ t('publishPage.imageTip') }}</div></template>
                </el-upload>
              </div>
              <div class="cohere-form-item">
                <label class="cohere-form-label">{{ t('publishPage.content') }}</label>
                <ArticleEditor data-testid="publish-editor" v-model="article.content" />
              </div>
              <div class="cohere-form-item" v-if="hasVideoPlatforms">
                <label class="cohere-form-label">{{ t('publishPage.videoFile') }}</label>
                <el-upload drag :auto-upload="false" :limit="1" accept="video/*" :on-change="handleVideoFileChange">
                  <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                  <div class="el-upload__text">{{ t('publishPage.dragVideo') }}<em>{{ t('publishPage.clickSelect') }}</em></div>
                  <template #tip><div class="el-upload__tip">{{ t('publishPage.videoTip') }}</div></template>
                </el-upload>
              </div>
              <div class="cohere-form-item">
                <label class="cohere-form-label">{{ t('publishPage.cover') }}</label>
                <el-upload
                  v-model:file-list="coverFileList"
                  class="publish-media-upload"
                  :auto-upload="false"
                  :limit="1"
                  accept="image/*"
                  :on-change="handleCoverFileChange"
                  :on-remove="handleCoverFileRemove"
                >
                  <button type="button" class="media-upload-trigger">{{ t('publishPage.selectCover') }}</button>
                  <template #tip><div class="el-upload__tip">{{ t('publishPage.coverTip') }}</div></template>
                </el-upload>
                <UiInput v-model="article.cover_url" :placeholder="t('publishPage.coverUrlPlaceholder')" />
              </div>
              <div class="cohere-form-item publish-metadata-grid">
                <div>
                  <label class="cohere-form-label" for="publish-tags">{{ t('publishPage.tags') }}</label>
                  <UiInput id="publish-tags" v-model="tagsText" :placeholder="t('publishPage.tagsPlaceholder')" />
                </div>
                <div>
                  <label class="cohere-form-label" for="publish-topics">{{ t('publishPage.topics') }}</label>
                  <UiInput id="publish-topics" v-model="topicsText" :placeholder="t('publishPage.topicsPlaceholder')" />
                </div>
                <div>
                  <label class="cohere-form-label" for="publish-mentions">{{ t('publishPage.mentions') }}</label>
                  <UiInput id="publish-mentions" v-model="mentionsText" :placeholder="t('publishPage.mentionsPlaceholder')" />
                </div>
              </div>
              <div class="cohere-form-item">
                <label class="cohere-form-label">{{ t('publishPage.schedule') }}</label>
                <UiInput type="datetime-local" v-model="article.publishTime" class="input-max-260" />
                <span class="publish-time-hint">{{ t('publishPage.scheduleHint') }}</span>
              </div>
              <div class="cohere-form-item">
                <label class="cohere-form-label">{{ t('publishPage.aiDeclaration') }}</label>
                <label class="ai-declaration-row" data-testid="ai-declaration">
                  <input type="checkbox" v-model="article.aiGenerated" class="coral-check" data-testid="ai-declaration-checkbox" />
                  <span>{{ t('publishPage.aiDeclarationHint') }}</span>
                </label>
              </div>
              <div class="cohere-form-item">
                <button class="publish-section-toggle" type="button" @click="showDiffPanel = !showDiffPanel">
                  <span>{{ t('publishPage.diffContent') }}</span>
                  <span class="publish-section-toggle__state">{{ showDiffPanel ? t('publishPage.collapse') : t('publishPage.expand') }}</span>
                </button>
                <PlatformOverridePanel
                  v-if="showDiffPanel"
                  :platforms="selectedOverridePlatforms"
                  :model-value="diffEdits"
                  @update:model-value="replaceDiffEdits"
                />
              </div>
            </div>
          </div>
          </template>
        </div>
        <div class="flex-side">
          <!-- 智能标签建议 -->
          <TagSuggester v-if="showTagPanel && combinedContent.length > 3" :content="combinedContent" class="stack-gap" @close="showTagPanel = false" />
          <div v-if="!showTagPanel && combinedContent.length > 3" class="stack-gap stack-center">
            <UiButton variant="ghost" size="sm" @click="showTagPanel = true">{{ t('publishPage.showTagSuggest') }}</UiButton>
          </div>

          <!-- 最佳发布时间 -->
          <OptimalTimeTip v-if="article.title.length > 2" :keyword="article.title" class="stack-gap" />

          <!-- 标题助手 -->
          <TitleAssistantPanel :title="article.title" :visible="showTitlePanel" @close="showTitlePanel = false" class="stack-gap" />
          <div v-if="!showTitlePanel && article.title.length > 5" class="stack-gap stack-center">
            <UiButton variant="ghost" size="sm" @click="showTitlePanel = true">{{ t('publishPage.titleReference') }}</UiButton>
          </div>

          <div class="cohere-card cohere-card-static publish-action-card" data-testid="publish-action-card">
            <div class="cohere-form cohere-form-gap">
              <div class="cohere-form-label">{{ t('publishPage.publishTarget') }}</div>
              <PublishTargetSelector
                data-testid="publish-target-selector"
                :groups="groupedPlatforms"
                :selected-platforms="selectedPlatforms"
                :selected-accounts="selectedAccounts"
                :disabled="publishing"
                @toggle-platform="togglePlatform"
                @toggle-account="toggleAccount"
              />
              <div class="publish-action-controls" data-testid="publish-action-controls">
                <div class="cohere-divider"></div>
                <UiButton variant="secondary" class="side-button-block" @click="saveDraft" :disabled="publishing">{{ t('publishPage.saveDraft') }}</UiButton>
                <UiButton variant="ghost" size="sm" class="side-button-block" @click="showDraftList = true; loadDrafts()">{{ t('publishPage.drafts') }}</UiButton>
                <UiButton data-testid="publish-submit" class="side-button-full" :disabled="selectedPlatforms.length === 0 || publishing" @click="handlePublish">
                  {{ publishing ? t('publishPage.publishing') : t('publishPage.quickPublish') }}
                </UiButton>
                <UiButton
                  v-if="activeTaskIds.length > 0 || activeScheduleIds.length > 0"
                  data-testid="publish-cancel"
                  variant="danger"
                  class="side-button-block side-button-block-top"
                  @click="cancelPublish"
                >
                  {{ t('publishPage.cancelTasks') }}
                </UiButton>
              </div>
            </div>
          </div>
          <div v-if="progress.length > 0" class="cohere-card cohere-card-offset" data-testid="publish-progress">
            <ul class="cohere-timeline">
              <li v-for="item in progress" :key="item.time + item.text" class="cohere-timeline-item" :class="item.type">
                <span class="tl-time">{{ item.time }}</span>
                <span class="tl-text">{{ item.text }}</span>
              </li>
            </ul>
          </div>

          <!-- 草稿箱面板 -->
          <div v-if="showDraftList" class="cohere-card cohere-card-offset">
            <div class="draft-list-header">
              <div class="draft-list-title"> {{ t('publishPage.draftsTitle') }}</div>
              <button @click="showDraftList = false" class="plain-close-button">✕</button>
            </div>
            <div v-if="drafts.length === 0" class="draft-empty">{{ t('publishPage.noDrafts') }}</div>
            <div v-else class="draft-list">
              <div v-for="d in drafts" :key="d.id" class="draft-item">
                <div class="draft-info">
                  <div class="draft-title">{{ d.title || t('publishPage.untitled') }}</div>
                  <div class="draft-meta">
                    <span class="draft-time">{{ d.updatedAt ? new Date(d.updatedAt).toLocaleString(getAppLocale() === 'en' ? 'en-US' : 'zh-CN') : '' }}</span>
                    <span v-if="d.platforms && d.platforms.length" class="cohere-tag cohere-tag-info">{{ t('publishPage.platformCount', { count: d.platforms.length }) }}</span>
                  </div>
                </div>
                <div class="row-actions-compact">
                  <UiButton variant="ghost" size="sm" @click="loadDraft(d.id)">{{ t('publishPage.load') }}</UiButton>
                  <UiButton variant="ghost" size="sm" @click="removeDraft(d.id)" class="coral-text">{{ t('publishPage.delete') }}</UiButton>
                </div>
              </div>
            </div>
          </div>
          <div v-if="result" class="cohere-card cohere-card-offset">
            <div class="result-header-row">
              <span v-if="result.success" class="cohere-tag cohere-tag-success">{{ t('publishPage.publishSuccess') }}</span>
              <span v-else class="cohere-tag cohere-tag-danger">{{ t('publishPage.publishFailed') }}</span>
              <span class="muted-text">{{ result.message }}</span>
            </div>
            <UiButton
              v-if="!result.success && !result.cancelled"
              variant="secondary"
              size="sm"
              class="stack-gap-top"
              @click="retryPublish"
            >
              {{ t('publishPage.retryPublish') }}
            </UiButton>
            <div v-if="result.url" class="result-link-row">
              <a :href="result.url" target="_blank" class="result-link">{{ t('publishPage.viewArticle') }}</a>
              <button @click="copyUrl(result.url)" class="copy-url-button" :class="{ 'is-copied': copied }">
                {{ copied ? t('publishPage.copied') : t('publishPage.copyLink') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
    </template>
  </div>
  <CoverCropDialog
    :visible="showCoverCrop"
    :image-path="cropSourcePath"
    @close="showCoverCrop = false"
    @success="onCoverCropSuccess"
    @error="onCoverCropError"
  />
  <!-- P2-2：AI 封面生成对话框（复用 asset-generator 生图引擎） -->
  <div v-if="showAiCoverDialog" class="ai-cover-overlay" data-testid="ai-cover-dialog">
    <div class="ai-cover-modal">
      <h3 class="ai-cover-modal__title">{{ t('publishPage.aiGenerateCover') }}</h3>
      <label class="ai-cover-field">
        <span>{{ t('publishPage.aiCoverPromptLabel') }}</span>
        <textarea
          v-model="aiCoverForm.prompt"
          data-testid="ai-cover-prompt"
          rows="3"
          maxlength="500"
          :placeholder="t('publishPage.aiCoverPromptPlaceholder')"
        />
      </label>
      <label class="ai-cover-field">
        <span>{{ t('publishPage.aiCoverStyleLabel') }}</span>
        <select v-model="aiCoverForm.style" data-testid="ai-cover-style">
          <option v-for="s in ['cinematic', 'realistic', 'cartoon', 'anime', 'cyberpunk', 'watercolor', 'minimalist']" :key="s" :value="s">
            {{ t('publishPage.aiCoverStyle.' + s) }}
          </option>
        </select>
      </label>
      <label class="ai-cover-field">
        <span>{{ t('publishPage.aiCoverRatioLabel') }}</span>
        <select v-model="aiCoverForm.ratio" data-testid="ai-cover-ratio">
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
          <option value="1:1">1:1</option>
          <option value="4:3">4:3</option>
          <option value="3:4">3:4</option>
        </select>
      </label>
      <div class="ai-cover-actions">
        <UiButton variant="ghost" size="sm" :disabled="aiCoverGenerating" @click="showAiCoverDialog = false">
          {{ t('publishPage.aiCoverCancel') }}
        </UiButton>
        <UiButton variant="primary" size="sm" :disabled="aiCoverGenerating" data-testid="ai-cover-generate-btn" @click="handleGenerateAiCover">
          {{ aiCoverGenerating ? t('publishPage.aiCoverGenerating') : t('publishPage.aiGenerateCover') }}
        </UiButton>
      </div>
    </div>
  </div>
</template>

<script setup>
import UiButton from "../components/UiButton.vue";
import UiInput from "../components/UiInput.vue";
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { getApi } from '@/api/electron-bridge'
import { useNotify } from '@/composables/useNotify'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getAppLocale } from '@/i18n'
import { usePlatformStore } from '@/stores/platforms'
import { useAccountStore } from '@/stores/accounts'
import { Refresh, UploadFilled } from '@element-plus/icons-vue'
import TagSuggester from '@/components/TagSuggester.vue'
import OptimalTimeTip from '@/components/OptimalTimeTip.vue'
import TitleAssistantPanel from '@/components/TitleAssistantPanel.vue'
import ArticleEditor from '@/components/ArticleEditor.vue'
import TemplatePicker from '@/components/TemplatePicker.vue'
// eslint-disable-next-line no-unused-vars
import { useTemplateStore } from '@/stores/templates'
import { useLicenseStore } from '@/stores/license'
// eslint-disable-next-line no-unused-vars
import UpgradeModal from '@/components/UpgradeModal.vue'
import AiWriterPanel from '@/components/AiWriterPanel.vue'
import CoverCropDialog from '@/components/CoverCropDialog.vue'
import { usePlatformSelection } from '@/composables/usePlatformSelection'
import { usePublishFlow } from '@/composables/usePublishFlow'
import { useBatchPublish } from '@/composables/useBatchPublish'
import { usePublishDrafts } from '@/composables/usePublishDrafts'
import {
  getPlatformContentLimit,
  normalizePublishFile,
  normalizePublishMentions,
  normalizePublishStringList,
} from '@/features/publish/publish-contract'
import PlatformOverridePanel from '@/features/publish/components/PlatformOverridePanel.vue'
import PublishTargetSelector from '@/features/publish/components/PublishTargetSelector.vue'
import { usePublishPlatformCatalog } from '@/features/publish/usePublishPlatformCatalog'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { notifySuccess, notifyWarning } = useNotify()
const publishTab = computed(() => String(route.query?.tab || 'publish'))
// 2026-09 合并发布类型：image/wechat 为历史类型值，归一化为 article（向后兼容旧链接）。
// 白名单只保留 video/article 两个真实入口。
const LEGACY_PUBLISH_TYPES = { image: 'article', wechat: 'article' }
const rawPublishType = () => String(route.query?.type || '').toLowerCase()
const publishType = computed(() => {
  const value = rawPublishType()
  if (value === 'video') return 'video'
  return LEGACY_PUBLISH_TYPES[value] || 'article'
})
// 仅当 query 携带有效类型值（含历史 image/wechat）时显示类型标签；无效值（如 ?type=foo）与缺省不显示。
const hasExplicitPublishType = computed(() => {
  const value = rawPublishType()
  return value === 'video' || value === 'article' || LEGACY_PUBLISH_TYPES[value] !== undefined
})
const publishTypeLabel = computed(() => ({
  video: t('publishPage.typeVideo'),
  article: t('publishPage.typeArticleImage'),
}[publishType.value]))

const activeMode = ref(publishType.value === 'video' ? 'video' : 'article')

const showDiffPanel = ref(false)
const diffEdits = reactive({})

function replaceDiffEdits (next) {
  for (const key of Object.keys(diffEdits)) delete diffEdits[key]
  Object.assign(diffEdits, JSON.parse(JSON.stringify(next || {})))
}

const platformStore = usePlatformStore()
platformStore.load()
const accountStore = useAccountStore()
const licenseStore = useLicenseStore()
const { platforms, groupedPlatforms } = usePublishPlatformCatalog(platformStore, accountStore)

// ── 多账号加载 ──────────────────────────
async function loadAccounts () {
  await accountStore.ensureLoaded()
}

// ── 非批量模式（本地 UI 状态） ────────────
const article = reactive({
  title: '',
  content: '',
  author: '',
  cover_url: '',
  cover_path: '',
  cover_file: null,
  video_path: '',
  images: [],
  image_files: [],
  tags: [],
  topics: [],
  mentions: [],
  publishTime: '',
  // AI 生成内容声明：默认勾选（AI 生成内容）。各平台发布时如实声明内容创作方式。
  aiGenerated: true,
})
const imageFileList = ref([])
const coverFileList = ref([])
const tagsText = computed({
  get: () => normalizePublishStringList(article.tags).join(', '),
  set: value => { article.tags = normalizePublishStringList(value) },
})
const topicsText = computed({
  get: () => normalizePublishStringList(article.topics).join(', '),
  set: value => { article.topics = normalizePublishStringList(value) },
})
const mentionsText = computed({
  get: () => normalizePublishMentions(article.mentions).map(item => item.text).join(', '),
  set: value => { article.mentions = normalizePublishMentions(value) },
})

async function resolveUploadFilePath (file) {
  const raw = file?.raw || file
  const directPath = raw?.path || raw?.filePath || raw?.file_path || file?.path
  if (typeof directPath === 'string' && directPath.trim()) return directPath.trim()
  try {
    const resolvedPath = await getApi()?.getPathForFile?.(raw)
    if (typeof resolvedPath === 'string' && resolvedPath.trim()) return resolvedPath.trim()
  } catch (_) {
    // Path resolution is best effort; the caller reports an actionable error.
  }
  return ''
}

async function normalizeUploadFile (file) {
  const raw = file?.raw || file
  const path = await resolveUploadFilePath(file)
  if (!path) return null
  return normalizePublishFile({
    path,
    name: raw?.name || file?.name,
    type: raw?.type || file?.type,
    size: raw?.size || file?.size,
    lastModified: raw?.lastModified || file?.lastModified,
  })
}

async function updateImageFiles (fileList) {
  const files = (await Promise.all((Array.isArray(fileList) ? fileList : []).map(normalizeUploadFile)))
    .filter(file => file?.path)
  article.image_files = files
  article.images = files.map(file => file.path)
  imageFileList.value = files
}

async function handleImageFileChange (file, fileList) {
  await updateImageFiles(Array.isArray(fileList) ? fileList : [file])
}

async function handleImageFileRemove (_file, fileList) {
  await updateImageFiles(Array.isArray(fileList) ? fileList : [])
}

async function handleVideoFileChange (file) {
  const path = await resolveUploadFilePath(file)
  if (!path) {
    article.video_path = ''
    notifyWarning('story2video.media_path_unresolved', { params: { kindLabel: t('publishPage.videoFile') } })
    return
  }
  article.video_path = path
}

async function handleCoverFileChange (file) {
  const descriptor = await normalizeUploadFile(file)
  if (!descriptor) {
    article.cover_file = null
    article.cover_path = ''
    coverFileList.value = []
    notifyWarning('story2video.media_path_unresolved', { params: { kindLabel: t('publishPage.cover') } })
    return
  }
  article.cover_file = descriptor
  article.cover_path = descriptor?.path || ''
  coverFileList.value = descriptor ? [descriptor] : []
}

function handleCoverFileRemove () {
  article.cover_file = null
  article.cover_path = ''
  coverFileList.value = []
}

const showCoverCrop = ref(false)
const cropSourcePath = ref('')

function openCoverCrop () {
  if (!article.cover_path) return
  cropSourcePath.value = article.cover_path
  showCoverCrop.value = true
}

function onCoverCropSuccess (data) {
  showCoverCrop.value = false
  if (data?.path) {
    article.cover_path = data.path
    article.cover_file = { path: data.path, name: 'video-cover-crop.jpg' }
    coverFileList.value = [{ name: 'video-cover-crop.jpg', url: data.path, path: data.path }]
    notifySuccess('publishPage.coverExtracted')
  }
}

function onCoverCropError (message) {
  notifyWarning('publishPage.coverCrop.cropFailed', { message: message || t('publishPage.coverCrop.cropFailed') })
}

async function handleExtractVideoCover () {
  if (!article.video_path) return
  try {
    const result = await getApi()?.extractVideoCover?.(article.video_path)
    const coverPath = result?.path || result?.data?.coverPath || ''
    if (coverPath) {
      article.cover_path = coverPath
      article.cover_file = { path: coverPath, name: 'video-cover.jpg' }
      coverFileList.value = [{ name: 'video-cover.jpg', url: coverPath, path: coverPath }]
      notifySuccess('publishPage.coverExtracted')
    } else {
      notifyWarning('publishPage.coverExtractFailed', {
        params: { message: result?.message || t('publishPage.coverExtractUnknownError') },
      })
    }
  } catch (e) {
    notifyWarning('publishPage.coverExtractFailed', {
      params: { message: typeof e?.message === 'string' && e.message.trim()
        ? e.message
        : t('publishPage.coverExtractUnknownError') },
    })
  }
}

// P2-2：AI 封面生成（复用 asset-generator 生图引擎，经 cover:generate-ai IPC）
const showAiCoverDialog = ref(false)
const aiCoverGenerating = ref(false)
const aiCoverForm = reactive({ prompt: '', style: 'cinematic', ratio: '16:9' })

async function handleGenerateAiCover () {
  if (aiCoverGenerating.value) return
  const prompt = aiCoverForm.prompt.trim()
  if (prompt.length < 2) {
    notifyWarning('publishPage.aiCoverGenerateFailed', { params: { message: t('publishPage.aiCoverPromptPlaceholder') } })
    return
  }
  aiCoverGenerating.value = true
  try {
    const result = await getApi()?.generateAiCover?.({ prompt, style: aiCoverForm.style, ratio: aiCoverForm.ratio })
    const coverPath = result?.data?.coverPath || ''
    if (coverPath) {
      article.cover_path = coverPath
      article.cover_file = { path: coverPath, name: 'ai-cover.png' }
      coverFileList.value = [{ name: 'ai-cover.png', url: coverPath, path: coverPath }]
      notifySuccess('publishPage.aiCoverGenerated')
      showAiCoverDialog.value = false
    } else {
      notifyWarning('publishPage.aiCoverGenerateFailed', {
        params: { message: result?.message || t('publishPage.coverExtractUnknownError') },
      })
    }
  } catch (e) {
    notifyWarning('publishPage.aiCoverGenerateFailed', {
      params: { message: typeof e?.message === 'string' && e.message.trim() ? e.message : t('publishPage.coverExtractUnknownError') },
    })
  } finally {
    aiCoverGenerating.value = false
  }
}

const showTagPanel = ref(true)
const showTitlePanel = ref(false)
const showAiWriter = ref(false)
const showUpgradeModal = ref(false)
const combinedContent = computed(() => article.title + ' ' + article.content)

// ── composables ──────────────────────────
const {
  selectedPlatforms,
  selectedAccounts,
  hasVideoPlatforms,
  togglePlatform,
  getAccounts,
  getDefaultAccount,
  getSelectedAccountIds,
  setSelectedAccountIds,
  toggleAccount,
  isAccountSelected,
  isAccountAvailable,
} = usePlatformSelection(accountStore, platformStore)

const selectedOverridePlatforms = computed(() => {
  return platforms.value
    .filter(platform => selectedPlatforms.value.includes(platform.id))
    .map(platform => ({ ...platform, ...getPlatformContentLimit(platform.id) }))
})

const {
  showDraftList,
  drafts,
  loadingDrafts,
  applyDraft,
  loadDrafts,
  saveDraft,
  loadDraft,
  removeDraft,
} = usePublishDrafts({
  article,
  publishType,
  publishTypeLabel,
  selectedPlatforms,
  selectedAccounts,
  platformOverrides: diffEdits,
})

const precheckEnabled = ref(false)

const {
  publishing,
  progress,
  result,
  copied,
  activeTaskIds,
  activeScheduleIds,
  handlePublish,
  cancelPublish,
  retryPublish,
  loadPrecheckPreference,
  addProgress,
  copyUrl,
} = usePublishFlow({
  article,
  selectedPlatforms,
  selectedAccounts,
  precheckEnabled,
  diffEdits,
  isAccountAvailable,
  activeMode,
})

const {
  batchMode,
  batchPublishing,
  articles,
  batchProgress,
  failedBatchTasks,
  retryingFailed,
  templateTargetIdx,
  showTemplatePicker,
  batchDone,
  batchFail,
  totalPlatformTasks,
  addArticle,
  removeArticle,
  duplicateArticle,
  handleBatchPublish,
  retryFailedBatch,
  applyTemplate,
  checkBatchAccess,
  toggleBatchAccount,
  isBatchAccountSelected,
} = useBatchPublish({ article, licenseStore, isAccountAvailable })

watch(publishTab, async value => {
  if (value === 'drafts') {
    showDraftList.value = true
    await loadDrafts()
  } else if (showDraftList.value) {
    showDraftList.value = false
  }
})

watch(() => route.query.draft, async (draftId, previousDraftId) => {
  if (!draftId || draftId === previousDraftId) return
  await loadDrafts()
  await loadDraft(String(draftId))
})

function publishEditorQuery (extra = {}) {
  const query = { tab: 'publish', ...extra }
  if (route.query?.type) query.type = String(route.query.type)
  return query
}

function goToPublish () {
  return router.replace({ path: '/publish', query: publishEditorQuery() })
}

function editDraft (draft) {
  if (!draft?.id) return
  return router.replace({ path: '/publish', query: publishEditorQuery({ draft: String(draft.id) }) })
}

// 历史视频/结果页跳转预填充：从 query 解码 video_path/title/content/tags 填充发布表单。
// 跳转方（CreateViewHistory「发布」/ResultView「去发布」）已用 encodeURIComponent 编码，
// 而 vue-router 序列化 query 时会再编码一次，URL 中实际是双重编码（如 %253A）。
// 因此这里循环解码直到值不再变化，确保单次/双重编码都能还原为真实路径与文案。
// 解码后写入 article；tags 为逗号分隔字符串。
function applyHistoryVideoQuery () {
  const query = route.query || {}
  const decode = value => {
    if (typeof value !== 'string' || !value) return ''
    // 双重编码最多需 2 次解码（跳转方 encode + vue-router 序列化再 encode）。
    // 上限取 2：再多解一层会把单次编码值里合法的 %XX 序列（如真实标题 A%41B）
    // 过度解码成 AAB，损坏文案。相等即 break，天然终止，无死循环风险。
    let result = value
    for (let i = 0; i < 2; i++) {
      try {
        const next = decodeURIComponent(result)
        if (next === result) break
        result = next
      } catch {
        break
      }
    }
    return result
  }
  const videoPath = decode(query.video_path)
  if (!videoPath) return
  activeMode.value = 'video'
  article.video_path = videoPath
  const title = decode(query.title)
  if (title) article.title = title
  const content = decode(query.content)
  if (content) article.content = content
  const tags = decode(query.tags)
  if (tags) article.tags = normalizePublishStringList(tags)
  // 历史视频发布走视频首帧封面，不携带自定义封面（百家号 API 不支持）
  article.cover_url = ''
  article.cover_path = ''
  article.cover_file = null
}

// 草稿导入 — 从 Collection 页跳转时加载
onMounted(async () => {
  if (publishTab.value === 'drafts') {
    showDraftList.value = true
    await loadDrafts()
  }
  await loadAccounts()  // 加载多账号列表
  // 初始化默认选中账号
  for (const pid of selectedPlatforms.value) {
    const def = getDefaultAccount(pid)
    if (def) setSelectedAccountIds(pid, [def.id])
  }
  await loadPrecheckPreference()
  applyHistoryVideoQuery()
  const draftId = route.query.draft
  if (!draftId) return

  await loadDrafts()
  await loadDraft(String(draftId))
})

// 暴露给测试（w.vm.xxx）和外部组件
defineExpose({
  article,
  batchMode,
  batchPublishing,
  articles,
  batchProgress,
  batchDone,
  batchFail,
  totalPlatformTasks,
  precheckEnabled,
  publishing,
  progress,
  result,
  copied,
  activeTaskIds,
  activeScheduleIds,
  selectedPlatforms,
  selectedAccounts,
  hasVideoPlatforms,
  showDiffPanel,
  diffEdits,
  selectedOverridePlatforms,
  showDraftList,
  drafts,
  loadingDrafts,
  showTemplatePicker,
  showAiWriter,
  showUpgradeModal,
  imageFileList,
  coverFileList,
  tagsText,
  topicsText,
  mentionsText,
  handleImageFileChange,
  handleImageFileRemove,
  handleVideoFileChange,
  handleCoverFileChange,
  handleCoverFileRemove,
  templateTargetIdx,
  addArticle,
  removeArticle,
  duplicateArticle,
  handleBatchPublish,
  handlePublish,
  applyTemplate,
  checkBatchAccess,
  togglePlatform,
  getAccounts,
  getDefaultAccount,
  getSelectedAccountIds,
  setSelectedAccountIds,
  toggleAccount,
  isAccountSelected,
  cancelPublish,
  retryPublish,
  copyUrl,
  addProgress,
  loadAccounts,
  applyDraft,
  loadDrafts,
  saveDraft,
  loadDraft,
  removeDraft,
  replaceDiffEdits,
  activeMode,
  handleExtractVideoCover,
  openCoverCrop,
  onCoverCropSuccess,
  onCoverCropError,
})
</script>

<style scoped>
/* —— 语义化 class（原 inline style 迁移，2026-08-10） —— */
.publish-header-row { display: flex; align-items: center; gap: var(--space-md); width: 100%; flex-wrap: wrap; }
.publish-header-row .flex-spacer { flex: 1 1 240px; min-width: 0; }
.batch-mode-toggle { cursor: pointer; user-select: none; display: flex; align-items: center; gap: 8px; font-size: var(--font-size-sm); color: var(--muted); }
.cohere-content-split { display: flex; gap: var(--space-xl); }
.batch-articles { display: flex; flex-direction: column; gap: var(--space-md); }
.cohere-card-static { cursor: default; position: relative; }
.publish-action-card {
  align-self: flex-start;
  width: 100%;
  box-sizing: border-box;
  position: sticky;
  top: 16px;
  z-index: 2;
}
.publish-action-controls {
  padding-top: 12px;
}
.cohere-card-offset { margin-top: 16px; cursor: default; }
.cohere-form-gap { gap: var(--space-md); }
.article-card-row { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-md); }
.flex-spacer { flex: 1; }
.flex-main { flex: 2; min-width: 0; }
.flex-side { flex: 1; min-width: 280px; }
.coral-text { color: var(--coral); }
.coral-check { accent-color: var(--coral); }
.ai-declaration-row { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: var(--font-size-sm); color: var(--muted); user-select: none; }
.title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.no-margin-bottom { margin-bottom: 0; }
.template-pick-button { font-size: var(--font-size-xs); padding: 2px 8px; border: none; background: none; cursor: pointer; color: var(--coral); }
.batch-platform-option { display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: var(--font-size-sm); }
.input-max-260 { max-width: 260px; }
.input-max-300 { max-width: 300px; }
.publish-time-hint { font-size: var(--font-size-xs); color: var(--muted); margin-left: 8px; }
.stack-gap { margin-bottom: var(--space-md); }
.stack-gap-top { margin-top: 12px; }
.stack-center { text-align: center; }
.row-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); }
.row-actions-compact { display: flex; gap: 4px; }
.progress-title { font-weight: 600; font-size: var(--font-size-sm); margin-bottom: var(--space-sm); }
.progress-toolbar { display: flex; gap: var(--space-sm); margin-bottom: var(--space-sm); }
.muted-text { font-size: var(--font-size-sm); color: var(--muted); }
.side-button-block { width: 100%; justify-content: center; margin-bottom: 8px; }
.side-button-block-top { margin-bottom: 0; margin-top: 8px; }
.side-button-full { width: 100%; justify-content: center; }
.draft-list-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.draft-list-title { font-weight: 600; font-size: var(--font-size-sm); }
.plain-close-button { background: none; border: none; cursor: pointer; font-size: var(--font-size-base); color: var(--muted); }
.draft-empty { text-align: center; padding: 20px; color: var(--muted); }
.result-header-row { display: flex; gap: 8px; align-items: center; }
.result-link-row { margin-top: 12px; display: flex; align-items: center; gap: 8px; }
.result-link { font-size: var(--font-size-sm); color: var(--action-blue); text-decoration: none; }
.copy-url-button { background: none; border: 1px solid var(--border, #e0e0e0); border-radius: 4px; padding: 2px 8px; font-size: var(--font-size-xs); cursor: pointer; color: var(--muted, #999); transition: all .2s; }
.copy-url-button.is-copied { background: var(--cohere-green, #67c23a); color: var(--surface); border-color: var(--cohere-green, #67c23a); }

.publish-type-context { color: var(--coral, #f56c6c); font-size: var(--font-size-sm); font-weight: 600; }
.publish-mode-tabs { display: flex; gap: 0; border: 1px solid var(--border-light, #e0e0e0); border-radius: 8px; overflow: hidden; }
.publish-mode-tab {
  padding: 6px 16px;
  border: none;
  background: var(--surface, #fff);
  color: var(--muted, #73777d);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all .15s ease;
  white-space: nowrap;
}
.publish-mode-tab:hover { background: var(--soft-stone, #f8f8fa); color: var(--text-primary, #25252b); }
.publish-mode-tab.active { background: var(--coral, #f56c6c); color: #fff; }
.video-upload-zone :deep(.el-upload-dragger) { padding: 40px 20px; border: 2px dashed var(--border-light, #dcdfe6); border-radius: 12px; }
.video-upload-zone :deep(.el-upload-dragger:hover) { border-color: var(--coral, #f56c6c); }
.video-upload-zone :deep(.el-icon--upload) { font-size: 48px; color: var(--muted, #909399); margin-bottom: 8px; }
.video-cover-row { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.publish-drafts-page {
  min-height: 100%;
  padding: 24px;
  background: var(--canvas, #f7f7fb);
}
.publish-drafts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.publish-drafts-state {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--border-light, #e8e8ec);
  border-radius: 10px;
  background: var(--surface, #fff);
  color: var(--muted, #73777d);
  text-align: center;
}
.publish-drafts-state strong { color: var(--text-primary, #25252b); font-size: var(--font-size-base); }
.publish-drafts-list { display: flex; flex-direction: column; gap: 10px; }
.publish-draft-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--border-light, #e8e8ec);
  border-radius: 10px;
  background: var(--surface, #fff);
}
.publish-draft-info { min-width: 0; display: flex; align-items: center; gap: 12px; }
.publish-draft-info strong { overflow: hidden; color: var(--text-primary, #25252b); text-overflow: ellipsis; white-space: nowrap; }
.publish-draft-info span { color: var(--muted, #73777d); font-size: var(--font-size-xs); }
.publish-draft-actions { display: flex; flex: 0 0 auto; gap: 6px; }
.publish-section-toggle {
  width: 100%;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border-light, #e0e0e0);
  border-radius: 6px;
  padding: 7px 10px;
  color: var(--text-primary, #202124);
  background: var(--surface, #fff);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.publish-section-toggle:hover { border-color: var(--action-blue, #1890ff); }
.publish-section-toggle__state { color: var(--action-blue, #1890ff); font-size: var(--font-size-xs); }

.batch-platform-targets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.batch-metadata-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.batch-metadata-grid > div { min-width: 0; }
.batch-account-targets {
  flex: 1 0 100%;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 12px;
  padding: 8px 10px;
  border-left: 2px solid var(--border-light, #e8eaed);
  background: var(--soft-stone, #fafafa);
}
.batch-account-label { color: var(--muted, #73777d); font-size: var(--font-size-xs); font-weight: 600; }
.batch-account-option { display: inline-flex; align-items: center; gap: 5px; color: var(--text-primary, #202124); font-size: var(--font-size-xs); cursor: pointer; }
.batch-account-option input { accent-color: var(--coral, #f56c6c); }
.batch-retry-icon { width: 14px; height: 14px; margin-right: 4px; vertical-align: -2px; }
.publish-media-upload { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.media-upload-trigger { min-height: 32px; padding: 5px 12px; border: 1px solid #d9dce8; border-radius: 6px; background: var(--color-bg-card); color: #4d5574; font-size: var(--font-size-xs); cursor: pointer; }
.media-upload-trigger:hover { border-color: #5048e5; color: #5048e5; }
.publish-metadata-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.publish-metadata-grid > div { min-width: 0; }

@media (max-width: 720px) {
  .publish-metadata-grid { grid-template-columns: 1fr; }
}

/* 草稿箱列表 */
.draft-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.draft-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border: 1px solid var(--border-light, #eee);
  border-radius: 8px;
  transition: background 0.15s;
}
.draft-item:hover { background: var(--soft-stone, #f8f8fa); }
.draft-info { flex: 1; min-width: 0; }
.draft-title {
  font-weight: 500;
  font-size: var(--font-size-sm);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.draft-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.draft-time {
  font-size: var(--font-size-xs);
  color: var(--muted, #999);
}

@media (max-width: 1080px) {
  .cohere-content {
    flex-direction: column;
  }

  .publish-action-card {
    position: static;
  }
}
@media (max-width: 720px) {
  .publish-header-row { align-items: flex-start; }
  .publish-mode-tabs { flex: 1 1 100%; order: 2; }
  .publish-mode-tabs .publish-mode-tab { flex: 1 1 0; }
  .batch-mode-toggle { order: 3; }
  .publish-drafts-page { padding: 16px 12px 24px; }
  .publish-drafts-header,
  .publish-draft-card { align-items: flex-start; flex-direction: column; }
  .publish-draft-info { align-items: flex-start; flex-direction: column; gap: 4px; }
  .publish-draft-actions { width: 100%; }
  .batch-metadata-grid { grid-template-columns: 1fr; }
}
</style>

<style scoped>
/* P2-2：AI 封面生成对话框 */
.ai-cover-overlay { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.45); }
.ai-cover-modal { width: min(420px, calc(100vw - 48px)); background: var(--surface, #fff); border-radius: 10px; padding: 20px; display: grid; gap: 14px; box-shadow: 0 8px 32px rgba(0,0,0,0.18); }
.ai-cover-modal__title { margin: 0; font-size: var(--font-size-base); font-weight: 600; color: var(--text-primary, #202124); }
.ai-cover-field { display: grid; gap: 5px; font-size: var(--font-size-xs); color: var(--muted, #73777d); }
.ai-cover-field textarea, .ai-cover-field select { width: 100%; box-sizing: border-box; border: 1px solid var(--border-light, #e0e0e0); border-radius: 6px; padding: 8px 10px; font: inherit; color: var(--text-primary, #202124); background: var(--surface, #fff); resize: vertical; }
.ai-cover-actions { display: flex; justify-content: flex-end; gap: 8px; }

/* P2-3：AI 视频生成入口 */
.video-ai-entry { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.video-ai-entry__hint { font-size: var(--font-size-xs); color: var(--muted, #8a8f98); }
</style>
