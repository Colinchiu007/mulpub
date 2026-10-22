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
          <!-- P1-E 评审 W-2：信号注入用户可感知（计数标识）；W-1：移除 chip 同时清信号（语义一致） -->
          <span v-if="viralAngles.length || viralKeywords.length" data-testid="rewrite-signal-badge" style="font-size: var(--font-size-xs);color:var(--muted)">
            {{ t('rewritePage.signalBadge') }}（{{ viralAngles.length + viralKeywords.length }}）
          </span>
          <span v-if="viralEngagement" data-testid="rewrite-strength-badge" style="font-size: var(--font-size-xs);color:var(--muted)">{{ t('rewritePage.strengthRefLabel') }}</span>
          <button
            class="cohere-btn-secondary title-hint-remove"
            data-testid="rewrite-title-hint-remove"
            :disabled="rewriting"
            @click="clearTitleHint"
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
                <span class="checkbox-icon switch-icon" aria-hidden="true"><el-icon><TrendCharts /></el-icon></span>
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
                <span class="checkbox-icon switch-icon" aria-hidden="true"><el-icon><Document /></el-icon></span>
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
              @click="onModeChipClick(m.value)"
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
              @update:min="markWordCountManuallySet"
              @update:max="markWordCountManuallySet"
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

        <!-- 行业 / 目的 / 语气：三个短字段并排 -->
        <!-- 存在意义（rewrite-default-strategy-fix）：改写页此前只发 platform，industry/purpose/tone
             根本不下发 ⇒ StrategyMatcher 拿到空输入 ⇒ 五维全拿基础分并列 ⇒ 退化为取数组首项。
             补上这三个真实输入，匹配器才有可匹配的信号（对应 PRD R1）。 -->
        <div class="config-grid config-grid--three">
          <div class="config-row">
            <label class="cohere-form-label">{{ t('rewriteEngine.industryLabel') }}</label>
            <select v-model="industry" class="cohere-input config-select" :disabled="rewriting">
              <option value="">{{ t('rewriteEngine.industryGeneral') }}</option>
              <option value="technology">{{ t('rewriteEngine.industryTechnology') }}</option>
              <option value="ecommerce">{{ t('rewriteEngine.industryEcommerce') }}</option>
              <option value="education">{{ t('rewriteEngine.industryEducation') }}</option>
              <option value="finance">{{ t('rewriteEngine.industryFinance') }}</option>
              <option value="lifestyle">{{ t('rewriteEngine.industryLifestyle') }}</option>
              <option value="beauty">{{ t('rewriteEngine.industryBeauty') }}</option>
              <option value="entertainment">{{ t('rewriteEngine.industryEntertainment') }}</option>
              <option value="ip-building">{{ t('rewriteEngine.industryIpBuilding') }}</option>
            </select>
          </div>

          <div class="config-row">
            <label class="cohere-form-label">{{ t('rewriteEngine.purposeLabel') }}</label>
            <select v-model="purpose" class="cohere-input config-select" :disabled="rewriting">
              <option value="">{{ t('rewriteEngine.purposeGeneral') }}</option>
              <option value="engagement">{{ t('rewriteEngine.purposeEngagement') }}</option>
              <option value="conversion">{{ t('rewriteEngine.purposeConversion') }}</option>
              <option value="follower-growth">{{ t('rewriteEngine.purposeFollowerGrowth') }}</option>
              <option value="authority-building">{{ t('rewriteEngine.purposeAuthority') }}</option>
              <option value="sales">{{ t('rewriteEngine.purposeSales') }}</option>
            </select>
          </div>

          <div class="config-row">
            <label class="cohere-form-label">{{ t('rewriteEngine.toneLabel') }}</label>
            <select v-model="tone" class="cohere-input config-select" :disabled="rewriting">
              <option value="">{{ t('rewriteEngine.toneGeneral') }}</option>
              <option value="casual">{{ t('rewriteEngine.toneCasual') }}</option>
              <option value="storytelling">{{ t('rewriteEngine.toneStorytelling') }}</option>
              <option value="emotional">{{ t('rewriteEngine.toneEmotional') }}</option>
              <option value="persuasive">{{ t('rewriteEngine.tonePersuasive') }}</option>
              <option value="humorous">{{ t('rewriteEngine.toneHumorous') }}</option>
              <option value="formal">{{ t('rewriteEngine.toneFormal') }}</option>
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
          <!-- 取消（rewrite-cancel-and-truncation-summary）：分段改写是分钟级操作，
               粘错文章不该只能等全程。协作式取消，在**当前片段完成后**生效 ——
               按钮文案不得暗示立即中止。 -->
          <button
            v-if="rewriting"
            class="cohere-btn-secondary rewrite-cancel-btn"
            data-testid="rewrite-cancel-btn"
            :disabled="cancelling"
            @click="cancelRewrite"
          >
            {{ cancelling ? t('rewritePage.cancellingBtn') : t('rewritePage.cancelRewriteBtn') }}
          </button>
        </div>
        <div v-if="rewriteError" class="rewrite-error" role="alert">{{ rewriteError }}</div>
      </div>

      <!-- 改写结果区 -->
      <div v-if="rewriteResult" ref="rewriteResultCardEl" class="cohere-card rewrite-result-card">
        <div class="cohere-section-title">{{ t('rewritePage.resultSection') }}</div>
        <!-- 输出截断可见化（rewrite-limits-50000，2026-10-19）：引擎因字数区间/策略上限
             砍尾时必须让用户知道，不再静默丢内容 -->
        <div
          v-if="outputTruncatedInfo"
          class="rewrite-output-truncated-banner"
          data-testid="rewrite-output-truncated"
        >
          ⚠️ {{ t('rewritePage.outputTruncated', { length: outputTruncatedInfo.length, max: outputTruncatedInfo.max }) }}
        </div>
        <!-- 模型侧截断可见化（rewrite-segment-and-finish-reason 第二刀）：provider 的
             finish_reason 表示输出被模型自身上限截断，与上面「引擎按字数区间砍尾」是两种
             不同的限制，文案必须分型（上面那条建议「调大字数控制」，对模型上限无效）。
             分段路径下（rewrite-cancel-and-truncation-summary）再分一档：只有部分片段被截，
             必须点名段号——笼统说「整篇被截断」会让用户以为全文都残缺。 -->
        <div
          v-if="modelTruncatedInfo"
          class="rewrite-output-truncated-banner rewrite-model-truncated-banner"
          data-testid="rewrite-model-truncated"
        >
          ⚠️ {{ modelTruncatedInfo.truncatedSegments.length > 0
            ? t('rewritePage.outputTruncatedByModelSegments', {
                segments: modelTruncatedInfo.truncatedSegments.join('、'),
                length: modelTruncatedInfo.length,
              })
            : t('rewritePage.outputTruncatedByModel', { length: modelTruncatedInfo.length }) }}
        </div>
        <!-- 敏感词警告：warnings 是「成功但需注意」，不是 rewriteError（失败） -->
        <RewriteSensitiveWarning :warnings="rewriteSensitiveWarnings" />
        <div class="rewrite-result-meta" v-if="rewriteMeta">
          <span>{{ t('rewritePage.metaStrategy') }}：{{ rewriteMeta.strategyName }}</span>
          <span>{{ t('rewritePage.metaAiTaste') }}：{{ rewriteMeta.aiTastePct }}</span>
          <!-- 字数概览按模式分派用词：选题创作的输入是「主题种子」而非待改写正文，
               标成「原文」会把种子误读为需保留语义的原文（设计评审 Q5，与评分口径同一概念陷阱） -->
          <span>{{ t(rewriteMeta.mode === 'create' ? 'rewritePage.metaLengthFromTopic' : 'rewritePage.metaLength', { original: rewriteMeta.originalLength, result: rewriteMeta.resultLength }) }}</span>
          <!-- 分段改写（rewrite-segment-and-finish-reason 第二刀）：>阈值输入由引擎分 N 段，
               展示段数让「耗时/费用为什么变高」可见 -->
          <span v-if="rewriteMeta.segmentCount > 1" data-testid="rewrite-segmented-meta">
            {{ t('rewritePage.segmentedMeta', { count: rewriteMeta.segmentCount }) }}
          </span>
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
        <!-- 改写结果标题（2026-09-18）：引擎从改写结果提炼 ≤20 字标题，纯文字展示（非输入框） -->
        <div v-if="rewriteTitle" class="rewrite-result-title" data-testid="rewrite-result-title">
          <span class="rewrite-result-title-label">{{ t('rewritePage.resultTitleLabel') }}</span>
          <span class="rewrite-result-title-text">{{ rewriteTitle }}</span>
        </div>
        <textarea
          v-model="rewriteResult"
          class="rewrite-textarea result-textarea"
          rows="8"
        ></textarea>
        <div class="rewrite-result-actions">
          <!-- 复制按钮移到动作行最左侧（2026-09-18 用户要求） -->
          <button
            class="cohere-btn-secondary rewrite-copy-btn"
            data-testid="btn-copy-result"
            :disabled="!rewriteResult.trim()"
            @click="copyResult"
          >
            {{ copied ? t('rewritePage.copyResultDone') : t('rewritePage.copyResult') }}
          </button>
          <button class="cohere-btn-secondary" @click="saveToDraft">
            {{ t('rewritePage.saveDraft') }}
          </button>
          <button class="cohere-btn-secondary" data-testid="btn-video-create" @click="goToVideoCreate">
            {{ t('rewritePage.goVideo') }}
          </button>
          <button
            v-if="podcast.activeChannelId.value && rewriteResult.trim()"
            class="cohere-btn-secondary"
            data-testid="btn-podcast-script-entry"
            @click="openScriptEntry"
          >
            {{ t('podcast.episode.entry') }}
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

    <!-- 文本出期浮层：按需挂载、常驻不卸载（关闭不取消发布，§7.10.3.4 交互行） -->
    <PodcastScriptEntry
      v-if="scriptEntry.openedOnce"
      v-model:visible="scriptEntry.visible"
      :channel-id="podcast.activeChannelId.value"
      :script="scriptEntry.script"
      :title="scriptEntry.title"
    />
  </div>
