<template>
  <div class="page">
    <h1 style="margin-bottom: 16px">版本发布策略</h1>
    <el-card shadow="never" style="max-width: 640px">
      <el-form label-width="120px">
        <el-form-item label="启用策略">
          <el-switch v-model="form.enabled" />
          <div class="hint">关闭后桌面端走默认更新流程（不强制、不灰度）。</div>
        </el-form-item>
        <el-form-item label="最低版本">
          <el-input v-model="form.min_version" placeholder="如 2.3.50，低于此版本时提示升级（可空）" />
        </el-form-item>
        <el-form-item label="强制版本">
          <el-input v-model="form.force_version" placeholder="如 2.3.53，低于此版本时强制升级（可空）" />
          <div class="hint">强制版本不能低于最低版本。</div>
        </el-form-item>
        <el-form-item label="灰度比例">
          <el-slider v-model="form.gray_ratio" :min="0" :max="100" show-input />
          <div class="hint">0-100；100=全量，小于 100 时桌面端按概率跳过更新检查。强制版本不受灰度限制。</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" maxlength="200" />
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
import { getUpdatePolicy, putUpdatePolicy } from '../api/runtimePolicy'

const form = ref({ min_version: '', force_version: '', gray_ratio: 100, enabled: false, note: '' })
const saving = ref(false)

async function load() {
  const data = await getUpdatePolicy()
  if (data) {
    form.value = { min_version: data.min_version || '', force_version: data.force_version || '', gray_ratio: data.gray_ratio ?? 100, enabled: !!data.enabled, note: data.note || '' }
  }
}

async function save() {
  saving.value = true
  try {
    await putUpdatePolicy({ ...form.value, enabled: !!form.value.enabled })
    ElMessage.success('已保存')
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
