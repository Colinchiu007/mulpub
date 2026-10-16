// @ts-check
/**
 * Onboarding — 首次启动引导管理器
 *
 * 功能：
 * 1. 显示操作引导界面（step-by-step）
 * 2. 记录引导状态
 * 3. 支持跳过引导
 */
const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const log = require('./logger')

const ONBOARDING_STEPS = [
  { id: 'welcome', title: '欢迎使用汤姆鱼', description: '一站式多平台发布工具' },
  { id: 'accounts', title: '添加账号', description: '点击左侧菜单「账号管理」，添加您的社交媒体账号' },
  { id: 'publish', title: '发布内容', description: '选择平台，填写标题和内容，点击发布即可' },
  { id: 'complete', title: '完成设置', description: '现在开始您的多平台发布之旅！' },
]

 
let _mainWin = null

/**
 * 检查是否完成引导
 */
function isOnboardingDone () {
  return fs.existsSync(path.join(app.getPath('userData'), 'onboarding-done'))
}

/**
 * 标记引导完成
 */
function completeOnboarding () {
  try {
    fs.writeFileSync(
      path.join(app.getPath('userData'), 'onboarding-done'),
      `completed:${new Date().toISOString()}`
    )
    return true
  } catch (e) {
    log.error('onboarding', 'Failed to save state:', e.message)
    return false
  }
}

/**
 * 重置引导状态（用于测试）
 */
function resetOnboarding () {
  const p = path.join(app.getPath('userData'), 'onboarding-done')
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

/**
 * 获取引导步骤
 */
function getSteps () {
  return ONBOARDING_STEPS
}

/**
 * 启动引导流程
 */
async function startOnboarding (mainWin) {
  _mainWin = mainWin

  if (isOnboardingDone()) {
    mainWin.webContents.send('onboarding:complete')
    return
  }

  mainWin.webContents.send('onboarding:start', {
    steps: ONBOARDING_STEPS,
    totalSteps: ONBOARDING_STEPS.length,
  })
}

module.exports = { isOnboardingDone, completeOnboarding, resetOnboarding, getSteps, startOnboarding }