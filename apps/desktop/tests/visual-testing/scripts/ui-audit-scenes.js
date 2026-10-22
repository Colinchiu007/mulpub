/**
 * UI 视觉巡检 —— 场景清单（数据层）。
 *
 * 独立成文件的原因：本仓「债务熔断」门禁对 >500 行的文件有硬预算，
 * 巡检编排文件一度到 797 行 ⇒ FILES_OVER_500 指标超基线 1 个（96 > 95）。
 * 正确处置是**拆分**而不是抬高基线（抬高基线等于新增债务）。
 *
 * 本文件只放「巡检哪些界面」的数据：路由清单 + 主要流程场景。
 * 探针（浏览器上下文枚举）在 ui-audit-probes.js，编排在 ui-audit-capture.js。
 */

const ROUTES = [
  { route: '/', name: 'Home', area: '首页工作台' },
  { route: '/comments', name: 'Comments', area: '评论互动' },
  { route: '/first-run', name: 'FirstRun', area: '首次使用引导' },
  { route: '/publish', name: 'Publish', area: '一键发布' },
  { route: '/publish/history', name: 'PublishHistory', area: '发布记录' },
  { route: '/accounts', name: 'Accounts', area: '账号管理' },
  { route: '/dashboard', name: 'Dashboard', area: '数据看板' },
  { route: '/collection', name: 'Collection', area: '素材采集' },
  { route: '/automation', name: 'Automation', area: '自动化任务' },
  { route: '/copy-library', name: 'CopyLibrary', area: '文案库' },
  { route: '/keywords', name: 'KeywordMonitor', area: '关键词监控' },
  { route: '/viral-analysis', name: 'ViralAnalysis', area: '爆款分析' },
  { route: '/model-providers', name: 'ModelProviders', area: '模型供应商' },
  { route: '/create', name: 'Create', area: '视频创作' },
  { route: '/member-center', name: 'MemberCenter', area: '会员中心' },
  { route: '/create/result', name: 'CreateResult', area: '视频创作结果' },
  { route: '/cloud-publish', name: 'CloudPublish', area: '云端发布' },
  { route: '/intelligence', name: 'Intelligence', area: '智能资讯' },
  { route: '/calendar', name: 'Calendar', area: '内容日历' },
  { route: '/library', name: 'ProjectLibrary', area: '项目库' },
  { route: '/board/e2e-project', name: 'ProductionBoard', area: '生产看板' },
  { route: '/board/e2e-project/contact-sheet', name: 'ContactSheet', area: '场景分镜' },
  { route: '/replay/e2e-project', name: 'ReplayTimeline', area: '生产回放' },
  { route: '/prompt-eval', name: 'PromptEval', area: '提示词评测' },
  { route: '/video-clone', name: 'VideoClone', area: '视频克隆' },
  { route: '/film-engineering', name: 'FilmEngineeringHub', area: '影视工程' },
  { route: '/film-engineering/classic', name: 'FilmEngineeringClassic', area: '影视工程经典版' },
  { route: '/auto-pipeline', name: 'AutoPipeline', area: '全自动流水线' },
  { route: '/knowledge-base', name: 'KnowledgeBase', area: '知识库' },
  { route: '/performance-insights', name: 'PerformanceInsights', area: '效能洞察' },
  { route: '/rewrite', name: 'Rewrite', area: '内容改写' },
  { route: '/hot-topics', name: 'HotTopics', area: '热点选题' },
  { route: '/podcast', name: 'PodcastChannel', area: '播客频道' },
]

