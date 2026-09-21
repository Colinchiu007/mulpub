#!/usr/bin/env node
/**
 * sync-platform-config.js — 把运营中心「平台定义」(platform_defs) 合并进本机桌面端 config/platforms.yaml
 *
 * 背景（2026-09-21 轻量版预同步）：桌面端 opsCenterSync 配置 Key 用 safeStorage 加密、
 * 外部无法伪造；方案 C（会话凭证换取同步凭证）落地前，本机需要一条不依赖桌面应用
 * 登录态的平台配置通道。运营中心 platform_defs 是平台清单的单一事实源，
 * 桌面端 platforms.yaml 中的人工字段（icon/publish_url/data_url/comment_url/cover_size
 * 及文件头注释）必须保留 —— 因此是「按 key 合并」，不是整文件覆盖。
 *
 * 数据流：
 *   1. POST /api/auth/login        → JWT（GET /api/v1/platform-defs 需 get_current_user）
 *   2. GET  /api/v1/platform-defs  → 平台定义（id/name/category/content_category/type/
 *                                    max_title/max_content/has_api/enabled/note）
 *   3. 合并写入 <repo>/config/platforms.yaml：
 *        - 已有平台：更新共享字段 + enabled，保留人工字段
 *        - 运营中心新增平台：追加基础段（人工字段留空占位，待桌面端/人工补全）
 *        - 仅存在于 yaml 的平台：保留不动，只在报告中提示差异（不自动删，防误删凭据段）
 *
 * 用法：
 *   node scripts/sync-platform-config.js [--base http://127.0.0.1:8010]
 *     [--token <jwt> | --username <u> --password <p>]
 *     [--out <path>] [--dry-run]
 *   环境变量：OPS_BASE_URL / OPS_ADMIN_TOKEN / OPS_ADMIN_USERNAME / OPS_ADMIN_PASSWORD
 */
'use strict'

const fs = require('fs')
const path = require('path')
const http = require('http')
const yaml = require('js-yaml')

const DEFAULT_BASE = process.env.OPS_BASE_URL || 'http://127.0.0.1:8010'
const REPO_ROOT = path.resolve(__dirname, '..')
const DEFAULT_OUT = path.join(REPO_ROOT, 'config', 'platforms.yaml')
/** 运营中心管理的共享字段（platform_defs 列 ∩ platforms.yaml 字段），其余字段视为本地人工资产 */
const MANAGED_FIELDS = ['name', 'category', 'content_category', 'type', 'max_title', 'max_content', 'has_api', 'enabled']
/** 追加新平台时的占位字段（与既有 platforms.yaml 段结构对齐） */
const PLACEHOLDER_FIELDS = { id: 0, icon: '', publish_url: '', data_url: '', comment_url: '', cover_size: '' }

function parseArgs(argv) {
  const args = { base: DEFAULT_BASE, out: DEFAULT_OUT, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') args.base = argv[++i]
    else if (a === '--token') args.token = argv[++i]
    else if (a === '--username') args.username = argv[++i]
    else if (a === '--password') args.password = argv[++i]
    else if (a === '--out') args.out = path.resolve(argv[++i])
    else if (a === '--dry-run') args.dryRun = true
    else { console.error(`未知参数: ${a}`); process.exit(2) }
  }
  args.base = args.base.replace(/\/+$/, '')
  return args
}

/** 极简 JSON HTTP 客户端（仅本机 http，除 js-yaml 外无第三方依赖） */
function request(method, url, { token, body, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8')
    const headers = { Accept: 'application/json' }
    if (payload) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(payload.length)
    }
    if (token) headers.Authorization = `Bearer ${token}`
    const req = http.request(
      { method, hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, headers, timeout: timeoutMs },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { text += c })
        res.on('end', () => {
          let data = null
          try { data = text ? JSON.parse(text) : null } catch (e) { /* 非 JSON 原样返回 */ }
          if (res.statusCode >= 400) {
            const detail = (data && (data.detail || data.message)) || text.slice(0, 200)
            return reject(new Error(`${method} ${u.pathname} → HTTP ${res.statusCode}: ${detail}`))
          }
          resolve(data)
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error(`请求超时: ${method} ${url}`)))
    req.on('error', (e) => reject(new Error(`请求失败: ${method} ${url} — ${e.code === 'ECONNREFUSED' ? `运营中心后端未启动？(${url})` : e.message}`)))
    if (payload) req.write(payload)
    req.end()
  })
}

