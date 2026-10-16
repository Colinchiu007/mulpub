// @ts-check
/**
 * bundled-font-packaging.test.js — 自包含中文字体的打包合同（QM-1 静态维度）
 *
 * 锁什么（2026-10-16，cjk-font-selfcontained）：
 *   ① 字体源文件必须在仓库里（`src/public/fonts/SmileySans-Oblique.otf`）——
 *      历史上它被一次杂项提交连同 public 目录一起删掉，只剩 extraResources 死配置，
 *      每次打包报 `file source doesn't exist from=.../dist/fonts` 却没人发现。
 *   ② 许可证必须随包分发 —— SIL OFL 1.1 的硬性要求（"each copy contains the
 *      above copyright notice and this license"）。
 *   ③ `build.extraResources` 必须声明 `dist/fonts → fonts`，否则字体进不了安装包。
 *   ④ CSS 的 `@font-face` 不得再指向已删除的 Noto 文件（那条 URL 会 404）。
 *
 * 为什么放在 apps/desktop：这是消费方（electron-builder 配置与 renderer 都在这里），
 * 单一真源是 package.json + 仓库文件系统，不需要跨包。
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const pkg = require('../../package.json')

// 本文件位于 apps/desktop/electron/tests/，上四级到 worktree 根
const SRC_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const FONT_DIR = path.join(SRC_ROOT, 'apps', 'desktop', 'src', 'public', 'fonts')
const FONT_FILE = path.join(FONT_DIR, 'SmileySans-Oblique.otf')
const LICENSE_FILE = path.join(FONT_DIR, 'SmileySans-OFL-LICENSE.txt')
const CSS_FILE = path.join(SRC_ROOT, 'apps', 'desktop', 'src', 'styles', 'cohere-design-system.css')
describe('自包含中文字体打包合同（SmileySans-Oblique.otf）', () => {
  describe('契约①：字体源文件在仓库内且非空', () => {
    it('SmileySans-Oblique.otf 存在', () => {
      expect(fs.existsSync(FONT_FILE), `字体文件缺失: ${FONT_FILE}`).toBe(true)
    })

    it('体积在合理区间（防空壳/防误塞巨型文件）', () => {
      const size = fs.statSync(FONT_FILE).size
      expect(size).toBeGreaterThan(1024 * 1024) // 得意黑 otf ≈ 1.91 MB
      expect(size).toBeLessThan(8 * 1024 * 1024) // 上限护栏：中文字体不该超过 8MB
    })

    it('sfnt 魔数正确（OTTO = CFF/OpenType，ffmpeg/sharp 都认）', () => {
      const fd = fs.openSync(FONT_FILE, 'r')
      try {
        const buf = Buffer.alloc(4)
        fs.readSync(fd, buf, 0, 4, 0)
        expect(buf.toString('latin1')).toBe('OTTO')
      } finally {
        fs.closeSync(fd)
      }
    })

    it('不含 WOFF2 副本（ffmpeg/sharp 不认该容器，入库只会占体积）', () => {
      for (const f of fs.readdirSync(FONT_DIR)) {
        expect(f.endsWith('.woff2'), `WOFF2 不应入库: ${f}`).toBe(false)
      }
    })
  })

  describe('契约②：SIL OFL 许可证随包', () => {
    it('许可证文件存在', () => {
      expect(fs.existsSync(LICENSE_FILE), `许可证缺失: ${LICENSE_FILE}`).toBe(true)
    })

    it('许可证是 SIL OFL 1.1 且点名得意黑', () => {
      const text = fs.readFileSync(LICENSE_FILE, 'utf8')
      expect(text).toContain('SIL OPEN FONT LICENSE')
      expect(text).toContain('Version 1.1')
      expect(text).toContain('得意黑')
      expect(text).toContain('SmileySans')
    })
  })

  describe('契约③：extraResources 声明 dist/fonts → fonts', () => {
    it('存在 to === "fonts" 的条目，且 from 指向 dist/fonts', () => {
      const entry = (pkg.build.extraResources || []).find((e) => e && e.to === 'fonts')
      expect(entry, 'build.extraResources 缺少 fonts 条目（字体会进不了安装包）').toBeTruthy()
      expect(entry.from).toBe('dist/fonts')
    })

    it('dist/fonts 有真实来源（Vite publicDir = src/public，构建时会拷过去）', () => {
      // 这条锁的是「extraResources 不再是死配置」——2026-09-04 后它的源被删了，
      // 每次打包都报 file source doesn't exist 却没人追。
      const vitePublic = path.join(SRC_ROOT, 'apps', 'desktop', 'src', 'public')
      expect(fs.existsSync(vitePublic), `src/public 不存在，dist/fonts 永远生成不出来: ${vitePublic}`).toBe(true)
      expect(fs.existsSync(path.join(vitePublic, 'fonts'))).toBe(true)
    })
  })

  describe('契约④：CSS @font-face 不指向已删除的字体', () => {
    it('不再引用 NotoSansCJKsc-Regular.otf / NotoColorEmoji.ttf', () => {
      const css = fs.readFileSync(CSS_FILE, 'utf8')
      expect(css).not.toContain('NotoSansCJKsc-Regular.otf')
      expect(css).not.toContain('NotoColorEmoji.ttf')
    })

    it('@font-face 指向真实存在的 SmileySans-Oblique.otf', () => {
      const css = fs.readFileSync(CSS_FILE, 'utf8')
      expect(css).toContain("font-family: 'Smiley Sans'")
      expect(css).toContain("url('/fonts/SmileySans-Oblique.otf')")
      // local() 兜底必须在 url() 之前：系统已有该字体时不重复下载
      expect(css).toMatch(/src:\s*local\('Smiley Sans'\)/)
    })

    it('UI 字体栈把系统字体放前面、自包含字体放后面（UI 优先非斜体字形）', () => {
      const css = fs.readFileSync(CSS_FILE, 'utf8')
      // 栈首应是 PingFang SC（macOS 非斜体中文字体），得意黑作兜底
      expect(css).toContain(
        "font-family: 'PingFang SC', 'Microsoft YaHei', 'Smiley Sans', ui-sans-serif, system-ui, sans-serif;"
      )
    })
  })

  describe('契约⑤：font-resolver 的 ASCII 副本与 fontconfig 注入可用', () => {
    const { buildFontconfigForSharp, resolveContentCjkFont, ASCII_SAFE_DIR_NAME } = require('../services/font-resolver')

    it('在临时目录能生成可用的 fontconfig（含系统目录 + 字体目录）', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'font-pkg-'))
      try {
        const fc = buildFontconfigForSharp({ tmpRoot: tmp, fontDir: FONT_DIR })
        if (!fc.injected) return // 非 Windows 或异常环境下不强制
        expect(fs.existsSync(fc.fontconfigFile)).toBe(true)
        const text = fs.readFileSync(fc.fontconfigFile, 'utf8')
        expect(text).toContain('<fontconfig>')
        expect(text).toContain('<dir prefix="cwd">')
        expect(text).toContain(FONT_DIR.replace(/\\/g, '/'))
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })

    it('ASCII 目录名是纯 ASCII（ffmpeg 路径敏感性的前提）', () => {
      expect(ASCII_SAFE_DIR_NAME).toMatch(/^[A-Za-z0-9._-]+$/)
    })

    it('解析结果若非空则必为 ASCII 路径', () => {
      const r = resolveContentCjkFont({})
      if (r.fontFile) {
        expect(/^[\x20-\x7E]+$/.test(r.fontFile), `非 ASCII: ${r.fontFile}`).toBe(true)
      }
    })
  })
})
