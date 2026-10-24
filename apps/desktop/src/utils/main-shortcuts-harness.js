/**
 * main-shortcuts-harness.js —— 只给测试用的「读主进程快捷键表」harness
 *
 * 为什么单独成文件（QM-6 i2 的处置）：跨包对齐的解析原先在
 * `hotkey-labels.test.js` 与 `HotkeysSettings.test.js` 里各抄一份，且两份**已经发散**——
 * 组件侧那份没有终点锚的存在断言（正是本批 N3 实测过的「负数终点被 slice 静默放大区间」
 * 失效形态），也没有孤儿项方向。两处解析一漂移，对齐锁的保护面就只由其中一份决定。
 *
 * 两条约束：
 * 1. **生产代码 MUST NOT import 本文件**（它读 `electron/**` 的源码，渲染包里没有 fs）。
 *    该约束由 `hotkey-labels.test.js` 的「harness 只被测试 import」一条锁守着。
 * 2. 文件名刻意不匹配 `*.test.js`，否则会被 vitest 当测试文件收集（0 用例的文件会让
 *    "这个文件真的被执行过"变得不可证）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** apps/desktop 根：由本文件自身定位，不用 process.cwd()（同 1.5 的 R2-i6 教训） */
export const DESKTOP_ROOT = path.resolve(HERE, '..', '..')

/**
 * 从主进程源码里取出注册的 accelerator 列表。
 * 两个锚点都**先断言存在再使用**：`indexOf` 落空返回 -1，而 `slice(start, -1)` 把负数终点
 * 解释成"从末尾倒数"⇒ 区间静默放大到接近整份文件，锁继续绿却不再测量它声称的那张表。
 * @param {string} [src] 主进程 hotkeys.js 的源码（默认自己读盘）
 * @returns {string[]}
 */
export function mainAccelerators (src) {
  const text = src !== undefined ? src : fs.readFileSync(
    path.resolve(DESKTOP_ROOT, 'electron/services/hotkeys.js'), 'utf8',
  )
  const start = text.indexOf('const SHORTCUTS')
  if (start < 0) throw new Error('SHORTCUTS_ANCHOR_MISSING cannot read main-process shortcut table start anchor')
  const end = text.indexOf('\n}', start)
  if (end < 0) throw new Error('SHORTCUTS_END_ANCHOR_MISSING end anchor mismatch would make slice treat -1 as end-of-file')
  const block = text.slice(start, end)
  return [...block.matchAll(/^\s*'([^']+)':\s*\{\s*route:/gm)].map((m) => m[1])
}

/**
 * 读 zh/en 两份拆分 locale 里 `settings.hotkeys.action` 子块的叶子键 → 值。
 * 只取**该子块内部**（QM-6 i4：原先"从第一个 hotkeys: 到文件末尾"里 `toContain('leaf:')`
 * 既不在 action 块内也不要求值非空，`home: ''` 会照常通过而界面渲染出空单元格）。
 * @param {string} src locale 文件源码
 * @returns {Record<string,string>|null} 取不到 action 块返回 null（调用方必须红，不得当成空对象）
 */
export function readHotkeyActionBlock (src) {
  const hotkeysAt = src.indexOf('hotkeys:')
  if (hotkeysAt < 0) return null
  const block = src.slice(hotkeysAt)
  const actionAt = block.indexOf('action:')
  if (actionAt < 0) return null
  const body = block.slice(actionAt)
  const open = body.indexOf('{')
  const close = body.indexOf('}')
  if (open < 0 || close < 0 || close < open) return null
  const out = {}
  for (const m of body.slice(open, close).matchAll(/^\s*([A-Za-z][\w]*):\s*'([^']*)'/gm)) {
    out[m[1]] = m[2]
  }
  return out
}
