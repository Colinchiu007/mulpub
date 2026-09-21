<template>
  <div class="viral-analysis">
    <div class="cohere-page-header">
      <div class="viral-header-row">
        <div class="viral-header-main">
          <div class="page-title"><el-icon><TrendCharts /></el-icon> 爆款分析</div>
          <div class="page-subtitle">
            AI 驱动的内容爆款因子分析 + 文案生成
          </div>
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="cohere-content">
      <div class="cohere-card viral-card-static">
        <div class="viral-input-row">
          <div class="viral-field-topic">
            <label class="cohere-form-label">主题 / 关键词</label>
            <input
              class="cohere-input viral-input-md"
              v-model="topic"
              placeholder="输入你想分析的主题，如「AI工具推荐」"
              @keyup.enter="doAnalyze"
            />
          </div>
          <div class="viral-field-platform">
            <label class="cohere-form-label">目标平台</label>
            <select class="cohere-input viral-input-md" v-model="platform">
              <option value="通用">通用</option>
              <option value="小红书">小红书</option>
              <option value="抖音">抖音</option>
              <option value="公众号">公众号</option>
              <option value="Reddit">Reddit</option>
            </select>
          </div>
          <div class="viral-actions">
            <!-- F7 爆款库回读入口（既有 listViralItems/searchViralItems，零新增 IPC） -->
            <UiButton class="viral-btn-lib" data-testid="viral-lib-open" :title="$t('viralAnalysis.pickFromLibraryHint')" @click="openLibraryDialog">
              <el-icon><FolderAdd /></el-icon> {{ $t('viralAnalysis.pickFromLibrary') }}
            </UiButton>
            <UiButton @click="doAnalyze" :disabled="!topic.trim() || loading">
              <el-icon><DataLine /></el-icon> 爆款分析
            </UiButton>
            <!-- F1 生成 task 分段控件（标题 / Hook）：切换不自动触发，需再点按钮（AC1.2 切换清空旧结果） -->
            <div class="viral-task-segment" role="group" :aria-label="$t('viralAnalysis.taskSegmentHint')" :title="$t('viralAnalysis.taskSegmentHint')">
              <button
                type="button"
                class="viral-task-btn"
                :class="{ 'viral-task-btn--active': genTask === 'titles' }"
                data-testid="viral-task-titles"
                @click="setGenTask('titles')"
              >{{ $t('viralAnalysis.taskTitles') }}</button>
              <button
                type="button"
                class="viral-task-btn"
                :class="{ 'viral-task-btn--active': genTask === 'hooks' }"
                data-testid="viral-task-hooks"
                @click="setGenTask('hooks')"
              >{{ $t('viralAnalysis.taskHooks') }}</button>
            </div>
            <UiButton class="viral-btn-generate" @click="doGenerate" :disabled="!topic.trim() || loading">
              <el-icon><MagicStick /></el-icon> 生成文案
            </UiButton>
          </div>
        </div>

        <!-- 文章数据输入（可选） -->
        <div class="viral-article-section">
          <details>
            <summary class="viral-details-summary">手动输入文章数据（可选，提高分析精度）</summary>
            <div class="viral-article-form">
              <label class="cohere-form-label">文章数据（JSON 数组，每篇含 title/like_count/comment_count）</label>
              <textarea
                class="cohere-input viral-article-textarea"
                v-model="articleData"
                placeholder='[{"title":"AI工具推荐","like_count":1234,"comment_count":89,"platform_code":"xiaohongshu"}]'
                rows="4"
              ></textarea>
            </div>
          </details>
        </div>

        <!-- F3 热门选题速选（渐进增强：trending 失败/空返回整块隐藏，不打扰主流程） -->
        <details v-if="trendingKeywords.length" class="viral-trending-section">
          <summary class="viral-details-summary">{{ $t('viralAnalysis.sectionTrending') }}<span class="viral-note"> {{ $t('viralAnalysis.trendingHint') }}</span></summary>
          <div class="viral-tag-row viral-trending-row">
            <button
              v-for="k in trendingKeywords"
              :key="k.word"
              type="button"
              class="viral-keyword-tag viral-trending-pick"
              data-testid="viral-trending-pick"
              @click="pickTrending(k.word)"
            >{{ k.word }}</button>
          </div>
        </details>

        <!-- F6 我的模式命中（performance:list-pattern-performance 既有通道；未登录/无数据整块隐藏，AC6.1） -->
        <div v-if="patternHits.length" class="viral-section viral-pattern-hits" data-testid="viral-pattern-hits">
          <div class="viral-section-title">
            <el-icon><Trophy /></el-icon> {{ $t('viralAnalysis.sectionPatternHits') }}
            <span class="viral-note"> {{ $t('viralAnalysis.patternHitHint') }}</span>
          </div>
          <div class="viral-tag-row">
            <button
              v-for="hit in patternHits"
              :key="hit.value"
              type="button"
              class="viral-keyword-tag viral-pattern-pick"
              :class="{ 'viral-pattern-pick--active': appliedStructure && appliedStructure.value === hit.value }"
              :title="$t('viralAnalysis.applyPatternHint')"
              data-testid="viral-pattern-hit"
              @click="applyPattern(hit)"
            >{{ patternLabel(hit.value) }} · {{ $t('viralAnalysis.patternSample', { n: hit.sampleCount }) }}</button>
          </div>
          <div v-if="appliedStructure" class="viral-applied-row" data-testid="viral-applied-pattern">
            <span class="viral-saved-note">✅ {{ $t('viralAnalysis.appliedPattern') }}：{{ patternLabel(appliedStructure.value) }}</span>
            <button type="button" class="viral-cancel-link" data-testid="viral-cancel-pattern" @click="cancelPattern">{{ $t('viralAnalysis.cancelPattern') }}</button>
          </div>
        </div>

        <!-- 结果 Tab -->
        <div v-if="result" class="viral-result">
          <!-- 分析失败错误横幅（formatUserError 友好文案，不再静默吞错只显 0 分） -->
          <div v-if="result.error" class="viral-error-banner" data-testid="viral-analyze-error">
            <span>⚠️</span><span>{{ result.error }}</span>
          </div>
          <!-- 分析结果概览 -->
          <div v-if="result.overall_score !== undefined && !result.error" class="cohere-card viral-card-static viral-overview-card">
            <div class="viral-overview-row">
              <div class="viral-score-block">
                <div class="viral-score-value">{{ result.overall_score }}<span class="viral-score-unit">/100</span></div>
                <div class="viral-score-label">爆款潜力分</div>
              </div>
              <div v-if="result.mode === 'local-fallback'" class="viral-mode-badge" :title="$t('viralAnalysis.localModeHint')" data-testid="viral-local-mode">
                <el-icon><Cpu /></el-icon> {{ $t('viralAnalysis.localModeBadge') }}
              </div>
              <div v-if="result.trend_direction" class="viral-score-block">
                <div class="viral-trend-icon"><el-icon><component :is="trendIcon(result.trend_direction)" /></el-icon></div>
                <div class="viral-score-label">{{ trendLabel(result.trend_direction) }}</div>
              </div>
              <div v-if="result.suggested_angles" class="viral-angles">
                <div class="viral-block-title-sm">推荐写作角度</div>
                <div class="viral-tag-row">
                  <span v-for="angle in result.suggested_angles.slice(0,4)" :key="angle" class="cohere-tag cohere-tag-info">{{ angle }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 存入爆款库（viral-rewrite-integration：分析结果落库 → 改写引擎三层知识库第 2 层可检索） -->
          <div v-if="result && !result.error" class="viral-save-row">
            <UiButton
              v-if="!savedToLibrary"
              :disabled="savingLibrary"
              data-testid="viral-save-library"
              @click="saveToLibrary"
            ><el-icon><FolderAdd /></el-icon> {{ $t('viralAnalysis.saveToLibrary') }}</UiButton>
            <span v-else data-testid="viral-saved-library" class="viral-saved-note">✅ {{ $t('viralAnalysis.savedToLibrary') }}</span>
            <span v-if="libraryMessage" data-testid="viral-library-message" aria-live="polite" class="viral-note">{{ libraryMessage }}</span>
            <span v-if="!savedToLibrary" class="viral-note">{{ $t('viralAnalysis.saveToLibraryHint') }}</span>
          </div>

          <!-- 因子分解 -->
          <div v-if="result.factors && result.factors.length" class="viral-section">
            <div class="viral-section-title"><el-icon><DataLine /></el-icon> 因子分解</div>
            <div class="viral-factor-grid">
              <div v-for="f in result.factors" :key="f.name"
                class="cohere-card viral-card-static viral-factor-card"
              >
                <div class="viral-block-title-sm">{{ f.label || f.name }}</div>
                <div class="viral-factor-row">
                  <div class="viral-factor-bar">
                    <div class="viral-factor-fill" :style="{width: factorPct(f)+'%', background: scoreColor(factorPct(f)/100)}"></div>
                  </div>
                  <span class="viral-factor-score">{{ Math.round(factorPct(f)) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 平台对比 -->
          <div v-if="result.platform_scores && Object.keys(result.platform_scores).length" class="viral-section">
            <div class="viral-section-title">
              <el-icon><Connection /></el-icon> {{ $t('viralAnalysis.sectionPlatformScores') }}
              <span v-if="result.mode === 'local-fallback'" class="viral-estimate-note" data-testid="viral-estimate-note">{{ $t('viralAnalysis.localEstimateBadge') }}</span>
            </div>
            <div class="viral-tag-row">
              <div v-for="(score, plat) in result.platform_scores" :key="plat"
                class="cohere-card viral-card-static viral-platform-card"
              >
                <div class="viral-platform-name">{{ plat }}</div>
                <div class="viral-platform-score" :style="{color: scoreColor(Number(score)/100 || 0)}">{{ fmtScore(score) }}</div>
              </div>
            </div>
          </div>

          <!-- 推荐结构 -->
          <div v-if="result.suggested_structures && result.suggested_structures.length" class="viral-section">
            <div class="viral-section-title">
              <el-icon><Trophy /></el-icon> {{ $t('viralAnalysis.sectionSuggestedStructures') }}
              <!-- Q2 已决：本地模式展示估算值 + 标注 -->
              <span v-if="result.mode === 'local-fallback'" class="viral-estimate-note" data-testid="viral-estimate-note">{{ $t('viralAnalysis.localEstimateBadge') }}</span>
            </div>
            <div class="viral-tag-row">
              <div v-for="(s, idx) in result.suggested_structures" :key="idx"
                class="cohere-card viral-card-static viral-structure-card"
              >
                <div class="viral-block-title-sm">{{ s.structure }}</div>
                <div v-if="s.expected_lift" class="viral-lift">
                  期望互动 +{{ s.expected_lift }}
                </div>
              </div>
            </div>
          </div>

          <!-- 上升关键词 -->
          <div v-if="result.rising_keywords && result.rising_keywords.length" class="viral-section">
            <div class="viral-section-title"><el-icon><Key /></el-icon> 上升关键词</div>
            <div class="viral-tag-row">
              <span v-for="kw in result.rising_keywords.slice(0,10)" :key="kw.word" class="viral-keyword-tag">
                {{ kw.word }}
              </span>
            </div>
          </div>

        </div>

        <!-- 生成结果（独立渲染，不嵌套在分析结果内：只点「生成文案」不点「爆款分析」时也能展示） -->
        <div v-if="genResult" class="viral-result">
          <div v-if="genResult.error" class="viral-error-banner" data-testid="viral-generate-error">
            <span>⚠️</span><span>{{ genResult.error }}</span>
          </div>
          <template v-else>
          <div class="viral-gen-head">
            <div class="viral-section-title"><el-icon><MagicStick /></el-icon> {{ $t('viralAnalysis.sectionGenerateResult') }} · {{ taskLabel(genResult.task) }}</div>
            <!-- F9 生成区模式徽标（与分析区同款） -->
            <div v-if="genResult.mode === 'local-fallback'" class="viral-mode-badge" :title="$t('viralAnalysis.localGenHint')" data-testid="viral-generate-mode">
              <el-icon><Cpu /></el-icon> {{ $t('viralAnalysis.localGenBadge') }}
            </div>
          </div>

            <!-- 标题列表面板 -->
            <div v-if="genResult.task === 'titles' && genResult.data?.titles" class="cohere-card viral-card-static">
              <div v-for="(t, idx) in genResult.data.titles" :key="idx"
                class="viral-title-row"
                :class="{ 'viral-title-row--last': idx === genResult.data.titles.length - 1 }"
              >
                <div class="viral-title-num">#{{ idx + 1 }}</div>
                <div class="viral-title-body">
                  <div class="viral-title-text">
                    {{ titleText(t) }}
                    <!-- F8 实测角标：标题命中近期 impact 快照时展示已达成数据（AC8.1） -->
                    <span
                      v-if="measuredInfo(titleText(t))"
                      class="viral-measured-badge"
                      data-testid="viral-measured-badge"
                      :title="$t('viralAnalysis.measuredBadgeHint')"
                    >{{ $t('viralAnalysis.measuredBadge') }} {{ fmtScore(measuredInfo(titleText(t)).topEngagement) }}</span>
                  </div>
                  <div class="viral-title-meta">
                    <span v-if="t.structure" class="cohere-tag">{{ t.structure }}</span>
                    <span v-if="t.emotion" class="cohere-tag">{{ t.emotion }}</span>
                    <span v-if="t.predicted_score" class="viral-title-score">预测分 {{ t.predicted_score }}</span>
                    <button
                      class="cohere-btn-secondary viral-go-rewrite"
                      data-testid="viral-go-rewrite"
                      @click="goRewrite(titleText(t))"
                    >{{ $t('viralAnalysis.goRewrite') }}</button>
                  </div>
                  <div v-if="t.reasoning" class="viral-title-reason">{{ t.reasoning }}</div>
                </div>
              </div>
            </div>

            <!-- Hook 面板 -->
            <div v-if="genResult.task === 'hooks' && genResult.data?.hooks" class="cohere-card viral-card-static">
              <div v-for="(h, idx) in genResult.data.hooks" :key="idx" class="viral-hook-row">
                <div class="viral-hook-text">{{ h.hook }}</div>
                <div v-if="h.technique" class="viral-note">技法: {{ h.technique }}</div>
              </div>
            </div>

            <!-- 改写面板 -->
            <div v-if="genResult.task === 'rewrite' && genResult.data?.rewritten_content" class="cohere-card viral-card-static">
              <div class="viral-rewrite-meta">
                原文 {{ genResult.data.original_word_count }} 字 → 改写 {{ genResult.data.rewritten_word_count }} 字
              </div>
              <div class="viral-rewrite-content">{{ genResult.data.rewritten_content }}</div>
            </div>

            <!-- 结构建议 -->
            <div v-if="genResult.task === 'structures' && genResult.data?.suggestions" class="cohere-card viral-card-static">
              <div v-for="(s, idx) in genResult.data.suggestions" :key="idx" class="viral-hook-row">
                <div class="viral-suggest-head">
                  <span class="viral-suggest-name">{{ s.structure_name || s.structure }}</span>
                  <span v-if="s.score" class="viral-suggest-score" :style="{color: scoreColor(s.score/100)}">{{ s.score }} 分</span>
                </div>
                <div v-if="s.reasoning" class="viral-suggest-reason">{{ s.reasoning }}</div>
                <div v-if="s.outline" class="viral-suggest-outline">{{ s.outline }}</div>
              </div>
            </div>
          </template>
        </div>

        <!-- F7 爆款库选择对话框（自绘 modal：渲染在组件树内，不依赖 teleport；esc/遮罩关闭） -->
        <div
          v-if="showLibraryDialog"
          class="viral-lib-overlay"
          data-testid="viral-lib-dialog"
          role="dialog"
          :aria-label="$t('viralAnalysis.libraryDialogTitle')"
          @click.self="showLibraryDialog = false"
        >
          <div class="viral-lib-modal">
            <div class="viral-lib-head">
              <span class="viral-lib-title">{{ $t('viralAnalysis.libraryDialogTitle') }}</span>
              <button type="button" class="viral-lib-close" :aria-label="$t('viralAnalysis.closeDialog')" @click="showLibraryDialog = false">✕</button>
            </div>
            <div class="viral-lib-search-row">
              <input
                class="cohere-input viral-lib-search-input"
                v-model="libQuery"
                :placeholder="$t('viralAnalysis.librarySearchPlaceholder')"
                data-testid="viral-lib-search-input"
                @keyup.enter="searchLibrary"
              />
              <UiButton size="small" :disabled="libLoading" @click="searchLibrary">{{ $t('viralAnalysis.librarySearch') }}</UiButton>
            </div>
            <div v-if="libLoading" class="viral-note" data-testid="viral-lib-loading">{{ $t('viralAnalysis.libraryLoading') }}</div>
            <div v-else-if="!libItems.length" class="viral-lib-empty" data-testid="viral-lib-empty">
              <div>{{ $t('viralAnalysis.libraryEmpty') }}</div>
              <div class="viral-note">{{ $t('viralAnalysis.libraryEmptyHint') }}</div>
            </div>
            <div v-else class="viral-lib-list">
              <button
                v-for="item in libItems"
                :key="item.id"
                type="button"
                class="viral-lib-item"
                data-testid="viral-lib-item"
                @click="pickLibraryItem(item)"
              >
                <span class="viral-lib-item-title">{{ item.title }}</span>
                <span class="viral-lib-item-meta">{{ item.platform || '-' }} · 👍{{ item.likes || 0 }} · 💬{{ item.comments || 0 }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="loading" class="viral-loading" data-testid="viral-analysis-loading">
          <UiSkeleton variant="chart" />
        </div>
        <EmptyState
          v-else-if="!result && !genResult"
          data-testid="viral-analysis-empty"
          :title="$t('viralAnalysis.emptyTitle')"
          :description="$t('viralAnalysis.emptyDescription')"
        >
          <template #icon><el-icon><TrendCharts /></el-icon></template>
        </EmptyState>
      </div>
    </div>
  </div>
</template>

<script>
import { viralAnalyze, viralGenerate, viralTrending, getRecentImpactSnapshots } from '@/api/publisher'
import { addViralToLibrary, listViralItems, searchViralItems, listPatternPerformance } from '@/api/knowledge-library'
import UiButton from '../components/UiButton.vue'
import { CaretBottom, CaretRight, CaretTop, Connection, Cpu, DataLine, FolderAdd, Key, MagicStick, TrendCharts, Trophy } from '@element-plus/icons-vue'
import { formatUserError } from '@/utils/user-facing-error'
import { useViralSignalStore } from '@/stores/viral-signal'
export default {

components: { UiButton, CaretBottom, CaretRight, CaretTop, Connection, Cpu, DataLine, FolderAdd, Key, MagicStick, TrendCharts, Trophy },
  data () {
    return {
      topic: '',
      platform: '通用',
      articleData: '',
      loading: false,
      result: null,
      genResult: null,
      // viral-rewrite-integration：分析结果落库状态
      savingLibrary: false,
      savedToLibrary: false,
      libraryMessage: '',
      // 双模型评审 W-1：分析成功时快照主题，落库 title/报告始终与分析时的输入一致
      analyzedTopic: '',
      // F1：生成 task 选择（仅 titles/hooks，本地可产出；rewrite/structures 见 PRD §8 Out of Scope）
      genTask: 'titles',
      // F3：热门选题速选词（_localTrending keywords，失败/空保持 [] → 区块隐藏）
      trendingKeywords: [],
      // PR-2 F6：我的模式命中（narrative_structure 维度 top3；元素 {value, sampleCount}）与已套用结构（枚举，不传本地化标签）
      patternHits: [],
      appliedStructure: null,
      // PR-2 F7：爆款库回读对话框状态
      showLibraryDialog: false,
      libItems: [],
      libQuery: '',
      libLoading: false,
      // PR-2 F8：标题 → 实测快照 {topEngagement, totalMentions}；非响应式也可，保持 plain 对象
      measuredMap: {},
    }
  },
  mounted () {
    // F3 渐进增强：进入页面静默加载一次，失败不打扰主流程（AC3.2）
    this.loadTrending()
    // PR-2 F6/F8：渐进增强，未登录/无数据静默隐藏（AC6.1/AC8.2）
    this.loadPatternHits()
    this.loadMeasured()
  },
  methods: {
    async doAnalyze () {
      if (!this.topic.trim() || this.loading) return
      this.loading = true
      this.result = null
      this.genResult = null
      // 新分析开始 → 重置落库状态（上一次的分析结果已过期）
      this.savingLibrary = false
      this.savedToLibrary = false
      this.libraryMessage = ''
      this.analyzedTopic = ''

      try {
        let articles = []
        if (this.articleData.trim()) {
          try {
            articles = JSON.parse(this.articleData.trim())
          } catch {
            // ignore malformed JSON
          }
        }
        if (!articles.length) {
          // Use a single synthetic article from the topic for quick analysis
          articles = [{ title: this.topic, like_count: 100, comment_count: 10, platform_code: 'general' }]
        }

        const res = await viralAnalyze(articles, this.topic)
        if (res?.code === 0) {
          this.result = res.data
          this.analyzedTopic = this.topic.trim()
          // P1-E：记录爆款信号（推荐角度 + 上升关键词），改写页经 /rewrite?titleHint= 消费注入软约束
          try {
            useViralSignalStore().setSignal({
              topic: this.analyzedTopic,
              angles: Array.isArray(this.result.suggested_angles) ? this.result.suggested_angles : [],
              keywords: Array.isArray(this.result.rising_keywords)
                ? this.result.rising_keywords.map(k => (k && typeof k === 'object' && k.word) ? k.word : k)
                : [],
            })
          } catch { /* 信号记录失败不影响分析主流程 */ }
        } else {
          this.result = { overall_score: 0, error: formatUserError(res, { fallback: this.$t('viralAnalysis.analyzeFailed') }).message }
        }
      } catch (err) {
        this.result = { overall_score: 0, error: formatUserError(err, { fallback: this.$t('viralAnalysis.analyzeFailed') }).message }
      } finally {
        this.loading = false
      }
    },

    async doGenerate () {
      if (!this.topic.trim() || this.loading) return
      this.loading = true

      try {
        const opts = {
          topic: this.topic,
          platform: this.platform,
          task: this.genTask,
          count: 5,
          // PR-2 F6/AC6.2：传叙事结构枚举（非本地化标签），引擎侧 NARRATIVE_LABELS 为唯一权威映射
          ...(this.appliedStructure ? { structure: this.appliedStructure.value } : {}),
        }
        const res = await viralGenerate(opts)
        if (res?.code === 0) {
          this.genResult = res.data
        } else {
          // 不吞错：IPC 业务错误（非 0 code）也落入 genResult.error 供横幅渲染
          this.genResult = { task: this.genTask, error: formatUserError(res, { fallback: this.$t('viralAnalysis.generateFailed') }).message }
        }
      } catch (err) {
        this.genResult = { task: this.genTask, error: formatUserError(err, { fallback: this.$t('viralAnalysis.generateFailed') }).message }
      } finally {
        this.loading = false
      }
    },

    /** F1：切换生成 task 不自动触发，清空旧结果防残留（AC1.2） */
    setGenTask (task) {
      if (task !== 'titles' && task !== 'hooks') return
      if (this.genTask === task) return
      this.genTask = task
      this.genResult = null
    },

    /**
     * F3：加载热门选题词。数据源 = 手动文章数据 ∪ 爆款库条目（best-effort），
     * 经既有 viralTrending IPC 聚合；任何失败静默隐藏区块（AC3.2/AC3.3 不新增通道）。
     */
    async loadTrending () {
      try {
        const articles = []
        const seen = new Set()
        const push = (a) => {
          if (!a || typeof a !== 'object') return
          const title = typeof a.title === 'string' ? a.title.trim() : ''
          if (!title || seen.has(title)) return
          seen.add(title)
          articles.push(a)
        }
        if (this.articleData.trim()) {
          try {
            const parsed = JSON.parse(this.articleData.trim())
            if (Array.isArray(parsed)) parsed.forEach(push)
          } catch { /* 非法 JSON 静默忽略 */ }
        }
        try {
          const lib = await listViralItems({ page: 1, pageSize: 30 })
          if (lib?.code === 0 && Array.isArray(lib.data?.items)) {
            lib.data.items.slice(0, 30).forEach(it => push({
              title: it && it.title,
              like_count: Number(it && it.likes) || 0,
              comment_count: Number(it && it.comments) || 0,
              platform_code: (it && it.platform) || 'general',
            }))
          }
        } catch { /* 爆款库不可用（如未登录门禁）不影响选题区其余数据源 */ }
        if (!articles.length) return
        const res = await viralTrending(JSON.parse(JSON.stringify(articles)))
        if (res?.code === 0 && Array.isArray(res.data?.keywords)) {
          this.trendingKeywords = res.data.keywords
            .filter(k => k && typeof k.word === 'string' && k.word.trim())
            .slice(0, 10)
        }
      } catch { /* 渐进增强：trending 失败整块隐藏，console 留痕由 IPC 层负责 */ }
    },

    /** F3：点击选题词回填主题输入框（不自动分析） */
    pickTrending (word) {
      if (typeof word !== 'string' || !word.trim()) return
      this.topic = word.trim()
    },

    // ========== PR-2 F6：我的模式命中（结构套用） ==========

    /**
     * F6：加载个人模式库 narrative_structure 维度 top3（store 已按 engagement_score DESC）。
     * 复用 performance:list-pattern-performance 既有 IPC；未登录（code -1）/失败静默隐藏（AC6.1）。
     */
    async loadPatternHits () {
      try {
        const res = await listPatternPerformance({ dimension: 'narrative_structure', pageSize: 10 })
        if (res?.code !== 0 || !Array.isArray(res.data?.items)) {
          this.patternHits = []
          return
        }
        this.patternHits = res.data.items
          .filter(it => it && typeof it.value === 'string' && it.value.trim())
          .slice(0, 3)
          .map(it => ({
            value: it.value.trim(),
            sampleCount: Number(it.sample_count) || 0,
          }))
      } catch { /* 渐进增强：失败整块隐藏 */ }
    },

    /** F6：点击套用/再次点击取消；appliedStructure 只存枚举值，标签经 locales 映射渲染 */
    applyPattern (hit) {
      const value = hit && typeof hit.value === 'string' ? hit.value.trim() : ''
      if (!value) return
      if (this.appliedStructure && this.appliedStructure.value === value) {
        this.appliedStructure = null
        return
      }
      this.appliedStructure = { value }
    },

    /** F6：显式取消套用 */
    cancelPattern () {
      this.appliedStructure = null
    },

    /** F6：叙事结构枚举 → 本地化标签（未知枚举回落原值，与引擎 NARRATIVE_LABELS 同源枚举） */
    patternLabel (value) {
      return this.$t('viralAnalysis.narrative.' + value)
    },

    // ========== PR-2 F7：爆款库回读 ==========

    /** F7：打开对话框并加载最近 30 条（失败/未登录 → 空态，不阻断页面） */
    async openLibraryDialog () {
      this.showLibraryDialog = true
      this.libQuery = ''
      this.libLoading = true
      try {
        const res = await listViralItems({ page: 1, pageSize: 30 })
        this.libItems = (res?.code === 0 && Array.isArray(res.data?.items)) ? res.data.items : []
      } catch {
        this.libItems = []
      } finally {
        this.libLoading = false
      }
    },

    /** F7：按关键词搜索（复用 searchViralItems 既有 IPC；非法返回不破坏现有列表） */
    async searchLibrary () {
      const query = typeof this.libQuery === 'string' ? this.libQuery.trim() : ''
      if (!query || this.libLoading) return
      this.libLoading = true
      try {
        const res = await searchViralItems(query, 30)
        if (res?.code === 0 && Array.isArray(res.data)) {
          this.libItems = res.data
        }
      } catch { /* 搜索失败保留当前列表 */ } finally {
        this.libLoading = false
      }
    },

    /**
     * F7：选中条目 → 回填 topic + 文章数据 JSON 追加一条实测记录（AC7.2）。
     * 现有 articleData 非法 JSON 时直接覆盖（残句不如丢残句）；对话框关闭后三源自动生效。
     */
    pickLibraryItem (item) {
      const title = item && typeof item.title === 'string' ? item.title.trim() : ''
      if (!title) return
      this.topic = title
      let articles = []
      if (this.articleData && this.articleData.trim()) {
        try {
          const parsed = JSON.parse(this.articleData.trim())
          if (Array.isArray(parsed)) articles = parsed
        } catch { articles = [] }
      }
      articles.push({
        title,
        like_count: Number(item.likes) || 0,
        comment_count: Number(item.comments) || 0,
        platform_code: item.platform || 'general',
      })
      this.articleData = JSON.stringify(articles, null, 2)
      this.showLibraryDialog = false
    },

    // ========== PR-2 F8：已达成数据角标 ==========

    /**
     * F8：加载近期 impact 快照（复用 impact:get-recent-snapshots 既有主进程通道）。
     * 标题精确匹配索引；未登录/抛错静默 → measuredMap 保持空（AC8.2）。
     */
    async loadMeasured () {
      try {
        const res = await getRecentImpactSnapshots()
        if (res?.code !== 0 || !Array.isArray(res.data)) return
        const map = {}
        for (const row of res.data) {
          const t = row && typeof row.title === 'string' ? row.title.trim() : ''
          if (!t || map[t]) continue
          map[t] = {
            topEngagement: Number(row.top_engagement) || 0,
            totalMentions: Number(row.total_mentions) || 0,
          }
        }
        this.measuredMap = map
      } catch { /* 静默降级：无角标不影响主流程 */ }
    },

    /** F8：按标题查实测快照；无数据返回 null（模板 v-if 自然隐藏） */
    measuredInfo (title) {
      const t = typeof title === 'string' ? title.trim() : ''
      if (!t) return null
      return this.measuredMap[t] || null
    },

    trendIcon (direction) {
      // T1-5：趋势图标改用 @element-plus/icons-vue（返回组件，模板 <component :is> 渲染）
      const icons = { rising: CaretTop, declining: CaretBottom, stable: CaretRight }
      return icons[direction] || CaretRight
    },

    // ========== viral-rewrite-integration：分析结果落库 + 生成标题去改写 ==========

    /** 将本次分析结果存入爆款库（复用 addViralToLibrary 既有 IPC，无新增通道） */
    async saveToLibrary () {
      if (!this.result || this.result.error || this.savingLibrary || this.savedToLibrary) return
      if (!this.analyzedTopic) return
      this.savingLibrary = true
      this.libraryMessage = ''
      try {
        const res = await addViralToLibrary(this._buildLibraryItem())
        if (res && res.code === 0) {
          // 成功态由 ✅ + savedToLibrary 文案表达，不再重复写 libraryMessage（评审 I-2）
          this.savedToLibrary = true
        } else {
          this.libraryMessage = (res && res.message) || this.$t('viralAnalysis.saveFailed')
        }
      } catch (err) {
        this.libraryMessage = formatUserError(err, { fallback: this.$t('viralAnalysis.saveFailed') }).message
      } finally {
        this.savingLibrary = false
      }
    },

    /** 组装爆款库条目：title=分析时快照的主题；content=分析报告（服务端要求 content 非空）；tags=平台+角度+关键词 */
    _buildLibraryItem () {
      const r = this.result || {}
      const angles = Array.isArray(r.suggested_angles)
        ? r.suggested_angles.filter(a => typeof a === 'string' && a.trim())
        : []
      const keywords = Array.isArray(r.rising_keywords)
        ? r.rising_keywords.map(k => (k && typeof k === 'object' && k.word) ? k.word : k)
          .filter(k => typeof k === 'string' && k.trim())
        : []
      const tags = [...new Set([this.platform, ...angles, ...keywords])]
        .filter(s => typeof s === 'string' && s.trim())
        .slice(0, 50)
      return {
        title: this.analyzedTopic.slice(0, 500),
        content: this._buildAnalysisReport(r),
        tags,
        platform: (this.platform || '').slice(0, 50),
        source: 'analysis',
        likes: 0,
        comments: 0,
      }
    },

    /** 分析报告 Markdown（纯静态 i18n 键 + 模板拼接；项目语料不支持 {param} 插值） */
    _buildAnalysisReport (r) {
      const lines = []
      lines.push('## ' + this.$t('viralAnalysis.reportTitle'))
      lines.push(this.$t('viralAnalysis.reportTopic') + ': ' + this.analyzedTopic)
      lines.push(this.$t('viralAnalysis.reportScore') + ': ' + (r.overall_score ?? '-') + '/100')
      if (r.trend_direction) {
        lines.push(this.$t('viralAnalysis.reportTrend') + ': ' + this.trendLabel(r.trend_direction))
      }
      const angles = Array.isArray(r.suggested_angles) ? r.suggested_angles.slice(0, 6) : []
      if (angles.length) {
        lines.push(this.$t('viralAnalysis.reportAngles') + ': ' + angles.join(' | '))
      }
      const kws = Array.isArray(r.rising_keywords)
        ? r.rising_keywords.slice(0, 10).map(k => (k && typeof k === 'object' && k.word) ? k.word : k).filter(Boolean)
        : []
      if (kws.length) {
        lines.push(this.$t('viralAnalysis.reportKeywords') + ': ' + kws.join(' | '))
      }
      const factors = Array.isArray(r.factors)
        ? r.factors.map(f => `${((f && (f.label || f.name)) || '?')}: ${typeof (f && f.score) === 'number' ? Math.round(f.score * 100) : '-'}`)
        : []
      if (factors.length) {
        lines.push(this.$t('viralAnalysis.reportFactors') + ': ' + factors.join(' | '))
      }
      lines.push(this.$t('viralAnalysis.reportPlatform') + ': ' + this.platform)
      return lines.join('\n')
    },

    /** 携带生成标题跳转改写页（query.titleHint → RewriteView 预填 chip → 引擎软约束） */
    goRewrite (title) {
      if (typeof title !== 'string' || !title.trim()) return
      this.$router.push({ path: '/rewrite', query: { titleHint: title.trim().slice(0, 200) } })
    },

    /** 生成任务名本地化标签（模板不再直出英文 task key） */
    taskLabel (task) {
      const keys = {
        titles: 'viralAnalysis.taskTitles',
        hooks: 'viralAnalysis.taskHooks',
        rewrite: 'viralAnalysis.taskRewrite',
        structures: 'viralAnalysis.taskStructures',
      }
      return keys[task] ? this.$t(keys[task]) : task
    },

    trendLabel (direction) {
      const labels = { rising: '上升中', declining: '下降中', stable: '平稳' }
      return labels[direction] || direction
    },

    scoreColor (score) {
      // T1-3：语义分值色收编 tokens.css（--color-score-*），方法只返回变量引用
      if (score >= 0.7) return 'var(--color-score-high)'
      if (score >= 0.4) return 'var(--color-score-mid)'
      return 'var(--color-score-low)'
    },

    /** 标题文本容错：兼容字符串数组（历史本地兜底形态）与对象数组（{title} 契约） */
    titleText (t) {
      if (typeof t === 'string') return t
      return (t && typeof t === 'object' && t.title) || ''
    },

    /** 因子百分比（0-100）：score 非数字显示 0，兼容 0-1（本地兜底约定）与 0-100 两种量纲 */
    factorPct (f) {
      const s = Number(f && f.score)
      if (!Number.isFinite(s)) return 0
      const pct = s > 1 ? s : s * 100
      return Math.min(Math.max(pct, 0), 100)
    },

    /** 平台评分容错格式化：非数字显示 '-'，避免 toFixed 崩溃 */
    fmtScore (v) {
      const n = Number(v)
      return Number.isFinite(n) ? n.toFixed(1) : '-'
    },
  },
}
</script>

<style scoped>
/* T1-3a：原 80 处内联样式全部类化；颜色一律 var(--color-*)（tokens.css 语义槽），
 * 间距/圆角沿用 --space-* 与 --r-* 槽位。视觉与迁移前等价（两处因变量未定义而
 * 长期无效的样式已按设计意图修复：.viral-overview-card 底色、.viral-keyword-tag 底色）。 */
.viral-analysis {
  color: var(--color-text-primary);
}

/* --- 页头与输入区 --- */
.viral-analysis .page-title { font-size: var(--font-size-xl); letter-spacing: -0.2px; }
.viral-analysis .page-subtitle { margin-top: 2px; }
.viral-header-row { display: flex; align-items: center; gap: var(--space-md); width: 100%; }
.viral-header-main { flex: 1; }
.viral-input-row { display: flex; gap: var(--space-md); flex-wrap: wrap; }
.viral-field-topic { flex: 2; min-width: 280px; }
.viral-field-platform { flex: 1; min-width: 160px; }
.viral-input-md { font-size: var(--font-size-sm); } /* 14px：七档外存量字号，档位收敛属 T1-6 */
.viral-actions { display: flex; align-items: flex-end; gap: var(--space-sm); }
/* 生成文案：主色描边次级按钮（原 danger 红底误导为危险操作，2026-09-21 精致化） */
.viral-btn-generate { background: var(--color-bg-card); border-color: var(--color-primary); color: var(--color-primary); }
.viral-btn-generate:hover { background: var(--color-primary-light); border-color: var(--color-primary); color: var(--color-primary); }
.viral-card-static { cursor: default; }

/* --- 文章数据（可选） --- */
.viral-article-section { margin-top: var(--space-md); }
.viral-details-summary { cursor: pointer; font-size: var(--font-size-sm); color: var(--color-text-muted); transition: color 0.2s; }
.viral-details-summary:hover { color: var(--color-primary); }
.viral-article-form { margin-top: var(--space-sm); }
.viral-article-textarea { font-size: var(--font-size-sm); font-family: monospace; resize: vertical; }

/* --- F1 生成 task 分段控件 --- */
.viral-task-segment { display: inline-flex; align-self: flex-end; border: 1px solid var(--color-border); border-radius: var(--r-sm); overflow: hidden; }
.viral-task-btn { border: none; background: var(--color-bg-card); color: var(--color-text-muted); font-size: var(--font-size-xs); padding: 6px 14px; cursor: pointer; transition: background 0.15s, color 0.15s; }
.viral-task-btn + .viral-task-btn { border-left: 1px solid var(--color-border); }
.viral-task-btn:hover { color: var(--color-primary); }
.viral-task-btn--active { background: var(--color-primary-light); color: var(--color-primary); font-weight: 600; }

/* --- F3 热门选题速选 --- */
.viral-trending-section { margin-top: var(--space-sm); }
.viral-trending-row { margin-top: var(--space-sm); }
.viral-trending-pick { cursor: pointer; border: none; transition: opacity 0.15s, transform 0.15s; }
.viral-trending-pick:hover { opacity: 0.85; transform: translateY(-1px); }

/* --- Q2 本地估算标注 --- */
.viral-estimate-note { font-size: var(--font-size-xs); font-weight: 400; color: var(--color-text-muted); border: 1px solid var(--color-border); border-radius: var(--r-pill); padding: 0 8px; margin-left: 4px; }

/* --- F9 生成区头（标题 + 模式徽标同行） --- */
.viral-gen-head { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }

/* --- 结果区通用 --- */
.viral-result { margin-top: var(--space-lg); }
.viral-section { margin-top: var(--space-md); }
.viral-section-title { display: flex; align-items: center; gap: 6px; font-size: var(--font-size-sm); font-weight: 600; margin-bottom: var(--space-sm); color: var(--color-text-strong); }
.viral-section-title .el-icon { color: var(--color-primary); } /* 14px：档位收敛属 T1-6 */
.viral-block-title-sm { font-size: var(--font-size-sm); font-weight: 600; margin-bottom: 4px; }
.viral-tag-row { display: flex; gap: 6px; flex-wrap: wrap; }
.viral-loading { padding: 16px 0; }

/* --- 错误横幅（分析/生成失败可见化） --- */
.viral-error-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--r-xs);
  border: 1px solid var(--color-border);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font-size: var(--font-size-sm);
  line-height: 1.6;
}

/* --- 概览 --- */
.viral-overview-card { background: var(--color-bg-inset); }
.viral-overview-row { display: flex; align-items: center; gap: var(--space-lg); flex-wrap: wrap; }
.viral-score-block { text-align: center; }
.viral-score-value { font-size: var(--font-size-xxl); font-weight: 700; color: var(--color-danger); line-height: 1.1; font-variant-numeric: tabular-nums; }
.viral-score-unit { font-size: var(--font-size-md); font-weight: 500; color: var(--color-text-muted); margin-left: 2px; }
.viral-score-label { font-size: var(--font-size-xs); color: var(--color-text-muted); letter-spacing: 0.28px; }
.viral-mode-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: var(--font-size-xs); color: var(--color-primary);
  background: var(--color-sidebar-bg-start);
  border: 1px solid var(--color-sidebar-border);
  border-radius: var(--r-pill); padding: 2px 10px; cursor: default;
}
.viral-trend-icon { font-size: var(--font-size-xl); }
.viral-angles { flex: 1; min-width: 200px; }

/* --- 落库行 --- */
.viral-save-row { margin-top: var(--space-sm); display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }
.viral-saved-note { font-size: var(--font-size-sm); color: var(--color-text-muted); }
.viral-note { font-size: var(--font-size-xs); color: var(--color-text-muted); }

/* --- 因子分解 --- */
.viral-factor-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--space-sm); }
.viral-factor-card { padding: var(--space-sm); transition: box-shadow 0.2s, transform 0.2s; }
.viral-factor-card:hover { box-shadow: var(--shadow-float); transform: translateY(-1px); }
.viral-factor-row { display: flex; align-items: center; gap: 8px; }
.viral-factor-bar { flex: 1; height: 6px; background: var(--color-border); border-radius: 3px; overflow: hidden; }
.viral-factor-fill { height: 100%; border-radius: 3px; transition: width 0.5s; }
.viral-factor-score { font-size: var(--font-size-base); font-weight: 700; color: var(--color-text-strong); min-width: 28px; text-align: right; font-variant-numeric: tabular-nums; }

