<template>
  <div class="podcast-channel-page">
    <header class="podcast-header">
      <h1 data-testid="podcast-page-title">{{ t('podcast.pageTitle') }}</h1>
      <p class="podcast-subtitle">{{ t('podcast.pageSubtitle') }}</p>
    </header>

    <!-- 区块一：频道设置 -->
    <section class="podcast-section" data-testid="podcast-channel-picker" aria-labelledby="podcast-picker-heading">
      <h2 id="podcast-picker-heading">{{ t('podcast.picker.sectionTitle') }}</h2>
      <p v-if="migrationStatus === 'conflict'" class="podcast-error" data-testid="podcast-migration-conflict">
        {{ t('podcast.picker.migrationConflict') }}<span v-if="migrationConflicts.length" class="podcast-migration-files" data-testid="podcast-migration-files">{{ migrationConflicts.join(' / ') }}</span>
        <button type="button" data-testid="podcast-migration-keep-existing" @click="onResolveMigration('keep_existing')">{{ t('podcast.picker.keepExisting') }}</button>
        <button type="button" data-testid="podcast-migration-keep-legacy" @click="onResolveMigration('keep_legacy')">{{ t('podcast.picker.keepLegacy') }}</button>
      </p>
      <p v-else-if="migrationStatus === 'error'" class="podcast-error" data-testid="podcast-migration-error">{{ t('podcast.picker.migrationError') }}</p>
      <p v-if="channelListError" class="podcast-error" data-testid="podcast-picker-list-error">{{ errorText(channelListError) }}</p>
      <div v-if="channels.length === 0" class="podcast-empty" data-testid="podcast-picker-empty">{{ t('podcast.picker.empty') }}</div>
      <label v-else class="podcast-field">
        <span>{{ t('podcast.picker.current') }}</span>
        <select v-model="activeChannelId" data-testid="podcast-picker-select" :disabled="switchingChannel" @change="onSwitchChannel">
          <option v-for="c in channels" :key="c.id" :value="c.id">{{ c.name }} · {{ c.count }}/{{ c.cap }}</option>
        </select>
      </label>
      <div class="podcast-picker-actions">
        <input v-model="newChannelName" data-testid="podcast-picker-new-name" :placeholder="t('podcast.picker.namePlaceholder')" :maxlength="120">
        <button type="button" data-testid="podcast-picker-create" @click="onCreateChannel">{{ t('podcast.picker.create') }}</button>
        <button type="button" data-testid="podcast-picker-set-default" :disabled="!activeChannelId" @click="onSetDefault">{{ t('podcast.picker.setDefault') }}</button>
        <input v-model="renameName" data-testid="podcast-picker-rename-name" :placeholder="t('podcast.picker.namePlaceholder')" :maxlength="120">
        <button type="button" data-testid="podcast-picker-rename" :disabled="!activeChannelId" @click="onRenameChannel">{{ t('podcast.picker.rename') }}</button>
      </div>
      <p v-if="pickerError" class="podcast-error" data-testid="podcast-picker-error">{{ pickerError }}</p>
      <p class="podcast-hint" data-testid="podcast-picker-quota-hint">{{ t('podcast.picker.quotaHint', { cap: channelCap, count: channelCount }) }}</p>
    </section>
    <PodcastHostingCard :channel-id="activeChannelId" :feed-sync="feedSync" data-testid="podcast-hosting-mount" @published="onFeedPublished" />

    <section class="podcast-section" data-testid="podcast-channel-section" aria-labelledby="podcast-channel-heading">
      <h2 id="podcast-channel-heading">{{ t('podcast.channel.sectionTitle') }}</h2>
      <p class="podcast-hint">{{ t('podcast.channel.sectionHint') }}</p>

      <div class="podcast-form-grid">
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldTitle') }}</span>
          <input v-model="channelForm.title" data-testid="podcast-field-title" :maxlength="255">
        </label>
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldSubtitle') }}</span>
          <input v-model="channelForm.subtitle" data-testid="podcast-field-subtitle" :maxlength="120">
        </label>
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldLink') }}</span>
          <input v-model="channelForm.link" data-testid="podcast-field-link" placeholder="https://…">
        </label>
        <label class="podcast-field podcast-field-wide">
          <span>{{ t('podcast.channel.fieldDescription') }}</span>
          <textarea v-model="channelForm.description" data-testid="podcast-field-description" rows="3"></textarea>
        </label>
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldLanguage') }}</span>
          <input v-model="channelForm.language" data-testid="podcast-field-language" placeholder="zh-CN">
        </label>
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldAuthor') }}</span>
          <input v-model="channelForm.author" data-testid="podcast-field-author">
        </label>
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldOwnerName') }}</span>
          <input v-model="channelForm.ownerName" data-testid="podcast-field-owner-name">
        </label>
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldOwnerEmail') }}</span>
          <input v-model="channelForm.ownerEmail" data-testid="podcast-field-owner-email">
          <small class="podcast-hint" data-testid="podcast-owner-email-privacy-hint">{{ t('podcast.channel.ownerEmailPrivacy') }}</small>
        </label>
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldExplicit') }}</span>
          <select v-model="channelForm.explicit" data-testid="podcast-field-explicit">
            <option v-for="v in EXPLICIT_OPTIONS" :key="v" :value="v">{{ t('podcast.explicit.' + v) }}</option>
          </select>
        </label>
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldEpisodeType') }}</span>
          <select v-model="channelForm.feedType" data-testid="podcast-field-episode-type">
            <option v-for="v in CHANNEL_EPISODE_TYPE_OPTIONS" :key="v" :value="v">{{ t('podcast.channelFeedType.' + v) }}</option>
          </select>
        </label>
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldCoverUrl') }}</span>
          <input v-model="channelForm.coverUrl" data-testid="podcast-field-cover-url" placeholder="https://…">
        </label>
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldCoverSize') }}</span>
          <input v-model="channelForm.coverSize" data-testid="podcast-field-cover-size" placeholder="3000x3000">
        </label>
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldCategory') }}</span>
          <select v-model="channelForm.category" data-testid="podcast-field-category" @change="onCategoryChange">
            <option value="" disabled>{{ t('podcast.channel.categoryPlaceholder') }}</option>
            <option v-for="c in CHANNEL_CATEGORIES" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldSubCategories') }}</span>
          <select v-model="channelForm.subCategory" data-testid="podcast-field-subcategories">
            <option value="">{{ t('podcast.channel.subCategoryNone') }}</option>
            <option v-for="s in availableSubCategories" :key="s" :value="s">{{ s }}</option>
          </select>
          <small class="podcast-hint">{{ t('podcast.channel.subCategoriesHint') }}</small>
        </label>
        <label class="podcast-field">
          <span>{{ t('podcast.channel.fieldAudioSource') }}</span>
          <select v-model="channelForm.audioSource" data-testid="podcast-field-audio-source">
            <option value="url">{{ t('podcast.audioSource.url') }}</option>
            <option value="oss">{{ t('podcast.audioSource.oss') }}</option>
          </select>
        </label>
      </div>

      <div class="podcast-actions">
        <button type="button" data-testid="podcast-channel-save" :disabled="savingChannel" @click="onSaveChannel">
          {{ t('podcast.channel.save') }}
        </button>
      </div>
      <p v-if="channelError" class="podcast-error" data-testid="podcast-channel-error">{{ errorText(channelError) }}</p>
      <ul v-if="channelSaveIssues.length" class="podcast-issue-list" data-testid="podcast-channel-save-issues">
        <li v-for="(it, i) in channelSaveIssues" :key="'csi' + i" class="podcast-issue">{{ issueText(it) }} <code>{{ it.field }}</code></li>
      </ul>
    </section>

    <!-- 区块二：单集管理 -->
    <section class="podcast-section" data-testid="podcast-episodes-section" aria-labelledby="podcast-episodes-heading">
      <h2 id="podcast-episodes-heading">{{ t('podcast.episodes.sectionTitle') }}</h2>
      <p v-if="episodesError" class="podcast-error" data-testid="podcast-episodes-error">{{ errorText(episodesError) }}</p>

      <div v-if="episodes.length === 0" class="podcast-empty" data-testid="podcast-episodes-empty">
        {{ t('podcast.episodes.empty') }}
      </div>
      <ul v-else class="podcast-episode-list">
        <li v-for="ep in episodes" :key="ep.id" class="podcast-episode-row" :data-testid="'podcast-episode-' + ep.id">
          <span class="podcast-episode-title">{{ ep.title }}</span>
          <span class="podcast-episode-meta">{{ durationText(ep.durationSec) }} · {{ ep.pubDate }} · {{ ep.episodeType || 'full' }}</span>
          <span class="podcast-episode-ops">
            <button type="button" :data-testid="'podcast-episode-edit-' + ep.id" @click="startEditEpisode(ep)">{{ t('podcast.episodes.edit') }}</button>
            <template v-if="pendingDeleteId === ep.id">
              <span data-testid="podcast-episode-delete-confirm-text">{{ t('podcast.episodes.confirmDelete') }}</span>
              <button type="button" :data-testid="'podcast-episode-delete-yes-' + ep.id" @click="confirmDeleteEpisode(ep.id)">{{ t('podcast.episodes.deleteYes') }}</button>
              <button type="button" :data-testid="'podcast-episode-delete-no-' + ep.id" @click="pendingDeleteId = ''">{{ t('podcast.episodes.deleteNo') }}</button>
            </template>
            <button v-else type="button" :data-testid="'podcast-episode-delete-' + ep.id" @click="pendingDeleteId = ep.id">{{ t('podcast.episodes.delete') }}</button>
          </span>
        </li>
      </ul>

      <div v-if="editingEpisode" class="podcast-episode-form" data-testid="podcast-episode-form">
        <h3>{{ editingIsNew ? t('podcast.episodes.addTitle') : t('podcast.episodes.editTitle') }}</h3>
        <div class="podcast-form-grid">
          <label class="podcast-field podcast-field-wide">
            <span>{{ t('podcast.episodes.fieldTitle') }}</span>
            <input v-model="editingEpisode.title" data-testid="podcast-episode-field-title" :maxlength="255">
          </label>
          <label class="podcast-field podcast-field-wide">
            <span>{{ t('podcast.episodes.fieldDescription') }}</span>
            <textarea v-model="editingEpisode.description" data-testid="podcast-episode-field-description" rows="3"></textarea>
          </label>
          <label class="podcast-field">
            <span>{{ t('podcast.episodes.fieldAudioUrl') }}</span>
            <input v-model="editingEpisode.audioUrl" data-testid="podcast-episode-field-audio-url" placeholder="https://…">
          </label>
          <label class="podcast-field">
            <span>{{ t('podcast.episodes.fieldLocalFilePath') }}</span>
            <input v-model="editingEpisode.localFilePath" data-testid="podcast-episode-field-local-path">
          </label>
          <label class="podcast-field">
            <span>{{ t('podcast.episodes.fieldDurationSec') }}</span>
            <input v-model.number="editingEpisode.durationSec" type="number" min="1" data-testid="podcast-episode-field-duration">
          </label>
          <label class="podcast-field">
            <span>{{ t('podcast.episodes.fieldSizeBytes') }}</span>
            <input v-model.number="editingEpisode.sizeBytes" type="number" min="1" data-testid="podcast-episode-field-size">
          </label>
          <label class="podcast-field">
            <span>{{ t('podcast.episodes.fieldPubDate') }}</span>
            <input v-model="editingEpisode.pubDate" data-testid="podcast-episode-field-pubdate" placeholder="2026-10-01T08:00:00.000Z">
          </label>
          <label class="podcast-field">
            <span>{{ t('podcast.episodes.fieldExplicit') }}</span>
            <select v-model="editingEpisode.explicit" data-testid="podcast-episode-field-explicit">
              <option value="">{{ t('podcast.episodes.explicitInherit') }}</option>
              <option v-for="v in EXPLICIT_OPTIONS" :key="v" :value="v">{{ t('podcast.explicit.' + v) }}</option>
            </select>
          </label>
          <label class="podcast-field">
            <span>{{ t('podcast.episodes.fieldEpisodeType') }}</span>
            <select v-model="editingEpisode.episodeType" data-testid="podcast-episode-field-type">
              <option v-for="v in EPISODE_TYPE_OPTIONS" :key="v" :value="v">{{ t('podcast.episodeType.' + v) }}</option>
            </select>
          </label>
          <label class="podcast-field podcast-field-wide">
            <span>{{ t('podcast.episodes.fieldGuid') }}</span>
            <input v-model="editingEpisode.guid" data-testid="podcast-episode-field-guid">
            <small class="podcast-hint">{{ t('podcast.episodes.guidHint') }}</small>
          </label>
        </div>
        <div class="podcast-actions">
          <button type="button" data-testid="podcast-episode-save" :disabled="savingEpisode" @click="onSaveEpisode">{{ t('podcast.episodes.save') }}</button>
          <button type="button" data-testid="podcast-episode-cancel" @click="closeEpisodeForm">{{ t('podcast.episodes.cancel') }}</button>
        </div>
        <p v-if="episodeFormError" class="podcast-error" data-testid="podcast-episode-form-error">{{ episodeFormError }}</p>
        <ul v-if="episodeSaveIssues.length" class="podcast-issue-list" data-testid="podcast-episode-save-issues">
          <li v-for="(it, i) in episodeSaveIssues" :key="'esi' + i" class="podcast-issue">{{ issueText(it) }} <code>{{ it.field }}</code></li>
        </ul>
      </div>
      <div v-else class="podcast-actions">
        <button type="button" data-testid="podcast-episode-add" @click="startNewEpisode">{{ t('podcast.episodes.add') }}</button>
      </div>
    </section>

    <!-- 区块三：发布与自检 -->
    <section class="podcast-section" data-testid="podcast-publish-section" aria-labelledby="podcast-publish-heading">
      <h2 id="podcast-publish-heading">{{ t('podcast.publish.sectionTitle') }}</h2>
      <p class="podcast-hint">{{ t('podcast.publish.sectionHint') }}</p>
      <div class="podcast-actions">
        <button type="button" data-testid="podcast-feed-build" :disabled="buildingFeed" @click="onBuildFeed">{{ t('podcast.publish.buildFeed') }}</button>
        <button type="button" data-testid="podcast-feed-verify" :disabled="verifying" @click="onVerifyFeed">{{ t('podcast.publish.verifyFeed') }}</button>
      </div>

      <div v-if="feedResult && feedResult.ok" class="podcast-result" data-testid="podcast-feed-result">
        <p>{{ t('podcast.publish.feedBuilt', { count: feedResult.itemCount }) }}</p>
        <code class="podcast-feed-path" data-testid="podcast-feed-path">{{ feedResult.path }}</code>
        <button type="button" data-testid="podcast-feed-copy" @click="onCopyFeedPath">{{ t('podcast.publish.copyPath') }}</button>
      </div>
      <div v-else-if="feedResult && !feedResult.ok" class="podcast-result podcast-result-fail" data-testid="podcast-feed-fail">
        <p>{{ errorText(feedResult.code) }}</p>
        <ul v-if="feedResult.issues && feedResult.issues.length">
          <li v-for="(it, i) in feedResult.issues" :key="'fb' + i" class="podcast-issue">{{ issueText(it) }}</li>
        </ul>
      </div>

      <div v-if="verifyResult" class="podcast-result" data-testid="podcast-verify-result">
        <p :data-testid="verifyResult.ok ? 'podcast-verify-pass' : 'podcast-verify-fail'">
          {{ verifyResult.ok ? t('podcast.publish.verifyPassed', { count: verifyResult.itemCount }) : t('podcast.publish.verifyFailed', { count: verifyResult.issues.length }) }}
        </p>
        <ul v-if="channelIssues.length" data-testid="podcast-verify-channel-issues">
          <li v-for="(it, i) in channelIssues" :key="'ci' + i" class="podcast-issue">{{ issueText(it) }} <code>{{ it.field }}</code></li>
        </ul>
        <ul v-if="nonChannelIssues.length" data-testid="podcast-verify-issues">
          <li v-for="(it, i) in nonChannelIssues" :key="'vi' + i" class="podcast-issue">{{ issueText(it) }} <code>{{ it.field }}</code></li>
        </ul>
        <ul v-if="verifyResult.checks.length" class="podcast-check-list" data-testid="podcast-verify-checks">
          <li v-for="(ck, i) in verifyResult.checks" :key="'ck' + i">
            <span :class="ck.ok ? 'podcast-check-ok' : 'podcast-check-bad'">{{ ck.ok ? '✓' : '✗' }}</span>
            <code>{{ ck.url }}</code>
            <span v-if="ck.reason">{{ issueText({ code: ck.reason }) }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- 分发端提交指引 -->
    <section class="podcast-section" data-testid="podcast-endpoints-section" aria-labelledby="podcast-endpoints-heading">
      <h2 id="podcast-endpoints-heading">{{ t('podcast.endpoints.sectionTitle') }}</h2>
      <p class="podcast-hint">{{ t('podcast.endpoints.sectionHint') }}</p>
      <p v-if="endpointsError" class="podcast-error" data-testid="podcast-endpoints-error">{{ errorText(endpointsError) }}</p>
      <div v-if="endpoints.length === 0" class="podcast-empty" data-testid="podcast-endpoints-empty">{{ t('podcast.endpoints.empty') }}</div>
      <div v-else class="podcast-endpoint-cards">
        <article v-for="ep in endpoints" :key="ep.id" class="podcast-endpoint-card" :data-testid="'podcast-endpoint-' + ep.id">
          <h3>{{ ep.name }}</h3>
          <p v-if="ep.requiresManualFirstSubmit" class="podcast-endpoint-badge" :data-testid="'podcast-endpoint-manual-' + ep.id">{{ t('podcast.endpoints.manualFirstSubmit') }}</p>
          <p class="podcast-endpoint-timing">{{ ep.timing }}</p>
          <ol class="podcast-endpoint-steps">
            <li v-for="(step, i) in ep.steps || []" :key="i">{{ step }}</li>
          </ol>
          <p class="podcast-endpoint-links">
            <template v-if="safeHttpUrl(ep.submitUrl)">
              <a
                v-if="safeHttpUrl(ep.submitUrl)"
                :href="safeHttpUrl(ep.submitUrl)"
                target="_blank"
                rel="noopener"
                :data-testid="'podcast-endpoint-submit-' + ep.id"
              >{{ t('podcast.endpoints.submitLink') }}</a>
            </template>
            <span v-else class="podcast-endpoint-nolink" :data-testid="'podcast-endpoint-nosubmit-' + ep.id">{{ t('podcast.endpoints.noSubmitUrl') }}</span>
            <a
              v-if="safeHttpUrl(ep.docUrl)"
              :href="safeHttpUrl(ep.docUrl)"
              target="_blank"
              rel="noopener"
              :data-testid="'podcast-endpoint-doc-' + ep.id"
            >{{ t('podcast.endpoints.docLink') }}</a>
          </p>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { safeHttpUrl } from '@multi-publish/shared-utils/src/safe-http-url'
import { useNotify } from '@/composables/useNotify'
import {
  usePodcastChannel,
  CHANNEL_CATEGORIES,
  EXPLICIT_OPTIONS,
  EPISODE_TYPE_OPTIONS,
  CHANNEL_EPISODE_TYPE_OPTIONS,
  channelPayloadToForm,
  subCategoriesOf,
} from '@/composables/usePodcastChannel'
import { createPodcastChannelActions } from '@/composables/usePodcastChannelActions'
import PodcastHostingCard from '@/components/PodcastHostingCard.vue'

const api = usePodcastChannel()
const { t } = useI18n()
const { notifySuccess, notifyError } = useNotify()

const {
  channels,
  activeChannelId,
  migrationStatus,
  migrationConflicts,
  channelListError,
  channelCap,
  channelCount,
  switchingChannel,
  createChannel,
  renameChannel,
  setDefaultChannel,
  resolveMigration,
  switchChannel,
  loadChannels,
  channel,
  feedSync,
  savingChannel,
  channelError,
  episodes,
  episodesError,
  savingEpisode,
  feedResult,
  buildingFeed,
  verifyResult,
  verifying,
  endpoints,
  endpointsError,
  channelIssues,
  loadChannel,
  loadEpisodes,
  refreshQuota,
  loadEndpoints,
  saveChannel,
  saveEpisode,
  removeEpisode,
  buildFeed,
  verifyFeed,
  makeEpisodeDraft,
  makeChannelDraft,
  durationText,
  errorText,
  issueText,
} = api

const actions = createPodcastChannelActions({ api, t, notifySuccess, notifyError })
const {
  newChannelName,
  renameName,
  pickerError,
  onCreateChannel,
  onSetDefault,
  onRenameChannel,
  onResolveMigration,
  onSwitchChannel,
  channelForm,
  editingEpisode,
  editingIsNew,
  pendingDeleteId,
  episodeFormError,
  channelSaveIssues,
  episodeSaveIssues,
  availableSubCategories,
  nonChannelIssues,
  applyChannelToForm,
  onCategoryChange,
  onSaveChannel,
  toFormPayload,
  startNewEpisode,
  startEditEpisode,
  closeEpisodeForm,
  onSaveEpisode,
  confirmDeleteEpisode,
  onBuildFeed,
  onVerifyFeed,
  onCopyFeedPath,
} = actions


// 发布成功必须立刻把配额与单集列表刷成现值：这两处的真源在主进程，跨动作缓存就是说谎（评审 #17）
async function onFeedPublished (res) {
  if (!res || !res.ok) { notifyError(errorText((res && res.code) || 'PODCAST_IPC_EXCEPTION')); return }
  if (res.state === 'success') {
    notifySuccess(t('podcast.hosting.publishSuccess', { count: res.itemCount || 0 }))
    if (!res.backupCreated) notifyError(t('podcast.hosting.backupMissing'))
    // 发布动过真源（writeFeedSync 已落 success/failed），横幅必须跟着重读；
    // 只刷配额与列表会让「公网已更新」这件事要等用户手动刷新页面才消失。
    await Promise.allSettled([refreshQuota(), loadEpisodes(), loadChannel()])
    return
  }
  // 失败同样要重读：writeFeedSync 已把 failed 落进真源，横幅该亮
  await loadChannel().catch(() => {})
  notifyError(t('podcast.hosting.publishFailed', { status: res.status == null ? t('podcast.hosting.checkNoStatus') : res.status }))
}

onMounted(async () => {
  const [chRes] = await Promise.allSettled([loadChannel()])
  const ch = chRes.status === 'fulfilled' ? chRes.value : null
  channelForm.value = applyChannelToForm(ch && ch.ok ? ch.channel : null)
  await Promise.allSettled([loadEpisodes(), loadEndpoints()])
  if (ch && !ch.ok) notifyError(errorText(channelError.value || 'PODCAST_IPC_UNAVAILABLE'))
  if (episodesError.value) notifyError(errorText(episodesError.value))
})
</script>

<style scoped>
.podcast-channel-page { padding: 16px 24px; }
.podcast-header h1 { margin: 0 0 4px; font-size: var(--font-size-lg); }
.podcast-subtitle { margin: 0 0 16px; color: var(--el-text-color-secondary, #666); font-size: var(--font-size-sm); }
.podcast-section { margin-bottom: 28px; }
.podcast-section h2 { font-size: var(--font-size-md); margin: 0 0 8px; }
.podcast-hint { color: var(--el-text-color-secondary, #888); font-size: var(--font-size-xs); margin: 4px 0; }
.podcast-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; }
.podcast-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-size-sm); }
.podcast-field-wide { grid-column: 1 / -1; }
.podcast-field input, .podcast-field textarea, .podcast-field select { padding: 6px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: var(--font-size-sm); }
.podcast-actions { margin-top: 12px; display: flex; gap: 8px; }
.podcast-actions button { padding: 6px 14px; border-radius: 4px; border: 1px solid var(--el-border-color, #dcdfe6); background: #fff; cursor: pointer; }
.podcast-error { color: var(--el-color-danger, #d03050); font-size: var(--font-size-sm); }
.podcast-empty { padding: 24px; text-align: center; color: var(--el-text-color-secondary, #888); border: 1px dashed var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-size-sm); }
.podcast-episode-list { list-style: none; margin: 0; padding: 0; }
.podcast-episode-row { display: flex; align-items: center; gap: 12px; padding: 8px 4px; border-bottom: 1px solid var(--el-border-color-lighter, #eee); font-size: var(--font-size-sm); }
.podcast-episode-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.podcast-episode-meta { color: var(--el-text-color-secondary, #888); font-size: var(--font-size-xs); }
.podcast-episode-ops { display: flex; gap: 6px; align-items: center; }
.podcast-episode-form { margin-top: 16px; padding: 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; }
.podcast-result { margin-top: 12px; padding: 10px 12px; background: var(--el-fill-color-light, #f7f8fa); border-radius: 6px; font-size: var(--font-size-sm); }
.podcast-result-fail { background: var(--el-color-danger-light-9, #fef0f0); }
.podcast-feed-path { display: inline-block; max-width: 100%; word-break: break-all; margin-right: 8px; }
.podcast-issue { margin: 2px 0; }
.podcast-check-list { list-style: none; padding: 0; }
.podcast-check-ok { color: var(--el-color-success, #18a058); margin-right: 6px; }
.podcast-check-bad { color: var(--el-color-danger, #d03050); margin-right: 6px; }
.podcast-endpoint-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.podcast-endpoint-card { border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; padding: 12px; font-size: var(--font-size-sm); }
.podcast-endpoint-card h3 { margin: 0 0 6px; font-size: var(--font-size-base); }
.podcast-endpoint-badge { display: inline-block; background: var(--el-color-warning-light-9, #fdf6ec); color: var(--el-color-warning, #e6a23c); border-radius: 4px; padding: 2px 6px; font-size: var(--font-size-xs); }
.podcast-endpoint-timing { color: var(--el-text-color-secondary, #888); font-size: var(--font-size-xs); }
.podcast-endpoint-steps { margin: 8px 0; padding-left: 18px; }
.podcast-endpoint-links a { margin-right: 10px; color: var(--el-color-primary, #2080f0); }
.podcast-endpoint-nolink { color: var(--el-text-color-secondary, #888); font-size: var(--font-size-xs); }
</style>
