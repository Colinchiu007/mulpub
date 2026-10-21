<template>
  <div class="cloud-digest-body">
    <!-- 两个数并排：用户要判断的是「本机 vs 云端」，中间隔一列表就得靠记忆 -->
    <div class="cloud-digest-counts" data-testid="cloud-digest-counts">
      <p class="cloud-sync-line cloud-digest-total" data-testid="cloud-digest-total">{{ digestTotalText }}</p>
      <p class="cloud-sync-line cloud-digest-local" data-testid="cloud-digest-local">{{ t('accountsPage.cloudDigestLocal', { local: localCount }) }}</p>
    </div>

    <ul v-if="platformRows.length" class="cloud-digest-platforms" data-testid="cloud-digest-platforms">
      <li
        v-for="row in platformRows"
        :key="row.platform"
        class="cloud-digest-platform"
        :data-testid="`cloud-digest-platform-${row.platform}`"
      >
        <img
          v-if="isPlatformIconUrl(row.icon)"
          :src="row.icon"
          class="cloud-digest-platform-icon-img mp-platform-icon"
          :alt="row.label"
          width="20"
          height="20"
          loading="lazy" decoding="async">
        <span v-else class="cloud-digest-platform-icon" aria-hidden="true">{{ row.icon || row.initial }}</span>
        <span class="cloud-digest-platform-name">{{ row.label }}</span>
        <strong class="cloud-digest-platform-count">{{ row.count }}</strong>
      </li>
    </ul>

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
import { isPlatformIconUrl } from '@/composables/usePlatformIconUrl'

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

</script>

<style scoped>
/* 与父级 .cloud-sync-dialog 同一纵向节奏：本块整体是父级的一个 flex 子项，
   内部各行也必须保持 space-3 间距，否则拆分子组件会悄悄改变视觉。 */
.cloud-digest-body { display: flex; flex-direction: column; gap: var(--spacing-3); }
.cloud-sync-line { margin: 0; color: var(--color-text-secondary); font-size: var(--font-size-sm); line-height: 1.5; }
.cloud-digest-counts { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--spacing-2) var(--spacing-5); }
.cloud-digest-counts .cloud-sync-line { margin: 0; }
.cloud-digest-total { color: var(--color-text-primary); font-weight: var(--font-weight-semibold); }
.cloud-digest-platforms { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--spacing-1); }
.cloud-digest-platform { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: var(--spacing-2); color: var(--color-text-secondary); font-size: var(--font-size-sm); }
.cloud-digest-platform-icon { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; background: var(--color-bg-inset); font-size: var(--font-size-xs); }
.cloud-digest-platform-icon-img { width: 20px; height: 20px; object-fit: contain; }
.cloud-digest-platform-count { color: var(--color-text-primary); font-size: var(--font-size-sm); }
.cloud-sync-hint { margin: 0; padding: var(--spacing-2) var(--spacing-3); border-radius: var(--radius-sm); background: var(--color-bg-inset); color: var(--color-text-secondary); font-size: var(--font-size-xs); line-height: 1.5; }
</style>
