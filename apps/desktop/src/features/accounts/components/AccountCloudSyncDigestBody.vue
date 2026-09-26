<template>
  <div class="cloud-digest-body">
    <p class="cloud-sync-line cloud-digest-total" data-testid="cloud-digest-total">{{ digestTotalText }}</p>

    <ul v-if="platformRows.length" class="cloud-digest-platforms" data-testid="cloud-digest-platforms">
      <li
        v-for="row in platformRows"
        :key="row.platform"
        class="cloud-digest-platform"
        :data-testid="`cloud-digest-platform-${row.platform}`"
      >
        <img
          v-if="isIconUrl(row.icon)"
          :src="row.icon"
          class="cloud-digest-platform-icon-img"
          :alt="row.label"
          width="20"
          height="20"
        >
        <span v-else class="cloud-digest-platform-icon" aria-hidden="true">{{ row.icon || row.initial }}</span>
        <span class="cloud-digest-platform-name">{{ row.label }}</span>
        <strong class="cloud-digest-platform-count">{{ row.count }}</strong>
      </li>
    </ul>

    <p class="cloud-sync-line cloud-digest-local" data-testid="cloud-digest-local">{{ t('accountsPage.cloudDigestLocal', { local: localCount }) }}</p>
    <p
      v-if="digest && digest.tombstones > 0"
      class="cloud-sync-line cloud-digest-tombstone"
      data-testid="cloud-digest-tombstone"
    >{{ t('accountsPage.cloudDigestTombstone', { count: digest.tombstones }) }}</p>

    <!-- 隐私提示恒显示：首次同步的同意点（PRD §十五 合规），错误态也不隐藏 -->
    <p class="cloud-sync-hint cloud-digest-privacy" data-testid="cloud-digest-privacy">{{ t('accountsPage.cloudDigestPrivacy') }}</p>
  </div>
</template>

<script setup>
/**
 * AccountCloudSyncDigestBody — 【同步云端】弹窗的摘要确认态正文（PRD §10.2）。
 *
 * 只负责「云端现有 xx 个 / 按平台分布 / 本机待同步 / 墓碑提示 / 隐私同意」这段展示，
 * loading 与失败态由父组件决定（摘要 MUST 先有数据再显示数字，绝不用 0 冒充空云端）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  digest: { type: Object, default: null },
  /** 本机待同步账号数（父级已按 digest.localCount ?? props.localCount 定口径） */
  localCount: { type: Number, default: 0 },
  platformLabel: { type: Function, default: value => value },
  platformIcon: { type: Function, default: () => '' },
})

const { t } = useI18n()

const digestTotalText = computed(() => {
  const total = Number(props.digest?.total) || 0
  return total > 0
    ? t('accountsPage.cloudDigestTotal', { total })
    : t('accountsPage.cloudDigestEmpty')
})

/** 平台分布：count desc、platform asc（顺序稳定，与响应数组顺序无关） */
const platformRows = computed(() => {
  const list = Array.isArray(props.digest?.byPlatform) ? props.digest.byPlatform : []
  return list
    .map(item => ({
      platform: String(item?.platform || ''),
      count: Number(item?.count) || 0,
    }))
    .filter(item => item.platform)
    .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform))
    .map(item => {
      const label = props.platformLabel(item.platform) || item.platform
      return {
        ...item,
        label,
        icon: props.platformIcon(item.platform) || '',
        initial: String(label || item.platform).slice(0, 1),
      }
    })
})

function isIconUrl (value) {
  return typeof value === 'string' && (value.startsWith('/') || value.startsWith('data:') || value.startsWith('http'))
}
</script>

<style scoped>
/* 与父级 .cloud-sync-dialog 同一纵向节奏：本块整体是父级的一个 flex 子项，
   内部各行也必须保持 space-3 间距，否则拆分子组件会悄悄改变视觉。 */
.cloud-digest-body { display: flex; flex-direction: column; gap: var(--apple-space-3); }
.cloud-sync-line { margin: 0; color: var(--apple-ink-secondary); font-size: var(--apple-size-sm); line-height: 1.5; }
.cloud-digest-total { color: var(--apple-ink-primary); font-weight: var(--apple-weight-semibold); }
.cloud-digest-platforms { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--apple-space-1); }
.cloud-digest-platform { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: var(--apple-space-2); color: var(--apple-ink-secondary); font-size: var(--apple-size-sm); }
.cloud-digest-platform-icon { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; background: var(--apple-surface-tertiary); font-size: var(--apple-size-xs); }
.cloud-digest-platform-icon-img { width: 20px; height: 20px; object-fit: contain; }
.cloud-digest-platform-count { color: var(--apple-ink-primary); font-size: var(--apple-size-sm); }
.cloud-sync-hint { margin: 0; padding: var(--apple-space-2) var(--apple-space-3); border-radius: var(--apple-radius-sm); background: var(--apple-surface-tertiary); color: var(--apple-ink-secondary); font-size: var(--apple-size-xs); line-height: 1.5; }
</style>
