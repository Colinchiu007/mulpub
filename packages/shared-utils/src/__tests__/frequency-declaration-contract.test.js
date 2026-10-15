/**
 * 声明契约锁：`index.d.ts` 必须覆盖频率策略与守卫的**全部公开面**（publish-frequency-policy-v3）
 *
 * 为什么要有这把锁（不是"顺手补类型"）：
 *   ① 本仓 d.ts 与实现长期各自漂移 —— 实测 `recordPublish()` 被声明成 `void`，
 *      而它的返回值是 `release()` 精确还原前值的**唯一凭据**；TS 消费者按声明写代码
 *      会静默丢掉 `_hold`，后果是"未提交失败再也回滚不了"。
 *   ② `ipc-handlers/publish-frequency.js` 用**子路径** require（`@multi-publish/shared-utils/src/...`），
 *      而 `"types"` 只挂在包根 ⇒ 那一处一律解析成 `any`。类型检查**永远不会红**，
 *      所以漂移只能靠这种"读声明文件本身"的锁来收。
 *   ③ 判据是「实现面的每个公开名字都必须在声明里出现」，不是「声明里出现了某个词」——
 *      后者会把锁写成装饰（改名/删成员都不会红）。
 *
 * 定位方式：从 __dirname **逐级上溯**找 index.d.ts，找不到即红（禁止数 `..` 层级 ——
 * 本仓 node-linker=hoisted，数层级会指到不存在的路径，使「找不到就 skip」的锁永久静默）。
 */
const fs = require('node:fs')
const path = require('node:path')

const policy = require('../publish-frequency-policy')
const PublishIntervalGuard = require('../publish-interval-guard')

function findDeclarationFile () {
  let dir = __dirname
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'index.d.ts')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('未找到 index.d.ts（声明文件被移动或删除时本锁必须红，不得 skip）')
}

/** 剥掉注释，避免"注释里提到过这个名字"被当成已声明 */
function stripComments (src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 从起点标识符开始做**括号配对**取整块（不能用"到下一个 }"的近似 —— 嵌套会截断） */
function extractBlock (src, anchorRe, kind = 'brace') {
  const m = src.match(anchorRe)
  if (!m) throw new Error(`声明文件里找不到锚点：${anchorRe}`)
  const open = src.indexOf('{', m.index)
  if (open < 0) throw new Error(`锚点后没有 {{ 块：${anchorRe}`)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  throw new Error(`块未闭合（解析退化）：${anchorRe}`)
}

describe('频率策略与守卫的 d.ts 声明契约', () => {
  const file = findDeclarationFile()
  const declared = stripComments(fs.readFileSync(file, 'utf8'))

  it('锚点存在且规模可信（防"解析退化成空集合"式假绿）', () => {
    expect(declared.length).toBeGreaterThan(2000)
    const policyBlock = extractBlock(declared, /export const publishFrequencyPolicy/)
    const guardBlock = extractBlock(declared, /export class PublishIntervalGuard/)
    expect(policyBlock.length).toBeGreaterThan(400)
    expect(guardBlock.length).toBeGreaterThan(400)
  })

  it('策略模块的每一个公开导出都必须在 d.ts 里声明（逐个名字核对，不抽查）', () => {
    const block = extractBlock(declared, /export const publishFrequencyPolicy/)
    const missing = Object.keys(policy).filter((name) => !new RegExp(`\\b${name}\\b`).test(block))
    expect(missing, `d.ts 缺声明：${missing.join(', ')}`).toEqual([])
    // 反失明：实现面必须真的很大，否则"missing 为空"只是因为枚举退化
    expect(Object.keys(policy).length).toBeGreaterThanOrEqual(20)
  })

  it('守卫的静态成员与公开实例方法都必须在 d.ts 里声明', () => {
    const block = extractBlock(declared, /export class PublishIntervalGuard/)
    const statics = Object.keys(PublishIntervalGuard).filter((n) => !n.startsWith('_'))
    const instance = Object.getOwnPropertyNames(PublishIntervalGuard.prototype)
      .filter((n) => n !== 'constructor' && !n.startsWith('_'))
    const missing = [...statics, ...instance].filter((name) => !new RegExp(`\\b${name}\\b`).test(block))
    expect(missing, `d.ts 缺声明：${missing.join(', ')}`).toEqual([])
    expect(statics.length).toBeGreaterThanOrEqual(6)
    expect(instance.length).toBeGreaterThanOrEqual(8)
  })

  it('recordPublish 的返回值不得被声明成 void（release 的还原凭据依赖它）', () => {
    const block = extractBlock(declared, /export class PublishIntervalGuard/)
    const start = block.indexOf('recordPublish')
    expect(start, 'd.ts 里必须声明 recordPublish').toBeGreaterThanOrEqual(0)
    // 判据必须只量 **recordPublish 自己的返回块**：直接对后 400 字符做子串匹配会被
    // 下一个成员 `release(hold: { at: number; … })` 满足 —— 变异 M18 首跑正是这样空转的。
    const head = block.slice(start + 'recordPublish'.length)
    const paramsEnd = head.indexOf(')')
    expect(paramsEnd, 'recordPublish 声明形状异常').toBeGreaterThan(0)
    const tail = head.slice(paramsEnd)
    expect(tail.slice(0, 12), 'recordPublish 不得被声明成 void').not.toMatch(/void/)
    const retOpen = tail.indexOf('{')
    expect(retOpen, 'recordPublish 的返回类型必须是对象字面量（否则读不出 hold 字段）').toBeGreaterThanOrEqual(0)
    let depth = 0
    let end = -1
    for (let i = retOpen; i < tail.length; i++) {
      if (tail[i] === '{') depth += 1
      else if (tail[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
    }
    expect(end, '返回类型块未闭合（解析退化，必须红而不是跳过）').toBeGreaterThan(retOpen)
    const retBlock = tail.slice(retOpen, end + 1)
    for (const field of ['at', 'accountPrev', 'platformPrev', 'dailyPrev', 'dayKey']) {
      expect(retBlock, `hold 形状缺字段 ${field}`).toMatch(new RegExp(`\\b${field}\\s*:\\s*(number|string)`))
    }
  })

  it('PublishFrequencyIntervals 必须含 tier / accountDailyMax / fallback（设置页与守卫都读它们）', () => {
    const block = extractBlock(declared, /export interface PublishFrequencyIntervals/)
    for (const key of ['tier', 'accountMinMs', 'platformMinMs', 'accountDailyMax', 'fallback']) {
      expect(block, `PublishFrequencyIntervals 缺 ${key}`).toContain(key)
    }
  })

  it('verdict 的 bucket 联合必须含 daily（v2 起日配额是独立桶，缺它会把 daily 读成类型错误）', () => {
    const block = extractBlock(declared, /export interface PublishIntervalVerdict/)
    expect(block).toContain("'daily'")
    expect(block).toContain('reason')
  })
})
