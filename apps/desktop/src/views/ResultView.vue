<template>
  <div class="result-page">
    <div class="page-header">
      <button class="back-to-list" data-testid="back-to-pipeline-list" @click="goBackToHistory">
        ← {{ tOrKey('create.story2video.backToHistory') }}
      </button>
      <div>
        <h1>视频预览</h1>
        <p v-if="taskTitle" class="page-subtitle" data-testid="result-task-title">{{ taskTitle }}</p>
        <p v-if="projectId" class="page-meta">{{ tOrKey('create.history.projectId') }}: {{ projectId }}</p>
      </div>
      <div class="result-header-status">
        <span v-if="project?.dirty" class="status-badge">有未合成修改</span>
        <span v-if="pipelineRunStatus" class="status-badge pipeline-run-status" data-testid="result-pipeline-status">{{ pipelineRunStatusLabel }}</span>
        <UiButton
          v-if="pipelineRunId && pipelineRunStatus === 'running'"
          size="sm"
          variant="secondary"
          data-testid="result-pause-pipeline"
          :disabled="pipelineRunActionBusy"
          @click="pausePipelineRun"
        >⏸ {{ tOrKey('create.story2video.pause') }}</UiButton>
      </div>
    </div>

    <!-- BGM 被跳过提示（由 CreateView 完成态透传 query.bgmSkipped/bgmReason） -->
    <div v-if="bgmSkippedNotice" class="bgm-skipped-notice" role="alert" data-testid="story2video-result-bgm-skipped-notice">
      🎵 {{ bgmSkippedNotice }}
    </div>

    <div v-if="loading" class="loading-state" data-testid="result-view-loading">
      <UiSkeleton variant="paragraph" :rows="4" />
    </div>

    <div v-else-if="!videoPath && !hasEditableContent" class="empty-state">
      <p>没有可预览的视频</p>
      <UiButton @click="$router.push('/create')">去创作</UiButton>
    </div>

    <div v-if="videoPath" class="video-section">
      <video
        ref="videoPlayer"
        :src="videoSrc"
        controls
        class="video-player"
        @loadedmetadata="handleVideoMetadata"
        @timeupdate="handleTrimPreviewProgress"
        @error="handleError"
      ></video>

      <div class="video-info">
        <p v-if="completionSummary" class="completion-summary" data-testid="completion-summary">{{ completionSummary }}</p>
        <p>格式: {{ formatLabel }}</p>
        <p class="path-text">位置: {{ videoPath }}</p>
      </div>

      <div class="actions">
        <UiButton @click="download">下载视频</UiButton>
        <UiButton variant="secondary" @click="viewScript">{{ tOrKey('story2video.view_script') }}</UiButton>
        <UiButton variant="secondary" @click="exportZip">导出 ZIP</UiButton>
        <UiButton variant="secondary" @click="copyLocalPath">复制路径</UiButton>
        <UiButton variant="secondary" @click="showInFolder">打开文件夹</UiButton>
        <UiButton variant="secondary" @click="goPublish">去发布</UiButton>
        <UiButton variant="ghost" @click="$router.push('/create')">重新创作</UiButton>
      </div>
    </div>

    <section v-if="videoPath" class="project-section trim-section">
      <div class="section-heading">
        <div>
          <h2>视频裁剪</h2>
          <p>导出一个新的 MP4 片段，不覆盖原视频</p>
        </div>
      </div>
      <div v-if="videoDuration" class="trim-range-panel">
        <div class="trim-range-values" aria-live="polite">
          <span>{{ formatTrimTime(trimStart) }}</span>
          <span>{{ formatTrimTime(trimEnd) }}</span>
        </div>
        <label class="trim-range-control">
          <span>开始</span>
          <input
            data-testid="trim-start-range"
            aria-label="裁剪开始时间"
            type="range"
            min="0"
            :max="trimMax"
            step="0.1"
            :value="trimStart"
            @input="setTrimBoundary('start', $event.target.value)"
          />
        </label>
        <label class="trim-range-control">
          <span>结束</span>
          <input
            data-testid="trim-end-range"
            aria-label="裁剪结束时间"
            type="range"
            min="0.1"
            :max="trimMax"
            step="0.1"
            :value="trimEnd"
            @input="setTrimBoundary('end', $event.target.value)"
          />
        </label>
      </div>
      <div class="trim-controls">
        <label>
          开始时间（秒）
          <input
            :value="trimStart"
            type="number"
            min="0"
            :max="trimEnd || videoDuration || undefined"
            step="0.1"
            @change="setTrimBoundary('start', $event.target.value)"
          />
        </label>
        <label>
          结束时间（秒）
          <input
            :value="trimEnd"
            type="number"
            :min="Number(trimStart || 0) + 0.1"
            :max="videoDuration || undefined"
            step="0.1"
            @change="setTrimBoundary('end', $event.target.value)"
          />
        </label>
        <UiButton variant="secondary" :disabled="!canTrim" @click="previewTrimRange">预览区间</UiButton>
        <UiButton :disabled="trimming || !canTrim" @click="trimVideo">
          {{ trimming ? '裁剪中...' : '导出片段' }}
        </UiButton>
      </div>
      <progress v-if="trimming" class="trim-progress" aria-label="视频裁剪进度"></progress>
      <p v-if="videoDuration" class="trim-duration">视频时长：{{ videoDuration.toFixed(1) }} 秒</p>
      <div v-if="trimmedPath" class="trim-result">
        <video :src="trimmedSrc" controls class="trimmed-player"></video>
        <div class="section-actions">
          <UiButton size="sm" variant="secondary" @click="downloadTrimmed">下载裁剪片段</UiButton>
          <UiButton size="sm" variant="ghost" @click="showTrimmedInFolder">打开所在文件夹</UiButton>
        </div>
      </div>
    </section>

    <section v-if="projectId" class="project-section narration-section">
      <div class="section-heading">
        <div>
          <h2>完整旁白</h2>
          <p>由全部分段音频按顺序合并</p>
        </div>
        <UiButton size="sm" variant="secondary" data-testid="download-narration-button" :disabled="!audioPath" @click="downloadNarration">下载旁白</UiButton>
      </div>
      <audio v-if="audioSrc" :src="audioSrc" controls class="audio-player"></audio>
      <div v-else class="asset-placeholder narration-placeholder" data-testid="narration-placeholder">
        {{ tOrKey('story2video.sceneMaterial.emptySlot') }}
      </div>
    </section>

    <!-- 分段快捷定位固定竖条：右侧 sticky，不随页面滚动（2026-08-18 UX 修正） -->
    <aside v-if="projectId && segments.length > 1" class="segment-jump-sidebar">
      <div class="segment-jump-bar" data-testid="segment-jump-bar">
        <span class="segment-jump-label">{{ tOrKey('story2video.sceneMaterial.segmentJumpLabel') }}</span>
        <div class="segment-jump-numbers">
          <button
            v-for="(segment, index) in segments"
            :key="segment.id"
            type="button"
            class="segment-jump-number"
            :class="{ active: index === activeSegmentIndex }"
            :aria-label="$t('story2video.sceneMaterial.segmentJumpAriaLabel', { n: index + 1 })"
            @click="scrollToSegment(index)"
          >{{ index + 1 }}</button>
        </div>
        <div class="segment-jump-nav">
          <UiButton size="sm" variant="ghost" :disabled="activeSegmentIndex <= 0" data-testid="segment-jump-prev" @click="jumpSegmentBy(-1)">{{ tOrKey('story2video.sceneMaterial.segmentJumpPrev') }}</UiButton>
          <UiButton size="sm" variant="ghost" :disabled="activeSegmentIndex >= segments.length - 1" data-testid="segment-jump-next" @click="jumpSegmentBy(1)">{{ tOrKey('story2video.sceneMaterial.segmentJumpNext') }}</UiButton>
        </div>
      </div>
    </aside>

    <section v-if="projectId && segments.length" class="project-section" data-testid="segment-edit-section">
      <div class="section-heading">
        <div>
          <h2>分段编辑</h2>
          <p>
            {{ segments.length }} 个分段 · {{ $t('story2video.sceneMaterial.editRecomposeHint') }}
            <span v-if="segmentsDirty" class="segments-unsaved-chip" data-testid="segments-unsaved-chip">{{ tOrKey('story2video.sceneMaterial.unsavedChanges') }}</span>
          </p>
        </div>
      </div>

      <div class="segment-list">
        <article
          v-for="(segment, index) in segments"
          :key="segment.id"
          class="segment-item"
          :class="{ 'segment-policy-flagged': isPolicyFlagScene(index) }"
          :ref="el => setSegmentItemRef(el, index)"
        >
          <div class="segment-header">
            <strong>{{ tOrKey('story2video.sceneMaterial.segmentTitle', { n: index + 1 }) }}</strong>
            <span class="segment-status" :class="segment.status">{{ segmentStatusLabel(segment.status) }}</span>
            <span v-if="segment.status === 'failed' && segment.error" class="segment-status-reason" data-testid="segment-status-reason">{{ segmentStatusReason(segment) }}</span>
            <span v-if="isPolicyFlagScene(index)" class="segment-policy-flag" data-testid="segment-policy-flag">{{ $t('story2video.sceneMaterial.scenePolicyFlag') }}</span>
            <div class="segment-order">
              <button type="button" :disabled="index === 0" :title="tOrKey('story2video.sceneMaterial.segmentMoveUp')" @click="moveSegment(index, -1)">{{ tOrKey('story2video.sceneMaterial.segmentMoveUp') }}</button>
              <button type="button" :disabled="index === segments.length - 1" :title="tOrKey('story2video.sceneMaterial.segmentMoveDown')" @click="moveSegment(index, 1)">{{ tOrKey('story2video.sceneMaterial.segmentMoveDown') }}</button>
              <button type="button" :disabled="segments.length === 1" :title="tOrKey('story2video.sceneMaterial.segmentDelete')" @click="removeSegment(index)">{{ tOrKey('story2video.sceneMaterial.segmentDelete') }}</button>
            </div>
          </div>

          <div class="segment-thumb" :class="{ 'asset-placeholder': !segment.imageUrl }" data-testid="segment-image-preview">
            <img v-if="segment.imageUrl" :src="segment.imageUrl" :alt="tOrKey('story2video.sceneMaterial.segmentImageAlt', { n: index + 1 })" @error="clearSegmentImageUrl(segment)" />
            <span v-if="!segment.imageUrl">{{ tOrKey('story2video.sceneMaterial.emptySlot') }}</span>
          </div>
          <div class="scene-material-section" data-testid="scene-material-section">
            <div class="scene-material-heading">
              <strong>{{ $t('story2video.sceneMaterial.title') }}</strong>
              <span class="scene-material-hint">{{ $t('story2video.sceneMaterial.previewHint') }}</span>
            </div>
            <div class="scene-material-slots">
              <article
                v-for="slot in sceneMaterialSlots(segment)"
                :key="slot.kind"
                class="scene-material-slot"
                :class="{ selected: slot.selected, empty: !slot.path || !slot.url }"
                :data-testid="'scene-material-slot-' + slot.kind"
                :aria-pressed="slot.selected ? 'true' : 'false'"
                @click.self.prevent="slot.path && selectSceneMaterial(segment.id, slot.kind)"
              >
                <button
                  type="button"
                  class="scene-material-thumb"
                  :disabled="!slot.path || !slot.url"
                  :aria-label="slot.path && slot.url
                    ? $t('story2video.sceneMaterial.previewAriaLabel', { label: slot.label })
                    : $t('story2video.sceneMaterial.emptyAriaLabel', { label: slot.label })"
                  @click.stop="slot.path && slot.url ? previewSceneMaterial(slot) : undefined"
                >
                  <img v-if="!slot.kind.includes('video') && slot.url" :src="slot.url" :alt="slot.label" @error="clearSceneMaterialUrl(segment, slot.kind)" />
                  <video v-else-if="slot.kind.includes('video') && slot.url" :src="slot.url" preload="metadata" muted @error="clearSceneMaterialUrl(segment, slot.kind)"></video>
                  <span v-if="!slot.path || !slot.url" class="scene-material-empty-text">{{ $t('story2video.sceneMaterial.emptySlot') }}</span>
                </button>
                <div class="scene-material-choice">
                  <input
                    :id="'scene-material-radio-' + segment.id + '-' + slot.kind"
                    type="radio"
                    class="scene-material-radio"
                    :name="'scene-material-' + segment.id"
                    :value="slot.kind"
                    :checked="slot.selected"
                    :aria-label="$t('story2video.sceneMaterial.selectAriaLabel', { label: slot.label })"
                    :disabled="isSegmentBusy(segment.id) || !slot.selectable"
                    @change="selectSceneMaterial(segment.id, slot.kind)"
                  />
                  <label :for="'scene-material-radio-' + segment.id + '-' + slot.kind" class="scene-material-label">{{ slot.label }}</label>
                </div>
                <span v-if="slot.selected" class="scene-material-badge">{{ $t('story2video.sceneMaterial.selectedBadge') }}</span>
                <div v-if="slot.kind === 'image1' || slot.kind === 'image2'" class="scene-material-slot-action">
                  <UiButton
                    size="sm"
                    variant="secondary"
                    data-testid="generate-image-button"
                    :disabled="isSegmentBusy(segment.id)"
                    @click.stop="generateSceneImage(segment.id)"
                  >
                    {{ segmentBusyKind(segment.id) === 'genImage' ? $t('story2video.sceneMaterial.generating') : $t('story2video.sceneMaterial.generateImage') }}
                  </UiButton>
                </div>
                <div v-if="slot.kind === 'video1' || slot.kind === 'video2'" class="scene-material-slot-action">
                  <UiButton
                    size="sm"
                    variant="secondary"
                    data-testid="generate-ai-video-button"
                    :disabled="isSegmentBusy(segment.id) || !hasUsableVideoPrompt(segment)"
                    :title="hasUsableVideoPrompt(segment) ? '' : $t('story2video.sceneMaterial.aiVideoNeedsPromptHint')"
                    @click.stop="generateSceneAiVideo(segment.id)"
                  >
                    {{ segmentBusyKind(segment.id) === 'aiVideo' ? $t('story2video.sceneMaterial.generatingAiVideo') : $t('story2video.sceneMaterial.generateAiVideo') }}
                  </UiButton>
                </div>
              </article>
            </div>
          </div>

          <label class="field-label">
            旁白文字
            <textarea v-model="segment.text" rows="3" @input="segmentsDirty = true"></textarea>
          </label>
          <label class="field-label">
            <span>{{ $t('story2video.sceneMaterial.subtitleLabel') }}</span>
            <textarea
              :value="subtitleBlocksText(segment)"
              :placeholder="$t('story2video.sceneMaterial.emptySlot')"
              rows="3"
              data-testid="segment-subtitle-textarea"
              @input="updateSegmentSubtitleBlocks(segment, $event.target.value)"
            ></textarea>
          </label>
          <div class="segment-inline-actions">
            <UiButton size="sm" variant="secondary" data-testid="regenerate-subtitle-button" :disabled="isSegmentBusy(segment.id)" @click="regenerateSceneSubtitle(segment.id)">
              {{ segmentBusyKind(segment.id) === 'subtitle' ? $t('story2video.sceneMaterial.regeneratingSubtitle') : $t('story2video.sceneMaterial.regenerateSubtitle') }}
            </UiButton>
          </div>
          <label class="field-label">
            画面提示词
            <textarea v-model="segment.prompt" rows="3" :placeholder="$t('story2video.sceneMaterial.emptySlot')" @input="segmentsDirty = true"></textarea>
          </label>
          <label class="field-label">
            <span>{{ $t('story2video.sceneMaterial.videoPromptLabel') }}</span>
            <textarea v-model="segment.videoPrompt" rows="3" data-testid="segment-video-prompt-textarea" :placeholder="$t('story2video.sceneMaterial.emptySlot')" @input="segmentsDirty = true"></textarea>
          </label>
          <div class="segment-inline-actions">
            <UiButton size="sm" variant="secondary" data-testid="regenerate-image-prompt-button" :disabled="isSegmentBusy(segment.id)" @click="regenerateScenePrompt(segment.id, 'image')">
              {{ segmentBusyKind(segment.id) === 'promptImage' ? $t('story2video.sceneMaterial.regeneratingPrompt') : $t('story2video.sceneMaterial.regenerateImagePrompt') }}
            </UiButton>
            <UiButton size="sm" variant="secondary" data-testid="regenerate-video-prompt-button" :disabled="isSegmentBusy(segment.id)" @click="regenerateScenePrompt(segment.id, 'video')">
              {{ segmentBusyKind(segment.id) === 'promptVideo' ? $t('story2video.sceneMaterial.regeneratingPrompt') : $t('story2video.sceneMaterial.regenerateVideoPrompt') }}
            </UiButton>
          </div>
          <div class="segment-prompt-translation" data-testid="segment-prompt-translation">
            <span class="segment-prompt-translation-label">{{ promptTranslationLabel }}</span>
            <p class="segment-prompt-translation-text">{{ showPromptTranslation(segment) ? segment.promptTranslation : $t('story2video.sceneMaterial.emptySlot') }}</p>
          </div>

          <div class="segment-voice-settings">
            <span class="segment-voice-title">{{ $t('story2video.sceneMaterial.voiceSettingsLabel') }}</span>
            <div class="segment-voice-grid">
              <label class="field-label">
                <span>{{ $t('story2video.sceneMaterial.voiceIdLabel') }}</span>
                <!-- 音色下拉：数据源为项目语音上下文（voiceProvider/voiceModel）的音色目录；目录不可用时回退文本框（2026-08-17 UX 统一） -->
                <select
                  v-if="segmentVoiceSelectable"
                  v-model="segment.voiceId"
                  data-testid="segment-voice-id-select"
                  @change="segmentsDirty = true"
                >
                  <option value="">{{ $t('story2video.sceneMaterial.voiceIdPlaceholder') }}</option>
                  <option v-for="voice in segmentVoiceOptions" :key="voice.id" :value="voice.id" :disabled="voice.invalid">
                    {{ voice.invalid ? voice.name + $t('story2video.sceneMaterial.voiceInvalidSuffix') : voice.name }}
                  </option>
                  <option v-if="segment.voiceId && !voiceOptionIds.has(segment.voiceId)" :value="segment.voiceId">{{ segment.voiceId }}</option>
                </select>
                <input v-else v-model="segment.voiceId" data-testid="segment-voice-id-input" :placeholder="$t('story2video.sceneMaterial.voiceIdPlaceholder')" @input="segmentsDirty = true" />
                <span v-if="voiceCatalogError" class="field-hint field-hint-warning" data-testid="voice-catalog-error">{{ tOrKey('story2video.sceneMaterial.voiceCatalogUnavailable') }}</span>
              </label>
              <label class="field-label">
                <span>{{ $t('story2video.sceneMaterial.voiceSpeedLabel') }}: {{ segmentVoiceSpeedText(segment) }}x</span>
                <input v-model.number="segment.voiceSpeed" data-testid="segment-voice-speed-range" type="range" min="0.5" max="2" step="0.1" @input="segmentsDirty = true" />
              </label>
              <label class="field-label">
                <span>{{ $t('story2video.sceneMaterial.voicePitchLabel') }}</span>
                <input v-model.number="segment.voicePitch" data-testid="segment-voice-pitch-input" type="number" step="0.1" min="-12" max="12" @input="segmentsDirty = true" />
              </label>
              <label class="field-label">
                <span>{{ $t('story2video.sceneMaterial.voiceEmotionLabel') }}</span>
                <input v-model="segment.voiceEmotion" data-testid="segment-voice-emotion-input" :placeholder="$t('story2video.sceneMaterial.voiceEmotionPlaceholder')" @input="segmentsDirty = true" />
              </label>
            </div>
          <div class="segment-inline-actions">
            <UiButton size="sm" variant="secondary" data-testid="regenerate-audio-button" :disabled="isSegmentBusy(segment.id)" @click="regenerateSceneAudio(segment.id)">
              {{ segmentBusyKind(segment.id) === 'tts' ? $t('story2video.sceneMaterial.generatingVoice') : $t('story2video.sceneMaterial.regenerateVoice') }}
            </UiButton>
          </div>
          <div class="segment-audio-preview" data-testid="segment-audio-preview">
            <audio v-if="segment.audioUrl" :src="segment.audioUrl" controls class="audio-player" @error="clearSegmentAudioUrl(segment)"></audio>
            <span v-else class="asset-placeholder">{{ tOrKey('story2video.sceneMaterial.emptySlot') }}</span>
          </div>
          </div>

          <div class="segment-actions">
            <label class="segment-file-action" :class="{ disabled: isSegmentBusy(segment.id) }">
              替换旁白
              <input
                type="file"
                accept=".wav,.m4a,.mp3,audio/wav,audio/x-m4a,audio/mpeg"
                :disabled="isSegmentBusy(segment.id)"
                @change="replaceSegmentAudio(segment.id, $event)"
              />
            </label>
            <UiButton v-if="segment.imagePath" size="sm" variant="ghost" @click="downloadArtifact(segment.imagePath, segmentName(index, 'image', segment.imagePath))">下载图片</UiButton>
            <UiButton v-if="segment.audioPath" size="sm" variant="ghost" @click="downloadArtifact(segment.audioPath, segmentName(index, 'audio', segment.audioPath))">下载音频</UiButton>
            <UiButton v-if="segment.videoPath" size="sm" variant="ghost" @click="downloadArtifact(segment.videoPath, segmentName(index, 'video', segment.videoPath))">下载视频</UiButton>
          </div>
        </article>
      </div>
    </section>

    <!-- 底部固定操作条（2026-08-17 UX 统一）：保存分段/重新合成/再次合成视频 不随页面滚动 -->
    <div v-if="projectId && segments.length" class="result-action-bar" data-testid="result-action-bar">
      <div class="result-action-bar-status">
        <span v-if="segmentsDirty" class="segments-unsaved-chip">{{ tOrKey('story2video.sceneMaterial.unsavedChanges') }}</span>
        <span v-if="saving || recomposing" class="action-bar-progress">{{ saving ? tOrKey('story2video.sceneMaterial.saving') : tOrKey('story2video.sceneMaterial.recomposing') }}</span>
      </div>
      <div class="result-action-bar-buttons">
        <UiButton :disabled="saving || anySegmentBusy" data-testid="save-segments-button" @click="saveSegments">
          {{ saving ? tOrKey('story2video.sceneMaterial.saving') : tOrKey('story2video.sceneMaterial.saveSegments') }}
        </UiButton>
        <UiButton variant="secondary" :disabled="recomposing || anySegmentBusy" data-testid="recompose-button" @click="recomposeProject">
          {{ recomposing ? tOrKey('story2video.sceneMaterial.recomposing') : tOrKey('story2video.sceneMaterial.recompose') }}
        </UiButton>
        <UiButton variant="secondary" :disabled="recomposing || anySegmentBusy" data-testid="recompose-final-button" :title="$t('story2video.sceneMaterial.recomposeFinalHint')" @click="recomposeProject">
          {{ recomposing ? $t('story2video.sceneMaterial.recomposingFinal') : $t('story2video.sceneMaterial.recomposeFinal') }}
        </UiButton>
      </div>
    </div>

  </div>

  <UiModal :visible="unsavedLeaveDialog.visible" :title="tOrKey('story2video.sceneMaterial.unsavedLeaveTitle')" size="sm" @close="cancelUnsavedLeave">
    <p class="story2video-error-dialog-message" data-testid="unsaved-leave-message">{{ tOrKey('story2video.sceneMaterial.unsavedLeaveMessage') }}</p>
    <template #footer>
      <UiButton data-testid="unsaved-leave-save" :disabled="saving" @click="saveAndLeave">{{ tOrKey('story2video.sceneMaterial.saveAndLeave') }}</UiButton>
      <UiButton variant="ghost" data-testid="unsaved-leave-discard" :disabled="saving" @click="discardAndLeave">{{ tOrKey('story2video.sceneMaterial.discardAndLeave') }}</UiButton>
      <UiButton variant="secondary" data-testid="unsaved-leave-cancel" :disabled="saving" @click="cancelUnsavedLeave">{{ tOrKey('story2video.sceneMaterial.cancel') }}</UiButton>
    </template>
  </UiModal>

  <UiModal :visible="story2videoNotificationDialog.visible" :title="story2videoNotificationDialogUiText.dialogTitle" size="sm" @close="closeStory2VideoNotificationDialog">
    <p class="story2video-error-dialog-message">{{ story2videoNotificationDialogMessage }}</p>
    <template #footer>
      <UiButton @click="closeStory2VideoNotificationDialog">{{ story2videoNotificationDialogUiText.acknowledge }}</UiButton>
    </template>
  </UiModal>

  <UiModal :visible="sceneMaterialPreview.visible" :title="sceneMaterialPreview.title" size="xl" @close="closeSceneMaterialPreview">
    <div class="scene-material-preview-body">
      <img v-if="!sceneMaterialPreview.kind.includes('video') && sceneMaterialPreview.url" :src="sceneMaterialPreview.url" :alt="sceneMaterialPreview.label" />
      <video v-else-if="sceneMaterialPreview.kind.includes('video') && sceneMaterialPreview.url" :src="sceneMaterialPreview.url" controls autoplay @error="closeSceneMaterialPreview"></video>
      <p v-if="!sceneMaterialPreview.url" class="scene-material-preview-empty">{{ sceneMaterialPreview.label }}</p>
    </div>
  </UiModal>
  <UiModal :visible="scriptModalVisible" :title="tOrKey('story2video.script_modal_title')" size="lg" test-id="script-modal" @close="closeScriptModal">
    <div class="script-modal-body">
      <pre class="script-text" data-testid="script-text">{{ scriptText }}</pre>
    </div>
    <template #footer>
      <UiButton :disabled="!scriptText" data-testid="script-copy-button" @click="copyScript">{{ copyingScript ? tOrKey('story2video.script_copied_button') : tOrKey('story2video.script_copy_button') }}</UiButton>
      <UiButton variant="secondary" @click="closeScriptModal">{{ tOrKey('common.close') }}</UiButton>
    </template>
  </UiModal>

