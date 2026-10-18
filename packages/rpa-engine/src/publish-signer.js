// @ts-check
/**
 * publish-signer —— 可插拔的发布签名器骨架
 *
 * 设计来源：对参考产品远程签名服务的行为分析
 * （见 `01-docs/ANALYSIS-SIGN-SERVICE-DEEP-2026-09-30.md`），**仅借鉴其架构**：
 *
 *   1. 签名能力与发布流程**解耦** —— 统一 `sign(command, payload)` 入口，平台实现注册为适配器；
 *   2. **多平台适配器** —— 同一入口，按 `command` 分派（对应参考服务的 per-command handler）；
 *   3. **确定性** —— 同一输入必须产同一签名（否则服务端无法校验）；
 *   4. **软失败** —— 失败返回 `null`/空串而非抛错，调用方可回退（对应参考服务的 `"null"` 语义）；
 *   5. **前置规范化** —— query 按 key 排序后再参与签名。
 *
 * ⚠️ 明确**不**包含：调用任何第三方签名服务；复制第三方服务端的固定模板常量。
 *
 * 当前内置的是 `page` 适配器（P0 路线）：**签名由平台页面自身完成**，
 * 本模块只负责"声明该平台走页面内提交"并把规范化后的载荷交由调用方使用。
 * 后续如需本地签名（P1），在此注册新的适配器即可，发布流程无需改动。
 */

'use strict'

/**
 * 按 key 排序 query 串（签名前置规范化）。
 * 参考产品在拼接 query 前做 `localeCompare` 升序；顺序不一致会导致签名不匹配。
 * @param {string|Array<[string,string]>|Record<string,string>} query
 * @returns {string} 规范化后的 `k=v&k=v`
 */
function sortQueryString (query) {
  let pairs
  if (typeof query === 'string') {
    pairs = query.split('&').filter(Boolean).map((kv) => {
      const i = kv.indexOf('=')
      return i === -1 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)]
    })
  } else if (Array.isArray(query)) {
    pairs = query.map((p) => [String(p[0]), String(p[1] == null ? '' : p[1])])
  } else if (query && typeof query === 'object') {
    pairs = Object.keys(query).map((k) => [k, String(query[k] == null ? '' : query[k])])
  } else {
    return ''
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]))
  return pairs.map(([k, v]) => k + '=' + v).join('&')
}

/**
 * 平台签名适配器注册表。key = command 平台标识（如 'toutiao'），由 registerAdapter 注册 ——
 * 空间由接入的平台数决定，不随运行时间增长；同平台重复注册为覆盖语义。
 * 因此**不需要也没有** delete/clear —— R11 审计结论，见 openspec/records/risk-closeout.md §4.2。
 * @type {Map<string, (payload: any, ctx?: any) => Promise<string|null>>}
 */
const adapters = new Map()

/**
 * 注册平台签名适配器。
 * @param {string} command 平台标识（如 'toutiao'）
 * @param {(payload: any, ctx?: any) => Promise<string|null>} impl 实现；返回签名字符串，失败返回 null
 */
function registerAdapter (command, impl) {
  if (!command || typeof impl !== 'function') throw new Error('registerAdapter: 参数无效')
  adapters.set(String(command), impl)
}

/** 是否已注册某平台的签名适配器 */
function hasAdapter (command) {
  return adapters.has(String(command))
}

/** 已注册的平台列表（便于诊断/断言） */
function registeredCommands () {
  return Array.from(adapters.keys()).sort()
}

/**
 * 页面内提交适配器（P0）：签名由平台页面自身完成，本模块不产出签名。
 * 返回 `null` 表示"无本地签名"，调用方应走**页面内触发提交**通道。
 * @returns {Promise<null>}
 */
async function pageSubmitAdapter () {
  return null
}

