// @ts-check
/**
 * gen-video-title — 热门选题「生成视频 → 去发布」的标题生成（fix-hot-topics-genvideo-title，2026-10-17）。
 *
 * 背景：修复前【去发布】带入的标题是改写正文的前 100 字（`truncateTitle(sourceText, 100)`），
 * 因为标题在整条链路上从来不是一个独立生成物。本期把标题变成：
 *   ① AI 按爆款元素独立生成（默认文字推理模型）；
 *   ② 无模型 / 生成失败 → 降级为**原始选题文本**（不是正文切片）。
 *
 * 分层（重要）：
 *   - **prompt 构造与 LLM 调用在主进程**（`electron/ipc-handlers/gen-video-title.js`）。
 *     理由：渲染层此前没有任何 LLM prompt 构造先例（全在 electron/services/*-stages.js），
 *     且 `--cjk` 门禁扫描 apps/desktop/src 下全部字符串字面量 —— prompt 中文指令放在渲染层
 *     会撞门禁，把 prompt 下沉到主进程既符合既有模式也不触发扫描。
 *   - **本模块只放降级链决策纯函数**：`resolveGenVideoTitle` 是唯一决策点，
 *     渲染层只负责「取上下文 → 调 IPC → 调纯函数 → 拼 query」。
 *     这样降级的每一格都能在无 IPC、无 Vue、无 LLM 的环境下穷举测试。
 */

/**
 * 标题硬上限（百家号 DEFAULT_CONTENT_LIMITS.titleMax）。
 * 与 publish-from-project.truncateTitle 的默认值一致 —— 改一处必须同步另一处。
 */
export const GEN_VIDEO_TITLE_MAX = 100

/** AI 标题的理想长度约束（写进主进程 system prompt；硬截断仍走 GEN_VIDEO_TITLE_MAX）。 */
export const GEN_VIDEO_TITLE_IDEAL = 30

function toText (value) {
  return typeof value === 'string' ? value : ''
}

function truncateByCodePoints (text, max) {
  const chars = [...text]
  if (chars.length <= max) return text
  return chars.slice(0, max).join('')
}

/**
 * 标题降级链决策（唯一真源，PRD §4.3）。
 *
 *   topicText 空            → { title:'',    source:'none'  }  （不注入 query，不调 AI）
 *   aiAvailable !== true    → { title:topic, source:'topic' }  （不调 AI）
 *   AI 标题清洗后非空       → { title:ai,    source:'ai'    }
 *   其余（空/非字符串/仅思维链）→ { title:topic, source:'topic' }
 *
 * @param {{topicText?: unknown, aiTitle?: unknown, aiAvailable?: unknown, max?: unknown}} [input]
 * @returns {{title: string, source: 'ai'|'topic'|'none'}}
 */
export function resolveGenVideoTitle (input = {}) {
  const topic = toText(input?.topicText).trim()
  if (!topic) return { title: '', source: 'none' }

  const maxRaw = Number(input?.max)
  const max = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : GEN_VIDEO_TITLE_MAX

  if (input?.aiAvailable === true) {
    const aiTitle = toText(input?.aiTitle).trim()
    if (aiTitle) return { title: truncateByCodePoints(aiTitle, max), source: 'ai' }
  }
  return { title: truncateByCodePoints(topic, max), source: 'topic' }
}
