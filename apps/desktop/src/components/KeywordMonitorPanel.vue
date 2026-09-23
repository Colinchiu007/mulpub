<template>
  <div class="cohere-card" style="cursor: default;">
    <!-- Header -->
    <div class="cohere-page-header" style="margin-bottom: var(--space-md);">
      <div style="font-size: var(--font-size-md); font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 8px;">
        <span><el-icon><Search /></el-icon> 关键词监测</span>
      </div>
      <div style="font-size: var(--font-size-sm); color: var(--muted); margin-top: 2px;">6小时轮询，异常飙升通知</div>
    </div>

    <!-- Add keyword -->
    <div style="display: flex; gap: 8px; margin-bottom: var(--space-sm); align-items: center;">
      <input
        v-model="newKeyword"
        class="cohere-input"
        placeholder="输入监测关键词"
        style="flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: 4px; font-size: var(--font-size-sm); outline: none;"
        @keyup.enter="addKeyword"
      />
      <button class="cohere-btn-primary" style="padding: 8px 16px; font-size: var(--font-size-sm); cursor: pointer; border: none; border-radius: 4px;" @click="addKeyword">
        添加
      </button>
    </div>
    <div style="font-size: var(--font-size-xs); color: var(--muted); margin-bottom: var(--space-md);">
      最多 20 个关键词
    </div>

    <!-- Loading：统一骨架屏 -->
    <div v-if="loading" style="padding: 8px 0" data-testid="keyword-monitor-loading">
      <UiSkeleton variant="list" :count="3" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!keywords.length" class="cohere-empty" style="padding: 32px 0; text-align: center;">
      <div style="font-size: var(--font-size-sm); color: var(--muted); margin-bottom: 8px;">尚未添加监测关键词</div>
      <div style="font-size: var(--font-size-sm); color: var(--muted);">输入关键词并点击"添加"开始监测</div>
    </div>

    <!-- Keywords list -->
    <div v-else style="display: flex; flex-direction: column; gap: var(--space-sm);">
      <div
        v-for="(kw, idx) in keywords"
        :key="kw.keyword || idx"
        style="border: 1px solid var(--border); border-radius: 6px; padding: var(--space-md);"
      >
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div style="flex: 1;">
            <!-- Keyword text -->
            <div style="font-weight: 600; font-size: var(--font-size-sm); color: var(--text); margin-bottom: 4px;">{{ kw.keyword }}</div>

            <!-- Status -->
            <div style="display: flex; align-items: center; gap: 12px; font-size: var(--font-size-xs); color: var(--muted); margin-bottom: 4px;">
              <span style="display: flex; align-items: center; gap: 4px;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--cohere-green); display: inline-block;"></span>
                监测中
              </span>
              <span v-if="kw.lastChecked">最后检查: {{ kw.lastChecked }}</span>
              <span v-if="kw.samples !== undefined">采样: {{ kw.samples }} 条</span>
            </div>
          </div>

          <!-- Actions -->
          <div style="display: flex; gap: 6px; flex-shrink: 0;">
            <button class="cohere-btn-ghost" style="padding: 4px 12px; font-size: var(--font-size-xs); cursor: pointer; border: 1px solid var(--border); border-radius: 4px; background: transparent;" @click="openHistory(kw.keyword)">
              查看历史
            </button>
            <button class="cohere-btn-ghost" style="padding: 4px 12px; font-size: var(--font-size-xs); cursor: pointer; border: 1px solid var(--coral); border-radius: 4px; color: var(--coral); background: transparent;" @click="stopKeyword(kw.keyword)">
              停止
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- History Dialog -->
    <UiModal
      :visible="historyVisible" title="监测历史" size="md"
      @close="historyVisible = false">
      <div v-if="historyLoading" style="padding: 8px 0" data-testid="keyword-history-loading">
        <UiSkeleton variant="paragraph" :rows="4" />
      </div>
      <div v-else-if="!historyEntries.length" style="padding: 24px; text-align: center; color: var(--muted); font-size: var(--font-size-sm);">
        暂无历史记录
      </div>
      <div v-else class="cohere-timeline" style="padding: 8px 0;">
        <div
          v-for="(entry, i) in historyEntries"
          :key="i"
          class="cohere-timeline-item"
          style="position: relative; padding-left: 20px; border-left: 2px solid var(--border); margin-bottom: var(--space-md); padding-bottom: var(--space-sm);"
        >
          <div style="font-size: var(--font-size-xs); color: var(--muted); margin-bottom: 4px;">{{ entry.checkedAt }}</div>
          <div style="display: flex; gap: 16px; font-size: var(--font-size-sm); color: var(--text);">
            <span>总提及: <strong>{{ entry.totalMentions ?? entry.total ?? 0 }}</strong></span>
            <span>最高互动: <strong>{{ entry.topEngagement ?? 0 }}</strong></span>
          </div>
        </div>
      </div>
    </UiModal>

    <div class="cohere-divider" style="margin: var(--space-sm) 0 0;"></div>
  </div>
