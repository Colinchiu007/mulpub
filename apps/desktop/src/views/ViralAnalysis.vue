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
            <UiButton @click="doAnalyze" :disabled="!topic.trim() || loading">
              <el-icon><DataLine /></el-icon> 爆款分析
            </UiButton>
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

        <!-- 结果 Tab -->
        <div v-if="result" class="viral-result">
          <!-- 分析结果概览 -->
          <div v-if="result.overall_score !== undefined" class="cohere-card viral-card-static viral-overview-card">
            <div class="viral-overview-row">
              <div class="viral-score-block">
                <div class="viral-score-value">{{ result.overall_score }}</div>
                <div class="viral-score-label">爆款潜力分</div>
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
                    <div class="viral-factor-fill" :style="{width: (f.score * 100)+'%', background: scoreColor(f.score)}"></div>
                  </div>
                  <span class="viral-factor-score">{{ (f.score * 100).toFixed(0) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 平台对比 -->
          <div v-if="result.platform_scores && Object.keys(result.platform_scores).length" class="viral-section">
            <div class="viral-section-title">🌐 平台评分</div>
            <div class="viral-tag-row">
              <div v-for="(score, plat) in result.platform_scores" :key="plat"
                class="cohere-card viral-card-static viral-platform-card"
              >
                <div class="viral-platform-name">{{ plat }}</div>
                <div class="viral-platform-score" :style="{color: scoreColor(score/100)}">{{ score.toFixed(1) }}</div>
              </div>
            </div>
          </div>

          <!-- 推荐结构 -->
          <div v-if="result.suggested_structures && result.suggested_structures.length" class="viral-section">
            <div class="viral-section-title">🏆 推荐标题结构</div>
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

          <!-- 生成结果 -->
          <div v-if="genResult" class="viral-result">
            <div class="viral-section-title"><el-icon><MagicStick /></el-icon> 生成结果 ({{ genResult.task }})</div>

            <!-- 标题列表面板 -->
            <div v-if="genResult.task === 'titles' && genResult.data?.titles" class="cohere-card viral-card-static">
              <div v-for="(t, idx) in genResult.data.titles" :key="idx"
                class="viral-title-row"
                :class="{ 'viral-title-row--last': idx === genResult.data.titles.length - 1 }"
              >
                <div class="viral-title-num">#{{ idx + 1 }}</div>
                <div class="viral-title-body">
                  <div class="viral-title-text">{{ t.title }}</div>
                  <div class="viral-title-meta">
                    <span v-if="t.structure" class="cohere-tag">{{ t.structure }}</span>
                    <span v-if="t.emotion" class="cohere-tag">{{ t.emotion }}</span>
                    <span v-if="t.predicted_score" class="viral-title-score">预测分 {{ t.predicted_score }}</span>
                    <button
                      class="cohere-btn-secondary viral-go-rewrite"
                      data-testid="viral-go-rewrite"
                      @click="goRewrite(t.title)"
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
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="loading" class="viral-loading" data-testid="viral-analysis-loading">
          <UiSkeleton variant="chart" />
        </div>
        <EmptyState
          v-else-if="!result"
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
import { viralAnalyze, viralGenerate } from '@/api/publisher'
import { addViralToLibrary } from '@/api/knowledge-library'
import UiButton from '../components/UiButton.vue'
import { CaretBottom, CaretRight, CaretTop, DataLine, FolderAdd, Key, MagicStick, TrendCharts } from '@element-plus/icons-vue'
import { formatUserError } from '@/utils/user-facing-error'
import { useViralSignalStore } from '@/stores/viral-signal'
export default {

components: { UiButton, CaretBottom, CaretRight, CaretTop, DataLine, FolderAdd, Key, MagicStick, TrendCharts },
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
    }
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
          this.result = { overall_score: 0, error: formatUserError(res, { fallback: '分析失败' }).message }
        }
      } catch (err) {
        this.result = { overall_score: 0, error: formatUserError(err, { fallback: '分析失败' }).message }
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
          task: 'titles',
          count: 5,
        }
        const res = await viralGenerate(opts)
        if (res?.code === 0) {
          this.genResult = res.data
        }
      } catch (err) {
        this.genResult = { task: 'titles', error: formatUserError(err, { fallback: '标题生成失败' }).message }
      } finally {
        this.loading = false
      }
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
.viral-header-row { display: flex; align-items: center; gap: var(--space-md); width: 100%; }
.viral-header-main { flex: 1; }
.viral-input-row { display: flex; gap: var(--space-md); flex-wrap: wrap; }
.viral-field-topic { flex: 2; min-width: 280px; }
.viral-field-platform { flex: 1; min-width: 160px; }
.viral-input-md { font-size: 14px; } /* 14px：七档外存量字号，档位收敛属 T1-6 */
.viral-actions { display: flex; align-items: flex-end; gap: var(--space-sm); }
.viral-btn-generate { background: var(--color-danger); border-color: var(--color-danger); }
.viral-card-static { cursor: default; }