async function getToken(args) {
  if (args.token || process.env.OPS_ADMIN_TOKEN) return args.token || process.env.OPS_ADMIN_TOKEN
  const username = args.username || process.env.OPS_ADMIN_USERNAME
  const password = args.password || process.env.OPS_ADMIN_PASSWORD
  if (!username || !password) {
    throw new Error('缺少凭证：用 --token / --username+--password，或设 OPS_ADMIN_TOKEN / OPS_ADMIN_USERNAME+OPS_ADMIN_PASSWORD')
  }
  const res = await request('POST', `${args.base}/api/auth/login`, { body: { username, password } })
  if (!res || !res.token) throw new Error('登录响应缺少 token 字段')
  return res.token
}

/** 提取文件头注释块（`platforms:` 顶层键之前的行），dump 后原样回填 */
function extractHeader(src) {
  const lines = src.split(/\r?\n/)
  const idx = lines.findIndex((l) => /^platforms:\s*$/.test(l))
  return idx > 0 ? lines.slice(0, idx).join('\n') : ''
}

/**
 * 核心合并：ops defs → 本地 platforms 映射。纯函数，便于脱机单测。
 * @returns {{doc: object, updated: string[], added: string[], disabled: string[], localOnly: string[]}}
 */
function mergePlatforms(localDoc, defs) {
  const platforms = (localDoc && localDoc.platforms) || {}
  const defById = new Map(defs.map((d) => [String(d.id), d]))
  const updated = []
  const added = []
  const disabled = []
  for (const [id, def] of defById) {
    const target = {}
    for (const f of MANAGED_FIELDS) {
      if (def[f] !== undefined) target[f] = def[f]
    }
    if (target.has_api !== undefined) target.has_api = Boolean(target.has_api)
    if (target.enabled !== undefined) target.enabled = Boolean(target.enabled)
    if (!target.enabled) disabled.push(id)
    if (platforms[id]) {
      const before = JSON.stringify(platforms[id])
      platforms[id] = { ...platforms[id], ...target }
      if (JSON.stringify(platforms[id]) !== before) updated.push(id)
    } else {
      platforms[id] = { id: PLACEHOLDER_FIELDS.id, ...target, icon: PLACEHOLDER_FIELDS.icon,
        publish_url: '', data_url: '', comment_url: '', cover_size: '' }
      added.push(id)
    }
  }
  const localOnly = Object.keys(platforms).filter((k) => !defById.has(k))
  return { doc: { ...localDoc, platforms }, updated, added, disabled, localOnly }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const token = await getToken(args)
  console.log(`[1/3] 拉取运营中心平台定义: GET ${args.base}/api/v1/platform-defs`)
  const res = await request('GET', `${args.base}/api/v1/platform-defs`, { token })
  const defs = (res && res.items) || []
  if (!defs.length) throw new Error('运营中心平台定义为空，中止（防止误清空本地配置）')
  console.log(`      取得 ${defs.length} 个平台定义`)

  console.log(`[2/3] 合并到 ${path.relative(process.cwd(), args.out) || args.out}`)
  const src = fs.existsSync(args.out) ? fs.readFileSync(args.out, 'utf8') : ''
  const localDoc = src ? yaml.load(src) : {}
  const header = extractHeader(src)
  const { doc, updated, added, disabled, localOnly } = mergePlatforms(localDoc, defs)
  const report = (label, list) => list.length && console.log(`      ${label}: ${list.join(', ')}`)
  report('更新', updated)
  report('新增', added)
  report('运营中心已禁用', disabled)
  report('仅本地存在（保留未动，请人工核对）', localOnly)

  let out = yaml.dump(doc, { sortKeys: false, lineWidth: 120, noRefs: true })
  // 头注释与正文之间固定以一个空行分隔（规范化拼接，保证二次运行字节级幂等）
  if (header) out = header.replace(/\s+$/, '') + '\n\n' + out
  if (args.dryRun) {
    console.log('[3/3] --dry-run：不落盘。变更统计如上。')
    return
  }
  if (src === out) {
    console.log('[3/3] 目标已是最新，无需写入')
    return
  }
  fs.mkdirSync(path.dirname(args.out), { recursive: true })
  if (src) {
    const bak = args.out + '.bak-' + new Date().toISOString().replace(/[:.]/g, '')
    fs.writeFileSync(bak, src, 'utf8')
    console.log(`      已备份原文件 → ${bak}`)
  }
  fs.writeFileSync(args.out, out, 'utf8')
  console.log(`[3/3] 已写入 ${args.out}。桌面端重启后生效；平台增删改请始终在运营中心操作后重跑本脚本。`)
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`FAILED: ${e.message}`)
    process.exit(1)
  })
} else {
  module.exports = { mergePlatforms, extractHeader }
}
