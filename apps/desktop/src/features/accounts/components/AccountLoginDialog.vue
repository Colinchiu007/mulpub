<template>
  <UiModal :visible="props.visible" :title="t('accountsPage.addAccount')" size="sm" @close="$emit('close')">
    <div class="login-form">
      <AccountPlatformPicker
        :model-value="props.modelValue"
        :platforms="props.platforms"
        :label="t('accountsPage.platform')"
        :placeholder="t('accountsPage.selectPlatform')"
        :search-placeholder="t('accountsPage.platformPicker.searchPlaceholder')"
        :empty-text="t('accountsPage.platformPicker.emptyResult')"
        :no-platforms-text="t('accountsPage.platformPicker.emptyPlatforms')"
        :hint="t('accountsPage.platformPicker.hint')"
        :group-labels="groupLabels"
        :aria-labels="ariaLabels"
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
import AccountPlatformPicker from './AccountPlatformPicker.vue'
import UiButton from '@/components/UiButton.vue'
import UiModal from '@/components/UiModal.vue'

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

// 分组名与无障碍文案走 locale：分组键（domestic / international）是结构键，
// 显示名必须是可翻译的，不能把分类值直接当标签用。
const groupLabels = computed(() => ({
  domestic: t('accountsPage.platformPicker.groupDomestic'),
  international: t('accountsPage.platformPicker.groupInternational'),
}))

const ariaLabels = computed(() => ({
  trigger: t('accountsPage.platformPicker.triggerAria'),
  search: t('accountsPage.platformPicker.searchAria'),
  clearSearch: t('accountsPage.platformPicker.clearSearchAria'),
  list: t('accountsPage.platformPicker.listAria'),
  option: (platform) => t('accountsPage.platformPicker.optionAria', { platform }),
}))

defineEmits(['update:modelValue', 'update:mode', 'submit', 'close'])
</script>

<style scoped>
.login-form { display: flex; flex-direction: column; gap: 10px; }
.field-label { color: var(--text-primary, #303039); font-size: var(--font-size-sm); font-weight: 600; }
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
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.mode-control button.active { background: var(--color-bg-card); color: #5048e5; box-shadow: 0 1px 3px rgba(28, 28, 35, 0.12); }
.mode-control button:disabled { cursor: not-allowed; opacity: 0.45; }
.mode-control svg { width: 16px; height: 16px; }
.mode-notice { color: #a66a22; font-size: var(--font-size-xs); }
</style>
