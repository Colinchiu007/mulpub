<template>
  <div>
  <!-- 文案详情模式提示条（copy-library-detail-entry） -->
  <CopyDetailBanner v-if="showCopyDetailBanner" @close="showCopyDetailBanner = false" />
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
        <!-- 批量设置发布目标工具条（组件化：本视图在零增长容差清单内） -->
        <BatchTargetsToolbar
          v-model="batchTargetPlatforms"
          :platform-options="handoffPlatformOptions"
          :article-count="articles.length"
          @apply-all="applyBatchTargetsToAll"
        />
        <BatchArticleCard
          v-for="(a, idx) in articles"
          :key="a._key"
          :article="a"
          :index="idx"
          :platform-catalog="platforms"
          :can-delete="articles.length > 1"
          :get-accounts="getAccounts"
          :is-account-selected="(pid, aid) => isBatchAccountSelected(a, pid, aid)"
          :resolve-account-name="(account, platformLabel) => resolveAccountDisplayName(account, { platformLabel })"
          :schedule-hint="fieldSurface.hintTextFor(a.platforms)"
          :schedule-capability-hint="scheduleCapabilityHint(a.platforms)"
          @duplicate="duplicateArticle(idx)"
          @remove="removeArticle(idx)"
          @open-template="showTemplatePicker = true; templateTargetIdx = idx"
          @update:title="value => { a.title = value }"
          @update:content="value => { a.content = value }"
          @update:mentions-text="value => { a.mentionsText = value }"
          @update:publish-time="value => { a.publishTime = value }"
          @update:tags-text="value => setBatchTagsText(a, value)"
          @add-topic-hash="appendBatchHash(a)"
          @open-topic-tag-manager="openTopicTagManager('batch', idx)"
          @update:cover="descriptor => setBatchArticleCover(a, descriptor)"
          @update:cover-url="value => setBatchArticleCoverUrl(a, value)"
          @update:visibility="value => setBatchArticleVisibility(a, value)"
          @update:overrides="next => setBatchArticleOverrides(a, next)"
          @clear-cover="clearBatchArticleCover(a)"
          @open-preview="openBatchCoverPreview"
          @toggle-platform="platformId => toggleBatchPlatform(a, platformId)"
          @toggle-account="(pid, aid) => toggleBatchAccount(a, pid, aid)"
        />

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
            <!-- 取消排期：与单篇日历取消入口对齐。仅当本会话确有排期成功批次时出现，
                 按钮文案与主进程 batch:cancel 语义一致（清定时器 + 状态置 cancelled）。 -->
            <UiButton
              v-if="scheduledBatchId"
              variant="secondary"
              size="sm"
              data-testid="cancel-scheduled-batch"
              :title="t('publishPage.batchNotify.cancelSchedule')"
              @click="cancelScheduledBatch"
            >
              <Close class="batch-retry-icon" />
              {{ t('publishPage.batchNotify.cancelSchedule') }}
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
                    ref="videoUploadRef"
                    v-model:file-list="videoUploadFileList"
                    drag
                    :auto-upload="false"
                    :limit="1"
                    accept="video/*"
                    class="video-upload-zone"
                    :class="{ 'has-selected-video': Boolean(article.video_path) }"
                    :on-change="handleVideoFileChange"
                    :on-remove="handleVideoFileRemove"
                    :on-exceed="handleVideoFileExceed"
                  >
                    <el-icon class="el-icon--upload" :size="48"><upload-filled /></el-icon>
                    <div class="el-upload__text">{{ t('publishPage.dragVideo') }}<em>{{ t('publishPage.clickSelect') }}</em></div>
                    <template #tip><div class="el-upload__tip">{{ t('publishPage.dragVideoHint') }}</div></template>
                  </el-upload>
                  <SelectedVideoCard
                    :path="article.video_path"
                    :info="videoFileMeta"
                    @replace="triggerVideoReselect"
                    @remove="handleVideoCardRemove"
                  />
                  <div class="video-ai-entry">
                    <UiButton variant="ghost" size="sm" data-testid="goto-ai-video-btn" @click="router.push('/create')">
                      {{ t('publishPage.aiVideoEntry') }}
                    </UiButton>
                    <span class="video-ai-entry__hint">{{ t('publishPage.aiVideoEntryHint') }}</span>
                  </div>
                </div>
                <div class="cohere-form-item">
                  <label class="cohere-form-label">
                    {{ t('publishPage.title') }}
                    <span v-if="fieldSupportText('title')" class="field-support-badge" data-testid="field-support-title">{{ fieldSupportText('title') }}</span>
                  </label>
                  <UiInput data-testid="publish-title" v-model="article.title" :placeholder="t('publishPage.videoTitlePlaceholder')" />
                  <p v-if="noTitleHint" class="no-title-hint" data-testid="no-title-hint">{{ noTitleHint }}</p>
                </div>
                <!-- 标题助手：贴邻标题输入（openspec optimize-publish-right-rail） -->
                <div v-if="showTitlePanel || article.title.length > 5" class="cohere-form-item">
                  <TitleAssistantPanel :title="article.title" :visible="showTitlePanel" @close="showTitlePanel = false" />
                  <div v-if="!showTitlePanel && article.title.length > 5" class="stack-center">
                    <UiButton variant="ghost" size="sm" data-testid="title-assistant-toggle" @click="showTitlePanel = true">{{ t('publishPage.titleReference') }}</UiButton>
                  </div>
                </div>
                <div class="cohere-form-item">
                  <label class="cohere-form-label">
                    {{ t('publishPage.videoDescLabel') }}
                    <span v-if="fieldSupportText('content')" class="field-support-badge" data-testid="field-support-content">{{ fieldSupportText('content') }}</span>
                  </label>
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
                    <CoverThumbnail
                      :data-url="coverPreviewUrl"
                      :error="coverPreviewError"
                      :loading="coverPreviewLoading"
                      @open="openCoverPreview"
                    />
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
                    <label class="cohere-form-label">
                      {{ t('publishPage.tags') }}
                      <span v-if="fieldSupportText('tags')" class="field-support-badge" data-testid="field-support-tags">{{ fieldSupportText('tags') }}</span>
                    </label>
                    <UiInput v-model="tagsText" :placeholder="t('publishPage.tagsPlaceholder')" />
                    <!-- 话题标签统一（topic-tag-unify）：#添加话题 追加 #；常用话题标签开管理弹窗（目标=单篇）。 -->
                    <div class="topic-tag-actions">
                      <UiButton variant="ghost" size="sm" data-testid="add-topic-hash" @click="appendHashToDescription">{{ t('publishPage.topicTag.addHash') }}</UiButton>
                      <UiButton variant="ghost" size="sm" data-testid="open-topic-tag-manager" @click="openTopicTagManager('single')">{{ t('publishPage.topicTag.manage') }}</UiButton>
                    </div>
                  </div>
                  <div>
                    <label class="cohere-form-label">
                      {{ t('publishPage.mentions') }}
                      <span v-if="fieldSupportText('mentions')" class="field-support-badge">{{ fieldSupportText('mentions') }}</span>
                    </label>
                    <UiInput v-model="mentionsText" :placeholder="t('publishPage.mentionsPlaceholder')" />
                  </div>
                </div>
                <!-- 智能标签建议：贴邻标签/话题输入，平台跟随所选发布目标（openspec optimize-publish-right-rail） -->
                <div v-if="combinedContent.length > 3" class="cohere-form-item">
                  <TagSuggester v-if="showTagPanel" :content="combinedContent" :platforms="selectedPlatforms" @close="showTagPanel = false" @apply-tag="applySuggestedTag" />
                  <div v-else class="stack-center">
                    <UiButton variant="ghost" size="sm" @click="showTagPanel = true">{{ t('publishPage.showTagSuggest') }}</UiButton>
                  </div>
                </div>
                <div class="cohere-form-item">
                  <label class="cohere-form-label">
                    {{ t('publishPage.schedule') }}
                    <span v-if="scheduleCapabilityHint(selectedPlatforms)" class="field-support-badge">{{ scheduleCapabilityHint(selectedPlatforms) }}</span>
                  </label>
                  <UiInput type="datetime-local" v-model="article.publishTime" class="input-max-260" />
                  <span class="publish-time-hint">{{ scheduleHintText }}</span>
                </div>
                <!-- 最佳发布时间：贴邻定时发布字段（openspec optimize-publish-right-rail） -->
                <div v-if="article.title.length > 2" class="cohere-form-item">
                  <OptimalTimeTip :keyword="article.title" />
                </div>
                <!-- P1-5 语义级可见性：通用区统一档位，映射真源在注册表 semanticValues -->
                <div class="cohere-form-item">
                  <PublishVisibilitySelect
                    v-model="article.visibilitySemantic"
                    :platforms="visibilitySupportedPlatforms"
                    :hint="visibilityUnsupportedHint"
                  />
                </div>
                <div class="cohere-form-item">
                  <label class="cohere-form-label">
                    {{ t('publishPage.aiDeclaration') }}
                    <span v-if="fieldSupportText('aiGenerated')" class="field-support-badge">{{ fieldSupportText('aiGenerated') }}</span>
                  </label>
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
                  <label class="cohere-form-label no-margin-bottom">
                    {{ t('publishPage.title') }}
                    <span v-if="fieldSupportText('title')" class="field-support-badge" data-testid="field-support-title">{{ fieldSupportText('title') }}</span>
                  </label>
                  <button class="cohere-btn-ghost template-pick-button" @click="showTemplatePicker = !showTemplatePicker; templateTargetIdx = -1">
                    {{ showTemplatePicker ? t('publishPage.close') : t('publishPage.template') }}
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
                <p v-if="noTitleHint" class="no-title-hint" data-testid="no-title-hint">{{ noTitleHint }}</p>
              </div>
              <!-- 标题助手：贴邻标题输入（openspec optimize-publish-right-rail） -->
              <div v-if="showTitlePanel || article.title.length > 5" class="cohere-form-item">
                <TitleAssistantPanel :title="article.title" :visible="showTitlePanel" @close="showTitlePanel = false" />
                <div v-if="!showTitlePanel && article.title.length > 5" class="stack-center">
                  <UiButton variant="ghost" size="sm" data-testid="title-assistant-toggle" @click="showTitlePanel = true">{{ t('publishPage.titleReference') }}</UiButton>
                </div>
              </div>
              <div v-if="showTemplatePicker && templateTargetIdx < 0" class="stack-gap">
                <TemplatePicker @close="showTemplatePicker = false" @apply="applyTemplate" />
              </div>
              <div v-if="showAiWriter && templateTargetIdx < 0" class="stack-gap">
                <AiWriterPanel
                  :sourceContent="article.content"
                  @close="showAiWriter = false"
                  @apply-title="article.title = $event; showAiWriter = false"
                  @apply-content="(text, lineage) => { article.content = text + '\n'; article.rewriteHistoryId = lineage || null; showAiWriter = false }"
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
                <el-upload ref="videoUploadRef" v-model:file-list="videoUploadFileList" drag :auto-upload="false" :limit="1" accept="video/*" :on-change="handleVideoFileChange" :on-remove="handleVideoFileRemove" :on-exceed="handleVideoFileExceed">
                  <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                  <div class="el-upload__text">{{ t('publishPage.dragVideo') }}<em>{{ t('publishPage.clickSelect') }}</em></div>
                  <template #tip><div class="el-upload__tip">{{ t('publishPage.videoTip') }}</div></template>
                </el-upload>
                <SelectedVideoCard
                  :path="article.video_path"
                  :info="videoFileMeta"
                  @replace="triggerVideoReselect"
                  @remove="handleVideoCardRemove"
                />
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
                <!-- 不加 flex 包裹层：.cohere-form-item 是列向 flex，el-upload 靠 align-items:stretch
                     占满宽；套一层行向容器会让它退化成内容宽，产生与本功能无关的基线位移。 -->
                <CoverThumbnail
                  :data-url="coverPreviewUrl"
                  :error="coverPreviewError"
                  :loading="coverPreviewLoading"
                  @open="openCoverPreview"
                />
                <UiInput v-model="article.cover_url" :placeholder="t('publishPage.coverUrlPlaceholder')" />
              </div>
              <div class="cohere-form-item publish-metadata-grid">
                <div>
                  <label class="cohere-form-label" for="publish-tags">
                    {{ t('publishPage.tags') }}
                    <span v-if="fieldSupportText('tags')" class="field-support-badge" data-testid="field-support-tags">{{ fieldSupportText('tags') }}</span>
                  </label>
                  <UiInput id="publish-tags" v-model="tagsText" :placeholder="t('publishPage.tagsPlaceholder')" />
                  <!-- 话题标签统一（topic-tag-unify）：#添加话题 追加 #；常用话题标签开管理弹窗（目标=单篇）。 -->
                  <div class="topic-tag-actions">
                    <UiButton variant="ghost" size="sm" data-testid="add-topic-hash" @click="appendHashToDescription">{{ t('publishPage.topicTag.addHash') }}</UiButton>
                    <UiButton variant="ghost" size="sm" data-testid="open-topic-tag-manager" @click="openTopicTagManager('single')">{{ t('publishPage.topicTag.manage') }}</UiButton>
                  </div>
                </div>
                <div>
                  <label class="cohere-form-label" for="publish-mentions">
                    {{ t('publishPage.mentions') }}
                    <span v-if="fieldSupportText('mentions')" class="field-support-badge">{{ fieldSupportText('mentions') }}</span>
                  </label>
                  <UiInput id="publish-mentions" v-model="mentionsText" :placeholder="t('publishPage.mentionsPlaceholder')" />
                </div>
              </div>
              <!-- 智能标签建议：贴邻标签/话题输入，平台跟随所选发布目标（openspec optimize-publish-right-rail） -->
              <div v-if="combinedContent.length > 3" class="cohere-form-item">
                <TagSuggester v-if="showTagPanel" :content="combinedContent" :platforms="selectedPlatforms" @close="showTagPanel = false" @apply-tag="applySuggestedTag" />
                <div v-else class="stack-center">
                  <UiButton variant="ghost" size="sm" @click="showTagPanel = true">{{ t('publishPage.showTagSuggest') }}</UiButton>
                </div>
              </div>
              <div class="cohere-form-item">
                <label class="cohere-form-label">
                  {{ t('publishPage.schedule') }}
                  <span v-if="scheduleCapabilityHint(selectedPlatforms)" class="field-support-badge">{{ scheduleCapabilityHint(selectedPlatforms) }}</span>
                </label>
                <UiInput type="datetime-local" v-model="article.publishTime" class="input-max-260" />
                <span class="publish-time-hint">{{ scheduleHintText }}</span>
              </div>
              <!-- 最佳发布时间：贴邻定时发布字段（openspec optimize-publish-right-rail） -->
              <div v-if="article.title.length > 2" class="cohere-form-item">
                <OptimalTimeTip :keyword="article.title" />
              </div>
              <!-- P1-5 语义级可见性：通用区统一档位，映射真源在注册表 semanticValues -->
              <div class="cohere-form-item">
                <PublishVisibilitySelect
                  v-model="article.visibilitySemantic"
                  :platforms="visibilitySupportedPlatforms"
                  :hint="visibilityUnsupportedHint"
                />
              </div>
              <div class="cohere-form-item">
                <label class="cohere-form-label">
                  {{ t('publishPage.aiDeclaration') }}
                  <span v-if="fieldSupportText('aiGenerated')" class="field-support-badge">{{ fieldSupportText('aiGenerated') }}</span>
                </label>
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
          <!-- 任务闭环区置顶（openspec optimize-publish-right-rail）：发布目标+主操作首屏可见，sticky 兜底 -->
          <div class="cohere-card cohere-card-static publish-action-card" data-testid="publish-action-card">
            <div class="cohere-form cohere-form-gap">
              <div class="cohere-form-label">{{ t('publishPage.publishTarget') }}</div>
              <PublishTargetSelector
                data-testid="publish-target-selector"
                :groups="groupedPlatforms"
                :selected-platforms="selectedPlatforms"
                :selected-accounts="selectedAccounts"
                :disabled="publishing"
                :risk-suspended="riskStore.suspended"
                @toggle-platform="togglePlatform"
                @toggle-account="toggleAccount"
                :account-groups="groupPickerItems"
                @apply-group="applyGroupById"
                v-bind="addAccountBindings"
              />
              <!-- 小红书仅存草稿（用户硬约束）：必须在勾选后当场说清，避免用户以为已经公开发布 -->
              <p v-if="selectedPlatforms.includes('xiaohongshu')" class="no-title-hint" data-testid="xhs-draft-only-hint">
                {{ t('publishPage.xhsDraftOnlyHint') }}
              </p>
              <div class="publish-action-controls" data-testid="publish-action-controls">
                <div class="cohere-divider"></div>
                <UiButton variant="secondary" class="side-button-block" data-testid="publish-save-draft" :disabled="publishing" @click="onSaveDraft">{{ t('publishPage.saveDraft') }}</UiButton>
                <UiButton variant="secondary" size="sm" class="side-button-block" data-testid="publish-create-video" :disabled="publishing" @click="handleCreateVideo">{{ t('publishPage.createVideo') }}</UiButton>
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
              <!-- 2026-10-07 真机 E2E（PR #3087 同族）：平台侧定时下，`result.success`
                   只代表「本地排期记录已创建并入队」，平台受理发生在**之后**的队列异步提交里。
                   此时渲染「发布成功」是假成功 —— 平台一旦拒收（如 code=7050），
                   用户看到的仍是绿色成功标签，且失败只落在发布记录里、当场无感知。
                   故排期路径单列第三态，措辞只承诺已发生的事。 -->
              <span v-if="result.scheduled" class="cohere-tag cohere-tag-info">{{ t('publishPage.scheduleCreatedTag') }}</span>
              <span v-else-if="result.success" class="cohere-tag cohere-tag-success">{{ t('publishPage.publishSuccess') }}</span>
              <span v-else class="cohere-tag cohere-tag-danger">{{ t('publishPage.publishFailed') }}</span>
              <span class="muted-text">{{ result.message }}</span>
            </div>
            <p v-if="result.scheduled" class="publish-time-hint" data-testid="schedule-created-hint">{{ t('publishPage.scheduleCreatedHint') }}</p>
            <UiButton
              v-if="!result.success && !result.cancelled"
              variant="secondary"
              size="sm"
              class="stack-gap-top"
              @click="retryPublish"
            >
              {{ t('publishPage.retryPublish') }}
            </UiButton>
            <UiButton
              v-else-if="result.scheduled"
              variant="secondary"
              size="sm"
              class="stack-gap-top"
              @click="router.push('/publish/history')"
            >
              {{ t('publishPage.scheduleViewHistory') }}
            </UiButton>
            <div v-if="result.url" class="result-link-row">
              <a v-if="safeHttpUrl(result.url)" :href="safeHttpUrl(result.url)" target="_blank" rel="noopener" class="result-link">{{ t('publishPage.viewArticle') }}</a>
              <span v-else class="result-link">{{ result.url }}</span>
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
  <!-- 常用话题标签管理（topic-tag-unify）：单篇与批量卡片共用同一弹窗实例，
       应用目标由 openTopicTagManager 记录的 target 区分。挂起/释放都在组件内部。 -->
  <TopicTagManagerDialog
    :visible="showTopicTagManager"
    @close="showTopicTagManager = false"
    @apply="applyTopicTagPreset"
  />
  <!-- 封面放大预览（PRD-PUBLISH-COVER-PREVIEW §5.3）：与缩略图、裁剪弹窗共用同一封面真源。
       挂起/释放、文件名与原始尺寸都在组件内部，本视图只持有「开合」这一个状态。 -->
  <CoverPreviewDialog
    :visible="showCoverPreview"
    :data-url="batchCoverPreview ? batchCoverPreview.dataUrl : coverPreviewUrl"
    :error="batchCoverPreview ? '' : coverPreviewError"
    :path="batchCoverPreview ? batchCoverPreview.path : article.cover_path"
    @close="closeCoverPreview"
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
import { ref, reactive, computed, onMounted, onActivated, onBeforeUnmount, watch } from 'vue'
import { safeHttpUrl } from '@multi-publish/shared-utils/src/safe-http-url'
import { getApi } from '@/api/electron-bridge'
import { useNotify } from '@/composables/useNotify'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getAppLocale } from '@/i18n'
import { usePlatformStore } from '@/stores/platforms'
import { useRiskStore } from '@/stores/risk'
import { useAccountStore } from '@/stores/accounts'
import { Close, Refresh, UploadFilled } from '@element-plus/icons-vue'
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
import CoverThumbnail from '@/components/CoverThumbnail.vue'
import CoverPreviewDialog from '@/components/CoverPreviewDialog.vue'
import TopicTagManagerDialog from '@/components/TopicTagManagerDialog.vue'
import { useCoverPreview } from '@/composables/useCoverPreview'
import { releaseEmbeddedViewsForOverlay, suspendEmbeddedViewsForOverlay } from '@/composables/useEmbeddedViewSuspension'
import { usePlatformSelection } from '@/composables/usePlatformSelection'
import { usePublishGroupTargets } from '@/composables/usePublishGroupTargets'
import { usePublishAddAccountTargets } from '@/composables/usePublishAddAccountTargets'
import { usePublishFlow } from '@/composables/usePublishFlow'
import { useBatchPublish } from '@/composables/useBatchPublish'
import { useHotTopicsDraftHandoff } from '@/composables/useHotTopicsDraftHandoff'
import BatchTargetsToolbar from '@/features/publish/components/BatchTargetsToolbar.vue'
import BatchArticleCard from '@/features/publish/components/BatchArticleCard.vue'
import CopyDetailBanner from '@/features/publish/components/CopyDetailBanner.vue'
import { useCopyDetailMode } from '@/composables/useCopyDetailMode'
import { usePublishDrafts } from '@/composables/usePublishDrafts'
import {
  normalizePublishMentions,
  normalizePublishStringList,
} from '@/features/publish/publish-contract'
import { normalizeUploadFile, resolveUploadFilePath } from '@/features/publish/publish-upload-file'
import { usePublishFieldSurface } from '@/features/publish/usePublishFieldSurface'
import { appendTopicsToContent, removeTopicFromContent } from '@/features/publish/topic-inline'
import { useTopicTagBridge } from '@/features/publish/use-topic-tag-bridge'
import PlatformOverridePanel from '@/features/publish/components/PlatformOverridePanel.vue'
import PublishVisibilitySelect from '@/features/publish/components/PublishVisibilitySelect.vue'
import PublishTargetSelector from '@/features/publish/components/PublishTargetSelector.vue'
import SelectedVideoCard from '@/features/publish/components/SelectedVideoCard.vue'
import { resolveAccountDisplayName } from '@/utils/account-display-name'
import { usePublishPlatformCatalog } from '@/features/publish/usePublishPlatformCatalog'
import { readPanelVisibilityPrefs, writePanelVisibilityPrefs } from '@/composables/usePanelVisibilityPrefs'
import { formatBytes } from '@/utils/bytes'
import { classifyVideoSelection, describeVideoFile } from '@/utils/video-selection-feedback'