/**
 * 页面内调用宿主安全 SDK 生成签名（P0.5 路线）。
 *
 * 背景（真机逆向，见 `01-docs/ANALYSIS-SIGN-SERVICE-DEEP-2026-09-30.md`）：
 * 字节系平台（头条等）的发布接口要求 `tt-anti-token` 请求头，由页面加载的混淆安全 SDK
 * 生成（页面全局暴露 `byted_acrawler`，含 `sign/init/getReferer`）。该 SDK 本体是混淆 VM，
 * **复刻不现实**；但**它就在宿主页面里，可直接调用** ——
 * 这正是本适配器的做法：**不求复刻宿主能力，只求复用宿主能力**。
 *
 * 与 P0（模拟点击）相比：不依赖 DOM 结构、不受弹窗/校验干扰、参数可控。
 * 与 P1（纯本地复现）相比：无需逆向混淆 VM，也不会随平台改版而失效。
 *
 * @param {{url?: string, query?: string, body?: string}} payload 签名上下文
 * @param {{win?: any, sdkPath?: string, sdkFn?: string}} [ctx] 需要页面句柄
 * @returns {Promise<string|null>} 签名字符串；无 SDK 或失败时返回 null（软失败 ⇒ 调用方回退 P0）
 */
async function hostSdkAdapter (payload, ctx) {
  const win = ctx && ctx.win
  if (!win || typeof win.webContents?.executeJavaScript !== 'function') return null
  const sdkPath = (ctx && ctx.sdkPath) || 'byted_acrawler'
  const sdkFn = (ctx && ctx.sdkFn) || 'sign'
  const arg = { url: String((payload && payload.url) || '') }
  if (payload && payload.query) arg.query = String(payload.query)
  if (payload && payload.body) arg.body = String(payload.body)
  try {
    const raw = await win.webContents.executeJavaScript(
      '(function(){try{var p=' + JSON.stringify(sdkPath) + '.split(".");var o=window;' +
      'for(var i=0;i<p.length;i++){o=o&&o[p[i]]}if(!o||typeof o[' + JSON.stringify(sdkFn) + ']!=="function")' +
      'return JSON.stringify({ok:false,reason:"NO_SDK"});' +
      'var r=o[' + JSON.stringify(sdkFn) + '](' + JSON.stringify(arg) + ');' +
      'return JSON.stringify({ok:true,signature:String(r)})}catch(e){return JSON.stringify({ok:false,reason:String(e&&e.message)})}})()'
    )
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (parsed && parsed.ok && parsed.signature) return parsed.signature
    return null
  } catch (_e) {
    return null
  }
}

// 已确证"宿主页面内即可取得签名"的平台 → P0.5 适配器。
// 依据：真机验证头条页面全局存在 `byted_acrawler.sign` 且调用成功返回签名字符串。
registerAdapter('toutiao_sdk', hostSdkAdapter)

// 已确证走"页面内提交"的平台（其页面自身会计算签名并发出提交请求）。
// 依据：真机 E2E —— 在这些页面内触发原生提交控件可观察到目标发布接口被调用。
const PAGE_SUBMIT_COMMANDS = ['toutiao']
for (const cmd of PAGE_SUBMIT_COMMANDS) registerAdapter(cmd, pageSubmitAdapter)

/**
 * 统一签名入口。
 *
 * @param {string} command 平台标识
 * @param {object} payload 平台相关载荷（如头条为 `{ qr, body, ua }`）
 * @param {object} [ctx] 适配器上下文（页面句柄等）
 * @returns {Promise<{ok: boolean, signature: string|null, via: 'adapter'|'page'|'none', reason?: string}>}
 */
async function sign (command, payload, ctx) {
  const key = String(command || '')
  if (!key) return { ok: false, signature: null, via: 'none', reason: 'EMPTY_COMMAND' }
  const impl = adapters.get(key)
  if (!impl) return { ok: false, signature: null, via: 'none', reason: 'NO_ADAPTER:' + key }
  let sig = null
  try {
    sig = await impl(payload, ctx)
  } catch (e) {
    // 软失败：不抛错，交由调用方回退（与参考服务返回 "null" 的语义一致）
    return { ok: false, signature: null, via: 'adapter', reason: 'ADAPTER_THREW:' + (e && e.message) }
  }
  if (sig == null || sig === '' || sig === 'null') {
    // `null` 语义 = 无本地签名 ⇒ 调用方应走页面内提交
    return { ok: true, signature: null, via: 'page' }
  }
  return { ok: true, signature: String(sig), via: 'adapter' }
}

module.exports = {
  sortQueryString,
  registerAdapter,
  hasAdapter,
  registeredCommands,
  sign,
  hostSdkAdapter,
  PAGE_SUBMIT_COMMANDS,
}
