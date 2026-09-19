<template>
  <div class="contact-sheet-page">
    <!-- 顶部信息栏 -->
    <div class="cs-header">
      <div class="cs-header-left">
        <router-link :to="'/board/' + projectId" class="back-link">← 返回看板</router-link>
        <h1 class="cs-title">场景审批</h1>
        <span v-if="totalScenes > 0" class="cs-progress">
          {{ approvedCount }}/{{ totalScenes }} 已审批
        </span>
      </div>
      <div class="cs-header-right">
        <UiButton size="sm" variant="ghost" @click="refresh">刷新</UiButton>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="cs-loading" data-testid="contact-sheet-loading">
      <div class="mp-skeleton-grid">
        <UiSkeleton v-for="i in 6" :key="i" variant="card" class="mp-skeleton-card" />
      </div>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="cs-error">
      <p>{{ error }}</p>
      <UiButton size="sm" @click="refresh">重试</UiButton>
    </div>

    <!-- 空状态 -->
    <EmptyState v-else-if="scenes.length === 0" :title="$t('emptyStates.contactSheet.title')" :description="$t('emptyStates.contactSheet.message')" />

    <!-- 场景列表 -->
    <div v-else class="scene-list">
      <div
        v-for="scene in scenes"
        :key="scene.id"
        class="scene-approval-card"
        :class="{ awaiting: scene.status === 'AWAITING' }"
        :ref="el => setSceneRef(scene.id, el)"
      >
        <div class="scene-card-header">
          <span class="scene-num">#{{ scene.index }}</span>
          <span class="scene-title">{{ scene.name }}</span>
          <span class="scene-status-badge" :class="'badge-' + (scene.status || 'QUEUED').toLowerCase()">
            {{ statusLabel(scene.status) }}
          </span>
        </div>

        <!-- Takes 缩略图 -->
        <div v-if="scene.takes && scene.takes.length > 0" class="takes-grid">
          <div
            v-for="take in scene.takes"
            :key="take.id"
            class="take-card"
            :class="{ selected: scene.selectedTakeId === take.id }"
            @click="selectTake(scene.id, take.id)"
          >
            <img :src="take.thumbnail || take.url" :alt="'Take ' + take.id" class="take-image" />
            <div class="take-meta">
              <div v-if="take.prompt" class="take-prompt">{{ take.prompt }}</div>
              <div class="take-stats">
                <span v-if="take.cost" class="take-cost">¥{{ take.cost }}</span>
                <span v-if="take.qualityScore" class="take-quality">★ {{ take.qualityScore }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 操作区 -->
        <div v-if="scene.status === 'AWAITING'" class="scene-actions">
          <UiButton
            size="sm"
            :disabled="!scene.selectedTakeId"
            @click="approveScene(scene)"
          >
            批准{{ scene.selectedTakeId ? '此 take' : '' }}
          </UiButton>
          <UiButton size="sm" variant="ghost" @click="toggleRejectInput(scene.id)">
            驳回
          </UiButton>
          <div v-if="rejectInputs[scene.id]" class="reject-input">
            <textarea
              v-model="rejectFeedbacks[scene.id]"
              placeholder="输入驳回反馈（可选）"
              rows="2"
              class="reject-textarea"
            ></textarea>
            <UiButton size="sm" variant="danger" @click="rejectScene(scene)">确认驳回</UiButton>
            <UiButton size="sm" variant="ghost" @click="toggleRejectInput(scene.id)">取消</UiButton>
          </div>
        </div>

        <!-- 已批准标记 -->
        <div v-else-if="scene.status === 'APPROVED'" class="scene-approved">
          ✓ 已批准{{ scene.approvedAt ? ' · ' + formatTime(scene.approvedAt) : '' }}
        </div>
        <div v-else-if="scene.status === 'REJECTED'" class="scene-rejected">
          ✕ 已驳回{{ scene.feedback ? ' · ' + scene.feedback : '' }}
        </div>
        <div v-else-if="scene.status === 'QUEUED'" class="scene-queued">
          ○ 队列中，等待重新生成
        </div>
        <div v-else-if="scene.status === 'GENERATING'" class="scene-generating">
          ⏳ 生成中...
        </div>
        <div v-else-if="scene.status === 'FAILED'" class="scene-failed">
          ✕ 失败{{ scene.error ? ' · ' + scene.error : '' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, reactive, nextTick } from 'vue'
import { getApi } from '@/api/electron-bridge'
import { useRoute } from 'vue-router'
import UiButton from '@/components/UiButton.vue'
import { formatUserError } from '@/utils/user-facing-error'
import { formatDateTime } from '@/utils/datetime'

const route = useRoute()
const projectId = computed(() => route.params.projectId || null)

const scenes = ref([])
const loading = ref(true)
const error = ref(null)
const rejectInputs = reactive({})
const rejectFeedbacks = reactive({})
const sceneRefs = {}

let unsubApproval = null

const totalScenes = computed(() => scenes.value.length)
const approvedCount = computed(() =>
  scenes.value.filter(s => s.status === 'APPROVED' || s.status === 'COMPLETED').length
)

function statusLabel(status) {
  const labels = {
    QUEUED: '队列中', GENERATING: '生成中', AWAITING: '待审批',
    APPROVED: '已批准', REJECTED: '已驳回', COMPLETED: '已完成', FAILED: '失败',
  }
  return labels[status] || status || '队列中'
}

function setSceneRef(id, el) {
  if (el) sceneRefs[id] = el
}

function selectTake(sceneId, takeId) {
  const scene = scenes.value.find(s => s.id === sceneId)
  if (scene) {
    scene.selectedTakeId = scene.selectedTakeId === takeId ? null : takeId
  }
}

function toggleRejectInput(sceneId) {
  rejectInputs[sceneId] = !rejectInputs[sceneId]
  if (!rejectFeedbacks[sceneId]) rejectFeedbacks[sceneId] = ''
}

async function approveScene(scene) {
  const api = getApi()
  if (!api || !api.contactSheet) return
  try {
    const res = await api.contactSheet.approve(scene.id, scene.selectedTakeId)
    if (res && res.code === 0 && res.data) {
      Object.assign(scene, res.data.scene)
    }
  } catch (e) {
    error.value = formatUserError(e, { fallback: '批准失败' }).message
  }
}

async function rejectScene(scene) {
  const api = getApi()
  if (!api || !api.contactSheet) return
  try {
    const feedback = rejectFeedbacks[scene.id] || ''
    const res = await api.contactSheet.reject(scene.id, feedback)
    if (res && res.code === 0 && res.data) {
      Object.assign(scene, res.data.scene)
      rejectInputs[scene.id] = false
    }
  } catch (e) {
    error.value = formatUserError(e, { fallback: '驳回失败' }).message
  }
}

async function refresh() {
  if (!projectId.value) return
  loading.value = true
  error.value = null
  const api = getApi()
  if (!api || !api.contactSheet) {
    loading.value = false
    return
  }
  try {
    const res = await api.contactSheet.list(projectId.value)
    if (res && res.code === 0) {
      scenes.value = res.data || []
      // 自动滚动到第一个 AWAITING 场景
      await nextTick()
      const awaiting = scenes.value.find(s => s.status === 'AWAITING')
      if (awaiting && sceneRefs[awaiting.id]) {
        sceneRefs[awaiting.id].scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    } else if (res) {
      error.value = formatUserError(res, { fallback: '加载失败' }).message
    }
  } catch (e) {
    error.value = formatUserError(e, { fallback: '加载失败' }).message
  } finally {
    loading.value = false
  }
}

function handleApprovalRequest(payload) {
  if (!payload || payload.projectId !== projectId.value) return
  // 收到新审批请求，刷新列表
  refresh()
}

const formatTime = (iso) => formatDateTime(iso, { style: 'time' })

onMounted(async () => {
  const api = getApi()
  if (api && api.contactSheet && api.contactSheet.onApprovalRequest) {
    unsubApproval = api.contactSheet.onApprovalRequest(handleApprovalRequest)
  }
  await refresh()
})

onBeforeUnmount(() => {
  if (unsubApproval) {
    try { unsubApproval() } catch (_) { /* ignore */ }
    unsubApproval = null
  }
})
</script>

<style scoped>
.contact-sheet-page { padding: 24px; max-width: 1200px; margin: 0 auto; }
.cs-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
.cs-header-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.back-link { font-size: var(--font-size-sm); color: #909399; text-decoration: none; }
.back-link:hover { color: #409eff; }
.cs-title { font-size: var(--font-size-lg); font-weight: 700; margin: 0; }
.cs-progress { font-size: var(--font-size-sm); color: #909399; padding: 4px 10px; background: #f0f0f0; border-radius: 10px; }
.cs-loading, .cs-error { text-align: center; padding: 48px; color: #909399; }
.text-muted { font-size: var(--font-size-sm); color: #c0c4cc; }
.spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #e4e7ed; border-top-color: #409eff; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 8px; }
@keyframes spin { to { transform: rotate(360deg); } }
.scene-list { display: flex; flex-direction: column; gap: 16px; }
.scene-approval-card { background: var(--color-bg-card); border: 1px solid #e4e7ed; border-radius: 12px; padding: 16px; transition: border-color 0.2s; }
.scene-approval-card.awaiting { border-color: #e6a23c; border-width: 2px; }
.scene-card-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.scene-num { font-size: var(--font-size-sm); font-weight: 600; color: #909399; }
.scene-title { font-size: var(--font-size-base); font-weight: 600; flex: 1; }
.scene-status-badge { font-size: var(--font-size-xs); padding: 2px 8px; border-radius: 10px; font-weight: 500; }
.badge-queued { background: #f0f0f0; color: #909399; }
.badge-generating { background: #e6f0ff; color: #409eff; }
.badge-awaiting { background: #fdf6ec; color: #e6a23c; }
.badge-approved { background: #f0f9eb; color: #67c23a; }
.badge-rejected { background: #fef0f0; color: #f56c6c; }
.badge-completed { background: #f0f9eb; color: #67c23a; }
.badge-failed { background: #fef0f0; color: #f56c6c; }
.takes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 12px; }
.take-card { border: 2px solid #e4e7ed; border-radius: 8px; overflow: hidden; cursor: pointer; transition: border-color 0.2s; }
.take-card:hover { border-color: #409eff; }
.take-card.selected { border-color: #409eff; background: #ecf5ff; }
.take-image { width: 100%; height: 120px; object-fit: cover; display: block; }
.take-meta { padding: 8px; }
.take-prompt { font-size: var(--font-size-xs); color: #909399; line-height: 1.4; margin-bottom: 4px; max-height: 40px; overflow: hidden; }
.take-stats { display: flex; gap: 8px; font-size: var(--font-size-xs); }
.take-cost { color: #909399; }
.take-quality { color: #e6a23c; }
.scene-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid #f0f0f0; }
.reject-input { display: flex; gap: 8px; align-items: center; width: 100%; margin-top: 8px; }
.reject-textarea { flex: 1; padding: 6px 8px; border: 1px solid #dcdfe6; border-radius: 4px; font-size: var(--font-size-sm); resize: vertical; font-family: inherit; }
.scene-approved { color: #67c23a; font-size: var(--font-size-sm); padding: 8px 0; }
.scene-rejected { color: #f56c6c; font-size: var(--font-size-sm); padding: 8px 0; }
.scene-queued { color: #909399; font-size: var(--font-size-sm); padding: 8px 0; }
.scene-generating { color: #409eff; font-size: var(--font-size-sm); padding: 8px 0; }
.scene-failed { color: #f56c6c; font-size: var(--font-size-sm); padding: 8px 0; }
</style>
