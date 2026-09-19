<template>
  <div class="feedback-page">
    <div class="page-header">
      <div>
        <h1>用户反馈</h1>
        <span class="page-count">共 {{ total }} 条</span>
      </div>
      <el-button type="primary" :loading="loading" @click="loadFeedback">
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <el-alert
      v-if="loadError"
      class="state-alert"
      type="error"
      :title="loadError"
      show-icon
      :closable="false"
    >
      <template #default>
        <el-button link type="danger" @click="loadFeedback">重试</el-button>
      </template>
    </el-alert>

    <el-card shadow="never" class="list-card">
      <el-table
        :data="items"
        row-key="id"
        stripe
        highlight-current-row
        v-loading="loading"
        class="feedback-table"
        @row-click="openDetail"
      >
        <el-table-column prop="created_at" label="提交时间" width="188">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="消息摘要" min-width="300">
          <template #default="{ row }">
            <span class="message-preview">{{ row.message_preview || '暂无内容' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="平台 / 版本" width="190">
          <template #default="{ row }">
            <div>{{ row.platform || '未知平台' }}</div>
            <div class="muted">{{ row.app_version || '未知版本' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="日志" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.has_logs ? 'success' : 'info'" size="small">
              {{ row.has_logs ? '含日志' : '无日志' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && !loadError && items.length === 0" description="暂无用户反馈" />

      <div v-if="total > 0" class="pagination-wrap">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handlePageChange"
        />
      </div>
    </el-card>

    <el-drawer v-model="drawerVisible" title="反馈详情" size="540px">
      <el-skeleton v-if="detailLoading" :rows="8" animated />
      <el-alert
        v-else-if="detailError"
        type="error"
        :title="detailError"
        show-icon
        :closable="false"
      >
        <template #default>
          <el-button link type="danger" @click="loadDetail(selectedFeedbackId)">重试</el-button>
        </template>
      </el-alert>

      <template v-else-if="detail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="反馈 ID">{{ detail.id }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">{{ formatTime(detail.created_at) }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">设备信息</el-divider>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="平台">{{ detail.platform || '未提供' }}</el-descriptions-item>
          <el-descriptions-item label="应用版本">{{ detail.app_version || '未提供' }}</el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">完整反馈</el-divider>
        <div class="feedback-message">{{ detail.message }}</div>

        <el-divider content-position="left">日志附件</el-divider>
        <el-empty v-if="!detail.attachment" :image-size="64" description="未附加日志" />
        <template v-else>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="文件类型">{{ detail.attachment.extension || 'zip' }}</el-descriptions-item>
            <el-descriptions-item label="文件大小">{{ formatBytes(detail.attachment.size_bytes) }}</el-descriptions-item>
            <el-descriptions-item label="SHA-256">
              <span class="hash-value">{{ detail.attachment.sha256 || '未提供' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="上传时间">{{ formatTime(detail.attachment.created_at) }}</el-descriptions-item>
            <el-descriptions-item label="过期时间">{{ formatTime(detail.attachment.expires_at) }}</el-descriptions-item>
          </el-descriptions>
          <el-alert
            v-if="downloadError"
            class="download-alert"
            type="error"
            :title="downloadError"
            show-icon
            :closable="false"
          />
          <el-button
            class="download-button"
            type="primary"
            :loading="downloading"
            @click="downloadAttachment"
          >
            <el-icon><Download /></el-icon>
            {{ downloading ? '下载中...' : '下载日志' }}
          </el-button>
        </template>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { apiErrorMessage } from '../api/http'
import { downloadFeedbackAttachment, getFeedback, listFeedback } from '../api/feedback'

const items = ref([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const loadError = ref('')

const drawerVisible = ref(false)
const detail = ref(null)
const selectedFeedbackId = ref('')
const detailLoading = ref(false)
const detailError = ref('')
const downloading = ref(false)
const downloadError = ref('')

let listRequestSequence = 0
let detailRequestSequence = 0

onMounted(loadFeedback)

async function loadFeedback() {
  const requestSequence = ++listRequestSequence
  loading.value = true
  loadError.value = ''

  try {
    const data = await listFeedback({
      limit: pageSize.value,
      offset: (currentPage.value - 1) * pageSize.value,
    })
    if (requestSequence !== listRequestSequence) return
    items.value = Array.isArray(data.items) ? data.items : []
    total.value = Number.isFinite(Number(data.total)) ? Number(data.total) : 0
  } catch (error) {
    if (requestSequence !== listRequestSequence) return
    loadError.value = apiErrorMessage(error, '加载用户反馈失败')
  } finally {
    if (requestSequence === listRequestSequence) loading.value = false
  }
}

function handleSizeChange(size) {
  pageSize.value = size
  currentPage.value = 1
  loadFeedback()
}

function handlePageChange(page) {
  currentPage.value = page
  loadFeedback()
}

function openDetail(row) {
  selectedFeedbackId.value = row.id
  drawerVisible.value = true
  loadDetail(row.id)
}

async function loadDetail(feedbackId) {
  if (!feedbackId) return
  const requestSequence = ++detailRequestSequence
  detailLoading.value = true
  detailError.value = ''
  downloadError.value = ''
  detail.value = null

  try {
    const data = await getFeedback(feedbackId)
    if (requestSequence !== detailRequestSequence || selectedFeedbackId.value !== feedbackId) return
    detail.value = data
  } catch (error) {
    if (requestSequence !== detailRequestSequence || selectedFeedbackId.value !== feedbackId) return
    detailError.value = apiErrorMessage(error, '加载反馈详情失败')
  } finally {
    if (requestSequence === detailRequestSequence && selectedFeedbackId.value === feedbackId) {
      detailLoading.value = false
    }
  }
}

async function downloadAttachment() {
  const feedbackId = selectedFeedbackId.value
  if (!feedbackId || !detail.value?.attachment || downloading.value) return

  downloading.value = true
  downloadError.value = ''
  try {
    const response = await downloadFeedbackAttachment(feedbackId)
    if (selectedFeedbackId.value !== feedbackId) return

    const blob = response.data instanceof Blob
      ? response.data
      : new Blob([response.data], { type: 'application/zip' })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = attachmentFilename(response.headers?.['content-disposition'], `feedback-${feedbackId}.zip`)
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  } catch (error) {
    if (selectedFeedbackId.value === feedbackId) {
      downloadError.value = apiErrorMessage(error, '下载日志失败')
    }
  } finally {
    downloading.value = false
  }
}

function attachmentFilename(contentDisposition, fallback) {
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(contentDisposition || '')
  const encodedName = match?.[1] || match?.[2]
  if (!encodedName) return fallback
  try {
    return decodeURIComponent(encodedName)
  } catch {
    return encodedName
  }
}

function formatTime(value) {
  if (!value) return '未提供'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return '未提供'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function statusLabel(status) {
  return { new: '待处理', processing: '处理中', resolved: '已处理' }[status] || status || '未提供'
}
</script>

<style scoped>
.feedback-page {
  min-width: 760px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-header h1 {
  margin: 0;
  font-size: 24px;
  line-height: 32px;
}

.page-count {
  display: inline-block;
  margin-top: 4px;
  color: #909399;
  font-size: 13px;
}

.state-alert {
  margin-bottom: 16px;
}

.list-card {
  min-height: 260px;
}

.feedback-table :deep(.el-table__row) {
  cursor: pointer;
}

.message-preview {
  display: -webkit-box;
  overflow: hidden;
  line-height: 20px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.muted {
  margin-top: 3px;
  color: #909399;
  font-size: 12px;
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  padding-top: 20px;
}

.feedback-message {
  min-height: 96px;
  padding: 14px 16px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  color: #303133;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.hash-value {
  display: inline-block;
  max-width: 100%;
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.download-alert {
  margin-top: 16px;
}

.download-button {
  margin-top: 16px;
}
</style>
