/**
 * usePublishHistoryContentLink — 发布记录「作品链接」的目的地判据与打开通道
 *
 * 存在理由（PRD-PUBLISH-HISTORY-PUBLIC-LINK-2026-10-07）：
 * 用户报障「发布记录里已成功的记录，点链接打开的是登录页」。根因三层：
 *   ① 落库的 `result.url` 是 RPA webview 判定成功瞬间的**当前页**（创作者后台页），
 *      `config/platforms.yaml` 里多数平台的 `publish_url` 本身就是后台；
 *   ② `sanitizePublishResultUrl` 只脱敏，不判目的地；
 *   ③ 渲染端只判**协议**（`safeHttpUrl`），把协议合法的登录墙 URL 当作品链接呈现，
 *      而应用内标签与系统浏览器都不携带平台会话 Cookie ⇒ 平台重定向到登录页。
 *
 * 本 composable 是这段逻辑的**唯一**实现，从 `PublishHistory.vue` 拆出的原因：
 * 该视图已达 1457 行，逐文件行数门禁（`.github/scripts/check-max-lines.js`，
 * limit=500 / growthAllowance=200）对「本 PR 触碰的文件」按账本登记值比对增长。
 *
 * 判据分三层，**不可互相替代**（分工理由同 `electron/window.js:85-90`）：
 *   ① 目的地语义 resolvePublishedContentUrl —— 这是不是该平台的公开内容页
 *   ② 协议白名单   safeHttpUrl                 —— 能不能进 href
 *   ③ 主进程 isAllowedExternalUrl              —— 交给系统浏览器前的更严兜底
 * ① 在 ② 之前：语义不通过就不产出 URL，协议判据无从谈起。
 *
 * 打开通道：应用内 page-manager 新标签（tabStore.createTab，与 Collection.openCollection
 * 同范式）；桥不可用或创建失败（store 合同：内部吞错返回 null）时降级
 * window.open(url, '_blank')，由主进程 setWindowOpenHandler → isAllowedExternalUrl 兜底
 * 交系统浏览器——该 window.open 点已在 `href-scheme-contract.test.js` 的
 * OPEN_SITES_GUARDED_IN_MAIN 登记。
 */
import { ref } from 'vue'
import { safeHttpUrl } from '@multi-publish/shared-utils/src/safe-http-url'
// 不带 `.browser` 后缀：渲染层统一从不带后缀的模块名导入，由 apps/desktop/vite.config.js 的
// resolve.alias 映射到 ESM 孪生（与 safe-http-url / publish-audit-status 同约定）。
// 直接写 `.browser` 后缀会被 scripts/check-renderer-cjs-boundary 判为未登记的 CJS 跨边界导入。
import { resolvePublishedContentUrl } from '@multi-publish/shared-utils/src/published-content-url'
import { useTabStore } from '@/stores/tab'

/**
 * 卡片内交互元素：点击走自身逻辑，不冒泡为「打开链接」。用 closest 委托过滤而非逐个
 * @click.stop，避免将来新增子元素时漏加 stop 导致误开。
 * [role=tab] 是防御性条目：当前卡内无该元素，为未来子组件（如内嵌 tab 切换）预留的排除面。
 */
export const CARD_INTERACTIVE_SELECTOR = 'a, button, label, input, select, textarea, [role="tab"]'

/**
 * @param {object} deps
 * @param {(key: string, named?: object) => string} deps.t vue-i18n 的 t
 * @param {(record: object) => string} deps.recordTitle 记录标题（带兜底）
 * @param {(record: object, key: string) => string} deps.resultValue 取 result 字段（仅 string/number）
 * @param {import('vue').Ref<string>} deps.actionMessage 页面顶部操作提示承载
 */