// 组件名显式声明：App.vue 主工作区 <keep-alive :include="['Publish']"> 按组件名匹配，
// 让发布页在路由切换时保留实例（草稿不丢）。依赖文件名推断的 __name 在构建配置变化时不稳，
// 故显式声明，避免 keep-alive 静默不命中而退回「每次重挂载丢草稿」。
defineOptions({ name: 'Publish' })

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
// 定时发布 hint 前置展示校验限制（2026-10-06）：限制值与 validateScheduleEntries
// 共用同一常量源，避免文案与实际校验漂移。2026-10-08 起按**所选平台**显示有效上限
// （头条经平台 bundle 取证为 7 天；若 hint 仍显全局 30 天，用户按 30 天排期会被提交
// 校验拒绝）。实现见 fieldSurface.hintTextFor（下方 fieldSurface 定义处接线）。
const { notifySuccess, notifyWarning, notifyInfo, notifyError } = useNotify()
// 视频上传区 el-upload 实例（video/article 两个互斥分支共用一个 ref，同时只有一个渲染）。
// limit=1 的「重选替换」需要经它 clearFiles + handleStart，否则 el-upload 静默丢弃新文件。
const videoUploadRef = ref(null)
const publishTab = computed(() => String(route.query?.tab || 'publish'))
// image/wechat 归一化为 article；白名单只留 video/article 两个真实入口。
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
// P0-2 风控挂起可见性：发布页目标选择器消费权威挂起清单（main.js 已全局 start），
// 挂起账号/平台在选择器上显示「风控挂起」徽标 + 行动指引 tooltip（发布前可见，而非发布时被拦才知道）。
const riskStore = useRiskStore()
platformStore.load()
const accountStore = useAccountStore()
const licenseStore = useLicenseStore()
const { platforms, groupedPlatforms } = usePublishPlatformCatalog(platformStore, accountStore)

