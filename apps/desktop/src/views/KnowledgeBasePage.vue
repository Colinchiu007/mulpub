<template>
  <div class="cohere-page">
    <div class="cohere-page-header">
      <div>
        <div class="page-title">{{ t('knowledgeBase.title') }}</div>
        <div class="page-subtitle">{{ subtitleText }}</div>
      </div>
      <div class="page-actions" style="display:flex;gap:8px">
        <button v-if="activeTab === 'viral'" class="cohere-btn-primary" @click="showViralForm = true">＋ {{ t('knowledgeBase.addViral') }}</button>
        <button v-if="activeTab === 'personal'" class="cohere-btn-primary" @click="showPersonalForm = true">＋ {{ t('knowledgeBase.addPersonal') }}</button>
        <button v-if="activeTab === 'personal'" class="cohere-btn-secondary" @click="triggerBatchImport">📁 {{ t('knowledgeBase.batchImport') }}</button>
        <button class="cohere-btn-secondary" @click="handleExport">🪶 {{ t('knowledgeBase.exportToFeishu') }}</button>
      </div>
    </div>

    <div class="cohere-content">
      <div class="kb-tabs" style="display:flex;gap:4px;margin-bottom:16px;background:var(--soft-stone,#f5f5f5);border-radius:8px;padding:3px">
        <button class="kb-tab-btn" :class="{ active: activeTab === 'viral' }" @click="activeTab = 'viral'">{{ t('knowledgeBase.tabViral') }}</button>
        <button v-if="activeTab === 'viral' || activeTab === 'pattern'" class="kb-tab-btn" :class="{ active: activeTab === 'pattern' }" @click="activeTab = 'pattern'">{{ t('knowledgeBase.tabPattern') }}</button>
        <button class="kb-tab-btn" :class="{ active: activeTab === 'personal' }" @click="activeTab = 'personal'">{{ t('knowledgeBase.tabPersonal') }}</button>
      </div>

      <ViralLibraryTable v-if="activeTab === 'viral'" ref="viralRef" @create="showViralForm = true" />
      <PatternAnalysisPanel v-if="activeTab === 'pattern'" ref="patternRef" />
      <PersonalKnowledgePanel v-if="activeTab === 'personal'" ref="personalRef" @create="showPersonalForm = true" />

      <ViralFormDialog v-if="showViralForm" :item="editingViral" @close="showViralForm = false; editingViral = null" @saved="onViralSaved" />
      <PersonalFormDialog v-if="showPersonalForm" :item="editingPersonal" @close="showPersonalForm = false; editingPersonal = null" @saved="onPersonalSaved" />

      <input ref="fileInput" type="file" multiple accept=".txt,.md,.doc,.docx" style="display:none" @change="onFilesSelected" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { formatUserError } from '@/utils/user-facing-error'
import { importFiles, exportViralToFeishu, exportPersonalToFeishu } from '@/api/knowledge-library'
import { getApi } from '@/api/electron-bridge'
import ViralLibraryTable from '@/components/ViralLibraryTable.vue'
import PatternAnalysisPanel from '@/components/PatternAnalysisPanel.vue'
import PersonalKnowledgePanel from '@/components/PersonalKnowledgePanel.vue'
import ViralFormDialog from '@/components/ViralFormDialog.vue'
import PersonalFormDialog from '@/components/PersonalFormDialog.vue'

const { t } = useI18n()
const activeTab = ref('viral')
const showViralForm = ref(false)
const showPersonalForm = ref(false)
const editingViral = ref(null)
const editingPersonal = ref(null)
const viralRef = ref(null)
const patternRef = ref(null)
const subtitleText = computed(() => {
  if (activeTab.value === 'viral') return t('knowledgeBase.viralSubtitle')
  if (activeTab.value === 'pattern') return t('knowledgeBase.patternSubtitle')
  return t('knowledgeBase.personalSubtitle')
})
const personalRef = ref(null)
const fileInput = ref(null)

function onViralSaved() {
  showViralForm.value = false
  editingViral.value = null
  viralRef.value?.loadData()
}