export function usePublishHistoryContentLink ({ t, recordTitle, resultValue, actionMessage }) {
  const tabStore = useTabStore()
  // 进行中守卫：同一卡片在 createTab 未 settle 前的重复点击忽略（非模板绑定，无需响应式）。
  const openingCardIds = new Set()

  /**
   * 解析记录的作品链接。postId 优先取发布结果；platformWorkId 是审核回写落库的锚点，
   * 作为历史记录的回退来源（解析发生在渲染期 ⇒ 存量记录无需迁移即恢复正确）。
   * @param {object|null|undefined} record
   * @returns {{url: string, source: 'recorded'|'derived'|'none'}}
   */
  function publicContentLink (record) {
    if (!record) return { url: '', source: 'none' }
    return resolvePublishedContentUrl({
      platform: record.platform,
      postId: resultValue(record, 'postId') || record.platformWorkId || '',
      recordedUrl: resultValue(record, 'url'),
    })
  }

  /** 卡片与详情弹窗共用的唯一 URL 出口：解析结果再过协议判据，杜绝「显示 A、打开 B」 */
  function publicLinkHref (record) {
    return safeHttpUrl(publicContentLink(record).url)
  }

  /**
   * 仅控制光标与 title 提示的可点性判断。
   * 草稿记录**一律不可点**（见 isDraftRecord）：只进了平台草稿箱的内容没有公开作品，
   * 若同时满足「有链接」会得到「title 说草稿、卡片仍可点」的自相矛盾状态。
   */
  function isCardClickable (record) {
    if (isDraftRecord(record)) return false
    return Boolean(publicLinkHref(record))
  }

  /**
   * 该记录是否是「只进了平台草稿箱」的发布结果。
   * 小红书 `draftOnly`（rpa-view-platforms.js）等路径只把内容存进草稿，**没有公开作品**，
   * 因此它点不动不是缺陷而是正确语义 —— 若照旧显示「暂无平台公开链接」，
   * 用户会去查一个并不存在的问题（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §5.3）。
   */
  function isDraftRecord (record) {
    // 直接读 result.draft，**不经 resultValue**：后者的契约是「只返回 string/number」，
    // 布尔 true 会被它归一成空串 ⇒ 判据恒假（本切片首跑实测：草稿记录的 title 仍是
    // 「暂无平台公开链接」，用例当场变红才发现）。
    return Boolean(record && record.result && record.result.draft === true)
  }

  function cardClickHint (record) {
    if (isDraftRecord(record)) return t('historyPage.cardDraftHint')
    return isCardClickable(record) ? t('historyPage.cardOpenHint') : t('historyPage.cardNoLinkHint')
  }

  /**
   * 详情弹窗「作品链接」行的三态渲染依据：锚点 / 纯文本+登录说明 / 未记录占位。
   * `raw` 是**原样记录值**，只作文本展示（Vue 转义后不执行），**任何情况下都不进 href**；
   * `href` 只来自 publicLinkHref（公开内容页 + 协议判据双通过）。
   */
  function linkRenderState (record) {
    const href = publicLinkHref(record)
    const raw = resultValue(record, 'url')
    if (href) return { kind: 'anchor', href, source: publicContentLink(record).source, raw }
    if (raw) return { kind: 'plain', href: '', source: 'none', raw }
    return { kind: 'absent', href: '', source: 'none', raw: '' }
  }

  function linkSourceHint (state) {
    if (state.kind !== 'anchor') return ''
    return state.source === 'derived' ? t('historyPage.detailLinkDerivedHint') : ''
  }

  /** 只有「确实是 http(s) 页面地址」才标「需登录平台查看」；非 http 的畸形值不套这句说明 */
  function linkLoginWallHint (state) {
    if (state.kind !== 'plain' || !safeHttpUrl(state.raw)) return ''
    return t('historyPage.detailLinkLoginWallHint')
  }

  function cardLinkUrl (record) {
    return publicLinkHref(record)
  }

  async function openCardLink (record) {
    const url = cardLinkUrl(record)
    if (!url) return
    // 已知取舍（QM-6 MINOR-3）：record.id 缺失（undefined/null）的记录共享 '' 守卫键——
    // 另一张无 id 卡片在途时本卡点击被吞一次，自愈且无泄漏；生产数据 id 由 SQLite 主键保证非空。
    const recordKey = String(record?.id ?? '')
    if (openingCardIds.has(recordKey)) return
    openingCardIds.add(recordKey)
    try {
      const tabId = await tabStore.createTab({
        url,
        platform: String(record?.platform || ''),
        title: t('historyPage.cardTabTitle', { title: recordTitle(record) }),
      })
      if (tabId) {
        actionMessage.value = t('historyPage.cardLinkOpened')
        return
      }
      window.open(url, '_blank')
    } catch {
      // createTab 合同上不抛错；此处兜底未来实现漂移，不让点击变成未捕获异常
      actionMessage.value = t('historyPage.cardLinkOpenFailed')
    } finally {
      openingCardIds.delete(recordKey)
    }
  }

  return {
    publicContentLink,
    publicLinkHref,
    isCardClickable,
    isDraftRecord,
    cardClickHint,
    linkRenderState,
    linkSourceHint,
    linkLoginWallHint,
    cardLinkUrl,
    openCardLink,
  }
}
