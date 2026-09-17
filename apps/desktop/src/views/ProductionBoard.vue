<template>
  <div class="board-page">
    <!-- 顶部信息栏 -->
    <div class="board-header">
      <div class="board-header-left">
        <router-link to="/library" class="back-link">← 项目库</router-link>
        <h1 class="board-title">{{ projectName }}</h1>
      </div>
      <div class="board-header-right">
        <span v-if="totalCost" class="board-cost">总成本 ¥{{ totalCost }}</span>
        <span v-if="elapsed" class="board-elapsed">已耗时 {{ elapsed }}</span>
        <UiButton v-if="pendingGates > 0" size="sm" variant="secondary" @click="openApprovalGate">
          审批门 ({{ pendingGates }})
        </UiButton>
        <UiButton v-if="isCompleted" size="sm" @click="goReplay">查看回放</UiButton>
      </div>
    </div>

    <!-- 阶段指示器 -->
    <div class="board-stages" v-if="stages.length > 0">
      <BoardStageIndicator
        :stages="stages"
        :current-index="currentStageIndex"
      />
    </div>

    <!-- 加载状态 -->
    <div v-if="!board && loading" class="board-loading" data-testid="board-loading">
      <div class="mp-skeleton-grid">
        <UiSkeleton v-for="i in 6" :key="i" variant="card" class="mp-skeleton-card" />
      </div>
    </div>

    <!-- 空看板 -->
    <EmptyState v-else-if="!board" :title="$t('emptyStates.productionBoardBoard.title')" compact />

    <!-- 场景卡片网格 -->
    <div v-else class="board-content">
      <div class="board-main">
        <EmptyState v-if="scenes.length === 0" :title="$t('emptyStates.productionBoardScenes.title')" compact />
        <div v-else class="scene-grid">
          <SceneCard
            v-for="scene in scenes"
            :key="scene.id"
            :scene="scene"
            @select="goContactSheet"
          />
        </div>
      </div>

      <!-- 右侧信息面板 -->
      <div class="board-sidebar" v-if="board.currentOperation || eventLog.length > 0">
        <div v-if="board.currentOperation" class="info-section">
          <div class="info-label">当前操作</div>
          <div class="info-value">{{ board.currentOperation }}</div>
        </div>
        <div v-if="eventLog.length > 0" class="info-section">
          <div class="info-label">最新事件</div>
          <div class="event-log">
            <div v-for="(evt, i) in eventLog" :key="i" class="event-item">
              <span class="event-time">{{ formatTime(evt.timestamp) }}</span>
              <span class="event-text">{{ evt.message }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 审批门弹窗 -->
    <ApprovalGateModal
      :visible="showApprovalGate"
      :project-id="projectId || ''"
      @close="closeApprovalGate"
      @resolved="handleGateResolved"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { getApi } from '@/api/electron-bridge'
import { useRoute, useRouter } from 'vue-router'
import { useLiveBoard } from '@/composables/useBacklot'
import BoardStageIndicator from '@/components/BoardStageIndicator.vue'
import SceneCard from '@/components/SceneCard.vue'
import UiButton from '@/components/UiButton.vue'
import ApprovalGateModal from '@/components/ApprovalGateModal.vue'
import { formatDateTime } from '@/utils/datetime'

const route = useRoute()
const router = useRouter()

const projectId = computed(() => route.params.projectId || null)

const { board, subscribe, unsubscribe } = useLiveBoard(projectId)

const loading = ref(true)
const eventLog = ref([])
const showApprovalGate = ref(false)
let unsubApprovalGate = null

const projectName = computed(() => {
  if (!board.value) return '生产看板'
  return board.value.projectName || '生产看板'
})

const stages = computed(() => {
  if (!board.value || !board.value.stages) return []
  return board.value.stages
})

const currentStageIndex = computed(() => {
  if (!board.value) return -1
  return board.value.currentStageIndex !== undefined ? board.value.currentStageIndex : -1
})

const scenes = computed(() => {
  if (!board.value || !board.value.scenes) return []
  return board.value.scenes
})

const totalCost = computed(() => {
  if (!board.value || !board.value.totalEstimatedCost) return null
  return board.value.totalEstimatedCost
})

const elapsed = computed(() => {
  if (!board.value || !board.value.elapsed) return null
  return board.value.elapsed
})

const isCompleted = computed(() => {
  if (!board.value) return false
  return board.value.status === 'completed'
})

const pendingGates = computed(() => {
  if (!board.value) return 0
  return board.value.pendingGates || 0
})

function goContactSheet(sceneId) {
  if (!projectId.value || !sceneId) return
  router.push('/board/' + projectId.value + '/contact-sheet')
}

function openApprovalGate() {
  showApprovalGate.value = true
}

function closeApprovalGate() {
  showApprovalGate.value = false
}

function handleGateResolved() {
  showApprovalGate.value = false
  // 记录事件日志
  eventLog.value.unshift({
    timestamp: new Date().toISOString(),
    message: '审批门已处理',
  })
  if (eventLog.value.length > 20) {
    eventLog.value = eventLog.value.slice(0, 20)
  }
}

function handleApprovalGatePush(payload) {
  if (!payload || payload.projectId !== projectId.value) return
  // 收到审批门推送，自动打开弹窗
  showApprovalGate.value = true
}

function goReplay() {
  if (!projectId.value) return
  router.push('/replay/' + projectId.value)
}

const formatTime = (ts) => formatDateTime(ts, { style: 'time-seconds' })

// 监听 board 变化，记录事件日志
watch(board, (newBoard, oldBoard) => {
  if (!newBoard) return
  if (newBoard.currentOperation && (!oldBoard || newBoard.currentOperation !== oldBoard.currentOperation)) {
    eventLog.value.unshift({
      timestamp: new Date().toISOString(),
      message: newBoard.currentOperation,
    })
    if (eventLog.value.length > 20) {
      eventLog.value = eventLog.value.slice(0, 20)
    }
  }
}, { deep: true })

onMounted(async () => {
  if (projectId.value) {
    await subscribe()
  }
  // 注册审批门推送监听
  const api = getApi()
  if (api && api.approvalGate && api.approvalGate.onApprovalRequest) {
    unsubApprovalGate = api.approvalGate.onApprovalRequest(handleApprovalGatePush)
  }
  loading.value = false
})

onBeforeUnmount(async () => {
  await unsubscribe()
  if (unsubApprovalGate) {
    try { unsubApprovalGate() } catch (_) { /* ignore */ }
    unsubApprovalGate = null
  }
})
</script>

<style scoped>
.board-page {
  padding: 24px;
  min-height: 100vh;
}
.board-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}
.board-header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.back-link {
  font-size: 13px;
  color: var(--text-muted, #909399);
  text-decoration: none;
}
.back-link:hover {
  color: var(--action-blue, #409eff);
}
.board-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0;
}
.board-header-right {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: var(--text-muted, #909399);
}
.board-cost, .board-elapsed {
  font-weight: 500;
}
.board-stages {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e4e7ed);
  border-radius: 12px;
  padding: 8px 16px;
  margin-bottom: 16px;
}
.board-loading {
  text-align: center;
  padding: 48px 24px;
  color: var(--text-muted, #909399);
}
.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-color, #e4e7ed);
  border-top-color: var(--action-blue, #409eff);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  vertical-align: middle;
  margin-right: 8px;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.board-content {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.board-main {
  flex: 1;
  min-width: 300px;
}
.scene-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.board-sidebar {
  width: 280px;
  flex-shrink: 0;
}
.info-section {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e4e7ed);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.info-label {
  font-size: 12px;
  color: var(--text-muted, #909399);
  margin-bottom: 6px;
  font-weight: 600;
}
.info-value {
  font-size: 14px;
  line-height: 1.5;
}
.event-log {
  max-height: 300px;
  overflow-y: auto;
}
.event-item {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border-light, #f0f0f0);
  font-size: 12px;
}
.event-item:last-child {
  border-bottom: none;
}
.event-time {
  color: var(--text-muted, #909399);
  white-space: nowrap;
  font-family: monospace;
}
.event-text {
  flex: 1;
  word-break: break-word;
}
</style>
