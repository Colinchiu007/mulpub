<script setup>
/**
 * FilmAutoPanel — 影视工程「自动」模式面板（openspec change: film-auto-mode）
 *
 * 目标（用户原话）：越简单越好——输入一段文案、可选人物/场景参考图、设定横竖屏与大概时长，
 * 其余全部由程序完成生成与合成；生成后可对某个片段修改调整。
 *
 * 因此本面板只承担「人类必须做的那几步决策」：
 *   ① 输入  → ② 预览确认（清单式，非金额）→ ③ 运行（进度/逐镜状态）→ ④ 收口合成 → ⑤ 片段编辑
 * 其余一切（分场、镜数规划、提示词套用影视工程模板、角色槽位、参考绑定、分批、续跑、磁盘复核）
 * 全部在服务端（IPC/服务层）完成，面板不做任何业务推断——这是「应用底层全部积累」的纪律：
 * 面板越薄，越不可能绕过成本门槛与账本。
 *
 * 复用（不重造）：
 *   - 进度流程：story2video 的 `StageProgress.vue`（`testidPrefix="film-auto"` 参数化复用）
 *   - 合成路径：`pipelineStartOrchestrated('film-engineering', { initialContext: { renderManifest } })`
 *     ——与全量出片收口**同一条**引擎路径（manifest 直通 run，generate_videos 过闸零调用）
 *   - 参考图存储：`film-engineering:upload-reference`（受控媒体根 + 引用计数回收）
 *
 * 安全/正确性契约：
 *   - `auto-start` 只传 `{planId, taskId, confirmed, overwrite}`：分镜与参考图路径一律由服务端从
 *     自己落盘的计划重建，渲染端**不具备**伪造分镜的能力；
 *   - 未勾选确认 → 不调用 `auto-start`；服务端返回 `needsReconfirm`（编辑过/计划变更）时回到确认卡；
 *   - 事件推送优先 + 轮询兜底（3000ms），runId/taskId 守卫防止陈旧响应覆盖新状态（对齐 story2video 纪律）。
 */
import { useFilmAutoRefs } from './useFilmAutoRefs'
import { useFilmAutoRun } from './useFilmAutoRun'
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi } from '@/api/electron-bridge'
import { ElMessage } from 'element-plus'
import StageProgress from '@/views/video-creation/StageProgress.vue'
import FilmAutoSegmentEditor from './FilmAutoSegmentEditor.vue'
import MethodologyStatusPanel from './MethodologyStatusPanel.vue'
import { MAX_AUTO_SCRIPT_LENGTH, MAX_AUTO_REFS, MIN_AUTO_DURATION_SEC, MAX_AUTO_DURATION_SEC, AUTO_ASPECTS, AUTO_SHOT_SECONDS, AUTO_DEFAULT_ASPECT, AUTO_DEFAULT_SHOT_SECONDS, AUTO_DEFAULT_TARGET_DURATION_SEC, planShotCount } from './auto-constants'

const DURATION_PRESETS = Object.freeze([30, 60, 90, 120])
const props = defineProps({
  /** 注入 window.electronAPI.filmEngineering（测试用；生产为 null 时自动取全局） */
  api: { type: Object, default: null },
  pollIntervalMs: { type: Number, default: 3000 },
})

const { t } = useI18n()

function feApi () {
  if (props.api) return props.api
  // 经 src/api 桥接层取暴露面（Gate 10「前端一致性」：window.electronAPI 只允许出现在 src/api/**；
  // getApi 是全仓唯一定义，由 ipc-exposure-contract 契约测试守卫——不要在这里另写一份访问逻辑）
  const api = getApi()
  return (api && api.filmEngineering) || null
}

/** 阶段机：input（填表）→ preview（清单确认）→ running → done（可收口/可编辑） */
const phase = ref('input')
const busy = ref(false)
const errorText = ref('')

