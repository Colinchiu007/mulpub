<template>
  <div class="replay-page">
    <!-- 顶部信息栏 -->
    <div class="replay-header">
      <div class="replay-header-left">
        <router-link :to="'/board/' + projectId" class="back-link">← 返回看板</router-link>
        <h1 class="replay-title">
          {{ projectName ? projectName + ' · 生产回放' : '生产回放' }}
        </h1>
        <span v-if="totalDuration > 0" class="replay-duration">
          总时长 {{ formatDuration(totalDuration) }}
        </span>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="replay-loading" data-testid="replay-loading">
      <UiSkeleton variant="list" :count="4" />
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="replay-error">
      <p>{{ error }}</p>
      <UiButton size="sm" @click="loadReplay">重试</UiButton>
    </div>

    <!-- 空状态 -->
    <div v-else-if="events.length === 0" class="replay-empty">
      <p>该生产无录制数据</p>
      <p class="text-muted">运行流水线后可查看生产回放</p>
    </div>

    <!-- 回放主体 -->
    <div v-else class="replay-body">
      <!-- 时间轴控制栏 -->
      <div class="timeline-controls">
        <UiButton size="sm" variant="ghost" @click="togglePlay">
          {{ playing ? '⏸ 暂停' : '▶ 播放' }}
        </UiButton>
        <div class="speed-control">
          <label>速度</label>
          <select v-model="speed" class="speed-select">
            <option :value="1">1x</option>
            <option :value="2">2x</option>
            <option :value="4">4x</option>
          </select>
        </div>
        <span class="timeline-position">
          {{ currentIndex + 1 }} / {{ events.length }}
        </span>
      </div>

      <!-- 时间轴滑块 -->
      <div class="timeline-slider-wrapper">
        <input
          type="range"
          :min="0"
          :max="Math.max(0, events.length - 1)"
          v-model.number="currentIndex"
          class="timeline-slider"
          @input="onSliderInput"
        />
        <!-- 事件标记 -->
        <div class="timeline-markers">
          <div
            v-for="(evt, i) in events"
            :key="evt.id"
            class="timeline-marker"
            :class="markerClass(evt.type)"
            :style="{ left: markerPosition(i) }"
            :title="evt.type + (evt.stageName ? ' · ' + evt.stageName : '')"
          ></div>
        </div>
      </div>

      <!-- 当前事件信息 -->
      <div class="current-event" v-if="currentEvent">
        <div class="event-meta">
          <span class="event-type" :class="markerClass(currentEvent.type)">
            {{ eventLabel(currentEvent.type) }}
          </span>
          <span v-if="currentEvent.stageName" class="event-stage">
            {{ currentEvent.stageName }}
          </span>
          <span class="event-time">{{ formatTime(currentEvent.timestamp) }}</span>
        </div>
      </div>

      <!-- 快照面板 -->
      <div class="snapshot-panel" v-if="currentSnapshot">
        <h3 class="snapshot-title">看板快照</h3>

        <!-- 阶段指示器 -->
        <div v-if="currentSnapshot.stages && currentSnapshot.stages.length > 0" class="snapshot-stages">
          <BoardStageIndicator
            :stages="currentSnapshot.stages"
            :current-index="currentSnapshot.currentStageIndex || 0"
          />
        </div>

        <!-- 项目状态 + 成本 -->
        <div class="snapshot-info">
          <span class="info-item">
            <span class="info-label">状态</span>
            <span class="info-value">{{ statusLabel(currentSnapshot.status) }}</span>
          </span>
          <span v-if="currentSnapshot.totalActualCost != null" class="info-item">
            <span class="info-label">实际成本</span>
            <span class="info-value">${{ currentSnapshot.totalActualCost }}</span>
          </span>
          <span v-if="currentSnapshot.totalEstimatedCost != null" class="info-item">
            <span class="info-label">预估成本</span>
            <span class="info-value">${{ currentSnapshot.totalEstimatedCost }}</span>
          </span>
          <span v-if="currentSnapshot.elapsed != null" class="info-item">
            <span class="info-label">已耗时</span>
            <span class="info-value">{{ currentSnapshot.elapsed }}</span>
          </span>
          <span v-if="currentSnapshot.currentOperation" class="info-item">
            <span class="info-label">当前操作</span>
            <span class="info-value">{{ currentSnapshot.currentOperation }}</span>
          </span>
        </div>

        <!-- 场景列表 -->
        <div v-if="currentSnapshot.scenes && currentSnapshot.scenes.length > 0" class="snapshot-scenes">
          <h4 class="scenes-subtitle">场景 ({{ currentSnapshot.scenes.length }})</h4>
          <div class="scene-grid">
            <SceneCard
              v-for="scene in currentSnapshot.scenes"
              :key="scene.id"
              :scene="scene"
              @select="() => {}"
            />
          </div>
        </div>
      </div>

      <!-- 事件列表（可折叠） -->
      <div class="event-list-section">
        <h3 class="event-list-title" @click="showEventList = !showEventList">
          事件列表 ({{ events.length }})
          <span class="toggle-icon">{{ showEventList ? '▼' : '▶' }}</span>
        </h3>
        <div v-if="showEventList" class="event-list">
          <div
            v-for="(evt, i) in events"
            :key="evt.id"
            class="event-row"
            :class="{ active: i === currentIndex }"
            @click="jumpTo(i)"
          >
            <span class="event-row-time">{{ formatTime(evt.timestamp) }}</span>
            <span class="event-row-type" :class="markerClass(evt.type)">
              {{ eventLabel(evt.type) }}
            </span>
            <span v-if="evt.stageName" class="event-row-stage">{{ evt.stageName }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { getApi } from '@/api/electron-bridge'
import { useRoute } from 'vue-router'
import UiButton from '@/components/UiButton.vue'
import BoardStageIndicator from '@/components/BoardStageIndicator.vue'
import SceneCard from '@/components/SceneCard.vue'
import { formatUserError } from '@/utils/user-facing-error'
import { formatDateTime } from '@/utils/datetime'

const route = useRoute()
const projectId = computed(() => route.params.projectId || '')

// 状态
const loading = ref(true)
const error = ref(null)
const events = ref([])
const projectName = ref('')
const totalDuration = ref(0)

// 播放状态
const currentIndex = ref(0)
const playing = ref(false)
const speed = ref(1)
const showEventList = ref(false)
let playTimer = null

// 计算属性
const currentEvent = computed(() => events.value[currentIndex.value] || null)

const currentSnapshot = computed(() => {
  const evt = currentEvent.value
  if (!evt) return null
  return evt.snapshot || null
})

// 生命周期
onMounted(() => {
  loadReplay()
})

onBeforeUnmount(() => {
  stopPlay()
})

// 监听播放状态
watch(playing, (val) => {
  if (val) {
    startPlay()
  } else {
    stopPlay()
  }
})

// 方法
async function loadReplay() {
  loading.value = true
  error.value = null
  try {
    const api = getApi()
    if (!api || !api.replay || !api.replay.get) {
      error.value = 'IPC API 不可用'
      loading.value = false
      return
    }
    const result = await api.replay.get(projectId.value)
    if (result && result.code === 0 && result.data) {
      events.value = result.data.events || []
      projectName.value = result.data.project ? result.data.project.name || '' : ''
      totalDuration.value = result.data.totalDuration || 0
      currentIndex.value = 0
    } else if (result && result.code !== 0) {
      error.value = formatUserError(result, { fallback: '加载回放失败' }).message
    } else {
      events.value = []
    }
  } catch (e) {
    error.value = formatUserError(e, { fallback: '加载回放数据失败' }).message
  } finally {
    loading.value = false
  }
}

function togglePlay() {
  if (events.value.length === 0) return
  if (currentIndex.value >= events.value.length - 1) {
    currentIndex.value = 0
  }
  playing.value = !playing.value
}

function startPlay() {
  stopPlay()
  const interval = Math.max(100, 1000 / speed.value)
  playTimer = setInterval(() => {
    if (currentIndex.value < events.value.length - 1) {
      currentIndex.value++
    } else {
      playing.value = false
    }
  }, interval)
}

function stopPlay() {
  if (playTimer) {
    clearInterval(playTimer)
    playTimer = null
  }
}

function onSliderInput() {
  // 拖动滑块时暂停播放
  playing.value = false
}

function jumpTo(index) {
  currentIndex.value = index
  playing.value = false
}

// 速度变化时重启播放
watch(speed, () => {
  if (playing.value) {
    startPlay()
  }
})

// 格式化函数
function formatDuration(seconds) {
  if (seconds < 60) return seconds + 's'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m + 'm ' + s + 's'
}

const formatTime = (ts) => formatDateTime(ts, { style: 'time', invalidText: ts })

function eventLabel(type) {
  const labels = {
    'pipeline:start': '流水线开始',
    'pipeline:complete': '流水线完成',
    'pipeline:fail': '流水线失败',
    'stage:start': '阶段开始',
    'stage:complete': '阶段完成',
    'stage:fail': '阶段失败',
    'checkpoint:pause': '审批暂停',
    'scene:complete': '场景完成',
    'scene:fail': '场景失败',
    'scene:retry': '场景重试',
    'contact_sheet:all_approved': '全部批准',
    'approval:resolved': '审批已处理',
  }
  return labels[type] || type
}

function markerClass(type) {
  if (type === 'pipeline:start') return 'marker-start'
  if (type === 'pipeline:complete') return 'marker-complete'
  if (type === 'pipeline:fail') return 'marker-fail'
  if (type === 'stage:start') return 'marker-stage-start'
  if (type === 'stage:complete') return 'marker-stage-complete'
  if (type === 'stage:fail') return 'marker-fail'
  if (type === 'checkpoint:pause') return 'marker-pause'
  if (type === 'scene:fail') return 'marker-fail'
  if (type === 'scene:complete') return 'marker-scene'
  if (type === 'scene:retry') return 'marker-retry'
  if (type === 'contact_sheet:all_approved') return 'marker-approved'
  if (type === 'approval:resolved') return 'marker-resolved'
  return 'marker-default'
}

function markerPosition(index) {
  if (events.value.length <= 1) return '0%'
  return ((index / (events.value.length - 1)) * 100) + '%'
}

function statusLabel(status) {
  const labels = {
    draft: '草稿', running: '运行中', paused: '已暂停',
    completed: '已完成', failed: '已失败', cancelled: '已取消',
  }
  return labels[status] || status || ''
}
</script>

<style scoped>
.replay-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.replay-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.replay-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.back-link {
  color: var(--text-muted);
  text-decoration: none;
  font-size: var(--font-size-sm);
}

.back-link:hover {
  color: var(--primary);
}

.replay-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin: 0;
}