/* --- 平台对比 --- */
.viral-platform-card { padding: var(--space-sm) var(--space-lg); text-align: center; min-width: 120px; transition: box-shadow 0.2s; }
.viral-platform-card:hover { box-shadow: var(--shadow-float); }
.viral-platform-name { font-size: var(--font-size-xs); color: var(--color-text-muted); margin-bottom: 4px; }
.viral-platform-score { font-size: var(--font-size-lg); font-weight: 700; }

/* --- 推荐结构 --- */
.viral-structure-card { padding: var(--space-sm); flex: 1; min-width: 180px; }
.viral-lift { font-size: var(--font-size-xs); color: var(--color-danger); margin-top: 2px; }
.viral-keyword-tag {
  font-size: var(--font-size-sm);
  padding: 2px 10px;
  border-radius: var(--r-xs);
  background: var(--color-primary-light);
  color: var(--color-primary);
}

/* --- 生成标题列表 --- */
.viral-title-row { padding: var(--space-sm); border-bottom: 1px solid var(--color-border); display: flex; gap: var(--space-sm); align-items: flex-start; border-radius: var(--r-sm); transition: background 0.15s; }
.viral-title-row:hover { background: var(--color-bg-inset); }
.viral-title-row--last { border-bottom: none; }
.viral-title-num { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text-muted); min-width: 24px; }
.viral-title-body { flex: 1; }
.viral-title-text { font-size: var(--font-size-base); font-weight: 600; margin-bottom: 2px; }
.viral-title-meta { display: flex; gap: 8px; font-size: var(--font-size-xs); color: var(--color-text-muted); flex-wrap: wrap; align-items: center; }
.viral-title-score { color: var(--color-danger); font-weight: 600; }
.viral-go-rewrite { font-size: var(--font-size-xs); padding: 2px 10px; }
.viral-title-reason { font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 2px; }

