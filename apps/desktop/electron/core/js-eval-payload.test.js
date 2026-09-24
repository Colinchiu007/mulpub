// @ts-check
/**
 * 主进程 → executeJavaScript 值传递原语测试（体检报告 P2 安全小项）
 *
 * 关注点不是「格式化好不好看」，而是「拼进脚本文本后能否逃出字面量边界」。
 * 这些用例用 new Function 真实求值产出的脚本，等价于页面侧的执行语义。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { toSafeJsLiteral, buildEvalScript } = require('./js-eval-payload')

/** 求值字面量（页面侧语义：先当作 JS 源码求值，再 JSON.parse 还原）*/
function evalLiteral (lit) {
  return JSON.parse(new Function('return (' + lit + ')')())
}

/** 求值完整脚本（IIFE 的返回值就是 executeJavaScript 的完成值）*/
function evalScript (script) {
  return new Function('return (' + script + ')')()
}

describe('toSafeJsLiteral', () => {
  it('往返保真：结构、中文、引号、换行、反斜杠都不变形', () => {
    const value = {
      token: "a'b\"c",
      multiline: 'line1\nline2',
      win: 'C:\\Users\\demo\\file',
      zh: '中文令牌',
      nested: { arr: [1, '2', true, null] },
    }
    expect(evalLiteral(toSafeJsLiteral(value))).toEqual(value)
  })

  it("单引号被转义：注入内容无法闭合字面量后追加代码", () => {
    const payload = "'); globalThis.__pwned = 1; //("
    const lit = toSafeJsLiteral({ k: payload })
    // 除包裹用的首尾单引号外，体内不得再出现裸单引号
    expect(lit.slice(1, -1)).not.toContain("'")
    const sandbox = { globalThis: {} }
    new Function('globalThis', 'return (' + lit + ')')(sandbox.globalThis)
    expect(sandbox.globalThis.__pwned).toBeUndefined()
    expect(evalLiteral(lit)).toEqual({ k: payload })
  })

  it('U+2028/U+2029 被转义（ES2018 及更早引擎会把它当行终止符）', () => {
    const value = { ls: 'a\u2028b', ps: 'a\u2029b' }
    const lit = toSafeJsLiteral(value)
    expect(lit).toContain('\\u2028')
    expect(lit).toContain('\\u2029')
    expect(evalLiteral(lit)).toEqual(value)
  })

  it('< > & 转义：文本被搬进 HTML 上下文时 </script> 无法提前闭合', () => {
    const value = { html: '</script><script>alert(1)</script>' }
    const lit = toSafeJsLiteral(value)
    expect(lit).not.toContain('<')
    expect(lit).not.toContain('>')
    expect(lit).not.toContain('&')
    expect(evalLiteral(lit)).toEqual(value)
  })

  it('控制字符仍由 JSON.stringify 负责转义（不产出裸换行）', () => {
    const lit = toSafeJsLiteral('a\nb\tc\r' + String.fromCharCode(7))
    expect(lit.split('\n')).toHaveLength(1)
    expect(evalLiteral(lit)).toBe('a\nb\tc\r\u0007')
  })

  it('不可序列化输入抛错，不静默降级为 null', () => {
    expect(() => toSafeJsLiteral(undefined)).toThrow(TypeError)
    expect(() => toSafeJsLiteral(() => {})).toThrow(TypeError)
    const circular = {/** @type{any} */ a: 1 }
    circular.self = circular
    expect(() => toSafeJsLiteral(circular)).toThrow(TypeError)
  })

  it('null / 数字 / 数组等标量原样可还原', () => {
    for (const v of [null, 0, -1.5, true, 'x', [1, '2']]) {
      expect(evalLiteral(toSafeJsLiteral(v))).toEqual(v)
    }
  })
})

describe('buildEvalScript', () => {
  it('把数据作为已声明变量交给 body，内容不参与脚本拼接', () => {
    const script = buildEvalScript('data', [{ token: "x'; evil('" }], 'return Object.keys(data).length')
    expect(evalScript(script)).toBe(1)
  })

  it('多参数按顺序对应', () => {
    const script = buildEvalScript('a, b', ['1', 2], 'return a + ":" + b')
    expect(evalScript(script)).toBe('1:2')
  })

  it('参数名与值数量不一致直接抛错（不静默错位）', () => {
    expect(() => buildEvalScript('a, b', ['1'], 'return a')).toThrow(TypeError)
  })

  it('注入型值只会污染到自己的字符串里，不会改写脚本结构', () => {
    const script = buildEvalScript('data', [{ k: "}); globalThis.__boom=1; //" }], 'return typeof data')
    expect(evalScript(script)).toBe('object')
    expect(/** @type{any} */(globalThis).__boom).toBeUndefined()
  })
})

/**
 * 防复发（QM-5 第 5 步）：把修复点固定成静态不变量。
 * 担心的是「下次改邻近代码时又回到裸拼 JSON.stringify」，而不是运行时回归。
 */
describe('调用方不得再裸拼 JSON.stringify 到 executeJavaScript', () => {
  // webview-manager 拆分后 buildEvalScript 调用落在 tab-lifecycle.js / utils.js
  const targetDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'services', 'webview-manager')
  const src = ['utils.js', 'tab-lifecycle.js'].map(f => fs.readFileSync(path.join(targetDir, f), 'utf8')).join('\n')

  it('webview-manager 的 localStorage 恢复已改用 buildEvalScript', () => {
    expect(src).toContain("require('../../core/js-eval-payload')")
    expect(src).toContain('buildEvalScript(')
  })

  it('不保留「var data = <拼字符串>」的旧写法', () => {
    expect(src).not.toMatch(/var data = ' \+ /)
    expect(src).not.toMatch(/executeJavaScript\(\s*'[\s\S]{0,80}JSON\.stringify/)
  })
})
