#!/usr/bin/env node
'use strict'

/**
 * dump-partition-cookies.cjs —— 从被占用的 Electron 分区导出 cookie 库（只读）
 *
 * ── 为什么需要它 ────────────────────────────────────────────
 * 应用运行时以独占方式持有分区的 `Cookies`（SQLite），普通 `copy` / `fs.copyFileSync` 会
 * 失败（`EBUSY: resource busy or locked`），而真机验证必须拿到活 cookie。
 *
 * 解法：**流式共享读** —— 以 `FileShare.ReadWrite` 打开并逐字节读出，再写入目标位置。
 * 绕过独占锁，且不修改源文件（只读）。
 *
 * 本技巧最初记录于 01-docs/PRD-VIDEO-PUBLISH-4PLATFORMS-2026-10-18.md §16.9.2，
 * 此处固化为可执行工具，避免随会话结束而丢失。
 *
 * ── 用法 ────────────────────────────────────────────────────
 *   node scripts/dump-partition-cookies.cjs <partition> <outDir>
 *
 *   例：
 *     node scripts/dump-partition-cookies.cjs rpa-xiaohongshu-a1eac276 ./tmp/xhs
 *     node scripts/dump-partition-cookies.cjs rpa-toutiao-7ae99805     ./tmp/tt
 *
 * 输出：
 *   <outDir>/Cookies     —— 导出的 cookie 库（可直接作为 Playwright/CEF 的 profile）
 *   <outDir>/Local State —— 原样拷贝（部分场景解密需要）
 *
 * ⚠ 刻意**不提供** cookie 串解析：SQLite 里的值可能加密（随 Chromium 版本与平台而异），
 *   用正则从二进制"猜"明文会产出看似可用、实际不可靠的结果。
 *   需要 cookie 串时，用导出的 Cookies 作为 profile 启动浏览器后读取（可靠）：
 *     const ctx = await chromium.launchPersistentContext('<outDir>', { ... })
 *     const cookies = await ctx.cookies()
 *   （实测：正则法在小红书分区上解析出 0 条，故移除，避免给出假产物。）
 *
 * ── 前置 ────────────────────────────────────────────────────
 * 共享数据根由环境变量 MP_SHARED_USER_DATA 指定；未设置时默认
 *   D:/Data/projects/mulpub/shared-user-data
 *
 * ⚠ 合规：本脚本只读取本机已有的登录凭据用于**自有账号**的真机验证，
 *   不上传、不外传；导出的 outDir 含敏感凭据，**请勿提交到仓库**。
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const DEFAULT_SHARED = 'D:/Data/projects/mulpub/shared-user-data'

function main () {
  const [partition, outDir] = process.argv.slice(2)
  if (!partition || !outDir) {
    console.log('用法: node scripts/dump-partition-cookies.cjs <partition> <outDir>')
    process.exit(2)
  }
  // 分区名只允许安全字符，防止路径穿越
  if (!/^[A-Za-z0-9_-]+$/.test(partition)) {
    console.error('partition 含非法字符（只允许字母数字下划线连字符）')
    process.exit(2)
  }
  const shared = process.env.MP_SHARED_USER_DATA || DEFAULT_SHARED
  const src = path.join(shared, 'session', 'Partitions', partition, 'Network', 'Cookies')
  if (!fs.existsSync(src)) {
    console.error('未找到分区 cookie: ' + src)
    process.exit(1)
  }
  fs.mkdirSync(outDir, { recursive: true })
  const dstDb = path.join(outDir, 'Cookies')

  // 流式共享读：FileShare=ReadWrite 绕过应用持有的独占锁；不修改源文件
  const ps = spawnSync(
    'powershell',
    ['-NoProfile', '-Command',
      '$fs=[IO.File]::Open("' + src + '","Open","Read",[IO.FileShare]::ReadWrite);' +
      '$ms=New-Object IO.MemoryStream;$fs.CopyTo($ms);$fs.Close();' +
      '[IO.File]::WriteAllBytes("' + dstDb + '",$ms.ToArray())'],
    { stdio: 'pipe' },
  )
  if (!fs.existsSync(dstDb) || fs.statSync(dstDb).size === 0) {
    console.error('导出失败（PowerShell 不可用或读取被拒）: ' + String(ps.stderr || '').slice(0, 200))
    process.exit(1)
  }
  console.log('已导出: ' + dstDb + ' (' + fs.statSync(dstDb).size + ' bytes)')

  // 顺带拷贝 Local State（部分场景解密需要，失败不影响主产物）
  const lsSrc = path.join(shared, 'Local State')
  if (fs.existsSync(lsSrc)) {
    try { fs.copyFileSync(lsSrc, path.join(outDir, 'Local State')) } catch (_e) { /* 非必需 */ }
  }
  console.log('完成。可用方式：launchPersistentContext("' + outDir + '") 后 ctx.cookies()')
}

main()