/* --- Hook / 改写 / 结构建议 --- */
.viral-hook-row { padding: var(--space-sm); border-bottom: 1px solid var(--color-border); margin-bottom: var(--space-sm); }
.viral-hook-text { font-size: var(--font-size-sm); line-height: 1.6; margin-bottom: 4px; } /* 14px：档位收敛属 T1-6 */
.viral-rewrite-meta { font-size: var(--font-size-xs); color: var(--color-text-muted); margin-bottom: var(--space-sm); }
.viral-rewrite-content { font-size: var(--font-size-sm); line-height: 1.8; white-space: pre-wrap; } /* 14px：档位收敛属 T1-6 */
.viral-suggest-head { display: flex; align-items: center; gap: var(--space-sm); }
.viral-suggest-name { font-size: var(--font-size-sm); font-weight: 600; } /* 14px：档位收敛属 T1-6 */
.viral-suggest-score { font-size: var(--font-size-xs); font-weight: 600; }
.viral-suggest-reason { font-size: var(--font-size-sm); color: var(--color-text-muted); margin-top: 4px; }
.viral-suggest-outline { font-size: var(--font-size-sm); margin-top: 6px; white-space: pre-wrap; line-height: 1.5; }

/* --- PR-2 F6 我的模式命中 --- */
.viral-pattern-hits { margin-top: var(--space-md); }
.viral-pattern-pick { cursor: pointer; border: none; transition: opacity 0.15s, transform 0.15s; }
.viral-pattern-pick:hover { opacity: 0.85; transform: translateY(-1px); }
.viral-pattern-pick--active { background: var(--color-primary); color: var(--color-bg-card); font-weight: 600; }
.viral-applied-row { margin-top: var(--space-sm); display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }
.viral-cancel-link { border: none; background: none; cursor: pointer; font-size: var(--font-size-xs); color: var(--color-text-muted); text-decoration: underline; padding: 0; }
.viral-cancel-link:hover { color: var(--color-primary); }

