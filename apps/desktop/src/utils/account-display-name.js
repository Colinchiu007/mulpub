// @ts-check
/**
 * account-display-name.js — 账号显示名的唯一解析入口
 *
 * 存在理由（openspec change: add-account-name-source）：噪声守卫的职责是「藏掉系统抓错的
 * 文本」，但用户自己写的名字也必须过同一层守卫时，含 ` - ` / ` · ` / `…` / 以「服务平台」
 * 结尾的正常昵称会被一起藏掉，且编辑框回填的也是回落值 —— 用户的命名在 UI 上不可达。
 * 二者需要的是同一个判断的两个相反答案，只能靠 name_source 区分，故集中到这里。
 *
 * 口径：
 * - `account_name` 是首选显示位（机器回填写它、用户改名也写它），`name_source` 描述它的来源。
 * - `manual` ⇒ 原样返回，不过任何形态规则。
 * - `auto` / 缺失 ⇒ 过守卫；不合格直接回落平台名。
 * - `name` 是 `document.title` 的落盘位（平台显示名/历史兼容位），**永不作为显示名来源**；
 *   主进程 IPC 层也不得再用它填充 `account_name`。
 */
import { isNoiseAccountName } from '@multi-publish/shared-utils/src/account-name-guard'

/**
 * @param {any} account 账号对象（后端投影 + IPC 白名单后的公开字段）
 * @param {{platformLabel?: string, fallback?: string}} [options]
 * @returns {string} 可直接展示的账号名；全部不合格时返回平台名（可能为空串）
 */
export function resolveAccountDisplayName (account, options = {}) {
  const fallback = typeof options.platformLabel === 'string' ? options.platformLabel
    : (typeof options.fallback === 'string' ? options.fallback : '')
  const acc = account && typeof account === 'object' ? account : {}

  const primary = typeof acc.account_name === 'string' ? acc.account_name.trim() : ''
  // 用户显式命名：唯一「不过滤」的路径，即使它长得像抓取错误也必须原样显示。
  if (primary && acc.name_source === 'manual') return primary
  if (primary && !isNoiseAccountName(primary)) return primary

  // `name` **不是**显示名来源：主进程写进它的就是 auth-view-manager 的 `document.title`
  // （实测本机 accounts.json 8 条，`name` 全是页面标题/标语，而 4 条合法昵称全落在
  // `account_name`）。把它留作第二候选，唯一效果是把形态规则抓不到的那类标题放出去 ——
  // 快手的 `name` 是「快手，记录世界 记录你」，无连字符、无省略号、无平台后缀，
  // isNoiseAccountName 判不出来，页面标语就会冒充账号名。回落平台名至少不会说谎。
  return fallback
}

export default resolveAccountDisplayName
