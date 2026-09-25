<template>
  <div>
    <h1 style="margin-bottom:16px">菜单设置</h1>
    <el-tabs v-model="activeTab">
      <el-tab-pane label="菜单排序" name="menu-order">
        <el-card shadow="never">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <span>拖拽菜单项调整左侧菜单顺序，或点击 ⤒ 移到首位、↑ 上移、↓ 下移、⤓ 移到末位微调；位移只在当前角色可见的菜单内生效，设置会自动保存。</span>
            <el-button @click="menuStore.reset()">恢复默认排序</el-button>
          </div>
          <div class="menu-order-list">
            <div
              v-for="(item, index) in visibleItems"
              :key="item.path"
              class="menu-order-row"
              :class="{ 'drag-over': dragOverPath === item.path && dragPath !== item.path, 'dragging': dragPath === item.path }"
              draggable="true"
              @dragstart="onDragStart(item.path)"
              @dragover.prevent="onDragOver(item.path)"
              @dragleave="onDragLeave(item.path)"
              @drop="onDrop(item.path)"
              @dragend="onDragEnd"
            >
              <el-icon class="drag-handle"><Rank /></el-icon>
              <span class="row-index">{{ index + 1 }}</span>
              <el-icon><component :is="item.icon" /></el-icon>
              <span class="row-label">{{ item.label }}</span>
              <span class="row-actions">
                <el-button link type="primary" title="移到首位" aria-label="移到首位" :disabled="index === 0" @click="menuStore.moveToVisibleEdge(item.path, 'top', visiblePaths)">⤒</el-button>
                <el-button link type="primary" title="上移" aria-label="上移" :disabled="index === 0" @click="menuStore.moveInVisible(item.path, -1, visiblePaths)">↑</el-button>
                <el-button link type="primary" title="下移" aria-label="下移" :disabled="index === visibleItems.length - 1" @click="menuStore.moveInVisible(item.path, 1, visiblePaths)">↓</el-button>
                <el-button link type="primary" title="移到末位" aria-label="移到末位" :disabled="index === visibleItems.length - 1" @click="menuStore.moveToVisibleEdge(item.path, 'bottom', visiblePaths)">⤓</el-button>
              </span>
            </div>
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Rank } from '@element-plus/icons-vue'
import { useAuthStore } from '../../stores/auth'
import { useMenuStore } from '../../stores/menu'

const activeTab = ref('menu-order')
const menuStore = useMenuStore()
const authStore = useAuthStore()

// 与左侧真实侧边栏完全同口径（单一事实源 menuStore.visibleForRole）：
// admin 可操作全部菜单项（含 adminOnly），非 admin 只见公共项。
// 2026-09-21 修复：此前此处硬编码 `!adminOnly`，导致 admin 设置页比侧边栏少 5 项。
const visibleItems = computed(() => menuStore.visibleForRole(authStore.role))
// 位移按可见序列解析目标（详见 menuStore.moveToVisibleEdge / moveInVisible 注释），
// 因此要把当前角色可见的 path 列表原样传给 store。
const visiblePaths = computed(() => visibleItems.value.map((item) => item.path))

// 拖拽用 path 而非下标定位：visibleItems 是按角色过滤后的可见列表，
// 其下标与 store 的完整 order 下标可能不一致（非 admin 视角 adminOnly 项造成漂移），
// 按下标重排会移动错项。
const dragPath = ref('')
const dragOverPath = ref('')

function onDragStart(path) {
  dragPath.value = path
}
function onDragOver(path) {
  dragOverPath.value = path
}
function onDragLeave(path) {
  if (dragOverPath.value === path) dragOverPath.value = ''
}
function onDrop(path) {
  const from = dragPath.value
  if (from && from !== path) {
    menuStore.reorderByPath(from, path)
  }
  dragPath.value = ''
  dragOverPath.value = ''
}
function onDragEnd() {
  dragPath.value = ''
  dragOverPath.value = ''
}
</script>

<style scoped>
.menu-order-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.menu-order-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-canvas);
  cursor: grab;
  user-select: none;
}
.menu-order-row:active {
  cursor: grabbing;
}
.menu-order-row.drag-over {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.menu-order-row.dragging {
  opacity: 0.5;
}
.drag-handle {
  color: var(--color-text-muted);
}
.row-index {
  width: 24px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
.row-label {
  flex: 1;
}
.row-actions {
  display: flex;
  gap: 4px;
}
</style>
