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
        <!-- 标题参考 chip（viral-rewrite-integration：爆款分析页生成标题带入） -->
        <div v-if="titleHint" class="rewrite-title-hint" data-testid="rewrite-title-hint">
          <span class="title-hint-text">{{ t('rewritePage.titleHintLabel') }}：{{ titleHint }}</span>
          <button
            class="cohere-btn-secondary title-hint-remove"
            data-testid="rewrite-title-hint-remove"
            :disabled="rewriting"
            @click="titleHint = ''"
          >{{ t('rewritePage.titleHintRemove') }}</button>
        </div>
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

        <!-- 结合爆款库 / 结合个人经历 -->
        <div class="config-checkboxes">
          <label class="config-checkbox" :class="{ disabled: rewriting }">
            <input
              type="checkbox"
              v-model="useViralLibrary"
              :disabled="rewriting"
              class="coral-check"
            />
            <span class="checkbox-label">
              <span class="checkbox-icon">🔥</span>
              <span>{{ t('rewritePage.useViralLibrary') }}</span>
            </span>
            <span class="checkbox-hint">{{ t('rewritePage.useViralLibraryHint') }}</span>
          </label>
          <label class="config-checkbox" :class="{ disabled: rewriting }">
            <input
              type="checkbox"
              v-model="usePersonalExperience"
              :disabled="rewriting"
              class="coral-check"
            />
            <span class="checkbox-label">
              <span class="checkbox-icon">📝</span>
              <span>{{ t('rewritePage.usePersonalExperience') }}</span>
            </span>
            <span class="checkbox-hint">{{ t('rewritePage.usePersonalExperienceHint') }}</span>
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

        <!-- 改写按钮 -->
        <button
          class="cohere-btn-primary rewrite-start-btn"
          :disabled="rewriting || !canStartRewrite"
          @click="startRewrite"
        >
          {{ rewriting ? t('rewritePage.rewritingBtn') : t('rewritePage.rewriteBtn') }}
        </button>
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
        <!-- 改写质量评估报告（content-quality-eval 桌面端闭环） -->
        <div v-if="rewriteQuality" class="rewrite-quality-report" data-testid="rewrite-quality-report">
          <div class="cohere-section-title">{{ t('rewritePage.qualitySection') }}</div>
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
            <!-- 爆款潜力第 4 维（viral-rewrite-integration）：改写前后对比；delta 缺失显示占位符 -->
            <span class="quality-metric" v-if="viralInfo" data-testid="rewrite-viral-info">
              {{ t('rewritePage.qualityViralLabel') }}：{{ t('rewritePage.qualityViralBefore') }} {{ viralInfo.original }} → {{ t('rewritePage.qualityViralAfter') }} {{ viralInfo.rewritten }}（{{ t('rewritePage.qualityViralDelta') }} {{ viralInfo.delta === null ? '-' : viralInfo.delta }}）
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
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { aiRewrite, aiListRewriteStrategies, aiGetRecommendedStrategies, draftSave, applyKnowledgeFeedback } from '@/api/publisher'
import { useNotify } from '@/composables/useNotify'
import { formatUserError } from '@/utils/user-facing-error'
import { useLoginGate } from '@/composables/useLoginGate'
import { useWordCountValidation } from '@/composables/useWordCountValidation'
import PublishDestinationModal from '@/components/PublishDestinationModal.vue'
import RewriteStrategyPicker from '@/components/RewriteStrategyPicker.vue'
import WordCountRangeInput from '@/components/WordCountRangeInput.vue'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const { notifySuccess, notifyError } = useNotify()
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

