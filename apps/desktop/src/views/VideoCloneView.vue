<template>
  <div class="video-clone-view">
    <h1 class="vc-title">{{ t('videoClone.title') }} · {{ t('pipelines.descriptions.video-clone') }}</h1>

    <ConfigProfileManager
      pipeline-id="video-clone"
      :pipeline-label="t('pipelines.names.video-clone')"
      :snapshot="videoCloneProfileSnapshot"
      :dirty="videoCloneProfileDirty"
      test-id-prefix="video-clone-config-profile"
      :on-list="loadConfigProfiles"
      :on-save="saveConfigProfile"
      :on-apply="applyVideoCloneProfile"
      :on-rename="renameConfigProfile"
      :on-delete="deleteVideoCloneProfile"
    />

    <!-- 输入区（PRD §13.2） -->
    <el-card class="vc-card" shadow="never">
      <el-radio-group v-model="sourceType" class="vc-source-type">
        <el-radio-button value="url">{{ t('videoClone.sourceUrl') }}</el-radio-button>
        <el-radio-button value="local">{{ t('videoClone.sourceLocal') }}</el-radio-button>
      </el-radio-group>

      <el-input
        v-if="sourceType === 'url'"
        v-model="linkUrl"
        :placeholder="t('videoClone.linkPlaceholder')"
        class="vc-input"
      />
      <el-input
        v-else
        v-model="filePath"
        :placeholder="t('videoClone.filePlaceholder')"
        class="vc-input"
      >
        <template #append>
          <el-button data-testid="video-clone-pick-file" @click="pickFile">{{ t('videoClone.pickFile') }}</el-button>
        </template>
      </el-input>

      <div class="vc-options">
        <el-select v-model="mode" :placeholder="t('videoClone.modePlaceholder')" class="vc-option" data-testid="video-clone-mode">
          <el-option :label="t('videoClone.mode.structure')" value="structure" />
          <el-option :label="t('videoClone.mode.style')" value="style" />
          <el-option :label="t('videoClone.mode.inspiration')" value="inspiration" />
        </el-select>
        <el-checkbox v-model="rewriteScript" data-testid="video-clone-rewrite-script">{{ t('videoClone.rewriteScript') }}</el-checkbox>
      </div>

      <div class="vc-actions">
        <el-button type="primary" data-testid="video-clone-start" :loading="running" @click="start" :disabled="running">
          {{ t('videoClone.start') }}
        </el-button>
        <el-button v-if="running" data-testid="video-clone-cancel" @click="cancel">{{ t('videoClone.cancel') }}</el-button>
      </div>
    </el-card>

    <!-- 进度区（PRD §13.3） -->
    <el-card v-if="running || Object.values(stageStatus).some((s) => s !== 'idle')" class="vc-card" shadow="never">
      <template #header>{{ t('videoClone.progress') }}</template>
      <div class="vc-stages">
        <div v-for="s in STAGE_LABELS" :key="s" class="vc-stage" :class="'is-' + stageStatus[s]">
          <span class="vc-stage-dot" />
          <span>{{ stageLabel(s) }}</span>
          <span class="vc-stage-status">{{ stageStatusText(s) }}</span>
        </div>
      </div>
    </el-card>

    <!-- 报告编辑（PRD §13.4 简化：文案 + 复刻层级） -->
    <el-card v-if="report" class="vc-card" shadow="never">
      <template #header>{{ t('videoClone.report') }}</template>
      <el-input
        type="textarea"
        :rows="6"
        :model-value="report.script.fullText"
        :placeholder="t('videoClone.scriptPlaceholder')"
        data-testid="video-clone-report-script"
        @change="(v) => editReport('script.fullText', v)"
      />
      <div class="vc-meta">
        {{ t('videoClone.meta.duration') }} {{ report.meta.durationSec }}s · {{ t('videoClone.meta.resolution') }} {{ report.meta.resolution || t('videoClone.meta.unknown') }} · {{ t('videoClone.meta.aspect') }} {{ report.platformParams.aspect }} ·
        {{ t('videoClone.meta.targetLevel') }} {{ report.replication?.level || '-' }}（{{ report.replication?.auto?.determined ? t('videoClone.meta.auto') : t('videoClone.meta.fixed') }}）
      </div>
    </el-card>

    <!-- 结果（PRD §13.5） -->
    <el-card v-if="similarity" class="vc-card" shadow="never">
      <template #header>{{ t('videoClone.similarity') }}</template>
      <div class="vc-sim">{{ t('videoClone.meta.score') }} <b>{{ similarity.score }}</b> · {{ t('videoClone.meta.verdict') }} <b>{{ similarity.verdict }}</b></div>
      <div class="vc-level">
        {{ t('videoClone.meta.autoTarget') }} <b>{{ report?.replication?.level || '-' }}</b> → {{ t('videoClone.meta.achieved') }} <b>{{ similarity.grade || '-' }}</b>
        <span class="vc-level-note">（F4 {{ t('videoClone.meta.acceptedAt') }} {{ similarity.level || 'L1' }}）</span>
      </div>
      <div class="vc-sim-metrics">
        {{ t('videoClone.metrics.structure') }} {{ similarity.metrics.structure.toFixed(2) }} · {{ t('videoClone.metrics.script') }} {{ similarity.metrics.script.toFixed(2) }} ·
        {{ t('videoClone.metrics.style') }} {{ similarity.metrics.style.toFixed(2) }} · {{ t('videoClone.metrics.durationDeviation') }} {{ (similarity.metrics.durationDeviation * 100).toFixed(1) }}%
      </div>
      <el-tag v-if="similarity.warnings && similarity.warnings.verbatimScript" type="warning">
        {{ t('videoClone.verbatimWarn') }}
      </el-tag>
      <el-tag v-if="similarity.warnings && similarity.warnings.degradedAssets" type="warning" data-testid="video-clone-degraded-warning">
        {{ t('videoClone.degradedAssetsWarning') }}
      </el-tag>
      <div class="vc-actions">
        <el-button data-testid="video-clone-regenerate" :loading="running" @click="regenerate" :disabled="!runId || running">{{ t('videoClone.regenerate') }}</el-button>
      </div>
    </el-card>

    <!-- 成品视频（成品展示 + 下载） -->
    <el-card v-if="outputPath" class="vc-card" shadow="never">
      <template #header>{{ t('videoClone.outputVideo') }}</template>
      <video
        v-if="videoSrc"
        ref="videoPlayer"
        :src="videoSrc"
        controls
        class="vc-video"
        data-testid="video-clone-output-video"
        @error="handleVideoError"
      />
      <div v-else class="vc-video-fallback">{{ t('videoClone.outputVideoUnavailable') }}</div>
      <p class="vc-path-text">{{ t('videoClone.outputPathLabel') }}: {{ outputPath }}</p>
      <div class="vc-actions">
        <el-button type="primary" data-testid="video-clone-download" :disabled="!outputPath" @click="download">{{ t('videoClone.downloadVideo') }}</el-button>
        <el-button data-testid="video-clone-show-in-folder" @click="showInFolder">{{ t('videoClone.showInFolder') }}</el-button>
        <el-button data-testid="video-clone-copy-path" @click="copyPath">{{ t('videoClone.copyPath') }}</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVideoClone } from '@/composables/useVideoClone'