const form = reactive({
  script: '',
  aspect: AUTO_DEFAULT_ASPECT,
  targetDurationSec: AUTO_DEFAULT_TARGET_DURATION_SEC,
  shotSeconds: AUTO_DEFAULT_SHOT_SECONDS,
})
/** 服务端预览投影（完整提示词只在服务端计划文件里） */
const plan = ref(null)
/** 项目视图（auto-status 投影；含可编辑 shots） */
const project = ref(null)
const confirmed = ref(false)
const overwriteExisting = ref(false)
const editingShotIndex = ref(null)
/** 最近一次失败的错误码（面板据此给出可解除的处置入口，如同名任务的「覆盖」勾选） */
const errorCode = ref('')
const scriptLength = computed(() => String(form.script || '').trim().length)
const scriptTooLong = computed(() => scriptLength.value > MAX_AUTO_SCRIPT_LENGTH)
const durationValid = computed(() => (
  Number.isInteger(form.targetDurationSec) &&
  form.targetDurationSec >= MIN_AUTO_DURATION_SEC &&
  form.targetDurationSec <= MAX_AUTO_DURATION_SEC
))
const estimatedShots = computed(() => planShotCount(form.targetDurationSec, form.shotSeconds))
/**
 * 方法论接入状态（第 9 轮 i4）。
 *
 * 面板这块**只读状态**在两种状态下都要可见：
 *   - 刚规划完 ⇒ 数据来自规划结果（`plan.methodology`）；
 *   - **重开一个已规划的项目** ⇒ 规划结果不在内存里，只有落盘的
 *     `promptContext` + 逐镜 `promptMissing` ⇒ 由服务端用**同一个**
 *     `buildMethodologySummary` 重新汇总（`project.methodology`）。
 *
 * ⚠ 汇总逻辑**只在主进程有一份**（渲染端不另写实现）——
 * 两份实现必然漂移，而漂移会让「面板显示的接上量」与「落盘的清单」对不上。
 */
const methodology = computed(() => {
  const fromPlan = plan.value && plan.value.methodology
  if (fromPlan) return fromPlan
  const fromProject = project.value && project.value.methodology
  return fromProject || null
})
const canPlan = computed(() => !busy.value && scriptLength.value > 0 && !scriptTooLong.value && durationValid.value)
function fail (message, code) {
  errorCode.value = code || ''
  errorText.value = message || t('filmEngineering.auto.genericError')
  ElMessage.error(errorText.value)
}

function unwrap (res) {
  if (!res || res.code !== 0) {
    const err = new Error((res && res.message) || 'IPC error')
    err.errorCode = res && res.errorCode
    err.envelope = res
    throw err
  }
  return res.data
}
// ── ① → ② 规划（零 provider 调用）──────────────────────────────────────

async function runPlan () {
  const api = feApi()
  if (!api) return fail(t('filmEngineering.auto.noDesktop'))
  if (!canPlan.value) return fail(scriptTooLong.value ? t('filmEngineering.auto.scriptTooLong') : t('filmEngineering.auto.durationRange', { min: MIN_AUTO_DURATION_SEC, max: MAX_AUTO_DURATION_SEC }))
  busy.value = true
  errorText.value = ''
  try {
    const payload = JSON.parse(JSON.stringify({
      script: form.script,
      characterRefs: characterRefs.value,
      sceneRefs: sceneRefs.value,
      aspect: form.aspect,
      seconds: Number(form.shotSeconds),
      targetDurationSec: Number(form.targetDurationSec),
    }))
    const data = unwrap(await api.autoPlan(payload))
    plan.value = data
    project.value = null
    progress.value = { doneCount: 0, totalCount: Number(data.shotCount) || 0, batchIndex: null, lastType: '' }
    confirmed.value = false
    overwriteExisting.value = false
    phase.value = 'preview'
  } catch (e) {
    fail((e && e.message) || String(e))
  } finally {
    busy.value = false
  }
}

// ── ② → ③ 启动（服务端重建分镜；渲染端只递确认与归属）──────────────────

