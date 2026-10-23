// @ts-check
/**
 * 发布结果/发布记录「查看文章」的应用内打开 —— 接线与形状锁（TDD 红灯先行）。
 *
 * 为什么需要这把锁（而不是只测行为）：
 *  1. 最省事的改法是把 `<a>` 换成 `<button>` 或干脆删掉锚点——但那会击穿
 *     `src/href-scheme-contract.test.js` 的两条**规模下界**锁（带 `:href` 的锚点 ≥6、
 *     `target="_blank"` 的锚点 ≥6，注释明写其存在意义是「防解析退化后判据恒真」）。
 *     所以形状必须保持：仍是锚点、仍有 `:href`、仍有 `target="_blank" rel="noopener"`。
 *  2. 若用 `@click.prevent` 这类无条件拦截，Ctrl/⌘ 点击会被劫持，破坏浏览器语义。
 *     故本锁要求：拦截必须经由组合式函数（`handleLinkClick`）而**不是** `.prevent` 修饰符，
 *     由函数内部的 isPlainLeftClick 决定要不要接管。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '..')

function readSource (rel) {
  return readFileSync(path.join(SRC, rel), 'utf8')
}

/** 取出含指定 class 的那个 <a ...> 起始标签（跨行） */
function anchorTagWithClass (source, className) {
  const re = new RegExp('<a\\b[^>]*\\b' + className + '\\b[^>]*>', 'm')
  const m = source.match(re)
  return m ? m[0] : null
}

const CASES = [
  { file: 'views/Publish.vue', className: 'result-link', label: '发布结果区「查看文章」' },
  { file: 'views/PublishHistory.vue', className: 'detail-link', label: '发布记录详情「公开链接」' },
]

describe('应用内打开「查看文章」—— 锚点形状与拦截接线', () => {
  for (const c of CASES) {
    describe(`${c.label}（${c.file}）`, () => {
      it('仍是锚点且保留 :href / target=_blank / rel=noopener（不得为省事删掉锚点）', () => {
        const tag = anchorTagWithClass(readSource(c.file), c.className)
        expect(tag, `未找到含 .${c.className} 的锚点起始标签`).toBeTruthy()
        expect(tag).toMatch(/:href\s*=\s*"safeHttpUrl\(/)
        expect(tag).toMatch(/target\s*=\s*"_blank"/)
        expect(tag).toMatch(/rel\s*=\s*"noopener"/)
      })

      it('点击经由组合式函数接线（而不是裸 @click.prevent）', () => {
        const tag = anchorTagWithClass(readSource(c.file), c.className)
        expect(tag).toMatch(/@click\s*=\s*"[^"]*InApp\(/)
        // `.prevent` 修饰符是无条件拦截，会劫持 Ctrl/⌘ 点击 ⇒ 禁止
        expect(tag).not.toMatch(/@click\.prevent/)
      })

      it('接线目标是 useInAppLink 导出的处理器（而非就地内联实现）', () => {
        const source = readSource(c.file)
        expect(source).toMatch(/useInAppLink\(\)/)
        // 处理器必须从组合式函数解构出来（允许别名，但必须同源于同一 import）
        expect(source).toMatch(/\{\s*handleLinkClick[^}]*\}\s*=\s*useInAppLink\(\)/)
      })

      it('用组合式函数而非就地重写（单一实现，两处行为不漂移）', () => {
        const source = readSource(c.file)
        expect(source).toMatch(/useInAppLink/)
      })    })
  }
})
