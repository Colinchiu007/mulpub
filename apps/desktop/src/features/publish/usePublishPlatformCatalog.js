import { computed } from 'vue'
import { isAccountActive } from '@/utils/account-active'

const PLATFORM_BADGES = Object.freeze({
  bilibili: { tag: '新', tagClass: 'cohere-tag-success' },
})

export function usePublishPlatformCatalog (platformStore, accountStore) {
  const platforms = computed(() => platformStore.platforms.map(platform => ({
    id: platform.id,
    label: platform.label,
    ...(PLATFORM_BADGES[platform.id] || { tag: null, tagClass: '' }),
  })))

  const groupedPlatforms = computed(() => {
    const groups = { domestic: [], international: [] }
    for (const platform of platforms.value) {
      const item = {
        ...platform,
        // 停用账号仍然列出（用户需要看到它存在），但带上 disabled 供选择器渲染禁用态；
        // 判定与可选集合同源，避免两处各写一次 === false 导致口径漂移。
        accounts: (accountStore.byPlatform?.[platform.id] || [])
          .map(account => ({ ...account, disabled: !isAccountActive(account) })),
      }
      const key = platformStore.getCategory(platform.id) === '海外' ? 'international' : 'domestic'
      groups[key].push(item)
    }

    return [
      groups.domestic.length > 0 ? { label: '国内平台', items: groups.domestic } : null,
      groups.international.length > 0 ? { label: '国际平台', items: groups.international } : null,
    ].filter(Boolean)
  })

  return { platforms, groupedPlatforms }
}
