<template>
  <UiModal :visible="visible" title="账号代理" size="sm" @close="$emit('close')">
    <div class="proxy-form">
      <!-- 三个互斥态，顺序即优先级：读取中 > 读取失败 > 已配置。
           列表接口已不再返回 proxy，所以"打开弹窗"必定先经过一次惰性读取；
           缺了前两态，用户会先看到「当前未配置代理」的假象再被数据填上。 -->
      <div v-if="loading" class="proxy-loading" role="status" data-testid="proxy-loading">
        {{ t('accountsPage.proxyLoading') }}
      </div>
      <div v-else-if="loadError" class="proxy-load-error" role="alert" data-testid="proxy-load-error">
        <span class="proxy-load-error-text">{{ loadError }}</span>
        <button type="button" class="proxy-retry" data-testid="proxy-retry" @click="$emit('retry')">
          {{ t('accountsPage.proxyRetry') }}
        </button>
      </div>
      <div v-else-if="account?.proxy?.configured" class="proxy-status" role="status">
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
        :disabled="busy || loading"
        @click="$emit('clear')"
      >
        清除
      </UiButton>
      <!-- 读取中禁用保存：此刻 proxyAccount 还是占位值，保存/清除都以它为参数。
           读取**失败**不禁用 —— 用户仍可填一份新代理直接保存。 -->
      <UiButton data-testid="proxy-save" :disabled="busy || loading" @click="save">
        {{ busy ? '正在保存...' : '保存' }}
      </UiButton>
    </template>
  </UiModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from '@/components/UiButton.vue'
import UiInput from '@/components/UiInput.vue'
import UiModal from '@/components/UiModal.vue'
import UiSelect from '@/components/UiSelect.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  account: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  // 惰性读取态：代理状态由 account:get-proxy 在弹窗打开时按需拉取，
  // 这两个 prop 承载"正在读"与"读失败（可重试）"，由父组件 Accounts.vue 驱动。
  loading: { type: Boolean, default: false },
  loadError: { type: String, default: '' },
})

const { t } = useI18n()

const emit = defineEmits(['save', 'clear', 'close', 'retry'])
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
// 「当前代理」的预填只做一次（见下方 watch）：惰性读取是先占位后到值，
// 用这个闸把"数据到达"与"用户输入"区分开，避免覆盖用户已敲的内容。
const prefilled = ref(false)

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

// 打开弹窗（或换账号）⇒ 重置表单。
// ⛔ 两处都是踩过的坑，别改回去：
//  ① 依赖**必须是原始值拼成的字符串**，不能写成 `() => [props.visible, props.account?.id]`。
//     数组 getter 每次依赖失效都会返回**新数组**，watch 用 `Object.is` 比较必然不相等，
//     于是"父组件换了一个 account 对象"（惰性读到数据后正是这么做的，id 并未变）
//     也会触发 resetForm —— 把用户在读取窗口里已经敲进去的内容清掉。
//     实测：改成数组后本文件的「只预填一次，不覆盖用户已输入的内容」当场变红。
//  ② `props.account?.proxy` **不能**进这个依赖，同理会在数据到达时再重置一次。
watch(() => `${props.visible}|${props.account?.id || ''}`, () => {
  prefilled.value = false
  resetForm()
}, { immediate: true })

// 惰性读到的「当前代理」到达时**只做预填**，且只填一次（prefilled 闸）。
// 依赖 `props.account.proxy` 的**对象引用**变化：Accounts.vue 用一个新对象承载
// 读到结果，所以这一步恰好触发一次；用户手动改过的字段不会再被覆盖。
watch(() => props.account?.proxy, (proxy) => {
  if (prefilled.value || !proxy?.configured) return
  prefilled.value = true
  type.value = proxy.type || 'http'
  port.value = proxy.port ? String(proxy.port) : ''
}, { immediate: true })

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
.proxy-status { padding: 8px 10px; border: 1px solid #d9e8e0; border-radius: 5px; background: #f3faf6; color: #287154; font-size: var(--font-size-xs); }
.proxy-loading { padding: 8px 10px; border: 1px solid #e3e6ef; border-radius: 5px; background: #f7f8fb; color: var(--text-secondary, #5b6172); font-size: var(--font-size-xs); }
.proxy-load-error { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border: 1px solid #f0d4d8; border-radius: 5px; background: #fdf5f6; color: #c43d4d; font-size: var(--font-size-xs); }
.proxy-load-error-text { flex: 1 1 auto; min-width: 0; }
.proxy-retry { flex: 0 0 auto; padding: 2px 8px; border: 1px solid currentColor; border-radius: 4px; background: transparent; color: inherit; font-size: var(--font-size-xs); cursor: pointer; }
.proxy-retry:hover { background: rgba(196, 61, 77, 0.08); }
.validation-error { margin: 0; color: #c43d4d; font-size: var(--font-size-xs); }
</style>
