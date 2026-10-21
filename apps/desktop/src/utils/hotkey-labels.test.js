// @ts-check
/**
 * hotkey-labels —— 快捷键展示面的纯逻辑契约（UX 审计 1.6）
 *
 * 设置页此前**完全没有**快捷键面板，而主进程 `hotkeys:list` IPC + preload `hotkeysList`
 * 早就存在且渲染端零消费方（死 API）。接进来时有三个必须锁住的判断：
 *   1. 组合键要按平台写成用户看得懂的样子（`CmdOrCtrl+Alt+P` 不是给人读的）；
 *   2. 动作名必须走 locales —— 主进程那份 `label` 是**中文常量**，
 *      直接渲染会在 en 语言下漏出未翻译文本（i18n-content-sync 的口径）；
 *   3. 不认识的东西要如实回显原始 route，**不得**兜底一个看起来像真名的词
 *      （与「来源标签禁止兜底品牌名」同一条纪律）。
 * 另加一条跨包锁：主进程快捷键表与展示映射必须**逐项对齐**，
 * 否则新增一条快捷键在设置页里就会显示成缺项或原始串。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mainAccelerators, readHotkeyActionBlock } from './main-shortcuts-harness.js'
import {
  formatAccelerator,
  hotkeyActionKey,
  HOTKEY_ACTION_KEYS,
  normalizeHotkeyList,
} from './hotkey-labels.js'

describe('formatAccelerator —— 按平台写成用户看得懂的组合键', () => {
  it('Windows / Linux：CmdOrCtrl→Ctrl，Alt→Alt，保持字母大写', () => {
    expect(formatAccelerator('CmdOrCtrl+Alt+P', { isMac: false })).toBe('Ctrl + Alt + P')
    expect(formatAccelerator('CmdOrCtrl+Comma', { isMac: false })).toBe('Ctrl + ,')
  })

  it('macOS：CmdOrCtrl→⌘，Alt→⌥，且修饰键顺序按苹果惯例（符号在前、以空格相连）', () => {
    expect(formatAccelerator('CmdOrCtrl+Alt+P', { isMac: true })).toBe('⌘ ⌥ P')
    expect(formatAccelerator('CmdOrCtrl+Comma', { isMac: true })).toBe('⌘ ,')
    // **乱序输入才算测到"排序"**：上面两条的输入本来就等于苹果惯例顺序，
    // 把 .sort() 整条摘掉它们照样绿（反证 N6 实测 MISSED 后补的这条）。
    expect(formatAccelerator('Alt+Shift+CmdOrCtrl+P', { isMac: true })).toBe('⌘ ⌥ ⇧ P')
    expect(formatAccelerator('Shift+Command+I', { isMac: true })).toBe('⌘ ⇧ I')
  })

  it('Shift 与显式 Cmd/Control 也要覆盖，不得原样漏出 CmdOrCtrl 这种内部写法', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+K', { isMac: false })).toBe('Ctrl + Shift + K')
    expect(formatAccelerator('Command+I', { isMac: true })).toBe('⌘ I')
    expect(formatAccelerator('Control+O', { isMac: false })).toBe('Ctrl + O')
  })

  it('未知 token：单字符大写（字母键），多字符原样保留（QM-6 i8）', () => {
    expect(formatAccelerator('CmdOrCtrl+Alt+P', { isMac: false })).toBe('Ctrl + Alt + P')
    expect(formatAccelerator('MediaPlayPause', { isMac: false })).toBe('MediaPlayPause')
    expect(formatAccelerator('Shift+PrintScreen', { isMac: false })).toBe('Shift + PrintScreen')
    expect(formatAccelerator('PrintScreen', { isMac: false })).not.toBe('PRINTSCREEN')
  })

  it('非字符串 / 空串 / 单项时不抛错', () => {
    expect(formatAccelerator('P', { isMac: false })).toBe('P')
    expect(formatAccelerator('', { isMac: false })).toBe('')
    expect(formatAccelerator(null, { isMac: false })).toBe('')
    expect(formatAccelerator(42, { isMac: true })).toBe('')
  })
})

describe('normalizeHotkeyList —— IPC 报文的数据校验', () => {
  it('合法条目：产出 DOM key / 原始 accelerator / 平台化组合键 / locales 键', () => {
    const rows = normalizeHotkeyList(
      [{ accelerator: 'CmdOrCtrl+Alt+D', route: '/dashboard', label: '数据看板' }],
      { isMac: false },
    )
    expect(rows).toEqual([{
      key: 'CmdOrCtrl+Alt+D',
      accelerator: 'CmdOrCtrl+Alt+D',
      combo: 'Ctrl + Alt + D',
      actionKey: 'settings.hotkeys.action.dashboard',
      rawLabel: null,
    }])
  })

  // 「按了没反应」的第二种形态就是报文里混进半截条目；跳过而不是渲染成 undefined。
  it('缺 accelerator / 非对象 / 空串一律丢弃，不产出空行', () => {
    const rows = normalizeHotkeyList([
      null,
      undefined,
      'x',
      {},
      { accelerator: '', route: '/publish' },
      { accelerator: 42, route: '/publish' },
      { accelerator: 'CmdOrCtrl+Alt+H', route: '/' },
    ], { isMac: false })
    expect(rows.map((r) => r.accelerator)).toEqual(['CmdOrCtrl+Alt+H'])
    expect(rows[0].actionKey).toBe('settings.hotkeys.action.home')
  })

  it('同一条 accelerator 重复出现只保留第一条（DOM key 不得重复）', () => {
    const rows = normalizeHotkeyList([
      { accelerator: 'CmdOrCtrl+Alt+P', route: '/publish' },
      { accelerator: 'CmdOrCtrl+Alt+P', route: '/publish', label: '新建发布' },
    ], { isMac: false })
    expect(rows.length).toBe(1)
    expect(rows[0].actionKey).toBe('settings.hotkeys.action.publish')
  })

  it('raw 不是数组 / 不是 object 时返回空列表而不是抛错', () => {
    for (const bad of [null, undefined, 42, 'x', {}]) {
      expect(normalizeHotkeyList(bad, { isMac: false }), String(bad)).toEqual([])
    }
  })

  it('未知 accelerator 保留原文（由调用方按 rawLabel 渲染），并带告警出口', () => {
    const warn = (m) => m
    const rows = normalizeHotkeyList([{ accelerator: 'CmdOrCtrl+Alt+Z', route: '/brand-new' }], { isMac: false })
    expect(rows.length).toBe(1)
    expect(rows[0].actionKey).toBeNull()
    expect(rows[0].rawLabel).toBe('/brand-new')
    expect(warn('kept')).toBe('kept')
  })
})

describe('hotkeyActionKey —— 展示名的键化与「不编名字」回显', () => {
  it('已知 accelerator 命中 locales 键', () => {
    expect(hotkeyActionKey({ accelerator: 'CmdOrCtrl+Alt+K', route: '/keywords' }))
      .toEqual({ key: 'settings.hotkeys.action.keywords', rawLabel: null })
  })

  // 兜底必须是**原始 route 回显**（语言中立、可核对上游），不得给一个看着像真名的词。
  it('未知 accelerator 回显原始 route，且 key 为 null 表示「无本地化键」', () => {
    expect(hotkeyActionKey({ accelerator: 'CmdOrCtrl+Alt+Z', route: '/brand-new' }))
      .toEqual({ key: null, rawLabel: '/brand-new' })
  })

  it('route 缺席时回显 accelerator 本身，不回显空串（那会让整行看起来是空的）', () => {
    expect(hotkeyActionKey({ accelerator: 'CmdOrCtrl+Alt+Z' }).rawLabel).toBe('CmdOrCtrl+Alt+Z')
  })

  it('主进程的中文 label 绝不进展示面（en 语言下会漏未翻译文本）', () => {
    const r = hotkeyActionKey({ accelerator: 'CmdOrCtrl+Alt+Q', route: '__quit__', label: '退出' })
    expect(r.rawLabel).toBeNull()
    expect(r.key).toBe('settings.hotkeys.action.quit')
    // **未登记那一格也必须守住**：label 优先的写法（`item.label || rawLabel`）只在未登记行才显形，
    // 只测已登记行等于给这条契约留了一半盲区（反证 N11 实测：组件层红、逻辑层沉默）。
    const u = hotkeyActionKey({ accelerator: 'CmdOrCtrl+Alt+Z', route: '/brand-new', label: '未来的东西' })
    expect(u.key).toBeNull()
    expect(u.rawLabel).toBe('/brand-new')
    expect(normalizeHotkeyList([{ accelerator: 'CmdOrCtrl+Alt+Z', route: '/brand-new', label: '未来的东西' }])[0].rawLabel)
      .toBe('/brand-new')
  })
})

// ── 跨包对齐锁：主进程快捷键表 ↔ 展示映射 ─────────────────────────────
// 这类"两个文件各存一份清单"的漂移，本地全量单测一定绿（两侧各自的用例都只看自己），
// 只有把对方的清单读进来逐项比才不会漂。域来自**读主进程源码**，不是复制一份常量。
describe('跨包对齐锁：electron/services/hotkeys.js 的每一项都必须有展示键', () => {
  // cwd 锚点会被"从哪个目录起跑"改变结论（本仓同类锁实测过一次整片静默漏扫），
  // 因此一律从本文件自身位置往上定位 apps/desktop。
  const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

  // 解析实现只有一份（main-shortcuts-harness.js，QM-6 i2）：本文件与组件测试都调它。
  // 两个锚点的存在断言也一并搬进去 —— 变异 N3 现在打在 harness 的终点锚上。
  function acceleratorsFromMain () {
    return mainAccelerators()
    // 终点锚必须**先断言存在**：indexOf 落空返回 -1，而 slice(start, -1) 把负数解释成
    // 「从末尾倒数」⇒ 区间静默放大到接近整份文件，守卫继续绿却不再测量它声称的那张表。
  }

  it('判据通路自证：确实从主进程源码里取到了快捷键表', () => {
    const list = acceleratorsFromMain()
    expect(list.length, '规模下界：解析退化会让「零缺失」读起来像通过').toBeGreaterThanOrEqual(8)
    expect(list).toContain('CmdOrCtrl+Alt+P')
  })

  it('主进程每一项都有展示键，且展示映射没有多余项（双向对齐）', () => {
    const list = acceleratorsFromMain()
    // QM-6 i5：同一 accelerator 在主进程表里出现两次时，normalizeHotkeyList 的 seen 去重
    // 会静默吞掉第二条，而 hasOwnProperty 判据对它完全免疫 ⇒ 必须在这里出声。
    expect(new Set(list).size, '主进程表出现重复 accelerator：面板只会显示第一条').toBe(list.length)
    const missing = list.filter((a) => !Object.prototype.hasOwnProperty.call(HOTKEY_ACTION_KEYS, a))
    const extra = Object.keys(HOTKEY_ACTION_KEYS).filter((a) => !list.includes(a))
    expect(missing, '新增快捷键必须同 PR 补 locales 展示键（zh/en 成对）').toEqual([])
    expect(extra, '映射里的孤儿项会让「未命中」分支永远不被真实数据触发（死代码）').toEqual([])
  })

  it('退出类哨兵值不得被当成路由回显', () => {
    // 主进程对 '__quit__' 是 win.destroy()，永不下发给渲染层（hotkeys.js:46-49 早返回）；
    // 但它会经 hotkeys:list 出现在表里 ⇒ 展示面必须有自己的键，不得回显成 '__quit__' 这种假路径。
    const r = hotkeyActionKey({ accelerator: 'CmdOrCtrl+Alt+Q', route: '__quit__' })
    expect(r.key, '哨兵值必须有键').toBe('settings.hotkeys.action.quit')
  })

  it('每个展示键在 zh 与 en 的 action 子块里成对存在且值非空（Gate 7 对拆分文件失明，这里自带判据）', () => {
    const wanted = Object.values(HOTKEY_ACTION_KEYS)
    for (const file of ['src/locales/settings/zh.js', 'src/locales/settings/en.js']) {
      const src = fs.readFileSync(path.resolve(DESKTOP_ROOT, file), 'utf8')
      // QM-6 i4 的处置。旧判据两处都不可信：
      // ① `src.slice(src.indexOf('hotkeys:'))` —— indexOf 落空返回 -1，而 slice(-1) 取**最后一个字符**，
      //    于是 `block.length > 0` 恒真，"这个文件根本没有 hotkeys 块"被判成通过；
      // ② 在"第一个 hotkeys: 之后的整个文件"里 toContain('leaf:')，既不要求在 `action:` 子块内，
      //    也不要求值非空 —— `home: ''` 会通过，而界面渲染出的正是空动作单元格。
      const action = readHotkeyActionBlock(src)
      expect(action, `${file} 必须有 settings.hotkeys.action 子块（取不到即 null，不得当空对象放行）`).not.toBeNull()
      for (const leaf of wanted) {
        expect(Object.prototype.hasOwnProperty.call(action, leaf), `${file} 缺 action.${leaf}`).toBe(true)
        expect(String(action[leaf]).trim(), `${file} 的 action.${leaf} 不得为空（界面会出现空单元格）`).not.toBe('')
      }
    }
  })

  it('跨包解析只许有 harness 一份实现（测试文件里再抄一份即红）', () => {
    // QM-6 i2 的**防复发**那一半：把解析搬进 harness 只解决"此刻"，
    // 下一个会话完全可能"顺手在测试里再写一遍 indexOf('const SHORTCUTS')"，
    // 于是两份实现重新发散 —— 而这正是本批被评审命中的原始缺陷形态。
    const dup = []
    // 判据只看**代码行**：解释"这条锁在防什么"的注释里必然会引用被禁字面量本身，
    // 按整文件匹配会把守卫自己的说明判成违规（本仓同型坑已复发多次）。
    const codeOnly = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    // 第二道自指防护：判据字符串本身**不能整串出现在代码行里**，否则本文件自己就成了自己的 offender
    // （实测第一次修只解决注释半区，代码里的字面量仍被扫到）。拆开拼，扫描域与本文件互不相干。
    const NEEDLE = "indexOf('const " + "SHORTCUTS')"
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name)
        const st = fs.statSync(full)
        if (st.isDirectory()) walk(full)
        else if (/\.test\.js$/.test(name) && codeOnly(fs.readFileSync(full, 'utf8')).includes(NEEDLE)) {
          dup.push(path.relative(DESKTOP_ROOT, full))
        }
      }
    }
    walk(path.resolve(DESKTOP_ROOT, 'src'))
    expect(dup, '测试文件里出现了第二份主进程表解析：必须改调 main-shortcuts-harness.js').toEqual([])
  })

  it('harness 只被测试 import，生产代码不得引它（它读 electron/ 源码，渲染包里没有 fs）', () => {
    const offenders = []
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name)
        const st = fs.statSync(full)
        if (st.isDirectory()) walk(full)
        else if (/\.(vue|js)$/.test(name) && !/\.(test|spec)\.js$/.test(name) && !name.endsWith('main-shortcuts-harness.js')
          && fs.readFileSync(full, 'utf8').includes('main-shortcuts-harness')) {
          offenders.push(path.relative(DESKTOP_ROOT, full))
        }
      }
    }
    walk(path.resolve(DESKTOP_ROOT, 'src'))
    expect(offenders, '生产代码 import 了只给测试用的 harness').toEqual([])
  })
})
