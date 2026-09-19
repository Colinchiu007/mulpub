<template>
  <div>
    <h1 style="margin-bottom:16px">选项控制</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      控制桌面端「视频创作-故事讲述」流水线中各选项组的显示/隐藏与初始默认值。
      选项随运行时 bootstrap 在桌面端同步时生效；未配置的选项使用桌面端本地默认值。
      「发布」组只支持整组显示/隐藏控制（不细到具体选项）。
    </p>

    <el-card shadow="never">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <el-radio-group v-model="filterEnabled" @change="noop">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="hidden">已隐藏</el-radio-button>
          <el-radio-button value="visible">可见</el-radio-button>
        </el-radio-group>
        <div>
          <el-button @click="load" :loading="loading">刷新</el-button>
          <el-button type="primary" :loading="saving" :disabled="saving" @click="saveAll">保存全部</el-button>
        </div>
      </div>

      <!-- 分组卡片：按 基础/画面/视频增强/声音/高级/发布 展示 -->
      <div v-for="group in GROUP_META" :key="group.name" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          <h3 style="margin:0;font-size:15px">{{ group.label }}</h3>
          <el-switch
            :model-value="groupVisible(group.name)"
            @change="(v) => toggleGroup(group.name, v)"
            active-text="显示"
            inactive-text="隐藏"
          />
          <span v-if="group.name === 'publish'" style="color:#e6a23c;font-size:12px">「发布」组仅整组控制</span>
        </div>
        <el-table
          v-loading="loading"
          :data="visibleOptions(group.name)"
          border
          size="small"
          :row-class-name="rowHiddenClass"
        >
          <el-table-column label="显示" width="80" align="center">
            <template #default="{ row }">
              <el-switch :model-value="row.visible" @change="(v) => (row.visible = v)" />
            </template>
          </el-table-column>
          <el-table-column prop="label" label="选项" min-width="160">
            <template #default="{ row }">
              <span :style="!row.visible ? 'color:#999;text-decoration:line-through' : ''">{{ row.label || row.field }}</span>
              <span v-if="row.field === '_group'" style="color:#e6a23c;font-size:12px;margin-left:6px">（整组）</span>
            </template>
          </el-table-column>
          <el-table-column label="初始默认值" min-width="220">
            <template #default="{ row }">
              <el-input
                v-model="row.default_value"
                size="small"
                :placeholder="group.name === 'visual' && row.field === 'resolution' ? '如 1920x1080' : (group.name === 'basic' && row.field === 'voiceSpeed' ? '如 1' : row.typelabel === 'boolean' ? 'true / false' : '')"
              />
            </template>
          </el-table-column>
          <el-table-column prop="description" label="说明" min-width="220" show-overflow-tooltip />
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { listPipelineOptions, savePipelineOptions } from '../api/pipelineOptions'

const GROUP_META = [
  { name: 'basic', label: '基础' },
  { name: 'visual', label: '画面' },
  { name: 'videoEnhance', label: '视频增强' },
  { name: 'voice', label: '声音' },
  { name: 'advanced', label: '高级' },
  { name: 'publish', label: '发布' },
]

const items = ref([])
const loading = ref(false)
const saving = ref(false)
const filterEnabled = ref('')

function noop() {}

function groupVisible(groupName) {
  const groupRow = items.value.find((i) => i.field === '_group' && i.group === groupName)
  if (groupRow) return groupRow.visible
  // 无整组记录时，用本组任一项的可见性推断（默认可见）
  const any = items.value.find((i) => i.group === groupName)
  return any ? any.visible : true
}

// 整组开关：publish 只有整组行；其他组将整组状态同步到所有子项
function toggleGroup(groupName, visible) {
  const groupRow = items.value.find((i) => i.field === '_group' && i.group === groupName)
  if (groupRow) groupRow.visible = visible
  for (const item of items.value) {
    if (item.group === groupName && item.field !== '_group') {
      item.visible = visible
    }
  }
}

function visibleOptions(groupName) {
  const rows = items.value.filter((i) => i.group === groupName)
  if (!rows.length) return []
  // 整组行放最前，其余按 sort_order
  return rows.slice().sort((a, b) => {
    if (a.field === '_group') return -1
    if (b.field === '_group') return 1
    return (a.sort_order || 0) - (b.sort_order || 0)
  })
}

function rowHiddenClass({ row }) {
  return row.visible ? '' : 'option-row-hidden'
}

onMounted(load)

