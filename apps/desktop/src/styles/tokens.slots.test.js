/**
 * tokens.css 语义槽契约测试（批次 2：ui-apple-token-retirement Task 2）
 *
 * 钉死四件事：
 * 1. 迁移 `--apple-*` 前必须补齐的语义槽真实存在且值正确（字重/字体族/行高/动效/间距补槽）；
 * 2. 阴影级差与既有品牌色相口径一致（`rgba(30, 27, 75, α)`）；
 * 3. 暗色补齐的 `--color-text-*` 与 `--color-primary-light` 必须**真覆盖**（不得等于浅色值），
 *    且暗色文字档在暗色卡片底上对比度 ≥ 4.5:1（可读性下限，防止「深字落深底」复发）；
 * 4. 既有浅色关键槽零改动（本批次是纯新增 + 暗色修复，不得顺手改浅色观感）。
 *
 * 另锁一处历史缺陷：`video-creation-tokens.css` 暗色块的 `--text` 曾转发到**背景** token
 * `--ep-bg`（2026-09-20 暗色不可读事故根因），此处按「不得指向背景槽 + 对比度达标」双断言钉死。
 *
 * 断言规范（QM-3）：结构类断言用 toEqual/toBe，避免清一色 toContain。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const tokensCss = read('./tokens.css')
const videoCreationTokensCss = read('./video-creation-tokens.css')

/** 取 CSS 变量定义：返回 { name: value }，scope 为 root 或 dark */
function readVarBlock (css, scope) {
  const startIdx = scope === 'dark'
    ? css.indexOf('[data-theme="dark"]')
    : css.indexOf(':root {')
  const block = css.slice(startIdx, startIdx + css.slice(startIdx).indexOf('\n}'))
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((m) => [m[1], m[2].trim()]),
  )
}

const light = readVarBlock(tokensCss, 'root')
const dark = readVarBlock(tokensCss, 'dark')

