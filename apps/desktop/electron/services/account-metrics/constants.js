// @ts-check
/**
 * account-metrics/constants — 账号级作品数据回流的配置真源
 *
 * 存在理由（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §3.1）：
 * 现有 `platform-metrics` 走的是**公开作品页 HTML 正则**，国内主流平台的作品页要么需登录、
 * 要么把指标放在脚本里不可正则命中，实测抖音 / 小红书 / 头条成功记录 **0 条**能取到作品 ID，
 * 于是发布记录页五项互动列恒为 `-`。竞品（蚁小二 4.13.19）的做法是**带账号 Cookie 调创作者
 * 后台自己的列表接口**，一次请求返回该账号全部作品及其指标 —— 量级差异是 100 条作品 1 次请求
 * vs 100 次页面抓取，后者既拿不到数、风控面又大一个量级。
 *
 * 本文件只放常量与 env 解析，**不放逻辑**：逻辑在 throttle.js（节流）/ adapters.js（平台）
 * / index.js（编排）三处，各自可单测。
 *
 * env 覆盖遵循本仓既有纪律（对齐 publish-frequency-policy / task-queue）：
 * 非法值**回落默认并出声告警**，禁止静默吞掉。
 */
'use strict'

const { parseEnvNumber } = require('@multi-publish/shared-utils/src/publish-frequency-policy')

/** 一轮巡检的间隔：24h。取值依据见 PRD §1.4 —— 竞品的默认值同样是 24h。 */
const ROUND_INTERVAL_MS = 24 * 3600 * 1000

/**
 * 启动后多久跑首轮。60s 而不是 0：
 * 启动瞬间账号列表与登录态还在解析（identity/账户服务尚未就绪），立即拉取会全部记 needs_login，
 * 在状态里留下一批假失败；也不再复跑——下一轮是 24h 后。
 */
const SCHEDULE_INITIAL_DELAY_MS = 60 * 1000

/** 分页基准延迟（毫秒）。竞品固定 1s；我们在此基础上加抖动（见 PAGE_DELAY_JITTER_RATIO）。 */
const PAGE_DELAY_BASE_MS = 1000

/**
 * 分页延迟抖动比例：实际延迟 = base × (1 + random[0, ratio])。
 * 固定 1s 是机器特征，加抖动成本为零而特征更弱；默认 0.5 ⇒ 1.0–1.5s。
 */
const PAGE_DELAY_JITTER_RATIO = 0.5

/** 单账号单轮页数硬上限：触顶如实报告 truncated，不静默截断。 */
const MAX_PAGES_PER_ACCOUNT = 10

/** 单页条数。竞品多为 10–20；取 20 可在页数上限内覆盖 200 条作品。 */
const PAGE_SIZE = 20

/** 单账号每天最多跑几轮（含用户手动刷新）。防止连点刷新把额度打光触发风控。 */
const ACCOUNT_DAILY_MAX = 4

/**
 * 连续失败转 backoff 的阈值。与 performance-recrawl-service 的
 * MAX_CONSECUTIVE_FAILURES = 3 同口径：一次网络抖动不该把账号永久排除。
 */
const MAX_CONSECUTIVE_FAILURES = 3

/** 单次 HTTP 超时。与 analytics-providers 的 DEFAULT_TIMEOUT 同值。 */
const HTTP_TIMEOUT_MS = 10000

/** 快照来源标识：区分「账号级后台拉取」与公开页回采（`auto`）/手动录入（`manual`）。 */
const SNAPSHOT_SOURCE = 'account_sync'

/** env 前缀。与 MP_PUBLISH_* / MP_RPA_* / MP_QUEUE_* 同族命名。 */
const ENV = Object.freeze({
  PAGE_DELAY_BASE_MS: 'MP_METRICS_PAGE_DELAY_MS',
  PAGE_DELAY_JITTER_RATIO: 'MP_METRICS_PAGE_JITTER_RATIO',
  MAX_PAGES_PER_ACCOUNT: 'MP_METRICS_MAX_PAGES',
  PAGE_SIZE: 'MP_METRICS_PAGE_SIZE',
  ACCOUNT_DAILY_MAX: 'MP_METRICS_ACCOUNT_DAILY_MAX',
  ROUND_INTERVAL_MS: 'MP_METRICS_ROUND_INTERVAL_MS',
})

