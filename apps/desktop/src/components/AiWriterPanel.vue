<template>
  <div id="ai-writer-panel" class="ai-writer-panel cohere-card" style="cursor:default;padding:16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-md);padding-bottom:var(--space-sm);border-bottom:1px solid var(--border)">
      <span style="font-weight:600;font-size:14px">🤖 AI 辅助写作</span>
      <button
        type="button"
        class="cohere-btn-ghost"
        aria-label="关闭 AI 写作"
        title="关闭"
        style="font-size:12px;padding:2px 6px"
        @click="emit('close')"
      >✕</button>
    </div>

    <p v-if="panelError" class="panel-error" role="alert">{{ panelError }}</p>

    <!-- 未配置 API Key -->
    <div v-if="!configured" class="no-config">
      <div style="margin-bottom:8px">需要配置 LLM API Key 才能使用 AI 功能</div>
      <button class="cohere-btn-primary" @click="goToProviders">前往 Provider 设置</button>
    </div>

    <!-- API 已配置 -->
    <template v-else>
      <!-- 模式选择 -->
      <div class="mode-tabs">
        <button
          v-for="mode in modes" :key="mode.key"
          class="mode-tab"
          :class="{ active: activeMode === mode.key }"
          @click="activeMode = mode.key"
        ><el-icon v-if="mode.icon"><component :is="mode.icon" /></el-icon>{{ mode.label }}</button>
      </div>

      <!-- 标题生成 -->
      <div v-if="activeMode === 'titles'" class="mode-content">
        <div class="cohere-form-item">
          <label class="cohere-form-label">主题 / 关键词</label>
          <input class="cohere-input" v-model="topic" placeholder="输入文章主题或关键词" @keyup.enter="generateTitles" />
        </div>
        <div class="cohere-form-item">
          <button class="cohere-btn-primary" @click="generateTitles" :disabled="generating || !topic.trim()">
            {{ generating ? '生成中...' : '生成标题' }}
          </button>
        </div>
        <div v-if="titles.length > 0" class="results">
          <button
            v-for="(t, i) in titles" :key="i"
            type="button"
            class="result-item"
            @click="selectTitle(t)"
          >
            <span class="result-num">{{ i + 1 }}</span>
            <span class="result-text">{{ t }}</span>
            <span class="result-action">选择</span>
          </button>
        </div>
      </div>

      <!-- 内容润色 -->
      <div v-if="activeMode === 'enhance'" class="mode-content">
        <div class="cohere-form-item">
          <label class="cohere-form-label">选择润色风格</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button
              v-for="s in styles" :key="s.key"
              class="style-chip"
              :class="{ active: selectedStyle === s.key }"
              @click="selectedStyle = s.key"
            >{{ s.label }}</button>
          </div>
        </div>
        <div class="cohere-form-item">
          <button class="cohere-btn-primary" @click="enhanceContent" :disabled="enhancing">
            {{ enhancing ? '润色中...' : '润色正文' }}
          </button>
        </div>
        <div v-if="enhancedResult" class="results">
          <button type="button" class="result-item" @click="selectEnhanced">
            <span class="result-text">{{ enhancedResult.slice(0, 100) }}{{ enhancedResult.length > 100 ? '...' : '' }}</span>
            <span class="result-action">应用</span>
          </button>
        </div>
      </div>

      <!-- 摘要生成 -->
      <div v-if="activeMode === 'summary'" class="mode-content">
        <div class="cohere-form-item">
          <button class="cohere-btn-primary" @click="generateSummary" :disabled="summarizing">
            {{ summarizing ? '生成中...' : '生成摘要' }}
          </button>
        </div>
        <div v-if="summary" class="results">
          <button type="button" class="result-item" @click="selectSummary">
            <span class="result-text">{{ summary }}</span>
            <span class="result-action">应用</span>
          </button>
        </div>
      </div>

      <!-- 改写引擎 -->
      <div v-if="activeMode === 'rewrite'" class="mode-content">
        <!-- 知识库结合选项 -->
        <div class="config-checkboxes" style="margin-bottom:8px">
          <label class="config-checkbox" :class="{ disabled: rewriting }">
            <input type="checkbox" v-model="useViralLibrary" :disabled="rewriting" class="coral-check" />
            <span class="checkbox-label"><span class="checkbox-icon"><el-icon><TrendCharts /></el-icon></span> 结合爆款库</span>
          </label>
          <label class="config-checkbox" :class="{ disabled: rewriting }">
            <input type="checkbox" v-model="usePersonalExperience" :disabled="rewriting" class="coral-check" />
            <span class="checkbox-label"><span class="checkbox-icon"><el-icon><EditPen /></el-icon></span> 结合个人经历</span>
          </label>
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">改写模式</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button
              v-for="m in rewriteModes" :key="m.key"
              class="style-chip" :class="{ active: rewriteMode === m.key }"
              @click="rewriteMode = m.key"
            >{{ m.label }}</button>
          </div>
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">行业</label>
          <select v-model="rewriteIndustry" class="cohere-input">
            <option v-for="o in industryOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">目的</label>
          <select v-model="rewritePurpose" class="cohere-input">
            <option v-for="o in purposeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">语言风格</label>
          <select v-model="rewriteTone" class="cohere-input">
            <option v-for="o in toneOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">目标平台</label>
          <select v-model="rewritePlatform" class="cohere-input">
            <option v-for="o in platformOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">长度</label>
          <select v-model="rewriteTargetLength" class="cohere-input">
            <option v-for="o in targetLengthOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">{{ t('rewritePage.strategyLabel') }}</label>
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:4px">
            <label style="font-size:12px;cursor:pointer"><input type="radio" v-model="strategyMode" value="auto" /> {{ t('rewritePage.strategyAuto') }}</label>
            <label style="font-size:12px;cursor:pointer"><input type="radio" v-model="strategyMode" value="manual" /> {{ t('rewritePage.strategyManual') }}</label>
          </div>
          <select v-if="strategyMode === 'manual'" v-model="rewriteStrategyId" class="cohere-input" style="margin-top:4px">
            <option value="">-- 选择策略 --</option>
            <option v-for="s in rewriteStrategies" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div class="cohere-form-item">
          <label class="cohere-form-label">输入文案</label>
          <textarea class="cohere-input" v-model="rewriteContent" rows="4" placeholder="输入需要改写的文案内容（最多 6000 字）"></textarea>
        </div>
        <div class="cohere-form-item">
          <button class="cohere-btn-primary" @click="doRewrite" :disabled="rewriting || !rewriteContent.trim()">
            {{ rewriting ? '改写中...' : '开始改写' }}
          </button>
        </div>
        <div v-if="rewriteResult" class="results">
          <button type="button" class="result-item" @click="selectRewriteResult">
            <span class="result-text">{{ rewriteResult.slice(0, 100) }}{{ rewriteResult.length > 100 ? '...' : '' }}</span>
            <span class="result-action">应用</span>
          </button>
          <div v-if="rewriteResultMeta" style="font-size:11px;color:var(--muted);margin-top:4px;padding:0 4px">
            策略：{{ rewriteResultMeta.strategyName }} · AI味等级：{{ rewriteResultMeta.aiTasteLevel != null ? (rewriteResultMeta.aiTasteLevel * 100).toFixed(0) + '%' : 'N/A' }} · 原文 {{ rewriteResultMeta.originalLength }} 字 → 结果 {{ rewriteResultMeta.resultLength }} 字
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue"
import { Aim, Document, EditPen, MagicStick, Refresh, TrendCharts } from "@element-plus/icons-vue"
import { useRouter } from "vue-router"
import { useI18n } from "vue-i18n"
import {
  aiEnhanceContent,
  aiGenerateSummary,
  aiGenerateTitles,
  aiIsConfigured,
  aiRewrite,
  aiListRewriteStrategies,
  aiGetRecommendedStrategies,
  applyKnowledgeFeedback,
  modelProviderIsConfigured,
} from "@/api/publisher"
import { useLoginGate } from "@/composables/useLoginGate"
import { formatUserError } from '@/utils/user-facing-error'

