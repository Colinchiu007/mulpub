'use strict'
/**
 * enforce-gate 弹窗文案字典（zh/en 双语，forced-update-gate 2026-10-19）。
 *
 * 为什么不进 src/locales：阻断窗口是主进程独立 BrowserWindow，加载
 * electron/enforce-gate/gate.html，不在渲染端 Vue 应用内；且渲染端 src/ 非
 * locales 文件禁止中文字面量（CI 基线扫描），主进程文件不受该约束。
 * 按 app.getLocale() 前缀选择，缺键回英文（grilling Q7）。
 */
const TEXTS = {
  zh: {
    gateTitle: '检测到重要核心更新',
    gateBody: '当前版本存在重大问题，必须升级到新版本后才能继续使用。',
    gateVersionLine: '当前版本 {current} → 新版本 {target}',
    gateUpgradeBtn: '立即升级',
    gateDownloading: '正在下载更新… {percent}%',
    gateFailed: '下载失败，请检查网络后重试',
    gateRetry: '重试',
    gateVerifyFailed: '版本验证失败，请检查网络后重试',
  },
  en: {
    gateTitle: 'Critical update required',
    gateBody: 'This version has a critical issue. You must update to continue using the app.',
    gateVersionLine: 'Current {current} → New {target}',
    gateUpgradeBtn: 'Update Now',
    gateDownloading: 'Downloading update… {percent}%',
    gateFailed: 'Download failed. Check your network and try again.',
    gateRetry: 'Retry',
    gateVerifyFailed: 'Version verification failed. Check your network and try again.',
  },
}

const KEYS = Object.keys(TEXTS.en).sort()

function readGateText (locale) {
  const isZh = String(locale || '').toLowerCase().startsWith('zh')
  const lang = isZh ? 'zh' : 'en'
  return { lang, keys: KEYS, t: TEXTS[lang], fallback: TEXTS.en }
}

module.exports = { readGateText, TEXTS, KEYS }
