<template>
  <!-- 常驻 live region：断网与恢复**都**要能被读屏播报（WCAG 4.1.3）。
       role=status / aria-live=polite 挂在这个从不被插入或移除的容器上，横幅只是它的内容。
       挂在 `v-if="isOffline"` 的节点上时，恢复那半边会因为整个 region 被移除而不会被播报
       —— 原实现正是这样，验收项「恢复也有一条播报」当时并不成立（QM-6 i2）。 -->
  <div class="offline-live" role="status" aria-live="polite" data-testid="offline-live">
    <div v-if="isOffline" class="offline-banner" data-testid="offline-banner">
      <span class="offline-banner__icon" aria-hidden="true">📡</span>
      <span class="offline-banner__text">{{ t('common.offlineBanner') }}</span>
      <span v-if="cachedTaskCount > 0" class="offline-banner__count">{{ t('common.offlinePendingCount', { count: cachedTaskCount }) }}</span>
    </div>
    <div v-else-if="showRecovered" class="offline-recovered" data-testid="offline-recovered">
      <span class="offline-recovered__text">{{ t('common.offlineRecovered') }}</span>
    </div>
  </div>
</template>

<script setup>
/**
 * OfflineIndicator — 离线横幅与恢复回执（UX 审计 1.7 整改 + QM-6 i2）
 *
 * 本次改掉的四件事（原先每一条都在"功能已建成但用户看不到"的同一条链上）：
 *  1. 实时性由 `useOfflineStatus` 的浏览器 online/offline 监听提供，卸载时成对 dispose；
 *  2. 文案不再硬编码中文（原 `📡 网络已断开 — 发布任务将被缓存…` 直接写在模板里，
 *     英文用户看到的是中文），改走 `common.*`；图标与文字分离，图标 `aria-hidden`；
 *  3. 颜色不再硬编码 hex（暗色档下浅奶油底会把整条横幅变成「亮色补丁」），
 *     改走 `--color-warning-*` 族，两档都在 tokens.css 里显式声明；
 *  4. 入场动画补 `prefers-reduced-motion` 守卫（本仓既有范式）。
 *
 * i2 补的是第五件：播报锚点必须常驻，否则「已恢复」这半边对读屏用户不存在。
 * 恢复回执是**会自己消失的**（RECOVERY_NOTICE_MS）：它只是"刚才发生过一次恢复"的回执，
 * 常驻会变成一条永久占位的横幅。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOfflineStatus, RECOVERY_NOTICE_MS } from '@/composables/useOfflineStatus'

const { t } = useI18n()
const { isOffline, cachedTaskCount, init: initOfflineStatus, dispose: disposeOfflineStatus } = useOfflineStatus()

const showRecovered = ref(false)
let recoveryTimer = null

function clearRecoveryTimer () {
  if (recoveryTimer !== null) {
    clearTimeout(recoveryTimer)
    recoveryTimer = null
  }
}

// 只在「离线 → 在线」的跃迁上给回执：首次挂载就是在线时，那不是"恢复"，不该弹回执。
watch(isOffline, (offline, wasOffline) => {
  if (offline) {
    showRecovered.value = false
    clearRecoveryTimer()
    return
  }
  if (wasOffline !== true) return
  showRecovered.value = true
  clearRecoveryTimer()
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null
    showRecovered.value = false
  }, RECOVERY_NOTICE_MS)
})

onMounted(() => {
  initOfflineStatus()
})

onBeforeUnmount(() => {
  clearRecoveryTimer()
  disposeOfflineStatus()
})
</script>

<style scoped>
/* Offline banner */
.offline-live {
  /* 播报锚点：不带任何视觉，空态时不占位 */
  display: block;
}

.offline-banner {
  background: var(--color-warning-soft);
  border-bottom: 1px solid var(--color-warning);
  padding: 8px 16px;
  font-size: var(--font-size-sm);
  color: var(--color-warning-ink);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  animation: offlineSlideDown 0.3s ease-out;
}

.offline-banner__count {
  margin-left: 8px;
  font-weight: 600;
}

.offline-recovered {
  padding: 4px 16px;
  font-size: var(--font-size-sm);
  color: var(--color-text-strong);
  text-align: center;
}

@keyframes offlineSlideDown {
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .offline-banner {
    animation: none;
  }
}
</style>
