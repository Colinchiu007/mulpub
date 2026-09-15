<template>
  <div>
    <h1 style="margin-bottom:16px">应用菜单</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      管理应用端（桌面端）左侧边栏的菜单项：控制显示 / 隐藏，并调整菜单项在所属分组内的顺序。
      「发布、账号、采集、视频创作」为系统核心入口，<strong>强制显示</strong>，开关灰显不可关闭。
      配置随运行时 bootstrap 下发；桌面端启动 3 秒后自动同步一次，
      <strong>修改后需在桌面端重新同步（或重启应用）才会生效</strong>（当前无实时推送）。
    </p>

    <el-card shadow="never">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="color:#909399;font-size:12px">
          共 {{ items.length }} 项 · 已隐藏 {{ hiddenCount }} 项
          <span v-if="dirty" style="color:#e6a23c;margin-left:8px">● 有未保存的修改</span>
        </div>
        <div>
          <el-button :loading="loading" :disabled="saving || resetting" @click="load">刷新</el-button>
          <el-button :loading="resetting" :disabled="saving || loading" @click="resetAll">恢复默认</el-button>
          <el-button type="primary" :loading="saving" :disabled="saving" @click="saveAll">保存</el-button>
        </div>
      </div>

      <div v-for="group in GROUP_META" :key="group.name" style="margin-bottom:24px">
        <h3 style="margin:0 0 4px;font-size:15px">{{ group.label }}</h3>
        <p style="margin:0 0 8px;color:#909399;font-size:12px">{{ group.hint }}</p>
        <el-table
          v-loading="loading"
          :data="groupRows(group.name)"
          border
          size="small"
          :row-class-name="rowHiddenClass"
        >
          <el-table-column label="顺序" width="110" align="center">
            <template #default="{ row }">
              <el-button size="small" :disabled="isFirst(group.name, row)" @click="move(row, -1)">↑</el-button>
              <el-button size="small" :disabled="isLast(group.name, row)" @click="move(row, 1)">↓</el-button>
            </template>
          </el-table-column>

          <el-table-column label="显示" width="90" align="center">
            <template #default="{ row }">
              <el-tooltip
                v-if="row.forced_visible"
                content="系统核心入口，强制显示，不可关闭"
                placement="top"
              >
                <span style="display:inline-block">
                  <el-switch :model-value="true" disabled />
                </span>
              </el-tooltip>
              <el-switch
                v-else
                :model-value="row.visible"
                @change="(value) => { row.visible = value; dirty = true }"
              />
            </template>
          </el-table-column>

          <el-table-column prop="label" label="菜单项" min-width="150">
            <template #default="{ row }">
              <span :style="!row.visible ? 'color:#999;text-decoration:line-through' : ''">{{ row.label }}</span>
              <el-tag v-if="row.forced_visible" size="small" type="warning" style="margin-left:6px">强制显示</el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="item_key" label="标识" width="150" />

          <el-table-column prop="description" label="说明" min-width="220" show-overflow-tooltip />
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listAppMenu, saveAppMenu, resetAppMenu } from '../api/appMenu'

const GROUP_META = [
  {
    name: 'primary',
    label: '一级导航（侧边栏平铺显示）',
    hint: '常驻侧边栏的入口，建议保留 3-6 项以保证可读性。',
  },
  {
    name: 'more',
    label: '更多菜单（「更多」折叠面板内）',
    hint: '收纳低频入口；若全部隐藏，侧边栏的「更多」按钮将不再出现。',
  },
]

const items = ref([])
const loading = ref(false)
const saving = ref(false)
const resetting = ref(false)
const dirty = ref(false)

const hiddenCount = computed(() => items.value.filter((item) => !item.visible).length)

/** 组内按 sort_order 排序的行（元素与 items 中同一对象引用，可直接改） */
function groupRows(groupName) {
  return items.value
    .filter((item) => item.group === groupName)
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
}

function isFirst(groupName, row) {
  const rows = groupRows(groupName)
  return rows.length === 0 || rows[0].id === row.id
}

function isLast(groupName, row) {
  const rows = groupRows(groupName)
  return rows.length === 0 || rows[rows.length - 1].id === row.id
}

/** 组内上移 / 下移：重排后把 sort_order 归一化为 0..n-1 */
function move(row, delta) {
  const rows = groupRows(row.group)
  const index = rows.findIndex((item) => item.id === row.id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= rows.length) return
  const reordered = rows.slice()
  const [moved] = reordered.splice(index, 1)
  reordered.splice(target, 0, moved)
  reordered.forEach((item, order) => { item.sort_order = order })
  dirty.value = true
}

function rowHiddenClass({ row }) {
  return row.visible ? '' : 'app-menu-row-hidden'
}

onMounted(load)

async function load() {
  loading.value = true
  try {
    const data = await listAppMenu()
    items.value = (data.items || []).map((item) => ({ ...item }))
    dirty.value = false
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '加载应用菜单失败')
  } finally {
    loading.value = false
  }
}

async function saveAll() {
  saving.value = true
  try {
    const payload = items.value.map((item) => ({
      item_key: item.item_key,
      visible: item.visible,
      sort_order: item.sort_order,
    }))
    const result = await saveAppMenu(payload)
    items.value = (result.items || []).map((item) => ({ ...item }))
    dirty.value = false
    const corrected = result.corrections || []
    if (corrected.length) {
      ElMessage.warning('已保存。以下强制显示项被系统纠正为「显示」：' + corrected.join('、'))
    } else {
      ElMessage.success('已保存 ' + (result.count ?? payload.length) + ' 项')
    }
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '保存失败')
  } finally {
    saving.value = false
  }
}

async function resetAll() {
  try {
    await ElMessageBox.confirm(
      '将恢复为默认设置：全部菜单项显示，并恢复默认顺序。此操作会立即覆盖当前配置，是否继续？',
      '恢复默认',
      { type: 'warning', confirmButtonText: '恢复默认', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  resetting.value = true
  try {
    const result = await resetAppMenu()
    items.value = (result.items || []).map((item) => ({ ...item }))
    dirty.value = false
    ElMessage.success('已恢复默认')
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '恢复默认失败')
  } finally {
    resetting.value = false
  }
}
</script>

<style scoped>
:deep(.app-menu-row-hidden) {
  background: #fafafa;
}
</style>