/* --- 文章数据（可选） --- */
.viral-article-section { margin-top: var(--space-md); }
.viral-details-summary { cursor: pointer; font-size: var(--font-size-sm); color: var(--color-text-muted); }
.viral-article-form { margin-top: var(--space-sm); }
.viral-article-textarea { font-size: var(--font-size-sm); font-family: monospace; resize: vertical; }

/* --- 结果区通用 --- */
.viral-result { margin-top: var(--space-lg); }
.viral-section { margin-top: var(--space-md); }
.viral-section-title { font-size: 14px; font-weight: 600; margin-bottom: var(--space-sm); } /* 14px：档位收敛属 T1-6 */
.viral-block-title-sm { font-size: var(--font-size-sm); font-weight: 600; margin-bottom: 4px; }
.viral-tag-row { display: flex; gap: 6px; flex-wrap: wrap; }
.viral-loading { padding: 16px 0; }

/* --- 概览 --- */
.viral-overview-card { background: var(--color-bg-inset); }
.viral-overview-row { display: flex; align-items: center; gap: var(--space-lg); flex-wrap: wrap; }
.viral-score-block { text-align: center; }
.viral-score-value { font-size: 32px; font-weight: 700; color: var(--color-danger); }
.viral-score-label { font-size: var(--font-size-xs); color: var(--color-text-muted); }
.viral-trend-icon { font-size: 24px; }
.viral-angles { flex: 1; min-width: 200px; }

/* --- 落库行 --- */
.viral-save-row { margin-top: var(--space-sm); display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }
.viral-saved-note { font-size: var(--font-size-sm); color: var(--color-text-muted); }
.viral-note { font-size: var(--font-size-xs); color: var(--color-text-muted); }

/* --- 因子分解 --- */
.viral-factor-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--space-sm); }
.viral-factor-card { padding: var(--space-sm); }
.viral-factor-row { display: flex; align-items: center; gap: 8px; }
.viral-factor-bar { flex: 1; height: 6px; background: var(--color-border); border-radius: 3px; overflow: hidden; }
.viral-factor-fill { height: 100%; border-radius: 3px; transition: width 0.5s; }
.viral-factor-score { font-size: var(--font-size-xs); font-weight: 600; color: var(--color-text-muted); }

/* --- 平台对比 --- */
.viral-platform-card { padding: var(--space-sm); text-align: center; min-width: 120px; }
.viral-platform-name { font-size: var(--font-size-xs); color: var(--color-text-muted); margin-bottom: 4px; }
.viral-platform-score { font-size: 20px; font-weight: 700; }

/* --- 推荐结构 --- */
.viral-structure-card { padding: var(--space-sm); flex: 1; min-width: 180px; }
.viral-lift { font-size: var(--font-size-xs); color: var(--color-danger); margin-top: 2px; }
.viral-keyword-tag {
  font-size: var(--font-size-sm);
  padding: 2px 10px;
  border-radius: var(--r-xs);
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

/* --- 生成标题列表 --- */
.viral-title-row { padding: var(--space-sm); border-bottom: 1px solid var(--color-border); display: flex; gap: var(--space-sm); align-items: flex-start; }
.viral-title-row--last { border-bottom: none; }
.viral-title-num { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text-muted); min-width: 24px; }
.viral-title-body { flex: 1; }
.viral-title-text { font-size: 15px; font-weight: 600; margin-bottom: 2px; }
.viral-title-meta { display: flex; gap: 8px; font-size: var(--font-size-xs); color: var(--color-text-muted); flex-wrap: wrap; align-items: center; }
.viral-title-score { color: var(--color-danger); font-weight: 600; }
.viral-go-rewrite { font-size: var(--font-size-xs); padding: 2px 10px; }
.viral-title-reason { font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 2px; }

/* --- Hook / 改写 / 结构建议 --- */
.viral-hook-row { padding: var(--space-sm); border-bottom: 1px solid var(--color-border); margin-bottom: var(--space-sm); }
.viral-hook-text { font-size: 14px; line-height: 1.6; margin-bottom: 4px; } /* 14px：档位收敛属 T1-6 */
.viral-rewrite-meta { font-size: var(--font-size-xs); color: var(--color-text-muted); margin-bottom: var(--space-sm); }
.viral-rewrite-content { font-size: 14px; line-height: 1.8; white-space: pre-wrap; } /* 14px：档位收敛属 T1-6 */
.viral-suggest-head { display: flex; align-items: center; gap: var(--space-sm); }
.viral-suggest-name { font-size: 14px; font-weight: 600; } /* 14px：档位收敛属 T1-6 */
.viral-suggest-score { font-size: var(--font-size-xs); font-weight: 600; }
.viral-suggest-reason { font-size: var(--font-size-sm); color: var(--color-text-muted); margin-top: 4px; }
.viral-suggest-outline { font-size: var(--font-size-sm); margin-top: 6px; white-space: pre-wrap; line-height: 1.5; }
</style>
