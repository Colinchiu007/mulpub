<template>
  <div>
    <h1 style="margin-bottom:16px">应用菜单</h1>
    <p style="color:#888;margin-bottom:16px;font-size:13px">
      管理应用端（桌面端）左侧边栏的菜单项：控制显示 / 隐藏，调整顺序，并可在
      <strong>「一级导航」与「更多」之间互相拖动</strong>（跨组移动）。
      「发布、账号、采集、视频创作」为系统核心入口，<strong>强制显示且锁定在一级导航</strong>，不可关闭、不可移出（但可在一级导航内拖动排序）。
      拖动即自动重排顺序；修改后点「保存」生效。组内排序：把菜单项拖到同组另一项上即可；<strong>跨组移动（一级导航 ↔ 更多）需拖到目标分组的空白处</strong>，拖到具体菜单项上不会跨组。
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

      <div
        v-for="group in GROUP_META"
        :key="group.name"
        class="menu-group"
        :class="{ 'drag-over': dragOverGroup === group.name }"
        @dragover.prevent="onGroupDragOver(group.name)"
        @dragleave="onGroupDragLeave(group.name)"
        @drop.prevent="onDropOnGroup(group.name)"
      >
        <h3 style="margin:0 0 4px;font-size:15px">{{ group.label }}</h3>
        <p style="margin:0 0 8px;color:#909399;font-size:12px">{{ group.hint }}</p>

        <div class="menu-list">
          <div
            v-for="row in groupRows(group.name)"
            :key="row.item_key"
            class="menu-row"
            :class="{ 'row-hidden': !row.visible, 'row-dragging': dragKey === row.item_key, 'row-forced': row.forced_visible }"
            :draggable="true"
            @dragstart="onDragStart(row)"
            @dragend="onDragEnd"
            @dragover.prevent
            @drop.stop.prevent="onDrop(row, group.name)"
          >
            <span class="drag-handle" :title="row.forced_visible ? '锁定一级导航，可拖动排序' : '拖动调整位置或跨组'">
              {{ row.forced_visible ? '⠿' : '⠿' }}
            </span>

            <span class="order-btns">
              <el-button size="small" :disabled="isFirst(group.name, row)" @click="move(row, -1)">↑</el-button>
              <el-button size="small" :disabled="isLast(group.name, row)" @click="move(row, 1)">↓</el-button>
            </span>

            <span class="row-switch">
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
            </span>

            <span class="row-label">
              <span :style="!row.visible ? 'color:#999;text-decoration:line-through' : ''">{{ row.label }}</span>
              <el-tag v-if="row.forced_visible" size="small" type="warning" style="margin-left:6px">强制显示</el-tag>
            </span>

            <span class="row-key">{{ row.item_key }}</span>
            <span class="row-desc">{{ row.description }}</span>
          </div>

          <div v-if="groupRows(group.name).length === 0" class="empty-hint">（空）</div>
        </div>
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

// 拖拽状态
const dragKey = ref(null)
const dragOverGroup = ref(null)
const dragSrcGroup = ref(null)

const hiddenCount = computed(() => items.value.filter((item) => !item.visible).length)

/** 某分组内、按 sort_order 排序的行（元素与 items 中同一对象引用，可直接改） */
function groupRows(groupName) {
  return items.value
    .filter((item) => item.group === groupName)
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
}

function isFirst(groupName, row) {
  const rows = groupRows(groupName)
  return rows.length === 0 || rows[0].item_key === row.item_key
}

function isLast(groupName, row) {
  const rows = groupRows(groupName)
  return rows.length === 0 || rows[rows.length - 1].item_key === row.item_key
}

/** 组内上移 / 下移：重排后把 sort_order 归一化为 0..n-1 */
function move(row, delta) {
  const rows = groupRows(row.group)
  const index = rows.findIndex((item) => item.item_key === row.item_key)
  const target = index + delta
  if (index < 0 || target < 0 || target >= rows.length) return
  const reordered = rows.slice()
  const [moved] = reordered.splice(index, 1)
  reordered.splice(target, 0, moved)
  reordered.forEach((item, order) => { item.sort_order = order })
  dirty.value = true
}

// ─── 原生 HTML5 拖拽：区内排序 + 跨组移动 ───────────────────

function onDragStart(row) {
  dragKey.value = row.item_key
  dragSrcGroup.value = row.group
}

function onDragEnd() {
  dragKey.value = null
  dragOverGroup.value = null
  dragSrcGroup.value = null
}

function onGroupDragOver(groupName) {
  dragOverGroup.value = groupName
}

function onGroupDragLeave(groupName) {
  if (dragOverGroup.value === groupName) dragOverGroup.value = null
}

