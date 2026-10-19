<template>
  <div>
    <h1 style="margin-bottom:16px">预设模型设置</h1>
    <p style="color:var(--color-text-placeholder);margin-bottom:16px;font-size: var(--font-size-sm)">
      运营人员维护前端【模型设置】的预设服务商目录：控制是否在前端显示、维护技术文档链接（每个模型最多 10 条）；
      多模态模型可配置支持能力、每能力默认模型与分能力技术文档 URL；
      限流字段（每分钟连接次数 / 5小时限额次数）用于指导前端调度并发与排队，允许留空（留空表示使用默认限流）。
      模型 ID 列表可通过「获取模型ID URL」自动拉取：服务启动时对尚无模型列表的预设自动尝试，也可点击
      「批量获取模型ID」为所有已配置 URL 的预设一次性拉取官方模型列表（失败项会汇总提示）。
      可通过操作列的排序按钮调整桌面端【全部】列表的展示次序：⤒ 移到首位、↑ 上移、↓ 下移、⤓ 移到末位，点击即时保存；
      未设置排序的模型由桌面端按名称拼音/字母序排在已排序模型之后。排序随目录同步下发，桌面端需同步（或重启）后生效。
      排序所见即所得：按钮只在当前列表（含分类筛选、是否含隐藏项）范围内调整次序，序列外的预设不受影响。
    </p>

    <!-- 能力默认模型总览（voice-model-program-resolved，2026-10-18）：
         桌面应用使用某种能力时，具体模型由程序按此处配置的默许模型解析，不再要求用户选择。
         这张表让运营一眼看出「某能力下哪些提供方缺默许模型」。 -->
    <el-card shadow="never" style="margin-bottom:16px">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">能力默认模型总览</span>
          <el-button link size="small" :loading="overviewLoading" @click="loadOverview">刷新</el-button>
        </div>
      </template>
      <p style="color:var(--color-text-placeholder);font-size: var(--font-size-sm);margin-bottom:12px">
        按能力类别维护每个模型提供方的默许模型（Model ID）。桌面应用在使用某种能力时，会按此处配置自动确定具体模型，
        不再要求用户选择。<b>未配置</b>的提供方在该能力下不可用，桌面端会跳过它；隐藏的预设不计入缺口。
      </p>
      <el-alert
        v-if="overview && overview.missing_count > 0"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom:12px"
        :title="`当前有 ${overview.missing_count} 个「能力 × 提供方」组合尚未配置默许模型，桌面端在这些能力下会跳过对应提供方。`"
      />
      <el-table v-loading="overviewLoading" :data="overview ? overview.capabilities : []" stripe style="width:100%">
        <el-table-column label="能力" width="150">
          <template #default="{ row }">
            <el-tag size="small">{{ CAP_OVERVIEW_LABELS[row.capability] || row.capability }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提供方 / 默许模型">
          <template #default="{ row }">
            <div v-if="row.providers.length === 0" style="color:var(--color-text-placeholder)">（无可见预设）</div>
            <div v-else style="display:flex;flex-wrap:wrap;gap:6px">
              <el-tag
                v-for="p in row.providers"
                :key="p.id"
                :type="p.is_configured ? 'success' : 'warning'"
                size="small"
                :title="p.is_configured ? `${p.name} → ${p.model}` : `${p.name}：未配置默许模型`"
              >
                {{ p.name }}<span v-if="p.is_configured"> · {{ p.model }}</span><span v-else> · 未配置</span>
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="缺口" width="90" align="center">
          <template #default="{ row }">
            <span :style="{ color: row.providers.some(p => !p.is_configured) ? 'var(--el-color-warning)' : 'inherit' }">
              {{ row.providers.filter(p => !p.is_configured).length }} / {{ row.providers.length }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <el-radio-group v-model="filterCategory" @change="load">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button v-for="c in CATEGORY_OPTIONS" :key="c.value" :value="c.value">{{ c.label }}</el-radio-button>
        </el-radio-group>
        <div>
          <el-switch v-model="includeHidden" active-text="含已隐藏" @change="load" style="margin-right:16px" />
          <el-button :loading="batchFetching" @click="batchFetchModels">批量获取模型ID</el-button>
          <el-button type="primary" @click="openCreate">新增预设</el-button>
        </div>
      </div>

      <el-table :data="presets" stripe v-loading="loading" style="width:100%">
        <el-table-column prop="id" label="ID" min-width="170" />
        <el-table-column prop="name" label="名称" min-width="120" />
        <el-table-column label="类别" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ CATEGORY_LABELS[row.category] || row.category }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="多模态" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.is_multimodal" type="warning" size="small">多模态</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="默认模型" min-width="140">
          <template #default="{ row }">
            <span>{{ row.default_model || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="限流（每分钟/5小时）" width="150" align="center">
          <template #default="{ row }">
            <span>{{ row.rate_per_minute != null ? row.rate_per_minute : '-' }} / {{ row.limit_per_5h != null ? row.limit_per_5h : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="文档链接" width="100" align="center">
          <template #default="{ row }">
            <span>{{ (row.doc_links || []).length }}/10</span>
          </template>
        </el-table-column>
        <el-table-column label="排序" width="70" align="center">
          <template #default="{ row }">
            <span>{{ row.sort_order != null ? row.sort_order : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="前端显示" width="90" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.is_visible" @change="(v) => toggleVisible(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="270" align="center">
          <template #default="{ row, $index }">
            <el-button link size="small" title="移到首位" :disabled="$index === 0 || reorderBusy" @click="reorder(row, 'top')">⤒</el-button>
            <el-button link size="small" title="上移" :disabled="$index === 0 || reorderBusy" @click="reorder(row, 'up')">↑</el-button>
            <el-button link size="small" title="下移" :disabled="$index === presets.length - 1 || reorderBusy" @click="reorder(row, 'down')">↓</el-button>
            <el-button link size="small" title="移到末位" :disabled="$index === presets.length - 1 || reorderBusy" @click="reorder(row, 'bottom')">⤓</el-button>
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showDialog" :title="editing ? `编辑预设：${form.id}` : '新增预设'" width="760px">
      <el-form label-width="150px" label-position="left">
        <el-form-item label="预设 ID" required>
          <el-input v-model="form.id" :disabled="editing" placeholder="如 minimax-multimodal" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="如 MiniMax" />
        </el-form-item>
        <el-form-item label="类别" required>
          <el-select v-model="form.category" style="width:100%">
            <el-option v-for="c in CATEGORY_OPTIONS" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="接口 Base URL（端口URL）">
          <el-input v-model="form.base_url" placeholder="https://api.example.com/v1（允许为空）" />
        </el-form-item>
        <el-form-item label="获取模型ID URL">
          <el-input v-model="form.models_url" placeholder="https://api.example.com/v1/models（允许为空，用于「获取模型」按钮）" />
        </el-form-item>
        <el-form-item label="模型列表">
          <el-input v-model="modelsText" placeholder="model-1, model-2（逗号分隔；点击「获取模型」可从上方 URL 自动填充）" />
        </el-form-item>
        <el-form-item label="默认模型 ID">
          <div style="display:flex;gap:8px;width:100%">
            <el-select v-model="form.default_model" filterable allow-clear style="flex:1" placeholder="从模型列表中选择（允许为空）">
              <el-option v-for="m in parsedModels" :key="m" :label="m" :value="m" />
            </el-select>
            <el-button :loading="fetchingModels" @click="fetchModels">获取模型</el-button>
          </div>
        </el-form-item>
        <el-form-item label="每分钟连接次数">
          <el-input-number v-model="form.rate_per_minute" :min="1" :max="100000" :controls="false" style="width:100%" placeholder="允许为空" />
          <span style="margin-left:8px;color:var(--color-text-placeholder);font-size: var(--font-size-xs)">留空表示未配置，前端使用默认限流；正整数</span>
        </el-form-item>
        <el-form-item label="5小时限额次数">
          <el-input-number v-model="form.limit_per_5h" :min="1" :max="10000000" :controls="false" style="width:100%" placeholder="允许为空" />
          <span style="margin-left:8px;color:var(--color-text-placeholder);font-size: var(--font-size-xs)">留空表示未配置；5 小时内请求次数上限（正整数）</span>
        </el-form-item>
        <el-form-item label="多模态模型">
          <el-switch v-model="form.is_multimodal" />
        </el-form-item>
        <el-form-item label="前端显示">
          <el-switch v-model="form.is_visible" />
          <span style="margin-left:8px;color:var(--color-text-placeholder);font-size: var(--font-size-xs)">关闭后不在前端【模型设置】中显示该预设</span>
        </el-form-item>

        <template v-if="form.is_multimodal">
          <el-divider content-position="left">多模态能力配置</el-divider>
          <el-form-item label="支持能力">
            <el-select v-model="form.capabilities" multiple style="width:100%" placeholder="选择该模型支持的能力">
              <el-option v-for="c in CAP_OPTIONS" :key="c.value" :label="c.label" :value="c.value" />
            </el-select>
          </el-form-item>
          <el-divider content-position="left">分能力技术文档 URL（多模态）</el-divider>
          <el-form-item v-for="doc in DOC_CAP_OPTIONS" :key="doc.value" :label="`${doc.label}技术文档URL`">
            <el-input v-model="capDocModel[doc.value]" :placeholder="`${doc.value} 对应的接口技术文档网页链接（允许为空）`" />
          </el-form-item>
        </template>

        <!-- 能力默认模型（voice-model-program-resolved，2026-10-18）：
             从「仅多模态」扩到全类别——单能力服务商按自身类别渲染一项，多模态按支持能力逐项渲染。
             桌面端使用该能力时按这里配置的默许模型自动确定具体模型，不再要求用户选择。 -->
        <el-divider content-position="left">能力默认模型（桌面端按此自动确定，用户无需选择）</el-divider>
        <el-form-item
          v-for="cap in capabilityDefaultKeys"
          :key="cap"
          :label="`${CAP_LABELS[cap] || cap} 默认模型`"
        >
          <el-select
            v-model="form.capability_models[cap]"
            filterable
            allow-create
            allow-clear
            clearable
            style="width:100%"
            :placeholder="`选择或输入 ${cap} 对应的默认模型 ID（留空表示未配置）`"
          >
            <el-option v-for="m in parsedModels" :key="m" :label="m" :value="m" />
          </el-select>
          <div style="color:var(--color-text-placeholder);font-size: var(--font-size-xs);margin-top:4px">
            必须出现在上方「模型 ID 列表」中；留空表示该能力下不可用（桌面端会跳过该提供方）。
          </div>
        </el-form-item>
        <el-form-item v-if="capabilityDefaultKeys.length === 0" label="能力默认模型">
          <span style="color:var(--color-text-placeholder)">
            先在「支持能力」中选择能力，再为每项配置默认模型。
          </span>
        </el-form-item>

        <el-divider content-position="left">模型技术文档链接（最多 10 条）</el-divider>
        <el-form-item label="文档链接">
          <div style="width:100%">
            <div v-for="(link, idx) in form.doc_links" :key="idx" style="display:flex;gap:8px;margin-bottom:6px">
              <el-input v-model="form.doc_links[idx]" placeholder="https://..." />
              <el-button @click="form.doc_links.splice(idx, 1)">移除</el-button>
            </div>
            <el-button size="small" :disabled="form.doc_links.length >= 10" @click="form.doc_links.push('')">
              + 添加文档链接
            </el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listModelPresets, createModelPreset, updateModelPreset, deleteModelPreset,
  fetchModelIds, reorderModelPreset, fetchCapabilityOverview,
} from '../api/modelPresets'

const CATEGORY_OPTIONS = [
  { value: 'llm', label: '推理模型' },
  { value: 'tts', label: 'TTS语音' },
  { value: 'speech_recognition', label: '语音识别' },
  { value: 'image', label: '图片生成' },
  { value: 'video', label: '视频模型' },
  { value: 'audio', label: '音频生成' },
  { value: 'multimodal', label: '多模态模型' },
]
const CATEGORY_LABELS = Object.fromEntries(CATEGORY_OPTIONS.map(c => [c.value, c.label]))
const CAP_OPTIONS = [
  { value: 'llm', label: '文字推理' },
  { value: 'tts', label: 'TTS语音' },
  { value: 'speech_recognition', label: '语音识别' },
  { value: 'image', label: '生图' },
  { value: 'video', label: '生成视频' },
  { value: 'audio', label: '音频生成' },
]
const CAP_LABELS = Object.fromEntries(CAP_OPTIONS.map(c => [c.value, c.label]))
// 能力默认模型总览的分组标签（与后端 capability_overview 的分组顺序一致）
const CAP_OVERVIEW_LABELS = { ...CAP_LABELS, speech_recognition: '语音识别', audio: '音频生成' }
// 多模态模型按能力展示的技术文档 URL 输入框（7 类固定能力）
const DOC_CAP_OPTIONS = [
  { value: 'llm', label: '文字推理接口' },
  { value: 'image', label: '图片生成' },
  { value: 'video', label: '视频生成' },
  { value: 'tts', label: 'TTS语音生成' },
  { value: 'voice_clone', label: 'TTS语音克隆' },
  { value: 'speech_recognition', label: '语音识别' },
  { value: 'vision', label: '视觉识别' },
]

const presets = ref([])
const loading = ref(false)
const saving = ref(false)
const fetchingModels = ref(false)
const overview = ref(null)
const overviewLoading = ref(false)
const filterCategory = ref('')
const includeHidden = ref(false)
const showDialog = ref(false)
const editing = ref(false)
const modelsText = ref('')
const capDocModel = reactive({ llm: '', image: '', video: '', tts: '', voice_clone: '', speech_recognition: '', vision: '' })

const form = reactive({
  id: '', name: '', category: 'llm', base_url: '', models_url: '', models: [], default_model: '',
  rate_per_minute: null, limit_per_5h: null, is_multimodal: false,
  capabilities: [], capability_models: {}, doc_links: [], capability_doc_links: {}, is_visible: true,
})

const parsedModels = computed(() => modelsText.value.split(',').map(s => s.trim()).filter(Boolean))

// 能力默认模型输入项的键集合（voice-model-program-resolved，2026-10-18）：
// - 多模态：按「支持能力」逐项
// - 单能力：按自身类别单项（该类别即其唯一的默许模型维度）
const capabilityDefaultKeys = computed(() => {
  if (form.is_multimodal) return Array.isArray(form.capabilities) ? form.capabilities : []
  return form.category ? [form.category] : []
})

// 切换类别/支持能力时清理不再适用的能力默认模型键，避免提交脏键被后端 400 拦截。
// 判据：键不在 allowed 集合内即删（空值也删，保持 payload 干净）。
watch(capabilityDefaultKeys, (keys) => {
  if (!form.capability_models || typeof form.capability_models !== 'object') {
    form.capability_models = {}
    return
  }
  const allowed = new Set(keys)
  Object.keys(form.capability_models).forEach((key) => {
    if (!allowed.has(key) || !String(form.capability_models[key] || '').trim()) {
      delete form.capability_models[key]
    }
  })
}, { deep: true })

onMounted(() => {
  load()
  loadOverview()
})

async function load() {
  loading.value = true
  try {
    const params = { include_hidden: includeHidden.value }
    if (filterCategory.value) params.category = filterCategory.value
    const data = await listModelPresets(params)
    presets.value = data.presets || []
  } catch (e) {
    if (e.response?.status === 403) {
      ElMessage.warning('需要管理员权限才能查看隐藏项')
      includeHidden.value = false
      await load()
      return
    } else {
      ElMessage.error('加载预设列表失败')
    }
  } finally {
    loading.value = false
  }
}

function resetCapDocModel() {
  Object.keys(capDocModel).forEach(k => { capDocModel[k] = '' })
}

/**
 * 加载「能力默认模型总览」（voice-model-program-resolved，2026-10-18）。
 * 失败不阻断主列表：仅提示，总览区保持上一次读数（null 则显示空表）。
 */
async function loadOverview() {
  overviewLoading.value = true
  try {
    overview.value = await fetchCapabilityOverview()
  } catch (e) {
    if (e.response?.status === 403) {
      // 非管理员：总览为 admin-only，静默隐藏（主列表仍可用）
      overview.value = null
    } else {
      ElMessage.error('加载能力默认模型总览失败')
    }
  } finally {
    overviewLoading.value = false
  }
}

function resetForm() {
  Object.assign(form, {
    id: '', name: '', category: 'llm', base_url: '', models_url: '', models: [], default_model: '',
    rate_per_minute: null, limit_per_5h: null, is_multimodal: false,
    capabilities: [], capability_models: {}, doc_links: [], capability_doc_links: {}, is_visible: true,
  })
  modelsText.value = ''
  resetCapDocModel()
}

function openCreate() {
  resetForm()
  editing.value = false
  showDialog.value = true
}

function openEdit(row) {
  editing.value = true
  Object.assign(form, JSON.parse(JSON.stringify(row)))
  if (form.rate_per_minute == null || form.rate_per_minute === '') form.rate_per_minute = null
  if (form.limit_per_5h == null || form.limit_per_5h === '') form.limit_per_5h = null
  if (!Array.isArray(form.capabilities)) form.capabilities = []
  if (!form.capability_models || typeof form.capability_models !== 'object') form.capability_models = {}
  if (!Array.isArray(form.doc_links)) form.doc_links = []
  if (!form.capability_doc_links || typeof form.capability_doc_links !== 'object') form.capability_doc_links = {}
  for (const cap of form.capabilities) {
    if (!Array.isArray(form.capability_doc_links[cap])) form.capability_doc_links[cap] = []
  }
  // 7 类固定能力文档 URL 回填（数组取首条）
  resetCapDocModel()
  for (const doc of DOC_CAP_OPTIONS) {
    const links = form.capability_doc_links[doc.value]
    if (Array.isArray(links) && links.length && links[0]) capDocModel[doc.value] = links[0]
    if (!form.capability_doc_links[doc.value]) form.capability_doc_links[doc.value] = []
  }
  modelsText.value = (form.models || []).join(', ')
  showDialog.value = true
}

function addCapDoc(cap) {
  if (!Array.isArray(form.capability_doc_links[cap])) form.capability_doc_links[cap] = []
  if (form.capability_doc_links[cap].length < 10) form.capability_doc_links[cap].push('')
}

function removeCapDoc(cap, idx) {
  form.capability_doc_links[cap].splice(idx, 1)
}

const batchFetching = ref(false)

async function batchFetchModels() {
  const candidates = presets.value.filter(p => p.models_url && p.models_url.trim() && (!p.models || !p.models.length))
  if (!candidates.length) {
    ElMessage.info('没有需要获取的预设：所有已配置「获取模型ID URL」的预设均已有模型列表（或全部未配置 URL）')
    return
  }
  batchFetching.value = true
  const failed = []
  let okCount = 0
  try {
    // 串行逐条调用，避免瞬时并发打爆供应商端点；失败仅汇总提示
    for (const p of candidates) {
      try {
        const data = await fetchModelIds(p.id, { models_url: p.models_url.trim() })
        const models = data.models || []
        if (!models.length) throw new Error('未获取到模型ID')
        await updateModelPreset(p.id, { models, default_model: data.default_model || p.default_model || '' })
        okCount++
      } catch (e) {
        failed.push(p.id + '：' + (e.response?.data?.detail || e.message || '获取失败'))
      }
    }
    if (failed.length) {
      ElMessage.warning('批量获取完成：' + okCount + ' 个成功，' + failed.length + ' 个失败：' + failed.join('；'))
    } else {
      ElMessage.success('批量获取成功，共更新 ' + okCount + ' 个预设的模型列表')
    }
    await load()
  } finally {
    batchFetching.value = false
  }
}

async function fetchModels() {
  if (!form.models_url || !form.models_url.trim()) {
    ElMessage.warning('请先填写「获取模型ID URL」')
    return
  }
  if (!form.id.trim()) {
    ElMessage.warning('请先填写预设 ID（获取结果会保存到该预设）')
    return
  }
  fetchingModels.value = true
  try {
    const data = await fetchModelIds(form.id, { models_url: form.models_url.trim() })
    const models = data.models || []
    modelsText.value = models.join(', ')
    form.default_model = data.default_model || ''
    ElMessage.success(`获取成功，共 ${data.count || models.length} 个模型 ID`)
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '获取模型失败，请检查 URL 与网络')
  } finally {
    fetchingModels.value = false
  }
}

async function save() {
  if (!form.id.trim() || !form.name.trim()) {
    ElMessage.warning('请填写预设 ID 与名称')
    return
  }
  if (form.rate_per_minute != null && (!Number.isInteger(form.rate_per_minute) || form.rate_per_minute < 1)) {
    ElMessage.warning('每分钟连接次数必须是大于等于 0 的整数（可留空）')
    return
  }
  if (form.limit_per_5h != null && (!Number.isInteger(form.limit_per_5h) || form.limit_per_5h < 1)) {
    ElMessage.warning('5小时限额次数必须是大于等于 0 的整数（可留空）')
    return
  }
  const payload = JSON.parse(JSON.stringify(form))
  payload.models = modelsText.value.split(',').map(s => s.trim()).filter(Boolean)
  if (payload.models.length && payload.default_model && !payload.models.includes(payload.default_model)) {
    ElMessage.warning('默认模型 ID 必须在模型列表中')
    return
  }
  // 能力默认模型前端预校验（voice-model-program-resolved）：与后端自洽校验同口径，
  // 让运营在提交前就看到具体哪一项越界，而不是等 400 回来再猜。
  const capDefaultModels = payload.capability_models && typeof payload.capability_models === 'object'
    ? payload.capability_models
    : {}
  for (const [cap, model] of Object.entries(capDefaultModels)) {
    const text = String(model || '').trim()
    if (text && payload.models.length && !payload.models.includes(text)) {
      ElMessage.warning(`「${CAP_LABELS[cap] || cap} 默认模型」${text} 不在模型列表中`)
      return
    }
  }
  if (payload.rate_per_minute == null || payload.rate_per_minute === '') payload.rate_per_minute = null
  if (payload.limit_per_5h == null || payload.limit_per_5h === '') payload.limit_per_5h = null
  // 多模态：7 类固定能力文档 URL 写入 capability_doc_links（保留存量其他键）
  if (payload.is_multimodal) {
    for (const doc of DOC_CAP_OPTIONS) {
      const url = (capDocModel[doc.value] || '').trim()
      if (url) payload.capability_doc_links[doc.value] = [url]
      else if (payload.capability_doc_links[doc.value] && payload.capability_doc_links[doc.value].length) {
        // 保留旧多条链接首条，避免数据丢失
        payload.capability_doc_links[doc.value] = [payload.capability_doc_links[doc.value][0]]
      }
    }
  }
  saving.value = true
  try {
    if (editing.value) {
      await updateModelPreset(payload.id, payload)
      ElMessage.success('已保存')
    } else {
      await createModelPreset(payload)
      ElMessage.success('已创建')
    }
    showDialog.value = false
    await load()
    // 能力默认模型可能变了：刷新总览，让运营立刻看到缺口闭合
    await loadOverview()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleVisible(row, value) {
  try {
    await updateModelPreset(row.id, { ...JSON.parse(JSON.stringify(row)), is_visible: value })
    row.is_visible = value
    ElMessage.success(value ? '已显示' : '已隐藏')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '操作失败')
    await load()
  }
}

const reorderBusy = ref(false)

// reorder 采用「所见即所得」语义：把当前可见序列（presets）的 id 顺序一并提交，
// 服务端只在这些行原本占据的顺序槽内重排，序列外（隐藏/其它类别）预设绝对位置不变。
async function reorder(row, action) {
  reorderBusy.value = true
  try {
    await reorderModelPreset(row.id, action, presets.value.map(p => p.id))
    ElMessage.success('排序已更新')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '排序更新失败')
    await load()
  } finally {
    reorderBusy.value = false
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除预设 ${row.name}（${row.id}）吗？`, '确认删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteModelPreset(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '删除失败')
  }
}
</script>