const emit = defineEmits(["close", "apply-title", "apply-content", "apply-rewrite"])
const router = useRouter()
const { t } = useI18n()
const { ensureLogin } = useLoginGate()

const configured = ref(false)
const generating = ref(false)
const enhancing = ref(false)
const summarizing = ref(false)
const activeMode = ref("titles")
const topic = ref("")
const titles = ref([])
const selectedStyle = ref("polish")
const enhancedResult = ref("")
const summary = ref("")
const panelError = ref("")

const modes = [
  { key: "titles", label: "标题生成", icon: Aim },
  { key: "enhance", label: "内容润色", icon: MagicStick },
  { key: "summary", label: "生成摘要", icon: Document },
  { key: "rewrite", label: "AI 改写", icon: Refresh },
]

const styles = [
  { key: "polish", label: "优化表达" },
  { key: "concise", label: "精简内容" },
  { key: "engaging", label: "社交媒体风" },
]

// ─── 改写引擎状态 ─────────────────────
const rewriting = ref(false)
const rewriteMode = ref("imitate")
const useViralLibrary = ref(false)
const usePersonalExperience = ref(false)
const rewriteIndustry = ref("")
const rewritePurpose = ref("")
const rewriteTone = ref("")
const rewritePlatform = ref("")
const rewriteTargetLength = ref("medium")
const strategyMode = ref("auto")
const rewriteStrategyId = ref("")
const rewriteContent = ref("")
const rewriteStrategies = ref([])
const rewriteResult = ref("")
const rewriteResultMeta = ref(null)
// P2 隐式反馈：本次改写引用的知识条目（应用=采纳 / 再次改写=弃用）
const rewriteKnowledgeRefs = ref([])

