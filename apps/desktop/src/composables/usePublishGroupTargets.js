/**
 * usePublishGroupTargets.js — 发布页「按组添加」的接线层（P2-8b）
 *
 * 存在的理由：`Publish.vue` 的行数预算**实际为 0 行** —— `max-lines-baseline.json` 的 `targets`
 * 已点名该文件（P2-8b 当时的「登记 1515 + 容差 200」口径已作废，`targets` 优先于登记且容差为 0，
 * 超一行即 `TARGET_GREW`；2026-10-15 `publish-add-account-entry` 实测确认）。而这段逻辑要读
 * store、要拼播报文案、要做分类；全塞进视图就是用一个 PR 吃掉整个增长预算。判据本体在
 * `@/features/publish/usePublishGroupApply`（纯函数），这里只做「store ↔ 视图」的桥。
 *
 * 三条不可移动的语义（成因见 PRD §二 / §三）：
 * 1. 可见性由 `pickVisibleGroups(groups, groupsStatus)` 决定 —— 状态 `unreadable` 时
 *    `groups` 里可能还留着上一轮的组（P2-8a 刻意不清空，以免用空数组抹真源），
 *    只判 `groups.length` 就会在未登录时把别人的分组当成可操作项。
 * 2. 播报文案的每个数字都取自同一次 `applyAccountGroup` 的分类结果，禁止"添加成功"与
 *    `added=0` 同时出现。
 * 3. 新启用的平台必须写进文案：组的成员可能属于当前未选中的平台，用户看到的是
 *    "加了 3 个号"，实际还多了 2 个发布目标。
 */
import { computed } from 'vue'
import i18n from '@/i18n'
import {
  applyAccountGroup,
  buildGroupPickerItems,
  pickVisibleGroups,
} from '@/features/publish/usePublishGroupApply'

const t = (key, named) => i18n.global.t(key, named || {})

export function usePublishGroupTargets ({ accountStore, selection, platforms, notifyInfo, notifyWarning }) {
  const deps = {
    resolveAccount: (accountId) => (accountStore.accounts || []).find(a => a && a.id === accountId) || null,
    isAccountAvailable: (platformId, accountId) => selection.isAccountAvailable(platformId, accountId),
    isPlatformSelected: (platformId) => (selection.selectedPlatforms.value || []).includes(platformId),
    isAccountSelected: (platformId, accountId) => selection.isAccountSelected(platformId, accountId),
    selectPlatform: (platformId) => selection.selectPlatform(platformId),
    selectAccount: (platformId, accountId) => selection.selectAccount(platformId, accountId),
  }

  const visibleGroups = computed(() => pickVisibleGroups(accountStore.groups, accountStore.groupsStatus))
  const groupPickerItems = computed(() => buildGroupPickerItems(visibleGroups.value, deps))

  function platformLabels (platformIds) {
    const list = Array.isArray(platforms) ? platforms : (platforms && platforms.value) || []
    return platformIds.map(id => list.find(p => p && p.id === id)?.label || id).join('、')
  }

  function announce (group, result) {
    // 既有口径（HomeGreeting.vue:53）：messageKey 与 message 一起传 —— key 进主进程日志，
    // message 是用户实际看到的拼装文案。只给 key 会让拼装文案失去出处，只给 message 会让日志键恒空。
    if (result.reason === 'empty-group') {
      notifyWarning('publishPage.groupPicker.emptyGroup', { message: t('publishPage.groupPicker.emptyGroup') })
      return
    }
    if (result.added.length === 0) {
      if (result.already.length > 0) {
        notifyInfo('publishPage.groupPicker.alreadySelected', {
          message: t('publishPage.groupPicker.alreadySelected', { count: result.already.length }),
        })
        return
      }
      notifyWarning('publishPage.groupPicker.nothingToAdd', {
        message: t('publishPage.groupPicker.nothingToAdd', { name: group.name }),
      })
      return
    }
    const platformText = result.platforms.length > 0
      ? t('publishPage.groupPicker.platformsEnabled', { platforms: platformLabels(result.platforms) })
      : ''
    const skippedText = result.skipped.length > 0
      ? t('publishPage.groupPicker.skipped', { skipped: result.skipped.length })
      : ''
    notifyInfo('publishPage.groupPicker.added', {
      message: t('publishPage.groupPicker.added', {
        name: group.name,
        added: result.added.length,
        platformText,
      }) + skippedText,
    })
  }

  function applyGroupById (groupId) {
    const group = visibleGroups.value.find(g => g && g.id === groupId)
    if (!group) return { ok: false, reason: 'invalid-group' }
    const result = applyAccountGroup(group, deps)
    announce(group, result)
    return result
  }

  return { visibleGroups, groupPickerItems, applyGroupById }
}