async function startRun () {
  const api = feApi()
  if (!api) return fail(t('filmEngineering.auto.noDesktop'))
  if (!plan.value) return
  if (!confirmed.value) return fail(t('filmEngineering.auto.mustConfirm'))
  busy.value = true
  errorText.value = ''
  try {
    const payload = JSON.parse(JSON.stringify({
      planId: plan.value.planId,
      taskId: plan.value.taskId,
      confirmed: true,
      overwrite: overwriteExisting.value === true,
    }))
    const data = unwrap(await api.autoStart(payload))
    if (data && data.needsReconfirm) {
      // 服务端认为需要重新确认（计划变更/此前编辑过）——回到确认卡，不偷偷开跑
      confirmed.value = false
      phase.value = 'preview'
      return
    }
    // 记住任务 ID：这是「重新打开可续跑」的界面落点
    persistLastTask(plan.value.taskId)
    stopping.value = false
    progress.value = { doneCount: Number(data.doneCount) || 0, totalCount: Number(data.totalCount) || progress.value.totalCount, batchIndex: null, lastType: '' }
    if (data && data.stopped) {
      // 用户中途停止：批间生效，未跑的批保持待跑。已确认过的载荷没有变化（needsReconfirm=false），
      // 因此这里把勾选还原为已确认状态，让「继续生成」一键可点即可续跑。
      confirmed.value = true
      phase.value = 'preview'
    } else if (data && Array.isArray(data.renderManifest) && data.renderManifest.length > 0) {
      phase.value = 'done'
    } else {
      phase.value = 'running'
      startPolling()
    }
    await refreshStatus()
  } catch (e) {
    fail((e && e.message) || String(e), e && e.errorCode)
  } finally {
    busy.value = false
  }
}

// ── 两块职责已抽成 composable（拆分动因：CI 行数门禁 500 行）──────────────
// 模板可见名一律经解构保持同名：模板只能看到 setup 作用域的绑定，不能透过 defineExpose。
const {
  characterRefs, sceneRefs, uploadingKind,
  pickRefFile, uploadRefFile, readAsDataUrl, removeCharRef, removeSceneRef,
} = useFilmAutoRefs({ feApi, t, form, errorText, fail, unwrap })

const {
  progress, composeRunId, composePercent, composePhase, composeError, finalPath, finalUnavailable,
  stopping, restored,
  percent, stepIndex, stageList, shots, missingShots, canCompose, finalFileUrl, diskEstimateText, wallclockText,
  refreshStatus, applyAutoEvent, startPolling, stopPolling, persistLastTask, readLastTask,
  stopRun, restoreLastTask, applyComposeSnapshot, compose, pollComposeRun, startComposePolling, stopComposePolling,
  openFinalFolder, saveFinalAs, openEditor, saveShotEdit, regenerateShot, resetAll,
} = useFilmAutoRun({ feApi, t, props, phase, project, plan, busy, errorText, errorCode, form, editingShotIndex, fail, unwrap })

defineExpose({
  form, plan, project, phase, busy, errorText, errorCode, confirmed, overwriteExisting, editingShotIndex,
  scriptLength, scriptTooLong, durationValid, estimatedShots, canPlan,
  runPlan, startRun, fail, unwrap,
  characterRefs, sceneRefs, uploadingKind, pickRefFile, uploadRefFile, readAsDataUrl, removeCharRef, removeSceneRef,
  progress, composeRunId, composePercent, composePhase, composeError, finalPath, finalUnavailable,
  stopping, restored, percent, stepIndex, stageList, shots, missingShots, canCompose, finalFileUrl,
  diskEstimateText, wallclockText, refreshStatus, applyAutoEvent, startPolling, stopPolling,
  persistLastTask, readLastTask, stopRun, restoreLastTask, applyComposeSnapshot, compose,
  openFinalFolder, saveFinalAs, openEditor, saveShotEdit, regenerateShot, resetAll,
})
</script>

