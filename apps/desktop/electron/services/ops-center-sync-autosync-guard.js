// @ts-check
/**
 * ops-center-sync-autosync-guard.js — 「启动自动同步为何没发起」的判据与出声口（2026-10-14）
 *
 * 从 ops-center-sync.js 拆出（债务熔断：主文件已顶格，见 `.github/scripts/check-max-lines.js`）。
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
 * （含 2026-09-23 起全部备份），应用日志里也没有任何 `auto-sync-*` 行。
 * 判据本身没错（不该在没配置时硬发请求），错的是**不发请求也不说为什么**。
 *
 * 2026-10-14 第二轮：补上「可用性」这一类信号
 * ------------------------------------------
 * ①新增 `NO_TRUST_ANCHOR` 前置判据：打包版缺验签信任锚时，**即使取到 bootstrap 也会
 *   被 fail-closed 丢掉整份运行时策略**（含应用菜单）。在花掉一次网络请求之前就说清楚，
 *   比事后在验签处报 `NO_PRODUCTION_TRUST_ANCHOR` 可诊断得多。
 * ②`ok` 时返回 `authMode`，让调用方能把「这次用哪种身份、连的是哪个运营中心」记进日志——
 *   用户本次的困惑正是「改的是本地运营中心，应用却可能连的是别处」，而旧日志只有
 *   `catalog-synced {updated, at}`，**不含地址**。
 *
 * 提示里不再出现「必须手填地址 + API Key」
 * --------------------------------------
 * 早期版本的 hint 写着「bootstrap 只认 X-Catalog-Key，Bearer 不适用」，**这是错的**：
 * `routers/runtime.py::_require_catalog_key` 的实现是 `verify_bearer_or_catalog_key`，
 * 优先级为「Bearer(Logto) → X-Catalog-Key(fallback) → 401」。零配置路径（部署层给地址 +
 * 用户身份登录 ⇒ Bearer）**是可用且优先的**。且「运营中心同步」表单早已从界面撤下
 * （`views/ModelProviders.vue` 旧注释：「运营同步对用户透明：配置卡片已隐藏」），
 * 故本模块所有 hint 一律指向**部署层**（`config/identity-public.json` / 环境变量），
 * 不再指向任何应用内界面。
 */
'use strict'

/** 事件名（可被日志检索区分；不得合并成一条含糊的 "skipped"） */
const REASON_DISABLED = 'auto-sync-not-started-disabled'
const REASON_UNCONFIGURED = 'auto-sync-not-started-unconfigured'
const REASON_MISSING_CREDENTIAL = 'auto-sync-not-started-missing-api-key'
const REASON_NO_TRUST_ANCHOR = 'auto-sync-not-started-no-trust-anchor'

/** 部署层配置项名，供 hint 复用（与 identity-runtime-config.js 的字段名一致） */
const DEPLOY_URL_HINT = 'config/identity-public.json 的 opsCenterUrl（或环境变量 OPS_CENTER_URL）'
const DEPLOY_ANCHOR_HINT = 'config/identity-public.json 的 runtimePublicKey（或环境变量 RUNTIME_PUBLIC_KEY）'

/**
 * 判定启动自动同步该不该发起；不该发起时给出**可区分的原因**与下一步动作。
 *
 * 纯函数：不读环境、不碰 store、不打日志 —— 判据可单测，调用方只负责出声。
 *
 * @param {{autoSync?: boolean, manualUrl?: string, apiKeyConfigured?: boolean}} cfg getConfig() 的结果
 *   （2026-10-15：改读 `manualUrl` —— 原 `url` 是「手填/自动发现」混装别名，已移除；
 *    本函数要判的恰是**手动态**，用 manualUrl 语义精确且不再受自动地址干扰）
 * @param {boolean} hasAutoContext `_getAutoContext()` 是否返回了对象（须同时有地址与令牌回调）
 * @param {string} autoUrlRaw 自动发现地址（**已由调用方 normalizeUrl**，避免第二份归一化实现）
 * @param {boolean} hasAccessToken 是否注入了登录令牌回调
 * @param {boolean} isPackaged 是否运行在打包发行版（决定信任锚是否必需）
 * @param {boolean} hasTrustAnchor 是否已解析出验签公钥（部署层或历史设置项）
 * @returns {{ok: true, authMode: 'bearer' | 'catalog-key'} | {ok: false, reason: string, params: object}}
 */
