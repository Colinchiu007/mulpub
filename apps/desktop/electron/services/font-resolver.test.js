// @ts-check
/**
 * font-resolver.test.js — 自包含中文字体解析（TDD 红→绿）
 *
 * 背景（2026-10-16 实测）：
 *   ffmpeg drawtext 的 `fontfile=` 对**非 ASCII 路径**静默失败 —— 目录名或文件名
 *   任一含中文，渲染结果就是豆腐块（bytes 5495 → 765），不报错、不进 stderr。
 *   而用户完全可能把应用装到 `<中文安装目录>\`。因此自包含字体不能直接喂原始路径，
 *   必须先落到**纯 ASCII 路径**再交给 ffmpeg。
 *
 * 本模块职责（单一实现，禁止各链自抄）：
 *   ① 解析「优先用自包含得意黑」的 CJK 字体路径（创作内容：字幕 / 水印 / 封面 / 占位图）
 *   ② 把该路径复制到 ASCII 安全目录（os.tmpdir() 下固定名），规避 ffmpeg 路径敏感性
 *   ③ 找不到自包含字体时，回落到系统字体（开发态/字体缺失时不崩，且如实出声）
 *
 * 契约（改动即需同步本测试）：
 *   - 返回值必须是 ASCII 路径（正则断言，不是"看起来像"）
 *   - 回落系统字体时也必须是 ASCII 路径（C:\Windows\Fonts 本身是 ASCII）
 *   - 全链路不得抛异常：字体缺失只影响字形，不该让发布/合成失败
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  resolveContentCjkFont,
  isAsciiSafe,
  ASCII_SAFE_DIR_NAME,
  BUNDLED_FONT_BASENAME,
  SYSTEM_FONT_CANDIDATES,
  packagedFontCandidates,
  devFontCandidates,
  bundledFontCandidates,
} = require('./font-resolver')

/**
 * ASCII 判定：只含可打印 ASCII（不含反斜杠/引号限制 —— Windows 路径必然含反斜杠，
 * 反斜杠无害；真正让 ffmpeg 静默降级成豆腐块的是非 ASCII 字符，实测见 font-resolver.js）。
 */
function asciiOk (p) {
  return typeof p === 'string' && p.length > 0 && /^[\x20-\x7E]+$/.test(p)
}

