/**
 * 登录态（status）归一化判定 —— 单一实现。
 *
 * 与「启用态 is_active」（utils/account-active.js）严格正交：这里回答「这个账号现在还登录着吗」，
 * 那里回答「这个账号允许用于发布吗」，两者互不派生。
 *
 * 为什么必须有单一实现：卡片展示层（AccountManagementCard）与账号页行为层（Accounts）曾各写一份
 * status 判定，展示层做 `trim().toLowerCase()`、行为层写严格 `=== 'expired'` —— 于是「卡片显示已失效」
 * 与「点卡片仍按已登录恢复旧凭证」可以同时成立，用户看到的是失效徽章，行为上却带着旧身份 Cookie 进
 * 登录页（2026-09-30 公众号二维码加载失败事故的直接成因之一）。搬到这里后两处共用同一份归一化。
 *
 * 词表口径（不要凭字面直觉增删）：
 * - `active` / `online` → online；`expired` → expired；`unverified` → unverified；
 *   `error` / `failed` / `failure` → error。
 * - 刻意不含 `inactive` / `offline`：那是历史上「启用态被写进 status」撞车写坏的脏值，
 *   此前被映射为「已登录」等于把概念混用固化成契约，现统一落到 unknown 兜底。
 *
 * @param {object} account 账号对象
 * @returns {'online'|'expired'|'unverified'|'error'|'unknown'}
 */
export function accountStatusKind (account) {
  const status = String(account?.status || '').trim().toLowerCase()
  if (status === 'active' || status === 'online') return 'online'
  if (status === 'expired') return 'expired'
  // 未确认：检测过但拿不到正向/负向结论（如视频号禁止 DOM 检测、HTTP 判定不确定）。
  // 不能落到 unknown，否则与「从未检测」共用一种视觉语义，掩盖检测发生过这一事实。
  if (status === 'unverified') return 'unverified'
  if (status === 'error' || status === 'failed' || status === 'failure') return 'error'
  return 'unknown'
}

/**
 * 「最近一次登录态检测时间」的字段名清单 —— 单一真源。
 *
 * 为什么要下沉：卡片展示层（AccountManagementCard）与账号页行为层（Accounts 的二次确认框）
 * 都要读这个时间。此前只有卡片有一份清单，行为层要显示「最近检测」就得再抄一份 ——
 * 与 status 判定当初分叉成「展示层做 trim().toLowerCase()、行为层写严格 === 'expired'」
 * 是同一类漂移（account-status.js 头注释记着它造成的 2026-09-30 公众号事故）。
 */
const LAST_CHECK_KEYS = ['last_login_check_at', 'lastLoginCheckAt', 'login_checked_at', 'loginCheckedAt', 'last_checked_at', 'lastCheckedAt', 'checked_at', 'checkedAt', 'last_validated', 'lastValidated', 'validated_at', 'validatedAt']

/**
 * 取最近一次登录态检测时间。
 *
 * @param {object} account 账号对象
 * @returns {Date|null} 解析不出合法日期时返回 null（不得返回 Invalid Date）
 */
export function lastLoginCheckAt (account) {
  for (const key of LAST_CHECK_KEYS) {
    const value = account?.[key]
    if (value === null || value === undefined || value === '') continue
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date
  }
  return null
}

/**
 * 以账号身份打开平台页时，是否必须走干净会话（不恢复凭证 + 清空分区残留 Cookie）。
 *
 * 背景：旧身份 Cookie（微信 wxuin 等，有效期可到 2027）会被服务端判定为「身份 Cookie ↔ 登录态」不符，
 * 在 scanloginqrcode?action=getqrcode 环节返回 200 空体（真码 ~7.6KB）→ 页面显示「二维码加载失败」
 * （2026-09-16 CDP 取证）。也就是说：对失效账号，「恢复凭证免登录」恰好堵死了它自己唯一的自救路径。
 *
 * 两个输入，缺一不可：
 * 1. `status === 'expired'`（经归一化）—— 库里已落库的失效态；
 * 2. `confirmedExpiredIds` 命中 —— 本轮检测刚确认失效但尚未回写 status（单条 checkLogin 只写
 *    checkedExpiredIds，batchCheck 仅在返回带 loginStatus 时才改写）。少了这一路，「刚点完验证就点
 *    卡片」仍会带着旧凭证进登录页，事故原地复发。
 *
 * @param {object} account 账号对象
 * @param {Set<string>|null} [confirmedExpiredIds] 本轮已确认失效的账号 id 集合
 * @returns {boolean}
 */
export function needsCleanLoginSession (account, confirmedExpiredIds) {
  if (account?.id !== undefined && account?.id !== null && confirmedExpiredIds?.has?.(account.id)) return true
  return accountStatusKind(account) === 'expired'
}

/**
 * 重新登录（重建会话）是否需要用户二次确认。
 *
 * 背景（2026-10-24，account-card-login-button）：账号卡片的「登录」按钮改为常驻后，
 * 「账号已经是已登录状态时点它会发生什么」必须落成判据，不能靠临场判断。
 *
 * 事实依据：重新登录走 `authViewManager.openLogin(platform)` —— 平台登录槽位
 * **开局必清凭证**（auth-login-slot.js `navigateAfterSlotCleanup`），所以打开的永远是
 * 平台**未登录态**的登录页；登录成功后 `AccountManager.updateCapturedAccount` **覆盖**
 * 该账号的凭证存储。⇒ 重新登录是一次「用新会话替换旧会话」的动作。
 *
 * 只判「已登录」需要确认，三条理由：
 * 1. 已登录是唯一「有可用会话需要保护」的状态 ⇒ 覆盖它不可逆 ⇒ 交由用户显式决定；
 * 2. 已失效 / 未确认 / 异常 / 无检查记录都没有可用会话可保护，重新登录恰是它们的修复手段
 *    ⇒ 再拦一道确认只会钝化判断力（误报比漏报更贵）；
 * 3. 「已登录」这条结论可能陈旧（上次检测可能是很久以前），所以确认框必须带上最近检测时间，
 *    让用户自己判断这条结论有多新 —— 判据不替用户猜。
 *
 * @param {object} account 账号对象
 * @returns {boolean}
 */
export function needsReloginConfirmation (account) {
  return accountStatusKind(account) === 'online'
}
