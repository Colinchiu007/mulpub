/**
 * Electron accelerator → 人类可读按键串（阶段 1.6）
 *
 * 为什么要有独立实现：主进程 `hotkeys.js` 存的是 Electron 注册用的
 * `CmdOrCtrl+Alt+P` 这种**平台中立令牌**，直接贴给用户就是把实现细节当文案
 * （Windows 用户看到 CmdOrCtrl 不知道该按哪个键）。
 * macOS 侧惯例是符号连排不加分隔符（⌘⌥P），其他平台用 `Ctrl+Alt+P`。
 */

const MAC_ALIASES = {
  CmdOrCtrl: '⌘',
  CommandOrControl: '⌘',
  Command: '⌘',
  Cmd: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Super: '⌘',
  Meta: '⌘',
}

const OTHER_ALIASES = {
  CmdOrCtrl: 'Ctrl',
  CommandOrControl: 'Ctrl',
  Command: 'Win',
  Cmd: 'Win',
  Control: 'Ctrl',
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Option: 'Alt',
  Shift: 'Shift',
  Super: 'Win',
  Meta: 'Win',
}

const NAMED_KEYS = {
  Comma: ',',
  Period: '.',
  Space: 'Space',
  Enter: 'Enter',
  Esc: 'Esc',
  Escape: 'Esc',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Plus: '+',
}

export function formatAccelerator (accelerator, platform) {
  if (typeof accelerator !== 'string' || accelerator.trim() === '') return ''
  const isMac = String(platform || (typeof process !== 'undefined' && process.platform) || '').toLowerCase() === 'darwin'
  const aliases = isMac ? MAC_ALIASES : OTHER_ALIASES
  const segments = accelerator.split('+').map(raw => {
    const token = raw.trim()
    if (!token) return ''
    if (aliases[token]) return aliases[token]
    if (NAMED_KEYS[token]) return NAMED_KEYS[token]
    // 单字符键一律大写；未识别的长令牌原样透出，宁可露出也不假装翻译过
    return token.length === 1 ? token.toUpperCase() : token
  }).filter(Boolean)
  return isMac ? segments.join('') : segments.join('+')
}