import ConfigProfileManager from '@/components/ConfigProfileManager.vue'
import { story2videoCreateShareUrl, story2videoSaveAs, story2videoShowInFolder, story2videoCopyPath } from '@/api/publisher'

const { t } = useI18n()
const {
  sourceType, linkUrl, filePath, mode, rewriteScript,
  running, stageStatus, report, similarity, outputPath, STAGE_LABELS,
  start, cancel, editReport, pickFile, regenerate, runId,
  buildConfigProfileSnapshot, applyConfigProfileSnapshot,
  loadConfigProfiles, saveConfigProfile, renameConfigProfile, deleteConfigProfile,
} = useVideoClone()

const videoCloneProfileSnapshot = computed(() => buildConfigProfileSnapshot())
const videoCloneProfileDirty = computed(() => {
  const config = videoCloneProfileSnapshot.value.videoClone
  return config.sourceType !== 'url' || config.mode !== 'structure' || config.rewriteScript !== false
})

function applyVideoCloneProfile (profile) {
  return applyConfigProfileSnapshot(profile?.snapshot)
}

function deleteVideoCloneProfile (profile) {
  return deleteConfigProfile(profile?.id)
}

function stageLabel(s) {
  return t('videoClone.stage.' + s)
}
function stageStatusText(s) {
  return t('videoClone.status.' + (stageStatus[s] || 'idle'))
}

// 成品视频展示
const videoSrc = ref(null)
const videoLoadAttempted = ref(false)

async function resolveVideoUrl() {
  if (!outputPath.value) { videoSrc.value = null; return }
  try {
    const result = await story2videoCreateShareUrl(outputPath.value, videoSrc.value)
    videoSrc.value = (result?.code === 0 ? (result.data?.url || result.data) : null) || null
    videoLoadAttempted.value = false
  } catch (_) { videoSrc.value = null }
}

watch(outputPath, () => resolveVideoUrl(), { immediate: true })

function handleVideoError() {
  if (videoLoadAttempted.value) return
  videoLoadAttempted.value = true
  resolveVideoUrl()
}

async function download() {
  if (!outputPath.value) return
  await story2videoSaveAs(outputPath.value, 'video_clone_' + Date.now() + '.mp4')
}

async function showInFolder() {
  if (!outputPath.value) return
  await story2videoShowInFolder(outputPath.value)
}

async function copyPath() {
  if (!outputPath.value) return
  await story2videoCopyPath(outputPath.value)
}
</script>

<style scoped>
.video-clone-view { max-width: 860px; margin: 24px auto; padding: 0 16px; }
.vc-title { font-size: 20px; margin-bottom: 16px; }
.vc-card { margin-bottom: 16px; }
.vc-input, .vc-options { margin-top: 12px; }
.vc-option { width: 160px; margin-right: 12px; }
.vc-actions { margin-top: 16px; }
.vc-stages { display: flex; flex-wrap: wrap; gap: 12px; }
.vc-stage { display: flex; align-items: center; gap: 6px; }
.vc-stage-dot { width: 8px; height: 8px; border-radius: 50%; background: #c0c4cc; }
.vc-stage.is-running .vc-stage-dot { background: #409eff; animation: pulse 1s infinite; }
.vc-stage.is-success .vc-stage-dot { background: #67c23a; }
.vc-stage.is-failed .vc-stage-dot { background: #f56c6c; }
.vc-stage-status { color: #909399; font-size: 12px; }
.vc-video { width: 100%; max-height: 480px; border-radius: 4px; background: #000; }
.vc-video-fallback { padding: 24px; text-align: center; color: #909399; }
.vc-path-text { margin-top: 8px; color: #909399; font-size: 12px; word-break: break-all; }
.vc-meta { margin-top: 8px; color: #909399; font-size: 12px; }
.vc-sim { font-size: 16px; }
.vc-level { margin-top: 6px; color: #303133; font-size: 14px; }
.vc-level-note { color: #909399; font-size: 12px; margin-left: 6px; }
.vc-sim-metrics { margin: 8px 0; color: #606266; }
@keyframes pulse { 50% { opacity: 0.3; } }
</style>