</template>

<script setup>
import { Search } from '@element-plus/icons-vue'
import UiModal from "../components/UiModal.vue";
import { ref, onMounted } from 'vue'
import { keywordStatus, keywordStart, keywordStop, keywordHistory } from '@/api/publisher'
// eslint-disable-next-line no-unused-vars
import { ElMessage, ElDialog } from 'element-plus'
import { formatUserError } from '@/utils/user-facing-error'

const newKeyword = ref('')
const keywords = ref([])
const loading = ref(false)

const historyVisible = ref(false)
const historyLoading = ref(false)
const historyEntries = ref([])
const historyKeyword = ref('')

async function loadStatus() {
  loading.value = true
  try {
    const result = await keywordStatus()
    if (result?.code === 0 && result?.data) {
      keywords.value = result.data
    }
  } catch (err) {
    ElMessage.error('获取监测状态失败: ' + formatUserError(err, { fallback: '未知错误' }).message)
  } finally {
    loading.value = false
  }
}

async function addKeyword() {
  const kw = newKeyword.value.trim()
  if (!kw) {
    ElMessage.warning('请输入关键词')
    return
  }
  if (keywords.value.length >= 20) {
    ElMessage.warning('最多添加 20 个关键词')
    return
  }
  if (keywords.value.some(k => k.keyword === kw)) {
    ElMessage.warning('该关键词已在监测列表中')
    return
  }

  try {
    const result = await keywordStart(kw, { interval: 6, threshold: 50 })
    if (result?.code === 0) {
      ElMessage.success('已添加监测: ' + kw)
      newKeyword.value = ''
      await loadStatus()
    } else {
      ElMessage.error(formatUserError(result, { fallback: '添加失败' }).message)
    }
  } catch (err) {
    ElMessage.error('添加失败: ' + formatUserError(err, { fallback: '未知错误' }).message)
  }
}

async function stopKeyword(kw) {
  try {
    const result = await keywordStop(kw)
    if (result?.code === 0) {
      ElMessage.success('已停止监测: ' + kw)
      await loadStatus()
    } else {
      ElMessage.error(formatUserError(result, { fallback: '停止失败' }).message)
    }
  } catch (err) {
    ElMessage.error('停止失败: ' + formatUserError(err, { fallback: '未知错误' }).message)
  }
}

async function openHistory(kw) {
  historyKeyword.value = kw
  historyVisible.value = true
  historyLoading.value = true
  historyEntries.value = []
  try {
    const result = await keywordHistory(kw)
    if (result?.code === 0 && result?.data) {
      historyEntries.value = result.data
    }
  } catch (err) {
    ElMessage.error('获取历史失败: ' + formatUserError(err, { fallback: '未知错误' }).message)
  } finally {
    historyLoading.value = false
  }
}

onMounted(() => {
  loadStatus()
})
</script>

<style scoped>
.cohere-card {
  background: var(--card-bg);
  border-radius: 8px;
  padding: var(--space-xl);
}

.cohere-input:focus {
  border-color: var(--action-blue) !important;
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.15);
}
</style>
