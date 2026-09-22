/**
 * 发布历史 — 持久化每次发布记录
 * 使用 JSONL 文件存储，无需额外数据库
 */
const fs = require('fs')
const path = require('path')

const MAX_RECORDS = 500

// ---------------------------------------------------------------------------
// P1-10（体检报告问题10）：不得在模块顶层 require('electron')
//   1) shared-utils 的 package.json 从未声明 electron 依赖，顶层 require 的解析结果
//      取决于安装顺序，纯 Node 环境（CI 脚本 / vitest node 环境 / 服务端复用）一引入就崩；
//   2) 路径来源改为显式注入优先：configurePublishHistory({ userDataDir | filePath | app })，
//      未注入时才**懒加载** electron.app，并给出可操作的错误提示。
// ---------------------------------------------------------------------------
let _config = { userDataDir: null, filePath: null, app: null }

/** 注入存储位置（桌面端传 app，测试/脚本传 userDataDir 或完整 filePath） */
function configurePublishHistory (opts = {}) {
  _config = {
    userDataDir: opts.userDataDir || null,
    filePath: opts.filePath || null,
    app: opts.app || null,
  }
  return { ..._config }
}

function _resolveApp () {
  if (_config.app) return _config.app
  let app = null
  try {
    // eslint-disable-next-line global-require
    // 注意：纯 Node 下 require('electron') 返回的是"可执行文件路径字符串"且**不抛错**，
    // 因此 .app 为 undefined —— 必须显式判定，否则错误会变成无信息量的 TypeError。
    app = require('electron').app
  } catch (err) {
    app = null
  }
  if (!app || typeof app.getPath !== 'function') {
    throw new Error(
      '[shared-utils/publish-history] 未检测到 Electron 运行时：'
      + '请在桌面端调用，或先 configurePublishHistory({ userDataDir }) 指定存储目录'
    )
  }
  return app
}

function getHistoryPath () {
  if (_config.filePath) return _config.filePath
  // 显式注入优先；只有真的需要 app.getPath 时才解析 Electron（否则注入等于白注入）
  const userDataDir = _config.userDataDir || _resolveApp().getPath('userData')
  return path.join(userDataDir, 'publish-history.jsonl')
}

/**
 * 添加一条发布记录
 */
function addRecord (record) {
  const filePath = getHistoryPath()
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ...record,
    timestamp: new Date().toISOString()
  }
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8')
  return entry
}

/**
 * 查询发布历史
 * @param {object} opts - { platform?, limit?, offset? }
 */
function listRecords (opts = {}) {
  const { platform, limit = 50, offset = 0 } = opts
  const filePath = getHistoryPath()
  if (!fs.existsSync(filePath)) return { total: 0, records: [] }

  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean)
  let records = lines.map(l => {
    try { return JSON.parse(l) } catch { return null }
  }).filter(Boolean)

  if (platform) records = records.filter(r => r.platform === platform)

  const total = records.length
  records = records.reverse().slice(offset, offset + limit)
  return { total, records }
}

/**
 * 获取单条记录
 */
function getRecord (id) {
  const { records } = listRecords({ limit: MAX_RECORDS })
  return records.find(r => r.id === id) || null
}

/**
 * 获取发布统计
 * @returns {object} { total, success, failed, perPlatform, daily }
 */
function getStats () {
  const filePath = getHistoryPath()
  if (!fs.existsSync(filePath)) {
    return { total: 0, success: 0, failed: 0, perPlatform: {}, daily: [] }
  }

  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean)
  let records = lines.map(l => {
    try { return JSON.parse(l) } catch { return null }
  }).filter(Boolean)

  const total = records.length
  const success = records.filter(r => r.success !== false).length
  const failed = total - success

  // 按平台统计
  const perPlatform = {}
  for (const r of records) {
    const p = r.platform || 'unknown'
    if (!perPlatform[p]) perPlatform[p] = { total: 0, success: 0, failed: 0 }
    perPlatform[p].total++
    if (r.success !== false) perPlatform[p].success++
    else perPlatform[p].failed++
  }

  // 按天统计（最近30天）
  const dailyMap = {}
  const now = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    dailyMap[key] = { date: key, total: 0, success: 0 }
  }
  for (const r of records) {
    if (!r.timestamp) continue
    const key = r.timestamp.slice(0, 10)
    if (dailyMap[key]) {
      dailyMap[key].total++
      if (r.success !== false) dailyMap[key].success++
    }
  }

  return {
    total,
    success,
    failed,
    successRate: total > 0 ? Math.round(success / total * 100) : 0,
    perPlatform,
    daily: Object.values(dailyMap)
  }
}

module.exports = { addRecord, listRecords, getRecord, getStats, getHistoryPath, configurePublishHistory }