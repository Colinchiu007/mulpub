// @ts-check
/**
 * film-debrand.test.js — 影视工程「去品牌」回归锁
 *
 * 背景（用户需求 2026-10-20）：
 *   「不希望使用应用的用户知道 Hell Grind 这个信息」。把「Hell Grind / hell-grind」
 *   从**应用内可见文案 + 随包数据 + 代码注释 + 测试**里彻底移除，统一改用
 *   「影视项目案例」/「Film Project Case」。
 *
 * 为什么必须机械拦截：该片名此前散落在 locale、随包 manifest（含**两个场景名**——
 * `scenes[0].name` 与 `"HELL GRIND 51"`，都会渲染进左侧场景树）、随包方法论文档、
 * 主进程流水线描述、E2E 断言与十余个测试夹具里。任何一处漏改，用户就能在界面上
 * 看到原名；而 grep 清理靠临场自觉——本仓历史上正是这样漏掉的（上一轮只清了标题，
 * 场景树根节点与剧本套用提示仍在页面里显示原名）。
 *
 * 判据（两条，都取源码/数据事实）：
 *   ① 扫描域 = 渲染端 src/ + 主进程 electron/（**排除**测试文件与文档，
 *      文档不在应用内可见，且历史记录不应被改写）+ 随包 film-kit 数据与文档；
 *      命中 `/hell[\s_-]*grind/i` 即红。
 *   ② 关键值断言：manifest 的 filmMeta.title / 根场景名、locale 的 title /
 *      libraryTitle / adapt 提示、doctrine 文档首行，均为中性文案且不含原名。
 *
 * 与 brand-single-source.test.js 的关系：那条锁的是**自家产品名**（汤姆鱼/Tomfish），
 * 本锁的是**第三方作品名**，口径不同、互不替代。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import zhFilm from '@/locales/film-engineering/zh'
import enFilm from '@/locales/film-engineering/en'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP_ROOT = path.resolve(HERE, '../..')
const SRC_DIR = path.join(DESKTOP_ROOT, 'src')
const ELECTRON_DIR = path.join(DESKTOP_ROOT, 'electron')

/**
 * 被禁止的作品名。拼接构造，避免本文件自身命中扫描（扫描域也排除了测试文件）。
 *
 * CCG 深度审查第四轮 i6：原先未锚定，`shell-grind` 这类**无害子串**也会命中，
 * 在 fail-closed 锁里就是一条 CI 假红。改为「两侧不得紧邻单词字符」。
 */
const BANNED = new RegExp(`(^|[^\\w])${['hell', 'grind'].join('[\\s_-]*')}($|[^\\w])`, 'i')

/**
 * 扫描扩展名白名单。
 *
 * CCG 深度评审 i3（第二轮）指出原先只扫 `src:{js,vue,json}` / `electron:{js,json,md}`：
 * 一旦仓库迁 TS（`.ts/.mts/.cts`）、新增模板（`.html`）或有人在 src 下放 `.md`，
 * 被禁词就能逃逸，而锁依然绿 —— 「全量扫描」名不副实。
 * 现在两侧取并集白名单，并排除构建产物目录（`walk` 里已跳过）。
 */
const SCAN_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.vue', '.json', '.md', '.html']

/**
 * 文件数下界：扫描域是「整个 src/ + electron/ 的非测试文件」，随代码增长只会变多。
 * 本仓结构解析类判据的硬要求是「必须对命中数做下界断言」——否则判据失效（遍历返回空）
 * 与「真的没有命中」在结果上一模一样，锁会静默变成摆设。
 * 取一个明显低于当前实际值、又远高于「遍历坏掉」的下界。
 */
const MIN_SCANNED_FILES = 400

function walk (dir, exts, filter) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue
      out.push(...walk(full, exts, filter))
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      if (filter && !filter(full)) continue
      out.push(full)
    }
  }
  return out
}

/**
 * 测试文件不参与「去品牌」判定：夹具里保留任意值都是合法的，且它们不面向用户。
 *
 * CCG 深度审查第三轮 i4：原先正则限死 `[cm]?js`，而 `SCAN_EXTS` 已扩到 `.ts/.mts/.cts/.vue`，
 * 于是将来出现 `foo.test.ts` 时会**漏排除**、被夹具里的旧名误判成红 —— 与「迁 TS 不逃逸」
 * 的声明自相矛盾。改成不限扩展名的 `.<test|spec>.` 段匹配。
 */
const isNotTest = (p) => !/[\\/][^\\/]*\.(test|spec)\.[^\\/]+$/.test(p)

