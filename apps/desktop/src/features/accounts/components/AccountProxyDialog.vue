<template>
  <UiModal :visible="visible" title="账号代理" size="sm" @close="$emit('close')">
    <div class="proxy-form">
      <div v-if="account?.proxy?.configured" class="proxy-status" role="status">
        <span>当前 {{ proxyDescription }}</span>
      </div>
      <UiSelect
        v-model="type"
        label="代理类型"
        :options="proxyTypes"
      />
      <UiInput
        v-model="host"
        data-testid="proxy-host"
        label="代理地址"
        :placeholder="hostPlaceholder"
      />
      <UiInput
        v-model="port"
        data-testid="proxy-port"
        label="端口"
        inputmode="numeric"
        placeholder="例如 8080"
      />
      <UiInput
        v-model="username"
        data-testid="proxy-username"
        label="用户名（可选）"
        autocomplete="off"
      />
      <UiInput
        v-model="password"
        data-testid="proxy-password"
        label="密码（可选）"
        type="password"
        autocomplete="new-password"
      />
      <p v-if="validationError" class="validation-error" role="alert">{{ validationError }}</p>
    </div>
    <template #footer>
      <UiButton variant="ghost" @click="$emit('close')">取消</UiButton>
      <UiButton
        v-if="account?.proxy?.configured"
        data-testid="proxy-clear"
        variant="danger"
        :disabled="busy"
        @click="$emit('clear')"
      >
        清除
      </UiButton>
      <UiButton data-testid="proxy-save" :disabled="busy" @click="save">
        {{ busy ? '正在保存...' : '保存' }}
      </UiButton>
    </template>
  </UiModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import UiButton from '@/components/UiButton.vue'
import UiInput from '@/components/UiInput.vue'
import UiModal from '@/components/UiModal.vue'
import UiSelect from '@/components/UiSelect.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  account: { type: Object, default: null },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['save', 'clear', 'close'])
const proxyTypes = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socks5', label: 'SOCKS5' },
]
const type = ref('http')
const host = ref('')
const port = ref('')
const username = ref('')
const password = ref('')
const validationError = ref('')

const proxyDescription = computed(() => {
  const proxy = props.account?.proxy
  if (!proxy?.configured) return ''
  return `${String(proxy.type || 'http').toUpperCase()} ${proxy.hostMasked || ''}${proxy.port ? `:${proxy.port}` : ''}`
})

const hostPlaceholder = computed(() => {
  const maskedHost = props.account?.proxy?.hostMasked
  return maskedHost ? `当前 ${maskedHost}，请输入完整地址以替换` : '例如 127.0.0.1 或 proxy.example.com'
})

function resetForm () {
  type.value = props.account?.proxy?.type || 'http'
  host.value = ''
  port.value = props.account?.proxy?.port ? String(props.account.proxy.port) : ''
  username.value = ''
  password.value = ''
  validationError.value = ''
}

watch(() => [props.visible, props.account?.id], resetForm, { immediate: true })

function save () {
  const normalizedHost = host.value.trim()
  const normalizedPort = Number(port.value)
  if (!normalizedHost || !Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    validationError.value = '请填写有效的代理地址和端口'
    return
  }
  if (Boolean(username.value) !== Boolean(password.value)) {
    validationError.value = '用户名和密码需要同时填写'
    return
  }
  validationError.value = ''
  const proxy = { host: normalizedHost, port: normalizedPort, type: type.value }
  if (username.value) {
    proxy.username = username.value
    proxy.password = password.value
  }
  emit('save', proxy)
}
</script>

<style scoped>
.proxy-form { display: flex; flex-direction: column; gap: 2px; }
.proxy-status { padding: 8px 10px; border: 1px solid #d9e8e0; border-radius: 5px; background: #f3faf6; color: #287154; font-size: 12px; }
.validation-error { margin: 0; color: #c43d4d; font-size: 12px; }
</style>
