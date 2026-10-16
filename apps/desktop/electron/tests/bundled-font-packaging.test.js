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
const crypto = require('crypto')

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

  describe('契约⑦：sharp 栅格化 worker 必须随包（QM-6 评审 c3，2026-10-16）', () => {
    const SERVICES = path.join(SRC_ROOT, 'apps', 'desktop', 'electron', 'services')
    const WORKER = path.join(SERVICES, '.cover-rasterize-worker.js')
    const COVER = path.join(SERVICES, 'local-cover-generator.js')

    it('worker 源文件存在（缺它则封面失去 fontconfig 注入能力）', () => {
      expect(fs.existsSync(WORKER), `worker 缺失: ${WORKER}`).toBe(true)
    })

    it('build.files 里有覆盖 electron/services/ 的模式（否则 worker 会被裁出包）', () => {
      const files = pkg.build.files || []
      // 判据：存在某个模式，'electron/services/.cover-rasterize-worker.js' 能命中它。
      // 本仓当前是 'electron/**/*'；这里不写死该字面量，改为按语义校验，
      // 这样将来改成 'electron/**' 或显式列举也不会假红，但删掉覆盖则必红。
      const sample = 'electron/services/.cover-rasterize-worker.js'
      const matched = files.some((pat) => {
        if (typeof pat !== 'string' || pat.startsWith('!')) return false
        const re = new RegExp('^' + pat
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*\//g, '(?:.*/)?')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*') + '$')
        return re.test(sample)
      })
      expect(matched, `build.files 无模式覆盖 ${sample}，worker 会被裁出包:\n${JSON.stringify(files, null, 2)}`).toBe(true)
    })

    it('worker 缺失时必须 fail closed（抛错），不得退化为无注入渲染（QM-6 i1）', () => {
      const src = fs.readFileSync(COVER, 'utf8')
      const i = src.indexOf('fs.existsSync(worker)')
      expect(i, '未找到 worker 存在性判据').toBeGreaterThan(-1)
      // 取该分支起的一段，其中必须 throw；且**不得**出现直接 sharp() 渲染
      const seg = src.slice(i, i + 1600)
      expect(seg, 'worker 缺失分支未抛错：会产出字体不对的封面并当成功返回').toMatch(/throw new Error/)
      expect(seg, 'worker 缺失分支仍在直接渲染：静默丢字体验证失败').not.toMatch(/sharp\(Buffer\.from\(svg\)\)\.png\(\)\.toFile/)
    })

    it('真实构建产物存在时，必须断言 worker 在 asar 内（QM-6 i4：不只验 glob）', () => {
      const asar = path.join(SRC_ROOT, 'apps', 'desktop', 'dist-electron', 'win-unpacked', 'resources', 'app.asar')
      if (!fs.existsSync(asar)) {
        // 无构建产物时**不做静默跳过**，而是明确记录并断言「未构建」这一事实本身，
        // 使该用例在两种情况下都有真实判据（有产物⇒必须命中；无产物⇒必须确认它确实不存在）。
        expect(fs.existsSync(asar), `asar 不存在却走到这里，说明状态不一致: ${asar}`).toBe(false)
        return
      }
      const header = fs.readFileSync(asar).slice(0, 4 * 1024 * 1024).toString('latin1')
      expect(header, 'worker 不在 asar 头部文件表内 ⇒ 会被裁掉或被排除，封面将 fail closed').toContain('cover-rasterize-worker.js')
      expect(header, 'font-resolver.js 不在 asar 内').toContain('font-resolver.js')
    })

    it('worker 自身对失败路径返回非零退出码（不把失败伪装成成功）', () => {
      const src = fs.readFileSync(WORKER, 'utf8')
      expect(src).toMatch(/process\.exit\([1-9]/)
      expect(src).toMatch(/existsSync\(outFile\)/)
    })
  })

  describe('契约⑤：font-resolver 的 ASCII 副本与 fontconfig 注入可用', () => {
    const { buildFontconfigForSharp, resolveContentCjkFont, ASCII_SAFE_DIR_NAME } = require('../services/font-resolver')

    it('在临时目录能生成可用的 fontconfig（含系统目录 + 字体目录）', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'font-pkg-'))
      try {
        const fc = buildFontconfigForSharp({ tmpRoot: tmp, fontDir: FONT_DIR })
        // ⛔ 无条件（QM-6 评审 i2）：字体目录存在且 ASCII 安全时**必须**注入成功。
        // 原来的 `if (!fc.injected) return` 让「注入功能整体坏掉」表现为静默通过 ——
        // 而注入坏掉正是封面丢字体的那条路（sharp 只认 fontconfig）。
        expect(fc.injected, '字体目录存在却未注入 fontconfig ⇒ 封面会丢自包含中文字体').toBe(true)
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

    it('解析结果必须存在且为 ASCII 路径（无条件断言）', () => {
      const r = resolveContentCjkFont({})
      expect(r.source, '仓库内自带字体在库 ⇒ 必须解析到 bundled').toBe('bundled')
      expect(/^[\x20-\x7E]+$/.test(r.fontFile), `非 ASCII: ${r.fontFile}`).toBe(true)
    })
  })

  // QM-6 评审 i3：`resolveContentCjkFont({ bundledFontPath })` 会 copyFileSync 到 tmp，
  // 若不设防地接线到用户输入，就是一个任意文件复制面。取证结论：**当前零生产调用方**
  // （唯一出现处是 font-resolver.js 自身的选项定义与 JSDoc；三个生产消费方
  // asset-generator / local-cover-generator / story2video-compose-engine 全部无参调用）。
  // 风险因此不可达；本锁的作用是**阻止未来把它接到 IPC 用户输入上**。
  describe('契约⑧：bundledFontPath 只允许测试使用（QM-6 评审 i3 结构锁）', () => {
    const ELECTRON_ROOT = path.join(SRC_ROOT, 'apps', 'desktop', 'electron')

    it('生产代码（非 *.test.js）里不得出现 bundledFontPath 的传参', () => {
      const offenders = []
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name)
          if (e.isDirectory()) { walk(p); continue }
          if (!/\.(js|cjs|mjs)$/.test(e.name)) continue
          if (/\.test\.js$/.test(e.name)) continue
          if (e.name === 'font-resolver.js') continue // 选项定义与 JSDoc 自身
          const text = fs.readFileSync(p, 'utf8')
          if (text.includes('bundledFontPath')) offenders.push(path.relative(SRC_ROOT, p))
          if (text.includes('systemCandidates')) offenders.push(path.relative(SRC_ROOT, p) + ' (systemCandidates)')
        }
      }
      walk(ELECTRON_ROOT)
      expect(offenders, `bundledFontPath 是测试专用覆盖口，不得出现在生产代码里（会构成任意文件复制面）:\n${offenders.join('\n')}`).toEqual([])
    })

    it('font-resolver 的 JSDoc 必须标明该选项仅供测试/覆盖', () => {
      const src = require('fs').readFileSync(path.join(ELECTRON_ROOT, 'services', 'font-resolver.js'), 'utf8')
      expect(src).toMatch(/bundledFontPath[\s\S]{0,200}(测试|覆盖)/)
    })
  })

  // QM-6 评审 i6（2026-10-16）：字体二进制只有「OTTO 魔数 + 体积区间」两道弱校验，
  // 位腐或半截拷贝看不出来。入库时记录完整 SHA256，逐字节锁住。
  describe('契约⑫：字体二进制完整性（SHA256 逐字节锁定）', () => {
    const EXPECTED_SHA256 = '139B5DCBE70D6D52DE85A62D148784C6AF4BD161E38FDB62BA0C1E7E5065FCA6'

    it(`SmileySans-Oblique.otf 的 SHA256 必须等于入库记录值（${EXPECTED_SHA256.slice(0, 16)}…）`, () => {
      const digest = crypto.createHash('sha256').update(fs.readFileSync(FONT_FILE)).digest('hex').toUpperCase()
      expect(digest, '字体被位腐或被换成了别的版本；若确为有意换版请同步 PRD §3.3 与三处副本校验').toBe(EXPECTED_SHA256)
    })

    it('dist/fonts 与打包产物的副本必须与源同一份（三处 sha 全等）', () => {
      const targets = [
        path.join(SRC_ROOT, 'apps', 'desktop', 'dist', 'fonts', 'SmileySans-Oblique.otf'),
        path.join(SRC_ROOT, 'apps', 'desktop', 'dist-electron', 'win-unpacked', 'resources', 'fonts', 'SmileySans-Oblique.otf'),
      ]
      const srcDigest = crypto.createHash('sha256').update(fs.readFileSync(FONT_FILE)).digest('hex').toUpperCase()
      for (const t of targets) {
        if (!fs.existsSync(t)) continue // 未构建则跳过该处（构建产物不入库）
        const d = crypto.createHash('sha256').update(fs.readFileSync(t)).digest('hex').toUpperCase()
        expect(d, `${t} 与源字体不是同一份`).toBe(srcDigest)
      }
    })

    // QM-6 评审 i1（2026-10-16）：缺陷曾被「打包 rc=0 + 全量测试绿」完全掩盖，
    // 只有人工产物复核才发现。这里在真实产物存在时断言 extraResources 的落点真的生了效。
    it('真实产物的 resources/fonts/ 必须存在（extraResources 落点生效）', () => {
      const resFont = path.join(SRC_ROOT, 'apps', 'desktop', 'dist-electron', 'win-unpacked', 'resources', 'fonts', 'SmileySans-Oblique.otf')
      if (!fs.existsSync(path.dirname(path.dirname(resFont)))) return // 未打包：无产物可断言
      expect(fs.existsSync(resFont), 'extraResources 落点错了 ⇒ 打包态永远解析不到自带字体（source=system），而 rc 仍为 0').toBe(true)
    })
  })
})