</template>

<script>
import UiButton from '../components/UiButton.vue'
import UiModal from '../components/UiModal.vue'
import { buildPublishFromProject, publishDataToQuery } from '@/features/publish/publish-from-project'
import { getAppLocale } from '@/i18n'
import { STORY2VIDEO_NOTIFICATION_KEYS, formatBgmSkippedNotification, formatStory2VideoNotification, getStory2VideoNotificationUiText, resolveStory2VideoNotification } from '@/story2video/story2video-notifications'
import { getTtsVoiceCatalog } from '@/api/tts-voice-catalog'
import {
  story2videoExportZip,
  story2videoCreateShareUrl,
  story2videoCopyPath,
  story2videoShowInFolder,
  story2videoSaveAs,
  story2videoGetProject,
  story2videoImportMedia,
  story2videoUpdateSegments,
  story2videoReplaceSegmentAudio,
  story2videoRetrySegment,
  story2videoRecomposeProject,
  story2videoSelectSceneMaterial,
  story2videoGenerateSceneImage,
  story2videoGenerateSceneVideo,
  story2videoGenerateSceneAiVideo,
  story2videoRegenerateSceneSubtitle,
  story2videoRegenerateSceneAudio,
  story2videoRegenerateScenePrompt,
  pipelineGetRunContext,
  pipelinePauseRun,
  videoProcess,
} from '@/api/publisher'

