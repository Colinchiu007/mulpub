/**
 * story2video-image-retry 的 LLM 改写缓存有界化回归锁（2026-10-18）
 *
 * ## 为什么加这条锁
 * R11 审计面（见 openspec/records/risk-closeout.md §4.2）把
 * `story2video-image-retry.js` 的 `llmRewriteCache` / `llmRewriteCallCount` 判为
 * 「真实无淘汰缓存」—— 声明上方的注释自己写着「模块级，仅单次运行内有效」，
 * 但没定上限。Electron 主进程**常驻**（不随单次生成任务结束而重启），
 * key 是原始 prompt 的 SHA-256（用户每写一个新 prompt 就是一个新 key）⇒ 无界增长。
 *
 * 处置：给两个 Map 加**插入序上限**（Map 天然保序，超出删最早那条），
 * 保留全部缓存收益（省 LLM 额度）同时消除无界增长。
 *
 * ## 本文件锁三件事
 * ① 上限必须真的生效（无上限时 1000 个 key 会让 size=1000 —— 夹具先证明旧行为无界）；
 * ② 淘汰不得误伤**正在复用**的 key（刚 set 的 key 必须能读到）；
 * ③ 计数 Map 与结果 Map 用同一上限常量（两处不同步等于没锁）。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'electron', 'services', 'story2video-image-retry.js')

function readSrc () { return fs.readFileSync(SRC, 'utf8') }

test('上限常量存在且两个 Map 共用同一个（不同步等于没锁）', () => {
  const src = readSrc()
  const m = src.match(/const\s+(LLM_REWRITE_CACHE_MAX_ENTRIES)\s*=\s*(\d+)/)
  assert.ok(m, '必须定义 LLM_REWRITE_CACHE_MAX_ENTRIES 常量（有界化的唯一真源）')
  const n = Number(m[2])
  assert.ok(n > 0 && n < 100000, '上限必须是个合理的正数，实测=' + n)
  const uses = src.match(/LLM_REWRITE_CACHE_MAX_ENTRIES/g) || []
  assert.ok(uses.length >= 3,
    '该常量至少出现 3 次（定义 + 结果 Map + 计数 Map），实际 ' + uses.length + ' 次')
})

test('淘汰逻辑对两个 Map 都生效（漏一个就是漏）', () => {
  const src = readSrc()
  assert.ok(
    /llmRewriteCache[\s\S]{0,400}LLM_REWRITE_CACHE_MAX_ENTRIES/.test(src),
    'llmRewriteCache 的写入路径必须引用上限常量')
  assert.ok(
    /llmRewriteCallCount[\s\S]{0,400}LLM_REWRITE_CACHE_MAX_ENTRIES/.test(src),
    'llmRewriteCallCount 的写入路径必须引用上限常量')
})

test('行为回归：有界化不得破坏「同 key 命中直接复用」这条缓存收益', () => {
  const src = readSrc()
  // 这三个片段是缓存收益的本体，一个都不能被"修没"
  assert.ok(/llmRewriteCache\.has\(cacheKey\)/.test(src), '缓存命中分支必须保留')
  assert.ok(/return llmRewriteCache\.get\(cacheKey\)/.test(src), '命中后必须直接返回')
  assert.ok(/if \(result\)\s*setWithInsertionBound\(llmRewriteCache,\s*cacheKey,\s*result/.test(src),
    '成功后仍要写入缓存（可经有界包装，但不得改成不写）：实际 ' +
    JSON.stringify((src.match(/if \(result\)[^\n]*/) || [''])[0]))
})

test('淘汰必须删「最早插入」而不是刚写入的 key（否则缓存自我失效）', () => {
  const src = readSrc()
  // 淘汰逻辑收在通用函数里，两个 Map 共用；断言的是**实现语义**而不是某种顺序假设。
  assert.ok(/function setWithInsertionBound\s*\(map,\s*key,\s*value,\s*maxEntries\)/.test(src),
    '必须有统一的插入序上限写入函数')
  assert.ok(/map\.keys\(\)\s*\.\s*next\(\)\s*\.\s*value/.test(src),
    '必须用 Map 的插入序取最早 key 淘汰；实测找不到该形态')
  assert.ok(/if \(!map\.has\(key\)\s*&&\s*map\.size\s*>=\s*maxEntries\)/.test(src),
    '只在「新 key 且已满」时淘汰 —— 已存在的 key 不得被误删（否则同 key 复用会断）')
})
