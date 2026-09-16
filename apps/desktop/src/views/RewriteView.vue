<template>
  <div class="rewrite-page">
    <div class="cohere-page-header">
      <div>
        <div class="page-title">{{ t('rewritePage.title') }}</div>
        <div class="page-subtitle">{{ t('rewritePage.subtitle') }}</div>
      </div>
    </div>

    <div class="cohere-content">
      <!-- 文本输入区 -->
      <div class="cohere-card rewrite-input-card">
        <div class="cohere-section-title">{{ t('rewritePage.inputSection') }}</div>
        <textarea
          v-model="content"
          class="rewrite-textarea"
          rows="8"
          :placeholder="t('rewritePage.inputPlaceholder')"
          :disabled="rewriting"
        ></textarea>
        <div class="rewrite-input-meta">
          <span class="char-count">{{ [...content].length }} {{ t('rewritePage.charCount') }}</span>
          <span v-if="contentError" class="content-error">{{ contentError }}</span>
        </div>
      </div>

      <!-- 配置选项 -->
      <div class="cohere-card rewrite-config-card">
        <div class="cohere-section-title">{{ t('rewritePage.configSection') }}</div>

        <!-- 内容依据：两个来源开关并排（勾选框左置 + 固定尺寸；标题与说明纵向排列）
             勾选框必须显式固定尺寸：父级是 flex 容器，checkbox 作为 flex item
             会被 align-self:stretch 拉伸到整行宽，原生勾选框因而被绘制到行的中央、
             脱离文字——这是改写设置区最主要的「错位 / 混乱」观感来源。 -->
        <div class="config-switches">
          <label class="config-switch" :class="{ disabled: rewriting, 'is-on': useViralLibrary }">
            <input
              type="checkbox"
              v-model="useViralLibrary"
              :disabled="rewriting"
              class="coral-check"
            />
            <span class="switch-body">
              <span class="checkbox-label switch-title">
                <span class="checkbox-icon switch-icon" aria-hidden="true">🔥</span>
                <span>{{ t('rewritePage.useViralLibrary') }}</span>
              </span>
              <span class="checkbox-hint switch-hint">{{ t('rewritePage.useViralLibraryHint') }}</span>
            </span>
          </label>
          <label class="config-switch" :class="{ disabled: rewriting, 'is-on': usePersonalExperience }">
            <input
              type="checkbox"
              v-model="usePersonalExperience"
              :disabled="rewriting"
              class="coral-check"
            />
            <span class="switch-body">
              <span class="checkbox-label switch-title">
                <span class="checkbox-icon switch-icon" aria-hidden="true">📝</span>
                <span>{{ t('rewritePage.usePersonalExperience') }}</span>
              </span>
              <span class="checkbox-hint switch-hint">{{ t('rewritePage.usePersonalExperienceHint') }}</span>
            </span>
          </label>
        </div>

        <!-- 改写模式 -->
        <div class="config-row">
          <label class="cohere-form-label">{{ t('rewritePage.modeLabel') }}</label>
          <div class="mode-chips">
            <button
              v-for="m in rewriteModes"
              :key="m.value"
              :class="['mode-chip', { active: rewriteMode === m.value }]"
              :disabled="rewriting"
              @click="rewriteMode = m.value"
            >{{ m.label }}</button>
          </div>
        </div>

        <!-- 字数控制 + 目标平台：两个短字段并排，避免单列堆叠在宽卡片右侧留下大片空白 -->
        <div class="config-grid">
          <!-- 字数控制 -->
          <div class="config-row">
            <label class="cohere-form-label">{{ t('rewritePage.wordCountLabel') }}</label>
            <WordCountRangeInput
              v-model:min="wordCountMin"
              v-model:max="wordCountMax"
              :min-placeholder="t('rewritePage.wordCountMinPlaceholder')"
              :max-placeholder="t('rewritePage.wordCountMaxPlaceholder')"
              :unit="t('rewritePage.wordCountUnit')"
              :error="wordCountError"
              :disabled="rewriting"
            />
          </div>

          <!-- 目标平台 -->
          <div class="config-row">
            <label class="cohere-form-label">{{ t('rewritePage.platformLabel') }}</label>
            <select v-model="platform" class="cohere-input config-select" :disabled="rewriting">
              <option value="">{{ t('rewriteEngine.platformGeneral') }}</option>
              <option value="douyin">{{ t('rewriteEngine.platformDouyin') }}</option>
              <option value="xiaohongshu">{{ t('rewriteEngine.platformXiaohongshu') }}</option>
              <option value="wechat_mp">{{ t('rewriteEngine.platformWechatMp') }}</option>
              <option value="bilibili">{{ t('rewriteEngine.platformBilibili') }}</option>
              <option value="zhihu">{{ t('rewriteEngine.platformZhihu') }}</option>
            </select>
          </div>
        </div>

        <!-- 策略选择（自动匹配默认 + 手动下拉，与 AiWriterPanel 行为一致） -->
        <RewriteStrategyPicker
          v-model:strategy-mode="strategyMode"
          v-model:strategy-id="rewriteStrategyId"
          :strategies="rewriteStrategies"
          :preview-name="previewStrategyName"
          :disabled="rewriting"
          :labels="{
            label: t('rewritePage.strategyLabel'),
            auto: t('rewritePage.strategyAuto'),
            manual: t('rewritePage.strategyManual'),
            preview: t('rewritePage.strategyPreview'),
            previewColon: t('rewritePage.strategyPreviewColon'),
            placeholder: t('rewritePage.strategySelectPlaceholder'),
          }"
        />

        <!-- 改写按钮：与上方配置字段用分隔线隔开，明确「先配置 → 后执行」的分段 -->
        <div class="rewrite-submit">
          <button
            class="cohere-btn-primary rewrite-start-btn"
            :disabled="rewriting || !canStartRewrite"
            @click="startRewrite"
          >
            {{ rewriting ? t('rewritePage.rewritingBtn') : t('rewritePage.rewriteBtn') }}
          </button>
        </div>
        <div v-if="rewriteError" class="rewrite-error" role="alert">{{ rewriteError }}</div>
      </div>

      <!-- 改写结果区 -->
      <div v-if="rewriteResult" class="cohere-card rewrite-result-card">
        <div class="cohere-section-title">{{ t('rewritePage.resultSection') }}</div>
        <div class="rewrite-result-meta" v-if="rewriteMeta">
          <span>{{ t('rewritePage.metaStrategy') }}：{{ rewriteMeta.strategyName }}</span>
          <span>{{ t('rewritePage.metaAiTaste') }}：{{ rewriteMeta.aiTastePct }}</span>
          <span>{{ t('rewritePage.metaLength', { original: rewriteMeta.originalLength, result: rewriteMeta.resultLength }) }}</span>
        </div>
        <!-- 改写质量评估报告（content-quality-eval 桌面端闭环）
             视觉：用左侧强调条表达结论等级，替代原先「卡片内再套一个带边框的卡片」 -->
        <div
          v-if="rewriteQuality"
          class="rewrite-quality-report"
          :class="'quality-accent-' + rewriteQuality.verdict"
          data-testid="rewrite-quality-report"
        >
          <div class="quality-head">{{ t('rewritePage.qualitySection') }}</div>
          <div class="rewrite-quality-metrics">
            <span class="quality-metric">
              {{ t('rewritePage.qualitySufficiency') }}：
              <strong>{{ rewriteQuality.sufficiency }}</strong>
            </span>
            <span class="quality-metric">
              {{ t('rewritePage.qualitySemantic') }}：
              <strong>{{ rewriteQuality.semanticPreservation }}</strong>
            </span>
            <span class="quality-metric">
              {{ t('rewritePage.qualityOriginality') }}：
              <strong>{{ rewriteQuality.originality }}</strong>
            </span>
            <span class="quality-metric">
              {{ t('rewritePage.qualityVerdict') }}：
              <strong :class="'quality-verdict-' + rewriteQuality.verdict">
                {{ t('rewritePage.qualityVerdict' + (rewriteQuality.verdict === 'pass' ? 'Pass' : rewriteQuality.verdict === 'warn' ? 'Warn' : 'Fail')) }}
              </strong>
            </span>
            <span class="quality-metric" v-if="rewriteQuality.method">
              {{ t('rewritePage.qualityMethod') }}：
              {{ t(rewriteQuality.method === 'embedding' ? 'rewritePage.qualityMethodEmbedding' : 'rewritePage.qualityMethodSimhash') }}
            </span>
          </div>
          <div v-if="Array.isArray(rewriteQuality.suggestions) && rewriteQuality.suggestions.length" class="rewrite-quality-suggestions">
            <div class="quality-suggestions-title">{{ t('rewritePage.qualitySuggestions') }}</div>
            <ul>
              <li v-for="(s, i) in rewriteQuality.suggestions" :key="i">{{ s }}</li>
            </ul>
          </div>
        </div>
        <div v-else-if="rewriteResult" class="rewrite-quality-none" data-testid="rewrite-quality-none">
          {{ t('rewritePage.qualityNone') }}
        </div>
        <textarea
          v-model="rewriteResult"
          class="rewrite-textarea result-textarea"
          rows="8"
        ></textarea>
        <!-- 改写结果快捷操作：复制到剪贴板（BUGFIX-REWRITE-QUALITY-UX） -->
        <div class="rewrite-copy-row">
          <button
            class="cohere-btn-secondary rewrite-copy-btn"
            data-testid="btn-copy-result"
            :disabled="!rewriteResult.trim()"
            @click="copyResult"
          >
            {{ copied ? t('rewritePage.copyResultDone') : t('rewritePage.copyResult') }}
          </button>
        </div>
        <div class="rewrite-result-actions">
          <button class="cohere-btn-secondary" @click="saveToDraft">
            {{ t('rewritePage.saveDraft') }}
          </button>
          <button class="cohere-btn-secondary" data-testid="btn-video-create" @click="goToVideoCreate">
            {{ t('rewritePage.goVideo') }}
          </button>
          <button class="cohere-btn-primary" @click="goToPublish">
            {{ t('rewritePage.goPublish') }}
          </button>
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
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { aiRewrite, aiListRewriteStrategies, aiGetRecommendedStrategies, draftSave, applyKnowledgeFeedback } from '@/api/publisher'
import { useNotify } from '@/composables/useNotify'
import { formatUserError } from '@/utils/user-facing-error'
import { useLoginGate } from '@/composables/useLoginGate'
import { useWordCountValidation } from '@/composables/useWordCountValidation'
import { useCopyLibrary } from '@/composables/useCopyLibrary'
import { takeRewriteHandoff } from '@/utils/rewrite-handoff'
import { writeClipboard } from '@/utils/clipboard'
import PublishDestinationModal from '@/components/PublishDestinationModal.vue'
import RewriteStrategyPicker from '@/components/RewriteStrategyPicker.vue'
import WordCountRangeInput from '@/components/WordCountRangeInput.vue'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const { notifySuccess, notifyError, notifyWarning } = useNotify()
const { ensureLogin } = useLoginGate()

