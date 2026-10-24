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
  // publish-frequency-policy-v2：策略读取/写入 + 紧急放行。原在 publish.js 内，
  // 该文件被本次变更推到 645 行触到「新代码不得引入超大文件」门禁（limit=500），
  // 按门禁给的正解（mixin/composable 范式拆分）外移为独立模块。
  require('./publish-frequency')(ipcMain, deps)
  require('./analytics')(ipcMain, deps)
  require('./sync')(ipcMain, deps)
  require('./update')(ipcMain, deps)
  // 强制升级阻断弹窗（forced-update-gate）：升级/重试/文案通道
  require('./enforce-gate')(ipcMain, deps)
  require('./upload')(ipcMain, deps)
  require('./scheduler')(ipcMain, deps)
  require('./sensitive')(ipcMain, deps)
  require('./render')(ipcMain, deps)
  require('./platform')(ipcMain, deps)
  require('./templates')(ipcMain, deps)
  require('./license')(ipcMain, deps)
  require('./ai')(ipcMain, deps)
  // 热门选题「生成视频 → 去发布」的爆款标题生成（fix-hot-topics-genvideo-title）。
  // 必须注册：缺了它渲染层【去发布】拿不到 AI 标题，只能降级为原始选题。
  require('./gen-video-title')(ipcMain, deps)
  require('./offline')(ipcMain, deps)
  // 微信 Native 扫码支付（wechat-native-payment，2026-10-21）：下单 + 订单状态轮询。
  // 与上面被移除的买断链路**不是同一件事**：那条是本地 mock 下单 + 本地写授权，
  // 这条只调服务端下单、二维码在主进程渲染，订单状态只由服务端 webhook 推进。
  require('./wechat-pay').registerWeChatPayHandlers(ipcMain, deps)
  // 注意：这里**不要**再注册 `./payment`。
  // 买断授权模型已于 2026-10-17 移除（remove-buyout-license）：那条本地下单链路
  // 在 S1 修复后已经断了（activate 只认 4-4-4 兑换码，订单 UUID 必不匹配 ⇒
  // 支付成功也拿不到授权），且 ¥99 一次性买断与服务端 plan-matrix 的三档订阅互斥。
  // 在线支付若要做，需接支付平台 + 回调 + 对账，是独立立项，不是恢复这个文件。
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
  // 数字人形象/音色目录（avatar-spokesperson 流水线接通 HeyGen）
  require('./avatar-catalog')(ipcMain, deps)
  // 数字人形象克隆（avatar-voice-clone：上传照片/视频 → 长期可复用的形象）
  require('./avatar-clone')(ipcMain, deps)
  // 飞影 11 个扩展端点（hifly-full-api-ui）：积分/网感模板/封面模板/创建封面/删除作品
  // + 6 个收费创作模式（声音驱动/网感模板/翻译/唱歌/图片驱动/音频创作）。
  // 依赖缺失或上游 adapter 未实现时，handler 内部回 HIFLY_EXTRA_UNSUPPORTED（fail-closed），
  // 不会把整条 IPC 注册链带崩。
  require('./hifly-extra')(ipcMain, deps)
  require('./prompt-eval')(ipcMain, deps)
  require('./generation-feedback')(ipcMain, deps)
  // 影视工程（film-engineering）流水线
  require('./film-engineering')(ipcMain, deps)
  // 影视工程「自动」模式（film-auto-mode）：规划/执行/片段编辑/收口校验
  // 注意：执行不经 pipeline 引擎（直连 production-driver + auto-runner），合成仍走既有 manifest 通道
  require('./film-engineering-auto')(ipcMain, deps)
  // 影视工程「资产导入」写路径（PR-3b · F-J）：整体替换 userData/film-kit
  // ⚠ 与上面的只读/自动模式**分文件**（写路径独立 ⇒ 不把 446 行的 auto handler 顶过 500 行门禁）
  require('./film-engineering-import')(ipcMain, deps)
  require('./aggregation')(ipcMain, deps)
  // 博主监控与采集（PRD-CREATOR-WIRING-2026-10-07）。
  // 必须注册：缺了它，渲染端点「博主监控」会拿到 Electron 原生的
  // "No handler registered"，对用户毫无意义。handler 内部在依赖缺失时
  // 仍注册通道并返回可消费的降级结果（PRD-CREATOR-MONITOR-COLLECT §handler 3）。
  require('./creator').registerHandlers(ipcMain, deps)
  // 热门选题聚合（多渠道热搜）
  require('./hot-topics')(ipcMain, deps)
  // 知乎收藏夹批量采集/改写（官方 API + 频率控制）
  require('./zhihu-favlist')(ipcMain, deps)
  // 知乎 API 配置（设置页「设置 → 知乎 API」：Access Secret 加密保存 / 测试连接 / 清除）。
  // 必须注册：缺了它渲染端设置页拿到的是 Electron 原生 "No handler registered"，
  // 而采集页会显示「未配置」——用户明明配过，却无从解释。
  require('./zhihu-settings')(ipcMain, deps)
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
  // 播客 RSS 频道（小宇宙收录链路）。必须注册：缺了它渲染端「播客频道」页
  // 拿到的是 Electron 原生 "No handler registered"，对用户毫无意义。
  require('./podcast')(ipcMain, deps)
  // 采集页「快捷采集」：内置指令目录 + 执行（检索复用 content-intelligence + 默认大模型）。
  // 依赖缺失时 handler 内部降级（返回 -101），不会把整条 IPC 注册链带崩。
  require('./quick-collect')(ipcMain, deps)
  // 全自动管道
  require('./auto-pipeline')(ipcMain, deps)
  // 自动化任务（定时 / 应用启动触发，后台执行）
  require('./automation')(ipcMain, deps)
  // 知识库（爆款库 + 个人知识库）
  require('./knowledge-library')(ipcMain, deps)
  require('./performance-loop')(ipcMain, deps)
  // 飞书 API 配置
  require('./feishu-settings')(ipcMain, deps)
  // 服务状态聚合（侧边栏多服务面板）
  require('./services')(ipcMain, deps)
}

module.exports = registerAllHandlers