const rewriteModes = [
  { key: "imitate", label: "智能仿写" },
  { key: "expand", label: "扩写爆款" },
  { key: "create", label: "选题创作" },
]

const industryOptions = [
  { value: "", label: "通用" },
  { value: "ecommerce", label: "电商" },
  { value: "education", label: "教育" },
  { value: "technology", label: "科技" },
  { value: "finance", label: "金融" },
  { value: "lifestyle", label: "生活方式" },
  { value: "beauty", label: "美妆" },
  { value: "entertainment", label: "娱乐" },
  { value: "ip-building", label: "IP 打造" },
]

const purposeOptions = [
  { value: "", label: "通用" },
  { value: "engagement", label: "提升互动" },
  { value: "conversion", label: "提升转化" },
  { value: "follower-growth", label: "涨粉" },
  { value: "authority-building", label: "建立权威" },
  { value: "sales", label: "带货销售" },
]

const toneOptions = [
  { value: "", label: "通用" },
  { value: "casual", label: "口语化" },
  { value: "storytelling", label: "故事化" },
  { value: "emotional", label: "情感化" },
  { value: "persuasive", label: "说服力" },
  { value: "humorous", label: "幽默" },
  { value: "formal", label: "正式严谨" },
]

const platformOptions = [
  { value: "", label: "通用" },
  { value: "douyin", label: "抖音" },
  { value: "xiaohongshu", label: "小红书" },
  { value: "wechat_mp", label: "公众号" },
  { value: "bilibili", label: "B站" },
  { value: "zhihu", label: "知乎" },
]

const targetLengthOptions = [
  { value: "short", label: "短（约 500 字）" },
  { value: "medium", label: "中（约 1000 字）" },
  { value: "long", label: "长（约 2000 字）" },
]

async function loadRewriteStrategies() {
  try {
    const res = await aiListRewriteStrategies()
    if (res && res.code === 0) rewriteStrategies.value = res.data || []
  } catch (e) {
    // 静默失败：策略列表为空时改写仍可用自动匹配
  }
}