/**
 * 非整数/越界即回落默认并告警（不抛错：一个坏环境变量不该让整个服务起不来）。
 * @param {string} envName
 * @param {number} fallback
 * @param {{min?: number, max?: number}} [bounds]
 * @param {string} [raw]
 * @returns {number}
 */
function resolveIntEnv (envName, fallback, bounds, raw) {
  const b = bounds || {}
  const value = parseEnvNumber(
    raw === undefined ? process.env[envName] : raw,
    envName,
    fallback,
    (msg) => require('../logger').warn('AccountMetrics', msg),
    // parseEnvNumber 的 bounds 只认 {integer, max}；下界由本函数自己守（见下），
    // 因为它把 0 视为合法的「显式关闭」，而本模块的几项配置 0 是无意义的（页大小 0 等）。
    { integer: true, ...(b.max !== undefined ? { max: b.max } : {}) },
  )
  if (!Number.isInteger(value)) {
    require('../logger').warn('AccountMetrics', envName + ' 非整数，回落默认 ' + fallback)
    return fallback
  }
  if (b.min !== undefined && value < b.min) {
    require('../logger').warn('AccountMetrics', envName + '=' + value + ' 低于下界 ' + b.min + '，回落默认 ' + fallback)
    return fallback
  }
  return value
}

/**
 * 浮点 env（抖动比例）。越界/非法回落默认。
 * @param {string} envName
 * @param {number} fallback
 * @param {string} [raw]
 * @returns {number}
 */
function resolveFloatEnv (envName, fallback, raw) {
  const text = raw === undefined ? process.env[envName] : raw
  if (text === undefined || text === null || String(text).trim() === '') return fallback
  const n = Number(text)
  if (!Number.isFinite(n) || n < 0 || n >= 1) {
    require('../logger').warn('AccountMetrics', envName + ' 非法（需 [0,1) 的有限数）：' + String(text) + '，回落默认 ' + fallback)
    return fallback
  }
  return n
}

/**
 * 取本轮生效配置。每次调用都重新读 env —— 便于测试注入，也便于排障时改环境变量重试。
 * @param {object} [overrides] 测试用显式覆盖（优先于 env）
 */
function resolveConfig (overrides) {
  const o = overrides || {}
  return {
    roundIntervalMs: o.roundIntervalMs !== undefined
      ? o.roundIntervalMs
      : resolveIntEnv(ENV.ROUND_INTERVAL_MS, ROUND_INTERVAL_MS, { min: 60 * 1000 }),
    pageDelayBaseMs: o.pageDelayBaseMs !== undefined
      ? o.pageDelayBaseMs
      : resolveIntEnv(ENV.PAGE_DELAY_BASE_MS, PAGE_DELAY_BASE_MS, { min: 0 }),
    pageDelayJitterRatio: o.pageDelayJitterRatio !== undefined
      ? o.pageDelayJitterRatio
      : resolveFloatEnv(ENV.PAGE_DELAY_JITTER_RATIO, PAGE_DELAY_JITTER_RATIO),
    maxPagesPerAccount: o.maxPagesPerAccount !== undefined
      ? o.maxPagesPerAccount
      : resolveIntEnv(ENV.MAX_PAGES_PER_ACCOUNT, MAX_PAGES_PER_ACCOUNT, { min: 1, max: 100 }),
    pageSize: o.pageSize !== undefined
      ? o.pageSize
      : resolveIntEnv(ENV.PAGE_SIZE, PAGE_SIZE, { min: 1, max: 100 }),
    accountDailyMax: o.accountDailyMax !== undefined
      ? o.accountDailyMax
      : resolveIntEnv(ENV.ACCOUNT_DAILY_MAX, ACCOUNT_DAILY_MAX, { min: 1, max: 100 }),
  }
}

module.exports = {
  ROUND_INTERVAL_MS,
  SCHEDULE_INITIAL_DELAY_MS,
  PAGE_DELAY_BASE_MS,
  PAGE_DELAY_JITTER_RATIO,
  MAX_PAGES_PER_ACCOUNT,
  PAGE_SIZE,
  ACCOUNT_DAILY_MAX,
  MAX_CONSECUTIVE_FAILURES,
  HTTP_TIMEOUT_MS,
  SNAPSHOT_SOURCE,
  ENV,
  resolveConfig,
  resolveIntEnv,
  resolveFloatEnv,
}