</template>

<script setup>
import { Document, TrendCharts } from '@element-plus/icons-vue'
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { aiRewrite, aiRewriteCancel, draftSave, applyKnowledgeFeedback } from '@/api/publisher'
import { useNotify } from '@/composables/useNotify'
import { formatUserError } from '@/utils/user-facing-error'
import { useLoginGate } from '@/composables/useLoginGate'
import { useRewriteWordCount } from '@/composables/useRewriteWordCount'
import { useRewriteStrategy } from '@/composables/useRewriteStrategy'
import { useRewriteLibrarySync } from '@/composables/useRewriteLibrarySync'
import { takeRewriteHandoff } from '@/utils/rewrite-handoff'
import { useViralSignalStore } from '@/stores/viral-signal'
import { takeViralSignalHandoff, hasActionableEngagement } from '@/utils/viral-signal-bridge'
import { writeClipboard } from '@/utils/clipboard'
import { extractRewriteHistoryId, attachRewriteLineage } from '@/utils/rewrite-lineage'
import PublishDestinationModal from '@/components/PublishDestinationModal.vue'
import { buildCreateHandoffQuery } from '@/features/publish-destination/publish-destination-config'
import PodcastScriptEntry from '@/components/PodcastScriptEntry.vue'
import { usePodcastChannel } from '@/composables/usePodcastChannel'
import RewriteStrategyPicker from '@/components/RewriteStrategyPicker.vue'
import RewriteSensitiveWarning from '@/components/RewriteSensitiveWarning.vue'
import WordCountRangeInput from '@/components/WordCountRangeInput.vue'
import { deriveDefaultMode } from '@/utils/rewrite-defaults'
import { REWRITE_ENGINE_MAX_OUTPUT_CHARS, REWRITE_ENGINE_MAX_INPUT_CHARS, countRewriteChars, shouldSegmentRewrite } from '@/utils/rewrite-engine-limits'
import { useRewriteCancel } from '@/composables/useRewriteCancel'
import { deriveOutputTruncatedInfo, deriveModelTruncatedInfo, deriveSegmentedCount } from '@/utils/rewrite-truncation'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const { notifySuccess, notifyError, notifyWarning, notifyInfo } = useNotify()
const { ensureLogin } = useLoginGate()