async function doRewrite() {
  if (!rewriteContent.value.trim()) return
  if (!(await ensureLogin({ message: "AI 改写需要登录后使用，是否立即登录？" }))) return
  panelError.value = ""
  rewriting.value = true
  // P2 隐式反馈：上次改写结果未被应用就再次改写 → 弃用上次引用的知识条目
  if (rewriteResult.value && rewriteKnowledgeRefs.value.length > 0) {
    sendKnowledgeFeedback("rejected", rewriteKnowledgeRefs.value)
  }
  rewriteResult.value = ""
  rewriteResultMeta.value = null
  rewriteKnowledgeRefs.value = []
  try {
    const userSettings = {
      industry: rewriteIndustry.value || undefined,
      purpose: rewritePurpose.value || undefined,
      tone: rewriteTone.value || undefined,
      platform: rewritePlatform.value || undefined,
      targetLength: rewriteTargetLength.value,
      knowledgeOptions: {
        useViralLibrary: useViralLibrary.value,
        usePersonalKnowledge: usePersonalExperience.value,
      },
    }
    const params = {
      mode: rewriteMode.value,
      content: rewriteContent.value,
      userSettings,
      strategyId: strategyMode.value === "manual" ? (rewriteStrategyId.value || null) : null,
    }
    const res = await aiRewrite(params)
    if (res && res.code === 0 && res.data && res.data.success) {
      const data = res.data
      rewriteResult.value = data.result || ""
      // P2 隐式反馈：记录本次改写引用的知识条目
      rewriteKnowledgeRefs.value = data.knowledgeRefs || []
      rewriteResultMeta.value = {
        strategyName: data.strategy?.name || "",
        aiTasteLevel: data.metadata?.aiTasteLevel,
        originalLength: data.metadata?.originalLength,
        resultLength: data.metadata?.resultLength,
      }
      if (data.warnings && data.warnings.length > 0) {
        panelError.value = data.warnings.join("；")
      }
    } else if (res && res.code === 0 && res.data && res.data.error) {
      panelError.value = res.data.error
    } else {
      panelError.value = (res && res.message) || "改写失败"
    }
  } catch (e) {
    panelError.value = formatUserError(e, { fallback: "改写失败" }).message
  } finally {
    rewriting.value = false
  }
}

function selectRewriteResult() {
  emit("apply-content", rewriteResult.value)
  emit("apply-rewrite", rewriteResult.value)
  // P2 隐式反馈：用户应用改写结果 = 采纳被引用的知识条目
  sendKnowledgeFeedback("adopted", rewriteKnowledgeRefs.value)
}

/** P2 隐式反馈：把用户对改写结果的自然操作转换为知识反馈（静默失败不影响主流程） */
function sendKnowledgeFeedback(action, refs) {
  if (!refs || refs.length === 0) return
  try {
    applyKnowledgeFeedback(action, refs)
  } catch (e) {
    // 知识反馈失败不影响改写主流程
  }
}

function goToProviders() {
  router.push("/model-providers")
  emit("close")
}

async function checkConfig() {
  panelError.value = ""
  let providerError = null
  try {
    const providerResult = await modelProviderIsConfigured("llm")
    if (providerResult && providerResult.code === 0) {
      configured.value = Boolean(providerResult.data)
      return
    }
  } catch (error) {
    providerError = error
  }

  try {
    const legacyResult = await aiIsConfigured()
    if (legacyResult && legacyResult.code === 0) {
      configured.value = Boolean(legacyResult.data)
      return
    }
  } catch (error) {
    providerError = error
  }
  if (providerError) panelError.value = formatUserError(providerError, { fallback: "读取 AI 配置失败" }).message
}

async function generateTitles() {
  if (!topic.value.trim()) return
  // 主动操作登录门：未登录弹登录窗口，登录成功后继续生成标题
  if (!(await ensureLogin({ message: "AI 标题生成需要登录后使用，是否立即登录？" }))) return
  panelError.value = ""
  generating.value = true
  try {
    const res = await aiGenerateTitles(topic.value)
    if (res && res.code === 0) titles.value = res.data || []
  } catch (e) {
    panelError.value = formatUserError(e, { fallback: "生成标题失败" }).message
  } finally {
    generating.value = false
  }
}