// 无账号平台空态出口 + 账号列表加载：理由见 composables/usePublishAddAccountTargets 头部与 PRD-PUBLISH-ADD-ACCOUNT-ENTRY-2026-10-15.md
const { addAccountBindings, loadAccounts } = usePublishAddAccountTargets({ accountStore, platformStore, isPublishing: () => publishing.value, notifyError, notifyWarning })

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
  // P1-5 语义级可见性：通用区一次选择（public/friends/private）批量映射到所选平台
  // 各自的可见性字段值（映射真源在注册表 semanticValues，经 resolver 消费）。
  // 空串 = 跟随各平台默认；平台差异化面板可对单平台细调（override 优先于本档位）。
  visibilitySemantic: '',
  // AI 生成内容声明：默认勾选（AI 生成内容）。各平台发布时如实声明内容创作方式。
  aiGenerated: true,
  // 归因链（PRD-PUBLISH-REWRITE-LINEAGE-2026-10-05）：本正文来自哪一次改写。
  // 空 = 无从关联；有值时随 payload 进 task.article → tracked_content.rewrite_history_id。
  // 它不是内容字段，故不参与草稿指纹（见 services/draft-fingerprint.js 的白名单）。
  rewriteHistoryId: null,
})
const imageFileList = ref([])
const coverFileList = ref([])
// 视频上传列表（el-upload v-model:file-list）与已选视频元信息（卡片展示用）。
// 草稿恢复等路径只有 video_path 没有 File 对象时 videoFileMeta 为 null，卡片退化为路径推导展示。
const videoUploadFileList = ref([])
const videoFileMeta = ref(null)
// 话题内联描述（publish-topic-inline-description，PRD §3.5）：话题输入是「快速添加入口」，
// 以 #话题 形态同步进描述（所见即所得、单向框→描述；发布时以描述解析为准）。
function syncTopicsToContent (prev, next) {
  if (prev.length === next.length && prev.every((name, index) => name === next[index])) return
  const added = next.filter(name => !prev.includes(name))
  const removed = prev.filter(name => !next.includes(name))
  let content = article.content
  for (const name of removed) content = removeTopicFromContent(content, name)
  article.content = appendTopicsToContent(content, added)
}
// 批量模式同口径：每篇的「话题标签」输入经追加管道同步各自 content（手写双向绑定）。
function syncBatchTopicsToContent (batchArticle, prevText, nextText) {
  const prev = normalizePublishStringList(prevText)
  const next = normalizePublishStringList(nextText)
  if (prev.length === next.length && prev.every((name, index) => name === next[index])) return
  const added = next.filter(name => !prev.includes(name))
  const removed = prev.filter(name => !next.includes(name))
  let content = batchArticle.content
  for (const name of removed) content = removeTopicFromContent(content, name)
  batchArticle.content = appendTopicsToContent(content, added)
}
function setBatchTagsText (batchArticle, value) {
  const prev = batchArticle.tagsText
  batchArticle.tagsText = value
  syncBatchTopicsToContent(batchArticle, prev, value)
}
const tagsText = computed({
  get: () => normalizePublishStringList(article.tags).join(', '),
  set: value => {
    const prev = normalizePublishStringList(article.tags)
    const next = normalizePublishStringList(value)
    article.tags = next
    syncTopicsToContent(prev, next)
  },
})
const topicsText = computed({
  get: () => normalizePublishStringList(article.topics).join(', '),
  set: value => {
    const prev = normalizePublishStringList(article.topics)
    const next = normalizePublishStringList(value)
    article.topics = next
    syncTopicsToContent(prev, next)
  },
})
const mentionsText = computed({
  get: () => normalizePublishMentions(article.mentions).map(item => item.text).join(', '),
  set: value => { article.mentions = normalizePublishMentions(value) },
})

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
  const raw = file?.raw || file
  const path = await resolveUploadFilePath(file)
  const prevPath = article.video_path
  const kind = classifyVideoSelection({ prevPath, nextPath: path, sizeBytes: raw?.size })
  if (kind === 'oversize') {
    // 500MB 超限：选前拦截，不覆盖旧选择，toast 带实际大小（此前只在发布时才失败）
    notifyWarning('publishPage.videoTooLarge', { params: { size: formatBytes(raw?.size) } })
    return
  }
  if (!path) {
    article.video_path = ''
    videoFileMeta.value = null
    notifyWarning('story2video.media_path_unresolved', { params: { kindLabel: t('publishPage.videoFile') } })
    return
  }
  const prevName = videoFileMeta.value?.name || ''
  article.video_path = path
  videoFileMeta.value = describeVideoFile({ name: raw?.name || file?.name, path, type: raw?.type || file?.type, size: raw?.size ?? file?.size })
  if (kind === 'first') {
    notifySuccess('publishPage.videoSelectedNamed', { params: { name: videoFileMeta.value.name } })
  } else if (kind === 'replaced') {
    notifySuccess('publishPage.videoReplaced', { params: { name: videoFileMeta.value.name, previous: prevName } })
  } else {
    notifyInfo('publishPage.videoReselectSame', { params: { name: videoFileMeta.value.name } })
  }
}