// ── 状态 ──
const content = ref('')
const rewriting = ref(false)
// 取消通道（rewrite-cancel-and-truncation-summary）：逻辑在 composables/useRewriteCancel，
// 协作式——当前片段完成后才真正停下。
const { activeRunId, cancelling, beginRun, cancel: requestCancel, endRun } = useRewriteCancel()
const rewriteError = ref('')
const rewriteResult = ref('')
// 改写结果卡片模板引用：自动改写入口完成后 scrollIntoView 定位用（见 focusRewriteResult）
const rewriteResultCardEl = ref(null)
// 改写结果标题（2026-09-18）：引擎从改写结果提炼 ≤20 字标题，纯文字展示
const rewriteTitle = ref('')
const rewriteMeta = ref(null)
// 输出截断可见化（rewrite-limits-50000，2026-10-19）：引擎 outputTruncated=true 时
// {length: 实际输出字数, max: 生效上限}；未截断为 null。数据源见 result 消费分支。
const outputTruncatedInfo = ref(null)
// 模型侧截断可见化（rewrite-segment-and-finish-reason 第二刀）：引擎 modelTruncated=true
// （provider finish_reason=length/max_tokens）时 {length}；与上面引擎截断分型展示。
const modelTruncatedInfo = ref(null)
// 敏感词警告：后置 warnings 是「成功但需注意」，不是 rewriteError（失败），语义必须分开。
const rewriteSensitiveWarnings = ref([])
// content-quality-eval 桌面端闭环：改写质量评估报告（RewriteQualityEvaluator 结果）
const rewriteQuality = ref(null)
// P2 隐式反馈：本次改写引用的知识条目（保存/发布=采纳 / 再次改写=弃用）
const rewriteKnowledgeRefs = ref([])
const contentError = ref('')
// 复制按钮瞬时反馈态：复制成功后按钮文案切换为「已复制」，1.5s 后复位（BUGFIX-REWRITE-QUALITY-UX）
const copied = ref(false)
let copiedTimer = null