// ── 状态 ──
const content = ref('')
const rewriting = ref(false)
const rewriteError = ref('')
const rewriteResult = ref('')
const rewriteMeta = ref(null)
// content-quality-eval 桌面端闭环：改写质量评估报告（RewriteQualityEvaluator 结果）
const rewriteQuality = ref(null)
// P2 隐式反馈：本次改写引用的知识条目（保存/发布=采纳 / 再次改写=弃用）
const rewriteKnowledgeRefs = ref([])
const contentError = ref('')
// 复制按钮瞬时反馈态：复制成功后按钮文案切换为「已复制」，1.5s 后复位（BUGFIX-REWRITE-QUALITY-UX）
const copied = ref(false)
let copiedTimer = null

// 配置
const useViralLibrary = ref(true)
const usePersonalExperience = ref(false)
const rewriteMode = ref('create')
const platform = ref('')
// 字数区间控制（默认 800-2000）
const wordCountMin = ref(800)
const wordCountMax = ref(2000)

// 策略选择（2026-09-15 改为默认「手动选择」展开下拉，降低发现成本；未选时仍传 null 走引擎自动匹配）
// 注：CopyRewriteModal / AiWriterPanel / Collection 采集页保持默认 auto，不受影响
const strategyMode = ref('manual')
const rewriteStrategyId = ref('')
const rewriteStrategies = ref([])
const previewStrategyName = ref('--')