<template>
  <div class="fa-panel" data-testid="film-auto-panel">
    <el-steps :active="stepIndex" simple class="fa-steps">
      <el-step :title="t('filmEngineering.auto.stepInput')" />
      <el-step :title="t('filmEngineering.auto.stepConfirm')" />
      <el-step :title="t('filmEngineering.auto.stepRun')" />
      <el-step :title="t('filmEngineering.auto.stepDone')" />
    </el-steps>

    <p v-if="errorText" class="fa-error fa-error-bar" data-testid="fa-error">{{ errorText }}</p>

    <!-- ① 输入 -->
    <section class="fa-card">
      <label class="fa-label" for="fa-script">{{ t('filmEngineering.auto.scriptLabel') }}</label>
      <el-input
        id="fa-script"
        v-model="form.script"
        type="textarea"
        :rows="8"
        :maxlength="MAX_AUTO_SCRIPT_LENGTH"
        :placeholder="t('filmEngineering.auto.scriptPlaceholder')"
        data-testid="fa-script"
      />
      <div class="fa-meta">
        <span :class="{ 'is-danger': scriptTooLong }" data-testid="fa-script-count">{{ t('filmEngineering.auto.scriptCount', { n: scriptLength }) }}</span>
        <span v-if="scriptTooLong" class="fa-error">{{ t('filmEngineering.auto.scriptTooLong') }}</span>
      </div>
    </section>

    <section class="fa-card">
      <div class="fa-label">{{ t('filmEngineering.auto.charRefs') }}</div>
      <p class="fa-hint">{{ t('filmEngineering.auto.charRefsHint', { max: MAX_AUTO_REFS }) }}</p>
      <ul v-if="characterRefs.length" class="fa-ref-list" data-testid="fa-char-refs">
        <li v-for="(r, i) in characterRefs" :key="r.path + i" class="fa-ref-item">
          <el-input v-model="r.name" size="small" class="fa-ref-name" :placeholder="t('filmEngineering.auto.charNamePlaceholder')" :data-testid="'fa-char-name-' + i" />
          <span class="fa-ref-path" :title="r.path">{{ r.path }}</span>
          <el-button size="small" link :data-testid="'fa-char-remove-' + i" @click="removeCharRef(i)">{{ t('filmEngineering.auto.remove') }}</el-button>
        </li>
      </ul>
      <el-button size="small" :loading="uploadingKind === 'character'" :disabled="characterRefs.length >= MAX_AUTO_REFS" data-testid="fa-add-char" @click="pickRefFile('character')">
        {{ t('filmEngineering.auto.addCharRef') }}
      </el-button>
    </section>

    <section class="fa-card">
      <div class="fa-label">{{ t('filmEngineering.auto.sceneRefs') }}</div>
      <p class="fa-hint">{{ t('filmEngineering.auto.sceneRefsHint', { max: MAX_AUTO_REFS }) }}</p>
      <ul v-if="sceneRefs.length" class="fa-ref-list" data-testid="fa-scene-refs">
        <li v-for="(p, i) in sceneRefs" :key="p + i" class="fa-ref-item">
          <span class="fa-ref-path" :title="p">{{ p }}</span>
          <el-button size="small" link @click="removeSceneRef(i)">{{ t('filmEngineering.auto.remove') }}</el-button>
        </li>
      </ul>
      <el-button size="small" :loading="uploadingKind === 'scene'" :disabled="sceneRefs.length >= MAX_AUTO_REFS" data-testid="fa-add-scene" @click="pickRefFile('scene')">
        {{ t('filmEngineering.auto.addSceneRef') }}
      </el-button>
    </section>

    <section class="fa-card fa-row">
      <div class="fa-field">
        <div class="fa-label">{{ t('filmEngineering.auto.aspect') }}</div>
        <div class="fa-choices" role="radiogroup" :aria-label="t('filmEngineering.auto.aspect')">
          <label v-for="a in AUTO_ASPECTS" :key="a" class="fa-choice">
            <input v-model="form.aspect" type="radio" :value="a" :data-testid="'fa-aspect-' + a" />
            <span>{{ a === '9x16' ? t('filmEngineering.auto.aspect916') : t('filmEngineering.auto.aspect169') }}</span>
          </label>
        </div>
      </div>
      <div class="fa-field">
        <div class="fa-label">{{ t('filmEngineering.auto.duration') }}</div>
        <div class="fa-choices">
          <button
            v-for="p in DURATION_PRESETS"
            :key="p"
            type="button"
            :class="['fa-chip', { active: Number(form.targetDurationSec) === p }]"
            :data-testid="'fa-duration-preset-' + p"
            @click="form.targetDurationSec = p"
          >{{ t('filmEngineering.auto.durationPreset', { n: p }) }}</button>
        </div>
        <el-input v-model.number="form.targetDurationSec" size="small" type="number" data-testid="fa-duration" />
        <p v-if="!durationValid" class="fa-error">{{ t('filmEngineering.auto.durationRange', { min: MIN_AUTO_DURATION_SEC, max: MAX_AUTO_DURATION_SEC }) }}</p>
      </div>
    </section>

    <el-collapse class="fa-advanced">
      <el-collapse-item :title="t('filmEngineering.auto.advanced')" name="advanced">
        <div class="fa-label">{{ t('filmEngineering.auto.shotSeconds') }}</div>
        <el-select v-model="form.shotSeconds" size="small" data-testid="fa-shot-seconds">
          <el-option v-for="s in AUTO_SHOT_SECONDS" :key="s" :label="t('filmEngineering.auto.shotSecondsN', { n: s })" :value="s" />
        </el-select>
      </el-collapse-item>
    </el-collapse>

    <section class="fa-card fa-actions">
      <p class="fa-estimate" data-testid="fa-estimate">
        {{ t('filmEngineering.auto.estimate', { shots: estimatedShots, seconds: estimatedShots * Number(form.shotSeconds) }) }}
      </p>
      <el-button type="primary" size="small" :disabled="!canPlan" :loading="busy" data-testid="fa-plan" @click="runPlan">
        {{ t('filmEngineering.auto.planBtn') }}
      </el-button>
    </section>

    <!-- ② 预览确认（清单式；确认前零调用） -->
    <section v-if="plan" class="fa-card" data-testid="fa-preview">
      <div class="fa-label">{{ t('filmEngineering.auto.previewTitle') }}</div>
      <dl class="fa-kv">
        <div><dt>{{ t('filmEngineering.auto.kvTask') }}</dt><dd data-testid="fa-kv-task">{{ plan.taskId }}</dd></div>
        <div><dt>{{ t('filmEngineering.auto.kvShots') }}</dt><dd data-testid="fa-kv-shots">{{ plan.shotCount }}</dd></div>
        <div><dt>{{ t('filmEngineering.auto.kvBatches') }}</dt><dd>{{ plan.batchCount }}</dd></div>
        <div><dt>{{ t('filmEngineering.auto.kvDuration') }}</dt><dd>{{ t('filmEngineering.auto.kvDurationValue', { planned: plan.plannedDurationSec, target: plan.targetDurationSec }) }}</dd></div>
        <div><dt>{{ t('filmEngineering.auto.kvAspect') }}</dt><dd>{{ plan.aspect === '9x16' ? t('filmEngineering.auto.aspect916') : t('filmEngineering.auto.aspect169') }}</dd></div>
        <div><dt>{{ t('filmEngineering.auto.kvProvider') }}</dt><dd>{{ plan.provider && plan.provider.id ? plan.provider.id : t('filmEngineering.auto.kvProviderNone') }}</dd></div>
        <div><dt>{{ t('filmEngineering.auto.kvRefs') }}</dt><dd>{{ plan.shotsWithReferences }}</dd></div>
        <div v-if="diskEstimateText"><dt>{{ t('filmEngineering.auto.kvDisk') }}</dt><dd data-testid="fa-kv-disk">{{ diskEstimateText }}</dd></div>
        <div v-if="wallclockText"><dt>{{ t('filmEngineering.auto.kvWallclock') }}</dt><dd data-testid="fa-kv-wallclock">{{ wallclockText }}</dd></div>
      </dl>

      <div v-if="plan.warnings && plan.warnings.length" class="fa-warnings" data-testid="fa-warnings">
        <div class="fa-label">{{ t('filmEngineering.auto.warningsTitle') }}</div>
        <ul>
          <li v-for="(w, i) in plan.warnings" :key="w.code + i" :data-testid="'fa-warning-' + w.code">{{ w.message }}</li>
        </ul>
      </div>

      <div v-if="plan.characterMap && Object.keys(plan.characterMap).length" class="fa-charmap" data-testid="fa-charmap">
        <span class="fa-label">{{ t('filmEngineering.auto.charMapTitle') }}</span>
        <span v-for="(name, slot) in plan.characterMap" :key="slot" class="fa-chip">{{ slot }} → {{ name }}</span>
      </div>

      <ul class="fa-shot-preview" data-testid="fa-shot-preview">
        <li v-for="s in plan.shots" :key="s.shotId">
          <span class="fa-shot-id">{{ s.shotId }}</span>
          <span class="fa-shot-title">{{ s.title }}</span>
          <span class="fa-shot-len">{{ t('filmEngineering.auto.promptChars', { n: s.promptLength }) }}</span>
          <span v-if="s.refPaths && s.refPaths.length" class="fa-shot-refs">🖼 {{ s.refPaths.length }}</span>
        </li>
      </ul>

      <!-- 同名任务冲突：服务端返回 AUTO_TASK_EXISTS 后给出可解除的显式入口（旧一轮会被归档保留） -->
      <div v-if="errorCode === 'AUTO_TASK_EXISTS'" class="fa-overwrite" data-testid="fa-overwrite-box">
        <label class="fa-confirm">
          <input v-model="overwriteExisting" type="checkbox" data-testid="fa-overwrite-check" />
          <span>{{ t('filmEngineering.auto.overwriteLabel', { taskId: plan.taskId }) }}</span>
        </label>
        <p class="fa-hint">{{ t('filmEngineering.auto.overwriteHint') }}</p>
      </div>

      <label class="fa-confirm">
        <input v-model="confirmed" type="checkbox" data-testid="fa-confirm-check" />
        <span>{{ t('filmEngineering.auto.confirmCheckbox', { shots: plan.shotCount, seconds: plan.plannedDurationSec }) }}</span>
      </label>
      <p class="fa-hint" data-testid="fa-confirm-hint">{{ t('filmEngineering.auto.confirmHint') }}</p>
      <el-button type="primary" size="small" :disabled="!confirmed" :loading="busy" data-testid="fa-start" @click="startRun">
        {{ t('filmEngineering.auto.startBtn') }}
      </el-button>
    </section>

    <!-- 影视工程 v2 · F-I：方法论接入状态（只读；回答「我的自动分镜接上了多少方法论」）
         独立成块（第 9 轮 i4）：刚规划完与**重开一个已规划的项目**两种状态下都要可见 ——
         数据源分别是 plan.methodology 与 project.methodology（**同一份**主进程汇总实现）。
         标记与文案在子组件 MethodologyStatusPanel.vue（拆分动因：CI 行数门禁 500 行；
         外层卡片留在本组件，因为它用的是本组件的 scoped .fa-card 样式）。 -->
    <section v-if="methodology" class="fa-card" data-testid="fa-methodology-card">
      <MethodologyStatusPanel :methodology="methodology" />
    </section>

    <!-- ③ 运行 / ④ 收口 / ⑤ 片段编辑 -->
    <section v-if="phase === 'running' || phase === 'done'" class="fa-card" data-testid="fa-run">
      <StageProgress
        :stages="stageList"
        :progress-percent="percent"
        :summary="t('filmEngineering.auto.runSummary', { done: progress.doneCount, total: progress.totalCount })"
        testid-prefix="film-auto"
      />
      <div v-if="phase === 'running'" class="fa-actions">
        <el-button size="small" :loading="stopping" :disabled="stopping" data-testid="fa-stop" @click="stopRun">
          {{ stopping ? t('filmEngineering.auto.stopping') : t('filmEngineering.auto.stopBtn') }}
        </el-button>
        <span v-if="stopping" class="fa-hint" data-testid="fa-stopping-hint">{{ t('filmEngineering.auto.stopRequested') }}</span>
      </div>
      <p class="fa-hint" data-testid="fa-run-hint">{{ t('filmEngineering.auto.runHint') }}</p>

      <table v-if="shots.length" class="fa-shots" data-testid="fa-shots">
        <thead>
          <tr>
            <th>{{ t('filmEngineering.auto.colIndex') }}</th>
            <th>{{ t('filmEngineering.auto.colStatus') }}</th>
            <th>{{ t('filmEngineering.auto.colError') }}</th>
            <th>{{ t('filmEngineering.auto.colActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in shots" :key="s.shotId" :data-testid="'fa-shot-' + s.shotId">
            <td>{{ s.shotId }}</td>
            <td :data-testid="'fa-shot-status-' + s.shotId">{{ t('filmEngineering.auto.shotStatus.' + (s.status || 'pending')) }}</td>
            <td class="fa-shot-error">{{ s.error || '' }}</td>
            <td>
              <el-button size="small" link :data-testid="'fa-edit-' + s.shotId" @click="openEditor(s.index)">{{ t('filmEngineering.auto.editShot') }}</el-button>
              <el-button size="small" link :data-testid="'fa-regen-' + s.shotId" @click="regenerateShot(s.index)">{{ t('filmEngineering.auto.regenShot') }}</el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="phase === 'done'" class="fa-card" data-testid="fa-done">
      <p v-if="finalUnavailable" class="fa-error" data-testid="fa-manifest-error">{{ finalUnavailable }}</p>
      <p v-if="missingShots.length" class="fa-error" data-testid="fa-missing-shots">
        {{ t('filmEngineering.auto.missingShots', { n: missingShots.length, list: missingShots.map((s) => s.shotId).join(', ') }) }}
      </p>
      <div class="fa-actions">
        <el-button type="primary" size="small" :loading="busy" :disabled="!canCompose" data-testid="fa-compose" @click="compose">
          {{ t('filmEngineering.auto.composeBtn') }}
        </el-button>
        <span v-if="composeRunId" class="fa-hint" data-testid="fa-compose-run">{{ t('filmEngineering.auto.composeRunning', { runId: composeRunId, percent: composePercent }) }}</span>
        <el-button size="small" data-testid="fa-reset" @click="resetAll">{{ t('filmEngineering.auto.resetBtn') }}</el-button>
      </div>
      <p v-if="composeError" class="fa-error" data-testid="fa-compose-error">{{ composeError }}</p>
      <!-- 成片预览与落盘入口：复用故事讲述流水线的 reveal/save 合同（主进程 sender 校验 + 路径越界防护） -->
      <div v-if="finalFileUrl" class="fa-final" data-testid="fa-final">
        <video class="fa-final-video" :src="finalFileUrl" controls data-testid="fa-final-video"></video>
        <div class="fa-actions">
          <el-button size="small" data-testid="fa-final-folder" @click="openFinalFolder">{{ t('filmEngineering.auto.openFolder') }}</el-button>
          <el-button size="small" data-testid="fa-final-saveas" @click="saveFinalAs">{{ t('filmEngineering.auto.saveAs') }}</el-button>
        </div>
      </div>
    </section>

    <FilmAutoSegmentEditor
      v-if="editingShotIndex !== null"
      :shot="shots.find((s) => s.index === editingShotIndex) || null"
      :shot-index="editingShotIndex"
      @close="editingShotIndex = null"
      @save="saveShotEdit"
      @regenerate="regenerateShot"
    />
  </div>
</template>
<style scoped src="./film-auto-panel.css"></style>
