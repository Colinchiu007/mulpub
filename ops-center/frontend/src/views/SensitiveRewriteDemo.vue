<template>
  <div class="page">
    <h1 style="margin-bottom: 4px">敏感改写策略 · 交互演示</h1>
    <p class="subtitle">Story2Video 图片内容安全改写 — 模板改写 → LLM 升级 → 自检</p>

    <el-row :gutter="16">
      <el-col :xs="24" :md="10">
        <el-card shadow="never">
          <template #header>① 输入</template>

          <el-form label-position="top">
            <el-form-item label="敏感类型">
              <el-select v-model="form.sensitiveType" style="width: 100%">
                <el-option v-for="t in SENSITIVE_TYPES" :key="t.value" :label="t.label" :value="t.value" />
              </el-select>
            </el-form-item>

            <el-form-item label="原始提示词">
              <el-input v-model="form.prompt" type="textarea" :rows="3" placeholder="输入图片提示词，例如：a child in a classroom" />
            </el-form-item>

            <el-form-item label="场景背景 contextBlock（可选，保留原文背景）">
              <el-input v-model="form.contextBlock" placeholder="例如：唐代，中国，老妇人，厨房，油灯" />
            </el-form-item>

            <el-form-item label="一致性锚点 anchors（可选，逗号分隔）">
              <el-input v-model="form.anchors" placeholder="例如：唐代, 油灯" />
            </el-form-item>

            <el-form-item>
              <el-button type="primary" @click="run">🔄 运行改写</el-button>
              <el-button @click="reset">清空</el-button>
            </el-form-item>
          </el-form>

          <el-divider content-position="left">预设场景</el-divider>
          <div class="presets">
            <el-tag v-for="(p, i) in PRESETS" :key="i" class="preset" @click="applyPreset(p)">{{ p.label }}</el-tag>
          </div>

          <el-alert type="info" :closable="false" style="margin-top: 12px">
            <template #title>提示</template>
            原文含 <b>child / minor / self-harm / suicide / gore / nude / porn / graphic violence / violent</b> 或中文 <b>儿童/孩子/自杀/自伤/血腥/裸露/色情/暴力</b> 等 → 升级 LLM 改写。
          </el-alert>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="14">
        <el-card shadow="never">
          <template #header>② 改写结果</template>

          <template v-if="result">
            <el-alert :type="result.decisionClass" :closable="false" style="margin-bottom: 12px">
              <template #title><b>改写决策：</b>{{ result.decision }}</template>
            </el-alert>

            <div class="result-block">
              <div class="result-title">① 原文自检
                <el-tag v-if="result.origSafe" type="success" size="small">安全</el-tag>
                <el-tag v-else type="danger" size="small">含高危词</el-tag>
              </div>
              <pre>{{ result.prompt }}</pre>
            </div>

            <div class="result-block">
              <div class="result-title">② 模板改写版
                <el-tag size="small" type="info">含否定句高危词（指令，非内容）</el-tag>
              </div>
              <pre>{{ result.template }}</pre>
            </div>

            <div v-if="result.llmResult" class="result-block">
              <div class="result-title">③ LLM 改写结果
                <el-tag v-if="result.llmSafe" type="success" size="small">安全 → 发送</el-tag>
                <el-tag v-else type="danger" size="small">仍含高危词 → 交用户</el-tag>
              </div>
              <pre>{{ result.llmResult }}</pre>
            </div>

            <el-divider content-position="left">改写流程</el-divider>
            <el-steps direction="vertical" :active="result.stepActive">
              <el-step title="图片模型拒绝 → 识别敏感类型" :description="'敏感类型：' + form.sensitiveType" />
              <el-step title="改写前自检原文" :description="result.origSafe ? '原文安全' : '原文含高危词'" />
              <el-step :title="result.llmResult ? '升级 LLM 改写' : '模板改写（保留背景/锚点）'" :description="result.llmResult || '改写指令 + 保留背景/锚点 + 拼入原文'" />
              <el-step title="发送给图片模型重试" />
            </el-steps>
          </template>
          <el-empty v-else description="点击「运行改写」查看结果" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'