// viral-rewrite-integration：标题参考（爆款分析页生成标题经路由 query 带入）+ 爆款潜力对比
const titleHint = ref('')
const viralInfo = ref(null)
// P1-E：爆款分析信号（推荐角度 + 上升关键词）——titleHint 带入时从 Pinia store 快照
const viralAngles = ref([])
const viralKeywords = ref([])
// P2-a：爆款强度定量信号（样本数 + 互动均值），随快照带入，作为软约束注入引擎
const viralEngagement = ref(null)

// 配置
const useViralLibrary = ref(true)
const usePersonalExperience = ref(false)
const rewriteMode = ref('create')
// 用户是否手动切换过改写模式：手动选择优先于按输入形态的自动推导。
// 未手动切换时，startRewrite 会按当前正文形态推导（成稿→imitate，选题→create），
// 避免把一篇成稿当选题种子交给 create 模式（实测导致事实密度几乎全丢）。
let modeManuallySet = false
const platform = ref('')
// 行业 / 目的 / 语气（rewrite-default-strategy-fix）：此前改写页完全不下发这三项，
// 匹配器只能拿到空输入 ⇒ 全体并列退化为数组首项。补上后用户显式意图可真正参与匹配。
// 默认空串 = 「通用/未指定」，绝不猜测用户行业——猜出来的值是假事实，比缺失更糟。
const industry = ref('')
const purpose = ref('')
const tone = ref('')
// 字数区间（状态 + 校验 + 自适应推导，见 composables/useRewriteWordCount）
const { wordCountMin, wordCountMax, wordCountError, markWordCountManuallySet, applyWordCountDefaults } = useRewriteWordCount((key) => t('rewritePage.' + key))

// 策略选择（列表 + 预览 + 竞态守卫 + 正文防抖，见 composables/useRewriteStrategy）
const { strategyMode, rewriteStrategyId, rewriteStrategies, previewStrategyName, loadRewriteStrategies, refreshStrategyPreview } = useRewriteStrategy({ platform, industry, purpose, tone, content, rewriting })

// 弹窗
const showPublishModal = ref(false)
let savedDraftId = null
// 本次改写结果对应的 rewrite_history 行 id（归因链第一环，见 utils/rewrite-lineage）。
// 每次开始新改写先置 null、成功后再赋值，所以"上一次改写结果的 id"不可能残留到下一次发布。
let rewriteLineageId = null

