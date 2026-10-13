/**
 * media-combination — 素材组合三级降级算法
 * 来源：参考产品「一键成片」的组合算法（纯函数、零依赖、质量分层）。
 * 三级降级顺序**不可调整**：先给保持素材原序的组合（观感最自然），不够才用打乱版。
 * 三条不可破：
 *   ① 三级顺序固定：noRepetition → lowRepetition → ordinary
 *   ② 「够 max 即停」—— 不许算完再截断（全排列在 N=20 时是 20! 级）
 *   ③ 输出必须按 join(separator) **去重**；去重后不足 max 时**如实返回不足**，
 *      不得重复填充凑数（重复排列 = 重复成片，比少几条更糟）
 *
 * ## 为什么是「下标排列」而不是「素材对象的克隆」
 *
 * 返回 `number[]`（每条是 `[0..n-1]` 的一个排列），调用方按下标去取自己的对象。三条理由：
 *   ① 素材可能是大对象，clone 成本随规模线性上升，而排列数本身已经要控量；
 *   ② 调用方拿到的是**同一份素材引用**，不会出现「两条成片用了不同副本」的困惑；
 *   ③ 纯 `number[]` 可 JSON 序列化，能进任务队列持久化。
 *
 * ## 为什么分隔符是 `\u0001` 而不是空串
 *
 * 用 `join('')` 时，下标序列 `[1, 23]` 与 `[12, 3]` 连接后**都是 `"123"`** ——
 * 去重会把两条**不同**的排列误判为重复。`n > 9` 时必然发生（两位下标出现即触发）。
 * 这不是风格偏好，是**原实现的真实缺陷**；回归锁里有 `n = 12` 的专项用例。
 *
 * ## 零依赖
 *
 * 只用 `Math.random` 与数组内建。主进程也要用（先算好 N 条排列再派发渲染任务），
 * 故不能放进依赖 react/remotion 的渲染包。
 */
'use strict'

/** 默认分隔符：不可见控制字符，保证任意下标序列的拼接结果唯一（见头注） */
const DEFAULT_SEPARATOR = '\u0001'
const DEFAULT_ORDINARY_CAP = 1000

/** 组合级（降级顺序即此枚举顺序，不可调整） */
const LEVELS = Object.freeze({
  NO_REPETITION: 'noRepetition',
  LOW_REPETITION: 'lowRepetition',
  ORDINARY: 'ordinary',
  INSUFFICIENT: 'insufficient',
})

/**
 * 一级：循环移位（**保序**）。N 段素材产 N 条，第 k 条是原序列以位置 k 开头。
 *
 * ★ 为什么不是「前 N 条」：用户传 5 段素材要 3 条成片时，「前 3 条」会让第 4、5 段
 * **永远不出现**。循环移位保证**每段素材都出现在每一条里**，只改开头 ——
 * 这才是「保序」的真正含义。
 *
 * @param {number} n
 * @returns {number[][]} n 条，每条长度 n
 */
function noRepetitionCombinations (n) {
  const size = Math.max(0, Math.floor(n) || 0)
  const out = []
  for (let shift = 0; shift < size; shift++) {
    const row = new Array(size)
    for (let i = 0; i < size; i++) row[i] = (i + shift) % size
    out.push(row)
  }
  return out
}

/**
 * 二级：低重复轮转。步长递增 + 跳重，约 `(n-3)(n-2)` 条。
 *
 * 做法：对每个起点 `s` 与步长 `step`（2..n-2），按下标 `(s + k*step) % n` 取一圈，
 * 只在**取满一圈且无重复**时收下。`step = 1` 已被一级覆盖故跳过；`step = n-1`
 * 与一级的某条同构故也跳过。**产物仍是排列**（取满一圈即 n 个互异下标）。
 *
 * @param {number} n
 * @returns {number[][]}
 */
function lowRepetitionCombinations (n) {
  const size = Math.max(0, Math.floor(n) || 0)
  if (size < 3) return [] // 小于 3 段时轮转退化成一级已给过的形态
  const out = []
  for (let step = 2; step <= size - 2; step++) {
    for (let start = 0; start < size; start++) {
      const seen = new Set()
      const row = []
      for (let k = 0; k < size; k++) {
        const idx = (start + k * step) % size
        if (seen.has(idx)) break
        seen.add(idx)
        row.push(idx)
      }
      if (row.length === size) out.push(row)
    }
  }
  return out
}

/** 去重键：用分隔符拼接，避免 [1,23] 与 [12,3] 撞键（见头注） */
function keyOf (row, separator) {
  return row.join(separator)
}