export default {
  name: 'ResultView',
  components: { UiButton, UiModal },
  data() {
    return {
      videoPath: null,
      loading: true,
      videoSrc: null,
      videoReloadAttempted: false,
      projectId: null,
      project: null,
      audioPath: null,
      audioSrc: null,
      segments: [],
      unavailableMaterialKinds: {},
      segmentsDirty: false,
      // 未保存修改离开守卫（2026-08-16）：hold-next 模式，弹窗确认前导航保持挂起
      pendingLeaveNext: null,
      unsavedLeaveDialog: { visible: false },
      saving: false,
      recomposing: false,
      segmentBusy: {},
      trimStart: 0,
      trimEnd: null,
      videoDuration: null,
      trimming: false,
      trimPreviewing: false,
      trimmedPath: null,
      trimmedSrc: null,
      story2videoNotificationDialog: { visible: false, messageKey: '', messageParams: {} },
      degradedAssetsWarningProjectId: null,
      sceneMaterialPreview: { visible: false, kind: '', url: '', label: '', title: '' },
      // 分段快捷定位（2026-08-17 UX 统一）
      activeSegmentIndex: -1,
      segmentItemRefs: [],
      // 滚动高亮阈值：分段顶部进入视口上方该距离内视为「当前分段」（2026-09-18）
      segmentScrollThreshold: 120,
      // 音色目录（2026-08-17 UX 统一：音色下拉）
      voiceCatalogLoading: false,
      voiceCatalogError: '',
      voiceCatalogOptions: [],
      pipelineRunId: null,
      pipelineRunStatus: null,
      pipelineRunActionBusy: false,
      scriptModalVisible: false,
      copyingScript: false,
    }
  },
  async mounted() {
    const projectId = this.$route?.query?.project
    const filePath = this.$route?.query?.path
    this.pipelineRunId = this.normalizeRunId(this.$route?.query?.runId)
    // 滚动高亮：监听窗口滚动与尺寸变化，实时更新右侧分段导航当前分段（2026-09-18）
    window.addEventListener('scroll', this.onSegmentScroll, { passive: true })
    window.addEventListener('resize', this.onSegmentScroll)
    const loadTasks = []
    if (projectId) loadTasks.push(this.loadProject(String(projectId)))
    else if (filePath) loadTasks.push(this.loadVideoPath(String(filePath)))
    if (this.pipelineRunId) loadTasks.push(this.loadPipelineRunStatus(this.pipelineRunId))
    try {
      if (loadTasks.length > 0) await Promise.all(loadTasks)
    } finally {
      this.loading = false
    }
  },
  // 未保存修改离开守卫：dirty 时挂起导航并弹确认（hold-next，next 只调用一次），
  // 避免用户直接返回历史记录/流水线启动页时静默丢失编辑（2026-08-16）。
  beforeRouteLeave (to, from, next) {
    if (!this.segmentsDirty) { next(); return }
    this.pendingLeaveNext = next
    this.unsavedLeaveDialog.visible = true
  },
  // 测试/异常兜底：组件被销毁且守卫仍挂起时，取消导航，防止 next 悬挂。
  unmounted () {
    if (typeof this.pendingLeaveNext === 'function') {
      this.pendingLeaveNext(false)
      this.pendingLeaveNext = null
    }
    window.removeEventListener('scroll', this.onSegmentScroll)
    window.removeEventListener('resize', this.onSegmentScroll)
  },
  computed: {
    // 有可编辑内容：projectId + segments 存在即渲染分段编辑区，无成片（failed/paused/未合成）任务也可编辑（2026-08-17）
    hasEditableContent() {
      return Boolean(this.projectId && Array.isArray(this.segments) && this.segments.length)
    },
    // 任务标题回退链：发布标题 → 原文案前 60 字 → 项目 ID（2026-08-17）
    taskTitle() {
      const title = this.project && (this.project.title || this.project.publishTitle)
      if (title) return title
      const firstText = (Array.isArray(this.segments) ? this.segments : []).find(segment => segment && segment.text)?.text
      if (firstText) {
        const text = String(firstText)
        return text.length > 60 ? text.slice(0, 59) + '…' : text
      }
      return this.projectId || ''
    },
    // 项目语音上下文：优先项目选项，其次首个带 voiceProvider/voiceModel 的分段（音色目录查询入参）
    voiceContext() {
      const fromOptions = this.project && this.project.options ? this.project.options : {}
      const first = (Array.isArray(this.segments) ? this.segments : []).find(segment => segment && (segment.voiceProvider || segment.voiceModel))
      return {
        providerId: fromOptions.voiceProvider || (first && first.voiceProvider) || '',
        model: fromOptions.voiceModel || (first && first.voiceModel) || '',
      }
    },
    voiceOptionIds() {
      return new Set((this.voiceCatalogOptions || []).map(voice => voice.id).filter(Boolean))
    },
    segmentVoiceOptions() {
      return Array.isArray(this.voiceCatalogOptions) ? this.voiceCatalogOptions : []
    },
    // 目录可用（上下文完整 + 加载成功且非空）时用下拉；否则回退文本框输入
    segmentVoiceSelectable() {
      return Boolean(this.voiceContext.providerId && this.voiceContext.model && !this.voiceCatalogLoading && this.segmentVoiceOptions.length > 0)
    },
    // 历史记录提示词翻译（2026-08-12）：非 en 界面且分段存在翻译时展示只读文案
    promptTranslationLabel() {
      const locale = getAppLocale()
      return locale === 'zh' ? '中文翻译' : (locale === 'en' ? 'Translation' : '翻译')
    },
    bgmSkippedNotice() {
      const query = this.$route?.query || {}
      if (query.bgmSkipped !== '1') return ''
      return formatBgmSkippedNotification(query.bgmReason).message
    },
    // 内容政策失败任务从历史跳转时携带 focusScenes（1-based 场景号，逗号分隔）：
    // 场景号 = 分段下标 + 1，用于定位需要修改文案的分段；非法/缺省一律为空集合（fail-safe）
    policyFlagSceneNumbers() {
      const raw = String(this.$route?.query?.focusScenes || '')
      const numbers = new Set()
      for (const part of raw.split(',')) {
        const trimmed = String(part).trim()
        const value = Number(trimmed)
        if (Number.isInteger(value) && value > 0 && String(value) === trimmed) numbers.add(value)
      }
      return numbers
    },
    // 任一分段正在生成/重试时禁用全局保存与重新合成，避免与主进程写队列交叉（审查 W2）
    anySegmentBusy() {
      return Object.keys(this.segmentBusy || {}).some(key => Boolean(this.segmentBusy[key]))
    },
    completionSummary() {
      const query = this.$route?.query || {}
      const parts = []
      if (Number.isFinite(Number(query.durationMs)) && Number(query.durationMs) > 0) {
        const total = Math.floor(Number(query.durationMs) / 1000)
        const minutes = Math.floor(total / 60)
        const seconds = total % 60
        parts.push('完成时间共 ' + (minutes > 0 ? minutes + ' 分 ' + seconds + ' 秒' : seconds + ' 秒'))
      }
      if (Number.isFinite(Number(query.sizeBytes)) && Number(query.sizeBytes) > 0) {
        parts.push('文件大小 ' + (Number(query.sizeBytes) / 1048576).toFixed(1) + ' M')
      }
      return parts.join(' · ')
    },
    formatLabel() {
      const extension = String(this.videoPath || '').split('.').pop()
      return extension ? extension.toUpperCase() : '视频'
    },
    canTrim() {
      const start = Number(this.trimStart)
      const end = Number(this.trimEnd)
      const duration = Number(this.videoDuration)
      return Boolean(this.videoPath) && Number.isFinite(start) && start >= 0 && Number.isFinite(end) && end > start &&
        (!Number.isFinite(duration) || duration <= 0 || end <= duration)
    },
    trimMax() {
      const duration = Number(this.videoDuration)
      if (Number.isFinite(duration) && duration > 0) return duration
      const end = Number(this.trimEnd)
      return Number.isFinite(end) && end > 0 ? end : 0.1
    },
    degradedAssetKinds() {
      const kinds = new Set()
      for (const segment of this.segments) {
        if (segment?.imageMeta?.degraded === true) kinds.add('placeholder_image')
        if (segment?.audioMeta?.degraded === true) kinds.add('silent_narration')
      }
      return [...kinds]
    },
    hasDegradedAssets() {
      return this.degradedAssetKinds.length > 0
    },
    story2videoNotificationDialogMessage() {
      return formatStory2VideoNotification({
        messageKey: this.story2videoNotificationDialog.messageKey,
        messageParams: this.story2videoNotificationDialog.messageParams,
      }).message
    },
    story2videoNotificationDialogUiText() {
      return getStory2VideoNotificationUiText()
    },
    pipelineRunStatusLabel() {
      if (!this.pipelineRunStatus) return ''
      return this.tOrKey('create.history.statuses.' + this.pipelineRunStatus)
    },
    // 弹窗与复制共用同一份文本：优先原始文案（分句/分段之前的完整输入）。
    // sourceText 由流水线启动时 params.text 落盘（story2video-project-service.js），
    // 是用户在创作页提交的原文；segments[].text 是分句后的分段，带编号会污染复制内容。
    scriptText() {
      const sourceText = (this.project && typeof this.project.sourceText === 'string')
        ? this.project.sourceText.trim()
        : ''
      if (sourceText) return sourceText
      // 兼容缺失 sourceText 的历史项目（老版本落盘）：回退为分段文字拼接，且不带分段编号。
      if (!Array.isArray(this.segments) || !this.segments.length) return ''
      return this.segments
        .map(segment => (segment && typeof segment.text === 'string') ? segment.text.trim() : '')
        .filter(Boolean)
        .join('\n\n')
    },
  },
  methods: {
    // 去发布：从当前项目提取发布数据并跳转发布页（视频模式预填充）。
    // 有完整项目对象时走 buildPublishFromProject；仅文件路径模式（无 project）时只带视频路径。
    viewScript() {
      this.scriptModalVisible = true
    },
    closeScriptModal() {
      this.scriptModalVisible = false
      this.copyingScript = false
    },
    async copyScript() {
      const text = this.scriptText
      if (!text) return
      this.copyingScript = true
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
        } else {
          const textarea = document.createElement('textarea')
          textarea.value = text
          textarea.style.position = 'fixed'
          textarea.style.opacity = '0'
          document.body.appendChild(textarea)
          textarea.select()
          document.execCommand('copy')
          document.body.removeChild(textarea)
        }
      } catch (_) {
        // fallback already handled
      }
      setTimeout(() => { this.copyingScript = false }, 1500)
    },

    goPublish() {
      const data = this.project ? buildPublishFromProject(this.project) : null
      const videoPath = (data && data.video_path) || (typeof this.videoPath === 'string' ? this.videoPath : '')
      if (!videoPath) return
      const query = data ? publishDataToQuery(data) : { type: 'video', video_path: encodeURIComponent(videoPath) }
      this.$router.push({ path: '/publish', query })
    },
    normalizeRunId(value) {
      if (typeof value !== 'string') return ''
      const normalized = value.trim()
      return normalized && normalized.length <= 256 ? normalized : ''
    },
    async loadPipelineRunStatus(runId = this.pipelineRunId) {
      const normalizedRunId = this.normalizeRunId(runId)
      if (!normalizedRunId) return false
      try {
        const result = await pipelineGetRunContext(normalizedRunId)
        if (this.pipelineRunId !== normalizedRunId) return false
        if (result?.code !== 0 || !result.data) {
          this.pipelineRunStatus = null
          return false
        }
        const status = result.data.status && typeof result.data.status === 'object'
          ? result.data.status.status
          : result.data.status
        this.pipelineRunStatus = typeof status === 'string' && status.trim() ? status.trim() : null
        return Boolean(this.pipelineRunStatus)
      } catch (_) {
        if (this.pipelineRunId === normalizedRunId) this.pipelineRunStatus = null
        return false
      }
    },
    async pausePipelineRun() {
      if (!this.pipelineRunId || this.pipelineRunStatus !== 'running' || this.pipelineRunActionBusy) return false
      this.pipelineRunActionBusy = true
      try {
        const result = await pipelinePauseRun(this.pipelineRunId)
        if (result?.code !== 0) {
          this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.OPERATION_FAILED, error: result?.message })
          return false
        }
        await this.loadPipelineRunStatus(this.pipelineRunId)
        return this.pipelineRunStatus === 'paused'
      } catch (error) {
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.OPERATION_FAILED, error: error?.message })
        return false
      } finally {
        this.pipelineRunActionBusy = false
      }
    },
    // 返回历史记录（2026-08-17 术语统一：视频任务编辑页返回 → 历史记录标签）
    goBackToHistory() {
      this.$router.push({ path: '/create', query: { view: 'history' } })
    },
    // 分段快捷定位（2026-08-17 UX 统一）：分段卡片 ref 收集 + 数字跳转 + 上一条/下一条
    setSegmentItemRef(el, index) {
      if (el) this.segmentItemRefs[index] = el
    },
    // 滚动高亮：根据各分段卡片顶部相对视口的位置，更新右侧导航当前分段（2026-09-18）
    onSegmentScroll() {
      const refs = Array.isArray(this.segmentItemRefs) ? this.segmentItemRefs : []
      if (!refs.length || !Array.isArray(this.segments) || !this.segments.length) return
      const threshold = Number(this.segmentScrollThreshold) >= 0 ? Number(this.segmentScrollThreshold) : 120
      let current = -1
      let bestTop = -Infinity
      const bound = Math.min(refs.length, this.segments.length)
      for (let i = 0; i < bound; i++) {
        const el = refs[i]
        if (!el || typeof el.getBoundingClientRect !== 'function') continue
        const rect = el.getBoundingClientRect()
        // 分段顶部进入视口上方阈值区域 → 候选当前分段；取顶部最接近视口顶部的那个（top 最大）
        if (rect && typeof rect.top === 'number' && rect.top <= threshold && rect.top > bestTop) {
          bestTop = rect.top
          current = i
        }
      }
      if (current >= 0) this.activeSegmentIndex = current
    },
    scrollToSegment(index) {
      if (!Number.isInteger(index) || index < 0 || index >= this.segments.length) return
      this.activeSegmentIndex = index
      this.$nextTick(() => {
        const el = Array.isArray(this.segmentItemRefs) ? this.segmentItemRefs[index] : null
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      })
    },
    jumpSegmentBy(offset) {
      const base = this.activeSegmentIndex >= 0 ? this.activeSegmentIndex : 0
      const target = base + Number(offset)
      this.scrollToSegment(target)
    },
    segmentVoiceSpeedText(segment) {
      const speed = Number(segment && segment.voiceSpeed)
      return Number.isFinite(speed) && speed > 0 ? speed.toFixed(1) : '1.0'
    },
    // 音色目录加载：项目语音上下文缺失或目录不可用时保持空目录，UI 自动回退文本框（2026-08-17）
    async loadVoiceCatalog() {
      const { providerId, model } = this.voiceContext
      if (!providerId || !model) {
        this.voiceCatalogOptions = []
        this.voiceCatalogError = ''
        return
      }
      this.voiceCatalogLoading = true
      try {
        const result = await getTtsVoiceCatalog({ providerId, model })
        const data = result && result.code === 0 && result.data && typeof result.data === 'object' ? result.data : null
        if (!data) {
          this.voiceCatalogOptions = []
          this.voiceCatalogError = String((result && result.message) || 'voice catalog unavailable')
          return
        }
        const normalize = voice => {
          if (!voice || typeof voice !== 'object') return null
          const id = String(voice.id || voice.voiceId || voice.voice_id || '').trim()
          if (!id) return null
          return { id, name: String(voice.name || voice.displayName || voice.display_name || id), invalid: voice.invalid === true }
        }
        this.voiceCatalogOptions = [
          ...(Array.isArray(data.voices) ? data.voices.map(normalize).filter(Boolean) : []),
          ...(Array.isArray(data.invalidVoices) ? data.invalidVoices.map(normalize).filter(Boolean) : []),
        ]
        this.voiceCatalogError = ''
      } catch (_error) {
        this.voiceCatalogOptions = []
        this.voiceCatalogError = 'voice catalog load failed'
      } finally {
        this.voiceCatalogLoading = false
      }
    },
    // 防御式翻译：无 i18n 上下文（如部分单测 mount）时回落 key，生产环境正常返回本地化文案
    tOrKey(key, params) {
      return typeof this.$t === 'function' ? this.$t(key, params) : key
    },
    segmentStatusLabel(status) {
      const key = ['completed', 'failed', 'processing', 'pending'].includes(status) ? status : 'completed'
      return this.tOrKey(`story2video.segmentStatus.${key}`)
    },
    segmentStatusReason(segment) {
      if (!segment || segment.status !== 'failed') return ''
      const raw = String(segment.error || '').trim()
      if (!raw) return ''
      // 复用通知归一化：命中失败类别返回可读原因，未命中回退通用失败文案（不暴露内部错误文本）
      const resolved = resolveStory2VideoNotification({ error: raw })
      return this.truncateStory2VideoText(resolved.message, 120)
    },
    truncateStory2VideoText(value, max) {
      const points = Array.from(String(value || ''))
      return points.length > max ? points.slice(0, max - 1).join('') + '…' : points.join('')
    },
    showStory2VideoNotification(notification = {}) {
      const resolved = resolveStory2VideoNotification(notification)
      this.story2videoNotificationDialog = { visible: true, messageKey: resolved.key, messageParams: resolved.params }
    },
    closeStory2VideoNotificationDialog() {
      this.story2videoNotificationDialog.visible = false
    },
    showStory2VideoOperationFailure() {
      this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.OPERATION_FAILED })
    },
    maybeShowDegradedAssetsWarning() {
      if (!this.projectId || !this.hasDegradedAssets || this.degradedAssetsWarningProjectId === this.projectId) return
      this.degradedAssetsWarningProjectId = this.projectId
      this.showStory2VideoNotification({
        messageKey: STORY2VIDEO_NOTIFICATION_KEYS.DEGRADED_ASSETS_WARNING,
        messageParams: { assetKinds: this.degradedAssetKinds },
      })
    },
    showPromptTranslation(segment) {
      if (getAppLocale() === 'en') return false
      const translation = segment && segment.promptTranslation
      return typeof translation === 'string' && translation.trim() !== ''
    },
    async resolveLocalUrl(filePath, previousUrl) {
      if (!filePath) return null
      const result = await story2videoCreateShareUrl(filePath, previousUrl)
      const url = result?.code === 0 ? (result.data?.url || result.data) : null
      if (!url) throw new Error(result?.message || '无法读取本地文件')
      return url
    },
    materialKey(segment, kind) {
      return String(segment?.id || '') + ':' + String(kind || '')
    },
    isMaterialUnavailable(segment, kind) {
      return Boolean(this.unavailableMaterialKinds[this.materialKey(segment, kind)])
    },
    markMaterialUnavailable(segment, kind) {
      if (!segment || !kind) return
      this.unavailableMaterialKinds = {
        ...this.unavailableMaterialKinds,
        [this.materialKey(segment, kind)]: true,
      }
    },
    clearMaterialUnavailable(segment, kind) {
      if (!segment || !kind) return
      const key = this.materialKey(segment, kind)
      if (!this.unavailableMaterialKinds[key]) return
      const next = { ...this.unavailableMaterialKinds }
      delete next[key]
      this.unavailableMaterialKinds = next
    },
    clearSegmentImageUrl(segment) {
      if (!segment) return
      segment.imageUrl = null
      this.markMaterialUnavailable(segment, 'image1')
    },
    clearSegmentAudioUrl(segment) {
      if (segment) segment.audioUrl = null
    },
    clearSceneMaterialUrl(segment, kind) {
      if (!segment) return
      // A failed share URL must invalidate the renderer-side slot; keep the
      // persisted source path so regeneration and later URL refresh can recover it.
      if (kind === 'image1') {
        segment.imageUrl = null
        this.markMaterialUnavailable(segment, kind)
      } else if (kind === 'image2') {
        segment.alternateImageUrls = []
        this.markMaterialUnavailable(segment, kind)
      } else if (kind === 'video1') {
        segment.videoUrl = null
        this.markMaterialUnavailable(segment, kind)
      } else if (kind === 'video2') {
        segment.altVideoUrl = null
        this.markMaterialUnavailable(segment, kind)
      }
    },
    async refreshSegmentImageUrls() {
      await Promise.all((this.segments || []).map(async (segment) => {
        if (!segment) return
        if (!segment.imagePath) {
          segment.imageUrl = null
          this.markMaterialUnavailable(segment, 'image1')
        }
        try {
          if (segment.imagePath) {
            segment.imageUrl = await this.resolveLocalUrl(segment.imagePath, segment.imageUrl)
            this.clearMaterialUnavailable(segment, 'image1')
          }
        } catch (_) {
          segment.imageUrl = null
          this.markMaterialUnavailable(segment, 'image1')
        }
      }))
      await this.refreshSceneMaterialUrls()
    },
    async refreshSceneMaterialUrls() {
      await Promise.all((this.segments || []).map(async (segment) => {
        if (!segment) return
        const alternate = Array.isArray(segment.alternateImages) ? segment.alternateImages[0] : null
        if (alternate && alternate.path) {
          try {
            segment.alternateImageUrls = [await this.resolveLocalUrl(alternate.path, Array.isArray(segment.alternateImageUrls) ? segment.alternateImageUrls[0] : null)]
            this.clearMaterialUnavailable(segment, 'image2')
          } catch (_) {
            segment.alternateImageUrls = []
            this.markMaterialUnavailable(segment, 'image2')
          }
        } else {
          segment.alternateImageUrls = []
          this.markMaterialUnavailable(segment, 'image2')
        }
        // 优先显示场景独立生成的 AI 视频片段，而非合成后的成片视频（2026-08-18）
        const sceneVideoPath = (segment.videoMeta && segment.videoMeta.sceneVideoPath) || null
        const altSceneVideoPath = (segment.videoMeta && segment.videoMeta.altSceneVideoPath) || segment.altVideoPath || null
        if (sceneVideoPath) {
          try {
            segment.videoUrl = await this.resolveLocalUrl(sceneVideoPath, segment.videoUrl)
            this.clearMaterialUnavailable(segment, 'video1')
          } catch (_) {
            segment.videoUrl = null
            this.markMaterialUnavailable(segment, 'video1')
          }
        } else {
          // Older projects stored the primary scene video in videoPath.
          const legacyVideoPath = typeof segment.videoPath === 'string' && segment.videoPath.trim() ? segment.videoPath : null
          if (legacyVideoPath) {
            try {
              segment.videoUrl = await this.resolveLocalUrl(legacyVideoPath, segment.videoUrl)
              this.clearMaterialUnavailable(segment, 'video1')
            } catch (_) {
              segment.videoUrl = null
              this.markMaterialUnavailable(segment, 'video1')
            }
          } else {
            segment.videoUrl = null
            this.markMaterialUnavailable(segment, 'video1')
          }
        }
        if (altSceneVideoPath) {
          try {
            segment.altVideoUrl = await this.resolveLocalUrl(altSceneVideoPath, segment.altVideoUrl)
            this.clearMaterialUnavailable(segment, 'video2')
          } catch (_) {
            segment.altVideoUrl = null
            this.markMaterialUnavailable(segment, 'video2')
          }
        } else {
          segment.altVideoUrl = null
          this.markMaterialUnavailable(segment, 'video2')
        }
        if (segment.audioPath) {
          try {
            segment.audioUrl = await this.resolveLocalUrl(segment.audioPath, segment.audioUrl)
          } catch (_) {
            segment.audioUrl = null
          }
        } else {
          segment.audioUrl = null
        }
      }))
    },
    effectiveSelectedMaterial(segment) {
      const selected = segment && segment.selectedMaterial
      return ['image1', 'image2', 'video'].includes(selected) ? selected : null
    },
    sceneMaterialSlots(segment) {
      const t = (key, params) => this.$t('story2video.sceneMaterial.' + key, params)
      const selected = this.effectiveSelectedMaterial(segment)
      const alternate = Array.isArray(segment.alternateImages) ? segment.alternateImages[0] : null
      const image1Path = this.isMaterialUnavailable(segment, 'image1') ? null : (segment.imagePath || null)
      const image2Path = this.isMaterialUnavailable(segment, 'image2') ? null : ((alternate && alternate.path) || null)
      const sceneVideoPath = this.isMaterialUnavailable(segment, 'video1')
        ? null
        : ((segment.videoMeta && segment.videoMeta.sceneVideoPath) || segment.videoPath || null)
      const altSceneVideoPath = this.isMaterialUnavailable(segment, 'video2')
        ? null
        : ((segment.videoMeta && segment.videoMeta.altSceneVideoPath) || segment.altVideoPath || null)
      const videoSelected = selected === 'video'
      return [
        { kind: 'image1', label: t('image1Label'), path: image1Path, url: image1Path ? (segment.imageUrl || null) : null, selectable: Boolean(image1Path), selected: selected === 'image1' && Boolean(image1Path) },
        { kind: 'image2', label: t('image2Label'), path: image2Path, url: image2Path ? ((Array.isArray(segment.alternateImageUrls) && segment.alternateImageUrls[0]) || null) : null, selectable: Boolean(image2Path), selected: selected === 'image2' && Boolean(image2Path) },
        { kind: 'video1', label: t('video1Label'), path: sceneVideoPath, url: sceneVideoPath ? (segment.videoUrl || null) : null, selectable: Boolean(segment.videoPath && sceneVideoPath), selected: videoSelected && Boolean(segment.videoPath && sceneVideoPath) },
        // The service persists one canonical video identity. video2 is a visual alias
        // for an optional alternate display path and must not duplicate the badge.
        { kind: 'video2', label: t('video2Label'), path: altSceneVideoPath, url: altSceneVideoPath ? (segment.altVideoUrl || null) : null, selectable: Boolean(segment.videoPath && altSceneVideoPath), selected: false },
      ]
    },
    previewSceneMaterial(slot) {
      this.sceneMaterialPreview = {
        visible: true,
        kind: slot.kind,
        url: slot.url,
        label: slot.label,
        title: slot.kind.includes('video')
          ? this.$t('story2video.sceneMaterial.previewVideoTitle')
          : this.$t('story2video.sceneMaterial.previewImageTitle'),
      }
    },
    closeSceneMaterialPreview() {
      this.sceneMaterialPreview.visible = false
    },
    async selectSceneMaterial(segmentId, kind) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      if (!['image1', 'image2', 'video1', 'video2'].includes(kind)) return
      const segment = (this.segments || []).find(item => item && item.id === segmentId)
      const slot = segment ? this.sceneMaterialSlots(segment).find(item => item.kind === kind) : null
      if (!slot || !slot.selectable) return
      const persistedKind = kind.includes('video') ? 'video' : kind
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'select' }
      try {
        const result = await story2videoSelectSceneMaterial(this.projectId, segmentId, persistedKind)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'material selection failed')
        this.project = result.data
        if (Array.isArray(result.data.segments) && result.data.segments.length) {
          this.segments = result.data.segments.map(item => ({ ...item }))
        }
        this.segmentsDirty = true
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MATERIAL_SELECTED })
      } catch (error) {
        this.showStory2VideoNotification({ error: error && error.message ? error.message : 'material select failed' })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async generateSceneAiVideo(segmentId) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      const segment = (this.segments || []).find(item => item && item.id === segmentId)
      if (!this.hasUsableVideoPrompt(segment)) return
      // 重新生成前先落盘本地编辑：避免基于旧优化词生成，也防止服务端响应覆盖未保存修改（与 W3 语义一致）
      if (this.segmentsDirty && !(await this.saveSegments())) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'aiVideo' }
      try {
        const result = await story2videoGenerateSceneAiVideo(this.projectId, segmentId)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'AI video generation failed')
        this.project = result.data
        this.segments = Array.isArray(result.data.segments)
          ? result.data.segments.map(item => ({ ...item }))
          : this.segments
        this.segmentsDirty = true
        // 服务端返回的分段不含素材 URL，重新解析本地媒体 URL 避免素材区空白
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AI_VIDEO_GENERATED })
      } catch (error) {
        this.showStory2VideoNotification({
          messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AI_VIDEO_GENERATE_FAILED,
          error: error && error.message ? error.message : '',
        })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async generateSceneImage(segmentId) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'genImage' }
      try {
        const result = await story2videoGenerateSceneImage(this.projectId, segmentId)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'image generation failed')
        this.project = result.data
        if (Array.isArray(result.data.segments) && result.data.segments.length) {
          this.segments = result.data.segments.map(item => ({ ...item }))
        }
        this.segmentsDirty = true
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_IMAGE_GENERATED })
      } catch (error) {
        await this.refreshSegmentImageUrls().catch(() => {})
        this.showStory2VideoNotification({ error: error && error.message ? error.message : 'image generation failed' })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async generateSceneVideo(segmentId) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'genVideo' }
      try {
        const result = await story2videoGenerateSceneVideo(this.projectId, segmentId)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'video generation failed')
        this.project = result.data
        if (Array.isArray(result.data.segments) && result.data.segments.length) {
          this.segments = result.data.segments.map(item => ({ ...item }))
        }
        this.segmentsDirty = true
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_VIDEO_GENERATED })
      } catch (error) {
        await this.refreshSegmentImageUrls().catch(() => {})
        this.showStory2VideoNotification({ error: error && error.message ? error.message : 'video generation failed' })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    subtitleBlocksText(segment) {
      if (!segment) return ''
      // blocks 显式存在（含空数组=用户清空）时直接展示，避免清空后回退旧 timeline（审查 I1）
      if (Array.isArray(segment.subtitleBlocks)) {
        return segment.subtitleBlocks.join('\n')
      }
      if (Array.isArray(segment.subtitleTimeline) && segment.subtitleTimeline.length) {
        return segment.subtitleTimeline
          .map(item => (item && typeof item === 'object' ? item.text : item))
          .filter(Boolean)
          .join('\n')
      }
      return ''
    },
    updateSegmentSubtitleBlocks(segment, value) {
      if (!segment) return
      const blocks = String(value || '').split('\n').map(line => line.trim()).filter(Boolean)
      segment.subtitleBlocks = blocks
      // 手动编辑后时间轴为派生数据：置空避免合成沿用陈旧时间轴（与 regenerateSceneSubtitle 语义一致，审查 I1）
      segment.subtitleTimeline = []
      this.segmentsDirty = true
    },
    async regenerateSceneSubtitle(segmentId) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      // 重新生成前先落盘本地编辑：避免基于旧文案重切，也防止服务端响应覆盖未保存修改（审查 W3）
      if (this.segmentsDirty && !(await this.saveSegments())) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'subtitle' }
      try {
        const result = await story2videoRegenerateSceneSubtitle(this.projectId, segmentId)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'subtitle regeneration failed')
        this.project = result.data
        this.segments = Array.isArray(result.data.segments)
          ? result.data.segments.map(item => ({ ...item }))
          : this.segments
        this.segmentsDirty = true
        // 服务端返回的分段不含素材 URL，重新解析本地媒体 URL 避免素材区空白
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_SUBTITLE_REGENERATED })
      } catch (error) {
        this.showStory2VideoNotification({
          messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_SUBTITLE_REGENERATE_FAILED,
          error: error && error.message ? error.message : '',
        })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async regenerateSceneAudio(segmentId) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      // 重新生成前先落盘本地编辑（审查 W3）
      if (this.segmentsDirty && !(await this.saveSegments())) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'tts' }
      try {
        const result = await story2videoRegenerateSceneAudio(this.projectId, segmentId)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'audio regeneration failed')
        this.project = result.data
        this.segments = Array.isArray(result.data.segments)
          ? result.data.segments.map(item => ({ ...item }))
          : this.segments
        this.segmentsDirty = true
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AUDIO_REGENERATED })
      } catch (error) {
        this.showStory2VideoNotification({
          error: error && error.message ? error.message : '',
          fallbackKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AUDIO_REGENERATE_FAILED,
        })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async regenerateScenePrompt(segmentId, kind) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      // 重新生成前先落盘本地编辑（审查 W3）
      if (this.segmentsDirty && !(await this.saveSegments())) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: kind === 'video' ? 'promptVideo' : 'promptImage' }
      try {
        const result = await story2videoRegenerateScenePrompt(this.projectId, segmentId, kind)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || 'prompt regeneration failed')
        this.project = result.data
        this.segments = Array.isArray(result.data.segments)
          ? result.data.segments.map(item => ({ ...item }))
          : this.segments
        this.segmentsDirty = true
        // 服务端返回的分段不含素材 URL，重新解析本地媒体 URL 避免素材区空白
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_PROMPT_REGENERATED })
      } catch (error) {
        this.showStory2VideoNotification({
          // 仅作为未知错误的回退；让额度、限流、API Key 等原始错误进入统一归一化。
          fallbackKey: STORY2VIDEO_NOTIFICATION_KEYS.SCENE_PROMPT_REGENERATE_FAILED,
          error: error && error.message ? error.message : '',
        })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async loadVideoPath(filePath) {
      this.loading = true
      this.videoPath = filePath || null
      if (!this.videoPath) {
        this.videoSrc = null
        this.videoReloadAttempted = false
        this.loading = false
        return false
      }
      try {
        this.videoSrc = await this.resolveLocalUrl(this.videoPath, this.videoSrc)
        this.videoReloadAttempted = false
        return true
      } catch (_error) {
        this.videoSrc = null
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PREVIEW_MISSING })
        return false
      } finally {
        this.loading = false
      }
    },
    async loadProject(projectId) {
      this.loading = true
      try {
        const result = await story2videoGetProject(projectId)
        if (result?.code === -3) {
          // 防御：未来若访问控制收紧，未登录打开项目应引导登录而非泛化失败
          this.project = null
          this.projectId = null
          this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.ACCESS_DENIED })
          return
        }
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || '项目加载失败')
        const project = result.data
        this.project = project
        this.projectId = project.projectId
        this.segments = Array.isArray(project.segments) ? project.segments.map(segment => ({ ...segment })) : []
        this.unavailableMaterialKinds = {}
        this.segmentsDirty = false
        this.activeSegmentIndex = -1
        this.segmentItemRefs = []
        this.loadVoiceCatalog()
        await this.refreshSegmentImageUrls()
        // 分段渲染完成后初始化滚动高亮（2026-09-18）
        this.$nextTick(() => this.onSegmentScroll())
        this.audioPath = project.audioPath || null
        try {
          this.audioSrc = this.audioPath ? await this.resolveLocalUrl(this.audioPath, this.audioSrc) : null
        } catch (_error) {
          this.audioSrc = null
        }
        this.videoPath = project.videoPath || null
        try {
          this.videoSrc = this.videoPath ? await this.resolveLocalUrl(this.videoPath, this.videoSrc) : null
          this.videoReloadAttempted = false
        } catch (_error) {
          this.videoSrc = null
          this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PREVIEW_MISSING })
        }
        this.maybeShowDegradedAssetsWarning()
      } catch (_error) {
        this.project = null
        this.projectId = null
        this.showStory2VideoOperationFailure()
      } finally {
        this.loading = false
      }
    },
    async handleError() {
      // First error self-heals: re-issue a fresh local preview URL for the same final video and reload once, so expired/evicted media tokens do not cause a false failure; only a second failure surfaces the message.
      if (!this.videoPath || this.videoReloadAttempted) {
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.VIDEO_PREVIEW_FAILED })
        return
      }
      try {
        this.videoSrc = await this.resolveLocalUrl(this.videoPath, this.videoSrc)
        // Wait for Vue to apply the new src to the <video> element before load(),
        // otherwise load() targets the stale (expired) URL.
        await this.$nextTick()
        const player = this.$refs && this.$refs.videoPlayer
        if (player && typeof player.load === 'function') player.load()
        this.videoReloadAttempted = true
      } catch (_error) {
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.VIDEO_PREVIEW_FAILED })
      }
    },
    handleVideoMetadata(event) {
      const duration = Number(event?.target?.duration)
      if (!Number.isFinite(duration) || duration <= 0) return
      this.videoDuration = duration
      if (!Number.isFinite(Number(this.trimEnd)) || Number(this.trimEnd) <= Number(this.trimStart) || Number(this.trimEnd) > duration) {
        this.trimEnd = duration
      }
      this.normalizeTrimRange('start')
    },
    normalizeTrimRange(preferredBoundary = 'start') {
      const maximum = Number(this.trimMax)
      if (!Number.isFinite(maximum) || maximum <= 0) return
      const gap = Math.min(0.1, maximum)
      let start = Number(this.trimStart)
      let end = Number(this.trimEnd)
      if (!Number.isFinite(start)) start = 0
      if (!Number.isFinite(end)) end = maximum
      start = Math.min(Math.max(start, 0), Math.max(0, maximum - gap))
      end = Math.min(Math.max(end, gap), maximum)
      if (end - start < gap) {
        if (preferredBoundary === 'end') start = Math.max(0, end - gap)
        else end = Math.min(maximum, start + gap)
      }
      if (end - start < gap) start = Math.max(0, end - gap)
      this.trimStart = start
      this.trimEnd = end
    },
    setTrimBoundary(boundary, value) {
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || !['start', 'end'].includes(boundary)) return
      if (boundary === 'start') this.trimStart = numeric
      else this.trimEnd = numeric
      this.normalizeTrimRange(boundary)
      this.seekTrimPreview(boundary === 'start' ? this.trimStart : this.trimEnd)
    },
    seekTrimPreview(value) {
      const player = this.$refs.videoPlayer
      const time = Number(value)
      if (!player || !Number.isFinite(time)) return
      player.currentTime = Math.min(Math.max(time, 0), Number(this.trimMax))
    },
    async previewTrimRange() {
      if (!this.canTrim) return
      const player = this.$refs.videoPlayer
      if (!player || typeof player.play !== 'function') return
      this.seekTrimPreview(this.trimStart)
      this.trimPreviewing = true
      try {
        const playback = player.play()
        if (playback && typeof playback.then === 'function') await playback
      } catch (_error) {
        this.trimPreviewing = false
        this.showStory2VideoOperationFailure()
      }
    },
    handleTrimPreviewProgress(event) {
      if (!this.trimPreviewing) return
      const player = event?.target || this.$refs.videoPlayer
      if (!player || Number(player.currentTime) < Number(this.trimEnd)) return
      if (typeof player.pause === 'function') player.pause()
      player.currentTime = Number(this.trimStart)
      this.trimPreviewing = false
    },
    formatTrimTime(value) {
      const seconds = Math.max(0, Number(value) || 0)
      const minutes = Math.floor(seconds / 60)
      const remainder = (seconds % 60).toFixed(1).padStart(4, '0')
      return String(minutes).padStart(2, '0') + ':' + remainder
    },
    // 下载统一走主进程保存对话框：renderer 的 <a download> 对跨源/本地 HTTP
    // 媒体 URL 无效（会静默失败），必须用 dialog.showSaveDialog + 文件复制。
    async saveFileAs(filePath, suggestedName) {
      try {
        const result = await story2videoSaveAs(filePath, suggestedName)
        if (result?.code !== 0) throw new Error(result?.message || '保存失败')
        if (result.data?.cancelled) return
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SAVE_COMPLETED })
      } catch (_error) {
        this.showStory2VideoOperationFailure()
      }
    },
    async download() {
      if (!this.videoPath) return
      await this.saveFileAs(this.videoPath, 'video_' + Date.now() + '.' + this.formatLabel.toLowerCase())
    },
    async downloadArtifact(filePath, name) {
      if (!filePath) return
      await this.saveFileAs(filePath, name)
    },
    async downloadNarration() {
      if (!this.audioPath) return
      await this.downloadArtifact(this.audioPath, this.fileName(this.audioPath, 'narration.m4a'))
    },
    fileName(filePath, fallback) {
      return String(filePath || '').split(/[\\/]/).pop() || fallback
    },
    extension(filePath, fallback) {
      const name = this.fileName(filePath, '')
      const match = name.match(/(\.[a-z0-9]{2,5})$/i)
      return match ? match[1].toLowerCase() : fallback
    },
    segmentName(index, kind, filePath) {
      const fallback = kind === 'image' ? '.png' : kind === 'audio' ? '.mp3' : '.mp4'
      return 'segment-' + String(index + 1).padStart(3, '0') + '-' + kind + this.extension(filePath, fallback)
    },
    exportFiles() {
      const files = []
      if (this.videoPath) files.push({ path: this.videoPath, name: this.fileName(this.videoPath, 'video.mp4') })
      if (this.audioPath) files.push({ path: this.audioPath, name: this.fileName(this.audioPath, 'narration.m4a') })
      this.segments.forEach((segment, index) => {
        if (segment.imagePath) files.push({ path: segment.imagePath, name: this.segmentName(index, 'image', segment.imagePath) })
        if (segment.audioPath) files.push({ path: segment.audioPath, name: this.segmentName(index, 'audio', segment.audioPath) })
        if (segment.videoPath) files.push({ path: segment.videoPath, name: this.segmentName(index, 'video', segment.videoPath) })
      })
      return files
    },
    async exportZip() {
      const files = this.exportFiles()
      if (!files.length) return
      try {
        const result = await story2videoExportZip(files)
        if (result?.code !== 0) throw new Error('ZIP 导出失败')
        this.showStory2VideoNotification({
          messageKey: result.data?.cancelled
            ? STORY2VIDEO_NOTIFICATION_KEYS.EXPORT_CANCELLED
            : STORY2VIDEO_NOTIFICATION_KEYS.EXPORT_COMPLETED,
        })
      } catch (_error) {
        this.showStory2VideoOperationFailure()
      }
    },
    async copyLocalPath() {
      if (!this.videoPath) return
      try {
        const result = await story2videoCopyPath(this.videoPath)
        if (result?.code !== 0) throw new Error('复制路径失败')
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PATH_COPIED })
      } catch (_error) {
        this.showStory2VideoOperationFailure()
      }
    },
    async showInFolder() {
      if (!this.videoPath) return
      try {
        const result = await story2videoShowInFolder(this.videoPath)
        if (result?.code !== 0) throw new Error('打开文件夹失败')
      } catch (_error) {
        this.showStory2VideoOperationFailure()
      }
    },
    async trimVideo() {
      if (!this.canTrim || this.trimming) return
      this.trimPreviewing = false
      if (this.$refs.videoPlayer && typeof this.$refs.videoPlayer.pause === 'function') this.$refs.videoPlayer.pause()
      this.trimming = true
      try {
        const result = await videoProcess('trim', {
          input_path: this.videoPath,
          start_seconds: Number(this.trimStart),
          end_seconds: Number(this.trimEnd),
          codec: 'libx264',
        })
        const output = result?.data?.output || result?.data?.data?.output
        if (result?.code !== 0 || !result.data?.success || !output) {
          throw new Error(result?.message || result?.data?.error || '视频裁剪失败')
        }
        this.trimmedPath = output
        this.trimmedSrc = await this.resolveLocalUrl(output, this.trimmedSrc)
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.TRIM_COMPLETED })
      } catch (_error) {
        this.trimmedPath = null
        this.trimmedSrc = null
        this.showStory2VideoOperationFailure()
      } finally {
        this.trimming = false
      }
    },
    async downloadTrimmed() {
      if (!this.trimmedPath) return
      await this.saveFileAs(this.trimmedPath, this.fileName(this.trimmedPath, 'video-clip.mp4'))
    },
    async showTrimmedInFolder() {
      if (!this.trimmedPath) return
      try {
        const result = await story2videoShowInFolder(this.trimmedPath)
        if (result?.code !== 0) throw new Error('打开裁剪片段所在文件夹失败')
      } catch (_error) {
        this.showStory2VideoOperationFailure()
      }
    },
    moveSegment(index, offset) {
      const target = index + offset
      if (target < 0 || target >= this.segments.length) return
      const next = this.segments.slice()
      const [segment] = next.splice(index, 1)
      next.splice(target, 0, segment)
      this.segments = next
      this.segmentsDirty = true
      // 分段重排后 refs 下标失效，重置并重算滚动高亮（2026-09-18）
      this.segmentItemRefs = []
      this.$nextTick(() => this.onSegmentScroll())
    },
    removeSegment(index) {
      if (this.segments.length <= 1) return
      this.segments.splice(index, 1)
      this.segmentsDirty = true
      // 分段删除后 refs 下标失效，重置并重算滚动高亮（2026-09-18）
      this.segmentItemRefs = []
      this.$nextTick(() => this.onSegmentScroll())
    },
    async saveSegments() {
      if (!this.projectId || !this.segments.length) return false
      this.saving = true
      try {
        const updates = this.segments.map(segment => ({
          id: segment.id,
          text: segment.text || '',
          prompt: segment.prompt || '',
          videoPrompt: segment.videoPrompt || '',
          subtitleBlocks: Array.isArray(segment.subtitleBlocks) ? segment.subtitleBlocks : [],
          voiceId: segment.voiceId || '',
          voiceSpeed: segment.voiceSpeed === undefined || segment.voiceSpeed === null || segment.voiceSpeed === '' ? undefined : Number(segment.voiceSpeed),
          voicePitch: segment.voicePitch === undefined || segment.voicePitch === null || segment.voicePitch === '' ? undefined : Number(segment.voicePitch),
          voiceEmotion: segment.voiceEmotion || '',
        }))
        const result = await story2videoUpdateSegments(this.projectId, updates)
        if (result?.code !== 0) throw new Error(result?.message || '分段保存失败')
        if (Array.isArray(result.data?.segments) && result.data.segments.length) {
          this.segments = result.data.segments.map(segment => ({ ...segment }))
        }
        this.project = result.data || this.project
        // 主进程返回的分段不含渲染端派生 URL（imageUrl/alternateImageUrls/videoUrl），必须重新解析，否则保存后图片/素材/视频槽消失（2026-08-16 回归）
        await this.refreshSegmentImageUrls()
        this.segmentsDirty = false
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SEGMENTS_SAVED })
        return true
      } catch (_error) {
        this.showStory2VideoOperationFailure()
        return false
      } finally {
        this.saving = false
      }
    },
    // 离开守卫三动作（2026-08-16）：保存并离开 / 不保存离开 / 取消
    async saveAndLeave() {
      const next = this.pendingLeaveNext
      if (typeof next !== 'function') return
      if (!(await this.saveSegments())) return
      this.pendingLeaveNext = null
      this.unsavedLeaveDialog.visible = false
      next()
    },
    discardAndLeave() {
      if (this.saving) return // 保存在途时禁止穿插触发（双 next 竞态，2026-08-16 审查 W1）
      const next = this.pendingLeaveNext
      if (typeof next !== 'function') return
      this.pendingLeaveNext = null
      this.unsavedLeaveDialog.visible = false
      next()
    },
    cancelUnsavedLeave() {
      if (this.saving) return // 保存在途时禁止取消（否则保存完成后的 next 悬挂/竞态，2026-08-16 审查 W1）
      const next = this.pendingLeaveNext
      this.pendingLeaveNext = null
      this.unsavedLeaveDialog.visible = false
      if (typeof next === 'function') next(false)
    },
    isPolicyFlagScene(index) {
      return this.policyFlagSceneNumbers.size > 0 && this.policyFlagSceneNumbers.has(index + 1)
    },
    isSegmentBusy(segmentId) {
      return Boolean(this.segmentBusy[segmentId])
    },
    segmentBusyKind(segmentId) {
      // 返回 busy 类型标识（'' = 空闲），模板用 === 'image'/'video'/'genImage'/'genVideo' 区分文案
      return this.segmentBusy[segmentId] || ''
    },
    hasUsableVideoPrompt(segment) {
      return Boolean(segment && [segment.videoPrompt, segment.prompt, segment.text].some(source => typeof source === 'string' && source.trim()))
    },
    async replaceSegmentAudio(segmentId, event) {
      const input = event?.target
      const file = input?.files?.[0]
      if (!file || !this.projectId || this.isSegmentBusy(segmentId)) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: 'audio' }
      try {
        const imported = await story2videoImportMedia(file, 'audio')
        const filePath = imported?.code === 0 ? imported.data?.path : null
        if (!filePath) throw new Error(imported?.message || '旁白导入失败')
        const result = await story2videoReplaceSegmentAudio(this.projectId, segmentId, filePath)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || '旁白替换失败')
        this.project = result.data
        this.segments = Array.isArray(result.data.segments)
          ? result.data.segments.map(segment => ({ ...segment }))
          : this.segments
        // 旁白替换同样以 IPC 返回整体替换分段，需重建媒体 URL，避免图片/素材槽消失（同类回归）
        await this.refreshSegmentImageUrls()
        this.segmentsDirty = true
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.SEGMENT_AUDIO_REPLACED })
      } catch (_error) {
        this.showStory2VideoOperationFailure()
      } finally {
        if (input) input.value = ''
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async retrySegment(segmentId, mode) {
      if (!this.projectId || this.isSegmentBusy(segmentId)) return
      this.segmentBusy = { ...this.segmentBusy, [segmentId]: mode }
      try {
        const result = await story2videoRetrySegment(this.projectId, segmentId, mode)
        if (result?.code !== 0) throw new Error(result?.message || '分段重试失败')
        if (Array.isArray(result.data?.segments) && result.data.segments.length) {
          this.segments = result.data.segments.map(segment => ({ ...segment }))
        }
        this.project = result.data || this.project
        this.segmentsDirty = true
        // 重试图片/视频会生成新文件，必须重新解析本地媒体 URL，否则分段图片仍显示旧图或空白。
        await this.refreshSegmentImageUrls()
        this.showStory2VideoNotification({
          messageKey: mode === 'image'
            ? STORY2VIDEO_NOTIFICATION_KEYS.SEGMENT_IMAGE_RETRIED
            : STORY2VIDEO_NOTIFICATION_KEYS.SEGMENT_VIDEO_RETRIED,
        })
      } catch (error) {
        // 重试失败也刷新一次：服务端可能部分更新了分段（新图片已落盘但结果未完全返回）
        await this.refreshSegmentImageUrls().catch(() => {})
        // 透传真实错误走通知归一化（余额/限流/API Key 等已映射类别显示具体原因），未映射回退 operation_failed
        this.showStory2VideoNotification({ error: error && error.message ? error.message : '' })
      } finally {
        const next = { ...this.segmentBusy }
        delete next[segmentId]
        this.segmentBusy = next
      }
    },
    async recomposeProject() {
      if (!this.projectId || this.recomposing) return
      if (this.segmentsDirty && !(await this.saveSegments())) return
      this.recomposing = true
      try {
        const result = await story2videoRecomposeProject(this.projectId)
        if (result?.code !== 0 || !result.data) throw new Error(result?.message || '重新合成失败')
        this.project = result.data
        if (Array.isArray(result.data.segments) && result.data.segments.length) {
          this.segments = result.data.segments.map(segment => ({ ...segment }))
        }
        // 重新合成返回的分段对象不含素材 URL，必须重新解析本地媒体 URL，否则素材区/分段图空白。
        await this.refreshSegmentImageUrls()
        if (Object.prototype.hasOwnProperty.call(result.data, 'audioPath')) {
          this.audioPath = result.data.audioPath || null
        }
        try {
          this.audioSrc = this.audioPath ? await this.resolveLocalUrl(this.audioPath, this.audioSrc) : null
        } catch (_error) {
          this.audioSrc = null
        }
        if (!result.data.videoPath) {
          this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PREVIEW_MISSING })
          return
        }
        const videoLoaded = await this.loadVideoPath(result.data.videoPath)
        if (!videoLoaded) return
        this.projectId = result.data.projectId || this.projectId
        this.segmentsDirty = false
        this.showStory2VideoNotification({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.PROJECT_RECOMPOSED })
      } catch (_error) {
        this.showStory2VideoOperationFailure()
      } finally {
        this.recomposing = false
      }
    },
  },
}
</script>

