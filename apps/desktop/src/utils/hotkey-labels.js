// @ts-check
/**
 * hotkey-labels —— 快捷键的展示口径（UX 审计 1.6）
 *
 * 主进程 `hotkeys:list` 返回 `[{accelerator, route, label}]`，其中 `label` 是**中文常量**
 * （只给主进程日志用）。渲染端直接把它画进设置页，会让 en 语言漏出未翻译文本，
 * 违反 i18n-content-sync（用户可见文案必须 zh/en 成对进 locales）。因此展示名一律走
 * locales 键，而**键的归属按 accelerator**（不是 route）：`CmdOrCtrl+Alt+P` 与
 * `CmdOrCtrl+Alt+N` 都指向 `/publish` 但语义不同（发布页 / 新建发布），按 route 映射会串。
 *
 * 未登记的 accelerator 回显**原始 route**（语言中立、可核对上游），
 * 不兜底任何看起来像真名的词 —— 与「来源标签禁止兜底品牌名」同一条纪律。
 */

/** accelerator → locales 里 `settings.hotkeys.action.*` 的叶子名 */
export const HOTKEY_ACTION_KEYS = {
  'CmdOrCtrl+Alt+P': 'publish',
  'CmdOrCtrl+Alt+N': 'newPublish',
  'CmdOrCtrl+Alt+D': 'dashboard',
  'CmdOrCtrl+Alt+C': 'collection',
  'CmdOrCtrl+Alt+H': 'home',
  'CmdOrCtrl+Alt+A': 'accounts',
  'CmdOrCtrl+Alt+K': 'keywords',
  'CmdOrCtrl+Alt+V': 'viralAnalysis',
  'CmdOrCtrl+Comma': 'settings',
  'CmdOrCtrl+Alt+Q': 'quit',
}

/** Electron Accelerator 里的内部写法 → 用户看得懂的符号 / 名称 */
const MAC_TOKENS = {
  cmdorctrl: '⌘',
  command: '⌘',
  super: '⌘',
  ctrl: '⌃',
  control: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
}
const OTHER_TOKENS = {
  cmdorctrl: 'Ctrl',
  command: 'Win',
  super: 'Super',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
}
/** 苹果惯例里 ⌘ 永远写在最左，所以 mac 上要把 CmdOrCtrl 挪到前头 */
const MAC_ORDER = { '⌘': 0, '⌃': 1, '⌥': 2, '⇧': 3 }
const NAMED_KEYS = { comma: ',', plus: '+', space: 'Space', enter: 'Enter', esc: 'Esc', tab: 'Tab' }

/**
 * @param {unknown} accelerator 形如 `CmdOrCtrl+Alt+P`
 * @param {{isMac?: boolean}} [opts]
 * @returns {string} 平台化后的组合键文本；无法解析时返回空串
 */
export function formatAccelerator (accelerator, opts = {}) {
  if (typeof accelerator !== 'string' || !accelerator) return ''
  const isMac = opts.isMac === true
  const table = isMac ? MAC_TOKENS : OTHER_TOKENS
  const tokens = accelerator
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const lower = t.toLowerCase()
      if (table[lower]) return table[lower]
      if (NAMED_KEYS[lower]) return NAMED_KEYS[lower]
      // 未知 token 一律保留，绝不丢弃。**大写只作用于单字符**（字母/数字键）：
      // 把整词大写会让 `MediaPlayPause` 变成 `MEDIAPLAYPAUSE`、`PrintScreen` 变成全大写，
      // 那是给展示面漏出含糊文本（QM-6 i8）。多字符 token 原样返回，读起来仍是宿主声明的名字。
      return t.length === 1 ? t.toUpperCase() : t
    })
  if (!tokens.length) return ''
  if (isMac) {
    // 未知符号（字母等）排在修饰键之后；修饰键按苹果惯例排序。
    return tokens
      .map((tok, i) => ({ tok, i }))
      .sort((a, b) => (MAC_ORDER[a.tok] ?? 9) - (MAC_ORDER[b.tok] ?? 9) || a.i - b.i)
      .map((x) => x.tok)
      .join(' ')
  }
  return tokens.join(' + ')
}

/**
 * 取展示名：命中 locales 键就返回键，否则回显原始 route（`key:null` 表示"无本地化键"）。
 * @param {{accelerator?: unknown, route?: unknown}} entry
 * @returns {{key: string|null, rawLabel: string|null}}
 */
export function hotkeyActionKey (entry) {
  const accel = entry && typeof entry.accelerator === 'string' ? entry.accelerator : ''
  const known = Object.prototype.hasOwnProperty.call(HOTKEY_ACTION_KEYS, accel)
  if (known) return { key: `settings.hotkeys.action.${HOTKEY_ACTION_KEYS[accel]}`, rawLabel: null }
  const route = entry && typeof entry.route === 'string' && entry.route ? entry.route : ''
  // 回显语言中立的原始标识：既不编名字，也不让整行看起来是空的。
  return { key: null, rawLabel: route || accel || null }
}

/**
 * IPC 报文 → 可渲染行。
 * 丢弃条件（缺 accelerator / 非对象 / 重复 accelerator）都在 `hotkey-labels.test.js` 里逐条锁住：
 * 「按了没反应」的第二种形态就是把这些条目渲染成空行或让 DOM key 撞车。
 * @param {unknown} raw `hotkeys:list` 的 data
 * @param {{isMac?: boolean}} [opts]
 * @returns {Array<{key:string, accelerator:string, combo:string, actionKey:string|null, rawLabel:string|null}>}
 */
export function normalizeHotkeyList (raw, opts = {}) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const rows = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const accel = item.accelerator
    if (typeof accel !== 'string' || !accel) continue
    if (seen.has(accel)) continue
    seen.add(accel)
    const { key, rawLabel } = hotkeyActionKey(item)
    rows.push({
      key: accel,
      accelerator: accel,
      combo: formatAccelerator(accel, opts),
      actionKey: key,
      rawLabel,
    })
  }
  return rows
}
