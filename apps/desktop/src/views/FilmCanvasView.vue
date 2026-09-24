<script setup>
// 影视工程画布主视图：Vue Flow 底座 + 工具栏（拆分镜/参考图上传/生成所选）+ 成本确认卡。
// 引擎零改动：出片继续走 useFilmVideoGen 的 pipeline 通道（成本 checkpoint、逐镜结果、成片合同不因画布旁路）。
// 文案合同：所有用户可见文字都走 filmEngineering.canvas 命名空间的 t(key)，本文件不写中文字面量（注释除外）。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

import { useFilmCanvas } from '@/composables/useFilmCanvas'
import { useFilmVideoGen, FILM_VIDEO_ASPECTS, FILM_VIDEO_DURATIONS, FILM_MAX_VIDEO_BATCH } from '@/composables/useFilmVideoGen'
import ScriptInputNode from '@/components/film-canvas/ScriptInputNode.vue'
import ReferenceNode from '@/components/film-canvas/ReferenceNode.vue'
import ShotNode from '@/components/film-canvas/ShotNode.vue'

const { t } = useI18n()
const router = useRouter()
const { onNodeDragStop } = useVueFlow()

const canvas = useFilmCanvas()
const { nodes, edges, form, status, adaptLoading, uploading,
  refreshStatus, restore, runAdapt, uploadReference, addEdge, removeNodes,
  setShotStatus, buildGeneratePayload, persist, clearCanvas } = canvas

const vg = useFilmVideoGen()
const { phase, busy, costCheck, shotResults, finalPath, chosen,
  start, confirmCost, cancelCost, dispose } = vg

const fileInput = ref(null)
const uploadKind = ref('character')

const engineReady = computed(() => !!(status.value && status.value.available))
const costDialogVisible = computed(() => phase.value === 'awaiting-confirm')
const costShotCount = computed(() => (costCheck.value && Array.isArray(costCheck.value.shots) ? costCheck.value.shots.length : 0))
const selectedShotIds = computed(() =>
  nodes.value.filter((n) => n.type === 'shot' && n.selected).map((n) => n.data && n.data.shot && n.data.shot.shotId).filter(Boolean))
const allShotIds = computed(() =>
  nodes.value.filter((n) => n.type === 'shot').map((n) => n.data && n.data.shot && n.data.shot.shotId).filter(Boolean))
const aspectOptions = computed(() => FILM_VIDEO_ASPECTS.map((a) => ({
  value: a,
  label: t('filmEngineering.video.' + (a === '16x9' ? 'aspect169' : a === '9x16' ? 'aspect916' : 'aspectSource')),
})))
const durationOptions = computed(() => FILM_VIDEO_DURATIONS.map((d) => ({ value: d, label: t('filmEngineering.video.secondsN', { n: d }) })))

onMounted(async () => {
  await refreshStatus()
  restore()
})
onBeforeUnmount(() => dispose())

// 拖拽后持久化节点位置（D6：重启复原）
onNodeDragStop(() => persist())

function errText (errorCode) {
  return errorCode ? t(errorCode) : ''
}

async function onAdapt () {
  const r = await runAdapt()
  if (!r.ok) { ElMessage.error(errText(r.errorCode)); return }
  ElMessage.success(t('filmEngineering.canvas.adapt.done', { n: r.total }))
  if (r.warnings && r.warnings.length) ElMessage.warning(r.warnings.join('; '))
}

function pickFile (kind) {
  uploadKind.value = kind
  if (fileInput.value) { fileInput.value.value = ''; fileInput.value.click() }
}
async function onFileChosen (e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  const r = await uploadReference(file, uploadKind.value)
  if (!r.ok) ElMessage.error(errText(r.errorCode))
  else ElMessage.success(t('filmEngineering.canvas.upload.ok'))
}

function onConnect (conn) {
  const r = addEdge(conn)
  if (!r.ok) ElMessage.warning(t(r.reasonKey))
}

function removeNode (id) { removeNodes([id]) }

function syncShotStatuses () {
  for (const r of shotResults.value) {
    if (!r.shotId) continue
    const st = r.status === 'success' ? 'done' : (r.status === 'failed' ? 'failed' : 'generating')
    setShotStatus(r.shotId, { status: st, outPath: r.path || null })
  }
}

async function onGenerate (ids) {
  const shotIds = Array.isArray(ids) ? ids : []
  if (shotIds.length === 0) { ElMessage.warning(t('filmEngineering.canvas.generate.none')); return }
  const payload = buildGeneratePayload(shotIds)
  const res = await start(payload.selectedShots, {
    aspect: chosen.value.aspect,
    seconds: chosen.value.seconds,
    localReferences: payload.localReferences,
  })
  if (!res.ok && res.errorCode === 'tooManyShots') ElMessage.error(t('filmEngineering.video.tooManyShots', { max: FILM_MAX_VIDEO_BATCH }))
  else if (!res.ok && res.errorCode === 'noShots') ElMessage.warning(t('filmEngineering.canvas.generate.none'))
  else if (!res.ok) ElMessage.error(errText('filmEngineering.canvas.engineUnavailable'))
  syncShotStatuses()
}

async function onConfirmCost () { await confirmCost(); syncShotStatuses() }
async function onCancelCost () { await cancelCost() }
function onOpenFinal () { router.push('/film-engineering/classic') }
function gotoClassic () { router.push('/film-engineering/classic') }
</script>