function handleVideoFileRemove () {
  article.video_path = ''
  videoFileMeta.value = null
}

function handleVideoCardRemove () {
  const upload = videoUploadRef.value
  if (upload && typeof upload.clearFiles === 'function') upload.clearFiles()
  handleVideoFileRemove()
}

function triggerVideoReselect () {
  const upload = videoUploadRef.value
  const root = upload?.$el || upload
  const input = root?.querySelector?.('input[type="file"]')
  if (input) input.click()
}

function handleVideoFileExceed (files) {
  // limit=1 时重选即替换：先清内部列表再走标准 on-change 链（handleStart 会再触发
  // handleVideoFileChange）。不处理时 el-upload 会静默丢弃新文件——正是「选了没反应」的根因。
  const upload = videoUploadRef.value
  if (!upload || !files || !files[0]) return
  if (typeof upload.clearFiles === 'function') upload.clearFiles()
  if (typeof upload.handleStart === 'function') upload.handleStart(files[0])
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
    // 不写 url：el-upload 的 text 形态只用 name，而一个看着像 URL 的本地绝对路径
    // 是陷阱（渲染层 CSP 的 img-src 不含 file:，它永远渲染不出来）。
    coverFileList.value = [{ name: 'video-cover-crop.jpg', path: data.path }]
    notifySuccess('publishPage.coverExtracted')
  }
}