async function load() {
  loading.value = true
  try {
    const data = await listPipelineOptions()
    // 未保存过任何选项时，初始化一个可视目录（含整组行 + 各子项）
    let rows = data.items || []
    if (!rows.length) {
      rows = buildCatalog()
      // 预写入后端，保证前端整组开关有行可绑
      try {
        const saved = await savePipelineOptions(rows)
        rows = saved.items || rows
      } catch (e) {
        ElMessage.warning('初始化选项目录失败：' + (e.response?.data?.detail || e.message))
      }
    }
    items.value = rows.map((r) => ({ ...r }))
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '加载选项控制失败')
  } finally {
    loading.value = false
  }
}

function buildCatalog() {
  const catalog = []
  const add = (group, field, label, opts = {}) => catalog.push({
    option_key: group + '.' + field,
    group,
    field,
    label: opts.label || label,
    visible: opts.visible !== false,
    default_value: opts.default_value || '',
    description: opts.description || '',
    sort_order: opts.sort_order || 0,
    typelabel: opts.typelabel || 'string',
  })
  // 整组行
  add('basic', '_group', '基础选项组', { sort_order: -1 })
  add('visual', '_group', '画面选项组', { sort_order: -1 })
  add('videoEnhance', '_group', '视频增强选项组', { sort_order: -1 })
  add('voice', '_group', '声音选项组', { sort_order: -1 })
  add('advanced', '_group', '高级选项组', { sort_order: -1 })
  add('publish', '_group', '发布选项组', { sort_order: -1, description: '「发布」组仅整组控制' })
  // 基础
  add('basic', 'resolution', '比例与分辨率', { default_value: '1920x1080' })
  add('basic', 'voiceSpeed', '旁白语速', { default_value: '1', typelabel: 'number' })
  add('basic', 'voiceVolume', '旁白音量', { default_value: '1', typelabel: 'number' })
  // 画面
  add('visual', 'imageStyle', '图片风格', { default_value: 'cinematic' })
  add('visual', 'promptStyle', '提示词风格', { default_value: 'realistic' })
  add('visual', 'maxPromptLength', '提示词最大长度', { default_value: '60', typelabel: 'number' })
  add('visual', 'imageEffect', '图片动效', { default_value: 'none' })
  add('visual', 'transition', '转场', { default_value: 'fade' })
  add('visual', 'subtitleSize', '字幕字号', { default_value: 'size3' })
  add('visual', 'subtitleStyleName', '字幕样式', { default_value: 'style1' })
  add('visual', 'subtitleEnabled', '字幕', { default_value: 'true', typelabel: 'boolean' })
  add('visual', 'bgmPath', '背景音乐', {})
  add('visual', 'bgmVolume', '背景音乐音量', { default_value: '5', typelabel: 'number' })
  add('visual', 'watermarkText', '水印文字', {})
  add('visual', 'imageProvider', '图片生成器', {})
  // 视频增强
  add('videoEnhance', 'creationMode', '创作模式', { default_value: 'auto' })
  add('videoEnhance', 'videoMode', '视频增强模式', { default_value: 'off' })
  add('videoEnhance', 'shortVideoHandling', '短视频处理', { default_value: 'loop' })
  add('videoEnhance', 'videoMaxScenes', 'AI 视频场景数上限', { default_value: '8', typelabel: 'number' })
  add('videoEnhance', 'videoMinRatio', 'AI 视频占比下限', { default_value: '20', typelabel: 'number' })
  add('videoEnhance', 'videoMaxRatio', 'AI 视频占比上限', { default_value: '40', typelabel: 'number' })
  // 声音
  add('voice', 'voiceProvider', '语音生成器', {})
  add('voice', 'voiceModel', '语音模型', {})
  add('voice', 'voiceId', '语音/音色 ID', {})
  // 高级
  add('advanced', 'contentType', '内容类型', { default_value: 'general' })
  add('advanced', 'splitLanguage', '分句语言', { default_value: 'auto' })
  add('advanced', 'splitMode', '分句模式', { default_value: 'fast' })
  add('advanced', 'splitMaxSentenceLength', '单句最大长度', { default_value: '80', typelabel: 'number' })
  add('advanced', 'splitTargetCharsPerScene', '分镜目标字数', { default_value: '30', typelabel: 'number' })
  add('advanced', 'templateId', '视频模板', {})
  add('advanced', 'fps', '帧率', { default_value: '30', typelabel: 'number' })
  add('advanced', 'format', '格式', { default_value: 'mp4' })
  add('advanced', 'negativePrompt', '负向提示词', {})
  return catalog
}

async function saveAll() {
  saving.value = true
  try {
    const result = await savePipelineOptions(items.value)
    ElMessage.success('已保存 ' + (result.count ?? result.items?.length ?? 0) + ' 项')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
:deep(.option-row-hidden) {
  background: #fafafa;
}
</style>