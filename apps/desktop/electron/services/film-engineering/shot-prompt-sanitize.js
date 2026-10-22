// @ts-check

/**
 * **不可信输入**的处理与**清单闸门**（第 12-16 轮评审 · security/feasibility）。
 *
 * · kit 自由文本（色盘行 / 角色描述）、逐镜字段、模板带来的变量名 ⇒ 全部是不可信输入
 *   （`userData/film-kit` 可被用户或外部进程写；项目文件可被用户编辑）。
 * · 纪律：**剥控制字符与零宽字符 → 长度封顶 → 超限不提供**（进 `missing` ⇒ `deliverable=false`），
 *   **绝不静默截断**（截断会把「资产异常」伪装成「资产正常」）。
 * · 清单闸门是**实现里强制**的，不是测试里的断言 —— 断言在实现没做时只会红，**闸门**才是防线。
 */

const crypto = require('crypto')
const { TASK_VARS, MAX_MISSING_NAME_LEN, MAX_MISSING_ENTRIES, MAX_MISSING_BYTES } = require('./shot-prompt-contract')

/**
 * 清单闸门（条目数 + 字节数两道，第 14 轮 i3 / 第 15-16 轮 i2）。
 * **实现里的闸门**，不是测试里的断言。
 */
function capMissingList (list) {
  const taskVarEntries = list.filter(m => TASK_VARS.includes(m.name))
  const otherEntries = list.filter(m => !TASK_VARS.includes(m.name))
  const kept = taskVarEntries.concat(otherEntries.slice(0, MAX_MISSING_ENTRIES))
  const out = kept.slice()
  while (out.length > taskVarEntries.length &&
    Buffer.byteLength(JSON.stringify(out), 'utf8') > MAX_MISSING_BYTES) {
    out.pop()
  }
  return { list: out, truncated: out.length < list.length }
}

/**
 * 剥除**控制字符**与**零宽字符**（第 13/15 轮 i5/i3 · security）。
 *
 * kit 自由文本（色盘行、角色描述）与模板带来的变量名都来自**不可信**输入：
 * 控制字符能破坏提示词结构，零宽字符能**藏**内容（肉眼看不见、日志里也不显眼）⇒ 两样都剥掉。
 * ⚠ 长度上限按**净化后**的文本计（否则「先判长、后净化」会漏）。
 */
function sanitizeUntrustedText (s) {
  return String(s == null ? '' : s)
    // C0 / C1 控制字符（含换行与 DEL）
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    // 零宽与方向控制（U+200B-200F、U+202A-202E、U+2060-2064、U+FEFF、BOM）
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '')
}

/**
 * 变量名截断到上限 + 剥除控制字符（第 12 轮 i5 / 第 13 轮 i5 / 第 15 轮 i3）。
 *
 * `templateVar` / `badVarName` 的名字来自**kit 任务模板**（不可信输入）⇒
 * 一个超长名字会把清单撑爆（它**落盘**）；一个带**控制字符/换行**的名字会把
 * UI 与日志搅乱（面板按名字分行渲染，日志按行打印）⇒ 两样都要处理。
 *
 * 截断后仍能定位（首 63 字符 + 省略号），`reason` 仍说明发生了什么。
 */
function clampVarName (name) {
  const raw = typeof name === 'string' ? name : String(name == null ? '' : name)
  let s = sanitizeUntrustedText(raw)
  if (s.length <= MAX_MISSING_NAME_LEN) return s
  // ⚠ 不切开代理对（第 14 轮 i6）：截断点落在**高/低代理**之间会留下半个 emoji
  //   （确定性不受影响 —— 同输入同输出 —— 但**显示**是坏的）
  // ⚠ 截断长度**要把后缀算进去**（第 16 轮 i7）：`…` 1 + `#` 1 + 哈希 6 = 8
  const SUFFIX_LEN = 8
  let cut = s.slice(0, MAX_MISSING_NAME_LEN - SUFFIX_LEN)
  const last = cut.charCodeAt(cut.length - 1)
  // 末位是**代理**（高 0xD800-0xDBFF 或低 0xDC00-0xDFFF）⇒ 它的另一半被切掉了 ⇒ 去掉这半个
  if (last >= 0xd800 && last <= 0xdfff) cut = cut.slice(0, cut.length - 1)
  // ⚠ 截断后**加短哈希后缀**（第 16 轮 i7）：两个不同的长名字可能前 63 字相同 ⇒
  //   截断后**同名** ⇒ 面板按 name+reason 去重会把两条并成一条 ⇒ 条目数与清单不一致。
  //   加 6 位哈希 ⇒ 名字仍可读，但**唯一**。
  const suffix = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 6)
  return cut + '…#' + suffix
}

module.exports = {
  capMissingList,
  sanitizeUntrustedText,
  clampVarName,
}