// 弹窗
const showPublishModal = ref(false)
let savedDraftId = null

// ── 文案库交接（合并版「文案库」的【改写】按钮 → 本页）──
// 载荷含 fromKey：改写成功后把结果回写文案库（同一来源只保留最新一次改写结果）。
const libraryHandoff = ref(null)
const { upsertRewrite: upsertCopyRewrite } = useCopyLibrary()
// 本页平台下拉白名单：交接平台不在白名单时不带入（保持「通用」）
const REWRITE_PAGE_PLATFORMS = ['douyin', 'xiaohongshu', 'wechat_mp', 'bilibili', 'zhihu']

/** 消费文案库交接载荷：填入正文 → 仿写模式 → 平台带入（白名单内）→ 自动开始改写 */
function consumeLibraryHandoff () {
  const handoff = takeRewriteHandoff()
  if (!handoff || typeof handoff.content !== 'string' || !handoff.content.trim()) return
  rewriteMode.value = 'imitate'
  content.value = handoff.content
  if (REWRITE_PAGE_PLATFORMS.includes(handoff.platform)) platform.value = handoff.platform
  libraryHandoff.value = handoff
  // 等登录门禁与 DOM 就绪后自动触发（与 topic 带入同模式）
  Promise.resolve().then(() => startRewrite())
}

