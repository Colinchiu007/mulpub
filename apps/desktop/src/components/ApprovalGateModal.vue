<template>
  <UiModal
    :visible="visible"
    :title="titleText"
    size="lg"
    @close="handleClose"
  >
    <!-- 加载状态 -->
    <div v-if="loading" class="gate-loading" data-testid="approval-gate-loading">
      <UiSkeleton variant="paragraph" :rows="3" />
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="gate-error">
      <p>{{ error }}</p>
      <UiButton size="sm" @click="loadGate">重试</UiButton>
    </div>

    <!-- 无待审批门 -->
    <div v-else-if="!gate" class="gate-empty">
      <p>当前无待审批门</p>
      <p class="text-muted">流水线遇到审批检查点时会自动弹出</p>
    </div>

    <!-- 审批门内容 -->
    <div v-else class="gate-content">
      <!-- 元信息 -->
      <div class="gate-meta">
        <span class="gate-type-badge" :class="badgeClass(gate.type)">
          {{ typeLabel(gate.type) }}
        </span>
        <span v-if="gate.stageName" class="gate-stage">
          阶段：{{ gate.stageName }}
        </span>
        <span v-if="gate.createdAt" class="gate-time">
          {{ formatTime(gate.createdAt) }}
        </span>
      </div>

      <!-- 决策模式提示 -->
      <div class="gate-decision-hint">
        <span v-if="gate.requiredDecision === 'approve_or_modify'">
          可通过或修改后继续
        </span>
        <span v-else>
          需要审批通过才能继续
        </span>
      </div>

      <!-- 审批内容 -->
      <div v-if="gate.content" class="gate-section">
        <div class="section-label">审批内容</div>
        <pre class="gate-content-text">{{ gate.content }}</pre>
      </div>

      <!-- 上下文信息 -->
      <div v-if="contextEntries.length > 0" class="gate-section">
        <div class="section-label">上下文</div>
        <dl class="gate-context">
          <template v-for="(entry, i) in contextEntries" :key="i">
            <dt>{{ entry.key }}</dt>
            <dd>{{ entry.value }}</dd>
          </template>
        </dl>
      </div>

      <!-- 修改意见输入（仅 approve_or_modify 模式） -->
      <div v-if="gate.requiredDecision === 'approve_or_modify'" class="gate-section">
        <div class="section-label">修改意见（修改后继续时必填）</div>
        <textarea
          v-model="modification"
          class="modification-input"
          rows="3"
          placeholder="输入修改意见，例如：调整开头节奏、更换场景描述..."
        ></textarea>
      </div>

      <!-- 决策按钮 -->
      <div class="gate-actions">
        <UiButton
          size="sm"
          :disabled="!!submitting"
          @click="handleApprove"
        >
          {{ submitting === 'approve' ? '处理中...' : '通过' }}
        </UiButton>
        <UiButton
          v-if="gate.requiredDecision === 'approve_or_modify'"
          size="sm"
          variant="secondary"
          :disabled="!!submitting || !modification.trim()"
          @click="handleModify"
        >
          {{ submitting === 'modify' ? '处理中...' : '修改后继续' }}
        </UiButton>
        <UiButton
          size="sm"
          variant="ghost"
          :disabled="!!submitting"
          @click="handleClose"
        >
          稍后处理
        </UiButton>
      </div>
    </div>
  </UiModal>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { getApi } from '@/api/electron-bridge'
import UiModal from '@/components/UiModal.vue'
import UiButton from '@/components/UiButton.vue'
import { formatUserError } from '@/utils/user-facing-error'
import { formatDateTime } from '@/utils/datetime'

const props = defineProps({
  visible: { type: Boolean, default: false },
  projectId: { type: String, default: '' },
})

const emit = defineEmits(['close', 'resolved'])

const gate = ref(null)
const loading = ref(false)
const error = ref(null)
const modification = ref('')
const submitting = ref(null) // null | 'approve' | 'modify'

let unsubApproval = null

const titleText = computed(() => {
  if (!gate.value) return '审批门'
  return typeLabel(gate.value.type) + ' · 审批'
})

const contextEntries = computed(() => {
  if (!gate.value || !gate.value.context) return []
  const ctx = gate.value.context
  if (typeof ctx !== 'object') return []
  return Object.keys(ctx)
    .filter(k => ctx[k] !== null && ctx[k] !== undefined)
    .map(k => ({
      key: k,
      value: typeof ctx[k] === 'object' ? JSON.stringify(ctx[k]) : String(ctx[k]),
    }))
})

function typeLabel(type) {
  const labels = {
    script: '脚本审批门',
    storyboard: '分镜审批门',
    scene_assets: '场景素材审批门',
    generic: '审批门',
  }
  return labels[type] || '审批门'
}

function badgeClass(type) {
  const valid = ['script', 'storyboard', 'scene_assets']
  return 'badge-' + (valid.includes(type) ? type : 'generic')
}

const formatTime = (iso) => formatDateTime(iso)

async function loadGate() {
  if (!props.projectId) return
  loading.value = true
  error.value = null
  const api = getApi()
  if (!api || !api.approvalGate) {
    loading.value = false
    return
  }
  try {
    const res = await api.approvalGate.get(props.projectId)
    if (res && res.code === 0) {
      gate.value = res.data || null
      modification.value = ''
    } else if (res) {
      error.value = formatUserError(res, { fallback: '加载失败' }).message
    }
  } catch (e) {
    error.value = formatUserError(e, { fallback: '加载失败' }).message
  } finally {
    loading.value = false
  }
}

