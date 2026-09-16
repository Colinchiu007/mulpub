<template>
  <div>
    <div class="cohere-page-header">
      <div style="display:flex;align-items:center;gap:var(--space-md);width:100%">
        <div style="flex:1">
          <div class="page-title">🔥 爆款分析</div>
          <div class="page-subtitle">
            AI 驱动的内容爆款因子分析 + 文案生成
          </div>
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="cohere-content">
      <div class="cohere-card" style="cursor:default">
        <div style="display:flex;gap:var(--space-md);flex-wrap:wrap">
          <div style="flex:2;min-width:280px">
            <label class="cohere-form-label">主题 / 关键词</label>
            <input
              class="cohere-input"
              v-model="topic"
              placeholder="输入你想分析的主题，如「AI工具推荐」"
              @keyup.enter="doAnalyze"
              style="font-size:14px"
            />
          </div>
          <div style="flex:1;min-width:160px">
            <label class="cohere-form-label">目标平台</label>
            <select class="cohere-input" v-model="platform" style="font-size:14px">
              <option value="通用">通用</option>
              <option value="小红书">小红书</option>
              <option value="抖音">抖音</option>
              <option value="公众号">公众号</option>
              <option value="Reddit">Reddit</option>
            </select>
          </div>
          <div style="display:flex;align-items:flex-end;gap:var(--space-sm)">
            <UiButton @click="doAnalyze" :disabled="!topic.trim() || loading">
              📊 爆款分析
            </UiButton>
            <UiButton @click="doGenerate" :disabled="!topic.trim() || loading" style="background:var(--coral);border-color:var(--coral)">
              ✨ 生成文案
            </UiButton>
          </div>
        </div>

        <!-- 文章数据输入（可选） -->
        <div style="margin-top:var(--space-md)">
          <details>
            <summary style="cursor:pointer;font-size:13px;color:var(--muted)">手动输入文章数据（可选，提高分析精度）</summary>
            <div style="margin-top:var(--space-sm)">
              <label class="cohere-form-label">文章数据（JSON 数组，每篇含 title/like_count/comment_count）</label>
              <textarea
                class="cohere-input"
                v-model="articleData"
                placeholder='[{"title":"AI工具推荐","like_count":1234,"comment_count":89,"platform_code":"xiaohongshu"}]'
                rows="4"
                style="font-size:13px;font-family:monospace;resize:vertical"
              ></textarea>
            </div>
          </details>
        </div>

        <!-- 结果 Tab -->
        <div v-if="result" style="margin-top:var(--space-lg)">
          <!-- 分析结果概览 -->
          <div v-if="result.overall_score !== undefined" class="cohere-card" style="cursor:default;background:var(--bg-secondary)">
            <div style="display:flex;align-items:center;gap:var(--space-lg);flex-wrap:wrap">
              <div style="text-align:center">
                <div style="font-size:32px;font-weight:700;color:var(--coral)">{{ result.overall_score }}</div>
                <div style="font-size:12px;color:var(--muted)">爆款潜力分</div>
              </div>
              <div v-if="result.trend_direction" style="text-align:center">
                <div style="font-size:24px">{{ trendIcon(result.trend_direction) }}</div>
                <div style="font-size:12px;color:var(--muted)">{{ trendLabel(result.trend_direction) }}</div>
              </div>
              <div v-if="result.suggested_angles" style="flex:1;min-width:200px">
                <div style="font-size:13px;font-weight:600;margin-bottom:4px">推荐写作角度</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  <span v-for="angle in result.suggested_angles.slice(0,4)" :key="angle" class="cohere-tag cohere-tag-info">{{ angle }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 因子分解 -->
          <div v-if="result.factors && result.factors.length" style="margin-top:var(--space-md)">
            <div style="font-size:14px;font-weight:600;margin-bottom:var(--space-sm)">📊 因子分解</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-sm)">
              <div v-for="f in result.factors" :key="f.name"
                class="cohere-card"
                style="cursor:default;padding:var(--space-sm)"
              >
                <div style="font-size:13px;font-weight:600;margin-bottom:4px">{{ f.label || f.name }}</div>
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
                    <div :style="{width: (f.score * 100)+'%', height:'100%', background: scoreColor(f.score), borderRadius:'3px', transition:'width 0.5s'}"></div>
                  </div>
                  <span style="font-size:12px;font-weight:600;color:var(--muted)">{{ (f.score * 100).toFixed(0) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 平台对比 -->
          <div v-if="result.platform_scores && Object.keys(result.platform_scores).length" style="margin-top:var(--space-md)">
            <div style="font-size:14px;font-weight:600;margin-bottom:var(--space-sm)">🌐 平台评分</div>
            <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap">
              <div v-for="(score, plat) in result.platform_scores" :key="plat"
                class="cohere-card"
                style="cursor:default;padding:var(--space-sm);text-align:center;min-width:120px"
              >
                <div style="font-size:12px;color:var(--muted);margin-bottom:4px">{{ plat }}</div>
                <div :style="{fontSize:'20px',fontWeight:700,color: scoreColor(score/100)}">{{ score.toFixed(1) }}</div>
              </div>
            </div>
          </div>

          <!-- 推荐结构 -->
          <div v-if="result.suggested_structures && result.suggested_structures.length" style="margin-top:var(--space-md)">
            <div style="font-size:14px;font-weight:600;margin-bottom:var(--space-sm)">🏆 推荐标题结构</div>
            <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap">
              <div v-for="(s, idx) in result.suggested_structures" :key="idx"
                class="cohere-card"
                style="cursor:default;padding:var(--space-sm);flex:1;min-width:180px"
              >
                <div style="font-size:13px;font-weight:600">{{ s.structure }}</div>
                <div v-if="s.expected_lift" style="font-size:12px;color:var(--coral);margin-top:2px">
                  期望互动 +{{ s.expected_lift }}
                </div>
              </div>
            </div>
          </div>

          <!-- 上升关键词 -->
          <div v-if="result.rising_keywords && result.rising_keywords.length" style="margin-top:var(--space-md)">
            <div style="font-size:14px;font-weight:600;margin-bottom:var(--space-sm)">🔑 上升关键词</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <span v-for="kw in result.rising_keywords.slice(0,10)" :key="kw.word"
                style="font-size:13px;padding:2px 10px;border-radius:4px;background:var(--coral-tag-bg, var(--surface)0f0);color:var(--coral)"
              >
                {{ kw.word }}
              </span>
            </div>
          </div>

          <!-- 生成结果 -->
          <div v-if="genResult" style="margin-top:var(--space-lg)">
            <div style="font-size:14px;font-weight:600;margin-bottom:var(--space-sm)">✨ 生成结果 ({{ genResult.task }})</div>

            <!-- 标题列表面板 -->
            <div v-if="genResult.task === 'titles' && genResult.data?.titles" class="cohere-card" style="cursor:default">
              <div v-for="(t, idx) in genResult.data.titles" :key="idx"
                :style="{
                  padding: 'var(--space-sm)',
                  borderBottom: idx < genResult.data.titles.length - 1 ? '1px solid var(--border)' : 'none',
                  display: 'flex',
                  gap: 'var(--space-sm)',
                  alignItems: 'flex-start'
                }"
              >
                <div style="font-size:13px;font-weight:600;color:var(--muted);min-width:24px">#{{ idx + 1 }}</div>
                <div style="flex:1">
                  <div style="font-size:15px;font-weight:600;margin-bottom:2px">{{ t.title }}</div>
                  <div style="display:flex;gap:8px;font-size:12px;color:var(--muted);flex-wrap:wrap">
                    <span v-if="t.structure" class="cohere-tag">{{ t.structure }}</span>
                    <span v-if="t.emotion" class="cohere-tag">{{ t.emotion }}</span>
                    <span v-if="t.predicted_score" style="color:var(--coral);font-weight:600">预测分 {{ t.predicted_score }}</span>
                  </div>
                  <div v-if="t.reasoning" style="font-size:12px;color:var(--muted);margin-top:2px">{{ t.reasoning }}</div>
                </div>
              </div>
            </div>

            <!-- Hook 面板 -->
            <div v-if="genResult.task === 'hooks' && genResult.data?.hooks" class="cohere-card" style="cursor:default">
              <div v-for="(h, idx) in genResult.data.hooks" :key="idx"
                style="padding:var(--space-sm);border-bottom: 1px solid var(--border);margin-bottom:var(--space-sm)"
              >
                <div style="font-size:14px;line-height:1.6;margin-bottom:4px">{{ h.hook }}</div>
                <div v-if="h.technique" style="font-size:12px;color:var(--muted)">技法: {{ h.technique }}</div>
              </div>
            </div>

            <!-- 改写面板 -->
            <div v-if="genResult.task === 'rewrite' && genResult.data?.rewritten_content" class="cohere-card" style="cursor:default">
              <div style="font-size:12px;color:var(--muted);margin-bottom:var(--space-sm)">
                原文 {{ genResult.data.original_word_count }} 字 → 改写 {{ genResult.data.rewritten_word_count }} 字
              </div>
              <div style="font-size:14px;line-height:1.8;white-space:pre-wrap">{{ genResult.data.rewritten_content }}</div>
            </div>

            <!-- 结构建议 -->
            <div v-if="genResult.task === 'structures' && genResult.data?.suggestions" class="cohere-card" style="cursor:default">
              <div v-for="(s, idx) in genResult.data.suggestions" :key="idx"
                style="padding:var(--space-sm);border-bottom: 1px solid var(--border);margin-bottom:var(--space-sm)"
              >
                <div style="display:flex;align-items:center;gap:var(--space-sm)">
                  <span style="font-size:14px;font-weight:600">{{ s.structure_name || s.structure }}</span>
                  <span v-if="s.score" :style="{fontSize:'12px',fontWeight:600,color: scoreColor(s.score/100)}">{{ s.score }} 分</span>
                </div>
                <div v-if="s.reasoning" style="font-size:13px;color:var(--muted);margin-top:4px">{{ s.reasoning }}</div>
                <div v-if="s.outline" style="font-size:13px;margin-top:6px;white-space:pre-wrap;line-height:1.5">{{ s.outline }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="loading" style="padding:16px 0" data-testid="viral-analysis-loading">
          <UiSkeleton variant="chart" />
        </div>
        <EmptyState
          v-else-if="!result"
          data-testid="viral-analysis-empty"
          icon="🔥"
          :title="$t('viralAnalysis.empty.title')"
          :description="$t('viralAnalysis.empty.message')"
        />
      </div>
    </div>
  </div>
</template>

<script>
import { viralAnalyze, viralGenerate } from '@/api/publisher'
import UiButton from '../components/UiButton.vue'
import { formatUserError } from '@/utils/user-facing-error'
export default {
  
  components: { UiButton },
  data () {
    return {
      topic: '',
      platform: '通用',
      articleData: '',
      loading: false,
      result: null,
      genResult: null,
    }
  },
  methods: {
    async doAnalyze () {
      if (!this.topic.trim() || this.loading) return
      this.loading = true
      this.result = null
      this.genResult = null

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
      const icons = { rising: '📈', declining: '📉', stable: '➡️' }
      return icons[direction] || '➡️'
    },

    trendLabel (direction) {
      const labels = { rising: '上升中', declining: '下降中', stable: '平稳' }
      return labels[direction] || direction
    },

    scoreColor (score) {
      if (score >= 0.7) return '#e74c3c'
      if (score >= 0.4) return '#e67e22'
      return '#95a5a6'
    },
  },
}
</script>