/**
 * 改写成功后回写文案库（同一 fromKey 覆盖为最新结果；失败静默，不影响改写主流程）。
 * @param {object|null} handoff - 本次改写对应的交接载荷（一次性，由 startRewrite 捕获后传入）
 */
async function syncHandoffToLibrary (handoff) {
  if (!handoff || !handoff.fromKey || !rewriteResult.value.trim()) return
  try {
    await upsertCopyRewrite({
      fromKey: handoff.fromKey,
      fromTitle: handoff.fromTitle || '',
      title: handoff.title || '',
      content: rewriteResult.value,
      platform: handoff.platform || '',
      sourceUrl: handoff.sourceUrl || '',
    })
  } catch {
    // 文案库回写失败不阻塞改写主流程
  }
}
// 跳转防重入（单一互斥锁）：连点/跨按钮并发点击不会重复存草稿、不会产生双草稿
let navigatingToDestination = false

// ── 选项 ──
const rewriteModes = [
  { value: 'imitate', label: t('rewritePage.modeImitate') },
  { value: 'expand', label: t('rewritePage.modeExpand') },
  { value: 'create', label: t('rewritePage.modeCreate') },
]

// ── 策略列表与匹配预览 ──
/** 加载启用策略（内置 + 远程下发）；失败静默降级为空列表，改写仍可用自动匹配 */
async function loadRewriteStrategies() {
  try {
    const res = await aiListRewriteStrategies()
    if (res && res.code === 0) rewriteStrategies.value = res.data || []
  } catch (_e) {
    // 策略列表为空时改写仍可用（走自动匹配）
  }
}

/** 预览请求序列号：快速切换平台时只保留最后一次请求的结果（竞态防护） */
let previewSeq = 0

/** 刷新自动匹配预览：取推荐列表第一名；失败降级为 --，不阻塞改写 */
async function refreshStrategyPreview() {
  if (rewriting.value) return
  const seq = ++previewSeq
  try {
    const res = await aiGetRecommendedStrategies({ platform: platform.value || undefined })
    if (seq !== previewSeq) return // 已有更新的请求，丢弃本次过期结果
    if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
      previewStrategyName.value = res.data[0].name || '--'
    } else {
      previewStrategyName.value = '--'
    }
  } catch (_e) {
    if (seq === previewSeq) previewStrategyName.value = '--'
  }
}

// 目标平台变化 → 预览随新 userSettings 刷新（refreshStrategyPreview 内含竞态守卫）
watch(platform, refreshStrategyPreview)

// 改写结果被用户编辑（textarea v-model）→ 已存草稿内容过期：置空 id，下次操作按当前内容重存
// （saveToDraft 成功后 savedDraftId 更新，此处仅在内容再次变化时失效，不构成循环）
watch(rewriteResult, (next, prev) => {
  if (savedDraftId && next !== prev) invalidateSavedDraft()
})

// ── 热门选题带入：/rewrite?topic=xxx → 填入输入框 + 选题创作模式 + 自动开始 ──
// ── 文案库交接带入：/rewrite?from=collection → 取 sessionStorage 交接载荷，仿写模式 + 自动开始 ──
// 交接载荷由 Collection.vue 合并版「文案库」的【改写】按钮写入（正文可能上万字，避免 URL 超长）。
onMounted(() => {
  void loadRewriteStrategies()
  void refreshStrategyPreview()
  const topic = typeof route.query.topic === 'string' ? route.query.topic.trim() : ''
  if (topic) {
    rewriteMode.value = 'create'
    // 选题带入：不再有 ≥20 字符限制（2026-09-12 移除最少字数）
    content.value = topic
    // 等登录门禁与 DOM 就绪后自动触发（nextTick 保证 textarea 绑定完成）
    Promise.resolve().then(() => startRewrite())
    return
  }
  // 选题带入与文案库交接互斥：topic 优先（老入口），否则尝试文案库交接
  if (route.query.from === 'collection') consumeLibraryHandoff()
})

