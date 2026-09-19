<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div>
        <h1 style="margin:0 0 4px">场景上下文规则</h1>
        <div style="color:#909399;font-size:13px">
          Story2Video 场景上下文增强中间层（scene_context）的规则配置：朝代/文化/题材/设定/道具/负面锚点。
          保存后为运营配置，导出 JSON 合入桌面仓库随包发布，或放置 <code>&lt;userData&gt;/config/story-context-rules.json</code> 覆盖加载（桌面端校验失败自动回退内置）。
        </div>
      </div>
      <div style="display:flex;gap:12px">
        <el-button @click="loadRules">重新加载</el-button>
        <el-button @click="handleValidate" :loading="validating">校验</el-button>
        <el-button @click="handleSave" type="primary" :loading="saving">保存</el-button>
        <el-button @click="handleExport" :loading="exporting">导出</el-button>
      </div>
    </div>

    <el-alert v-if="info.version === 0" type="info" :closable="false" show-icon style="margin-bottom:12px"
      title="尚未保存运营配置：当前使用随包内置规则（source=template），可编辑下方 JSON 后保存为运营配置。" />

    <el-card shadow="never">
      <div style="display:flex;gap:24px;margin-bottom:12px;flex-wrap:wrap">
        <span>来源：<el-tag size="small" :type="info.source === 'db' ? 'success' : 'info'">{{ info.source }}</el-tag></span>
        <span>版本：<el-tag size="small">{{ info.version }}</el-tag></span>
        <span>最后更新：{{ info.updated_at || '—' }}</span>
        <span>操作人：{{ info.updated_by || '—' }}</span>
      </div>
      <el-input
        v-model="jsonText"
        type="textarea"
        :rows="22"
        spellcheck="false"
        style="font-family: 'JetBrains Mono', Consolas, monospace; font-size: 12px"
        placeholder="规则 JSON（与桌面端 story-context-rules.json 结构一致）"
      />
      <div v-if="validation" style="margin-top:12px">
        <el-alert v-if="validation.ok" type="success" :closable="false" show-icon title="规则结构校验通过" />
        <el-alert v-else type="error" :closable="false" show-icon title="规则校验失败">
          <ul style="margin:4px 0 0 16px">
            <li v-for="(e, i) in validation.errors" :key="i">{{ e.path || '规则' }}：{{ e.message }}</li>
          </ul>
        </el-alert>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getSceneContextRules, validateSceneContextRules, saveSceneContextRules, exportSceneContextRules } from '../api/sceneContext'

const jsonText = ref('')
const info = ref({ source: 'template', version: 0, updated_at: null, updated_by: '' })
const validation = ref(null)
const loading = ref(false)
const validating = ref(false)
const saving = ref(false)
const exporting = ref(false)

function parseJson() {
  try {
    return JSON.parse(jsonText.value)
  } catch (e) {
    ElMessage.error('JSON 解析失败：' + e.message)
    return null
  }
}

async function loadRules() {
  loading.value = true
  try {
    const data = await getSceneContextRules()
    info.value = data
    jsonText.value = JSON.stringify(data.rules, null, 2)
    validation.value = null
  } catch (e) {
    ElMessage.error('加载规则失败：' + (e.response?.data?.detail || e.message))
  } finally {
    loading.value = false
  }
}

async function handleValidate() {
  const rules = parseJson()
  if (!rules) return
  validating.value = true
  try {
    validation.value = await validateSceneContextRules(rules)
    if (validation.value.ok) ElMessage.success('校验通过')
  } catch (e) {
    ElMessage.error('校验请求失败：' + (e.response?.data?.detail || e.message))
  } finally {
    validating.value = false
  }
}

async function handleSave() {
  const rules = parseJson()
  if (!rules) return
  saving.value = true
  try {
    const saved = await saveSceneContextRules(rules)
    info.value = saved
    jsonText.value = JSON.stringify(saved.rules, null, 2)
    validation.value = { ok: true, errors: [] }
    ElMessage.success('已保存（版本 v' + saved.version + '）')
  } catch (e) {
    ElMessage.error('保存失败：' + (e.response?.data?.detail || e.message))
  } finally {
    saving.value = false
  }
}

async function handleExport() {
  exporting.value = true
  try {
    const data = await exportSceneContextRules()
    const blob = new Blob([JSON.stringify(data.rules, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'story-context-rules.json'
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('已导出 story-context-rules.json（版本 v' + data.version + '）')
  } catch (e) {
    ElMessage.error('导出失败：' + (e.response?.data?.detail || e.message))
  } finally {
    exporting.value = false
  }
}

onMounted(loadRules)
</script>
