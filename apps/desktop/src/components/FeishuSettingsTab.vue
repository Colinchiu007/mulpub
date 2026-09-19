<template>
  <div class="feishu-settings">
    <div style="margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:8px">{{ t('knowledgeBase.feishuApi') }}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">{{ t('knowledgeBase.feishuInstructions') }}</div>
    </div>
    <div class="cohere-form-item">
      <label class="cohere-form-label">{{ t('knowledgeBase.feishuAppId') }}</label>
      <input v-model="appId" class="cohere-input" placeholder="cli_xxxxxxxx" />
    </div>
    <div class="cohere-form-item">
      <label class="cohere-form-label">{{ t('knowledgeBase.feishuAppSecret') }}</label>
      <div style="display:flex;gap:8px">
        <input :type="showSecret ? 'text' : 'password'" v-model="appSecret" class="cohere-input" style="flex:1" placeholder="••••••••" />
        <button class="cohere-btn-ghost" style="font-size:12px;padding:4px 8px" @click="showSecret = !showSecret">{{ showSecret ? t('knowledgeBase.feishuHide') : t('knowledgeBase.feishuShow') }}</button>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="cohere-btn-secondary" @click="testConnection" :disabled="testing || !appId || !appSecret">
        {{ testing ? t('knowledgeBase.feishuTesting') : t('knowledgeBase.feishuTestConnection') }}
      </button>
      <button class="cohere-btn-primary" @click="saveConfig" :disabled="saving || !appId || !appSecret">
        {{ saving ? t('knowledgeBase.feishuSaving') : t('knowledgeBase.feishuSaveConfig') }}
      </button>
    </div>
    <div v-if="statusMsg" style="margin-top:8px;padding:6px 10px;border-radius:4px;font-size:12px" :style="{ color: statusOk ? '#67c23a' : '#d32f2f', background: statusOk ? '#f0f9eb' : '#fff3f3' }">
      {{ statusMsg }}
    </div>
    <div style="margin-top:24px;padding:12px;background:var(--soft-stone);border-radius:8px;font-size:12px;color:var(--muted);line-height:1.8">
      <div style="font-weight:600;margin-bottom:4px;color:var(--text-primary)">{{ t('knowledgeBase.feishuInstructions') }}：</div>
      <div>{{ t('knowledgeBase.feishuInstrLine1') }}</div>
      <div>{{ t('knowledgeBase.feishuInstrLine2') }}</div>
      <div>{{ t('knowledgeBase.feishuInstrLine3') }}</div>
      <div>{{ t('knowledgeBase.feishuInstrLine4') }}</div>
      <div>{{ t('knowledgeBase.feishuInstrLine5') }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi } from '@/api/electron-bridge'

const { t } = useI18n()
const appId = ref('')
const appSecret = ref('')
const showSecret = ref(false)
const testing = ref(false)
const saving = ref(false)
const statusMsg = ref('')
const statusOk = ref(true)

onMounted(async () => {
  const api = getApi()
  if (api && api.feishuGetConfig) {
    const res = await api.feishuGetConfig()
    if (res && res.code === 0 && res.data) {
      appId.value = res.data.appId || ''
    }
  }
})

async function testConnection() {
  testing.value = true
  statusMsg.value = ''
  try {
    const api = getApi()
    if (api && api.feishuTestConnection) {
      const res = await api.feishuTestConnection(appId.value, appSecret.value)
      if (res && res.code === 0 && res.data && res.data.ok) {
        statusMsg.value = t('knowledgeBase.feishuTestSuccess') + ' ✅'
        statusOk.value = true
      } else {
        statusMsg.value = t('knowledgeBase.feishuTestFailed') + ': ' + ((res && res.message) || '')
        statusOk.value = false
      }
    }
  } catch (e) {
    statusMsg.value = t('knowledgeBase.feishuTestFailed') + ': ' + (e.message || '')
    statusOk.value = false
  } finally {
    testing.value = false
  }
}

async function saveConfig() {
  saving.value = true
  statusMsg.value = ''
  try {
    const api = getApi()
    if (api && api.feishuSaveConfig) {
      const res = await api.feishuSaveConfig(appId.value, appSecret.value)
      if (res && res.code === 0) {
        statusMsg.value = t('knowledgeBase.feishuSaveSuccess') + ' ✅'
        statusOk.value = true
      } else {
        statusMsg.value = (res && res.message) || t('knowledgeBase.loadFailed')
        statusOk.value = false
      }
    }
  } catch (e) {
    statusMsg.value = (e.message) || t('knowledgeBase.loadFailed')
    statusOk.value = false
  } finally {
    saving.value = false
  }
}
</script>