// 组件卸载时清掉复制反馈定时器，避免卸载后 setState（BUGFIX-REWRITE-QUALITY-UX）
onUnmounted(() => {
  if (copiedTimer) {
    clearTimeout(copiedTimer)
    copiedTimer = null
  }
})

// ── 计算 ──
const canStartRewrite = computed(() => {
  return content.value.trim().length > 0 && !wordCountError.value
})

// ── 字数区间校验（共享 composable，与 Collection 页一致）──
const { error: wordCountError } = useWordCountValidation(wordCountMin, wordCountMax, (key) => t('rewritePage.' + key))

// ── 方法 ──

/** 开始改写 */
async function startRewrite() {
  const trimmed = content.value.trim()
  if (!trimmed) {
    contentError.value = t('rewritePage.contentEmpty')
    return
  }
  if (wordCountError.value) return
  contentError.value = ''
  if (!(await ensureLogin({ message: t('rewritePage.needLogin') }))) return

  rewriting.value = true
  rewriteError.value = ''
  // 交接一次性语义（审查 W-1）：无论本次改写成败都消费掉交接载荷，
  // 防止失败后残留的 fromKey 被后续无关改写静默覆盖文案库记录
  const handoffForRun = libraryHandoff.value
  libraryHandoff.value = null
  // P2 隐式反馈：上次改写结果未被保存/发布就再次改写 → 弃用上次引用的知识条目
  if (rewriteResult.value && rewriteKnowledgeRefs.value.length > 0) {
    sendKnowledgeFeedback('rejected', rewriteKnowledgeRefs.value)
  }
  rewriteResult.value = ''
  rewriteMeta.value = null
  rewriteKnowledgeRefs.value = []
  // CCG 评审修复：新改写开始前重置质量报告，避免上一次改写（无 quality）的旧报告残留
  rewriteQuality.value = null

  try {
    const params = {
      mode: rewriteMode.value,
      content: trimmed,
      userSettings: {
        platform: platform.value || undefined,
        wordCountRange: {
          min: Number(wordCountMin.value),
          max: Number(wordCountMax.value),
        },
        knowledgeOptions: {
          useViralLibrary: useViralLibrary.value,
          usePersonalKnowledge: usePersonalExperience.value,
        },
      },
      // 策略传参契约（与 AiWriterPanel 一致）：手动=所选 id（未选 null），自动=null 走引擎匹配
      strategyId: strategyMode.value === 'manual' ? (rewriteStrategyId.value || null) : null,
    }

    const res = await aiRewrite(params)
    if (res && res.code === 0 && res.data && res.data.success) {
      const data = res.data
      rewriteResult.value = data.result || ''
      // 新改写结果产生：旧草稿（如有）内容已过期，置空 id 让发布/视频创作按当前文案重存
      invalidateSavedDraft()
      // P2 隐式反馈：记录本次改写引用的知识条目
      rewriteKnowledgeRefs.value = data.knowledgeRefs || []
      // content-quality-eval：读取改写质量评估报告（RewriteQualityEvaluator 结果）
      // CCG 评审修复：quality 必须为纯对象（非数组）；verdict/method 非法值归一化；suggestions 必须为数组
      const q = data.quality && typeof data.quality === 'object' && !Array.isArray(data.quality) ? data.quality : null
      rewriteQuality.value = q ? {
        ...q,
        verdict: ['pass', 'warn', 'fail'].includes(q.verdict) ? q.verdict : 'fail',
        method: q.method === 'embedding' ? 'embedding' : 'simhash',
        suggestions: Array.isArray(q.suggestions) ? q.suggestions : [],
      } : null
      rewriteMeta.value = {
        strategyName: data.strategy?.name || '',
        aiTastePct: data.metadata?.aiTasteLevel != null ? (data.metadata.aiTasteLevel * 100).toFixed(0) + '%' : 'N/A',
        originalLength: data.metadata?.originalLength || 0,
        resultLength: data.metadata?.resultLength || 0,
      }
      if (data.warnings && data.warnings.length > 0) {
        rewriteError.value = data.warnings.join('；')
      }
      notifySuccess('collection.rewriteSuccess')
      // 文案库交接：来自合并版「文案库」的改写 → 结果回写文案库（旁路，失败静默）
      void syncHandoffToLibrary(handoffForRun)
    } else if (res && res.code === 0 && res.data && res.data.error) {
      rewriteError.value = res.data.error
      notifyError('collection.rewriteFailed', { message: res.data.error })
    } else {
      rewriteError.value = (res && res.message) || t('collection.rewriteFailed')
      notifyError('collection.rewriteFailed', { message: rewriteError.value || t('collection.rewriteFailed') })
    }
  } catch (e) {
    rewriteError.value = formatUserError(e, { fallback: t('collection.rewriteFailed') }).message
    notifyError('collection.rewriteFailed', { message: rewriteError.value || t('collection.rewriteFailed') })
  } finally {
    rewriting.value = false
    // 改写结束后刷新预览：改写期间平台可能已变化（rewriting 中不刷新），且引擎
    // 的用户历史（userHistory）在每次改写后更新，会影响下次自动匹配的推荐结果
    refreshStrategyPreview()
  }
}