<template>
  <div class="film-canvas-view">
    <header class="fcv-topbar">
      <div class="fcv-brand">
        <span class="fcv-title">{{ t('filmEngineering.canvas.title') }}</span>
        <span class="fcv-subtitle">{{ t('filmEngineering.canvas.subtitle') }}</span>
      </div>
      <div class="fcv-actions">
        <el-select v-model="chosen.aspect" size="small" class="fcv-select" data-testid="fcv-aspect">
          <el-option v-for="o in aspectOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="chosen.seconds" size="small" class="fcv-select" data-testid="fcv-seconds">
          <el-option v-for="o in durationOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-button size="small" :loading="adaptLoading" :disabled="!engineReady" data-testid="fcv-adapt" @click="onAdapt">{{ t('filmEngineering.canvas.adapt.btn') }}</el-button>
        <el-button size="small" :loading="uploading" :disabled="!engineReady" data-testid="fcv-upload-character" @click="pickFile('character')">{{ t('filmEngineering.canvas.upload.character') }}</el-button>
        <el-button size="small" :disabled="!engineReady" data-testid="fcv-upload-scene" @click="pickFile('scene')">{{ t('filmEngineering.canvas.upload.scene') }}</el-button>
        <el-button size="small" type="primary" :disabled="!engineReady || busy" data-testid="fcv-generate" @click="onGenerate(selectedShotIds.length ? selectedShotIds : allShotIds)">{{ t('filmEngineering.canvas.generate.btn') }}</el-button>
        <el-button size="small" data-testid="fcv-clear" @click="clearCanvas()">{{ t('filmEngineering.canvas.toolbar.clear') }}</el-button>
        <el-button size="small" link data-testid="fcv-classic" @click="gotoClassic">{{ t('filmEngineering.canvas.toolbar.classic') }}</el-button>
      </div>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" class="fcv-file" data-testid="fcv-file" @change="onFileChosen" />
    </header>

    <div class="fcv-script">
      <el-input v-model="form.script" type="textarea" :rows="3" :placeholder="t('filmEngineering.canvas.scriptPlaceholder')" data-testid="fcv-script" />
      <div class="fcv-script-meta">
        <span>{{ t('filmEngineering.canvas.adapt.scriptLimitHint') }}</span>
        <label class="fcv-llm">
          <input v-model="form.llmEnabled" type="checkbox" data-testid="fcv-llm" />
          {{ t('filmEngineering.canvas.llmEnabled') }}
        </label>
      </div>
    </div>

    <el-alert v-if="status && !status.available" class="fcv-alert" type="error" show-icon :closable="false"
      :title="t('filmEngineering.canvas.engineUnavailable')" :description="t('filmEngineering.canvas.engineUnavailableDesc')" />

    <div class="fcv-canvas">
      <VueFlow v-model:nodes="nodes" v-model:edges="edges" :default-viewport="{ zoom: 0.9 }" :min-zoom="0.3" :max-zoom="2" fit-view-on-init @connect="onConnect">
        <template #node-scriptInput="nodeProps">
          <ScriptInputNode v-bind="nodeProps" @remove="removeNode" />
        </template>
        <template #node-characterRef="nodeProps">
          <ReferenceNode v-bind="nodeProps" type="characterRef" @remove="removeNode" />
        </template>
        <template #node-sceneRef="nodeProps">
          <ReferenceNode v-bind="nodeProps" type="sceneRef" @remove="removeNode" />
        </template>
        <template #node-shot="nodeProps">
          <ShotNode v-bind="nodeProps" @remove="removeNode" />
        </template>
        <Background />
        <Controls />
        <MiniMap />
      </VueFlow>
    </div>

    <!-- 成本确认卡（生成闸前）：与经典视图同合同，确认后才计费 -->
    <el-dialog :model-value="costDialogVisible" :title="t('filmEngineering.canvas.cost.title')" width="420px" data-testid="fcv-cost-dialog">
      <p class="fcv-cost-hint">{{ t('filmEngineering.canvas.cost.hint', { n: costShotCount }) }}</p>
      <template #footer>
        <el-button data-testid="fcv-cost-cancel" @click="onCancelCost">{{ t('filmEngineering.canvas.toolbar.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" data-testid="fcv-cost-confirm" @click="onConfirmCost">{{ t('filmEngineering.canvas.toolbar.confirmCost') }}</el-button>
      </template>
    </el-dialog>

    <!-- 成片完成提示条 -->
    <div v-if="phase === 'done' && finalPath" class="fcv-final" data-testid="fcv-final">
      <span>{{ t('filmEngineering.canvas.final.title') }}</span>
      <el-button size="small" link @click="onOpenFinal">{{ t('filmEngineering.canvas.final.open') }}</el-button>
    </div>
  </div>
</template>

<style scoped>
.film-canvas-view { display: flex; flex-direction: column; height: 100%; min-height: 0; position: relative; }
.fcv-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--el-border-color, #dcdfe6); flex-wrap: wrap; }
.fcv-brand { display: flex; flex-direction: column; }
.fcv-title { font-size: 16px; font-weight: 600; }
.fcv-subtitle { font-size: 12px; color: var(--el-text-color-secondary, #909399); }
.fcv-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fcv-select { width: 110px; }
.fcv-file { display: none; }
.fcv-script { padding: 10px 16px; border-bottom: 1px solid var(--el-border-color, #dcdfe6); }
.fcv-script-meta { display: flex; justify-content: space-between; margin-top: 6px; font-size: 12px; color: var(--el-text-color-secondary, #909399); }
.fcv-llm { display: flex; align-items: center; gap: 4px; }
.fcv-alert { margin: 10px 16px; }
.fcv-canvas { flex: 1; min-height: 0; position: relative; }
.fcv-cost-hint { margin: 0; line-height: 1.6; }
.fcv-final { position: absolute; right: 24px; bottom: 24px; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; background: var(--el-color-success-light-9, #f0f9eb); color: var(--el-color-success, #67c23a); font-size: 13px; z-index: 10; }
</style>