.replay-duration {
  color: var(--text-muted);
  font-size: var(--font-size-sm);
}

.replay-loading,
.replay-error,
.replay-empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}

.replay-error p {
  color: var(--danger, var(--pipe-cinematic));
  margin-bottom: 12px;
}

.text-muted {
  color: var(--text-tertiary, #999);
  font-size: var(--font-size-sm);
  margin-top: 8px;
}

.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--hairline);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.replay-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.timeline-controls {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 8px;
}

.speed-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.speed-control label {
  font-size: var(--font-size-sm);
  color: var(--text-muted);
}

.speed-select {
  padding: 4px 8px;
  border: 1px solid var(--border, #ddd);
  border-radius: 4px;
  background: white;
}

.timeline-position {
  margin-left: auto;
  font-size: var(--font-size-sm);
  color: var(--text-muted);
}

.timeline-slider-wrapper {
  position: relative;
  padding: 20px 0;
}

.timeline-slider {
  width: 100%;
  height: 6px;
  cursor: pointer;
}

.timeline-markers {
  position: relative;
  height: 12px;
  margin-top: 4px;
}

.timeline-marker {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translateX(-50%);
  top: 2px;
}

.marker-start { background: var(--stability-beta); }
.marker-complete { background: var(--stability-production); }
.marker-fail { background: var(--pipe-cinematic); }
.marker-stage-start { background: var(--stability-beta); }
.marker-stage-complete { background: var(--teal); }
.marker-pause { background: var(--stability-experimental); }
.marker-scene { background: var(--pipe-talking-head); }
.marker-retry { background: var(--stability-experimental); }
.marker-approved { background: var(--stability-production); }
.marker-resolved { background: var(--pipe-talking-head); }
.marker-default { background: var(--text-light); }

.current-event {
  padding: 12px 16px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 8px;
}

.event-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.event-type {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: white;
  background: var(--text-light);
}

.event-type.marker-start { background: var(--stability-beta); }
.event-type.marker-complete { background: var(--stability-production); }
.event-type.marker-fail { background: var(--pipe-cinematic); }
.event-type.marker-stage-start { background: var(--stability-beta); }
.event-type.marker-stage-complete { background: var(--teal); }
.event-type.marker-pause { background: var(--stability-experimental); }

.event-stage {
  font-size: var(--font-size-sm);
  color: var(--text-primary, #333);
}

.event-time {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary, #999);
  margin-left: auto;
}

.snapshot-panel {
  padding: 20px;
  background: white;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
}

.snapshot-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  margin: 0 0 16px 0;
}

.snapshot-stages {
  margin-bottom: 16px;
}

.snapshot-info {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border, #e5e7eb);
  margin-bottom: 16px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary, #999);
}

.info-value {
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.scenes-subtitle {
  font-size: var(--font-size-sm);
  font-weight: 600;
  margin: 0 0 12px 0;
}

.scene-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.event-list-section {
  border-top: 1px solid var(--border, #e5e7eb);
  padding-top: 16px;
}

.event-list-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  margin: 0 0 8px 0;
}

.toggle-icon {
  font-size: var(--font-size-xs);
  margin-left: 4px;
}

.event-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 6px;
}

.event-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border, #f0f0f0);
}

.event-row:hover {
  background: var(--bg-secondary, var(--color-bg-inset));
}

.event-row.active {
  background: var(--bg-active, #eff6ff);
}

.event-row-time {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary, #999);
  min-width: 80px;
}

.event-row-type {
  font-size: var(--font-size-sm);
  font-weight: 500;
  min-width: 100px;
}

.event-row-stage {
  font-size: var(--font-size-sm);
  color: var(--text-muted);
}
</style>
