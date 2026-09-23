/**
 * 账号启用态（is_active）判定 —— 与登录态（status）严格正交。
 *
 * 「启用/停用」回答「这个账号允许用于发布吗」，「登录态」回答「这个账号现在还登录着吗」，
 * 两者互不派生。历史缺陷正是 batchSetStatus 把启用态写进了登录态词表的 status 字段。
 *
 * 单一判定函数：发布可选集合、账号卡片停用标记、发布目标禁用态必须共用它。
 * 任何一处自行写 `=== false`，都会在口径漂移时重新制造同一个 bug。
 *
 * fail-safe 方向：只有「明确为 false」才算停用。字段缺失（升级前写入的历史数据）
 * 与脏值（'no' / 0 / {}）一律按启用处理 —— 误停用会让账号静默失去发布能力，
 * 比多显示一个账号严重得多。
 */
export function isAccountActive (account) {
  return account?.is_active !== false
}
