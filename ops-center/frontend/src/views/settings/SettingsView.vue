<template>
  <div>
    <h1 style="margin-bottom:16px">菜单设置</h1>
    <el-tabs v-model="activeTab">
      <el-tab-pane label="菜单排序" name="menu-order">
        <el-card shadow="never">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <span>拖拽菜单项调整左侧菜单顺序，或点击箭头微调；设置会自动保存。</span>
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
                <el-button link type="primary" :disabled="index === 0" @click="menuStore.move(item.path, -1)">上移</el-button>
                <el-button link type="primary" :disabled="index === visibleItems.length - 1" @click="menuStore.move(item.path, 1)">下移</el-button>
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
import { useMenuStore } from '../../stores/menu'

const activeTab = ref('menu-order')
const menuStore = useMenuStore()

const visibleItems = computed(() => menuStore.orderedItems.filter((item) => !item.adminOnly))

// 拖拽用 path 而非下标定位：visibleItems 过滤掉了 adminOnly 项，
// 其下标与 store 的完整 order 下标不一致，按下标重排会移动错项。
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
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
  cursor: grab;
  user-select: none;
}
.menu-order-row:active {
  cursor: grabbing;
}
.menu-order-row.drag-over {
  border-color: #409eff;
  background: #ecf5ff;
}
.menu-order-row.dragging {
  opacity: 0.5;
}
.drag-handle {
  color: #c0c4cc;
}
.row-index {
  width: 24px;
  text-align: center;
  color: #909399;
  font-size: 13px;
}
.row-label {
  flex: 1;
}
.row-actions {
  display: flex;
  gap: 4px;
}
</style>