/**
 * 复制改写结果到系统剪贴板（BUGFIX-REWRITE-QUALITY-UX）
 *
 * - 结果为空时不动作，仅提示（避免把空串写进剪贴板覆盖用户已有内容）
 * - 复制成功：toast + 按钮文案切「已复制」1.5s
 * - 复制失败：提示用户手动选中复制，并立即复位按钮态
 */
async function copyResult() {
  const text = rewriteResult.value
  if (!text || !text.trim()) {
    notifyWarning('rewritePage.copyEmpty')
    return
  }
  const ok = await writeClipboard(text)
  if (!ok) {
    if (copiedTimer) {
      clearTimeout(copiedTimer)
      copiedTimer = null
    }
    copied.value = false
    // key 已在 locales 成对登记，无需冗余 fallback（CCG 评审 I-4）
    notifyError('rewritePage.copyFailed')
    return
  }
  notifySuccess('rewritePage.copySuccess')
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copied.value = false
    copiedTimer = null
  }, 1500)
}

/** 存入草稿 */
async function saveToDraft() {
  if (!rewriteResult.value.trim()) return
  try {
    const saved = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: content.value.trim().slice(0, 64) || t('rewritePage.title'),
      content: rewriteResult.value,
      source: 'rewrite',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const res = await draftSave(saved)
    if (res && res.code === 0) {
      savedDraftId = saved.id
      // P2 隐式反馈：保存草稿 = 采纳被引用的知识条目
      sendKnowledgeFeedback('adopted', rewriteKnowledgeRefs.value)
      notifySuccess('collection.draftCreated')
    } else {
      notifyError('collection.rewriteFailed', { message: (res && res.message) || t('rewritePage.draftSaveFailed') })
    }
  } catch (e) {
    notifyError('collection.rewriteFailed', { message: formatUserError(e, { fallback: t('rewritePage.draftSaveFailed') }).message })
  }
}

/** P2 隐式反馈：把用户对改写结果的自然操作转换为知识反馈（静默失败不影响主流程） */
function sendKnowledgeFeedback(action, refs) {
  if (!refs || refs.length === 0) return
  try {
    applyKnowledgeFeedback(action, refs)
  } catch (_e) {
    // 知识反馈失败不影响改写主流程
  }
}

/** 去发布 — 先存草稿再弹窗 */
async function goToPublish() {
  if (!rewriteResult.value.trim()) return
  if (navigatingToDestination) return
  navigatingToDestination = true
  try {
    if (!savedDraftId) {
      await saveToDraft()
    }
    if (savedDraftId) {
      showPublishModal.value = true
    }
  } finally {
    navigatingToDestination = false
  }
}

/** 改写结果变化后旧草稿失效：置空 savedDraftId，下次发布/视频创作按当前文案重存 */
function invalidateSavedDraft() {
  savedDraftId = null
}

/** 视频创作 — 先存草稿，再带草稿 id 跳转视频创作页（用户在创作页选择流水线） */
async function goToVideoCreate() {
  if (!rewriteResult.value.trim()) return
  if (navigatingToDestination) return
  navigatingToDestination = true
  try {
    if (!savedDraftId) {
      await saveToDraft()
    }
    if (!savedDraftId) return // 保存失败已由 saveToDraft 提示，不再跳转
    router.push({ path: '/create', query: { draft: savedDraftId } })
  } finally {
    navigatingToDestination = false
  }
}

/** 弹窗回调：直接发图文 */
function onPublishArticle() {
  showPublishModal.value = false
  if (savedDraftId) {
    router.push('/publish?draft=' + savedDraftId)
  }
}

