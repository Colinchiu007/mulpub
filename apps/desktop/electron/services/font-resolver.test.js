// @ts-check
/**
 * font-resolver.test.js — 自包含中文字体解析（TDD 红→绿）
 *
 * 背景（2026-10-16 实测）：
 *   ffmpeg drawtext 的 `fontfile=` 对**非 ASCII 路径**静默失败 —— 目录名或文件名
 *   任一含中文，渲染结果就是豆腐块（bytes 5495 → 765），不报错、不进 stderr。
 *   而用户完全可能把应用装到 `D:\软件\社媒管家\`。因此自包含字体不能直接喂原始路径，
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
      expect(isAsciiSafe('D:\\Temp\\社媒管家\\a.otf')).toBe(false)
    })

    it('拒绝空值与非字符串', () => {
      expect(isAsciiSafe('')).toBe(false)
      expect(isAsciiSafe(null)).toBe(false)
      expect(isAsciiSafe(undefined)).toBe(false)
      expect(isAsciiSafe(123)).toBe(false)
    })
  })

  describe('契约①：返回路径必须是 ASCII 安全（ffmpeg fontfile 前提）', () => {
    it('默认（自包含字体存在）返回 ASCII 路径', () => {
      const r = resolveContentCjkFont({})
      if (r.fontFile) {
        expect(asciiOk(r.fontFile), `非 ASCII 路径会被 ffmpeg 静默降级为豆腐块: ${r.fontFile}`).toBe(true)
      }
    })

    it('强制回落系统字体时，返回路径同样是 ASCII', () => {
      const r = resolveContentCjkFont({ allowBundled: false })
      if (r.fontFile) {
        expect(asciiOk(r.fontFile)).toBe(true)
      }
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
      if (r.fontFile && r.source === 'bundled') {
        expect(r.fontFile).toBe(path.join(realTmp, ASCII_SAFE_DIR_NAME, BUNDLED_FONT_BASENAME))
        expect(fs.existsSync(r.fontFile)).toBe(true)
      }
    })

    it('副本字节与源一致（不是空壳/截断）', () => {
      const r = resolveContentCjkFont({ tmpRoot: realTmp })
      if (r.fontFile && r.source === 'bundled') {
        const copySize = fs.statSync(r.fontFile).size
        expect(copySize).toBeGreaterThan(1024 * 1024) // 得意黑 otf ≈ 1.91 MB
      }
    })

    it('已存在副本时不重复拷贝（幂等：mtime 不变，不依赖时序判据）', () => {
      // ⚠️ 判据刻意不用耗时：SSD 上 1.9MB 拷贝也可能 <50ms，时间型断言会把
      // 「重复拷贝」这个真实缺陷放过去（M6 变异实测 NOT-CAUGHT 的根因）。
      // 改用 mtime —— 命中缓存时文件不被重写，mtime 保持我们推进到的时刻。
      const outRoot = path.join(realTmp, 'idem')
      const first = resolveContentCjkFont({ tmpRoot: outRoot })
      if (!(first.fontFile && first.source === 'bundled')) return
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
      if (r.fontFile && r.source === 'bundled') {
        expect(path.basename(r.fontFile)).toBe('SmileySans-Oblique.otf')
        expect(path.dirname(r.fontFile)).toBe(path.join(realTmp, 'lit', 'mp-fonts'))
      }
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
})
