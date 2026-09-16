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
              :class="{ 'drag-over': dragOverIndex === index && dragIndex !== index, 'dragging': dragIndex === index }"
              draggable="true"
              @dragstart="onDragStart(index)"
              @dragover.prevent="onDragOver(index)"
              @dragleave="onDragLeave(index)"
              @drop="onDrop(index)"
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

const dragIndex = ref(-1)
const dragOverIndex = ref(-1)

function onDragStart(index) {
  dragIndex.value = index
}
function onDragOver(index) {
  dragOverIndex.value = index
}
function onDragLeave(index) {
  if (dragOverIndex.value === index) dragOverIndex.value = -1
}
function onDrop(index) {
  const from = dragIndex.value
  if (from >= 0 && from !== index) {
    menuStore.reorder(from, index)
  }
  dragIndex.value = -1
  dragOverIndex.value = -1
}
function onDragEnd() {
  dragIndex.value = -1
  dragOverIndex.value = -1
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