function onPersonalSaved() {
  showPersonalForm.value = false
  editingPersonal.value = null
  personalRef.value?.loadData()
}

function triggerBatchImport() {
  fileInput.value?.click()
}

async function onFilesSelected(e) {
  const files = e.target.files
  if (!files || !files.length) return
  const filePaths = []
  for (const f of files) {
    if (f.size > 5 * 1024 * 1024) {
      ElMessage.warning(t('knowledgeBase.fileTooLarge', { name: f.name }))
      fileInput.value.value = ''
      return
    }
    // File 对象跨 contextBridge 后路径会丢失；经 getPathForFile 拿到真实路径
    const fp = typeof getApi()?.getPathForFile === 'function'
      ? await getApi().getPathForFile(f)
      : (f.path || '')
    if (!fp) {
      ElMessage.warning(t('knowledgeBase.importFailed'))
      fileInput.value.value = ''
      return
    }
    filePaths.push(fp)
  }
  if (filePaths.length === 0) return
  const categoryPerFile = new Array(filePaths.length).fill('personal_stories')
  try {
    const res = await importFiles(filePaths, categoryPerFile)
    if (res && res.code === 0 && res.data) {
      const { total, results } = res.data
      const succeeded = results.filter(r => r.ok).length
      const failed = results.filter(r => r.error).length
      let msg = t('knowledgeBase.importResult', { total, succeeded, failed })
      if (failed > 0) {
        // 逐文件错误经 formatUserError 归一化（i18n + 友好度），文件路径仅保留文件名避免泄露本机绝对路径
        const errors = results.filter(r => r.error).map(r => {
          const name = String(r.path || '').split(/[\\/]/).pop() || t('knowledgeBase.importFailed')
          return name + ': ' + formatUserError({ message: String(r.error) }, { fallback: t('knowledgeBase.importFailed') }).message
        }).join('; ')
        msg += '\n' + errors
      }
      if (failed > 0) ElMessage.warning(msg)
      else ElMessage.success(msg)
      personalRef.value?.loadData()
    } else {
      // 业务错误 resolve 分支同样走 formatUserError（i18n + 友好度强制，禁止原始技术消息直出）
      ElMessage.error(formatUserError(res || {}, { fallback: t('knowledgeBase.importFailed') }).message)
    }
  } catch (err) {
    ElMessage.error(formatUserError(err, { fallback: t('knowledgeBase.importFailed') }).message)
  } finally {
    fileInput.value.value = ''
  }
}

async function handleExport() {
  const title = prompt(t('knowledgeBase.exportTitlePrompt'), t('knowledgeBase.exportTitleDefault'))
  if (!title) return
  try {
    let res
    if (activeTab.value === 'viral') {
      res = await exportViralToFeishu(title)
    } else {
      res = await exportPersonalToFeishu(title)
    }
    if (res && res.code === 0 && res.data) {
      const { docId, count } = res.data
      ElMessage.success(t('knowledgeBase.exportSuccess', { docId, count }))
    } else {
      ElMessage.error((res && res.message) || t('knowledgeBase.exportFailed'))
    }
  } catch (e) {
    ElMessage.error(t('knowledgeBase.exportFailed'))
  }
}
</script>

<style scoped>
.cohere-page { padding: 0; }
.cohere-page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--surface, #fff);
}
.page-title { font-size: 18px; font-weight: 600; color: var(--text-primary); }
.page-subtitle { font-size: 12px; color: var(--muted); margin-top: 2px; }
.cohere-btn-primary {
  padding: 8px 16px;
  background: var(--coral, #f56c6c);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.cohere-btn-secondary {
  padding: 8px 16px;
  background: var(--soft-stone, #f5f5f5);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.cohere-content { padding: 12px 20px; }
.kb-tab-btn {
  flex: 1;
  padding: 8px 16px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: var(--muted);
  transition: all 0.15s;
}
.kb-tab-btn.active {
  background: var(--surface, #fff);
  color: var(--text-primary);
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
</style>