// ── 文案库交接（合并版「文案库」的【改写】按钮 → 本页）──
// 载荷含 fromKey：改写成功后把结果回写文案库（同一来源只保留最新一次改写结果）。
const libraryHandoff = ref(null)
// 自动改写入口标志（2026-10-09 PRD-REWRITE-AUTO-JUMP-RESULT）：topic 带入 / from=collection 交接
// 属「跳转即自动改写」入口 → 改写成功后视口直接定位到改写结果区；手动开始 / titleHint 预填不滚动。
// 挂载期置位一次；非响应式（不参与渲染，仅控制成功分支的一次滚动行为）。
let autoFocusResult = false
// 改写结果 → 文案库回写（两条互斥写入路径，见 composables/useRewriteLibrarySync）
const { syncHandoffToLibrary, syncResultToLibrary } = useRewriteLibrarySync({ rewriteResult, rewriteTitle, platform })
// 本页平台下拉白名单：交接平台不在白名单时不带入（保持「通用」）
const REWRITE_PAGE_PLATFORMS = ['douyin', 'xiaohongshu', 'wechat_mp', 'bilibili', 'zhihu']

/** 消费文案库交接载荷：填入正文 → 仿写模式 → 平台带入（白名单内）→ 自动开始改写 */
function consumeLibraryHandoff () {
  const handoff = takeRewriteHandoff()
  if (!handoff || typeof handoff.content !== 'string' || !handoff.content.trim()) return
  // 交接是显式入口，mode 由本函数确定 ⇒ 必须置「已手动」，
  // 否则 startRewrite 的按输入形态推导会把它覆盖掉（实测把 imitate 改成 create）。
  modeManuallySet = true
  rewriteMode.value = 'imitate'
  content.value = handoff.content
  if (REWRITE_PAGE_PLATFORMS.includes(handoff.platform)) platform.value = handoff.platform
  libraryHandoff.value = handoff
  // 自动改写入口（2026-10-09）：与 topic 带入同待遇，完成后定位结果区
  autoFocusResult = true
  // 等登录门禁与 DOM 就绪后自动触发（与 topic 带入同模式）
  Promise.resolve().then(() => startRewrite())
}

/**
 * 自动改写入口完成后定位改写结果区（2026-10-09 PRD-REWRITE-AUTO-JUMP-RESULT）。
 *
 * 为什么需要：热门选题 / 文案库交接等入口跳转后自动开始改写，页面停在首屏；
 * 改写完成时结果卡片在下方，用户不知道「已经改完了」，误以为只是带入了输入内容。
 *
 * 约束：
 * - 仅 autoFocusResult（自动改写入口）为 true 时滚动，手动改写不滚（用户本就在看着页面）。
 * - 失败不滚动：错误横幅 .rewrite-error 显示在结果卡片上方的配置卡内（首屏可见），
 *   且失败时结果卡片 v-if="rewriteResult" 不渲染、目标不存在。
 * - nextTick 守卫保证 v-if 新挂载的卡片已进 DOM；取不到元素或环境无 scrollIntoView
 *   （jsdom/降级）时静默跳过，不影响改写成功主流程（与 ResultView.vue 同模式）。
 */