function resolveAutoSyncGuard (cfg, hasAutoContext, autoUrlRaw, hasAccessToken, isPackaged, hasTrustAnchor) {
  const url = (cfg && cfg.manualUrl) || ''

  if (!cfg || cfg.autoSync === false) {
    return {
      ok: false,
      reason: REASON_DISABLED,
      params: {
        hint: '自动同步已被显式关闭（默认是开）：运营下发配置（应用菜单/公告/功能开关）不会生效。该开关属宿主/部署配置（settings 的 opsCenterSync.autoSync），应用内已无填写入口',
      },
    }
  }

  if (!url && !hasAutoContext) {
    return {
      ok: false,
      reason: REASON_UNCONFIGURED,
      params: {
        hint: autoUrlRaw
          ? `部署层已给出运营中心地址（${autoUrlRaw}）但缺少可用登录令牌回调，运营下发配置不会生效。正解是在部署层配置 ${DEPLOY_URL_HINT}，并以应用身份登录（登录后用 Bearer 拉取，无需任何手填）`
          : `部署层未提供运营中心地址：运营下发配置（含应用菜单）不会生效。请在 ${DEPLOY_URL_HINT} 配置；零配置路径是「部署层给地址 + 用户身份登录」，不需要在应用里填任何东西`,
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
        hint: `已配运营中心地址但既无登录令牌也无目录密钥：/api/v1/runtime/bootstrap 接受 Bearer(Logto) 或 X-Catalog-Key，两者都缺则 401。正解是让身份登录可用（Bearer），或在宿主侧预置目录密钥（应用内无填写入口）`,
        url,
      },
    }
  }

  // 打包版没有信任锚 ⇒ 即使拉到了也会在验签处被整体丢弃（含应用菜单）。
  // 放在配置类判据之后：没连上比验不了签更根本；但必须早于发起请求。
  if (isPackaged && !hasTrustAnchor) {
    return {
      ok: false,
      reason: REASON_NO_TRUST_ANCHOR,
      params: {
        hint: `打包版缺少运行时验签信任锚：即使取到 bootstrap 也无法验签，整份运行时策略（含应用菜单）会被 fail-closed 丢弃。请在 ${DEPLOY_ANCHOR_HINT} 配置`,
      },
    }
  }

  return { ok: true, authMode: hasAutoContext ? 'bearer' : 'catalog-key' }
}

/**
 * 把 URL 投影成可安全入日志的 origin（只留 scheme+host+port）。
 *
 * 用途：`catalog-synced` 这条成功日志原先只记 `{updated, at}`，**不含地址**——而用户
 * 本次的困惑恰是「我改的是本地运营中心，应用是不是连到别处去了」。有了 origin 就能一眼分辨。
 *
 * 只取 origin 而不是整条 URL：URL 可能带 userinfo 或查询串里的令牌，而 logger 只脱敏凭证字段、
 * 不脱敏 URL 文本。**任何异常一律返回空串**——诊断字段绝不能把同步主流程带崩。
 *
 * @param {string} raw 任意可能非法的 URL 文本
 * @returns {string} origin（如 `https://ops.iart.work`）或空串
 */
function safeOrigin (raw) {
  try {
    return new URL(String(raw || '')).origin
  } catch {
    return ''
  }
}

/**
 * 把判据结果**出声**（成功与失败都出声）。
 *
 * 为什么把出声也收进本模块：主文件已顶格（见 `.github/scripts/check-max-lines.js`），
 * 而「不该发起时说清原因」与「发起时说清用哪种身份」是同一件事的两面，放一起才可能
 * 端到端单测（`emitAutoSyncOutcome(fakeLog, guard)`）。**调用点仍在主文件**——
 * 判据与措辞可以外移，「谁负责说话」不能。
 *
 * @param {{notify?: Function}} log 日志器（缺 notify 时静默返回，不抛）
 * @param {{ok: true, authMode: string} | {ok: false, reason: string, params: object}} guard 判据结果
 */
function emitAutoSyncOutcome (log, guard) {
  if (!log || typeof log.notify !== 'function' || !guard) return
  if (!guard.ok) return log.notify('OpsCenterSync', guard.reason, { level: 'WARN', params: guard.params })
  log.notify('OpsCenterSync', 'auto-sync-scheduled', { params: { authMode: guard.authMode } })
}

module.exports = {
  resolveAutoSyncGuard,
  emitAutoSyncOutcome,
  safeOrigin,
  REASON_DISABLED,
  REASON_UNCONFIGURED,
  REASON_MISSING_CREDENTIAL,
  REASON_NO_TRUST_ANCHOR,
}