function selectTitle(t) {
  emit("apply-title", t)
}

async function enhanceContent() {
  // 主动操作登录门：未登录弹登录窗口，登录成功后继续润色
  if (!(await ensureLogin({ message: "AI 内容润色需要登录后使用，是否立即登录？" }))) return
  enhancing.value = true
  panelError.value = ""
  try {
    // Read content from parent - passed via prop or get from editor
    const content = props.sourceContent || ""
    if (!content || content.length < 10) {
      enhancedResult.value = "请先在正文编辑器中输入内容"
      return
    }
    const res = await aiEnhanceContent(content, selectedStyle.value)
    if (res && res.code === 0) enhancedResult.value = res.data
  } catch (e) {
    panelError.value = formatUserError(e, { fallback: "润色正文失败" }).message
  } finally {
    enhancing.value = false
  }
}

function selectEnhanced() {
  emit("apply-content", enhancedResult.value)
}

async function generateSummary() {
  // 主动操作登录门：未登录弹登录窗口，登录成功后继续生成摘要
  if (!(await ensureLogin({ message: "AI 摘要生成需要登录后使用，是否立即登录？" }))) return
  summarizing.value = true
  panelError.value = ""
  try {
    const content = props.sourceContent || ""
    if (!content || content.length < 20) {
      summary.value = "内容太短，无法生成摘要"
      return
    }
    const res = await aiGenerateSummary(content)
    if (res && res.code === 0) summary.value = res.data || ""
  } catch (e) {
    panelError.value = formatUserError(e, { fallback: "生成摘要失败" }).message
  } finally {
    summarizing.value = false
  }
}

function selectSummary() {
  emit("apply-content", summary.value)
}

const props = defineProps({
  sourceContent: { type: String, default: "" },
})

onMounted(() => {
  void checkConfig()
  void loadRewriteStrategies()
  // 改写模式默认使用原文内容
  if (props.sourceContent) {
    rewriteContent.value = props.sourceContent
  }
})
</script>

<style scoped>
.ai-writer-panel {
  border: 1px solid var(--border);
  border-radius: 12px;
}
.no-config {
  text-align: center;
  padding: 20px;
  font-size: 13px;
  color: var(--muted);
}
.panel-error {
  margin: 0 0 var(--space-sm);
  color: var(--danger, #c53b3b);
  font-size: 12px;
}
.cohere-btn-primary {
  padding: 8px 16px;
  background: var(--coral, #f56c6c);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.cohere-btn-primary:disabled { opacity: 0.5; cursor: default; }
.mode-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: var(--space-md);
  background: var(--soft-stone, #f5f5f5);
  border-radius: 8px;
  padding: 3px;
}
.mode-tab {
  flex: 1;
  padding: 6px 10px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--muted);
  transition: all 0.15s;
}
.mode-tab.active {
  background: var(--surface, #fff);
  color: var(--text-primary);
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.mode-content {
  padding: 0;
}
.cohere-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}
.cohere-input:focus { border-color: var(--coral); }
.cohere-form-item { margin-bottom: var(--space-sm); }
.cohere-form-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  margin-bottom: 4px;
}
.style-chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface, #fff);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-primary);
}
.style-chip.active {
  border-color: var(--coral);
  background: var(--coral-bg, #fef2f2);
  color: var(--coral);
}
.results {
  margin-top: var(--space-sm);
}
.result-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: all 0.1s;
  background: var(--surface, #fff);
  color: var(--text-primary);
  text-align: left;
  font: inherit;
}
.result-item:hover {
  border-color: var(--coral);
  background: var(--soft-stone);
}
.result-item:focus-visible {
  outline: 2px solid var(--coral);
  outline-offset: 2px;
}
.result-num {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--coral-bg, #fef2f2);
  color: var(--coral);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.result-text {
  flex: 1;
  font-size: 13px;
  line-height: 1.4;
}
.result-action {
  font-size: 11px;
  color: var(--coral);
  flex-shrink: 0;
}
</style>