describe('font-resolver — 自包含中文字体解析', () => {
  const realTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'font-resolver-test-'))

  afterAll(() => {
    fs.rmSync(realTmp, { recursive: true, force: true })
  })

  // ── 契约⓪：判据函数本身必须有效（变异反证补强，2026-10-16）──────────────
  // 为什么单列：初版只断言「返回路径是 ASCII」，而用例传入的路径本身就是 ASCII，
  // 于是把 isAsciiSafe 改成恒真也照样全绿（M2 变异 NOT-CAUGHT 实测）。
  // 判据必须**直接拷打判据函数本身**，正反两面都给，否则锁的是"看起来像"。
  describe('契约⓪：isAsciiSafe 判据本身有效（正反两面）', () => {
    it('接受纯 ASCII 路径（含反斜杠、盘符冒号、正斜杠）', () => {
      expect(isAsciiSafe('C:\\Windows\\Fonts\\msyh.ttc')).toBe(true)
      expect(isAsciiSafe('D:/Temp/mp-fonts/SmileySans-Oblique.otf')).toBe(true)
      expect(isAsciiSafe('relative/path.otf')).toBe(true)
    })

    it('拒绝含中文的路径（目录名或文件名任一含中文即拒）', () => {
      expect(isAsciiSafe('D:\\软件\\fonts\\SmileySans-Oblique.otf')).toBe(false)
      expect(isAsciiSafe('D:\\fonts\\得意黑.otf')).toBe(false)
      expect(isAsciiSafe('D:\\Temp\\中文目录\\a.otf')).toBe(false)
    })

    it('拒绝空值与非字符串', () => {
      expect(isAsciiSafe('')).toBe(false)
      expect(isAsciiSafe(null)).toBe(false)
      expect(isAsciiSafe(undefined)).toBe(false)
      expect(isAsciiSafe(123)).toBe(false)
    })
  })

  describe('契约①：返回路径必须是 ASCII 安全（ffmpeg fontfile 前提）', () => {
    it('默认必须解析到 bundled，且返回 ASCII 路径（无条件断言）', () => {
      const r = resolveContentCjkFont({})
      // ⛔ 无条件（QM-6 评审 i2）：自带字体在库是硬前提，它缺失本身就是回归
      // （2026-09-04 的半截删除事故正是这么发生的——文件被删、引用还在）。
      // 写成 `if (r.fontFile) { … }` 会让「字体不在库」表现为静默通过。
      expect(r.source, '未解析到 bundled ⇒ 自包含字体可能又被删了，或解析链坏了').toBe('bundled')
      expect(asciiOk(r.fontFile), `非 ASCII 路径会被 ffmpeg 静默降级为豆腐块: ${r.fontFile}`).toBe(true)
    })

    it('强制回落系统字体时按平台显式断言（不留静默跳过）', () => {
      const r = resolveContentCjkFont({ allowBundled: false })
      if (process.platform === 'win32') {
        // Windows 必然有系统 CJK 候选；空串说明候选清单又坏了一次（历史 bug：双层反斜杠）
        expect(r.source, 'win32 上跳过 bundled 后应落到 system').toBe('system')
        expect(r.fontFile, 'win32 上系统字体候选不应为空').not.toBe('')
      } else {
        expect(r.fontFile, '非 win32 交由 fontconfig 处理，解析层应返回空串').toBe('')
      }
      // 无条件：要么无字体，要么必须是 ASCII
      expect(r.fontFile === '' || asciiOk(r.fontFile)).toBe(true)
    })
  })

  describe('契约②：ASCII 副本落点稳定且可复现', () => {
    it('ASCII 副本目录名与文件名是模块级常量（不是每次随机）', () => {
      expect(typeof ASCII_SAFE_DIR_NAME).toBe('string')
      expect(ASCII_SAFE_DIR_NAME).toMatch(/^[A-Za-z0-9._-]+$/)
      expect(typeof BUNDLED_FONT_BASENAME).toBe('string')
      expect(BUNDLED_FONT_BASENAME).toMatch(/^[A-Za-z0-9._-]+$/)
    })

    it('指定 tmpRoot 时，副本落在 <tmpRoot>/<ASCII_SAFE_DIR_NAME>/<BUNDLED_FONT_BASENAME>', () => {
      const r = resolveContentCjkFont({ tmpRoot: realTmp })
      expect(r.source, '未解析到 bundled，落点断言失去意义').toBe('bundled')
      expect(r.fontFile).toBe(path.join(realTmp, ASCII_SAFE_DIR_NAME, BUNDLED_FONT_BASENAME))
      expect(fs.existsSync(r.fontFile)).toBe(true)
    })

    it('副本字节与源一致（不是空壳/截断）', () => {
      const r = resolveContentCjkFont({ tmpRoot: realTmp })
      expect(r.source, '未解析到 bundled，字节断言失去意义').toBe('bundled')
      const copySize = fs.statSync(r.fontFile).size
      expect(copySize).toBeGreaterThan(1024 * 1024) // 得意黑 otf ≈ 1.91 MB
    })

    it('已存在副本时不重复拷贝（幂等：mtime 不变，不依赖时序判据）', () => {
      // ⚠️ 判据刻意不用耗时：SSD 上 1.9MB 拷贝也可能 <50ms，时间型断言会把
      // 「重复拷贝」这个真实缺陷放过去（M6 变异实测 NOT-CAUGHT 的根因）。
      // 改用 mtime —— 命中缓存时文件不被重写，mtime 保持我们推进到的时刻。
      const outRoot = path.join(realTmp, 'idem')
      const first = resolveContentCjkFont({ tmpRoot: outRoot })
      expect(first.source, '未解析到 bundled，幂等断言失去意义').toBe('bundled')
      // 人为把 mtime 推进到 60s 后：若实现重复拷贝，mtime 会被打回"现在"
      const future = new Date(Date.now() + 60000)
      fs.utimesSync(first.fontFile, future, future)
      const mtimeBefore = fs.statSync(first.fontFile).mtimeMs

      const second = resolveContentCjkFont({ tmpRoot: outRoot })
      const mtimeAfter = fs.statSync(second.fontFile).mtimeMs

      expect(second.fontFile).toBe(first.fontFile)
      expect(mtimeAfter).toBe(mtimeBefore) // 未被重写 ⇒ 走了幂等短路
      expect(mtimeAfter).toBeGreaterThan(Date.now() + 30000) // 确认那个"未来时刻"没被打回
    })

    // 变异反证补强（2026-10-16）：M5 把 BUNDLED_FONT_BASENAME 改成带随机数，
    // 而上面两条用的是「导入的常量」当期望值 —— 自己对自己，恒真。
    // 这里写死字面量，锁的是**真实文件名**（ffmpeg fontfile 也依赖这个稳定名）。
    it('副本文件名写死为 SmileySans-Oblique.otf（不随导入常量漂移）', () => {
      const r = resolveContentCjkFont({ tmpRoot: path.join(realTmp, 'lit') })
      expect(r.source, '未解析到 bundled，文件名断言失去意义').toBe('bundled')
      expect(path.basename(r.fontFile)).toBe('SmileySans-Oblique.otf')
      expect(path.dirname(r.fontFile)).toBe(path.join(realTmp, 'lit', 'mp-fonts'))
    })

    it('ASCII 副本目录名写死为 mp-fonts', () => {
      expect(ASCII_SAFE_DIR_NAME).toBe('mp-fonts')
    })
  })

  describe('契约③：源字体路径含中文时也必须产出 ASCII 副本', () => {
    it('显式传入中文路径的 bundledFontPath，仍返回 ASCII 副本路径', () => {
      const cjkDir = path.join(realTmp, '中文字体')
      fs.mkdirSync(cjkDir, { recursive: true })
      const cjkFont = path.join(cjkDir, '得意黑.otf')
      // 造一个足够大的假字体文件（只测路径搬运，不测字形）
      fs.writeFileSync(cjkFont, Buffer.alloc(2 * 1024 * 1024, 0x41))

      const r = resolveContentCjkFont({
        tmpRoot: path.join(realTmp, 'ascii-out'),
        bundledFontPath: cjkFont,
      })
      expect(r.fontFile).toBeTruthy()
      expect(asciiOk(r.fontFile)).toBe(true)
      expect(r.fontFile).not.toContain('中文字体')
      expect(fs.existsSync(r.fontFile)).toBe(true)
      expect(fs.statSync(r.fontFile).size).toBe(2 * 1024 * 1024)
    })
  })

  describe('契约④：失败不抛异常（字体问题不该炸掉发布链）', () => {
    it('自包含字体不存在且无系统字体时，返回 fontFile 为空字符串而非抛错', () => {
      const r = resolveContentCjkFont({
        tmpRoot: path.join(realTmp, 'none'),
        bundledFontPath: path.join(realTmp, 'does-not-exist.otf'),
        allowSystem: false,
      })
      expect(r.fontFile).toBe('')
      expect(r.source).toBe('none')
    })

    it('tmpRoot 不可写时不得抛异常', () => {
      expect(() => resolveContentCjkFont({
        tmpRoot: path.join(realTmp, 'no', 'such', 'deep', 'locked'),
        bundledFontPath: path.join(realTmp, 'does-not-exist.otf'),
      })).not.toThrow()
    })

    // 变异反证补强（2026-10-16）：M4 把 copyToAsciiSafe 的 catch 从 `return ''`
    // 改成 `throw _`。上面两条用例的 bundledFontPath 都不存在，走的是
    // `fs.existsSync` 提前返回那条路，**根本没进 catch** ⇒ 变异不被发现。
    // 这里用「源是目录而非文件」强制 statSync 抛错，真正拷打 catch 分支。
    it('源路径是目录（statSync 抛错）时返回空而非抛异常', () => {
      const asDir = path.join(realTmp, 'not-a-font-dir')
      fs.mkdirSync(asDir, { recursive: true })
      const r = resolveContentCjkFont({
        tmpRoot: path.join(realTmp, 'dirsrc'),
        bundledFontPath: asDir,
        allowSystem: false,
      })
      expect(r.fontFile).toBe('')
      expect(r.source).toBe('none')
    })

    // 同一个 catch 分支的另一种触发形态：目标名与已存在目录冲突（mkdir 抛错）
    it('目标副本路径被同名目录占用时不得抛异常', () => {
      const outRoot = path.join(realTmp, 'collide')
      const collide = path.join(outRoot, 'mp-fonts', 'SmileySans-Oblique.otf')
      fs.mkdirSync(collide, { recursive: true }) // 抢占目标为目录
      const src = path.join(realTmp, 'real-src.otf')
      fs.writeFileSync(src, Buffer.alloc(1024, 0x42))
      expect(() => resolveContentCjkFont({
        tmpRoot: outRoot,
        bundledFontPath: src,
        allowSystem: false,
      })).not.toThrow()
    })
  })

  // ── 契约④b：系统字体候选也必须过 ASCII 校验（变异反证补强）──────────────
  // M3 把 system 分支的 isAsciiSafe 校验删掉。本机 C:\Windows\Fonts 本身是 ASCII，
  // 所以必须**注入一个含中文的系统候选**才能拷打这条校验。
  describe('契约④b：系统字体候选同样必须过 ASCII 校验', () => {
    it('SYSTEM_FONT_CANDIDATES 里每一项都是 ASCII 路径', () => {
      expect(Array.isArray(SYSTEM_FONT_CANDIDATES)).toBe(true)
      expect(SYSTEM_FONT_CANDIDATES.length).toBeGreaterThan(0)
      for (const c of SYSTEM_FONT_CANDIDATES) {
        expect(asciiOk(c), `系统候选含非 ASCII 字符会被 ffmpeg 静默降级: ${c}`).toBe(true)
      }
    })
  })

  // ── 契约⑥：打包态路径解析（⛔ 高价值锁，见下「为什么必须单列」）──────────
  // 为什么必须单列（2026-10-16 实测事故）：首版 `resolveAppRoot()` 用
  // `path.dirname(process.resourcesPath)` 推根，得到「安装根」而 extraResources 的
  // `to:"fonts"` 实际落在 **resources 目录下** ⇒ 两个候选 exists 全 false ⇒
  // `resolveContentCjkFont()` 返回 `source='system'`，**安装后的应用永远不用自带得意黑**。
  // 首版测试没抓到，是因为它从 `apps/desktop` 作为 cwd 运行，dev 候选
  // `<cwd>/src/public/fonts/` 恰好存在 ⇒ 在 vitest 里恒为 bundled，缺陷只在打包态显形。
  // 所以本锁**必须自建一个真实的「resources/fonts/」布局**并覆写 process.resourcesPath。
  describe('契约⑥：打包态（<resourcesPath>/fonts/）必须解析到 bundled', () => {
    const pkgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'font-pkg-layout-'))

    afterAll(() => {
      fs.rmSync(pkgRoot, { recursive: true, force: true })
    })

    it('packagedFontCandidates() 的第一项就是 <resourcesPath>/fonts/<basename>', () => {
      const resourcesPath = path.join(pkgRoot, 'win-unpacked', 'resources')
      const original = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
      Object.defineProperty(process, 'resourcesPath', { value: resourcesPath, configurable: true })
      try {
        const list = packagedFontCandidates()
        expect(list.length).toBeGreaterThan(0)
        expect(list[0]).toBe(path.join(resourcesPath, 'fonts', 'SmileySans-Oblique.otf'))
      } finally {
        if (original) Object.defineProperty(process, 'resourcesPath', original)
        else delete process.resourcesPath
      }
    })

    it('自建真实布局后，resolveContentCjkFont 必须返回 source=bundled', () => {
      const resourcesPath = path.join(pkgRoot, 'win-unpacked', 'resources')
      const fontsDir = path.join(resourcesPath, 'fonts')
      fs.mkdirSync(fontsDir, { recursive: true })
      // 用一个可识别内容的假字体文件（只验证「找到了并搬对了」，不验证字形）
      const fakeFont = path.join(fontsDir, 'SmileySans-Oblique.otf')
      const payload = Buffer.alloc(2 * 1024 * 1024, 0x5A)
      fs.writeFileSync(fakeFont, payload)

      const original = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
      Object.defineProperty(process, 'resourcesPath', { value: resourcesPath, configurable: true })
      try {
        const r = resolveContentCjkFont({ tmpRoot: path.join(pkgRoot, 'ascii-out') })
        expect(r.source, '打包布局下未解析到自包含字体 ⇒ 安装后必然回落系统字体（缺陷复现）').toBe('bundled')
        expect(asciiOk(r.fontFile)).toBe(true)
        // 搬的是那份文件，不是别的
        expect(fs.readFileSync(r.fontFile).equals(payload)).toBe(true)
        // 且副本不在 resources 下（必须是 ASCII 副本层，绕开 ffmpeg 路径敏感性）
        expect(r.fontFile).not.toContain(resourcesPath)
      } finally {
        if (original) Object.defineProperty(process, 'resourcesPath', original)
        else delete process.resourcesPath
      }
    })

    it('打包态候选优先于开发态（用户机器上只有打包那一份）', () => {
      const resourcesPath = path.join(pkgRoot, 'prio', 'resources')
      const original = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
      Object.defineProperty(process, 'resourcesPath', { value: resourcesPath, configurable: true })
      try {
        const all = bundledFontCandidates()
        const pkgList = packagedFontCandidates()
        const devList = devFontCandidates()
        expect(all.slice(0, pkgList.length)).toEqual(pkgList)
        expect(all.slice(pkgList.length)).toEqual(devList)
      } finally {
        if (original) Object.defineProperty(process, 'resourcesPath', original)
        else delete process.resourcesPath
      }
    })

    it('devFontCandidates() 指向 apps/desktop/src/public/fonts（Vite publicDir）', () => {
      const dev = devFontCandidates()
      expect(dev.length).toBeGreaterThan(0)
      // 归一化分隔符后比对后缀，避免平台差异
      expect(dev[0].replace(/\\/g, '/')).toMatch(/\/apps\/desktop\/src\/public\/fonts\/SmileySans-Oblique\.otf$/)
      expect(fs.existsSync(dev[0]), `开发态候选不存在: ${dev[0]}`).toBe(true)
    })
  })

  describe('契约⑤：候选优先级可观测（source 字段用于日志与排障）', () => {
    it('source ∈ bundled | system | none，且与 fontFile 是否为空一致', () => {
      const r = resolveContentCjkFont({ tmpRoot: path.join(realTmp, 'src') })
      expect(['bundled', 'system', 'none']).toContain(r.source)
      expect(Boolean(r.fontFile)).toBe(r.source !== 'none')
    })

    it('allowBundled=false 时不会选 bundled', () => {
      const r = resolveContentCjkFont({
        tmpRoot: path.join(realTmp, 'sys'),
        allowBundled: false,
      })
      expect(r.source).not.toBe('bundled')
    })
  })

  // QM-6 评审 i5（2026-10-16）：ffmpeg `fontfile=` 语法安全判据。
  // 证据来源：`.tmp-docs/probe-quote4.js` 六组同字同参数对照，结论是**含 `'` 无任何转义可救**。
  describe('契约⑨：fontfile 语法安全判据（ffmpeg 滤镜引号）', () => {
    const { isFfmpegFontPathSafe } = require('./font-resolver')

    it('拒绝含单引号的路径（实测：原样 / 反斜杠转义 全部静默回落系统字体）', () => {
      expect(isFfmpegFontPathSafe("C:\\Temp\\o'brien\\SmileySans-Oblique.otf")).toBe(false)
      expect(isFfmpegFontPathSafe("/tmp/o'brien/f.otf")).toBe(false)
    })

    it('接受带盘符冒号与反斜杠的 Windows 路径（`:` 由 escapeFontFilePath 转义，正控渲染已实测成功）', () => {
      expect(isFfmpegFontPathSafe('C:\\Windows\\Fonts\\msyh.ttc')).toBe(true)
      expect(isFfmpegFontPathSafe('D:\\Temp\\mp-fonts\\SmileySans-Oblique.otf')).toBe(true)
    })

    it('仍拒绝非 ASCII（与 isAsciiSafe 同一前提）', () => {
      expect(isFfmpegFontPathSafe('D:\\软件\\字体\\得意黑.otf')).toBe(false)
      expect(isFfmpegFontPathSafe('')).toBe(false)
    })

    it('含引号的 tmpRoot ⇒ 不返回 bundled（宁如实回落，也不交出会被 ffmpeg 用错的路径）', () => {
      const quoteRoot = path.join(os.tmpdir(), "mp-q'brien-root")
      const r = resolveContentCjkFont({ tmpRoot: quoteRoot })
      expect(r.source, '含引号的副本路径会让 ffmpeg 静默回落系统字体，必须不选它').not.toBe('bundled')
      // 反向判据：真正交出去的路径一定语法安全
      expect(r.fontFile === '' || isFfmpegFontPathSafe(r.fontFile)).toBe(true)
    })
  })

  // QM-6 评审 i1（2026-10-16）：手工拼 XML 必须做实体转义，否则 `&` 等字符产出非法 fonts.conf
  describe('契约⑩：fontconfig XML 必须做实体转义', () => {
    const { buildFontconfigForSharp } = require('./font-resolver')

    it('含 & 的字体目录写进 <dir> 时必须转义（否则 fonts.conf 非法 ⇒ 注入整体失效）', () => {
      const tmp = fs.mkdtempSync(path.join(realTmp, 'xml-'))
      const dirWithAmp = path.join(realTmp, 'A&B')
      try {
        fs.mkdirSync(dirWithAmp, { recursive: true })
        const fc = buildFontconfigForSharp({ tmpRoot: tmp, fontDir: dirWithAmp })
        expect(fc.injected).toBe(true)
        const text = fs.readFileSync(fc.fontconfigFile, 'utf8')
        expect(text).toContain('A&amp;B')
        expect(/A&B/.test(text), '出现未转义的裸 & ⇒ fontconfig 会判 fonts.conf 非法').toBe(false)
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })
  })

  // QM-6 评审 i3（2026-10-16）：`isFfmpegFontPathSafe` 刻意放行 `:`，理由只写在注释里 ——
  // 这是一个**跨模块口头契约**（resolver 放行 ⇒ 引擎必须转义）。口头契约会随一侧改动静默失效，
  // 故在此把它锁成可执行判据：两侧对同一路径的结论必须一致。
  describe('契约⑪：resolver 与 compose-engine 的 fontfile 转义契约', () => {
    const { isFfmpegFontPathSafe } = require('./font-resolver')
    const { escapeFontFilePath } = require('./story2video-compose-engine')

    it('引擎转义：反斜杠→正斜杠、冒号→转义冒号，且结果不含裸冒号', () => {
      expect(escapeFontFilePath('C:\\Windows\\Fonts\\msyh.ttc')).toBe('C\\:/Windows/Fonts/msyh.ttc')
      const out = escapeFontFilePath('D:\\Temp\\mp-fonts\\SmileySans-Oblique.otf')
      // 裸冒号 = 未被反斜杠前缀的冒号 ⇒ 会被 drawtext 当选项分隔符
      expect(/[^\\]:/.test(out), `转义后仍有裸冒号: ${out}`).toBe(false)
    })

    it('两侧一致：resolver 放行的路径，引擎转义后必不含裸冒号', () => {
      const samples = [
        'C:\\Windows\\Fonts\\msyh.ttc',
        'D:\\Temp\\mp-fonts\\SmileySans-Oblique.otf',
        'C:\\Users\\Public\\AppData\\Local\\Temp\\mp-fonts\\SmileySans-Oblique.otf',
      ]
      for (const s of samples) {
        expect(isFfmpegFontPathSafe(s), `样本应被判语法安全: ${s}`).toBe(true)
        expect(/[^\\]:/.test(escapeFontFilePath(s)), `放行却在转义后留裸冒号: ${s}`).toBe(false)
      }
    })

    it('单引号只能由 resolver 拦：引擎的转义不处理引号（故放行它就是静默降级）', () => {
      const s = "D:\\Temp\\o'brien\\SmileySans-Oblique.otf"
      expect(isFfmpegFontPathSafe(s)).toBe(false)
      // 反向证据：转义后引号仍在 ⇒ 引擎兜不住，必须靠 resolver 拦
      expect(escapeFontFilePath(s)).toContain("'")
    })

    // QM-6 评审 i5（2026-10-16）：评审主张「`isFfmpegFontPathSafe` 漏了 `,` `;` `[` `]`
    // 这些滤镜元字符，可能损坏 drawtext」。**实测证伪**：这些字符在单引号值内被保护，
    // 渲染与正控**逐字节相同**（`.tmp-docs/probe-meta.js` 五组对照 —— control/comma/semicolon/
    // `[`/`]` 全部 sha=6b973dce713c、6107 B）⇒ 故**不**把它们加入拒绝集（加了反而会
    // 误拒合法路径）。本用例把这个结论锁住，避免后人凭猜测扩大拒绝面。
    it('元字符 , ; [ ] 必须被放行（实测与正控渲染逐字节相同，加了会误拒合法路径）', () => {
      for (const s of [
        'C:\\Temp\\a,b\\SmileySans-Oblique.otf',
        'C:\\Temp\\a;b\\SmileySans-Oblique.otf',
        'C:\\Temp\\a[b\\SmileySans-Oblique.otf',
        'C:\\Temp\\a]b\\SmileySans-Oblique.otf',
      ]) {
        expect(isFfmpegFontPathSafe(s), `实测证明安全却被拒: ${s}`).toBe(true)
      }
    })

    // QM-6 评审 i3（2026-10-16）：把「系统字体候选的 ASCII/语法校验」从「行为不可区分」
    // 变成可行为捕获 —— 注入一个**真实存在**但含非 ASCII 的候选，必须被跳过。
    // 变异反证：删掉 that 校验（M3 的那种形态）会让本用例变红。
    it('注入含非 ASCII 的系统字体候选时必须被跳过（令 M3 可被行为捕获）', () => {
      const { resolveContentCjkFont } = require('./font-resolver')
      const cjkDir = path.join(realTmp, '系统字体目录')
      fs.mkdirSync(cjkDir, { recursive: true })
      const cjkCandidate = path.join(cjkDir, 'fake-cjk.ttc')
      fs.writeFileSync(cjkCandidate, 'not-a-real-font', 'utf8')
      expect(fs.existsSync(cjkCandidate), '候选必须真实存在，否则判据走的是 existsSync 短路而非校验分支').toBe(true)

      const r = resolveContentCjkFont({ allowBundled: false, systemCandidates: [cjkCandidate] })
      expect(r.fontFile, '含非 ASCII 的候选被选中 ⇒ 会交给 ffmpeg 并静默回落系统字体').not.toBe(cjkCandidate)
      expect(r.source).not.toBe('system')
    })

    it('注入 ASCII 且语法安全的候选时必须被选中（正控：证明上一条不是恒真）', () => {
      const { resolveContentCjkFont } = require('./font-resolver')
      const okDir = path.join(realTmp, 'okfonts')
      fs.mkdirSync(okDir, { recursive: true })
      const ok = path.join(okDir, 'fake-ascii.ttc')
      fs.writeFileSync(ok, 'not-a-real-font', 'utf8')
      const r = resolveContentCjkFont({ allowBundled: false, systemCandidates: [ok] })
      if (process.platform === 'win32') {
        // 系统字体兜底只对 win32 生效；此平台下必须选中该 ASCII 候选
        expect(r.fontFile).toBe(ok)
        expect(r.source).toBe('system')
      } else {
        // 非 win32 由 fontconfig 处理，解析层不返回系统字体路径
        expect(r.source).not.toBe('system')
      }
    })

    // QM-6 评审 i3（2026-10-16）：副本目录建在共享 os.tmpdir() 下，需收紧权限。
    // 字体是 SIL OFL 公开字体、无机密性，这不是真实泄露面；但收紧成本近零，照做并留锁。
    it('非 Windows 上副本目录权限必须为 0o700（不得随 umask 敞开）', () => {
      const { resolveContentCjkFont, ASCII_SAFE_DIR_NAME } = require('./font-resolver')
      const root = path.join(realTmp, 'perm')
      const r = resolveContentCjkFont({ tmpRoot: root })
      expect(r.source).toBe('bundled')
      if (process.platform !== 'win32') {
        const dir = path.join(root, ASCII_SAFE_DIR_NAME)
        expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
      }
    })
  })
})
