// @ts-check
/**
 * 提示词块结构检查（前端，非阻断提示）
 *
 * 用途：片段编辑时提示用户「这段提示词少了哪一块」。影视工程的能力积累之一就是**结构化的提示词块**
 * （GEO 空间布局 / 动作时间线 / 音效 / 角色表演 / 正向约束），缺块往往会直接体现在成片质量上
 * （人物漂移、空间错乱、缺音效）。因此这里给**黄色提示但不阻断保存**——用户可能有意精简。
 *
 * 单一真源纪律：块标题的权威定义在 `electron/services/film-engineering/shot-library.js` 的
 * `BLOCK_HEADINGS`（后端据此做 copy-blocks 抽取）。渲染端不能 require 主进程 CJS，故此处复刻一份，
 * 并由 `auto-frontend-utils.test.js` 的「后端单一真源对账」用例做**源码文本对账**防漂移。
 * 修改任一侧都必须同跑该用例（2026-10-19 这次就是后端补齐为 7 项而前端未同步，被该用例在 CI 上抓到）。
 */
export const PROMPT_BLOCK_HEADINGS = Object.freeze([
  'SCENE CONTEXT',
  'GEO SPATIAL LAYOUT',
  'ACTION TIMING',
  'AUDIO',
  'CHARACTER ACTING',
  'STYLE',
  'POSITIVE CONSTRAINTS',
])

/** 角色行标记（`[CHARACTER: ROKO]`）：与块标题不同类，单独判据 */
export const CHARACTER_LINE_PATTERN = /\[CHARACTER:\s*[^\]]+\]/i

/**
 * 检查提示词包含哪些必备块
 * @param {string} prompt
 * @returns {{missing: string[], present: string[], hasCharacterLine: boolean, ok: boolean}}
 */
export function checkPromptBlocks (prompt) {
  const text = typeof prompt === 'string' ? prompt : ''
  const present = []
  const missing = []
  for (const heading of PROMPT_BLOCK_HEADINGS) {
    // 行首（允许前导空白）匹配块标题，后面允许接括号后缀或结尾冒号 —— 与后端
    // `shot-library.js` 的 BLOCK_HEADING_RE 同形态，否则真实提示词里带后缀的标题
    // 会被判成「缺块」（2026-10-19 与后端同步修正）。
    const re = new RegExp(
      '^\\s*' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b\\s*(?::|—|-|\\(|$)',
      'im'
    )
    if (re.test(text)) present.push(heading)
    else missing.push(heading)
  }
  const hasCharacterLine = CHARACTER_LINE_PATTERN.test(text)
  return { missing, present, hasCharacterLine, ok: missing.length === 0 }
}