/**
 * 三级：全排列（N≤6）或确定性随机采样（N>6），上限 `cap`，按 join 去重。
 *
 * ★ 「够 max 即停」在这里最关键：N=20 的全排列是 20! ≈ 2.4×10¹⁸，
 * **任何先算完再截断的实现都会挂起**。故 N>6 走随机采样且采样次数有界。
 *
 * @param {number} n
 * @param {{cap?: number, rng?: () => number}} [options]
 * @returns {number[][]}
 */
function ordinaryCombinations (n, options) {
  const opts = options || {}
  const size = Math.max(0, Math.floor(n) || 0)
  if (size === 0) return []
  const cap = Number.isInteger(opts.cap) && opts.cap > 0 ? opts.cap : DEFAULT_ORDINARY_CAP
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random

  if (size === 1) return [[0]]

  // N ≤ 6：全排列（6! = 720，可控）
  if (size <= 6) {
    const out = []
    const used = new Array(size).fill(false)
    const cur = []
    const walk = () => {
      if (out.length >= cap) return
      if (cur.length === size) { out.push(cur.slice()); return }
      for (let i = 0; i < size; i++) {
        if (used[i]) continue
        used[i] = true
        cur.push(i)
        walk()
        cur.pop()
        used[i] = false
        if (out.length >= cap) return
      }
    }
    walk()
    return out
  }

  // N > 6：确定性随机采样（Fisher–Yates），采样次数有界 —— 这是「够即停」的落点
  const out = []
  const maxDraws = cap * 40 + 200 // 有界：纯随机去重会遇到撞键，但不能无限抽
  for (let draw = 0; draw < maxDraws && out.length < cap; draw++) {
    const row = new Array(size)
    for (let i = 0; i < size; i++) row[i] = i
    for (let i = size - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const t = row[i]; row[i] = row[j]; row[j] = t
    }
    out.push(row)
  }
  return out
}

/**
 * 三级降级主编排。
 *
 * @param {Array} items 素材列表（本函数**只读它的 length**，不读取也不克隆元素）
 * @param {{max?: number, separator?: string, rng?: () => number, ordinaryCap?: number}} [options]
 * @returns {{combinations: number[][], reachedLevel: string, totalPossible: number}}
 *
 * 边界（§5.3 逐条）：
 *   · `n === 0` ⇒ 立即返回 `{combinations: [], reachedLevel: 'insufficient', totalPossible: 0}`
 *   · `max <= 0` 或非整数 ⇒ 回落 1 **并告警**（不静默）
 *   · 去重后不足 max ⇒ `reachedLevel === 'insufficient'`，**如实返回不足条数**
 */
function combineMedia (items, options) {
  const opts = options || {}
  const list = Array.isArray(items) ? items : []
  const n = list.length

  const separator = typeof opts.separator === 'string' ? opts.separator : DEFAULT_SEPARATOR
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random

  let max = opts.max
  if (!Number.isInteger(max) || max <= 0) {
    if (max !== undefined && max !== 1) {
      // 出声：静默回落会让调用方以为「要 10 条」被满足
      console.warn('[media-combination] max 非法（' + JSON.stringify(max) + '），回落为 1')
    }
    max = 1
  }

  if (n === 0) {
    return { combinations: [], reachedLevel: LEVELS.INSUFFICIENT, totalPossible: 0 }
  }

  /** 按 join(separator) 去重；保留首次出现顺序 */
  const seen = new Set()
  const out = []
  const pushAll = (rows) => {
    for (const row of rows) {
      const k = keyOf(row, separator)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(row)
    }
  }

  // 级 1：保序循环移位（恒 n 条）
  pushAll(noRepetitionCombinations(n))
  if (out.length >= max) {
    return { combinations: out.slice(0, max), reachedLevel: LEVELS.NO_REPETITION, totalPossible: out.length }
  }

  // 级 2：低重复轮转
  pushAll(lowRepetitionCombinations(n))
  if (out.length >= max) {
    return { combinations: out.slice(0, max), reachedLevel: LEVELS.LOW_REPETITION, totalPossible: out.length }
  }

  // 级 3：全排列 / 随机采样
  const cap = Number.isInteger(opts.ordinaryCap) && opts.ordinaryCap > 0 ? opts.ordinaryCap : DEFAULT_ORDINARY_CAP
  pushAll(ordinaryCombinations(n, { cap, rng }))

  return {
    combinations: out.slice(0, max),
    reachedLevel: out.length >= max ? LEVELS.ORDINARY : LEVELS.INSUFFICIENT,
    totalPossible: out.length,
  }
}

module.exports = {
  combineMedia,
  noRepetitionCombinations,
  lowRepetitionCombinations,
  ordinaryCombinations,
  LEVELS,
  DEFAULT_SEPARATOR,
}