// ===== 与生产代码一致的核心逻辑（story2video-image-retry.js）=====
const CONTENT_POLICY_REWRITE_STRATEGIES = {
  violence: 'Depict the scene as a tense conflict atmosphere with no blood, wounds, weapons, or graphic detail.',
  sexual: 'Depict the scene in a modest, non-explicit, age-appropriate way with no nudity or sexual content.',
  portrait: 'Depict only a fictional, non-identifying character; do not reproduce any real person likeness.',
  political: 'Depict the scene without any political figures, symbols, or references.',
  minor: 'Depict only adult characters; do not depict any minors or child-like figures.',
  selfharm: 'Depict a calm, hopeful scene with no self-harm, injury, or distress.',
  unknown: 'Replace sensitive people, actions, and details with symbolic, non-identifying alternatives.',
}

const SENSITIVE_TYPES = [
  { value: 'violence', label: 'violence 暴力' },
  { value: 'sexual', label: 'sexual 性' },
  { value: 'portrait', label: 'portrait 肖像' },
  { value: 'political', label: 'political 政治' },
  { value: 'minor', label: 'minor 未成年人' },
  { value: 'selfharm', label: 'selfharm 自伤' },
  { value: 'unknown', label: 'unknown 未知' },
]

function buildContentPolicySafePrompt (prompt, options = {}) {
  const sceneNumber = (options.sceneIndex || 0) + 1
  const source = String(prompt || '').trim().slice(0, 4000)
  const sensitiveType = options.sensitiveType || 'unknown'
  const strategy = CONTENT_POLICY_REWRITE_STRATEGIES[sensitiveType] || CONTENT_POLICY_REWRITE_STRATEGIES.unknown
  const contextBlock = String(options.contextBlock || '').trim()
  const anchors = Array.isArray(options.anchors) ? options.anchors.filter(Boolean) : []
  const lines = [
    'Generate a policy-compliant, age-appropriate visual interpretation for scene ' + sceneNumber + '.',
    strategy,
    'Do not depict graphic violence, nudity, sexual content, minors, self-harm, illegal activity, hate symbols, real-person likenesses, or readable text.',
  ]
  if (contextBlock) lines.push('Preserve this scene background: ' + contextBlock + '.')
  if (anchors.length > 0) lines.push('Keep these visual anchors: ' + anchors.join(', ') + '.')
  lines.push('Scene source to adapt:', source)
  return lines.join('\n')
}

function validateRewriteSafety (prompt) {
  const text = String(prompt || '').toLowerCase()
  const HIGH_RISK_PATTERN = /\b(?:child|minor|underage|self[_\s-]?harm|suicide|gore|nudit|nude|porn|explicit\s+sexual|graphic\s+violence|violent)\b/
  const HIGH_RISK_CN_PATTERN = /(?:儿童|孩子|未成年人|未成年|自杀|自伤|血腥|裸露|色情|淫秽|性爱|暴力)/
  const flagged = []
  if (HIGH_RISK_PATTERN.test(text)) flagged.push('high_risk_sensitive_term')
  if (HIGH_RISK_CN_PATTERN.test(text)) flagged.push('high_risk_sensitive_cn_term')
  return { safe: flagged.length === 0, flagged }
}

// ===== 模拟 LLM 改写（演示用；生产用 aiGenerator.generateWithDefault('llm')）=====
const LLM_EXAMPLES = [
  { from: 'a child in a classroom', to: 'a young student in a classroom' },
  { from: 'a child playing', to: 'a young student playing' },
  { from: '两人激烈搏斗，血流满地', to: '两人紧张对峙，气氛凝重' },
  { from: '手臂上有伤痕，神情绝望', to: '安静地坐在窗边，神情平静' },
  { from: '穿着暴露，姿态挑逗', to: '穿着得体，姿态端庄' },
  { from: 'self-harm scene', to: 'a calm, hopeful scene' },
  { from: '酷似某知名明星的年轻男子', to: '一位虚构的年轻男子' },
  { from: '挥舞旗帜，背景是政府大楼', to: '广场上人群聚集，背景是普通建筑' },
]
function simulateLLMRewrite (prompt) {
  const hit = LLM_EXAMPLES.find(e => prompt.includes(e.from))
  if (hit) return hit.to
  return String(prompt)
    .replace(/child/gi, 'young student')
    .replace(/self[_\s-]?harm/gi, 'a calm, hopeful moment')
    .replace(/血流满地/gi, '气氛凝重')
    .replace(/伤痕/gi, '平静的神情')
    .replace(/暴露/gi, '得体')
    .replace(/挑逗/gi, '端庄')
}

