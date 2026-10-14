// @ts-check
/**
 * ops-center-sync-autosync-guard.js — 「启动自动同步为何没发起」的判据与出声口（2026-10-14）
 *
 * 从 ops-center-sync.js 拆出（债务熔断：主文件已 768 行，而 `.github/scripts/check-max-lines.js`
 * 给它的登记值是 570 行 + 容差 200 —— 任何新增都会判 LEDGER_GREW，所以本模块同时把
 * 判据**移出**主文件，使主文件净变化为负）。
 *
 * 背景（实测复盘）
 * ----------------
 * 原实现的三道早退都是**静默 `return`**：
 *
 *   if (!cfg.autoSync) return
 *   if (!cfg.url && !auto) return
 *   if (cfg.url && !cfg.apiKeyConfigured && !auto) return
 *
 * 于是应用可以在「运营下发配置（应用菜单 / 公告 / 功能开关）永远不会生效」的状态下
 * 常年运行而**没有任何信号**。实测现场：共享数据锚点里 `opsCenterSync` 键**从未存在过**
 * （含 2026-09-23 起全部备份），应用日志里也没有任何 `auto-sync-*` 行 —— 用户只看到
 * 「运营中心改了不生效」，连断点在应用侧还是服务端都判断不了。
 *
 * 这与「守护者只在有人看着时才工作」是同一类缺陷：**失败无信号**。判据本身没错
 * （不该在没配置时硬发请求），错的是**不发请求也不说为什么**。
 *
 * 关键区分（本机现场就是这一态）
 * ------------------------------
 * `getConfig().url` 会把自动发现地址并入（`url = 手动 url || 自动 url`），而
 * `_getAutoContext()` 在**缺登录令牌回调**时返回 null。两者叠加会让
 * 「自动发现地址已配好、只是缺令牌」**伪装成「完全未配置」** —— 排查者会去翻设置页
 * 而找不到问题。因此本模块把这两种原因分开报，并各自给出下一步。
 */
'use strict'

/** 事件名（可被日志检索区分；不得合并成一条含糊的 "skipped"） */
const REASON_DISABLED = 'auto-sync-not-started-disabled'
const REASON_UNCONFIGURED = 'auto-sync-not-started-unconfigured'
const REASON_MISSING_CREDENTIAL = 'auto-sync-not-started-missing-api-key'

/**
 * 判定启动自动同步该不该发起；不该发起时给出**可区分的原因**与下一步动作。
 *
 * 纯函数：不读环境、不碰 store、不打日志 —— 判据可单测，调用方只负责出声。
 *
 * @param {{autoSync?: boolean, url?: string, apiKeyConfigured?: boolean}} cfg getConfig() 的结果
 * @param {boolean} hasAutoContext `_getAutoContext()` 是否返回了对象（须同时有地址与令牌回调）
 * @param {string} autoUrlRaw 自动发现地址（**已由调用方 normalizeUrl**，避免第二份归一化实现）
 * @param {boolean} hasAccessToken 是否注入了登录令牌回调
 * @returns {{ok: true} | {ok: false, reason: string, params: object}}
 */
function resolveAutoSyncGuard (cfg, hasAutoContext, autoUrlRaw, hasAccessToken) {
  const url = (cfg && cfg.url) || ''

  if (!cfg || cfg.autoSync === false) {
    return {
      ok: false,
      reason: REASON_DISABLED,
      params: {
        hint: '自动同步已关闭：运营下发配置（应用菜单/公告/功能开关）不会生效。设置 → 运营中心同步 → 打开「自动同步」',
      },
    }
  }

  if (!url && !hasAutoContext) {
    return {
      ok: false,
      reason: REASON_UNCONFIGURED,
      params: {
        hint: autoUrlRaw
          ? `自动发现到运营中心地址（${autoUrlRaw}）但缺少可用登录令牌回调，且未手填地址与 API Key；运营下发配置不会生效。若要连本地运营中心，请手填地址 + API Key（bootstrap 只认 X-Catalog-Key，Bearer 不适用）`
          : '未配置运营中心地址与 API Key：运营下发配置（含应用菜单）不会生效。设置 → 运营中心同步',
        autoUrlConfigured: autoUrlRaw || '',
        hasAccessToken: !!hasAccessToken,
      },
    }
  }

  if (url && !(cfg && cfg.apiKeyConfigured) && !hasAutoContext) {
    return {
      ok: false,
      reason: REASON_MISSING_CREDENTIAL,
      params: {
        hint: '已填运营中心地址但缺少 API Key（X-Catalog-Key）—— /api/v1/runtime/bootstrap 只认该密钥，Bearer 不适用；运营下发配置不会生效',
        url,
      },
    }
  }

  return { ok: true }
}

module.exports = { resolveAutoSyncGuard, REASON_DISABLED, REASON_UNCONFIGURED, REASON_MISSING_CREDENTIAL }
