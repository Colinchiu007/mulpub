<template>
  <div>
    <div class="form-group">
      <label>{{ $t('create.story2video.ui.quickOutputProfileLabel') }}</label>
      <UiSelect v-model="profile" :options="profileOptions" testid="quick-profile" />
    </div>

    <div class="form-group">
      <label>{{ $t('create.story2video.ui.quickDurationLabel') }}</label>
      <UiSelect v-model="seconds" :options="secondsOptions" testid="quick-seconds" />
    </div>

    <div class="form-group">
      <label>{{ $t('create.story2video.ui.quickSeedLabel') }}</label>
      <input v-model="seedInput" type="number" class="form-input" data-testid="quick-seed" />
      <p class="text-muted quick-hint">{{ $t('create.story2video.ui.quickSeedHint') }}</p>
    </div>

    <div class="form-group" v-if="sizeOptions.length > 0">
      <label>{{ $t('create.story2video.ui.quickResolutionLabel') }}</label>
      <UiSelect v-model="size" :options="sizeOptions" :disabled="sizeOptions.length <= 1" testid="quick-size" />
    </div>

    <p class="text-muted quick-hint" data-testid="quick-cost">{{ costText }}</p>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import UiSelect from '@/components/UiSelect.vue'
import { SECONDS_MIN, SECONDS_MAX } from './quick-render-constants'

const { t } = useI18n()

// v-model 双向绑定（defineModel 需要 Vue ≥3.4；本仓 3.5）
const profile = defineModel('profile', { type: String, default: '' })
const seconds = defineModel('seconds', { type: String, default: '' })
const seedInput = defineModel('seedInput', { type: [String, Number], default: '' })
const size = defineModel('size', { type: String, default: '' })

defineProps({
  sizeOptions: { type: Array, default: () => [] },
  profileOptions: { type: Array, default: () => [] },
  costText: { type: String, default: '' },
})

const secondsOptions = computed(() => {
  const out = []
  for (let s = SECONDS_MIN; s <= SECONDS_MAX; s += 1) out.push({ value: String(s), label: `${s}s` })
  return out
})
</script>

<style scoped>
.quick-hint {
  font-size: 12px;
  margin: 6px 0 0;
  line-height: 1.5;
}
</style>
