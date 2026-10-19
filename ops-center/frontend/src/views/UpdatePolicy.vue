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
        <el-divider content-position="left">强制升级阻断（重大版本安全机制）</el-divider>
        <el-form-item label="阻断开关">
          <el-switch v-model="form.enforce_enabled" />
          <div class="hint warn" v-if="form.enforce_enabled">⚠ 已启用：低于阻断版本的客户端将在启动/登录时被弹窗阻断，仅可点击升级。</div>
        </el-form-item>
        <el-form-item label="阻断版本">
          <el-input v-model="form.enforce_min_version" placeholder="如 0.2.0，低于此版本的客户端将被硬阻断（可空）" />
          <div class="hint">低于此版本的客户端启动/登录时被阻断，仅可升级；不影响上方提示/强制/灰度逻辑，也不受灰度影响（阻断全员一致）。启用前须已配置最低提示版本或强制下载版本作为上界（min_version 为空时以 force_version 为上界；两者全空会被拒绝）。启用前请确认新版本已发布且可用；应急解锁 = 关闭上方阻断开关。</div>
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
import { ElMessage, ElMessageBox } from 'element-plus'
import { getUpdatePolicy, putUpdatePolicy } from '../api/runtimePolicy'

const form = ref({ min_version: '', force_version: '', gray_ratio: 100, enforce_min_version: '', enforce_enabled: false, enabled: false, note: '' })
const saving = ref(false)

async function load() {
  const data = await getUpdatePolicy()
  if (data) {
    form.value = {
      min_version: data.min_version || '',
      force_version: data.force_version || '',
      gray_ratio: data.gray_ratio ?? 100,
      enforce_min_version: data.enforce_min_version || '',
      enforce_enabled: !!data.enforce_enabled,
      enabled: !!data.enabled,
      note: data.note || '',
    }
  }
}

async function save() {
  // 启用阻断前二次确认（防误配把全员锁死）
  if (form.value.enforce_enabled && form.value.enforce_min_version) {
    try {
      await ElMessageBox.confirm(
        `低于 ${form.value.enforce_min_version} 的所有客户端将被弹窗阻断、仅可升级。确认已发布可用的新版本？`,
        '启用强制升级阻断',
        { confirmButtonText: '确认启用', cancelButtonText: '取消', type: 'warning' },
      )
    } catch {
      return
    }
  }
  saving.value = true
  try {
    await putUpdatePolicy({ ...form.value, enabled: !!form.value.enabled, enforce_enabled: !!form.value.enforce_enabled })
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
.hint { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: 4px; line-height: 1.5; }
.hint.warn { color: var(--el-color-warning); }
</style>