/** 弹窗回调：生成视频 */
function onPublishVideo(pipelineId) {
  showPublishModal.value = false
  if (!savedDraftId) return
  const query = { draft: savedDraftId }
  if (pipelineId) query.pipeline = pipelineId
  router.push({ path: '/create', query })
}
</script>

<style scoped>
/* ═══════════════════════════════════════════════════════════════════
   改写页视觉重构（2026-09-16）
   设计原则（交互设计师视角）：
   1. 一组内容 = 一组字段：配置项按「内容依据 → 改写模式 → 输出控制」
      三段组织；段内每个字段行布局完全统一（标签独占一行 + 控件下一行）。
   2. 一个控件只有一个视觉焦点：卡片标题建立层级；开关在勾选态用校色边框 +
      浅底表达「已启用」，未勾选为白底灰边。
   3. 交互信号不得误导：表单卡片不显示手型光标、不随悬停浮起（全局
      .cohere-card 是「卡片墙」语义，用在表单容器上会让人误以为整块可点）。
   4. 结果区有主次：元信息（轻文本）→ 质量评估（结论强调条）→ 动作（主次分离）。
   ═══════════════════════════════════════════════════════════════════ */

/* ── 卡片与标题 ──
   特异性取到 (0,3,0) 以稳定覆盖全局 .cohere-card:hover（(0,2,0)），
   不依赖样式表加载顺序。 */
.rewrite-input-card,
.rewrite-config-card,
.rewrite-result-card {
  margin-bottom: var(--space-lg);
  padding: var(--space-xl);
  cursor: default;
}
.rewrite-input-card.cohere-card:hover,
.rewrite-config-card.cohere-card:hover,
.rewrite-result-card.cohere-card:hover {
  background: var(--canvas);
  box-shadow: none;
}

/* 卡片标题：全局 .cohere-section-title 没有任何样式定义，此前退化为正文字号，
   卡片内所有内容层级相同——这是「界面混乱」的根因之一。 */
.cohere-section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.4;
  letter-spacing: -0.1px;
  margin-bottom: var(--space-lg);
}

/* ── 内容依据：两个来源开关并排（两列网格，窄屏回落单列）── */
.config-switches {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-sm);
  margin-bottom: var(--space-xl);
}
@media (max-width: 820px) {
  .config-switches { grid-template-columns: minmax(0, 1fr); }
}
.config-switch {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--r-sm);
  background: var(--canvas);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.config-switch:hover { border-color: var(--coral); }
.config-switch.is-on {
  border-color: var(--coral);
  background: var(--coral-soft);
}
.config-switch.disabled { opacity: 0.6; cursor: default; }
.config-switch.disabled:hover { border-color: var(--border-light); }
.config-switch.disabled.is-on { background: var(--coral-soft); }

/* 关键修复：勾选框固定尺寸。
   .config-switch 是 flex 容器，checkbox 作为 flex item 默认 align-self:stretch，
   会被拉伸到整行宽，原生勾选框因而绘制在行的中央、与文字脱离。 */
.config-switch input[type="checkbox"] {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin: 2px 0 0;
  accent-color: var(--coral);
}
.switch-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.switch-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ink);
  line-height: 1.4;
}
.switch-icon { font-size: 15px; line-height: 1; }
.switch-hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
}

/* ── 字段行：标签独占一行、控件在下一行。
   原实现里「目标平台」是唯一样式不同的字段（标签与下拉同一行），
   字段布局不统一正是「混乱」的来源；此处一次性拉齐，
   并用 :deep() 覆盖子组件（策略选择器）内部的同名标签。 ── */
.rewrite-config-card :deep(.cohere-form-label) {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  line-height: 1.4;
  margin-bottom: 6px;
}

.mode-chips {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.mode-chip {
  padding: 6px 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--r-sm);
  background: var(--canvas);
  cursor: pointer;
  font-size: 13px;
  color: var(--ink);
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.mode-chip:hover:not(:disabled) { border-color: var(--coral); }
.mode-chip.active {
  border-color: var(--coral);
  background: var(--coral-soft);
  color: var(--coral);
  font-weight: 500;
}
.mode-chip:disabled { opacity: 0.5; cursor: default; }

/* 字数区间：label 传空串时隐藏，避免 flex gap 留下 8px 视觉空隙 */
.config-row :deep(.word-count-label:empty) { display: none; }
/* 校验错误独占一行，避免把「- 2000 字」挤到下一行 */
.config-row :deep(.word-count-error) { flex-basis: 100%; margin-top: 2px; }

/* 短字段并排：字数控制 + 目标平台。只设列间距，行距交给 .config-row 的
   margin-bottom，保证与其它字段的垂直节奏一致。 */
.config-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: var(--space-xl);
}
@media (max-width: 820px) {
  .config-grid { grid-template-columns: minmax(0, 1fr); }
}

