// @ts-check
/**
 * WebviewManager — 应用内浏览器标签页管理
 *
 * 每个 tab 独立 WebContentsView，独立 session 分区，Cookie 互不干扰。
 *
 * 功能：
 *   创建/关闭/切换标签页，前进后退刷新，URL 导航，搜索跳转
 *   虚拟登录标签（AuthViewManager / QrCodeLogin 托管全屏登录）
 *   左侧导航栏宽度同步
 *
 * 拆分说明：本模块已拆分为 webview-manager/ 目录下的多个子模块，
 * 本文件仅作为 re-export 入口，保持 require('./webview-manager') 路径兼容。
 */
module.exports = require('./webview-manager/index')