<style scoped>
/* 视频任务编辑页：整页 flex 纵向布局；编辑内容为固定操作条预留底部安全空间。 */
.result-page { padding: 24px 24px calc(var(--result-action-bar-space, 88px) + 24px); max-width: 1040px; margin: 0 auto; min-height: 100%; display: flex; flex-direction: column; }

/* 分段快捷定位固定竖条：右侧 sticky，不随页面滚动（2026-08-18 UX 修正） */
.segment-jump-sidebar { position: fixed; right: 20px; top: 80px; width: 200px; z-index: 100; max-height: calc(100vh - 120px); overflow-y: auto; }
.segment-jump-sidebar .segment-jump-bar { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
.segment-jump-sidebar .segment-jump-numbers { display: flex; flex-wrap: wrap; gap: 6px; }
.segment-jump-sidebar .segment-jump-nav { display: flex; gap: 8px; justify-content: center; }

.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.page-header h1 { font-size: 24px; font-weight: 700; margin: 0; }
.back-to-list { align-self: flex-start; border: none; background: none; color: var(--primary); font-size: 14px; cursor: pointer; padding: 4px 8px; border-radius: 6px; margin-right: auto; }
.back-to-list:hover { background: var(--border-light); }
.page-subtitle { margin: 4px 0 0; color: var(--text); font-size: 15px; font-weight: 600; }
.page-meta { margin: 2px 0 0; color: var(--text-muted); font-size: 12px; }
.result-header-status { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; min-width: 0; }
.status-badge { padding: 5px 8px; border-radius: 4px; background: var(--warning-bg); color: var(--warning); font-size: 12px; }
.bgm-skipped-notice { display: flex; align-items: center; gap: 8px; padding: 10px 14px; margin-bottom: 16px; color: var(--banner-info-color); background: var(--banner-info-bg); border: 1px solid var(--banner-info-border); border-radius: 8px; font-size: 13px; line-height: 1.5; }
.loading-state, .empty-state { text-align: center; padding: 60px 0; color: var(--text-muted); }
.video-player { width: 100%; max-height: 68vh; border-radius: 8px; background: var(--ink); }
.video-info { margin: 12px 0; font-size: 13px; color: var(--text-muted); }
.completion-summary { color: var(--banner-success-text); font-weight: 600; margin-bottom: 4px; }
.video-info p { margin: 4px 0; }
.path-text { overflow-wrap: anywhere; }
.actions, .section-actions, .segment-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.actions { margin-top: 16px; }
.project-section { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--border); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.section-heading h2 { margin: 0; font-size: 18px; }
.section-heading p { margin: 4px 0 0; color: var(--text-muted); font-size: 13px; }
.segments-unsaved-chip { display: inline-block; margin-left: 10px; padding: 2px 8px; border-radius: 10px; background: #fdf6ec; color: #e6a23c; font-size: 12px; font-weight: 500; }
/* 分段快捷定位条（2026-08-17 UX 统一） */
.segment-jump-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.segment-jump-label { color: var(--text-muted); font-size: 12px; font-weight: 600; }
.segment-jump-numbers { display: flex; flex-wrap: wrap; gap: 6px; }
.segment-jump-number { min-width: 28px; height: 28px; padding: 0 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 12px; cursor: pointer; }
.segment-jump-number:hover { border-color: var(--primary); color: var(--primary); }
.segment-jump-number.active { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 600; }
.segment-jump-nav { display: flex; gap: 8px; margin-left: auto; }
/* 视频任务编辑页底部操作条：固定在主工作区底部，不跟随页面内容滚动。 */
.result-action-bar { position: fixed; left: var(--mp-sidebar-width, 200px); right: 0; bottom: 0; z-index: 110; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; min-height: var(--result-action-bar-space, 88px); margin: 0; padding: 12px max(20px, calc((100vw - var(--mp-sidebar-width, 200px) - 1040px) / 2 + 24px)); border-top: 1px solid var(--hairline, rgba(0,0,0,0.06)); background: var(--surface, #fff); box-shadow: 0 -2px 12px rgba(0,0,0,0.08); }
.result-action-bar-status { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.result-action-bar-status .segments-unsaved-chip { margin-left: 0; }
.result-action-bar-status .action-bar-progress { color: var(--text-muted); font-size: 12px; }
.result-action-bar-buttons { display: flex; flex-wrap: wrap; gap: 10px; }
.audio-player { width: 100%; height: 42px; }
.trim-range-panel { display: grid; gap: 8px; margin-bottom: 14px; padding: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
.trim-range-values { display: flex; justify-content: space-between; color: var(--text-muted); font-variant-numeric: tabular-nums; font-size: 12px; }
.trim-range-control { display: grid; grid-template-columns: 44px 1fr; align-items: center; gap: 10px; color: var(--text-muted); font-size: 12px; font-weight: 600; }
.trim-range-control input { width: 100%; min-width: 0; accent-color: var(--primary); }
.trim-controls { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) auto auto; gap: 12px; align-items: end; }
.trim-controls label { display: grid; gap: 6px; color: var(--text-muted); font-size: 12px; font-weight: 600; }
.trim-controls input { min-width: 0; border: 1px solid var(--border); border-radius: 6px; padding: 9px 10px; background: var(--bg); color: var(--text); }
.trim-progress { width: 100%; height: 4px; margin-top: 10px; accent-color: var(--primary); }
.trim-duration { margin: 8px 0 0; color: var(--text-muted); font-size: 12px; }
.trim-result { display: grid; gap: 10px; margin-top: 14px; }
.trimmed-player { width: 100%; max-height: 360px; background: var(--ink); border-radius: 6px; }
.segment-list { display: grid; gap: 12px; }
.segment-item { border: 1px solid var(--border); border-radius: 8px; padding: 14px; background: var(--surface); }
.segment-thumb { margin-bottom: 12px; border-radius: 6px; overflow: hidden; background: var(--bg); max-width: 320px; }
.segment-thumb { display: flex; align-items: center; justify-content: center; min-height: 120px; }
.segment-thumb img { display: block; width: 100%; height: 120px; object-fit: cover; }
.asset-placeholder { color: var(--text-muted); font-size: 12px; }
.narration-placeholder { display: flex; align-items: center; min-height: 44px; padding: 0 12px; border-radius: 6px; background: var(--bg); }
.scene-material-section { margin: 12px 0; padding: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
.scene-material-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.scene-material-heading strong { font-size: 13px; }
.scene-material-hint { color: var(--text-muted); font-size: 11px; }
.scene-material-slots { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.scene-material-slot { position: relative; display: flex; min-width: 0; flex-direction: column; gap: 7px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); transition: border-color 0.15s ease, box-shadow 0.15s ease; }
.scene-material-slot:hover { border-color: var(--primary); }
.scene-material-slot.selected { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
.scene-material-slot.empty { opacity: 0.75; }
.scene-material-thumb { display: flex; align-items: center; justify-content: center; width: 100%; aspect-ratio: 3 / 4; min-height: 96px; padding: 0; border: 0; border-radius: 4px; overflow: hidden; background: var(--bg); color: inherit; cursor: pointer; }
.scene-material-thumb:disabled { cursor: not-allowed; }
.scene-material-thumb img, .scene-material-thumb video { width: 100%; height: 100%; object-fit: cover; }
.scene-material-empty-text { color: var(--text-muted); font-size: 12px; }
.scene-material-choice { display: flex; align-items: center; gap: 6px; min-height: 24px; }
.scene-material-radio { flex: 0 0 auto; accent-color: var(--primary); width: 16px; height: 16px; cursor: pointer; }
.scene-material-radio:disabled { cursor: not-allowed; }
.scene-material-label { min-width: 0; color: var(--text); font-size: 12px; line-height: 1.3; cursor: pointer; }
.scene-material-radio:disabled + .scene-material-label { color: var(--text-muted); cursor: not-allowed; }
.scene-material-badge { position: absolute; top: 6px; right: 6px; max-width: calc(100% - 12px); padding: 2px 6px; border-radius: 4px; background: var(--primary); color: #fff; font-size: 10px; line-height: 1.2; }
.scene-material-slot-action { display: flex; min-height: 30px; align-items: flex-end; }
.scene-material-slot-action > * { width: 100%; min-width: 0; }
.scene-material-slot-action button { width: 100%; min-width: 0; white-space: normal; }
.scene-material-preview-body { display: flex; align-items: center; justify-content: center; min-height: 260px; }
.scene-material-preview-body img, .scene-material-preview-body video { max-width: 100%; max-height: 75vh; border-radius: 6px; }
.scene-material-preview-empty { color: var(--text-muted); }
/* 查看文案弹窗：原文案含原始换行与超长行。pre 默认 white-space: pre 不折行，
   长行会横向溢出弹窗（内容被裁切）。pre-wrap 保留原始换行并自动折行；
   overflow-wrap/word-break 兜底 URL 等无空格长串。滚动交给 .ui-modal-body，不叠第二层滚动条。 */
.script-modal-body { min-width: 0; }
.script-text { margin: 0; color: var(--text); font-family: inherit; font-size: 13px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.segment-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.segment-status { padding: 3px 6px; border-radius: 4px; background: var(--border-light); color: var(--text-muted); font-size: 11px; }
.segment-status-reason { flex: 1 1 auto; min-width: 0; color: var(--status-failed-text, var(--danger, #d93025)); font-size: 12px; line-height: 1.45; word-break: break-word; }
.segment-policy-flag { padding: 3px 6px; border-radius: 4px; background: var(--danger-bg, #fdecea); color: var(--danger, #d93025); font-size: 11px; font-weight: 600; }
.segment-policy-flagged { border-color: var(--danger, #d93025); box-shadow: 0 0 0 1px var(--danger, #d93025) inset; }
.segment-status.failed { background: var(--status-failed-bg); color: var(--status-failed-text); }
.segment-status.processing { background: var(--warning-bg); color: var(--warning); }
.segment-order { display: flex; gap: 4px; margin-left: auto; }
.segment-order button { border: 1px solid var(--border); background: var(--surface); color: var(--text-muted); border-radius: 4px; padding: 5px 8px; cursor: pointer; }
.segment-order button:disabled { opacity: 0.4; cursor: not-allowed; }
.field-label { display: grid; gap: 6px; margin-top: 10px; color: var(--text-muted); font-size: 12px; font-weight: 600; }
.field-label textarea { width: 100%; box-sizing: border-box; resize: vertical; border: 1px solid var(--border); border-radius: 6px; padding: 9px 10px; background: var(--bg); color: var(--text); font: inherit; font-size: 13px; line-height: 1.5; }
.segment-inline-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.segment-voice-settings { margin-top: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
.segment-voice-title { display: block; color: var(--text-muted); font-size: 12px; font-weight: 600; margin-bottom: 4px; }
.segment-voice-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.segment-voice-grid .field-label { margin-top: 6px; }
.segment-voice-grid input { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; background: var(--bg); color: var(--text); font: inherit; font-size: 13px; }
.segment-actions { margin-top: 12px; }
.segment-file-action { display: inline-flex; align-items: center; min-height: 30px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; color: var(--text-muted); cursor: pointer; font-size: 12px; font-weight: 600; }
.segment-file-action:hover { border-color: var(--primary); color: var(--primary); }
.segment-file-action.disabled { opacity: 0.45; cursor: not-allowed; }
.segment-file-action input { display: none; }

@media (max-width: 900px) {
  .segment-jump-sidebar { display: none; }

}
@media (max-width: 720px) {
  .result-page { padding: 16px 16px calc(var(--result-action-bar-space-mobile, 196px) + 16px); }
  .section-heading, .segment-header { align-items: flex-start; flex-direction: column; }
  .trim-controls { grid-template-columns: 1fr; }
  .segment-order { margin-left: 0; }
  .actions > *, .section-actions > * { flex: 1 1 auto; }
  .scene-material-slots { grid-template-columns: repeat(2, 1fr); }
  .segment-voice-grid { grid-template-columns: 1fr; }
  .result-header-status { width: 100%; justify-content: flex-start; }
  .result-action-bar { left: 68px; min-height: var(--result-action-bar-space-mobile, 196px); padding: 10px 14px; align-items: flex-start; }
  .result-action-bar-status, .result-action-bar-buttons { width: 100%; }
  .result-action-bar-buttons > * { flex: 1 1 100%; }
}
@media (min-width: 721px) and (max-width: 900px) {
  .result-action-bar { left: 68px; padding-inline: max(20px, calc((100vw - 68px - 1040px) / 2 + 24px)); }
}
</style>