async function focusRewriteResult () {
  if (!autoFocusResult) return
  await nextTick()
  // 用模板 ref 而非 document.querySelector：@vue/test-utils 默认挂载到游离 DOM，
  // 全局查询拿不到；ref 引用对两种环境都成立（与 ResultView.vue 的 ref 滚动同模式）
  const el = rewriteResultCardEl.value
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

// 改写结果被用户编辑（textarea v-model）→ 已存草稿内容过期：置空 id，下次操作按当前内容重存
// （saveToDraft 成功后 savedDraftId 更新，此处仅在内容再次变化时失效，不构成循环）
// 双模型评审 MINOR-7：手动编辑结果后标题与正文可能不一致 → 同步清空标题（存草稿时回退原文前 64 字）。
// 程序赋值（startRewrite 成功分支）通过 suppressTitleClear 标志跳过，避免刚生成的标题被误清。
let suppressTitleClear = false
watch(rewriteResult, (next, prev) => {
  if (next !== prev) {
    if (savedDraftId) invalidateSavedDraft()
    if (suppressTitleClear) {
      suppressTitleClear = false
    } else if (rewriteTitle.value) {
      rewriteTitle.value = ''
    }
  }
})

// ── 热门选题带入：/rewrite?topic=xxx → 填入输入框 + 选题创作模式 + 自动开始 ──
// ── 标题参考带入：/rewrite?titleHint=xxx → 显示可移除 chip，改写时作为软约束注入引擎 ──
// ── 文案库交接带入：/rewrite?from=collection → 取 sessionStorage 交接载荷，仿写模式 + 自动开始 ──
// 交接载荷由 Collection.vue 合并版「文案库」的【改写】按钮写入（正文可能上万字，避免 URL 超长）。
onMounted(() => {
  void loadRewriteStrategies()
  void refreshStrategyPreview()
  const hint = typeof route.query.titleHint === 'string' ? route.query.titleHint.trim().slice(0, 200) : ''
  if (hint) {
    titleHint.value = hint
    // P1-E：标题来自爆款分析页 → 快照该次分析的爆款信号（角度 + 关键词），改写时注入软约束
    try {
      // P2-a：优先读一次性 sessionStorage 中转快照（读后即焚），无则回落同窗口 Pinia store
      const signal = takeViralSignalHandoff() || useViralSignalStore().signal
      if (signal && Array.isArray(signal.angles)) {
        viralAngles.value = signal.angles
        viralKeywords.value = Array.isArray(signal.keywords) ? signal.keywords : []
        viralEngagement.value = hasActionableEngagement(signal.engagement) ? signal.engagement : null
      }
    } catch { /* 信号快照失败不影响改写主流程 */ }
  }
  const topic = typeof route.query.topic === 'string' ? route.query.topic.trim() : ''
  if (topic) {
    // 选题带入是显式入口，mode 由本分支确定 ⇒ 置「已手动」，防止被形态推导覆盖
    modeManuallySet = true
    rewriteMode.value = 'create'
    // 选题带入：不再有 ≥20 字符限制（2026-09-12 移除最少字数）
    content.value = topic
    // 自动改写入口（2026-10-09）：改写完成后直接定位到改写结果区，
    // 让用户一眼看到「已经改好了」，而不是停在首屏误以为只是带入了输入内容
    autoFocusResult = true
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

/** P1-E 评审 W-1：移除标题参考 chip 时同步清空爆款信号（信号与标题同源，语义一致） */
// ── 方法 ──

/**
 * 用户手动点选改写模式：置位「已手动」标志，此后不再被自动推导覆盖。
 * 用户显式选择永远优先于启发式——这是本次修复的边界，不得反过来。
 */
function onModeChipClick(value) {
  modeManuallySet = true
  rewriteMode.value = value
}

/**
 * 改写前按当前正文推导默认参数（仅当用户未手动设置时）。
 *
 * mode：成稿→imitate（保留原文），选题种子→create（从种子生全文）。
 * 字数：长文按原文长度自适应，避免硬截 60%。
 */
function applyInputDerivedDefaults(trimmed) {
  if (!modeManuallySet) {
    rewriteMode.value = deriveDefaultMode(trimmed)
  }
  applyWordCountDefaults(trimmed)
}
function clearTitleHint() {
  titleHint.value = ''
  viralAngles.value = []
  viralKeywords.value = []
  viralEngagement.value = null
}

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

  // 按输入形态推导默认参数（用户手动设置过则不覆盖）
  applyInputDerivedDefaults(trimmed)
  // 推导后可能修正区间，需重新校验（长文自适应会把上限抬高，不会引入非法区间）
  if (wordCountError.value) return

  rewriting.value = true
  rewriteError.value = ''
  // 分段改写事前提示（rewrite-segment-and-finish-reason 第二刀）：超过阈值时引擎会分 N 段
  // 串行改写（耗时与费用 ×N、期间其他 AI 功能可能变慢、段间一致性可能有折损）。
  // 这些代价必须在**开始前**告知——失败或变慢的用户预期成本远高于一句提示。
  if (shouldSegmentRewrite(trimmed)) {
    notifyInfo('rewritePage.rewriteSegmented', {
      params: { length: countRewriteChars(trimmed), max: REWRITE_ENGINE_MAX_INPUT_CHARS },
    })
  }
  // 交接一次性语义（审查 W-1）：无论本次改写成败都消费掉交接载荷，
  // 防止失败后残留的 fromKey 被后续无关改写静默覆盖文案库记录
  const handoffForRun = libraryHandoff.value
  libraryHandoff.value = null
  // P2 隐式反馈：上次改写结果未被保存/发布就再次改写 → 弃用上次引用的知识条目
  if (rewriteResult.value && rewriteKnowledgeRefs.value.length > 0) {
    sendKnowledgeFeedback('rejected', rewriteKnowledgeRefs.value)
  }
  rewriteResult.value = ''
  rewriteTitle.value = ''
  rewriteMeta.value = null
  rewriteKnowledgeRefs.value = []
  // 敏感词警告复位：与其它结果态同批清，否则上轮警告会残留着警告本轮新结果。
  rewriteSensitiveWarnings.value = []
  // CCG 评审修复：新改写开始前重置质量报告，避免上一次改写（无 quality）的旧报告残留
  rewriteQuality.value = null
  viralInfo.value = null
  // 截断可见化两态复位（rewrite-segment-and-finish-reason）：上一次的截断横幅不得
  // 残留到这一次（否则用户会把「上次被截断」读成「这次也被截断」）
  outputTruncatedInfo.value = null
  modelTruncatedInfo.value = null
  // 归因链：上一次改写的 id 不得跟着这一次的发布走（置空后由成功分支重新赋值；
  // 本次改写若没落库成功就是 null，宁缺毋滥）
  rewriteLineageId = null

  // 每次改写一个新 runId（取消通道的寻址键；不复用旧 id，避免误取消上一次请求）
  beginRun()

  try {
    const params = {
      runId: activeRunId.value,
      mode: rewriteMode.value,
      content: trimmed,
      userSettings: {
        platform: platform.value || undefined,
        industry: industry.value || undefined,
        purpose: purpose.value || undefined,
        tone: tone.value || undefined,
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
      // P1-E：爆款信号软约束（推荐角度 + 上升关键词；引擎侧清洗，空数组不注入）
      viralAngles: viralAngles.value.length ? viralAngles.value : undefined,
      viralKeywords: viralKeywords.value.length ? viralKeywords.value : undefined,
      // P2-a：定量强度信号（引擎侧 _sanitizeEngagement 二次把关：<3 或非有限数不注入）
      engagement: viralEngagement.value || undefined,
    }

    const res = await aiRewrite(params)
    if (res && res.code === 0 && res.data && res.data.success) {
      const data = res.data
      // 程序赋值结果：跳过 watch 的标题清空（用户编辑才清空标题）
      suppressTitleClear = true
      rewriteResult.value = data.result || ''
      // 改写结果标题（2026-09-18）：引擎返回 ≤20 字标题；缺失/非法回退空串
      rewriteTitle.value = (typeof data.title === 'string' && data.title.trim()) ? [...data.title.trim()].slice(0, 20).join('') : ''
      // 新改写结果产生：旧草稿（如有）内容已过期，置空 id 让发布/视频创作按当前文案重存
      invalidateSavedDraft()
      // P2 隐式反馈：记录本次改写引用的知识条目
      rewriteKnowledgeRefs.value = data.knowledgeRefs || []
      // 归因链第一环：主进程已把本次改写落进 rewrite_history，这里只把它给的 id 接住。
      // 判据唯一实现在 utils/rewrite-lineage（未落库/信封异常 ⇒ null，不挂键）。
      rewriteLineageId = extractRewriteHistoryId(res)
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
        // 实际生效的改写模式（用于字数概览的用词分派；缺省 imitate）
        mode: data.metadata?.mode || 'imitate',
        // 分段改写段数（>1 才展示「分段改写 ×N」，见 utils/rewrite-truncation）
        segmentCount: deriveSegmentedCount(data),
      }
      // 两条截断横幅的派生逻辑见 utils/rewrite-truncation（纯函数，可单测）：
      // 引擎砍尾（outputTruncated）与模型侧截断（modelTruncated）是不同限制，分型展示。
      outputTruncatedInfo.value = deriveOutputTruncatedInfo(data, wordCountMax.value || REWRITE_ENGINE_MAX_OUTPUT_CHARS)
      modelTruncatedInfo.value = deriveModelTruncatedInfo(data)
      // 敏感词警告走 warning 级：历史把 warnings 写进 rewriteError（红色错误区），
      // 与同刻的成功提示、已赋值的结果形成矛盾形态（详见 RewriteSensitiveWarning.vue）。
      rewriteSensitiveWarnings.value = Array.isArray(data.warnings) ? data.warnings.slice() : []
      if (rewriteSensitiveWarnings.value.length > 0) {
        notifyWarning('rewritePage.rewriteSensitiveWarning', {
          params: { words: rewriteSensitiveWarnings.value.join('；') },
        })
      }
      notifySuccess('collection.rewriteSuccess')
      // 自动改写入口（2026-10-09）：改写完成 → 视口定位到改写结果区（旁路，不阻塞主流程）
      void focusRewriteResult()
      // 文案库回写（2026-09-18 用户要求：改写完成后的文案应进入文案库）：
      // 交接场景按 fromKey 更新原记录；普通改写按正文哈希稳定 key 写入。
      // 两者互斥（双模型评审 MAJOR-2：避免同一条改写产生双份记录），旁路触发不阻塞改写主流程。
      if (handoffForRun && handoffForRun.fromKey) {
        void syncHandoffToLibrary(handoffForRun)
      } else {
        void syncResultToLibrary()
      }
    } else if (res && res.code === 0 && res.data && res.data.cancelled === true) {
      // 取消是**预期行为**，不是失败：不写 rewriteError、不弹错误提示。
      // 如实告知代价（proposal §3.3 R2）：已完成片段不保留、已产生费用不退。
      rewriteError.value = ''
      notifyInfo('rewritePage.rewriteCancelled', {
        params: {
          completed: Number(res.data.completedSegments) || 0,
          total: Number(res.data.segmentCount) || 0,
        },
      })
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
    endRun()
    // 改写结束后刷新预览：改写期间平台可能已变化（rewriting 中不刷新），且引擎
    // 的用户历史（userHistory）在每次改写后更新，会影响下次自动匹配的推荐结果
    refreshStrategyPreview()
  }
}

/**
 * 取消本次改写（逻辑见 composables/useRewriteCancel）。
 * 这里只做「改写中才可取消」的入口守卫，职责分离在 composable 内。
 */
function cancelRewrite () {
  if (!rewriting.value) return
  void requestCancel()
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

/** 改写稿的标题取法只留这一份（§7.10.3.4：入口与存草稿共用同一个提取点，各写一份必然漂移） */
function resolveRewriteTitle() {
  return rewriteTitle.value || content.value.trim().slice(0, 64) || t('rewritePage.title')
}

/**
 * 文本出期入口（PRD §7.10.3.4 ②-b②）。与文案库那枚（§7.10.3.2）的差别只在正文来源：
 * 这里的正文本来就躺在内存里，所以「空白即无正文」落在**动作是否出现**上，而不是点击后被拒；
 * 频道一律取 usePodcastChannel 的既有解析，本视图不解析第二份、也不放下拉选择器。
 */
const podcast = usePodcastChannel()
const scriptEntry = ref({ visible: false, openedOnce: false, script: '', title: '' })
function openScriptEntry () {
  // 只读既有解析：动作能出现就说明默认频道非空（模板同一个谓词），原先那句
  // `|| await ensureChannel()` 是永远走不到的死分支（QM6-2），留着会让人以为这里能兜出频道。
  const channelId = podcast.activeChannelId.value
  if (!channelId) return
  const body = rewriteResult.value
  if (!body || !body.trim()) return
  scriptEntry.value = { visible: true, openedOnce: true, script: body, title: resolveRewriteTitle() }
}

/** 存入草稿 */
async function saveToDraft() {
  if (!rewriteResult.value.trim()) return
  try {
    const saved = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      // 标题优先用改写结果标题（≤20 字，2026-09-18）；缺失时回退原文前 64 字
      title: resolveRewriteTitle(),
      content: rewriteResult.value,
      source: 'rewrite',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    // 归因链：改写关联只在这一个地方挂，且只在真有 id 时挂（键缺席 = 下游不挂载）
    attachRewriteLineage(saved, rewriteLineageId)
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

/** 改写结果变化后旧草稿失效：置空 savedDraftId，下次发布/视频创作按当前文案重存。
 *  归因链必须一起失效（PRD §六.2 / QM-6 后端轴 W-1）：用户手改正文后，界面上那份内容
 *  已经不是 rewrite_history 行里存的那条改写了 —— 继续带旧 id 进 payload，
 *  归因榜就把新文案的表现归给旧的爆款引用组合，那是**假归因**，比没关联更糟。 */
function invalidateSavedDraft() {
  savedDraftId = null
  rewriteLineageId = null
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

/** 弹窗回调：生成视频（带所选流水线 + 所选配置档案，publish-config-picker） */
function onPublishVideo(pipelineId, detail) {
  showPublishModal.value = false
  if (!savedDraftId) return
  const query = buildCreateHandoffQuery({ draftId: savedDraftId, pipelineId, configProfileId: detail?.configProfileId })
  router.push({ path: '/create', query })
}
</script>

<style scoped src="./rewrite-view.css"></style>