describe('影视工程去品牌（film-debrand）', () => {
  it('⓪ 判据自检：被禁词正则既不漏（真实形态命中）也不误伤（无害子串不命中）', () => {
    // 命中：正式片名的几种书写形态
    for (const hit of [['Hell', 'Grind'].join(' '), ['hell', 'grind'].join('-'), ['HELL', 'GRIND'].join('_'), ['hell', 'grind'].join('')]) {
      expect(BANNED.test(`文案：${hit} 到这里`), `应命中：${hit}`).toBe(true)
    }
    // 不命中：包含相同字母序列但两侧紧邻单词字符的无害子串（CCG 第四轮 i6 的假红形态）
    for (const safe of [['shell', 'grind'].join('-'), ['michel', 'grinder'].join(''), 'MichelleGrindstone']) {
      expect(BANNED.test(safe), `不应命中：${safe}`).toBe(false)
    }
  })

  it('① 渲染端与非测试主进程源码零命中被禁作品名（含注释）', () => {
    // 测试文件由 isNotTest 排除（夹具里保留任意值都合法，且它们不面向用户），
    // 因此不需要再按文件名排除本文件 —— 原先的 SELF 过滤是死逻辑（CCG 深度评审 i6）。
    // CCG 第五轮 i6：`public/` 静态资产同样会随包上屏（index.html / 图标等），纳入扫描域。
    const files = [
      ...walk(SRC_DIR, SCAN_EXTS, isNotTest),
      ...walk(path.join(DESKTOP_ROOT, 'public'), SCAN_EXTS, isNotTest),
      ...walk(ELECTRON_DIR, SCAN_EXTS, isNotTest),
    ]

    // 下界断言：遍历坏掉时不能让判据静默变绿。
    expect(
      files.length,
      `扫描到的文件数 ${files.length} 低于下界 ${MIN_SCANNED_FILES} —— 文件遍历可能失效（判据会假绿）`,
    ).toBeGreaterThanOrEqual(MIN_SCANNED_FILES)

    const hits = []
    for (const file of files) {
      if (file.endsWith('.bundle.js')) continue
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, idx) => {
        if (BANNED.test(line)) {
          hits.push(`${path.relative(DESKTOP_ROOT, file)}:${idx + 1}  ${line.trim().slice(0, 110)}`)
        }
      })
    }
    expect(hits, `以下位置仍含被禁作品名，用户可见面必须中性化：\n${hits.join('\n')}`).toEqual([])
  })

  it('② 随包 manifest：片名与全部场景名中性化，来源链接已移除', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ELECTRON_DIR, 'film-kit', 'film-manifest.json'), 'utf8')
    )
    // 精确值已经蕴含「不含原名」，无需再单独 BANNED.test（CCG 深度评审 i6 指出的冗余断言）。
    expect(manifest.filmMeta.title).toBe('Film Project Case')

    // 场景树会把这些 name 直接渲染给用户 —— 每一个都不得含原名
    const badScenes = manifest.scenes.filter((s) => BANNED.test(String(s.name)))
    expect(badScenes.map((s) => s.name), '随包场景名仍含原名').toEqual([])

    // 用户明确要求「彻底移除来源链接」：原项目页 / 外部 API 基址不得随包
    expect(manifest.filmMeta.source).toBeUndefined()

    // CCG 第五轮 i6：图片资产此前只有一次性探针 + 人工目视取证，没有持久判据。
    // 这里补两条机械锁：文件名与清单键/值都不得含被禁词（图片内容本身的人工目视结论
    // 写在执行记录里 —— OCR 型判据不在本锁能力范围内，已登记为遗留）。
    const imagesDir = path.join(ELECTRON_DIR, 'film-kit', 'images')
    const imageFiles = fs.readdirSync(imagesDir).filter((n) => /\.(webp|png|jpe?g)$/i.test(n))
    expect(imageFiles.length, `图片资产数 ${imageFiles.length} 过低 —— 目录可能变了`).toBeGreaterThanOrEqual(1)
    expect(imageFiles.filter((n) => BANNED.test(n)), '图片文件名含被禁作品名').toEqual([])
    const imagesManifest = JSON.parse(fs.readFileSync(path.join(imagesDir, 'images-manifest.json'), 'utf8'))
    expect(Object.keys(imagesManifest).filter((k) => BANNED.test(k)), '图片清单键含被禁作品名').toEqual([])
    expect(BANNED.test(JSON.stringify(imagesManifest)), '图片清单内容含被禁作品名').toBe(false)
  })

  it('③ locale：标题 / 分镜库总标题 / 剧本套用提示均为中性文案（zh/en 成对）', () => {
    expect(zhFilm.title).toBe('影视工程 · 影视项目案例制作流水线')
    expect(enFilm.title).toBe('Film Engineering · Film Project Case Production Pipeline')
    expect(zhFilm.libraryTitle).toBe('影视项目案例')
    expect(enFilm.libraryTitle).toBe('Film Project Case')

    // 历史上出现过的旧术语（2026-10-19 那轮的「影响项目案例 / Impact Project Case」与更早的「工程案例」）。
    // CCG 深度审查 i6：原先只对 libraryTitle 查回退，覆盖面不全 —— title / hub.subtitle / adapt 三条
    // 提示同样可能被后人改回旧术语而本锁不报。这里对所有去品牌字段统一查。
    const LEGACY_TERMS = ['影响项目案例', 'Impact Project Case', '工程案例']

    for (const [lang, bundle] of [['zh', zhFilm], ['en', enFilm]]) {
      const adapt = bundle.adapt
      const fields = {
        title: bundle.title,
        libraryTitle: bundle.libraryTitle,
        'hub.subtitle': bundle.hub && bundle.hub.subtitle,
        // CCG 第四轮 i1：hints 此前不在任何锁的视野里（实测三个 hint 都不含标签名，
        // 但「无人守」这件事本身要关掉 —— 以后有人往里写旧标签就会红）
        'hub.hints.auto': bundle.hub && bundle.hub.hints && bundle.hub.hints.auto,
        'hub.hints.canvas': bundle.hub && bundle.hub.hints && bundle.hub.hints.canvas,
        'hub.hints.classic': bundle.hub && bundle.hub.hints && bundle.hub.hints.classic,
        'adapt.scriptPlaceholder': adapt.scriptPlaceholder,
        'adapt.roleMapHint': adapt.roleMapHint,
        'adapt.roleKeyPlaceholder': adapt.roleKeyPlaceholder,
      }
      for (const [field, value] of Object.entries(fields)) {
        expect(typeof value, `${lang}.${field} 必须是非空字符串`).toBe('string')
        expect(String(value).trim().length, `${lang}.${field} 不得为空`).toBeGreaterThan(0)
        expect(BANNED.test(String(value)), `${lang}.${field} 仍含被禁作品名`).toBe(false)
        for (const legacy of LEGACY_TERMS) {
          expect(String(value), `${lang}.${field} 回退到了旧术语「${legacy}」`).not.toContain(legacy)
        }
      }
      // Hub 第 3 页签用的是**上一轮用户明确指定**的短标签「项目案例 / Project Cases」，
      // 正式术语「影视项目案例 / Film Project Case」用在 title / libraryTitle。
      // CCG 第五轮 i4 指出：把用户的短标签改成正式术语属「评审链覆盖用户决定」，本轮已回退。
      // 这里锁的是**一致性**（副标题必须提到页签用的那个词），而不是「页签等于 libraryTitle」。
      expect(bundle.hub.subtitle).toContain(bundle.hub.tabs.classic)
      expect(bundle.hub.tabs.classic).not.toContain('工程案例')
      // 短标签不得含被禁词
      expect(BANNED.test(String(bundle.hub.tabs.classic))).toBe(false)
    }
  })

  it('④ 随包方法论文档与 SCHEMA 不含被禁作品名（随包即随应用）', () => {
    const kitFiles = ['prompt-doctrine.zh.md', 'SCHEMA.md']
    for (const name of kitFiles) {
      const p = path.join(ELECTRON_DIR, 'film-kit', name)
      const text = fs.readFileSync(p, 'utf8')
      const hitLine = text.split('\n').find((l) => BANNED.test(l))
      expect(hitLine, `随包文档 ${name} 仍含被禁作品名：${hitLine}`).toBeUndefined()
    }
  })

  /**
   * ⑤ 品牌回流的**上游**护栏（CCG 深度评审 i4，高危域 datamigration）。
   *
   * 事实：`scripts/film-engineering/*.py` 是随包 film-kit 的唯一重建入口，它会从源语料
   * 把片名 / 来源 URL 原样写回 `film-manifest.json` 与 `shot-library.json`。原先的防线只有
   * ①（CI 事后扫 electron/），属于「已经写回、等 CI 打红」。这里补两道：
   *   a) 脚本自身在写盘后立刻自检（写回即失败，不用等 CI）；
   *   b) 脚本与 loader 的 `FILM_PROMPT_MAX_LEN` 常量必须同值 —— kit-loader 的注释声称
   *      「四处同源」，此前**没有任何判据校验这一点**，注释随时可能与实现脱节。
   */
  it('⑤ 重建脚本自带写前中性化自检，且 prompt 长度上限与 kit-loader 同值（上游护栏）', () => {
    const REPO_ROOT = path.resolve(DESKTOP_ROOT, '../..')
    const scriptDir = path.join(REPO_ROOT, 'scripts', 'film-engineering')
    // 目录里除导入脚本外还可能有它的 python 测试（test_*.py），只对非测试脚本做判定
    const pyFiles = fs
      .readdirSync(scriptDir)
      .filter((n) => n.endsWith('.py') && !n.startsWith('test_'))
    // 结构判据必须对命中数做下界断言：目录为空/改名时判据不能静默变绿
    expect(
      pyFiles.length,
      `scripts/film-engineering 下应至少有 1 个导入脚本（非 test_*.py），实际 ${pyFiles.length}`,
    ).toBeGreaterThanOrEqual(1)

    // CCG 第五轮 i2：原先用 `pyFiles[0]` 当导入器并直接 `.match(...)[1]` —— 目录里一旦
    // 多出第二个非 test .py（且不含该常量），就会以 `null[1]` 的 TypeError 变红，错误信息
    // 完全指不到问题。现在**按内容定位**：谁定义 FILM_PROMPT_MAX_LEN，谁就是导入器。
    const scripts = pyFiles.map((name) => ({ name, src: fs.readFileSync(path.join(scriptDir, name), 'utf8') }))
    const importerEntry = scripts.find((s) => /^FILM_PROMPT_MAX_LEN\s*=\s*(\d+)\s*$/m.test(s.src))
    expect(
      importerEntry,
      `scripts/film-engineering 下找不到定义 FILM_PROMPT_MAX_LEN 的脚本（现有：${pyFiles.join(', ')}）`,
    ).toBeTruthy()
    const importer = importerEntry.src
    const pyValue = importer.match(/^FILM_PROMPT_MAX_LEN\s*=\s*(\d+)\s*$/m)[1]

    // 导入器必须带写前中性化自检
    expect(
      /def assert_neutral_payload\(/.test(importer) && /assert_neutral_payload\(/.test(importer),
      `导入器 ${importerEntry.name} 缺少写前中性化自检（assert_neutral_payload）`,
    ).toBe(true)
    // CCG 第五轮 i1（Critical）：只有自检、没有中性化时重建会**必然失败** ——
    // build_manifest/build_shot_library 产出的是原始语料，写前自检会无条件拦截。
    // 所以「中性化」与「自检」必须成对存在，且两条写盘路径都要调用中性化。
    expect(/def neutralize_manifest\(/.test(importer), '导入器缺少 neutralize_manifest（重建将必然失败）').toBe(true)
    expect(/def neutralize_payload\(/.test(importer), '导入器缺少 neutralize_payload').toBe(true)
    const neutralizeCalls = (importer.match(/neutralize_(manifest|payload|text)\(/g) || []).length
    // 定义 3 个 + 两条写盘路径各调用 manifest/payload/registry/doctrine(4) ≈ 11 起；
    // 下界取 6，既能挡住「把调用删了」，又不会因小幅重构误红
    expect(neutralizeCalls, `中性化调用点过少（${neutralizeCalls}）—— 写盘路径可能绕过了中性化`).toBeGreaterThanOrEqual(6)
    // 每个定义了该常量的脚本都必须与 kit-loader 同值（不只看第一个）
    const loaderSrc = fs.readFileSync(
      path.join(ELECTRON_DIR, 'services', 'film-engineering', 'kit-loader.js'),
      'utf8'
    )
    const jsConst = loaderSrc.match(/^const FILM_PROMPT_MAX_LEN\s*=\s*(\d+)\s*$/m)
    expect(jsConst, 'kit-loader.js 里找不到 FILM_PROMPT_MAX_LEN 定义').not.toBeNull()
    let constantSites = 0
    for (const { name, src } of scripts) {
      const pyConst = src.match(/^FILM_PROMPT_MAX_LEN\s*=\s*(\d+)\s*$/m)
      if (!pyConst) continue
      constantSites += 1
      expect(
        jsConst[1],
        `常量不同源：${name} 里是 ${pyConst[1]}，kit-loader 里是 ${jsConst[1]} —— 导入/校验必须同一契约`,
      ).toBe(pyConst[1])
    }
    expect(constantSites, '没有任何脚本定义 FILM_PROMPT_MAX_LEN').toBeGreaterThanOrEqual(1)

    // CCG 第四轮 i4：kit-loader 的注释长期声称「四处同源」，但此前只有 py↔loader 被判。
    // 这里把 **IPC 校验点**也纳入（`prompt.length > N` 的每个字面量都必须等于同一值），
    // 并把注释改成与已验证范围一致 —— 注释与实现不许再脱节。
    const ipcSrc = fs.readFileSync(path.join(ELECTRON_DIR, 'ipc-handlers', 'film-engineering.js'), 'utf8')
    const ipcLiterals = [...ipcSrc.matchAll(/prompt\.length\s*>\s*(\d+)/g)].map((m) => m[1])
    // 下界断言：IPC 校验点消失或改写时判据不能静默变绿
    expect(ipcLiterals.length, 'IPC 校验里找不到 prompt 长度上限字面量').toBeGreaterThanOrEqual(1)
    for (const value of ipcLiterals) {
      expect(value, `IPC 校验上限 ${value} 与导入器 ${pyValue} 不同源`).toBe(pyValue)
    }

    // 写盘入口必须是带自检的版本：**任何**含随包产物文件名的写盘行都必须归因到 write_neutral_*
    // （CCG 第四轮 i3：原先只匹配 write_json_atomic( 与 prompt-doctrine.zh.md 的 open(，
    //  新代码用 open()+json.dump 直写 kit 产物时静态检查不报，只剩落盘后复核兜底）
    // 第五轮 i2：对**每一个**非 test 脚本都查，而不是只查第 0 个。
    const KIT_PRODUCTS = ['film-manifest.json', 'shot-library.json', 'reference-registry.json', 'prompt-doctrine.json', 'prompt-doctrine.zh.md']
    const bareWrites = []
    for (const { name, src } of scripts) {
      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]
        if (!KIT_PRODUCTS.some((p) => line.includes(p))) continue
        // 允许：中性化写盘入口、定义处、注释
        if (/write_neutral_(json_atomic|text)/.test(line)) continue
        if (/def write_neutral_|^\s*#/.test(line)) continue
        // 形如 `path = os.path.join(out_dir, "film-manifest.json")` 的纯路径声明不算写盘
        const nextLine = lines[i + 1] || ''
        if (!/open\(|write_json_atomic\(|json\.dump\(/.test(line) && !/open\(|json\.dump\(|write_json_atomic\(/.test(nextLine)) continue
        bareWrites.push(`${name}:第${i + 1}行 ${line.trim()}`)
      }
    }
    expect(bareWrites, `导入脚本仍有绕过自检的裸写：${bareWrites.join(' | ')}`).toEqual([])
  })

  /**
   * ⑥ 测试层不得把被禁作品名写进**断言**（CCG 第四轮 i5）。
   *
   * 本仓真实的逃逸史就发生在这里：`film-engineering-service.test.js` 曾断言
   * `title === <被禁作品名>`、E2E 曾断言页面 `.includes(<被禁作品名>)` —— 把泄漏写成了契约。
   * 锁 ① 整体豁免测试（夹具里出现任意值是合法的），于是这类断言没有任何判据在看。
   * 这里补一层**窄扫描**：只禁「断言语境里出现被禁词」，夹具值本身不判。
   */
  it('⑥ 测试与 E2E 源码里不得把被禁作品名写进断言（夹具值不判）', () => {
    const REPO_ROOT = path.resolve(DESKTOP_ROOT, '../..')
    const testFiles = [
      ...walk(SRC_DIR, SCAN_EXTS, (p) => /\.(test|spec)\.[^\\/]+$/.test(p)),
      ...walk(ELECTRON_DIR, SCAN_EXTS, (p) => /\.(test|spec)\.[^\\/]+$/.test(p)),
      ...walk(path.join(DESKTOP_ROOT, 'tests', 'e2e'), SCAN_EXTS, () => true),
    ]
    expect(testFiles.length, `测试/E2E 文件数 ${testFiles.length} 过低 —— 遍历可能失效`).toBeGreaterThanOrEqual(50)

    const hits = []
    for (const file of testFiles) {
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, idx) => {
        if (!BANNED.test(line)) return
        // 断言语境：toXxx( / includes( / toContain / toBe / expect( / check( / assert
        if (!/\b(to[A-Z]\w*|includes|expect|check|assert|assertEquals|assertIn)\s*\(/.test(line)) return
        hits.push(`${path.relative(DESKTOP_ROOT, file)}:${idx + 1}  ${line.trim().slice(0, 120)}`)
      })
    }
    expect(hits, `以下断言把被禁作品名写成了契约（应改成断言中性文案或断言「不含」）：\n${hits.join('\n')}`).toEqual([])
  })
})
