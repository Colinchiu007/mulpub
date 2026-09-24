// @ts-check
/**
 * WebviewManager 常量定义
 * 从 webview-manager.js 提取的常量，保持单一真源
 */

// 左侧导航栏宽度（与前端 MpSidebar 的 CSS 变量 --mp-sidebar-width 保持一致）
// 默认 200px，窄屏（≤900px）时 68px；由渲染进程通过 IPC 动态同步
const SIDEBAR_WIDTH_DEFAULT = 200

// 账号级持久会话分区标识校验（与 comment-manager 保持一致）
const SAFE_IDENTIFIER = /^[a-zA-Z0-9_-]+$/

// 方案一（治本）：账号标签登录成功后自动回写凭证的去抖窗口（毫秒）。
// 稳定后再保存，避免把加载中间态的半截导航误判为登录成功（对齐 auth-view-manager 的 3s 自动完成，此处略短）。
const AUTO_SAVE_DEBOUNCE_MS = 1500

// CDP addScriptToEvaluateOnNewDocument 的完成时限（毫秒）。根因（2026-09-24 头条
// 账号标签事故）：该命令在部分账号分区可永久挂起（标签存活期内从未返回），而首个
// 导航被门控在注入 promise 之后 → 页面「一直加载不出来」。超时降级旧
// did-finish-load 补注入路径（fail-open）：导航不得被 CDP 无限期阻塞。
const LS_INJECTION_TIMEOUT_MS = 2500

// 固定首页标签 ID（对齐参考产品：第 1 个标签永远是应用主页，不可关闭，不占用真实 WebContentsView）
const HOME_TAB_ID = 'home'

// 虚拟登录标签 ID（对齐参考产品：登录页以全屏标签形式呈现在 TabBar 中）
const AUTH_TAB_ID = 'auth-login'

// ─── 内嵌主页标签（home-shell，PRD-TAB-INDEPENDENT-HOME-2026-09-22）───
// 壳态参数：渲染层据此识别「本窗口是 + 新标签中的独立 SPA 实例」，跳过标签系统
// 订阅并按首页壳渲染；home-shell-preload 的双判据安全校验（主进程注入
// --mp-home-shell-url + 文档同源且参数仍在）以其为 electronAPI 暴露面闸门。
const HOME_SHELL_PARAM = 'mp-home-shell=1'

module.exports = {
  SIDEBAR_WIDTH_DEFAULT,
  SAFE_IDENTIFIER,
  AUTO_SAVE_DEBOUNCE_MS,
  LS_INJECTION_TIMEOUT_MS,
  HOME_TAB_ID,
  AUTH_TAB_ID,
  HOME_SHELL_PARAM
}