/* --- PR-2 F7 爆款库选择对话框（自绘 modal） --- */
.viral-btn-lib { background: var(--color-bg-card); border-color: var(--color-border); color: var(--color-text-primary); }
.viral-btn-lib:hover { border-color: var(--color-primary); color: var(--color-primary); }
.viral-lib-overlay { position: fixed; inset: 0; z-index: 2000; background: rgba(0, 0, 0, 0.4); display: flex; align-items: center; justify-content: center; }
.viral-lib-modal { width: min(560px, 92vw); max-height: 72vh; display: flex; flex-direction: column; background: var(--color-bg-card); border: 1px solid var(--color-border); border-radius: var(--r-md); padding: var(--space-md); box-shadow: var(--shadow-float); }
.viral-lib-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-sm); }
.viral-lib-title { font-size: var(--font-size-base); font-weight: 600; }
.viral-lib-close { border: none; background: none; cursor: pointer; font-size: var(--font-size-md); color: var(--color-text-muted); padding: 2px 6px; }
.viral-lib-close:hover { color: var(--color-primary); }
.viral-lib-search-row { display: flex; gap: var(--space-sm); align-items: center; margin-bottom: var(--space-sm); }
.viral-lib-search-input { flex: 1; font-size: var(--font-size-sm); }
.viral-lib-empty { padding: var(--space-lg) 0; text-align: center; display: flex; flex-direction: column; gap: 4px; font-size: var(--font-size-sm); color: var(--color-text-muted); }
.viral-lib-list { overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.viral-lib-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; border: 1px solid transparent; border-radius: var(--r-sm); background: none; padding: var(--space-sm); cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.viral-lib-item:hover { background: var(--color-bg-inset); border-color: var(--color-border); }
.viral-lib-item-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.viral-lib-item-meta { font-size: var(--font-size-xs); color: var(--color-text-muted); }

/* --- PR-2 F8 实测角标 --- */
.viral-measured-badge { display: inline-block; margin-left: 6px; font-size: var(--font-size-xs); font-weight: 500; color: var(--color-primary); background: var(--color-primary-light); border-radius: var(--r-pill); padding: 1px 8px; vertical-align: middle; cursor: default; }
</style>
