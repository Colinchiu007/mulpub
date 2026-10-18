/**
 * usePublishTargetBulkTargets.js — 发布页「全选 / 清空」的选中集写入判据（publish-target-select-all）
 *
 * 为什么单独一个文件、而且是纯函数：与 P2-8b 的 `usePublishGroupApply.js` 同范式。
 * 判据要能被发布页之外的消费者复用，写进组件就是第二份口径（本仓「同一判据被抄成三遍」
 * 的事故族已证）。全部依赖以注入方式传入，因此分类、顺序、幂等三条锁可在无 Vue、
 * 无 IPC 的环境里直接测。
 *
 * 两条不可违反的约束（成因见 01-docs/PRD-PUBLISH-TARGET-SELECT-ALL-2026-10-17.md §四）：
 * 1. **可发布判据一律问 getAvailableAccountIds**：它内部经 `usePlatformSelection.getAccounts`
 *    走 `isAccountActive`，是「不可勾选 / 不作默认回填 / 已选中自动剔除」三条语义共用的那个判定。
 *    禁止在此读 `platform.accounts.length` —— 那个数组包含停用账号（`usePublishPlatformCatalog`
 *    刻意保留停用账号以供渲染禁用态），直接数会把停用账号当成可发布。
 * 2. **写入必须在同一同步段完成**：`usePlatformSelection.js:139-142` 的 reconcile 会删除
 *    「不在 selectedPlatforms 里的平台键」；而 `:143-147` 会给「已选平台但选中集为空」
 *    回填默认账号。本函数只写平台，账号由宿主的 reconcile 回填 —— 因此不得出现
 *    await / nextTick（源码锁见 usePublishTargetBulk.test.js L5）。
 *
 * 返回值的分类互斥且穷尽：`added + already + skipped === 可判定的平台数`，
 * 上层提示文字只能读这几个数，不得再自行推断。
 */

const REASON_NO_ACCOUNT = 'no-account'
const REASON_INVALID_ITEM = 'invalid-item'

function emptyResult (extra) {
  return { ok: true, added: [], already: [], skipped: [], selected: [], ...extra }
}

/**
 * @param {Array<{id?: unknown, label?: unknown, accounts?: unknown}>} platforms 平台目录（拍平后）
 * @param {{
 *   getAvailableAccountIds: (platformId: string) => string[],
 *   isPlatformSelected: (platformId: string) => boolean,
 *   selectPlatform: (platformId: string) => void,
 * }} deps
 * @returns {{ok:boolean, reason?:string, added:string[], already:string[], skipped:Array<{platformId:string, reason:string}>, selected:string[]}}
 */
export function selectAllPublishTargets (deps) {
  const platforms = Array.isArray(deps && deps.platforms) ? deps.platforms : null
  if (!platforms || platforms.length === 0) {
    return emptyResult({ ok: false, reason: 'no-targets' })
  }

  const result = emptyResult({})
  let selectableCount = 0

  for (const platform of platforms) {
    if (!platform || typeof platform !== 'object') continue
    const platformId = typeof platform.id === 'string' ? platform.id.trim() : ''
    if (!platformId) continue // 坏项：不是"没有账号的平台"，不得进 skipped

    // 可发布 = 该平台当前至少有一个可勾选账号。判据唯一入口见文件头第 1 条。
    // ⚠️ 只调用**一次**注入函数：它是外部传进来的，不保证幂等（可能带副作用或读取时刻不同），
    //    「先问长度、再取一遍」会让分类依据与校验依据来自两次不同的调用。
    const available = deps.getAvailableAccountIds?.(platformId)
    const availableIds = Array.isArray(available) ? available : []
    if (availableIds.length === 0) {
      result.skipped.push({ platformId, reason: REASON_NO_ACCOUNT })
      continue
    }

    selectableCount += 1
    if (deps.isPlatformSelected?.(platformId)) {
      result.already.push(platformId)
      continue
    }
    deps.selectPlatform(platformId)
    result.added.push(platformId)
  }

  // 一个都选不了 ⇒ no-targets。判据取 selectableCount 而不是 added.length：
  // 全部已选中时 added 为 0，但那不是"没有可发布目标"。
  if (selectableCount === 0) {
    return emptyResult({ ok: false, reason: 'no-targets' })
  }

  result.selected = [...result.added, ...result.already].sort()
  return result
}

/** 播报用的平台名清单截断：前 N 个 + 「等 M 个」。上限由 PRD §八 定，禁止各处各写一份。 */
export const MAX_LISTED_PLATFORMS = 3

/**
 * 名字连接符的**兜底**值。正常路径由接线层按 locale 注入（zh「、」/ en「, 」）；
 * 这里只在调用方没给时用，且刻意选不带 CJK 标点的形态，避免英文界面出现中英混排。
 */
const DEFAULT_SEPARATOR = ', '

/**
 * @param {string[]} labels 平台显示名
 * @param {object} [options]
 * @param {number} [options.maxListed] 最多列几个（超出部分只记总数）
 * @param {(rest: number) => string} [options.restLabel] 超出部分的文案，由**接线层**注入
 *   （locale）。本函数是纯函数，不得 import i18n —— 否则它就无法在无 Vue 环境里单测，
 *   且会把中文硬编码带进渲染层（CI Gate 7 check-locale-sync --cjk 会判红）。
 * @param {string} [options.separator] 名字之间的连接符，**同样必须由接线层注入**。
 *   中文用「、」、英文用「, 」—— 此前这里硬编码「、」，英文界面会渲染成
 *   `Weibo、Zhihu and 2 more` 这种中英混排（`--cjk` 只扫汉字、扫不到 U+3001 顿号，
 *   所以它当时没红；这是「判据看不见 = 没缺陷」的反例）。
 * @returns {string}
 */
export function formatPlatformList (labels, options = {}) {
  const maxListed = Number.isFinite(options.maxListed) ? options.maxListed : MAX_LISTED_PLATFORMS
  const restLabel = typeof options.restLabel === 'function' ? options.restLabel : null
  const separator = typeof options.separator === 'string' ? options.separator : DEFAULT_SEPARATOR
  const list = (Array.isArray(labels) ? labels : []).filter(name => typeof name === 'string' && name)
  if (list.length <= maxListed || !restLabel) return list.join(separator)
  return list.slice(0, maxListed).join(separator) + restLabel(list.length - maxListed)
}