/** 主要流程运行结果：在哪个路由上做什么操作后展示「结果态」 */
const FLOW_SCENARIOS = [
  {
    id: 'publish-target-selected',
    route: '/publish',
    area: '一键发布',
    position: '发布表单 · 目标平台选择区',
    state: '已选平台后的表单展开态',
    action: async page => {
      const platform = page.locator('[data-testid^="platform-"]').first()
      if (await platform.count()) {
        await platform.click()
        await page.waitForTimeout(900)
        return true
      }
      return false
    },
  },
  {
    id: 'publish-title-filled',
    route: '/publish',
    area: '一键发布',
    position: '发布表单 · 标题/正文输入区',
    state: '输入框已填写 + 校验提示',
    action: async page => {
      const input = page.locator('input[type="text"], textarea').first()
      if (await input.count()) {
        await input.click()
        await input.fill('春季新品发布：一款让效率翻倍的智能工作流')
        await page.waitForTimeout(700)
        return true
      }
      return false
    },
  },
  {
    id: 'publish-history-selected',
    route: '/publish/history',
    area: '发布记录',
    position: '记录列表 · 批量选择态',
    state: '进入多选模式（出现选择计数与批量操作条）',
    action: async page => {
      const trigger = page.locator('[data-testid="start-selection"]').first()
      if (await trigger.count()) {
        await trigger.click()
        await page.waitForTimeout(700)
        return true
      }
      return false
    },
  },
  {
    id: 'collection-tab-hot',
    route: '/collection',
    area: '素材采集',
    position: '采集页 · 第二个标签',
    state: '标签切换后的内容区',
    action: async page => {
      const tab = page.locator('.collection-tab-btn').nth(1)
      if (await tab.count()) {
        await tab.click()
        await page.waitForTimeout(800)
        return true
      }
      return false
    },
  },
  {
    id: 'create-history-tab',
    route: '/create?view=history',
    area: '视频创作',
    position: '创作页 · 历史记录标签',
    state: '历史记录列表态',
    action: async page => {
      await page.waitForTimeout(1200)
      return true
    },
  },
  {
    id: 'account-login-panel',
    route: '/accounts',
    area: '账号管理',
    position: '账号卡片 · 登录态面板',
    state: '平台登录/绑定浮层',
    action: async page => {
      const trigger = page.locator('[data-testid="account-login"], [data-testid*="login"], button:has-text("登录"), button:has-text("添加账号")').first()
      if (await trigger.count()) {
        await trigger.click()
        await page.waitForTimeout(900)
        return true
      }
      return false
    },
  },
  {
    id: 'provider-delete-dialog',
    route: '/model-providers',
    area: '模型供应商',
    position: '供应商行 · 删除操作',
    state: '删除确认弹窗（危险操作二次确认）',
    action: async page => {
      const trigger = page.locator('button:has-text("删除"), [data-testid*="delete"]').first()
      if (await trigger.count()) {
        await trigger.click()
        await page.waitForTimeout(900)
        return true
      }
      return false
    },
  },
  {
    id: 'settings-dialog',
    route: '/',
    area: '全局',
    position: '顶栏 · 设置入口',
    state: '设置抽屉/弹窗',
    action: async page => {
      const trigger = page.locator('button:has-text("设置"), [data-testid*="settings"], [aria-label*="设置"]').first()
      if (await trigger.count()) {
        await trigger.click()
        await page.waitForTimeout(1100)
        return true
      }
      return false
    },
  },
  {
    id: 'member-center-sub',
    route: '/member-center',
    area: '会员中心',
    position: '会员中心 · 二级标签',
    state: '二级标签切换态',
    action: async page => {
      const tab = page.locator('.mc-tab, [class*="mc-"] button, nav button').nth(1)
      if (await tab.count()) {
        await tab.click()
        await page.waitForTimeout(800)
        return true
      }
      return false
    },
  },
  {
    id: 'hot-topics-favorite',
    route: '/hot-topics',
    area: '热点选题',
    position: '热点列表 · 收藏筛选',
    state: '筛选后列表态',
    action: async page => {
      const trigger = page.locator('[class*="favorite"], button:has-text("收藏")').first()
      if (await trigger.count()) {
        await trigger.click()
        await page.waitForTimeout(800)
        return true
      }
      return false
    },
  },
]

module.exports = { ROUTES, FLOW_SCENARIOS }