/** 相对亮度（WCAG 2.x） */
function luminance (hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) throw new Error(`只支持 6 位 hex，收到: ${hex}`)
  const channels = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast (fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

describe('批次 2：迁移前必须补齐的语义槽', () => {
  it('字重槽', () => {
    expect({
      regular: light['--font-weight-regular'],
      medium: light['--font-weight-medium'],
      semibold: light['--font-weight-semibold'],
      bold: light['--font-weight-bold'],
    }).toEqual({ regular: '400', medium: '500', semibold: '600', bold: '700' })
  })

  it('字体族槽（取值与别名层现值一致，保证迁移时字体渲染不变）', () => {
    expect(light['--font-family-display']).toBe("'SF Pro Display', 'Inter', 'PingFang SC', system-ui, sans-serif")
    expect(light['--font-family-text']).toBe("'SF Pro Text', 'Inter', 'PingFang SC', system-ui, sans-serif")
    expect(light['--font-family-mono']).toBe("'SF Mono', 'JetBrains Mono', 'Consolas', monospace")
  })

  it('行高槽', () => {
    expect({
      tight: light['--leading-tight'],
      normal: light['--leading-normal'],
      relaxed: light['--leading-relaxed'],
    }).toEqual({ tight: '1.2', normal: '1.5', relaxed: '1.625' })
  })

  it('动效槽（时长与缓动）', () => {
    expect({
      fast: light['--duration-fast'],
      normal: light['--duration-normal'],
      slow: light['--duration-slow'],
    }).toEqual({ fast: '120ms', normal: '200ms', slow: '320ms' })
    expect({
      easeDefault: light['--ease-default'],
      spring: light['--ease-spring'],
      inOut: light['--ease-in-out'],
    }).toEqual({
      easeDefault: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
      spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    })
  })

  it('间距补槽：--spacing-16（批次 5 history-page 的唯一缺档）', () => {
    expect(light['--spacing-16']).toBe('64px')
  })

  it('阴影级差与既有品牌色相口径一致（rgba(30, 27, 75, α)）', () => {
    for (const name of ['--shadow-sm', '--shadow-md', '--shadow-lg']) {
      expect(light[name]).toContain('rgba(30, 27, 75,')
    }
  })
})

describe('批次 2：暗色槽补齐与可读性', () => {
  const textSlots = ['--color-text-strong', '--color-text-primary', '--color-text-secondary', '--color-text-muted']

  it('暗色补齐四个文字槽且都真覆盖（不得等于浅色值）', () => {
    for (const name of textSlots) {
      expect(light[name]).toBeTruthy()
      expect(dark[name]).toBeTruthy()
      expect(dark[name]).not.toBe(light[name])
    }
  })

  it('暗色文字档在暗色卡片底上对比度 ≥ 4.5:1', () => {
    const cardBg = dark['--color-bg-card']
    expect(cardBg).toBeTruthy()
    for (const name of textSlots) {
      // strong/primary/secondary/muted 由亮到暗，最低档也必须过线
      expect(contrast(dark[name], cardBg), `${name} 在 ${cardBg} 上对比度不足`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('暗色 --color-primary-light 有覆盖（否则暗色下仍是浅色底）', () => {
    expect(light['--color-primary-light']).toBeTruthy()
    expect(dark['--color-primary-light']).toBeTruthy()
    expect(dark['--color-primary-light']).not.toBe(light['--color-primary-light'])
  })

  it('--color-primary 暗色覆盖（P4C 2026-10-08 修订 desktop-ui-consistency 旧合同）', () => {
    // 旧合同「保持不覆盖」作废：恒定亮色主色 #5048E5 在暗色画布 #1a1a1e 上
    // 2.81:1 不可读，contrast-audit 实测 9 个视图的 .page-title
    // （cohere-page-header 的 color: var(--primary)）全部命中。
    // 修订：暗色提亮 #8b85ff（同色相），亮色 #5048E5 不变（品牌识别不动）。
    expect(light['--color-primary']).toBe('#5048E5')
    expect(dark['--color-primary']).toBe('#8b85ff')
  })
})

describe('批次 2：--text 暗色缺陷回归锁（2026-09-20 事故）', () => {
  const videoRoot = readVarBlock(videoCreationTokensCss, 'root')
  const videoDark = readVarBlock(videoCreationTokensCss, 'dark')

  it('暗色 --text 不得转发到背景类 token（事故根因）', () => {
    const value = videoDark['--text']
    expect(value).toBeTruthy()
    expect(value).not.toMatch(/--ep-bg|--color-bg-|--surface\b|--bg\b/)
  })

  it('暗色 --text 指向前景 token（与浅色 --text 结构对称）', () => {
    expect(videoRoot['--text']).toMatch(/var\(--ink\b/)
    expect(videoDark['--text']).toMatch(/var\(--ink\b/)
  })

  it('暗色 --text 解析目标在暗色底上可读（fallback 值对比度 ≥ 4.5:1）', () => {
    const fallback = /,\s*(#[0-9a-f]{6})\s*\)/i.exec(String(videoDark['--text']))?.[1]
    expect(fallback, '暗色 --text 必须带暗色可读 fallback').toBeTruthy()
    expect(contrast(fallback, videoDark['--ep-bg'])).toBeGreaterThanOrEqual(4.5)
  })
})

describe('批次 2：既有浅色关键槽零改动（回归锁）', () => {
  it('品牌色/圆角/字号/间距快照不变', () => {
    expect({
      primary: light['--color-primary'],
      primaryHover: light['--color-primary-hover'],
      radiusSm: light['--radius-sm'],
      radiusMd: light['--radius-md'],
      radiusLg: light['--radius-lg'],
      fontSizeXs: light['--font-size-xs'],
      fontSizeXxl: light['--font-size-xxl'],
      spacing1: light['--spacing-1'],
      spacing8: light['--spacing-8'],
      shadowSm: light['--shadow-sm'],
      shadowFloat: light['--shadow-float'],
    }).toEqual({
      primary: '#5048E5',
      primaryHover: '#603af9',
      radiusSm: '8px',
      radiusMd: '12px',
      radiusLg: '16px',
      fontSizeXs: '12px',
      fontSizeXxl: '32px',
      spacing1: '4px',
      spacing8: '32px',
      shadowSm: '0 1px 2px rgba(30, 27, 75, 0.06), 0 1px 3px rgba(30, 27, 75, 0.10)',
      shadowFloat: '0 2px 8px rgba(30, 27, 75, 0.08)',
    })
  })

  it('本批次只做新增与暗色修复：浅色块不含任何 --text/--font-weight 之外的重定义', () => {
    // --font-weight-* 是本批次新增（浅色块新键），不得出现于暗色块（字重不随主题变）
    for (const name of ['--font-weight-regular', '--font-weight-bold']) {
      expect(dark[name]).toBeUndefined()
    }
  })
})

// ── 两档主题的语义色可读性（audit-51 / UX 审计阶段 4.1，2026-10-19）──────────────
//
// **为什么单开一块**：上面那条「暗色文字档 ≥4.5:1」只遍历 `textSlots`，而且只在**暗色块**上取数
// （`dark[name]` vs `dark['--color-bg-card']`）。浅色块从来没有被同一把尺量过 ——
// 于是「浅色档的 muted/danger/success/warning 落白底不可读」这件事在测试面上**完全不可表示**。
// 实测（本块当场读数）：暗色 8 档全部 ≥5.13 通过，**浅色有 4 档不及格**（muted 2.67 /
// danger 3.20 / success 1.81 / warning 1.57），而这四档在渲染端是当**文字色**用的
// （`color: var(--color-warning)` 之类，git grep 实测 warning 13 处 / success 17 处 /
// danger 28 处 / text-muted 21 处消费文件）—— 不是只当填充色，所以 4.5:1 这条线适用。
//
// **为什么不直接把颜色改深**：改 token 会改渲染像素，而本仓的视觉基线只能取自 CI 渲染
// （AGENTS QM-4「基线必须与比对环境同源」+ `check-baseline-freshness.js` 要求每张受跟踪基线
// 逐像素等于同一次 run 的 CI 渲染）。所以这一步先把**判据**立起来（零像素风险、当场可合），
// 颜色修正在下一批与基线刷新同 PR 落地。台账因此是**有终点的**：达标即必须删项，删项即由 ≥4.5 兜住。
const CONTRAST_FLOOR = 4.5
const CONTRAST_EPS = 0.01

/** 被量的是"文字档"：四个文字槽 + 三个语义状态色 + 主色（主色作链接/标题文字已实测命中过） */
const CONTRAST_SLOTS = [
  '--color-text-strong',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-primary',
  '--color-danger',
  '--color-success',
  '--color-warning',
]

/**
 * 欠账台账：键 = `<theme>:<slot>`，值 = **当场实测**的最低对比度（对 card / page 两底取更差那个）。
 * 三条规矩（各对应一条判据，都实测有牙）：
 *  - 变差 ⇒ `CONTRAST_DEBTENED`（实测低于登记）；
 *  - 变好但没改这里 ⇒ `LEDGER_STALE_VALUE`（登记必须等于实测；把已修好的留在台账上，
 *    等于给下一个会话留一张"还坏着"的假清单 —— 与本仓「自指度量」同型）；
 *  - 达标 ⇒ 必须删项，不删即 `LEDGER_CLOSED_BUT_REGISTERED`。
 * 台账只能缩小：新增一项必须带实测读数，且新增本身要让判据能分辨（见「未登记欠账」那条）。
 */
const CONTRAST_DEBT = {
  'light:--color-text-muted': 2.65,
  'light:--color-danger': 3.18,
  'light:--color-success': 1.79,
  'light:--color-warning': 1.56,
}

/**
 * 被量的**底**：四档背景槽全部参与，取更差的那个。
 * 只量卡片底会漏掉落在 page / inset 上的文字 —— 实测 `--color-bg-inset #faf6f8` 是**最差**的那一档
 * （muted 在卡片底 2.84、在 inset 底 2.65），而审计条目 audit-51 引的正是 inset 那组数；
 * 判据与审计对齐才算对得上账。新增背景档时必须登记在这里，不得静默少量。
 */
const CONTRAST_BACKGROUNDS = ['--color-bg-canvas', '--color-bg-card', '--color-bg-inset', '--color-bg-page']

/**
 * 最低对比度：文字档对四档背景逐一求，取最小值。
 */
function worstContrast (fg, themeVars, themeName) {
  let worst = Infinity
  let at = ''
  for (const bgSlot of CONTRAST_BACKGROUNDS) {
    const bg = themeVars[bgSlot]
    expect(
      /^#[0-9a-f]{6}$/i.test(String(bg)),
      `${themeName} 块的背景槽 ${bgSlot} 不是 6 位 hex：${bg}`,
    ).toBe(true)
    const c = contrast(fg, bg)
    if (c < worst) { worst = c; at = `${bgSlot}=${bg}` }
  }
  return { ratio: worst, at }
}

describe('两档主题语义色可读性（阶段 4.1 / audit-51）', () => {
  /** 域由 tokens.css 的**实际取值**派生，不抄第二份清单 */
  const domain = []
  for (const [theme, vars] of [['light', light], ['dark', dark]]) {
    for (const slot of CONTRAST_SLOTS) {
      domain.push({ key: `${theme}:${slot}`, theme, slot, value: vars[slot] })
    }
  }

  it('判据域不得塌方：每个槽在两档块里都必须有 6 位 hex 取值', () => {
    // 改名 / 改成 color-mix() / 只在单档定义 —— 三种都会让这个槽从"被量"变成"没量"。
    // 本断言把它们一律判红，而不是静默少测一项（AGENTS R3「读不动的目录必须抛错而不是跳过」同款）。
    expect(domain).toHaveLength(CONTRAST_SLOTS.length * 2)
    for (const d of domain) {
      expect(/^#[0-9a-f]{6}$/i.test(String(d.value)), `${d.key} 取值不是 6 位 hex：${d.value}`).toBe(true)
    }
  })

  it('台账键必须仍在判据域内（键漂移不许静默）', () => {
    const keys = new Set(domain.map((d) => d.key))
    const ghost = Object.keys(CONTRAST_DEBT).filter((k) => !keys.has(k))
    expect(ghost, `台账里有已不在域内的键：${ghost.join(', ')}`).toEqual([])
  })

  it('两档 × 全部语义色的最低对比度：要么 ≥4.5，要么带实测读数登记', () => {
    const rows = []
    const unregistered = []
    const deepened = []
    const staleValue = []
    const closedButRegistered = []

    for (const d of domain) {
      const vars = d.theme === 'light' ? light : dark
      const { ratio: raw, at } = worstContrast(d.value, vars, d.theme)
      const ratio = Number(raw.toFixed(2))
      rows.push(`${d.key.padEnd(30)} ${d.value} ${ratio.toFixed(2)}${ratio < CONTRAST_FLOOR ? ' DEBT' : ''} (最差底 ${at})`)
      const registered = Object.prototype.hasOwnProperty.call(CONTRAST_DEBT, d.key)
      if (ratio >= CONTRAST_FLOOR) {
        if (registered) closedButRegistered.push(`${d.key} 实测 ${ratio} 已达标，必须删掉台账项`)
        continue
      }
      if (!registered) {
        unregistered.push(`${d.key} 实测 ${ratio} < ${CONTRAST_FLOOR} 且未登记`)
        continue
      }
      const booked = CONTRAST_DEBT[d.key]
      if (ratio < booked - CONTRAST_EPS) deepened.push(`${d.key} 实测 ${ratio} 低于登记 ${booked}`)
      else if (ratio > booked + CONTRAST_EPS) staleValue.push(`${d.key} 实测 ${ratio} 高于登记 ${booked} ⇒ 台账值要改成实测`)
    }

    // 每次跑都把整张矩阵打出来：覆盖面的数字必须能在这一行里重取，不许只留结论。
    // eslint-disable-next-line no-console
    console.log(`[tokens-contrast] domain=${domain.length} booked=${Object.keys(CONTRAST_DEBT).length}\n` + rows.join('\n'))
    expect(
      { unregistered, deepened, staleValue, closedButRegistered },
      JSON.stringify({ unregistered, deepened, staleValue, closedButRegistered }, null, 1),
    ).toEqual({ unregistered: [], deepened: [], staleValue: [], closedButRegistered: [] })
  })

  it('台账只能缩小：登记项的数量上界由当场读数钉住', () => {
    // 这是一条**棘轮**：想把新的坏档登记进来让它不红，必须先抬起这个上界，
    // 而上抬这一步在 diff 里是显眼的、且本文件的注释要求写明理由与终局。
    expect(Object.keys(CONTRAST_DEBT).length).toBeLessThanOrEqual(4)
  })

  it('暗色档必须整体达标（防止"只修浅色"把暗色拖下水）', () => {
    for (const slot of CONTRAST_SLOTS) {
      const { ratio, at } = worstContrast(dark[slot], dark, 'dark')
      expect(
        Number(ratio.toFixed(2)),
        `暗色 ${slot}=${dark[slot]} 的最低对比度不足（最差底 ${at}）`,
      ).toBeGreaterThanOrEqual(CONTRAST_FLOOR)
    }
  })
})
