// @ts-check
/**
 * 主进程 → executeJavaScript 的安全值传递原语
 *
 * 背景（体检报告 P2 安全小项 / webview-manager localStorage 注入）：
 * 常见写法是 `'var data = ' + JSON.stringify(obj)`，把主进程数据直接拼进脚本文本。
 * JSON.stringify 会转义引号与反斜杠，所以「逃出字符串字面量」在当前 V8（ES2019 起
 * 允许 U+2028/U+2029 出现在字符串字面量内）下确实不可逃逸 —— 但这层安全性完全依赖
 * 运行时的语言版本宽容度：一旦这段文本被搬进 HTML 上下文（<script>、内联事件处理器），
 * 还要再过一层 HTML 解析，`</script>`、`<!--` 就会提前改写脚本边界。故把「不依赖语言
 * 版本宽容度」的转义固化成单一原语，由调用方共用。
 *
 * 口径：
 * - 产出字面量为单引号包裹的文本：`'`、`< > &`、U+2028/U+2029 一律 \uXXXX 转义，
 *   其余字符（含非 ASCII）按 JSON.stringify 原样输出，不影响字面量边界；
 * - 字面量的值是 **JSON 文本**，页面侧需 JSON.parse 还原（buildEvalScript 已代劳）；
 * - 还原语义与 JSON.stringify 输入完全一致（调用方用 JSON.parse 取回，不改变数据）；
 * - 不可序列化的输入（undefined / function / symbol / 循环引用）抛 TypeError，
 *   由调用方决定降级 —— 静默产出 'null' 会把「凭证没恢复」伪装成「恢复成功」。
 */

// JSON.stringify 输出里仍需额外处理的字符：
//  - \ : 字面量本身还要过一层 JS 词法解析，不加倍则 JSON 的 \n \" 等转义序列会被
//        JS 提前消耗成真实控制字符，交给 JSON.parse 时报「Bad control character in string literal」
//  - '  : 本原语用单引号包裹字面量
//  - < > & : HTML 上下文二次解析（</script>、<!--、实体）
//  - U+2028 / U+2029 : 历史上是 JS 字符串字面量的行终止符
const ALWAYS_ESCAPED = new Set(["'", '<', '>', '&', '\u2028', '\u2029'])

/** 把单个字符转成 4 位 \uXXXX 转义序列 */
function _unicodeEscape (ch) {
  return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
}

/**
 * 生成可安全嵌入 JS 脚本文本的字符串字面量（内容为 value 的 JSON 表示）。
 * @param {any} value 可 JSON 序列化的值
 * @returns {string} 形如 '{"a":"b"}' 的字面量源码，可直接拼进 executeJavaScript
 */
function toSafeJsLiteral (value) {
  const json = JSON.stringify(value)
  if (json === undefined) {
    throw new TypeError('toSafeJsLiteral: value is not JSON-serializable (undefined/function/symbol)')
  }
  let out = ''
  // 产出的是「JS 字符串字面量，内容为 JSON 文本」，所以要过两层词法：
  // 反斜杠必须先加倍，否则 JS 词法会把 JSON 的 \n 消耗成真实换行，JSON.parse 再看到就报错了。
  for (const ch of json) {
    if (ch === '\\') out += '\\\\'
    else out += ALWAYS_ESCAPED.has(ch) ? _unicodeEscape(ch) : ch
  }
  return "'" + out + "'"
}

/**
 * 组装「把主进程数据交给页面内代码」的完整脚本：每个参数先 JSON.parse 还原再执行 body。
 * 调用方只写业务 body，不必关心序列化 —— 避免各自重复拼字符串。
 * @param {string} paramNames 形如 'data'（单个）或 'a, b'（多个，与 values 一一对应）
 * @param {any[]} values 与 paramNames 对应的可序列化值
 * @param {string} body IIFE 函数体（可使用已声明的参数变量）
 * @returns {string} 可直接交给 executeJavaScript 的脚本
 */
function buildEvalScript (paramNames, values, body) {
  const names = String(paramNames).split(',').map((n) => n.trim()).filter(Boolean)
  if (names.length !== values.length) {
    throw new TypeError('buildEvalScript: paramNames/values 数量不一致 (' + names.length + ' vs ' + values.length + ')')
  }
  const decl = names
    .map((name, i) => '  var ' + name + ' = JSON.parse(' + toSafeJsLiteral(values[i]) + ');')
    .join('\n')
  return '(function () {\n' + decl + '\n' + body + '\n})()'
}

module.exports = { toSafeJsLiteral, buildEvalScript }
