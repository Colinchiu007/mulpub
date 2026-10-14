/**
 * 图文卡片分页渲染桥接层（渲染端唯一接触 IPC 的入口）
 *
 * 方法名 = preload 暴露的扁平方法名（`electronAPI.cardsRender`）；通道名只在 preload 侧出现
 * （`check-ipc-bridge` 按 preload 源码字面量对账）。
 *
 * 失败语义：无 electronAPI / 权限不足 → `invokeWithFallback` 的 fallback（`code: -1`），
 * 由调用方映射成「模块暂不可用」；主进程返回的领域码原样透传（UI 按码取文案）。
 *
 * ★ 与 `quick-collect.js` 的关键差异：本特性**必须把 warnings 透出**。
 *   分页器的 warnings（尤其 `item-exceeds-page` / `page-limit-reached`）意味着
 *   用户的文本超出一页/触达页数上限 —— 用户**必须知情**，不得静默丢弃。
 *   故返回值不只是 `{ code, data }`，还要带 `warnings`（主进程侧由 card-capture 给出）。
 */
import { invokeWithFallback } from './electron-bridge'

/** 无 electronAPI / 权限不足时的兜底（不伪装成成功，让调用方能区分「暂不可用」与「渲染失败」） */
const CARDS_FALLBACK = { code: -1, message: 'CARDS_IPC_UNAVAILABLE', data: [], warnings: [] }

/**
 * 把长文按页渲染成 PNG。
 *
 * @param {object} payload
 * @param {string[][]} payload.pages 分页结果（每页是块数组）
 * @param {number} [payload.widthPx] 视口宽
 * @param {number} [payload.heightPx] 视口高
 * @returns {Promise<{ code: number, data?: string[], warnings?: string[], message?: string }>}
 *   `data` 为 PNG 文件路径数组（长度 === pages.length）；`warnings` 为非空即必须展示
 */
export async function cardsRender (payload) {
  return invokeWithFallback('cardsRender', CARDS_FALLBACK, payload)
}
