<template>
  <div class="cohere-card" style="cursor:default;padding:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border)">
      <span style="font-weight:600;font-size: var(--font-size-sm)">{{ t('tagSuggest.title') }}</span>
      <button class="cohere-btn-ghost" @click="$emit('close')" style="font-size: var(--font-size-xs);padding:2px 6px">✕</button>
    </div>

    <!-- Loading -->
    <div v-if="loading" style="padding:8px 0" data-testid="tag-suggester-loading">
      <UiSkeleton variant="paragraph" :rows="2" />
    </div>

    <!-- Empty / no content -->
    <div v-else-if="!content || content.trim().length < 3" style="padding:12px 0;font-size: var(--font-size-xs);color:var(--muted);text-align:center">
      {{ t('tagSuggest.emptyContent') }}
    </div>

    <!-- Error：一行收敛提示 + 行内重试（空态收敛契约：不渲染整卡结果结构） -->
    <div v-else-if="error" class="tag-error-row" data-testid="tag-suggester-error">
      <span class="tag-error-text">⚠ {{ error }}</span>
      <button class="cohere-btn-ghost tag-retry-button" @click="retry">{{ t('tagSuggest.retry') }}</button>
    </div>

    <!-- Results -->
    <div v-else-if="suggestions">
      <!-- Extracted keywords -->
      <div style="margin-bottom:6px">
        <div style="font-size: var(--font-size-xs);color:var(--muted);margin-bottom:3px">提取关键词：</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          <span role="button" tabindex="0" @keydown.enter.prevent="$emit('apply-tag', kw)" @keydown.space.prevent="$emit('apply-tag', kw)" v-for="kw in suggestions.keywords" :key="kw"
            class="cohere-tag suggested-tag"
            :class="kw.startsWith('#') ? 'cohere-tag-success' : 'cohere-tag-info'"
            data-testid="suggested-tag"
            :title="t('tagSuggest.applyTagHint')"
            style="font-size: var(--font-size-xs);padding:2px 8px;border-radius:4px"
            @click="$emit('apply-tag', kw)">
            {{ kw }}
          </span>
        </div>
      </div>

      <!-- Related terms -->
      <div v-if="suggestions.relatedTerms && suggestions.relatedTerms.length > 0" style="margin-bottom:6px">
        <div style="font-size: var(--font-size-xs);color:var(--muted);margin-bottom:3px">相关话题：</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          <span role="button" tabindex="0" @keydown.enter.prevent="$emit('apply-tag', term)" @keydown.space.prevent="$emit('apply-tag', term)" v-for="term in suggestions.relatedTerms" :key="term"
            class="cohere-tag cohere-tag-info suggested-tag"
            data-testid="suggested-tag"
            :title="t('tagSuggest.applyTagHint')"
            style="font-size: var(--font-size-xs);padding:2px 8px;border-radius:4px"
            @click="$emit('apply-tag', term)">
            {{ term }}
          </span>
        </div>
      </div>

      <!-- Per-platform tags（compact-tag-suggester-tabs）：Tab 化紧凑呈现。
           汇总 Tab = 每平台一行摘要；平台 Tab = 完整内容/流量分组。 -->
      <div v-if="suggestions.byPlatform">
        <!-- Tab 行：动态项，切换为纯视图状态（不触发重新请求） -->
        <div class="ts-tab-row" role="tablist" :aria-label="t('tagSuggest.title')">
          <button
            type="button"
            role="tab"
            data-testid="tag-tab-all"
            class="ts-tab"
            :class="{ 'ts-tab--active': normalizedActiveTab === ALL_TAB }"
            :aria-selected="normalizedActiveTab === ALL_TAB ? 'true' : 'false'"
            @click="activeTab = ALL_TAB"
          >{{ t('tagSuggest.tabAll') }}</button>
          <button
            v-for="g in platformGroups"
            :key="g.platform"
            type="button"
            role="tab"
            class="ts-tab"
            :class="{ 'ts-tab--active': normalizedActiveTab === g.platform }"
            :aria-selected="normalizedActiveTab === g.platform ? 'true' : 'false'"
            @click="activeTab = g.platform"
          >{{ platformLabel(g.platform) }}</button>
        </div>

        <!-- 汇总视图：平台名 + 前 N 个标签 + 「+N」省略徽标 + 该平台复制（复制仍为全量） -->
        <div v-if="normalizedActiveTab === ALL_TAB" class="ts-summary">
          <div v-for="row in summaryRows" :key="row.platform" class="ts-summary-row" data-testid="tag-summary-row">
            <span class="ts-summary-name">{{ platformLabel(row.platform) }}</span>
            <span class="ts-summary-tags">
              <span role="button" tabindex="0" @keydown.enter.prevent="$emit('apply-tag', tag)" @keydown.space.prevent="$emit('apply-tag', tag)" v-for="tag in row.visibleTags" :key="row.platform + ':' + tag"
                class="cohere-tag suggested-tag"
                :class="tag.startsWith('#') ? 'cohere-tag-success' : 'cohere-tag-info'"
                data-testid="suggested-tag"
                :title="t('tagSuggest.applyTagHint')"
                @click="$emit('apply-tag', tag)">
                {{ tag }}
              </span>
              <span
                v-if="row.overflow > 0"
                class="ts-more-badge"
                data-testid="tag-more-badge"
                :title="t('tagSuggest.moreTags', { platform: platformLabel(row.platform) })"
              >+{{ row.overflow }}</span>
            </span>
            <button
              class="cohere-btn-ghost ts-summary-copy"
              @click="copyPlatformTags(row.platform, row.allTags)"
              style="font-size: var(--font-size-xs);padding:2px 8px"
            >{{ t('tagSuggest.copyTags') }}</button>
          </div>
        </div>

        <!-- 平台 Tab：完整分组（detail 结构 → 内容/流量 + 热度角标；旧结构 → fallback 单组 + 复制） -->
        <div v-else class="ts-platform-detail">
          <template v-if="activeGroup && activeGroup.detail">
            <div style="font-size: var(--font-size-xs);color:var(--muted);margin:4px 0 3px"><el-icon><EditPen /></el-icon> {{ t('tagSuggest.contentTags') }}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">
              <span role="button" tabindex="0" @keydown.enter.prevent="$emit('apply-tag', tag)" @keydown.space.prevent="$emit('apply-tag', tag)" v-for="tag in activeGroup.detail.content" :key="'c-'+tag"
                class="cohere-tag cohere-tag-info suggested-tag"
                data-testid="suggested-tag"
                :title="t('tagSuggest.applyTagHint')"
                style="font-size: var(--font-size-xs);padding:2px 6px;border-radius:4px"
                @click="$emit('apply-tag', tag)">
                {{ tag }}
              </span>
            </div>

            <div style="font-size: var(--font-size-xs);color:var(--muted);margin:4px 0 3px"><el-icon><TrendCharts /></el-icon> {{ t('tagSuggest.trafficTags') }}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">
              <span role="button" tabindex="0" @keydown.enter.prevent="$emit('apply-tag', tag)" @keydown.space.prevent="$emit('apply-tag', tag)" v-for="tag in activeGroup.detail.traffic" :key="'t-'+tag"
                class="cohere-tag cohere-tag-success suggested-tag"
                data-testid="suggested-tag"
                :title="hotTitle(activeGroup.platform, tag) || t('tagSuggest.applyTagHint')"
                style="font-size: var(--font-size-xs);padding:2px 6px;border-radius:4px"
                @click="$emit('apply-tag', tag)">
                {{ tag }}<sup v-if="hotHeat(activeGroup.platform, tag) != null" class="heat-badge">{{ hotHeat(activeGroup.platform, tag) }}</sup>
              </span>
            </div>
          </template>

          <!-- Fallback: single merged group (old structure) -->
          <template v-else-if="activeGroup">
            <div style="display:flex;flex-wrap:wrap;gap:4px">
              <span role="button" tabindex="0" @keydown.enter.prevent="$emit('apply-tag', tag)" @keydown.space.prevent="$emit('apply-tag', tag)" v-for="tag in activeGroup.tags" :key="tag"
                class="cohere-tag suggested-tag"
                :class="tag.startsWith('#') ? 'cohere-tag-success' : 'cohere-tag-info'"
                data-testid="suggested-tag"
                :title="t('tagSuggest.applyTagHint')"
                style="font-size: var(--font-size-xs);padding:2px 6px;border-radius:4px"
                @click="$emit('apply-tag', tag)">
                {{ tag }}
              </span>
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:4px">
              <button
                class="cohere-btn-ghost"
                @click="copyPlatformTags(activeGroup.platform, allTags(activeGroup))"
                style="font-size: var(--font-size-xs);padding:2px 8px"
              >{{ t('tagSuggest.copyTags') }}</button>
            </div>
          </template>
        </div>

        <!-- Source / calibration status -->
        <div style="font-size: var(--font-size-xs);color:var(--muted);margin-top:2px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
          <template v-if="suggestions.source === 'llm'">
            <span>{{ t('tagSuggest.sourceAI') }}</span>
            <span :class="suggestions.calibrated ? 'src-ok' : 'src-warn'">
              {{ suggestions.calibrated ? t('tagSuggest.calibrated') : t('tagSuggest.notCalibrated') }}
            </span>
          </template>
          <template v-else-if="suggestions.source === 'extractor'">
            <span>{{ t('tagSuggest.sourceLocal') }}</span>
          </template>
          <template v-else>
            <span>{{ t('tagSuggest.aiNotConfigured') }}</span>
          </template>
          <span v-if="suggestions.fallback" class="src-warn">{{ t('tagSuggest.fallbackNotice') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { EditPen, TrendCharts } from '@element-plus/icons-vue'
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlatformStore } from '@/stores/platforms'
import { ElMessage } from 'element-plus'
import { intelligenceSuggestTags } from '@/api/publisher'

const props = defineProps({
  content: { type: String, required: true },
  // 发布目标联动（openspec optimize-publish-right-rail）：请求平台跟随用户勾选；
  // 空数组/未传时回退全量目录，保证未选平台时面板不出空态。
  platforms: { type: Array, default: () => [] },
})

defineEmits(['close', 'apply-tag'])

const { t } = useI18n()

const loading = ref(false)
const error = ref(null)
const suggestions = ref(null)
const platformStore = usePlatformStore()
platformStore.load()

// ── Tab 化紧凑呈现（openspec/changes/compact-tag-suggester-tabs） ──
// activeTab：'__all__' = 汇总视图（每平台一行摘要）；其余值 = 平台 key（完整分组视图）。
const ALL_TAB = '__all__'
const activeTab = ref(ALL_TAB)
// 汇总行标签容量：单平台行最多展示的标签个数，超出部分收进「+N」省略徽标。
const SUMMARY_TAG_LIMIT = 6

// 全量建议平台目录：platforms prop 为空时的回退范围（保持既有行为）。
const FULL_SUGGESTION_PLATFORMS = ['zhihu', 'weibo', 'xiaohongshu', 'bilibili', 'toutiao']

const requestPlatforms = computed(() => {
  const list = Array.isArray(props.platforms)
    ? props.platforms.filter((p) => typeof p === 'string' && p)
    : []
  return list.length > 0 ? list : FULL_SUGGESTION_PLATFORMS
})

function platformLabel (key) {
  return platformStore.getLabel(key) || key
}

// Grouped view: prefer byPlatformDetail; fall back to single merged group (old structure)
const platformGroups = computed(() => {
  const s = suggestions.value
  if (!s || !s.byPlatform) return []
  const detail = s.byPlatformDetail || {}
  return Object.keys(s.byPlatform).map((p) => ({
    platform: p,
    detail: detail[p] || null,
    tags: s.byPlatform[p] || [],
  }))
})

// activeTab 归一化：非法值（平台已消失/未知来源）一律按汇总渲染，不信任状态残留。
const normalizedActiveTab = computed(() => {
  if (activeTab.value === ALL_TAB) return ALL_TAB
  return platformGroups.value.some((g) => g.platform === activeTab.value)
    ? activeTab.value
    : ALL_TAB
})

// 当前选中平台 Tab 的分组视图模型（汇总视图下为 null）。
const activeGroup = computed(() => {
  if (normalizedActiveTab.value === ALL_TAB) return null
  return platformGroups.value.find((g) => g.platform === normalizedActiveTab.value) || null
})

// 数组守卫：byPlatformDetail / byPlatform 的字段缺失或非数组时按空数组处理。
function safeTags (value) {
  return Array.isArray(value) ? value : []
}

// 汇总行视图模型：totalTags 与 allTags() 同序（content + traffic），
// visibleTags 截断到 SUMMARY_TAG_LIMIT，overflow 计算剩余数。
const summaryRows = computed(() => {
  return platformGroups.value.map((g) => {
    const total = g.detail
      ? [...safeTags(g.detail.content), ...safeTags(g.detail.traffic)]
      : safeTags(g.tags)
    return {
      platform: g.platform,
      visibleTags: total.slice(0, SUMMARY_TAG_LIMIT),
      overflow: Math.max(0, total.length - SUMMARY_TAG_LIMIT),
      allTags: total,
    }
  })
})

function allTags (g) {
  return g.detail ? [...safeTags(g.detail.content), ...safeTags(g.detail.traffic)] : safeTags(g.tags)
}

function hotHeat (platform, tag) {
  const mt = suggestions.value?.matchedTopics?.[platform]
  if (!mt) return null
  const m = mt.find((x) => x.tag === tag)
  return m ? m.heat : null
}

function hotTitle (platform, tag) {
  const heat = hotHeat(platform, tag)
  if (heat == null) return ''
  return t('tagSuggest.hotMatch', { tag, heat })
}

let debounceTimer = null
// R20 修复：组件卸载时清理 debounce timer
onBeforeUnmount(() => { if (debounceTimer) clearTimeout(debounceTimer) })

async function runAnalysis (content) {
  loading.value = true
  error.value = null
  try {
    const res = await intelligenceSuggestTags(content, {
      platforms: requestPlatforms.value,
    })
    const data = res?.code === 0 ? res.data : null
    if (data && data.keywords) {
      suggestions.value = data
    } else {
      suggestions.value = { keywords: [], relatedTerms: [], byPlatform: {} }
    }
  } catch {
    error.value = t('tagSuggest.analysisFailed')
    suggestions.value = null
  } finally {
    loading.value = false
  }
}

// 显式重试：用户点击错误行上的重试按钮，绕过防抖立即重新分析。
function retry () {
  const content = props.content
  if (!content || content.trim().length < 3) return
  runAnalysis(content)
}

// content 与 platforms 共用同一防抖：任一变化只重置计时器，避免请求风暴。
watch([() => props.content, () => props.platforms], ([newVal]) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!newVal || newVal.trim().length < 3) {
    suggestions.value = null
    error.value = null
    return
  }
  debounceTimer = setTimeout(() => runAnalysis(newVal), 800)
})