/** 拖到某个具体行上：
 *  - 同组内 → 排序（插入到该行之前）；
 *  - 跨组 → 移动到目标分组，并插入到该行所在位置（一级导航 ↔ 更多均支持）。
 *  这是最直观的拖拽语义；移除早期“跨组必须落空白”的限制，
 *  因分组几乎被行填满、空白极难命中，导致跨组几乎无法成功。 */
function onDrop(targetRow, targetGroup) {
  const key = dragKey.value
  dragKey.value = null
  dragOverGroup.value = null
  dragSrcGroup.value = null
  if (!key || key === targetRow.item_key) return
  moveItem(key, targetRow.item_key, targetGroup)
}

/** 拖到分组空白区：仅「跨组移动」时追加到目标组末尾；
 *  同组空白 drop 不重排（排序请拖到同组具体菜单项上），避免误移到末尾导致大范围位移。 */
function onDropOnGroup(targetGroup) {
  dragOverGroup.value = null
  const key = dragKey.value
  const src = dragSrcGroup.value
  dragKey.value = null
  dragSrcGroup.value = null
  if (!key) return
  // 同组空白 drop：忽略，避免把项误移到该组末尾（这正是“拖动连坐很多位”的根因）
  if (src === targetGroup) return
  moveItem(key, null, targetGroup)
}

/** 核心：把 key 项移动到 targetGroup，插入到 beforeKey 之前（null=末尾）。重算受影响组的 sort_order。
 *  关键修复：targetList / 源组重排都基于「视觉顺序」(groupRows，即按 sort_order 排序)，
 *  而非 items 原始扁平数组顺序——否则当后端返回顺序与视觉顺序不一致（或多次拖拽后两者脱节）时，
 *  拖拽落点会算错，导致项目「跳到很远的位置」。 */
function moveItem(key, beforeKey, targetGroup) {
  const all = items.value
  const moved = all.find((item) => item.item_key === key)
  if (!moved) return
  const srcGroup = moved.group

  // 强制显示项锁定在一级导航（防御纵深）：仅允许在一级导航内排序，
  // 不允许拖入「更多」分组，避免破坏系统核心入口的常驻性。
  if (moved.forced_visible && targetGroup !== 'primary') {
    ElMessage.warning('核心入口锁定在一级导航，仅可在一级导航内拖动排序，不可移入「更多」')
    return
  }
  moved.group = targetGroup

  // 目标组（按视觉顺序，排除被移动项）后再插入 —— 保证落点与用户所见一致
  const targetList = groupRows(moved.group).filter((item) => item.item_key !== key)
  const idx = beforeKey == null
    ? targetList.length
    : targetList.findIndex((item) => item.item_key === beforeKey)
  targetList.splice(idx < 0 ? targetList.length : idx, 0, moved)
  targetList.forEach((item, order) => { item.sort_order = order })

  // 若跨组，源组剩余项也按视觉顺序重新归顺 sort_order
  if (moved.group !== srcGroup) {
    groupRows(srcGroup).forEach((item, order) => { item.sort_order = order })
  }

  dirty.value = true
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
      group: item.group,
    }))
    const result = await saveAppMenu(payload)
    items.value = (result.items || []).map((item) => ({ ...item }))
    dirty.value = false
    const corrected = result.corrections || []
    if (corrected.length) {
      ElMessage.warning('已保存。以下核心入口被系统纠正为「显示在一级导航」：' + corrected.join('、'))
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
      '将恢复为默认设置：全部菜单项显示，并恢复默认分组与顺序。此操作会立即覆盖当前配置，是否继续？',
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
.menu-group {
  margin-bottom: 24px;
  border: 1px dashed transparent;
  border-radius: 8px;
  padding: 8px;
  transition: background 0.15s, border-color 0.15s;
}
.menu-group.drag-over {
  border-color: #409eff;
  background: #ecf5ff;
}
.menu-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 40px;
}
.menu-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fff;
  cursor: grab;
}
.menu-row.row-dragging {
  opacity: 0.5;
}
.menu-row.row-hidden {
  background: #fafafa;
}
.menu-row.row-forced {
  background: #fdf6ec;
}
.menu-row.row-forced .drag-handle {
  color: #e6a23c;
}
.drag-handle {
  font-size: 16px;
  color: #c0c4cc;
  user-select: none;
}
.order-btns {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
}
.row-switch {
  min-width: 44px;
  text-align: center;
}
.row-label {
  min-width: 120px;
  font-weight: 500;
}
.row-key {
  font-family: monospace;
  color: #909399;
  font-size: 12px;
}
.row-desc {
  color: #909399;
  font-size: 12px;
  margin-left: auto;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty-hint {
  color: #c0c4cc;
  font-size: 12px;
  padding: 6px 2px;
}
</style>
