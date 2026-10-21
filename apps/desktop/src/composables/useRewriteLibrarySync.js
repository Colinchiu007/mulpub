/**
 * 改写结果 → 文案库回写（composable）——rewrite-view-decompose（2026-10-21）。
 *
 * 为什么独立：`RewriteView.vue` 触到 max-lines 登记容差（1430/1630），再增 200 行即红。
 * 「回写文案库」是改写成功后的**旁路副作用**，有两条互斥写入路径 + 一套 key 规则，
 * 与改写主流程（请求 / 取消 / 结果解析）没有耦合。
 *
 * 语义边界（务必保持，拆出去不等于可以改）：
 * - **两条路径互斥**：交接场景（from=collection 带 fromKey）按 fromKey 覆盖原记录；
 *   普通场景按「正文哈希」稳定 key 写入。同一场景**不得**两条都走 —— 双模型评审 MAJOR-2/3
 *   记录过：两条都走会让同一次改写在文案库里落双份记录。
 * - **失败静默**：回写失败不阻塞改写主流程（改写已成功，用户不该为此看到报错）。
 * - **key 形态**：`rewrite:<正文哈希>`（普通场景）保证同一正文连续改写视为更新（覆盖），
 *   不同正文追加新记录，避免文案库被重复改写刷屏。
 *   ⚠ djb2 算法**不得改**：改它会让历史上按 djb2 写入的记录全部失联。
 */
import { useCopyLibrary } from '@/composables/useCopyLibrary'

/**
 * @param {{
 *   rewriteResult: import('vue').Ref<string>,
 *   rewriteTitle: import('vue').Ref<string>,
 *   platform: import('vue').Ref<string>,
 * }} deps - 改写结果与标题、当前平台（由调用方持有，本文件只读）
 * @returns {{
 *   syncHandoffToLibrary: (handoff: object|null) => Promise<void>,
 *   syncResultToLibrary: () => Promise<void>,
 * }}
 */
export function useRewriteLibrarySync (deps) {
  const { rewriteResult, rewriteTitle, platform } = deps
  const { upsertRewrite: upsertCopyRewrite } = useCopyLibrary()

  /**
   * 改写成功后回写文案库（同一 fromKey 覆盖为最新结果；失败静默，不影响改写主流程）。
   * @param {object|null} handoff - 本次改写对应的交接载荷（一次性，由 startRewrite 捕获后传入）
   */
  async function syncHandoffToLibrary (handoff) {
    if (!handoff || !handoff.fromKey || !rewriteResult.value.trim()) return
    try {
      await upsertCopyRewrite({
        fromKey: handoff.fromKey,
        fromTitle: handoff.fromTitle || '',
        title: rewriteTitle.value || handoff.title || '',
        content: rewriteResult.value,
        platform: handoff.platform || '',
        sourceUrl: handoff.sourceUrl || '',
      })
    } catch {
      // 文案库回写失败不阻塞改写主流程
    }
  }

  /**
   * 改写成功后写入文案库（2026-09-18 用户要求：改写完成后的文案应进入文案库）。
   *
   * 与 syncHandoffToLibrary 的区别：
   * - syncHandoffToLibrary 仅处理「从文案库进入改写」的交接场景（按 fromKey 覆盖原记录）；
   * - syncResultToLibrary 覆盖所有改写成功场景，按「正文哈希」稳定 key 写入：
   *   同一正文连续改写视为更新（覆盖），不同正文追加新记录，避免文案库被重复改写刷屏。
   * 交接场景（libraryHandoff 存在）由 syncHandoffToLibrary 按 fromKey 更新原记录，
   * 此处跳过，避免同一条改写产生双份记录（双模型评审 MAJOR-2/3）。
   * 失败静默，不影响改写主流程。
   */
  async function syncResultToLibrary () {
    if (!rewriteResult.value.trim()) return
    try {
      // 稳定 key：基于改写结果正文的简单哈希（同一正文连续改写 → 覆盖更新）
      const contentKey = hashString(rewriteResult.value)
      await upsertCopyRewrite({
        fromKey: 'rewrite:' + contentKey,
        fromTitle: '',
        title: rewriteTitle.value || '',
        content: rewriteResult.value,
        platform: platform.value || '',
        sourceUrl: '',
      })
    } catch {
      // 文案库回写失败不阻塞改写主流程
    }
  }

  return { syncHandoffToLibrary, syncResultToLibrary }
}

/** 简单字符串哈希（djb2）：用于文案库稳定 key，避免同一正文重复改写刷屏 */
function hashString (str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}