const PRESETS = [
  { label: '儿童教室', type: 'minor', prompt: 'a child in a classroom', ctx: '现代教室', anchors: '课桌' },
  { label: '暴力搏斗', type: 'violence', prompt: '两人激烈搏斗，血流满地，手持利刃', ctx: '唐代，中国，老妇人，厨房，油灯', anchors: '唐代, 油灯' },
  { label: '自伤', type: 'selfharm', prompt: '一个人独自在房间，手臂上有伤痕，神情绝望', ctx: '昏暗的房间', anchors: '窗边' },
  { label: '性暗示', type: 'sexual', prompt: '一名女子穿着暴露，姿态挑逗', ctx: '宴会厅', anchors: '烛光' },
  { label: '政治', type: 'political', prompt: '广场上聚集人群，挥舞旗帜，背景是政府大楼', ctx: '城市广场', anchors: '广场' },
  { label: '肖像', type: 'portrait', prompt: '酷似某知名明星的年轻男子', ctx: '红毯', anchors: '闪光灯' },
  { label: '干净中文', type: 'violence', prompt: '一位老妇人在厨房里点油灯', ctx: '唐代，中国，老妇人，厨房，油灯', anchors: '唐代, 油灯' },
]

const form = reactive({ sensitiveType: 'minor', prompt: 'a child in a classroom', contextBlock: '唐代，中国，老妇人，厨房，油灯', anchors: '唐代, 油灯' })
const result = ref(null)

function applyPreset (p) {
  form.sensitiveType = p.type
  form.prompt = p.prompt
  form.contextBlock = p.ctx
  form.anchors = p.anchors
  run()
}

function run () {
  const prompt = form.prompt.trim()
  if (!prompt) { result.value = null; return }
  const contextBlock = form.contextBlock.trim()
  const anchors = form.anchors.split(/[,，]/).map(s => s.trim()).filter(Boolean)

  const origCheck = validateRewriteSafety(prompt)
  const template = buildContentPolicySafePrompt(prompt, { sceneIndex: 2, sensitiveType: form.sensitiveType, contextBlock, anchors })

  let decision, decisionClass, llmResult = null, llmSafe = false, stepActive = 1
  if (!origCheck.safe) {
    llmResult = simulateLLMRewrite(prompt)
    llmSafe = validateRewriteSafety(llmResult).safe
    if (llmSafe) {
      decision = '原文含高危词 → 模板改写版拼入原文必然仍含 → 升级 LLM 改写（成功）'
      decisionClass = 'warning'
      stepActive = 2
    } else {
      decision = '原文含高危词 → LLM 改写结果仍含高危词 → 不发送，交用户'
      decisionClass = 'error'
      stepActive = 3
    }
  } else {
    decision = '原文安全 → 走模板改写'
    decisionClass = 'success'
    stepActive = 1
  }

  result.value = {
    decision,
    decisionClass,
    origSafe: origCheck.safe,
    prompt,
    template,
    llmResult,
    llmSafe,
    stepActive,
  }
}

function reset () {
  form.prompt = ''
  result.value = null
}

run()
</script>

<style scoped>
.subtitle { color: #6b7280; font-size: 13px; margin-bottom: 16px; }
.presets { display: flex; flex-wrap: wrap; gap: 8px; }
.preset { cursor: pointer; }
.result-block { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.result-title { font-weight: 600; font-size: 13px; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 12.5px; color: #374151; }
</style>