function onCoverCropError (message) {
  notifyWarning('publishPage.coverCrop.cropFailed', { message: message || t('publishPage.coverCrop.cropFailed') })
}

// ─── 封面缩略图与放大预览（01-docs/PRD-PUBLISH-COVER-PREVIEW-2026-09-28.md）───
// 预览挂在 article.cover_path 上，而不是挂在各按钮回调上：封面有五个写入口
// （提取 / AI 生成 / 裁剪 / 手动选择 / 草稿恢复），挂在字段上才不会漏接线。
const {
  dataUrl: coverPreviewUrl,
  error: coverPreviewError,
  loading: coverPreviewLoading,
} = useCoverPreview(() => article.cover_path)
// 开合状态留在本视图；「换封面即收起」与内嵌视图挂起/释放都在 CoverPreviewDialog 内部按 visible 收敛。
const showCoverPreview = ref(false)
// P2-7：批量条目的封面预览复用**同一个**应用级浮层（owner 'publish-cover-preview' 已在
// overlay-view-suspension 登记）。逐条目各建一个模态会新增多个浮层 owner，违反挂起/成对释放合同。
const batchCoverPreview = ref(null)

function openCoverPreview () {
  if (!coverPreviewUrl.value) return
  batchCoverPreview.value = null
  showCoverPreview.value = true
}

