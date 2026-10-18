/**
 * usePublishTargetBulkTargets.js — 发布页「全选 / 清空」的接线层（publish-target-select-all）
 *
 * 与 `usePublishGroupTargets.js`（P2-8b）同一范式：判据本体在
 * `@/features/publish/usePublishTargetBulk`（纯函数、可单测），这里只做
 * 「store ↔ 视图」的桥，让 `views/Publish.vue` 不必为这段接线付出多行
 * （该文件被 `max-lines-baseline.json` 的 `targets` 点名，容差 0）。
 *
 * 三条不可移动的语义（成因见 01-docs/PRD-PUBLISH-TARGET-SELECT-ALL-2026-10-17.md）：
 * 1. **播报文案的每个数字都取自同一次分类结果**：禁止"添加成功"与 added=0 同时出现。
 *    全选的 added=0 有两种含义（全部已选中 / 没有可发布目标），必须分开播报。
 * 2. **新增中含风控挂起目标时必须说出来**：一次点击引入多个已知会被派发前置守卫
 *    拦下的目标，属于把意外藏起来。
 * 3. **不写第二份可用性判据**：一律经注入的 `selection.getAvailableAccountIds`
 *    （内部即 `usePlatformSelection.getAccounts` → `isAccountActive`）。
 *
 * **为什么 publishableCount 是 watch 出来的 ref 而不是 computed**（2026-10-17 实测）：
 * `getAvailableAccountIds` 是 `usePlatformSelection` 的普通函数，其内部读的
 * `accountStore.byPlatform` 在**测试替身**里是普通对象上的 getter（`Publish.test.js` 的
 * `useAccountStore` mock），并非响应式源。直接写成 computed 时，它在账号目录就绪前
 * 求值一次并被缓存，之后不重算 —— 表现是"按钮永远不出现"，而平台列表里的账号明明在。
 * 因此这里用 watch 订阅**确实是响应式**的三个源（selectedPlatforms / selectedAccounts /
 * flatPlatforms）后重算：`reconcileSelectedAccounts` 正是在这些源变化时补齐/剔除账号键，
 * 所以它跑完的那一刻就是重算的正确时机。
 */
import { ref, computed, watch, isRef } from 'vue'
import i18n from '@/i18n'
import {
  selectAllPublishTargets,
  formatPlatformList,
  MAX_LISTED_PLATFORMS,
} from '@/features/publish/usePublishTargetBulk'

const t = (key, named) => i18n.global.t(key, named || {})