async function handleApprove() {
  if (!gate.value || submitting.value) return
  submitting.value = 'approve'
  const api = getApi()
  if (!api || !api.approvalGate) {
    submitting.value = null
    return
  }
  try {
    const res = await api.approvalGate.approve(gate.value.id, 'approve', undefined)
    if (res && res.code === 0 && res.data && res.data.resolved) {
      emit('resolved', { gate: res.data.gate, decision: 'approve' })
      gate.value = null
      modification.value = ''
      emit('close')
    } else if (res) {
      error.value = formatUserError(res, { fallback: '审批失败' }).message
    }
  } catch (e) {
    error.value = formatUserError(e, { fallback: '审批失败' }).message
  } finally {
    submitting.value = null
  }
}

async function handleModify() {
  if (!gate.value || submitting.value || !modification.value.trim()) return
  submitting.value = 'modify'
  const api = getApi()
  if (!api || !api.approvalGate) {
    submitting.value = null
    return
  }
  try {
    const res = await api.approvalGate.approve(
      gate.value.id,
      'modify',
      modification.value.trim()
    )
    if (res && res.code === 0 && res.data && res.data.resolved) {
      emit('resolved', { gate: res.data.gate, decision: 'modify', modification: modification.value.trim() })
      gate.value = null
      modification.value = ''
      emit('close')
    } else if (res) {
      error.value = formatUserError(res, { fallback: '修改失败' }).message
    }
  } catch (e) {
    error.value = formatUserError(e, { fallback: '修改失败' }).message
  } finally {
    submitting.value = null
  }
}

function handleClose() {
  if (submitting.value) return
  emit('close')
}

function handleApprovalRequest(payload) {
  if (!payload || payload.projectId !== props.projectId) return
  // 收到新审批请求，重新加载
  loadGate()
}

// 监听 visible 变化，打开时加载
watch(
  () => props.visible,
  (val) => {
    if (val) {
      loadGate()
    } else {
      // 关闭时重置状态
      gate.value = null
      error.value = null
      modification.value = ''
      submitting.value = null
    }
  }
)

onMounted(() => {
  const api = getApi()
  if (api && api.approvalGate && api.approvalGate.onApprovalRequest) {
    unsubApproval = api.approvalGate.onApprovalRequest(handleApprovalRequest)
  }
  // 初始 visible=true 时立即加载（watch 默认非 immediate）
  if (props.visible) {
    loadGate()
  }
})

onBeforeUnmount(() => {
  if (unsubApproval) {
    try { unsubApproval() } catch (_) { /* ignore */ }
    unsubApproval = null
  }
})
</script>

<style scoped>
.gate-loading, .gate-empty, .gate-error {
  text-align: center;
  padding: 32px;
  color: var(--text-muted, #909399);
}
.gate-error p { margin-bottom: 12px; color: var(--error, #f56c6c); }
.text-muted { font-size: var(--font-size-sm); color: var(--text-muted, #c0c4cc); }
.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-color, #e4e7ed);
  border-top-color: var(--primary, #409eff);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  vertical-align: middle;
  margin-right: 8px;
}
@keyframes spin { to { transform: rotate(360deg); } }

.gate-content { display: flex; flex-direction: column; gap: 16px; }
.gate-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.gate-type-badge {
  font-size: var(--font-size-xs);
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 12px;
}
.badge-script { background: var(--ep-primary-light); color: var(--ep-primary); }
.badge-storyboard { background: var(--ep-success-light); color: var(--ep-success); }
.badge-scene_assets { background: var(--ep-warning-light); color: var(--ep-warning); }
.badge-generic { background: var(--ep-info-light); color: var(--ep-info); }
.gate-stage { font-size: var(--font-size-sm); color: var(--text-muted, #909399); }
.gate-time { font-size: var(--font-size-xs); color: var(--text-muted, #c0c4cc); margin-left: auto; }
.gate-decision-hint {
  font-size: var(--font-size-sm);
  color: var(--text-muted, #909399);
  padding: 8px 12px;
  background: var(--border-light, #f5f7fa);
  border-radius: 8px;
}
.gate-section { display: flex; flex-direction: column; gap: 6px; }
.section-label {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-muted, #909399);
}
.gate-content-text {
  background: var(--border-light, #f5f7fa);
  border-radius: 8px;
  padding: 12px;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  margin: 0;
  font-family: inherit;
}
.gate-context {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 12px;
  margin: 0;
  font-size: var(--font-size-sm);
}
.gate-context dt {
  color: var(--text-muted, #909399);
  font-weight: 500;
}
.gate-context dd {
  margin: 0;
  word-break: break-word;
}
.modification-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #dcdfe6);
  border-radius: 8px;
  font-size: var(--font-size-sm);
  font-family: inherit;
  resize: vertical;
  box-sizing: border-box;
}
.modification-input:focus {
  outline: none;
  border-color: var(--primary, #409eff);
}
.gate-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px solid var(--border-light, #f0f0f0);
}
</style>
