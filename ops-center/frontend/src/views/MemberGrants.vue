<template>
  <div>
    <h1 style="margin-bottom:16px">会员权益开通</h1>
    <el-form :model="form" label-width="120px" style="max-width:560px">
      <el-form-item label="用户 ID">
        <el-input v-model="form.userId" placeholder="业务用户 id（Logto 控制台 / 兑换记录可查）" clearable />
      </el-form-item>
      <el-form-item label="套餐">
        <el-select v-model="form.plan" style="width:100%">
          <el-option label="标准版 standard" value="standard" />
          <el-option label="专业版 pro" value="pro" />
        </el-select>
      </el-form-item>
      <el-form-item label="时长（天）">
        <el-input-number v-model="form.durationDays" :min="1" :max="3650" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="submitting" data-testid="member-grant-submit" @click="submit">开通权益</el-button>
      </el-form-item>
    </el-form>
    <el-alert
      v-if="lastResult" type="success" show-icon :closable="false"
      :title="`已开通：${lastResult.plan}（订单 ${lastResult.order?.id || '—'}）`"
      style="max-width:560px"
    />
    <p style="color:var(--el-text-color-secondary);font-size:var(--font-size-sm);margin-top:12px;max-width:560px">
      开通将记入订单（channel=admin_grant、金额 0），并向用户消息中心推送通知；自动续费开关由服务端订阅表统一管理。
      需后端已配置 engine 管理服务（OPS_ENGINE_ADMIN_BASE_URL / OPS_ENGINE_ADMIN_TOKEN），未配置时返回 503。
    </p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { grantMemberPlan } from '../api/memberGrant'

const form = ref({ userId: '', plan: 'standard', durationDays: 30 })
const submitting = ref(false)
const lastResult = ref(null)

async function submit() {
  submitting.value = true
  try {
    const data = await grantMemberPlan({ ...form.value })
    lastResult.value = data
    ElMessage.success('权益开通成功')
    form.value.userId = ''
  } catch (e) {
    ElMessage.error(e.response?.data?.detail || '开通失败，请检查 engine 管理服务配置或用户 ID')
  } finally {
    submitting.value = false
  }
}
</script>
