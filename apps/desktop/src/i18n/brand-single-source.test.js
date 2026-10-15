/**
 * brand-single-source.test.js — 产品中文名「汤姆鱼」单一来源回归锁
 *
 * 背景（2026-10-15，change: brand-rename-tomfish）：
 * 产品中文名由「社媒管家」统一改为「汤姆鱼」，英文产品名随之为 Tomfish。
 * 改名前该词散落在 20+ 处（locale、index.html、FirstRun.vue、主进程托盘/登录窗/
 * onboarding、以及十余个测试断言里），任何一处漏改都会造成「同一个产品两个名字」。
 *
 * 本锁的判据（两条，都取源码事实，不取命名直觉）：
 *   ① 渲染端 src/ 与主进程 electron/ 下**不得残留**旧中文品牌名「社媒管家」，
 *      也**不得残留**旧英文品牌名作为对外产品名（'Multi-Publish'）——
 *      后者按「白名单豁免」收敛：user-data 目录名、UA fallback、包名 @multi-publish、
 *      electron 二进制名、水印测试夹具等属于**兼容性/工程标识**，不是用户可见产品名。
 *   ② 新品牌名必须**来自 locale 单一来源**：index.html 的 <title> 与 FirstRun.vue
 *      的欢迎语必须逐字等于 locale 值（tabs.brandTitle / onboarding.welcome），
 *      防止「locale 改了、硬编码没改」的二次漂移。
 *
 * 与 check-no-brand-residue.js 的关系：那条门禁查的是**竞品**品牌词（蚁小二），
 * 与本锁的**自家产品名**口径不同，互不替代。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import zhTabs from '@/locales/tabs/zh'
import enTabs from '@/locales/tabs/en'
import zhOnboarding from '@/locales/onboarding/zh'
import enOnboarding from '@/locales/onboarding/en'

const DESKTOP_ROOT = path.resolve(__dirname, '../..')
const SRC_DIR = path.join(DESKTOP_ROOT, 'src')
const ELECTRON_DIR = path.join(DESKTOP_ROOT, 'electron')

/** 旧中文品牌名：改名前产品名，改后必须 0 命中（含所有代码/文档/测试） */
const LEGACY_ZH = '社媒管家'

/** 新品牌名（locale 单一来源） */
const BRAND_ZH = zhTabs.brandTitle
const BRAND_EN = enTabs.brandTitle

function walk (dir, exts) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // bundle 产物与 node_modules 不参与扫描（前者由 preload 构建生成，后者非本仓源码）
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue
      out.push(...walk(full, exts))
    } else if (exts.some(e => entry.name.endsWith(e))) {
      out.push(full)
    }
  }
  return out
}

const CODE_EXTS = ['.js', '.vue', '.html', '.json', '.cjs']

/** 'Multi-Publish' 的合法残留：工程标识/兼容性路径/历史事实描述，不是用户可见产品名。
 *  判据 = 该字符串出现在「与用户可见文案无关」的位置（目录名、UA、包名、二进制名、夹具、
 *  历史证据文档）。用户可见产品名一律 Tomfish / 汤姆鱼。 */
const LEGACY_EN_ALLOWLIST = [
  /user-data|userData/i, // 旧 user-data 目录名（含变量名拼写），改了就丢用户登录态
  /User-Agent|Mozilla\/5\.0|userAgentFallback/i, // UA fallback 与 UA 测试夹具
  /@multi-publish\//, // workspace 包名
  /multi-publish\.exe/i, // 旧安装包/进程名
  /multi-publish\.com/i, // 历史 API 域名
  /Multi-Publish\s*StealthHelper/i, // 上游 stealth 适配注释
  /debug-profile/i, // 本地调试 profile 路径
  /watermarkText\s*:/i, // ffmpeg 水印夹具文本
  /^\s*(\*|\/\/|\/\*)/, // 注释行：对代码历史的描述，非用户可见文案
]
/** 本测试文件自身（判据文本里必然出现被禁词） */
const SELF = path.basename(new URL(import.meta.url).pathname)

describe('产品中文名单一来源（brand-rename-tomfish）', () => {
  it('locale 单一来源：中文品牌名为「汤姆鱼」', () => {
    expect(BRAND_ZH).toBe('汤姆鱼')
    expect(BRAND_EN).toBe('Tomfish')
    expect(zhOnboarding.welcome).toContain(BRAND_ZH)
    expect(enOnboarding.welcome).toContain(BRAND_EN)
  })

  it('渲染端与主进程源码零残留旧中文品牌名', () => {
    const files = [...walk(SRC_DIR, CODE_EXTS), ...walk(ELECTRON_DIR, CODE_EXTS)]
    const hits = []
    for (const file of files) {
      // bundle 产物由 preload 构建生成，不参与手工品牌锁（其源头在 electron/preload/）
      if (file.endsWith('.bundle.js')) continue
      if (path.basename(file) === SELF) continue
      const text = fs.readFileSync(file, 'utf8')
      if (text.includes(LEGACY_ZH)) hits.push(path.relative(DESKTOP_ROOT, file))
    }
    expect(hits, `以下文件仍含旧品牌名「${LEGACY_ZH}」：${hits.join(', ')}`).toEqual([])
  })

  it('"Multi-Publish" 仅保留工程标识用途（用户可见产品名已收敛为 Tomfish）', () => {
    const files = [...walk(SRC_DIR, CODE_EXTS), ...walk(ELECTRON_DIR, CODE_EXTS)]
    const hits = []
    for (const file of files) {
      if (file.endsWith('.bundle.js')) continue
      if (path.basename(file) === SELF) continue
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, idx) => {
        if (!line.includes('Multi-Publish')) return
        if (LEGACY_EN_ALLOWLIST.some(re => re.test(line))) return
        hits.push(`${path.relative(DESKTOP_ROOT, file)}:${idx + 1}  ${line.trim().slice(0, 100)}`)
      })
    }
    expect(hits, `以下位置把 Multi-Publish 当作用户可见产品名，应改为 Tomfish/汤姆鱼：\n${hits.join('\n')}`).toEqual([])
  })

  it('index.html <title> 与 FirstRun.vue 欢迎语逐字等于 locale（防硬编码漂移）', () => {
    const html = fs.readFileSync(path.join(SRC_DIR, 'index.html'), 'utf8')
    expect(html).toContain(`<title>${BRAND_ZH}</title>`)
    // FirstRun.vue 的欢迎语必须读 locale key（onboarding.welcome），不得硬编码品牌名：
    // 硬编码既是 check-locale-sync --cjk 判定的新增中文硬编码，也是改名漏改的直接入口。
    const firstRun = fs.readFileSync(path.join(SRC_DIR, 'views/FirstRun.vue'), 'utf8')
    expect(firstRun).toContain("$t('onboarding.welcome')")
    expect(firstRun).not.toMatch(/fr-step-title">[^<]*[一-龥][^<]*</)
  })
})