// Tab 回落：平台分组变化后（如更改发布目标重新分析），选中平台若从结果中消失则回落汇总。
watch(platformGroups, () => {
  if (activeTab.value !== ALL_TAB && !platformGroups.value.some((g) => g.platform === activeTab.value)) {
    activeTab.value = ALL_TAB
  }
})

async function copyPlatformTags (platform, tags) {
  const text = tags.join(' ')
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(t('tagSuggest.tagsCopied', { platform: platformLabel(platform) }))
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    ElMessage.success(t('tagSuggest.tagsCopied', { platform: platformLabel(platform) }))
  }
}
</script>

<style scoped>
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.heat-badge {
  margin-left: 2px;
  font-size: var(--font-size-xs);
  color: var(--coral);
  vertical-align: super;
}
.src-ok { color: var(--success, #2e7d32); }
.src-warn { color: var(--coral); }
/* 空态收敛：错误提示一行呈现，重试按钮行内可达 */
.tag-error-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  font-size: var(--font-size-sm);
  color: var(--coral);
}
.tag-retry-button { font-size: var(--font-size-xs); padding: 2px 8px; white-space: nowrap; }
/* 点击填入：建议标签可点击 */
.suggested-tag { cursor: pointer; }
.suggested-tag:hover { opacity: 0.8; outline: 1px dashed var(--coral); }

/* ── Tab 化紧凑呈现（compact-tag-suggester-tabs） ── */
.ts-tab-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}
.ts-tab {
  appearance: none;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: var(--font-size-xs);
  line-height: 1;
  padding: 3px 9px;
  border-radius: 999px;
  cursor: pointer;
}
.ts-tab:hover { color: var(--text); }
.ts-tab--active {
  background: var(--coral-soft, rgba(255, 122, 89, 0.12));
  border-color: var(--coral);
  color: var(--coral);
  font-weight: 600;
}
.ts-summary { display: flex; flex-direction: column; gap: 0; }
.ts-summary-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 2px var(--space-sm);
  border-radius: 6px;
}
.ts-summary-row:nth-child(odd) { background: #f8f9fa; }
.ts-summary-name {
  flex: 0 0 auto;
  min-width: 44px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text);
  padding-top: 2px;
}
.ts-summary-tags {
  flex: 1 1 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  min-width: 0;
}
.ts-summary-tags .cohere-tag {
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  border-radius: 4px;
}
.ts-more-badge {
  font-size: var(--font-size-xs);
  color: var(--muted);
  padding: 2px 4px;
  cursor: default;
}
.ts-summary-copy { flex: 0 0 auto; }
/* 平台 Tab 兜底：完整分组过长时限高滚动；默认汇总视图不受影响 */
.ts-platform-detail { max-height: 260px; overflow-y: auto; }
</style>