/* 策略选择器内部的单选文案字号与其它字段保持一致（子组件默认 12px） */
.rewrite-config-card :deep(.strategy-radio) { font-size: 13px; }
.rewrite-config-card :deep(.strategy-mode-row) { gap: var(--space-lg); }

/* 字段控件宽度对齐（下拉类统一 280px） */
.config-select {
  max-width: 280px;
  width: 100%;
}
.rewrite-config-card :deep(.strategy-select) {
  max-width: 280px;
  width: 100%;
}
.rewrite-config-card :deep(.strategy-preview) {
  margin-top: 6px;
  display: inline-block;
}

/* ── 执行区：与配置字段用分隔线断开，明确「先配置 → 后执行」 ── */
.rewrite-submit {
  margin-top: var(--space-lg);
  padding-top: var(--space-lg);
  border-top: 1px solid var(--border-light);
}
.rewrite-submit .rewrite-start-btn { margin-top: 0; }

/* ── 结果区 ── */
.rewrite-result-card .result-textarea { margin-top: var(--space-md); }

/* 质量评估：左侧结论强调条取代原先「结果卡片内再套一个带边框的卡片」，
   结论等级用颜色直接编码（合格 / 需注意 / 建议优化）。 */
.rewrite-quality-report {
  margin: 0 0 var(--space-md);
  padding: 2px 0 2px var(--space-lg);
  background: transparent;
  border: none;
  border-left: 3px solid var(--border-light);
  border-radius: 0;
}
.quality-accent-pass { border-left-color: #2e9e5b; }
.quality-accent-warn { border-left-color: #d97706; }
/* 结论=「建议优化」：去错误红，与 .quality-verdict-fail 同步降级为暖橙提示色
   （BUGFIX-REWRITE-QUALITY-UX 与 #1892 视觉重构的整合） */
.quality-accent-fail { border-left-color: #ea580c; }
.quality-head {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 6px;
}
.rewrite-quality-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
}
.quality-metric {
  font-size: 12px;
  color: var(--muted);
}
.quality-metric strong { font-weight: 600; color: var(--ink); }
.rewrite-quality-metrics .quality-verdict-pass { color: #2e9e5b; }
.rewrite-quality-metrics .quality-verdict-warn { color: #d97706; }
/* 结论文案已由「不合格」改为中性的「建议优化」：同步去掉错误红（#dc2626），
   降级为暖橙提示色，避免"失败/不可用"的错误观感（BUGFIX-REWRITE-QUALITY-UX） */
.rewrite-quality-metrics .quality-verdict-fail { color: #ea580c; }
.rewrite-quality-suggestions {
  margin: var(--space-sm) 0 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--muted);
}
.rewrite-quality-suggestions li { margin-bottom: 2px; }
.quality-suggestions-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink);
  margin-bottom: 4px;
}
.rewrite-quality-none {
  margin: 0 0 var(--space-md);
  font-size: 12px;
  color: var(--muted);
}

/* ── 改写结果快捷操作：复制（BUGFIX-REWRITE-QUALITY-UX）── */
.rewrite-copy-row {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-sm);
}
/* 固定最小宽度：按钮文案在「复制 / 已复制」间切换时不产生宽度跳动
   （88px 可容纳较宽的「✅ 已复制」，且远小于卡片宽度，不影响 BUGFIX-REWRITE-PAGE-WIDTH 的列宽稳定） */
.rewrite-copy-btn { min-width: 88px; }
.rewrite-copy-btn:disabled { opacity: 0.5; cursor: default; }

/* 结果区次操作按钮：全局 .cohere-btn-secondary 是零内边距的纯文本样式，
   在动作行与复制行中补内边距与悬停底色，使其成为可识别的按钮。 */
.rewrite-result-actions .cohere-btn-secondary,
.rewrite-copy-row .cohere-btn-secondary {
  padding: 8px 12px;
  border-radius: var(--r-sm);
  transition: background 0.15s, color 0.15s;
}
.rewrite-result-actions .cohere-btn-secondary:hover,
.rewrite-copy-row .cohere-btn-secondary:hover {
  background: var(--coral-soft);
  color: var(--coral);
}
</style>

