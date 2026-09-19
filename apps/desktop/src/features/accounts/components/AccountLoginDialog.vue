<template>
  <UiModal :visible="props.visible" :title="t('accountsPage.addAccount')" size="sm" @close="$emit('close')">
    <div class="login-form">
      <label class="field-label">{{ t('accountsPage.platform') }}</label>
      <UiSelect
        :model-value="props.modelValue"
        :label="t('accountsPage.selectPlatformLabel')"
        :placeholder="t('accountsPage.selectPlatform')"
        :options="props.platforms.map(item => ({ value: item.id, label: item.label }))"
        @update:model-value="$emit('update:modelValue', $event)"
      />

      <label class="field-label">{{ t('accountsPage.loginMethod') }}</label>
      <div class="mode-control" role="group" :aria-label="t('accountsPage.loginMethod')">
        <button
          type="button"
          :class="{ active: props.mode === 'browser' }"
          data-testid="mode-browser"
          @click="$emit('update:mode', 'browser')"
        >
          <Monitor />{{ t('accountsPage.browserLogin') }}
        </button>
        <button
          type="button"
          :class="{ active: props.mode === 'qrcode' }"
          :disabled="!qrLoginEnabled"
          data-testid="mode-qrcode"
          @click="$emit('update:mode', 'qrcode')"
        >
          <Cellphone />{{ t('accountsPage.qrLogin') }}
        </button>
      </div>
      <div v-if="props.mode === 'qrcode' && !qrLoginEnabled" class="mode-notice">{{ t('accountsPage.qrUnavailable') }}</div>
    </div>
    <template #footer>
      <UiButton variant="ghost" @click="$emit('close')">{{ t('accountsPage.cancel') }}</UiButton>
      <UiButton
        data-testid="submit-login"
        :disabled="props.busy || !props.modelValue || (props.mode === 'qrcode' && !qrLoginEnabled)"
        @click="$emit('submit')"
      >
        {{ props.busy ? t('accountsPage.processing') : props.mode === 'qrcode' ? t('accountsPage.startQrLogin') : t('accountsPage.openLoginPage') }}
      </UiButton>
    </template>
  </UiModal>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Cellphone, Monitor } from '@element-plus/icons-vue'
import UiButton from '@/components/UiButton.vue'
import UiModal from '@/components/UiModal.vue'
import UiSelect from '@/components/UiSelect.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  platforms: { type: Array, default: () => [] },
  modelValue: { type: String, default: '' },
  mode: { type: String, default: 'browser' },
  busy: { type: Boolean, default: false },
  qrAvailable: { type: Boolean, default: true },
})

const { t } = useI18n()
const qrLoginEnabled = computed(() => Boolean(props.qrAvailable || props.modelValue === 'kuaishou'))

defineEmits(['update:modelValue', 'update:mode', 'submit', 'close'])
</script>

<style scoped>
.login-form { display: flex; flex-direction: column; gap: 10px; }
.field-label { color: var(--text-primary, #303039); font-size: 13px; font-weight: 600; }
.mode-control {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 3px;
  border: 1px solid var(--border, #dedee5);
  border-radius: 7px;
  background: #f5f5f7;
}
.mode-control button {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #6f7079;
  font-size: 13px;
  cursor: pointer;
}
.mode-control button.active { background: #fff; color: #5048e5; box-shadow: 0 1px 3px rgba(28, 28, 35, 0.12); }
.mode-control button:disabled { cursor: not-allowed; opacity: 0.45; }
.mode-control svg { width: 16px; height: 16px; }
.mode-notice { color: #a66a22; font-size: 12px; }
</style>
