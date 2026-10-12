<template>
  <div class="change-password-page">
    <el-card shadow="never" class="cp-card">
      <template #header>
        <div class="cp-header">
          <span>更改密码</span>
          <el-tag v-if="authStore.username" type="info" size="small">
            当前账号：{{ authStore.username }}
          </el-tag>
        </div>
      </template>

      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="cp-notice"
        title="改密成功后，当前登录状态会立即失效，需要使用新密码重新登录。"
      />

      <!-- 成功态：整块替换表单（改密后会话已作废，继续留在表单里只会误导） -->
      <div v-if="succeeded" class="cp-success">
        <el-result icon="success" title="密码已更新" sub-title="请使用新密码重新登录。">
          <template #extra>
            <el-button type="primary" :loading="redirecting" @click="goLogin">
              前往登录页
            </el-button>
          </template>
        </el-result>
      </div>

      <el-form
        v-else
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="110px"
        @submit.prevent="submit"
      >
        <el-form-item label="当前密码" prop="oldPassword">
          <el-input
            v-model="form.oldPassword"
            type="password"
            show-password
            autocomplete="current-password"
            placeholder="请输入当前使用的密码"
            :disabled="submitting"
          />
        </el-form-item>

        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="form.newPassword"
            type="password"
            show-password
            autocomplete="new-password"
            placeholder="至少 8 位，勿用常见弱口令"
            :disabled="submitting"
          />
          <div class="cp-hint">
            至少 8 位；不得使用 admin123、password、123456 等常见弱口令；不能与当前密码相同。
          </div>
        </el-form-item>

        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            show-password
            autocomplete="new-password"
            placeholder="请再次输入新密码"
            :disabled="submitting"
            @keyup.enter="submit"
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="submitting" @click="submit">
            确认修改
          </el-button>
          <el-button :disabled="submitting" @click="resetForm">重置</el-button>
        </el-form-item>

        <el-alert
          v-if="errorMessage"
          type="error"
          :closable="false"
          show-icon
          :title="errorMessage"
          class="cp-error"
        />
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { changePassword } from '../api/changePassword'
import { apiErrorMessage } from '../api/http'

const router = useRouter()
const authStore = useAuthStore()

const formRef = ref(null)
const submitting = ref(false)
const succeeded = ref(false)
const redirecting = ref(false)
const errorMessage = ref('')

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

// 前端只做「能在本机判定的」校验（非空 / 长度 / 两次一致 / 与原密码相同）。
// 弱口令表与强度判据以后端为准（services.auth_service.validate_new_password 复用
// config._validate_admin_password）—— 前端再写一份弱口令表必然与后端漂移。
const rules = {
  oldPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '新密码至少 8 位', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value && value === form.oldPassword) {
          callback(new Error('新密码不能与当前密码相同'))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value !== form.newPassword) {
          callback(new Error('两次输入的新密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
}

function resetForm() {
  form.oldPassword = ''
  form.newPassword = ''
  form.confirmPassword = ''
  errorMessage.value = ''
  formRef.value?.clearValidate?.()
}

async function goLogin() {
  redirecting.value = true
  // 会话已被服务端作废：清掉内存态再跳登录页，避免路由守卫用旧态误判已登录
  await authStore.logout()
  router.push('/login')
}

async function submit() {
  errorMessage.value = ''
  const valid = await formRef.value?.validate?.().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    await changePassword({
      old_password: form.oldPassword,
      new_password: form.newPassword,
      confirm_password: form.confirmPassword,
    })
    succeeded.value = true
  } catch (e) {
    // 429（改密尝试过多）与 400/401 都直接展示后端 detail；
    // 传输层失败由 apiErrorMessage 给出可操作提示。
    errorMessage.value = apiErrorMessage(e, '修改密码失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.change-password-page {
  max-width: 640px;
}
.cp-card {
  margin-top: 8px;
}
.cp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cp-notice {
  margin-bottom: 18px;
}
.cp-hint {
  margin-top: 6px;
  font-size: var(--font-size-sm, 12px);
  color: var(--color-text-secondary);
  line-height: 1.6;
}
.cp-error {
  margin-top: 4px;
}
</style>