function openBatchCoverPreview (payload) {
  if (!payload || !payload.dataUrl) return
  batchCoverPreview.value = payload
  showCoverPreview.value = true
}

function closeCoverPreview () {
  batchCoverPreview.value = null
  showCoverPreview.value = false
}

onBeforeUnmount(releaseAiCoverOverlay)

async function handleExtractVideoCover () {
  if (!article.video_path) return
  try {
    const result = await getApi()?.extractVideoCover?.(article.video_path)
    const coverPath = result?.path || result?.data?.coverPath || ''
    if (coverPath) {
      article.cover_path = coverPath
      article.cover_file = { path: coverPath, name: 'video-cover.jpg' }
      coverFileList.value = [{ name: 'video-cover.jpg', path: coverPath }]
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

// AI 封面浮层是 `position: fixed; inset: 0` 的应用级模态，同样压在原生 WebContentsView
// 之下（z-index 对原生图层无效），必须与放大预览各持一个 owner 挂起/恢复。
const AI_COVER_OVERLAY_OWNER = 'publish-ai-cover-dialog'
let aiCoverOverlayHeld = false

async function suspendAiCoverOverlay () {
  if (aiCoverOverlayHeld) return
  aiCoverOverlayHeld = true
  try {
    await suspendEmbeddedViewsForOverlay(AI_COVER_OVERLAY_OWNER)
  } catch (_) {
    aiCoverOverlayHeld = false
  }
}

async function releaseAiCoverOverlay () {
  if (!aiCoverOverlayHeld) return
  aiCoverOverlayHeld = false
  await releaseEmbeddedViewsForOverlay(AI_COVER_OVERLAY_OWNER)
}

watch(showAiCoverDialog, (open) => {
  if (open) suspendAiCoverOverlay()
  else releaseAiCoverOverlay()
})

async function handleGenerateAiCover () {
  if (aiCoverGenerating.value) return
  const prompt = aiCoverForm.prompt.trim()
  if (prompt.length < 2) {
    notifyWarning('publishPage.aiCoverGenerateFailed', { params: { message: t('publishPage.aiCoverPromptPlaceholder') } })
    return
  }
  aiCoverGenerating.value = true
  try {
    const result = await getApi()?.generateAiCover?.({
      prompt,
      style: aiCoverForm.style,
      ratio: aiCoverForm.ratio,
      // 2026-10-06：标题与正文下传主进程，AI 生图不可用时兜底封面才能与内容相关
      title: article.title,
      content: article.content,
    })
    const coverPath = result?.data?.coverPath || ''
    if (coverPath) {
      article.cover_path = coverPath
      article.cover_file = { path: coverPath, name: 'ai-cover.png' }
      coverFileList.value = [{ name: 'ai-cover.png', path: coverPath }]
      // 兜底封面由本地按内容生成，如实告知用户而非谎报「AI 封面已生成」
      notifySuccess(result?.data?.source === 'local-fallback'
        ? 'publishPage.aiCoverLocalGenerated'
        : 'publishPage.aiCoverGenerated')
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

// 面板显隐记忆：初始值读 localStorage 变更即持久化；不可用时降级默认值。
const initialPanelPrefs = readPanelVisibilityPrefs()
const showTagPanel = ref(initialPanelPrefs.tagSuggester)
const showTitlePanel = ref(initialPanelPrefs.titleAssistant)
watch([showTagPanel, showTitlePanel], ([tagVisible, titleVisible]) => {
  writePanelVisibilityPrefs({ tagSuggester: tagVisible, titleAssistant: titleVisible })
})
const showAiWriter = ref(false)
const showUpgradeModal = ref(false)
const combinedContent = computed(() => article.title + ' ' + article.content)

// 标签建议点击填入：追加进标签输入去重，经追加管道带入描述（多入口统一）。
function applySuggestedTag (tag) {
  if (typeof tag !== 'string' || !tag.trim()) return
  const prev = normalizePublishStringList(article.tags)
  article.tags = normalizePublishStringList([...article.tags, tag.trim()])
  syncTopicsToContent(prev, normalizePublishStringList(article.tags))
}

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
  selectPlatform,
  selectAccount,
} = usePlatformSelection(accountStore, platformStore)

// P2-8b「按组添加」：判据本体在 features/publish/usePublishGroupApply（纯函数、可单测），
// 这里只做 store ↔ 视图的接线；视图不自己数成员、也不拼播报文案。
const { groupPickerItems, applyGroupById } = usePublishGroupTargets({
  accountStore,
  platforms,
  selection: { selectedPlatforms, selectPlatform, selectAccount, isAccountSelected, isAccountAvailable },
  notifyInfo,
  notifyWarning,
})

// ── 字段面判据（P2-7 下沉为共用实现 usePublishFieldSurface，单篇与批量同一份真源）──
// 通用 ≠ 全部支持：每个通用字段显示「N/总平台数 支持」徽标（分母取注册表平台总数，
// 与能力矩阵口径一致）；无标题平台（titleMode=caption）的发布链路会把标题作为描述
// 首行插入，选中任一无标题平台时在标题输入区提示该行为。可见性「好友」档在部分平台
// 无对应值，如实告知哪些平台保持默认。
// 下沉前这些判据内联在本视图、且只认全局 selectedPlatforms，批量条目无从复用。
const fieldSurface = usePublishFieldSurface()
const { fieldSupportText } = fieldSurface
// 定时能力提示：按**当前所选平台**给真实能力（2026-10-07 PR #3033）。
// 不再用 fieldSupportText('schedule')：那个徽标统计的是「发布链路接入了 schedule
// 字段」（15/15），与平台能否真正接下排期无关，属于改造后的语义错位。
const scheduleCapabilityHint = (ids) => fieldSurface.scheduleCapabilityHint(ids)
// 定时 hint（单篇）：按所选平台显示有效排期上限（2026-10-08，头条 7 天）。
// 批量条目在模板里各自调 fieldSurface.hintTextFor(a.platforms)。
const scheduleHintText = computed(() => fieldSurface.hintTextFor(selectedPlatforms.value))
const noTitleHint = computed(() => fieldSurface.noTitleHintFor(selectedPlatforms.value))
const selectedOverridePlatforms = computed(() =>
  fieldSurface.overridePlatformSpecsFor(platforms.value, selectedPlatforms.value))
const visibilitySupportedPlatforms = computed(() =>
  fieldSurface.visibilitySupportedIdsFor(selectedPlatforms.value))
const visibilityUnsupportedHint = computed(() =>
  fieldSurface.visibilityUnsupportedHintFor(selectedPlatforms.value, article.visibilitySemantic))

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

const { copyDetailMeta, showCopyDetailBanner, applyCopyDetailHandoff, syncCopyDetailToLibrary, handleCreateVideo, onSaveDraft } = useCopyDetailMode({ article, activeMode, route, t, notifyInfo, saveDraft, router })

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
// 一键发布成功回写（评审 MAJOR：PRD 承诺「保存草稿或发布成功后回写」）：
// usePublishFlow 的 result.success 置 true 即发布链路完成（单篇/批量共用出口），旁路回写
watch(result, (r) => { if (r && r.success) void syncCopyDetailToLibrary() })

const {
  batchMode,
  batchPublishing,
  articles,
  batchProgress,
  failedBatchTasks,
  retryingFailed,
  scheduledBatchId,
  templateTargetIdx,
  showTemplatePicker,
  batchDone,
  batchFail,
  totalPlatformTasks,
  addArticle,
  removeArticle,
  duplicateArticle,
  handleBatchPublish,
  cancelScheduledBatch,
  retryFailedBatch,
  applyTemplate,
  checkBatchAccess,
  toggleBatchAccount,
  toggleBatchPlatform,
  isBatchAccountSelected,
  setBatchArticleCover,
  setBatchArticleCoverUrl,
  clearBatchArticleCover,
  setBatchArticleVisibility,
  setBatchArticleOverrides,
  seedArticlesFromDrafts,
  applyTargetsToAll,
} = useBatchPublish({ article, licenseStore, isAccountAvailable })

// 话题标签统一（topic-tag-unify）：接线收在 use-topic-tag-bridge（行数门禁拆出）；必须在 useBatchPublish 后（articles 由其产出）。
const {
  showTopicTagManager,
  openTopicTagManager,
  appendHashToDescription,
  appendBatchHash,
  applyTopicTagPreset,
} = useTopicTagBridge({
  article,
  articles,
  syncTopicsToContent,
  setBatchTagsText,
  notifySuccess,
})

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

// 历史视频跳转预填充：query 双重编码（跳转方 encode + vue-router 再 encode），
// 循环解码直到稳定，还原真实路径与文案后写入 article；tags 为逗号分隔字符串。
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
  if (tags) {
    const prev = normalizePublishStringList(article.tags)
    article.tags = normalizePublishStringList(tags)
    // 历史视频跳转携带的标签同样经追加管道带入描述\n    syncTopicsToContent(prev, normalizePublishStringList(article.tags))
  }
  // 历史视频发布走视频首帧封面，不携带自定义封面（百家号 API 不支持）
  article.cover_url = ''
  article.cover_path = ''
  article.cover_file = null
}

// ── 热门选题批量交接（?drafts=id,id,...）──
// 状态机（解析/装载/幂等/预置目标）在 useHotTopicsDraftHandoff；本视图只保留触发点与提示。
const handoff = useHotTopicsDraftHandoff({
  route, drafts, loadDrafts, seedArticlesFromDrafts, applyTargetsToAll, batchMode,
  accountStore, platforms, getAccounts, getDefaultAccount, loadAccounts, notifySuccess, notifyWarning,
})
const {
  handoffAppliedKey, batchTargetPlatforms, handoffPlatformOptions,
  applyBatchTargetsToAll, applyDraftHandoff, handoffIdsFromQuery, parseHandoffDraftIds,
} = handoff

// 草稿导入 — 从 Collection 页跳转时加载
onMounted(async () => {
  applyCopyDetailHandoff() // 置顶：不依赖前置异步步骤
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
  // 热门选题批量交接优先：这批 id 是「刚改写完的 N 条」，必须整体进批量区；
  // 单篇 ?draft= 只在没有批量交接时生效（两个参数同时出现时以批量为准）。
  const handoffIds = handoffIdsFromQuery()
  if (handoffIds.length > 0) {
    await applyDraftHandoff(handoffIds)
    return
  }
  const draftId = route.query.draft
  if (!draftId) return

  await loadDrafts()
  await loadDraft(String(draftId))
})

// keep-alive 兼容：发布页被 App.vue 的 <keep-alive :include="['Publish']"> 缓存后，
// 从结果页/历史「去发布」带 ?video_path= 再次进入时 onMounted 不会再跑，预填必须挂在
// onActivated（每次激活都触发）上，否则 query 预填静默失效。无 video_path query 时
// applyHistoryVideoQuery 自行早退，不会覆盖用户缓存中的既有草稿。
// 非 keep-alive 上下文（内嵌主页实例）onActivated 不触发，仍由上面的 onMounted 覆盖。
onActivated(() => {
  applyHistoryVideoQuery()
  applyCopyDetailHandoff()
  // keep-alive 下 onMounted 不会再跑：热门选题交接必须挂在每次激活上。
  // applyDraftHandoff 自带「同一批 id 只装载一次」的幂等键，重复激活不会重置用户编辑。
  const handoffIds = handoffIdsFromQuery()
  if (handoffIds.length > 0) applyDraftHandoff(handoffIds)
})

// 暴露给测试（w.vm.xxx）和外部组件
defineExpose({
  onSaveDraft,
  applyCopyDetailHandoff,
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
  applySuggestedTag,
  setBatchTagsText,
  openTopicTagManager,
  applyTopicTagPreset,
  appendHashToDescription,
  appendBatchHash,
  showTopicTagManager,
  handleImageFileChange,
  handleImageFileRemove,
  handleVideoFileChange,
  handleVideoFileRemove,
  handleVideoFileExceed,
  videoUploadRef,
  videoFileMeta,
  videoUploadFileList,
  triggerVideoReselect,
  handleVideoCardRemove,
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
  // 热门选题批量交接（hot-topics-publish-handoff）暴露面
  handoffAppliedKey, batchTargetPlatforms, handoffPlatformOptions, applyBatchTargetsToAll,
  applyDraftHandoff, parseHandoffDraftIds,
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
/* 通用字段支持度徽标 + 无标题平台标题提示（publish-capability-registry） */
.field-support-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 8px; font-size: var(--font-size-xs, 11px); color: var(--action-blue, #1890ff); background: color-mix(in srgb, var(--action-blue, #1890ff) 10%, transparent); vertical-align: middle; }
.no-title-hint { margin: 6px 0 0; font-size: var(--font-size-xs); color: var(--muted); }
.stack-gap { margin-bottom: var(--space-md); }
.stack-gap-top { margin-top: 12px; }
.stack-center { text-align: center; }
/* 话题标签统一（topic-tag-unify）：#添加话题 / 常用话题标签按钮行，贴邻话题标签输入框 */
.topic-tag-actions { display: flex; gap: var(--space-sm); margin-top: var(--spacing-2); flex-wrap: wrap; }
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
/* 已选视频后上传区转为成功态边框，与下方 SelectedVideoCard 形成完整反馈（此前选前选后零视觉差异） */
.video-upload-zone.has-selected-video :deep(.el-upload-dragger) { border-color: var(--success, #67c23a); border-style: solid; background: rgba(103, 194, 58, 0.04); }
.video-upload-zone.has-selected-video :deep(.el-icon--upload) { color: var(--success, #67c23a); }
.video-upload-zone :deep(.el-icon--upload) { font-size: 48px; color: var(--muted, #909399); margin-bottom: 8px; }
.video-cover-row { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.publish-drafts-page {
  min-height: 100%;
  padding: 24px;
  background: var(--canvas, var(--color-bg-inset));
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
