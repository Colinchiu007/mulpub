/**
 * AppMenu 保存结果的提示装配（2026-10-17）。
 *
 * PRD：ops-center/docs/PRD-ops-center-restart-hint.md
 *
 * 为什么拆成「纯函数 + 适配层」两层（QM-6 评审 i5）
 * ----------------------------------------------
 * 首版 `saveMessageFor(result, ElMessage)` 直接收 Element Plus 的消息对象，
 * 于是「该说什么」和「怎么弹」耦合在一个函数里：换消息库要改纯函数签名，
 * 测试也必须 mock 三个 ElMessage 方法才能断言文案。
 *
 * 现拆为：
 *   - `composeSaveMessage(result, prefix)` —— **纯函数**，只返回
 *     `{ kind, text, duration }`，不碰任何 UI 框架。文案契约在此可完整单测。
 *   - `emitSaveMessage(result, ElMessage, prefix)` —— **适配层**，把上面的结果
 *     派发到具体消息库。它只做「kind → 哪个方法 + 第二参」的映射，
 *     不含任何措辞，故换库只需改这一个函数。
 *
 * 另一层理由（QM-6 评审 i3）：.vue 单文件在 node 环境无法直接 import，
 * 所以「保存成功后该说什么」必须放在可被 import 的 .js 里才可测。
 */
import { RESTART_HINT, RESTART_HINT_DURATION, shouldShowRestartHint } from '../constants/runtime-delivery'

/**
 * 组装保存结果的提示（纯函数，无 UI 依赖）。
 *
 * @param {{ok: boolean, count?: number, corrections?: string[], detail?: string}} result
 * @param {string} [prefix] 成功时的前缀动作名（如「已恢复默认」）；省略则用「已保存 N 项」
 * @returns {{kind: 'success'|'warning'|'error', text: string, duration: number}}
 */
export function composeSaveMessage (result, prefix) {
  if (!shouldShowRestartHint(result)) {
    return {
      kind: 'error',
      text: (result && result.detail) ? result.detail : '保存失败',
      duration: RESTART_HINT_DURATION,
    }
  }

  const corrections = Array.isArray(result.corrections) ? result.corrections : []

  if (corrections.length) {
    return {
      kind: 'warning',
      text: (prefix || '已保存')
        + '。以下核心入口被系统纠正为「显示在一级导航」：' + corrections.join('、')
        + '；' + RESTART_HINT,
      duration: RESTART_HINT_DURATION,
    }
  }

  const head = prefix || ('已保存 ' + (result.count ?? 0) + ' 项')
  return {
    kind: 'success',
    text: head + '；' + RESTART_HINT,
    duration: RESTART_HINT_DURATION,
  }
}

/**
 * 适配层：把 composeSaveMessage 的结果派发到 Element Plus 的 ElMessage。
 *
 * 换消息库只需改这一个函数（映射表），不必碰纯函数与测试。
 *
 * @param {{ok: boolean, count?: number, corrections?: string[], detail?: string}} result
 * @param {{success: Function, warning: Function, error: Function}} ElMessage
 * @param {string} [prefix]
 * @returns {'success'|'warning'|'error'} 实际走了哪条分支
 */
export function emitSaveMessage (result, ElMessage, prefix) {
  const m = composeSaveMessage(result, prefix)
  // error 不传 opts：Element Plus 的 error 默认时长与 success/warning 相同，
  // 而失败提示通常更短（用户要立刻重试），给它 6 秒反而碍事。
  // 这也让「只有成功/警告路径需要长时长」这个意图在代码里显式可见。
  if (m.kind === 'success') ElMessage.success(m.text, { duration: m.duration })
  else if (m.kind === 'warning') ElMessage.warning(m.text, { duration: m.duration })
  else ElMessage.error(m.text)
  return m.kind
}
