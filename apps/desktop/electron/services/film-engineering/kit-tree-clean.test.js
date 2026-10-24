// @ts-check
'use strict'
/**
 * kit-tree-clean 契约测试（PR-3b 资产导入 · ⛔ 精确清单清树）
 *
 * 覆盖：
 *   ① `manifestFromFileList` —— 由文件清单推出目录清单；
 *   ② `collectTreeManifest` —— 自走一遍树取精确清单（软链/联接点按**叶子**处理，不跟随）；
 *   ③ `removeTreeByManifest` —— 逐个 unlink + 自底向上 rmdir 空目录 + 根目录最后删；
 *   ④ **⛔ R0 结构锁**（本文件最重要的一条）：导入链路的源文件里**不得出现
 *      `rm`/`rmSync`/`rmdir` + `recursive` 的组合** —— 那是本仓 5 次误删事故的同型原语。
 *
 * ⚠ 第 ④ 条是**机械锁**：初版 `kit-import-swap.js` 的 ⑥ 步写的就是
 *   `fs.promises.rm(bakDir, { recursive: true, force: true })`
 *   （2026-10-23 验证层外部评审 codex i2 命中）⇒ 这条锁在它**存在时就是红的**，
 *   靠人读代码发现不了 —— 它必须先于事故存在。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  manifestFromFileList,
  collectTreeManifest,
  removeTreeByManifest,
} = require('./kit-tree-clean')

const SERVICE_DIR = __dirname

function tmpDir (tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kit-tree-' + (tag || 'x') + '-'))
}

describe('kit-tree-clean: 清单推导', () => {
  it('由文件清单推出目录清单（含嵌套层级）', () => {
    const m = manifestFromFileList(['a.json', 'prompts/tasks/t1/zh/s.md'])
    expect(m.files).toEqual(['a.json', 'prompts/tasks/t1/zh/s.md'])
    expect(m.dirs).toContain('prompts')
    expect(m.dirs).toContain('prompts/tasks')
    expect(m.dirs).toContain('prompts/tasks/t1')
    expect(m.dirs).toContain('prompts/tasks/t1/zh')
  })

  it('空清单 ⇒ 空清单（不炸）', () => {
    const m = manifestFromFileList([])
    expect(m.files).toEqual([])
    expect(m.dirs).toEqual([])
  })
})

describe('kit-tree-clean: 自走树取清单', () => {
  it('收集文件与目录；软链按叶子处理（不跟随、不进树）', async () => {
    const root = tmpDir('m')
    fs.mkdirSync(path.join(root, 'd', 'e'), { recursive: true })
    fs.writeFileSync(path.join(root, 'd', 'e', 'f.txt'), 'x', 'utf8')
    fs.writeFileSync(path.join(root, 'top.json'), '{}', 'utf8')
    // 软链：指向树外 —— 清单里必须是**叶子**，绝不能被跟随进去
    let linked = false
    try {
      fs.symlinkSync(os.tmpdir(), path.join(root, 'link'), 'junction')
      linked = true
    } catch (_e) { /* 无权限 ⇒ 跳过该断言 */ }
    const m = await collectTreeManifest(root)
    expect(m.ok).toBe(true)
    expect(m.files).toContain('top.json')
    expect(m.files).toContain('d/e/f.txt')
    expect(m.dirs).toContain('d')
    expect(m.dirs).toContain('d/e')
    if (linked) {
      expect(m.files).toContain('link')
      expect(m.dirs).not.toContain('link')
    }
  })

  it('根目录不存在 ⇒ 空清单且不抛', async () => {
    const m = await collectTreeManifest(path.join(tmpDir('none'), 'missing'))
    expect(m.ok).toBe(true)
    expect(m.files).toEqual([])
  })
})

describe('kit-tree-clean: 按清单删除', () => {
  it('逐个 unlink + 自底向上 rmdir ⇒ 根目录最后消失', async () => {
    const root = path.join(tmpDir('rm'), 'tree')
    fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true })
    fs.writeFileSync(path.join(root, 'a', 'b', 'f.txt'), 'x', 'utf8')
    fs.writeFileSync(path.join(root, 'a', 'g.txt'), 'y', 'utf8')
    const m = await collectTreeManifest(root)
    const res = await removeTreeByManifest({ rootDir: root, manifest: m })
    expect(res.ok).toBe(true)
    expect(fs.existsSync(root)).toBe(false)
  })

  it('清单外的文件**不动**（不越权删除）', async () => {
    const root = path.join(tmpDir('rm2'), 'tree')
    fs.mkdirSync(path.join(root, 'a'), { recursive: true })
    fs.writeFileSync(path.join(root, 'a', 'keep.txt'), 'x', 'utf8')
    const m = manifestFromFileList(['a/other.txt'])
    const res = await removeTreeByManifest({ rootDir: root, manifest: m })
    // 根目录非空 ⇒ 根目录删不掉（但**不报错删坏东西**）
    expect(res.ok).toBe(false)
    expect(fs.existsSync(path.join(root, 'a', 'keep.txt'))).toBe(true)
  })
})

describe('⛔ R0 结构锁：导入链路不得使用递归删除原语', () => {
  /**
   * 去掉**注释**（保留字符串内容）—— 注释里可以、也**应该**引用被禁的写法作为说明
   * （例如「初版写的是 `rm(dir, {recursive:true})` ⇒ 违反铁律」），
   * 锁只盯**真实代码**。
   */
  function stripComments (src) {
    let out = ''
    let quote = null
    for (let i = 0; i < src.length; i++) {
      const c = src[i]
      const n = src[i + 1]
      if (quote) {
        out += c
        if (c === '\\') { out += n; i++; continue }
        if (c === quote) quote = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue }
      if (c === '/' && n === '*') {
        const end = src.indexOf('*/', i + 2)
        i = end < 0 ? src.length : end + 1
        continue
      }
      if (c === '/' && n === '/') {
        const end = src.indexOf('\n', i)
        i = end < 0 ? src.length : end
        continue
      }
      out += c
    }
    return out
  }

  it('kit-import* / kit-tree-clean / kit-mirror-check 源文件里不得出现 rm/rmdir + recursive', () => {
    const files = fs.readdirSync(SERVICE_DIR)
      .filter((f) => /^kit-(import|tree-clean|mirror-check).*\.js$/.test(f) && !f.endsWith('.test.js'))
    expect(files.length).toBeGreaterThan(0)
    const offenders = []
    for (const f of files) {
      const src = stripComments(fs.readFileSync(path.join(SERVICE_DIR, f), 'utf8')).replace(/\s+/g, ' ')
      const re = /\b(rm|rmSync|rmdir)\s*\(/g
      let m
      while ((m = re.exec(src)) !== null) {
        // 调用参数窗口（跨行已被压成单行）里出现 recursive ⇒ 违规
        const win = src.slice(m.index, m.index + 240)
        if (/recursive/.test(win)) offenders.push(f + ' :: ' + win.slice(0, 120))
      }
    }
    expect(offenders, '⛔ 递归删除原语（rm/rmdir + recursive）出现在导入链路里：\n' + offenders.join('\n')).toEqual([])
  })
})
