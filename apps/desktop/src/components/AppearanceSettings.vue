<template>
  <fieldset class="appearance-panel" :disabled="!loaded" data-testid="appearance-panel">
    <legend class="appearance-legend">{{ t('settings.appearanceTitle') }}</legend>
    <p class="appearance-hint">{{ t('settings.appearanceHint') }}</p>

    <p v-if="!loaded" role="status" class="appearance-loading" data-testid="appearance-loading">
      {{ t('settings.appearanceLoading') }}
    </p>

    <div class="appearance-options">
      <label v-for="opt in options" :key="opt.value" class="appearance-option">
        <input
          type="radio"
          name="appearance-mode"
          :value="opt.value"
          :checked="mode === opt.value"
          :data-testid="`appearance-mode-${opt.value}`"
          @change="choose(opt.value)"
        >
        <span class="appearance-option-label">{{ t(opt.labelKey) }}</span>
        <span class="appearance-option-desc">{{ t(opt.descKey) }}</span>
      </label>
    </div>

    <!-- 「跟随系统」下用户需要知道现在到底是哪一档，否则切了系统主题会以为设置没生效 -->
    <p class="appearance-current" data-testid="appearance-current">
      {{ t('settings.appearanceCurrent', { theme: t(theme === 'dark' ? 'settings.appearanceDarkValue' : 'settings.appearanceLightValue') }) }}
    </p>
  </fieldset>
</template>

<script setup>
/**
 * 外观设置面板（UX-AUDIT 阶段 1.1 / audit-9）。
 *
 * 存在的理由：暗色主题自实现起就没有任何用户可达入口——`useTheme()` 生产调用点为 0，
 * 此前所有暗色对比度修复只发生在视觉测试手工注入 `data-theme` 的状态里。
 * 三态而不是开关：持久化必须能记住「跟随系统」，否则用户每次改系统偏好都会被
 * 一次手工切换"钉死"成 light/dark，设置看起来没保存。
 */
import { useI18n } from 'vue-i18n'

import { useTheme } from '@/composables/useTheme'

const { t } = useI18n()
const { mode, theme, loaded, setMode } = useTheme()

const options = [
  { value: 'system', labelKey: 'settings.appearanceSystem', descKey: 'settings.appearanceSystemDesc' },
  { value: 'light', labelKey: 'settings.appearanceLight', descKey: 'settings.appearanceLightDesc' },
  { value: 'dark', labelKey: 'settings.appearanceDark', descKey: 'settings.appearanceDarkDesc' },
]

// radio 的取值域就是 options 那三项，全部在 THEME_MODES 内，
// 因此不需要为「非法值」写回退分支（setMode 的返回值留给调用方自行决定语义）。
function choose (value) {
  setMode(value)
}
</script>

<style scoped>
.appearance-panel {
  border: none;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.appearance-legend {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--color-text-primary);
  padding: 0;
  margin-bottom: var(--space-xs);
}
.appearance-hint,
.appearance-loading {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted, var(--muted));
  margin: 0 0 var(--space-md);
}
.appearance-options {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.appearance-option {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas:
    "radio label"
    "radio desc";
  gap: 2px var(--space-sm);
  cursor: pointer;
}
.appearance-option input {
  grid-area: radio;
  align-self: start;
  margin-top: 3px;
}
.appearance-option-label {
  grid-area: label;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text-primary);
}
.appearance-option-desc {
  grid-area: desc;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted, var(--muted));
}
.appearance-current {
  margin: var(--space-md) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted, var(--muted));
}
</style>
