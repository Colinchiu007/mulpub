<template>
  <button
    v-if="showUpdateBadge"
    type="button"
    class="mp-update"
    :class="`is-${badgeMode}`"
    data-testid="mp-update"
    :disabled="busy"
    :title="tooltip"
    :aria-label="accessibilityLabel"
    :aria-busy="busy ? 'true' : 'false'"
    @click="handleClick"
  >
    <span class="mp-update-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <circle cx="12" cy="12" r="11" />
        <path d="M12 17.2V8.2M12 8.2L8.2 12M12 8.2l3.8 3.8" />
      </svg>
    </span>
    <span class="mp-update-label" data-testid="mp-update-label">{{ label }}</span>
  </button>
</template>

<script setup>
/**
 * SidebarUpdateButton —— 侧边栏底部「新版本」入口（位于登录菜单按钮上方）
 *
 * 交互：
 *   - 检测到新版本时出现（图标：圆形底 + 向上箭头；文字：新版本）
 *   - 点击 → 退出应用并安装新版本（未下载则先下载，下载完成后主进程自动退出并安装）
 *   - 下载中显示进度并禁用重复点击；点击后失败保留「重试」入口
 *
 * 状态来源：useAutoUpdate（模块级共享单例）。start()/cleanup() 由 App 级宿主
 * （UpdateNotification）持有，本组件只读状态 + 触发安装，不注册监听。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useAutoUpdate } from '@/composables/useAutoUpdate'

const { t } = useI18n()
const { badgeMode, showUpdateBadge, updateInfo, downloadPercent, handleInstallNow } = useAutoUpdate()

/** 下载阶段不可重复点击（主进程同样幂等，这里只做即时反馈） */
const busy = computed(() => badgeMode.value === 'downloading')
const version = computed(() => (updateInfo.value && updateInfo.value.version) || '')

const label = computed(() => {
  if (badgeMode.value === 'ready') return t('update.badgeReady')
  if (badgeMode.value === 'error') return t('update.badgeRetry')
  if (badgeMode.value === 'downloading') return t('update.badgeDownloading', { percent: downloadPercent.value })
  return t('update.badge')
})

const tooltip = computed(() => {
  if (badgeMode.value === 'ready') return t('update.badgeTitleReady', { version: version.value })
  if (badgeMode.value === 'error') return t('update.badgeTitleRetry')
  if (badgeMode.value === 'downloading') return t('update.badgeTitleDownloading', { version: version.value })
  return t('update.badgeTitleAvailable', { version: version.value })
})

// 文案 key 已在 zh/en locales 成对定义；缺 key 时 vue-i18n 返回 key 原文，
// 这里回退英文可访问名而非硬编码中文（i18n-user-facing-messages 规则）。
const accessibilityLabel = computed(() => {
  const translated = t('update.badgeAriaLabel')
  return typeof translated === 'string' && translated !== 'update.badgeAriaLabel'
    ? translated
    : 'New version available'
})

async function handleClick () {
  if (busy.value) return
  // 明确告知「点击后会自动退出」，避免安装时突然退出打断用户预期
  ElMessage.info(t('update.installingHint'))
  await handleInstallNow()
}
</script>

<style scoped>
.mp-update {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 8px 6px;
  border: 1px solid rgba(80, 72, 229, 0.28);
  border-radius: 10px;
  background: rgba(80, 72, 229, 0.08);
  color: var(--primary);
  font-family: inherit;
  font-size: 11px;
  line-height: 1.2;
  cursor: pointer;
  transition: background-color 160ms ease-out, border-color 160ms ease-out;
}

.mp-update:hover,
.mp-update:focus-visible {
  border-color: var(--primary);
  background: rgba(80, 72, 229, 0.16);
}

.mp-update:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.mp-update:disabled {
  cursor: progress;
  opacity: 0.72;
}

.mp-update-icon {
  display: block;
  width: 24px;
  height: 24px;
}

.mp-update-icon svg {
  display: block;
  width: 100%;
  height: 100%;
}

.mp-update-icon circle {
  fill: var(--primary);
}

.mp-update-icon path {
  fill: none;
  stroke: #fff;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.mp-update-label {
  font-weight: 600;
  white-space: nowrap;
}

/* 窄屏（图标栏）：只保留图标与可访问名，避免文字挤压导航 */
@media (max-width: 900px) {
  .mp-update {
    padding: 6px 0;
  }

  .mp-update-label {
    display: none;
  }
}
</style>
