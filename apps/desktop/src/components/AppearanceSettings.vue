<template>
  <section class="appearance-settings" data-testid="appearance-settings">
    <h3 class="appearance-title">{{ t('settings.title') }} · {{ t('settings.appearance.themeGroup') }}</h3>
    <p class="appearance-hint">{{ t('settings.appearance.themeHint') }}</p>

    <!--
      radiogroup 而不是三个开关：三态互斥且单选，radio 语义能让读屏念出组名与"当前选中"。
      焦点态沿用既有 `cohere-btn` 类（阶段 3.6 的焦点环锁判定域按类名派生）——
      刻意**不新建变体类**：新增一个可聚焦变体就必须同时在焦点环契约里登记它，
      否则它落在两把锁（3.6 按钮族 / tabindex=0 域）之间，成为"看着有、实际没人守"的那一格。
    -->
    <div
      role="radiogroup"
      :aria-label="t('settings.appearance.themeGroup')"
      class="appearance-radios"
      @keydown="onGroupKeydown"
    >
      <button
        v-for="opt in options"
        :id="`appearance-theme-${opt.value}`"
        :key="opt.value"
        type="button"
        role="radio"
        class="cohere-btn appearance-radio"
        :class="{ 'appearance-radio-checked': preference === opt.value }"
        :aria-checked="preference === opt.value ? 'true' : 'false'"
        :tabindex="preference === opt.value ? 0 : -1"
        :data-testid="`appearance-theme-${opt.value}`"
        @click="choose(opt.value)"
      >
        {{ opt.label }}
      </button>
    </div>

    <p class="appearance-desc">{{ description }}</p>
    <p class="appearance-effective" data-testid="appearance-current-effective">
      {{ t('settings.appearance.currentEffective', { name: effectiveName }) }}
    </p>
    <p class="appearance-notice" data-testid="appearance-dark-notice">
      {{ t('settings.appearance.darkNotice') }}
    </p>
  </section>
</template>

<script setup>
/**
 * AppearanceSettings — 设置页「外观」面板（UX 审计 阶段 1.1）
 *
 * 本组件的存在理由：`useTheme` 早就实现了暗色，但**全仓零生产消费方** ⇒
 * 约 72 处 `[data-theme=dark]` 分支与整轮「深色低对比」整改在用户侧永远不可达。
 * 这里补的就是那个缺失的写入者入口；状态的单一真源在 `composables/useTheme.js`（应用级单例）。
 *
 * 键盘口径：radiogroup 用 roving tabindex —— 组内只有一个 Tab 停靠点（当前选中项），
 * 方向键在组内移动并选中。Tab 两次进出组，不会逐个停在三个选项上。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'

const { t } = useI18n()
const { preference, theme, setPreference, resetToSystem } = useTheme()

const options = computed(() => [
  { value: 'system', label: t('settings.appearance.optSystem') },
  { value: 'light', label: t('settings.appearance.optLight') },
  { value: 'dark', label: t('settings.appearance.optDark') },
])

const nameOf = (v) => ({
  light: t('settings.appearance.optLight'),
  dark: t('settings.appearance.optDark'),
  system: t('settings.appearance.optSystem'),
})[v] || v

const description = computed(() => (preference.value === 'system'
  ? t('settings.appearance.systemDesc')
  : t('settings.appearance.fixedDesc', { name: nameOf(preference.value) })))

const effectiveName = computed(() => nameOf(theme.value))

function choose (value) {
  if (value === 'system') resetToSystem()
  else setPreference(value)
}

/** 方向键在组内移动并选中（radiogroup 惯例：移动即选中） */
function onGroupKeydown (e) {
  const next = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
  if (!next) return
  e.preventDefault()
  const vals = options.value.map((o) => o.value)
  const at = vals.indexOf(preference.value)
  const moved = vals[(Math.max(at, 0) + next + vals.length) % vals.length]
  choose(moved)
  const el = document.getElementById(`appearance-theme-${moved}`)
  if (el) el.focus()
}
</script>

<style scoped>
.appearance-settings {
  padding: 4px 2px;
}
.appearance-title {
  margin: 0 0 8px;
  font-size: var(--font-size-base);
  font-weight: 600;
}
.appearance-hint,
.appearance-desc,
.appearance-effective {
  margin: 0 0 8px;
  font-size: var(--font-size-sm);
  opacity: 0.8;
}
.appearance-radios {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}
.appearance-radio-checked {
  border-color: var(--color-primary, #5048e5);
  font-weight: 600;
}
.appearance-notice {
  margin: 12px 0 0;
  padding: 8px 10px;
  font-size: var(--font-size-xs);
  line-height: 1.5;
  border-left: 3px solid var(--color-border, #d4d4d8);
}
</style>