export function usePublishTargetBulkTargets ({
  selection,
  platforms,
  riskSuspended,
  notifyInfo,
  notifyWarning,
  /** 同一元素上的另一组 v-bind（usePublishAddAccountTargets 的产物）。
   *  Vue 模板不允许一个元素出现两个 v-bind（编译期 "Duplicate attribute"），
   *  因此两组绑定在这里合成一个对象，视图只保留一个 v-bind。 */
  siblingBindings,
}) {
  // 平台目录拍平：groupedPlatforms 是 [{label, items}] 两层，判据只要平台数组。
  const flatPlatforms = computed(() => {
    const groups = Array.isArray(platforms?.value) ? platforms.value : (platforms || [])
    return groups.flatMap(group => (Array.isArray(group?.items) ? group.items : []))
  })

  const selectedPlatformsRef = computed(() => selection?.selectedPlatforms?.value || selection?.selectedPlatforms || [])
  const selectedAccountsRef = computed(() => selection?.selectedAccounts?.value || selection?.selectedAccounts || {})

  /** 数一遍"有几个平台当前至少有一个可勾选账号"。判据本体是注入的 getAvailableAccountIds。 */
  function countPublishable () {
    return flatPlatforms.value.filter(platform => {
      if (!platform || typeof platform.id !== 'string' || !platform.id.trim()) return false
      return (selection?.getAvailableAccountIds?.(platform.id) || []).length > 0
    }).length
  }

  // 见文件头：必须是 watch + ref，不能是 computed（账号目录就绪前求值后被缓存）。
  const publishableCount = ref(0)
  watch(
    [flatPlatforms, selectedPlatformsRef, selectedAccountsRef],
    () => { publishableCount.value = countPublishable() },
    { immediate: true, deep: true },
  )

  /** 全选按钮是否可用：一个都选不了时不给可点的死控件。 */
  const canSelectAll = computed(() => publishableCount.value > 0 && !!selection)

  const selectAllAriaLabel = computed(() => t('publishPage.targetBulk.selectAllAria', {
    count: publishableCount.value,
  }))

  function selectAll () {
    const result = selectAllPublishTargets({
      platforms: flatPlatforms.value,
      getAvailableAccountIds: (platformId) => selection?.getAvailableAccountIds?.(platformId) || [],
      // 复用上面已归一化的 selectedPlatformsRef，不另写一条 `?.value || []` 读法：
      // 调用方给的是普通数组时 `?.value` 恒 undefined ⇒ already 永远为空、同一平台被重复写入。
      isPlatformSelected: (platformId) => selectedPlatformsRef.value.includes(platformId),
      selectPlatform: (platformId) => selection?.selectPlatform?.(platformId),
    })

    if (!result.ok) return result // no-targets：按钮本就 disabled，不播报（不制造噪音）

    if (result.added.length === 0) {
      // 两种零新增必须分开：全部已选中（ informational ）vs 没有可发布目标（上面已返回）
      notifyInfo('publishPage.targetBulk.alreadyAll', {
        message: t('publishPage.targetBulk.alreadyAll', { count: result.already.length }),
        params: { count: result.already.length },
      })
      return result
    }

    const skippedLabels = result.skipped
      .map(item => flatPlatforms.value.find(p => p?.id === item.platformId)?.label || item.platformId)
    const skippedText = result.skipped.length > 0
      ? t('publishPage.targetBulk.skipped', {
        count: result.skipped.length,
        platforms: formatPlatformList(skippedLabels, {
          maxListed: MAX_LISTED_PLATFORMS,
          // 截断后缀与连接符都走 locale：纯函数不 import i18n，中文不得进渲染层非 locales 文件
          // （CI Gate 7 check-locale-sync --cjk 会判红；顿号 U+3001 不在它的扫描域内，
          //   所以连接符此前硬编码「、」时没被拦下 —— 英文界面会渲染成中英混排）。
          restLabel: (rest) => t('publishPage.targetBulk.listRest', { rest }),
          separator: t('publishPage.targetBulk.listSeparator'),
        }),
      })
      : ''
    const riskCount = countRiskSuspended(result.selected, riskSuspended)
    const riskText = riskCount > 0
      ? t('publishPage.targetBulk.riskIncluded', { count: riskCount })
      : ''

    notifyInfo('publishPage.targetBulk.added', {
      message: t('publishPage.targetBulk.added', { added: result.added.length, skippedText }) + riskText,
      params: { added: result.added.length, skipped: result.skipped.length, risk: riskCount },
    })
    return result
  }

  function clearAll () {
    selection?.clearPlatforms?.()
    notifyInfo('publishPage.targetBulk.cleared', {
      message: t('publishPage.targetBulk.cleared'),
    })
  }

  return {
    flatPlatforms,
    publishableCount,
    canSelectAll,
    selectAllAriaLabel,
    selectAll,
    clearAll,
    formatPlatformList,
    /** 供视图 `<PublishTargetSelector v-bind="…" />` 一次性绑定。
     *  键名按 Vue 的事件归一化命名（onSelectAll ↔ emit('select-all')），由
     *  publish-target-bulk.component.test.js 的 v-bind 合同用例钉住。 */
    targetBindings: computed(() => ({
      ...(isRef(siblingBindings) ? siblingBindings.value : (siblingBindings || {})),
      // siblingBindings.refreshingAccounts 是 ref：模板 v-bind 传 ref 会让子组件
      // 收到 Object 而非 Boolean（实测 Vue warn: type check failed），故显式脱壳。
      refreshingAccounts: unwrapRef((isRef(siblingBindings) ? siblingBindings.value : (siblingBindings || {})).refreshingAccounts),
      canSelectAll: canSelectAll.value,
      publishableCount: publishableCount.value,
      selectAllAriaLabel: selectAllAriaLabel.value,
      onSelectAll: selectAll,
      onClearAll: clearAll,
    })),
  }
}

/** ref 脱壳：非 ref 原样返回（不假设调用方一定给 ref）。 */
function unwrapRef (value) {
  return isRef(value) ? value.value : value
}

/** 新增目标里命中的风控挂起数。平台级（accountId==null）覆盖该平台全部账号。 */
function countRiskSuspended (platformIds, riskSuspended) {
  const list = Array.isArray(riskSuspended?.value) ? riskSuspended.value : (riskSuspended || [])
  if (!Array.isArray(platformIds) || platformIds.length === 0) return 0
  const suspendedPlatforms = new Set(list
    .filter(entry => entry && typeof entry.platform === 'string')
    .map(entry => entry.platform))
  return platformIds.filter(id => suspendedPlatforms.has(id)).length
}