// viral-rewrite-integration：标题参考（爆款分析页生成标题经路由 query 带入）+ 爆款潜力对比
const titleHint = ref('')
const viralInfo = ref(null)

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
// ── 标题参考带入：/rewrite?titleHint=xxx → 显示可移除 chip，改写时作为软约束注入引擎 ──
onMounted(() => {
  void loadRewriteStrategies()
  void refreshStrategyPreview()
  const hint = typeof route.query.titleHint === 'string' ? route.query.titleHint.trim().slice(0, 200) : ''
  if (hint) titleHint.value = hint
  const topic = typeof route.query.topic === 'string' ? route.query.topic.trim() : ''
  if (!topic) return
  rewriteMode.value = 'create'
  // 选题带入：不再有 ≥20 字符限制（2026-09-12 移除最少字数）
  content.value = topic
  // 等登录门禁与 DOM 就绪后自动触发（nextTick 保证 textarea 绑定完成）
  Promise.resolve().then(() => startRewrite())
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
  // P2 隐式反馈：上次改写结果未被保存/发布就再次改写 → 弃用上次引用的知识条目
  if (rewriteResult.value && rewriteKnowledgeRefs.value.length > 0) {
    sendKnowledgeFeedback('rejected', rewriteKnowledgeRefs.value)
  }
  rewriteResult.value = ''
  rewriteMeta.value = null
  rewriteKnowledgeRefs.value = []
  // CCG 评审修复：新改写开始前重置质量报告，避免上一次改写（无 quality）的旧报告残留
  rewriteQuality.value = null
  viralInfo.value = null

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
      // viral-rewrite-integration：标题参考软约束（引擎侧清洗：空白折叠 + 200 字截断）
      titleHint: titleHint.value || undefined,
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
      // viral-rewrite-integration：爆款潜力对比（引擎 viralScorer 注入时才有；无效值归 null）
      const v = data.viral && typeof data.viral === 'object' && !Array.isArray(data.viral) ? data.viral : null
      viralInfo.value = v
        && typeof v.original === 'number' && Number.isFinite(v.original)
        && typeof v.rewritten === 'number' && Number.isFinite(v.rewritten)
        ? {
            original: v.original,
            rewritten: v.rewritten,
            delta: typeof v.delta === 'number' && Number.isFinite(v.delta) ? v.delta : null,
          }
        : null
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
.rewrite-input-card, .rewrite-config-card, .rewrite-result-card {
  margin-bottom: var(--space-lg);
  padding: var(--space-md);
}

.config-checkboxes {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: var(--space-md);
}
.config-checkbox {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.config-checkbox:hover { border-color: var(--coral); background: var(--coral-bg, #fef2f2); }
.config-checkbox.disabled { opacity: 0.6; cursor: default; }
.config-checkbox.disabled:hover { border-color: var(--border); background: transparent; }
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}
.checkbox-icon { font-size: 16px; }
.checkbox-hint {
  font-size: 12px;
  color: var(--muted);
  margin-left: 24px;
}

.mode-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.mode-chip {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  transition: all 0.15s;
}
.mode-chip:hover { border-color: var(--coral); }
.mode-chip.active {
  border-color: var(--coral);
  background: var(--coral-bg, #fef2f2);
  color: var(--coral);
  font-weight: 500;
}
.mode-chip:disabled { opacity: 0.5; cursor: default; }

.config-select {
  max-width: 280px;
}

/* ── 改写质量评估报告（content-quality-eval 桌面端闭环）── */
.rewrite-quality-report {
  margin: var(--space-md) 0;
  padding: var(--space-md);
  background: var(--surface-secondary, #f8f9fb);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.rewrite-quality-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin-top: var(--space-sm);
}
.quality-metric {
  font-size: 13px;
  color: var(--text-primary);
}
.quality-metric strong { font-weight: 600; }
.quality-verdict-pass { color: #2e9e5b; }
.quality-verdict-warn { color: #d97706; }
.quality-verdict-fail { color: #dc2626; }
.rewrite-quality-suggestions {
  margin: var(--space-sm) 0 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--text-secondary);
}
.rewrite-quality-suggestions li { margin-bottom: 4px; }
.rewrite-quality-none {
  margin: var(--space-sm) 0;
  font-size: 12px;
  color: var(--muted);
}

</style>

