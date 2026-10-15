// @ts-check
/**
 * evasions.test.js — stealth evasions 提取产物的结构锁与快照锁
 *
 * 契约（PRD §3.1 / 评审 F8）：
 * - 单一真源 = npm 包 puppeteer-extra-plugin-stealth@<锁定版本>；本产物是其**防回归快照**
 *   （sha256 漂移 ⇒ 上游更新未评审即红，逼出「npm 版本=真源」的显式决策）
 * - 最小集必须齐全（PRD §3.1 清单）；每项 code 是**页面侧纯函数源码**
 *   （禁含 puppeteer 侧引用：await / page. / options. —— 那些是驱动侧 API，进了注入
 *   字符串只会在页面 world 抛 ReferenceError）
 * - 产物带 MIT 出处注释（许可链纪律）
 *
 * 提取命令（上游更新后重跑，勿手编 bundle）：
 *   node scripts/extract-evasions.js
 */
import { describe, it, expect } from 'vitest'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const BUNDLE = path.join(__dirname, 'evasions-bundle.js')

// 最小集（PRD §3.1；模块名与 puppeteer-extra-plugin-stealth/evasions/ 目录一一对应）
const MINIMUM_SET = [
  'navigator.webdriver',
  'chrome.runtime',
  'navigator.permissions',
  'navigator.plugins',
  'navigator.languages',
  'iframe.contentWindow',
  'window.outerdimensions',
]

// 首次生成时记录的快照 sha256（提取脚本 --check 漂移即红；上游升级后显式重录）
const SNAPSHOT_SHA256 = process.env.EVASIONS_SNAPSHOT_SHA256 || '81a1a0a2bed82a931c722554df1716bec0f0122889dff4ff947d1d88ed7012a0'

describe('stealth evasions 提取产物（PRD §3.1 三重锁之防回归层）', () => {
  it('bundle 文件存在且为 CJS 可 require（sandbox preload 相对 require 的形态）', () => {
    expect(fs.existsSync(BUNDLE)).toBe(true)
    delete require.cache[BUNDLE]
    const bundle = require(BUNDLE)
    expect(bundle).toBeTruthy()
    expect(typeof bundle).toBe('object')
  })

  it('最小集齐全（缺一即注入清单不完整）', () => {
    const bundle = require(BUNDLE)
    for (const name of MINIMUM_SET) {
      expect(bundle.evasions, `missing evasion: ${name}`).toHaveProperty(name)
    }
  })

  it('每项 code 是页面侧纯函数源码（禁驱动侧引用）', () => {
    const bundle = require(BUNDLE)
    for (const [name, entry] of Object.entries(bundle.evasions)) {
      expect(typeof entry.code, `${name}.code`).toBe('string')
      expect(entry.code.length, `${name}.code 非空`).toBeGreaterThan(20)
      // 页面 world 没有 page / await / options 这些驱动侧对象
      expect(entry.code, `${name} 禁含 'await '`).not.toMatch(/\bawait\s/)
      expect(entry.code, `${name} 禁含 'page.'`).not.toMatch(/\bpage\./)
      expect(entry.code, `${name} 禁含 'options.'`).not.toMatch(/\boptions\./)
    }
  })

  it('快照 sha256 锁定（未评审的上游漂移即红；重录须走 EVASIONS_SNAPSHOT_SHA256）', () => {
    // EOL 归一化（2026-10-14）：blob 为 LF（i/lf），但 text=auto 在 Windows checkout 转 CRLF（w/crlf）。
    // readFileSync 读工作副本会拿到 CRLF 字节，直接哈希得 CRLF 指纹，与 LF 快照（记录源=提取脚本 LF 产物）
    // 平台性不符。归一化 \r\n→\n 后哈希 = LF blob 指纹，跨平台稳定且仍能捕捉真实内容漂移。
    const raw = fs.readFileSync(BUNDLE, 'utf8').replace(/\r\n/g, '\n')
    const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex')
    expect(hash, `bundle 漂移：现 ${hash}；若为上游显式升级请重录快照并走 npm 版本评审`).toBe(SNAPSHOT_SHA256)
  })

  it('MIT 出处注释在册（许可链纪律）', () => {
    const raw = fs.readFileSync(BUNDLE, 'utf8')
    expect(raw).toMatch(/puppeteer-extra-plugin-stealth/)
    expect(raw).toMatch(/MIT/)
  })
})
