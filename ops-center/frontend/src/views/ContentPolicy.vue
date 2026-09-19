<template>
  <div class="page">
    <h1 style="margin-bottom: 16px">内容安全策略（敏感词库）</h1>
    <el-card shadow="never" style="max-width: 720px">
      <el-form label-width="120px">
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
          <div class="hint">启用后桌面端 SensitiveFilter 使用「内置词库 + 本词库」；关闭后仅内置词库。</div>
        </el-form-item>
        <el-form-item label="策略名称">
          <el-input v-model="form.name" maxlength="100" />
        </el-form-item>
        <el-form-item label="敏感词">
          <el-input v-model="wordsText" type="textarea" :rows="10" placeholder="每行一个敏感词，保存时去重；最多 5000 个" />
          <div class="hint">建议用「隔字/谐音变体」也单独成行。发布到各平台前会先检测并替换。</div>
        </el-form-item>
        <el-form-item label="替换串">
          <el-input v-model="form.replacement" maxlength="16" placeholder="默认 ***" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getContentPolicy, putContentPolicy } from '../api/runtimePolicy'

const form = ref({ name: '默认内容安全策略', word_list: [], replacement: '***', enabled: false })
const wordsText = ref('')
const saving = ref(false)

async function load() {
  const data = await getContentPolicy()
  if (data) {
    form.value = { name: data.name || '默认内容安全策略', word_list: data.word_list || [], replacement: data.replacement || '***', enabled: !!data.enabled }
    wordsText.value = (data.word_list || []).join('\n')
  }
}

async function save() {
  const words = wordsText.value.split('\n').map(s => s.trim()).filter(Boolean)
  saving.value = true
  try {
    await putContentPolicy({ ...form.value, word_list: words, enabled: !!form.value.enabled })
    ElMessage.success(`已保存（${words.length} 个词）`)
    await load()
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.hint { font-size: 12px; color: #999; margin-top: 4px; line-height: 1.5; }
</style>
