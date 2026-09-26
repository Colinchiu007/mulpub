// @ts-check
/**
 * IPC handlers 注册中心
 * 将所有 ipcMain.handle 调用从 main.js 拆分到独立模块
 */
function registerAllHandlers(ipcMain, deps) {
  require('./identity')(ipcMain, { authService: deps.identityService })
  require('./store')(ipcMain, deps)
  require('./proxy')(ipcMain, deps)
  require('./account')(ipcMain, deps)
  // 账号云镜像同步（digest / sync / disconnect），归属只认已登录身份
  require('./cloud-account')(ipcMain, deps)
  require('./keyword')(ipcMain, deps)
  require('./publish')(ipcMain, deps)
  require('./analytics')(ipcMain, deps)
  require('./sync')(ipcMain, deps)
  require('./update')(ipcMain, deps)
  require('./upload')(ipcMain, deps)
  require('./scheduler')(ipcMain, deps)
  require('./sensitive')(ipcMain, deps)
  require('./render')(ipcMain, deps)
  require('./platform')(ipcMain, deps)
  require('./templates')(ipcMain, deps)
  require('./license')(ipcMain, deps)
  require('./ai')(ipcMain, deps)
  require('./offline')(ipcMain, deps)
  require('./payment')(ipcMain, deps)
  require('./pipeline')(ipcMain, deps)
  // runImportedMediaGc 仅生产接线开启：selected-media 老化回收（>7 天）在注册时执行一次；
  // 测试环境不传该标记，避免 registerHandlers 触碰真实临时目录。
  require('./story2video')(ipcMain, { ...deps, runImportedMediaGc: true })
  require('./video')(ipcMain, deps)
  require('./video-clone')(ipcMain, deps)
  require('./misc')(ipcMain, deps)
  require('./notify')(ipcMain, deps)
  require('./onboarding')(ipcMain, deps)
  require('./model-provider')(ipcMain, deps)
  require('./ops-center-sync').registerHandlers(ipcMain, deps)
  require('./rate-limit').registerHandlers(ipcMain, deps)
  require('./tts-voice-catalog')(ipcMain, deps)
  require('./tts-voice-clone')(ipcMain, deps)
  require('./prompt-eval')(ipcMain, deps)
  require('./generation-feedback')(ipcMain, deps)
  // 影视工程（film-engineering）流水线
  require('./film-engineering')(ipcMain, deps)
  require('./aggregation')(ipcMain, deps)
  // 热门选题聚合（多渠道热搜）
  require('./hot-topics')(ipcMain, deps)
  // 知乎收藏夹批量采集/改写（官方 API + 频率控制）
  require('./zhihu-favlist')(ipcMain, deps)
  require('./logs')(ipcMain, deps)
  // 缓存清理（设置-通用设置：统计/清理 os.tmpdir() 下的合成与影视工程临时缓存）
  require('./cache')(ipcMain, deps)
  // Backlot 项目库
  require('./project')(ipcMain, deps)
  // Backlot 实时看板
  require('./board')(ipcMain, deps)
  // Backlot Contact Sheet 审批
  require('./contact-sheet')(ipcMain, deps)
  // Backlot Approval Gate 审批门
  require('./approval-gate')(ipcMain, deps)
  // Backlot Replay 生产回放
  require('./replay')(ipcMain, deps)
  // 全自动管道
  require('./auto-pipeline')(ipcMain, deps)
  // 知识库（爆款库 + 个人知识库）
  require('./knowledge-library')(ipcMain, deps)
  require('./performance-loop')(ipcMain, deps)
  // 飞书 API 配置
  require('./feishu-settings')(ipcMain, deps)
  // 服务状态聚合（侧边栏多服务面板）
  require('./services')(ipcMain, deps)
}

module.exports = registerAllHandlers
