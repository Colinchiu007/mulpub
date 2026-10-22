/**
 * 32个工作流的视觉回归测试
 * 运行: node tests/visual-testing/workflows/all-workflows.visual.test.js
 */

const fs = require('fs');
const path = require('path');
const { VisualTestRunner } = require('../test-runner');

const STEP_TIMEOUT = Number(process.env.WORKFLOW_STEP_TIMEOUT || 3000);
const DEFAULT_PIXEL_THRESHOLD = 0.01;
const DESKTOP_ROOT = path.resolve(__dirname, '../../..');
const ROUTER_FILE = path.join(DESKTOP_ROOT, 'src/router/index.js');
const SOURCE_ROOT = path.join(DESKTOP_ROOT, 'src');
const DEFAULT_BASELINE_DIR = path.join(DESKTOP_ROOT, 'tests/visual-testing/base-screenshots');
const DEFAULT_SCREENSHOT_DIR = path.join(DESKTOP_ROOT, 'tests/visual-testing/screenshots/workflows');
const SUPPORTED_ACTIONS = new Set([
  'click',
  'fill',
  'waitFor',
  'waitForSelector',
  'screenshot',
  'press',
  'select',
  'setInputFiles',
  'selectDate',
  'dragAndDrop',
]);
const SELECTOR_ACTIONS = new Set([
  'click',
  'fill',
  'waitFor',
  'waitForSelector',
  'select',
  'setInputFiles',
  'dragAndDrop',
]);

function buildWorkflowUrl(baseUrl, route) {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  return route === '/' ? normalizedBase + '/' : normalizedBase + '/#' + route;
}

/**
 * 工作流测试配置
 * 每个工作流测试: 操作前截图 -> 执行操作 -> 操作后截图 -> 对比差异
 */
const workflowTests = [
  // 账号管理：搜索、筛选和弹窗均回到列表稳定态后截图。
  {
    name: 'accounts-search-clear', route: '/accounts', baseline: 'accounts-list',
    steps: [
      { action: 'waitFor', selector: '.accounts-page' },
      { action: 'fill', selector: 'input[aria-label="搜索账号或平台"]', value: '知乎' },
      { action: 'click', selector: 'button.clear-search' },
      { action: 'waitForSelector', selector: 'button.clear-search', state: 'hidden' },
      { action: 'click', selector: '.accounts-page' },
      { action: 'screenshot', name: '清空搜索后的账号列表' },
    ],
  },
  {
    name: 'accounts-active-filter-reset', route: '/accounts', baseline: 'accounts-list',
    steps: [
      { action: 'waitFor', selector: '.filter-tabs' },
      { action: 'click', selector: '.filter-tabs button[role="tab"]:nth-child(2)' },
      { action: 'waitFor', selector: '.filter-tabs button[role="tab"]:nth-child(2).active' },
      { action: 'click', selector: '.filter-tabs button[role="tab"]:nth-child(1)' },
      { action: 'waitFor', selector: '.filter-tabs button[role="tab"]:nth-child(1).active' },
      { action: 'click', selector: '.accounts-page' },
      { action: 'screenshot', name: '恢复全部账号筛选' },
    ],
  },
  {
    name: 'accounts-inactive-filter-reset', route: '/accounts', baseline: 'accounts-list',
    steps: [
      { action: 'waitFor', selector: '.filter-tabs' },
      { action: 'click', selector: '.filter-tabs button[role="tab"]:nth-child(3)' },
      { action: 'waitFor', selector: '.filter-tabs button[role="tab"]:nth-child(3).active' },
      { action: 'click', selector: '.filter-tabs button[role="tab"]:nth-child(1)' },
      { action: 'waitFor', selector: '.filter-tabs button[role="tab"]:nth-child(1).active' },
      { action: 'click', selector: '.accounts-page' },
      { action: 'screenshot', name: '恢复全部账号筛选' },
    ],
  },
  {
    name: 'accounts-add-dialog-cancel', route: '/accounts', baseline: 'accounts-list',
    steps: [
      { action: 'waitFor', selector: '.account-command-bar' },
      { action: 'click', selector: '[data-testid="account-add"]' },
      { action: 'waitFor', selector: '.ui-modal-overlay' },
      { action: 'click', selector: '.ui-modal-close' },
      { action: 'waitForSelector', selector: '.ui-modal-overlay', state: 'hidden' },
      { action: 'click', selector: '.accounts-page' },
      { action: 'screenshot', name: '取消添加后的账号列表' },
    ],
  },
  // 平台选择器（AccountPlatformPicker，自绘浮层）的交互回归。
  //
  // 为什么复用 accounts-list 基线、而不是给「浮层展开态」单独建一张基线：
  // 本仓的视觉基线必须与 **CI 同一次渲染**逐像素相等（QM-4 第 7 条 + Gate 7b 的 0 px 判定），
  // 基线 PNG 只能取自 CI 产物 —— 本机截图当基线是明确禁止的。所以本条用例把
  // 「浮层展开 → 搜索 → Esc 收起 → 关弹窗」整段交互跑完，**末态回到账号列表**，
  // 于是既拿到了交互层的回归保护（浮层打不开 / 搜索不生效 / 收不回弹窗都会让本条红），
  // 又不需要引入一张来路不明的基线。
  // 「浮层展开态」的像素基线需要等 CI 产出同源渲染后再补（见 openspec/records/platform-picker-ux.md 遗留项）。
  {
    name: 'accounts-platform-picker', route: '/accounts', baseline: 'accounts-list',
    steps: [
      { action: 'waitFor', selector: '.account-command-bar' },
      { action: 'click', selector: '[data-testid="account-add"]' },
      { action: 'waitFor', selector: '.ui-modal-overlay' },
      { action: 'click', selector: '[data-testid="platform-picker-trigger"]' },
      { action: 'waitFor', selector: '[data-testid="platform-picker-popup"]' },
      { action: 'fill', selector: '[data-testid="platform-picker-search"]', value: '抖' },
      { action: 'waitFor', selector: '[data-testid="platform-picker-option-douyin"]' },
      { action: 'press', key: 'Escape' },
      { action: 'waitForSelector', selector: '[data-testid="platform-picker-popup"]', state: 'hidden' },
      { action: 'click', selector: '.ui-modal-close' },
      { action: 'waitForSelector', selector: '.ui-modal-overlay', state: 'hidden' },
      { action: 'click', selector: '.accounts-page' },
      { action: 'screenshot', name: '平台选择器交互后复位' },
    ],
  },
  // 曾有一条 accounts-group-dialog-close（点 .page-actions 里的「分组管理」→ 关弹窗）。已删除，两条原因：
  // ① 产品形态变了 —— 分组管理不再是弹窗，而是 shell 模块导航（MpModuleNav.vue:38）以 ?tab=groups
  //    打开的**内联面板** AccountGroupsPanel；② 改成面板断言后仍无法像素比对：本套件有
  //    [SCREENSHOT_REQUIRED] 契约（每条用例必须有一步 screenshot），而它那一屏是分组面板态，
  //    与任何既有基线都不同源（实测拿 accounts-list 基线比 = 差 2.26%），且 test:all:visual 没有
  //    CI job ⇒ 按 QM-4 第 7 条拿不到合法基线。曾试过只留结构断言，被该契约当场拦下
  //    （[SCREENSHOT_REQUIRED] accounts-groups-panel 没有截图步骤），说明删用例而不是留一条恒红/恒假
  //    的用例才是正解。分组面板的真覆盖在 AccountGroupsPanel 的组件单测，不在这里。

  // 一键发布：编辑字段或打开辅助面板后恢复默认发布表单。
  {
    name: 'publish-title-edit-reset', route: '/publish', baseline: 'publish-form',
    steps: [
      { action: 'waitFor', selector: 'input[placeholder="请输入文章标题"]' },
      { action: 'fill', selector: 'input[placeholder="请输入文章标题"]', value: '视觉回归标题' },
      { action: 'fill', selector: 'input[placeholder="请输入文章标题"]', value: '' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '清空标题后的发布表单' },
    ],
  },
  {
    name: 'publish-author-edit-reset', route: '/publish', baseline: 'publish-form',
    steps: [
      { action: 'waitFor', selector: 'input[placeholder="作者名称（选填）"]' },
      { action: 'fill', selector: 'input[placeholder="作者名称（选填）"]', value: '测试作者' },
      { action: 'fill', selector: 'input[placeholder="作者名称（选填）"]', value: '' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '清空作者后的发布表单' },
    ],
  },
  {
    name: 'publish-platform-search-reset', route: '/publish', baseline: 'publish-form',
    steps: [
      { action: 'waitFor', selector: 'input[placeholder="搜索平台或账号"]' },
      { action: 'fill', selector: 'input[placeholder="搜索平台或账号"]', value: '微博' },
      { action: 'fill', selector: 'input[placeholder="搜索平台或账号"]', value: '' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '清空平台搜索后的发布表单' },
    ],
  },
  {
    name: 'publish-cover-url-reset', route: '/publish', baseline: 'publish-form',
    steps: [
      { action: 'waitFor', selector: 'input[placeholder="封面图片链接（选填）"]' },
      { action: 'fill', selector: 'input[placeholder="封面图片链接（选填）"]', value: 'https://example.com/cover.jpg' },
      { action: 'fill', selector: 'input[placeholder="封面图片链接（选填）"]', value: '' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '清空封面链接后的发布表单' },
    ],
  },
  {
    name: 'publish-template-panel-toggle', route: '/publish', baseline: 'publish-form',
    steps: [
      { action: 'waitFor', selector: 'button:has-text("模板")' },
      { action: 'click', selector: 'button:has-text("模板")' },
      { action: 'waitFor', selector: 'button.cohere-btn-ghost:has-text("✕ 关闭")' },
      { action: 'click', selector: 'button.cohere-btn-ghost:has-text("✕ 关闭")' },
      { action: 'waitForSelector', selector: 'button.cohere-btn-ghost:has-text("✕ 关闭")', state: 'hidden' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '关闭模板面板后的发布表单' },
    ],
  },
  {
    name: 'publish-ai-panel-toggle', route: '/publish', baseline: 'publish-form',
    steps: [
      { action: 'waitFor', selector: 'button.cohere-btn-ghost:has-text("🤖 AI")' },
      { action: 'click', selector: 'button.cohere-btn-ghost:has-text("🤖 AI")' },
      { action: 'waitFor', selector: 'button.cohere-btn-ghost:has-text("✕ 关闭")' },
      { action: 'click', selector: 'button.cohere-btn-ghost:has-text("✕ 关闭")' },
      { action: 'waitForSelector', selector: 'button.cohere-btn-ghost:has-text("✕ 关闭")', state: 'hidden' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '关闭AI面板后的发布表单' },
    ],
  },

  // 模型服务商：在已配置默认视图和全量分类之间往返。
  {
    name: 'providers-add-dialog-cancel', route: '/model-providers', baseline: 'model-providers',
    steps: [
      { action: 'waitFor', selector: '.page-actions .cohere-btn-primary' },
      { action: 'click', selector: '.page-actions .cohere-btn-primary' },
      { action: 'waitFor', selector: '.el-dialog' },
      { action: 'click', selector: '.el-dialog .cohere-btn-secondary' },
      { action: 'waitForSelector', selector: '.el-dialog', state: 'hidden' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '取消添加后的服务商列表' },
    ],
  },
  {
    name: 'providers-all-configured-roundtrip', route: '/model-providers', baseline: 'model-providers',
    steps: [
      { action: 'waitFor', selector: '.view-mode-tabs' },
      { action: 'click', selector: '.view-mode-tab:nth-child(2)' },
      { action: 'waitFor', selector: '.cohere-filter-bar' },
      { action: 'click', selector: '.view-mode-tab:nth-child(1)' },
      { action: 'waitFor', selector: '.view-mode-tab:nth-child(1).active' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '恢复已配置服务商视图' },
    ],
  },
  {
    name: 'providers-llm-filter-reset', route: '/model-providers', baseline: 'model-providers',
    steps: [
      { action: 'waitFor', selector: '.view-mode-tabs' },
      { action: 'click', selector: '.view-mode-tab:nth-child(2)' },
      { action: 'click', selector: 'button.filter-chip:has-text("推理模型")' },
      { action: 'waitFor', selector: 'button.filter-chip.active:has-text("推理模型")' },
      { action: 'click', selector: '.view-mode-tab:nth-child(1)' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '恢复已配置服务商视图' },
    ],
  },
  {
    name: 'providers-tts-filter-reset', route: '/model-providers', baseline: 'model-providers',
    steps: [
      { action: 'waitFor', selector: '.view-mode-tabs' },
      { action: 'click', selector: '.view-mode-tab:nth-child(2)' },
      { action: 'click', selector: 'button.filter-chip:has-text("TTS语音")' },
      { action: 'waitFor', selector: 'button.filter-chip.active:has-text("TTS语音")' },
      { action: 'click', selector: '.view-mode-tab:nth-child(1)' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '恢复已配置服务商视图' },
    ],
  },
  {
    name: 'providers-image-filter-reset', route: '/model-providers', baseline: 'model-providers',
    steps: [
      { action: 'waitFor', selector: '.view-mode-tabs' },
      { action: 'click', selector: '.view-mode-tab:nth-child(2)' },
      { action: 'click', selector: 'button.filter-chip:has-text("图片生成")' },
      { action: 'waitFor', selector: 'button.filter-chip.active:has-text("图片生成")' },
      { action: 'click', selector: '.view-mode-tab:nth-child(1)' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '恢复已配置服务商视图' },
    ],
  },

  // 视频创作：切换真实视图和快速渲染配置后回到流水线列表。
  {
    name: 'create-quick-view-roundtrip', route: '/create', baseline: 'create-editor',
    steps: [
      { action: 'waitFor', selector: '.view-tabs' },
      { action: 'click', selector: '.view-tab:nth-child(2)' },
      { action: 'waitFor', selector: '.quick-render' },
      { action: 'click', selector: '.view-tab:nth-child(1)' },
      { action: 'waitFor', selector: '.view-tab:nth-child(1).active' },
      { action: 'click', selector: '.page-header h1' },
      { action: 'screenshot', name: '恢复流水线创作视图' },
    ],
  },
  {
    name: 'create-history-view-roundtrip', route: '/create', baseline: 'create-editor',
    steps: [
      { action: 'waitFor', selector: '.view-tabs' },
      { action: 'click', selector: '.view-tab:nth-child(3)' },
      { action: 'waitFor', selector: '.view-tab:nth-child(3).active' },
      { action: 'click', selector: '.view-tab:nth-child(1)' },
      { action: 'waitFor', selector: '.view-tab:nth-child(1).active' },
      { action: 'click', selector: '.page-header h1' },
      { action: 'screenshot', name: '恢复流水线创作视图' },
    ],
  },
  {
    name: 'create-gallery-mode-roundtrip', route: '/create', baseline: 'create-editor',
    steps: [
      { action: 'waitFor', selector: '.view-tabs' },
      { action: 'click', selector: '.view-tab:nth-child(2)' },
      { action: 'waitFor', selector: '.quick-render' },
      { action: 'click', selector: '.mode-tab:nth-child(2)' },
      { action: 'waitFor', selector: '.mode-tab:nth-child(2).active' },
      { action: 'click', selector: '.view-tab:nth-child(1)' },
      { action: 'click', selector: '.page-header h1' },
      { action: 'screenshot', name: '恢复流水线创作视图' },
    ],
  },
  {
    name: 'create-quick-text-reset', route: '/create', baseline: 'create-editor',
    steps: [
      { action: 'waitFor', selector: '.view-tabs' },
      { action: 'click', selector: '.view-tab:nth-child(2)' },
      { action: 'waitFor', selector: '.view-tab:nth-child(2).active' },
      { action: 'click', selector: '.mode-tab:nth-child(1)' },
      { action: 'waitFor', selector: '.mode-tab:nth-child(1).active' },
      { action: 'waitFor', selector: 'textarea[placeholder="输入视频文案，每行一个场景..."]' },
      { action: 'fill', selector: 'textarea[placeholder="输入视频文案，每行一个场景..."]', value: '第一幕\n第二幕' },
      { action: 'fill', selector: 'textarea[placeholder="输入视频文案，每行一个场景..."]', value: '' },
      { action: 'click', selector: '.view-tab:nth-child(1)' },
      { action: 'waitFor', selector: '.view-tab:nth-child(1).active' },
      { action: 'click', selector: '.page-header h1' },
      { action: 'screenshot', name: '清空文案并恢复流水线视图' },
    ],
  },
  {
    name: 'create-output-profile-reset', route: '/create', baseline: 'create-editor',
    steps: [
      { action: 'waitFor', selector: '.view-tabs' },
      { action: 'click', selector: '.view-tab:nth-child(2)' },
      { action: 'waitFor', selector: '.quick-render .form-group:has-text("输出平台") select.ui-select' },
      { action: 'select', selector: '.quick-render .form-group:has-text("输出平台") select.ui-select', value: 'tiktok' },
      { action: 'select', selector: '.quick-render .form-group:has-text("输出平台") select.ui-select', value: 'youtube-landscape' },
      { action: 'click', selector: '.view-tab:nth-child(1)' },
      { action: 'click', selector: '.page-header h1' },
      { action: 'screenshot', name: '恢复默认输出规格和流水线视图' },
    ],
  },

  // 云端发布：表单编辑和标签增删完成后恢复空表单。
  {
    name: 'cloud-publish-video-url-reset', route: '/cloud-publish', baseline: 'cloud-publish',
    steps: [
      { action: 'waitFor', selector: 'input[placeholder="https://storage.example.com/videos/xxx.mp4"]' },
      { action: 'fill', selector: 'input[placeholder="https://storage.example.com/videos/xxx.mp4"]', value: 'https://example.com/video.mp4' },
      { action: 'fill', selector: 'input[placeholder="https://storage.example.com/videos/xxx.mp4"]', value: '' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '清空视频地址后的云发布表单' },
    ],
  },
  {
    name: 'cloud-publish-title-reset', route: '/cloud-publish', baseline: 'cloud-publish',
    steps: [
      { action: 'waitFor', selector: 'input[placeholder="视频标题"]' },
      { action: 'fill', selector: 'input[placeholder="视频标题"]', value: '云端发布测试' },
      { action: 'fill', selector: 'input[placeholder="视频标题"]', value: '' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '清空标题后的云发布表单' },
    ],
  },
  {
    name: 'cloud-publish-tag-add-remove', route: '/cloud-publish', baseline: 'cloud-publish',
    steps: [
      { action: 'waitFor', selector: 'input[placeholder="标签（逗号分隔）"]' },
      { action: 'fill', selector: 'input[placeholder="标签（逗号分隔）"]', value: '视觉回归' },
      { action: 'press', key: 'Enter' },
      { action: 'waitFor', selector: 'span.cohere-tag-info:has-text("视觉回归")' },
      { action: 'click', selector: 'span.cohere-tag-info:has-text("视觉回归")' },
      { action: 'waitForSelector', selector: 'span.cohere-tag-info:has-text("视觉回归")', state: 'hidden' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '移除临时标签后的云发布表单' },
    ],
  },

  // 内容情报：清空查询并验证真实数据源勾选可逆。
  {
    name: 'intelligence-query-clear', route: '/intelligence', baseline: 'intelligence',
    steps: [
      { action: 'waitFor', selector: 'input[placeholder="输入关键词，搜索各平台的高互动内容..."]' },
      { action: 'fill', selector: 'input[placeholder="输入关键词，搜索各平台的高互动内容..."]', value: 'AI 视频' },
      { action: 'click', selector: 'button[title="清空"]' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '清空搜索后的内容情报页' },
    ],
  },
  {
    name: 'intelligence-first-source-toggle', route: '/intelligence', baseline: 'intelligence',
    steps: [
      { action: 'waitFor', selector: '.cohere-content .cohere-card label:nth-of-type(1) input[type="checkbox"]' },
      { action: 'click', selector: '.cohere-content .cohere-card label:nth-of-type(1) input[type="checkbox"]' },
      { action: 'click', selector: '.cohere-content .cohere-card label:nth-of-type(1) input[type="checkbox"]' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '恢复第一个情报数据源' },
    ],
  },
  {
    name: 'intelligence-third-source-toggle', route: '/intelligence', baseline: 'intelligence',
    steps: [
      { action: 'waitFor', selector: '.cohere-content .cohere-card label:nth-of-type(3) input[type="checkbox"]' },
      { action: 'click', selector: '.cohere-content .cohere-card label:nth-of-type(3) input[type="checkbox"]' },
      { action: 'click', selector: '.cohere-content .cohere-card label:nth-of-type(3) input[type="checkbox"]' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '恢复第三个情报数据源' },
    ],
  },

  // 数据看板、日历、爆款分析和关键词监测的可逆主流程。
  {
    name: 'dashboard-benchmark-title-reset', route: '/dashboard', baseline: 'dashboard',
    steps: [
      { action: 'waitFor', selector: 'input[placeholder="输入文章标题进行基准比较..."]' },
      { action: 'fill', selector: 'input[placeholder="输入文章标题进行基准比较..."]', value: '短视频增长方法' },
      { action: 'fill', selector: 'input[placeholder="输入文章标题进行基准比较..."]', value: '' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '清空基准标题后的数据看板' },
    ],
  },
  {
    name: 'calendar-next-previous-month', route: '/calendar', baseline: 'calendar',
    steps: [
      { action: 'waitFor', selector: '.cohere-page-header button' },
      { action: 'click', selector: '.cohere-page-header button:nth-of-type(2)' },
      { action: 'click', selector: '.cohere-page-header button:nth-of-type(1)' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '返回当前月份的发布日历' },
    ],
  },
  {
    name: 'viral-topic-reset', route: '/viral-analysis', baseline: 'viral-analysis',
    steps: [
      { action: 'waitFor', selector: 'input[placeholder="输入你想分析的主题，如「AI工具推荐」"]' },
      { action: 'fill', selector: 'input[placeholder="输入你想分析的主题，如「AI工具推荐」"]', value: 'AI 工具推荐' },
      { action: 'fill', selector: 'input[placeholder="输入你想分析的主题，如「AI工具推荐」"]', value: '' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '清空主题后的爆款分析页' },
    ],
  },
  {
    name: 'viral-platform-reset', route: '/viral-analysis', baseline: 'viral-analysis',
    steps: [
      { action: 'waitFor', selector: '.cohere-content select.cohere-input' },
      { action: 'select', selector: '.cohere-content select.cohere-input', value: '小红书' },
      { action: 'select', selector: '.cohere-content select.cohere-input', value: '通用' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '恢复通用平台的爆款分析页' },
    ],
  },
  {
    name: 'keyword-monitor-input-reset', route: '/keywords', baseline: 'keyword-monitor',
    steps: [
      { action: 'waitFor', selector: 'input[placeholder="输入监测关键词"]' },
      { action: 'fill', selector: 'input[placeholder="输入监测关键词"]', value: '品牌口碑' },
      { action: 'fill', selector: 'input[placeholder="输入监测关键词"]', value: '' },
      { action: 'click', selector: '.page-title' },
      { action: 'screenshot', name: '清空输入后的关键词监测页' },
    ],
  },
];

function extractRoutePaths(routerSource) {
  return Array.from(routerSource.matchAll(/\bpath\s*:\s*['"]([^'"]+)['"]/g), match => match[1]);
}

function extractSourceTestIds(sourceText) {
  return new Set(Array.from(
    sourceText.matchAll(/\bdata-testid\s*=\s*['"]([^'"]+)['"]/g),
    match => match[1],
  ));
}

function extractSelectorTestIds(selector) {
  if (typeof selector !== 'string') return [];
  return Array.from(
    selector.matchAll(/\[data-testid\s*=\s*['"]?([^\]'"\s]+)['"]?\]/g),
    match => match[1],
  );
}

function readSourceText(rootDir = SOURCE_ROOT) {
  const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue']);
  const stack = [rootDir];
  const contents = [];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (extensions.has(path.extname(entry.name))) {
        contents.push(fs.readFileSync(fullPath, 'utf8'));
      }
    }
  }

  return contents.join('\n');
}

function routeMatches(pattern, route) {
  const patternParts = pattern.split('/').filter(Boolean);
  const routeParts = route.split(/[?#]/)[0].split('/').filter(Boolean);
  return patternParts.length === routeParts.length && patternParts.every((part, index) => (
    part.startsWith(':') || part === routeParts[index]
  ));
}

function safeImageName(value) {
  const raw = String(value || '').replace(/\.png$/i, '');
  if (!raw || path.basename(raw) !== raw || !/^[a-zA-Z0-9._-]+$/.test(raw)) {
    throw new Error(`非法截图名称: ${value}`);
  }
  return raw;
}

function getScreenshotSteps(workflow) {
  return Array.isArray(workflow.steps)
    ? workflow.steps.filter(step => step && step.action === 'screenshot')
    : [];
}

function resolveBaselineName(workflow, step, screenshotIndex) {
  const screenshotCount = getScreenshotSteps(workflow).length;
  const configuredName = step.baseline || workflow.baseline || workflow.name;
  const baseName = safeImageName(configuredName);
  return screenshotCount > 1 && !step.baseline
    ? `${baseName}--step-${screenshotIndex + 1}`
    : baseName;
}

function resolveThreshold(workflow, step) {
  return step.verify?.threshold ?? workflow.verify?.threshold ?? DEFAULT_PIXEL_THRESHOLD;
}

function prepareValidationOptions(options = {}) {
  const routePaths = options.routePaths || extractRoutePaths(fs.readFileSync(ROUTER_FILE, 'utf8'));
  const sourceText = Object.prototype.hasOwnProperty.call(options, 'sourceText')
    ? options.sourceText
    : readSourceText();

  return {
    ...options,
    routePaths,
    sourceTestIds: options.sourceTestIds || extractSourceTestIds(sourceText),
    baselineDir: options.baselineDir || DEFAULT_BASELINE_DIR,
    baselineExists: options.baselineExists || fs.existsSync,
  };
}

function validateWorkflowDefinition(workflow, options = {}) {
  const validation = options.sourceTestIds ? options : prepareValidationOptions(options);
  const errors = [];
  const addError = (code, message) => errors.push({ code, message });

  if (!workflow || typeof workflow !== 'object') {
    return [{ code: 'WORKFLOW_REQUIRED', message: '工作流定义必须是对象' }];
  }

  if (!workflow.name || typeof workflow.name !== 'string') {
    addError('NAME_REQUIRED', '工作流缺少有效名称');
  }
  if (!workflow.route || typeof workflow.route !== 'string') {
    addError('ROUTE_REQUIRED', `${workflow.name || '未命名工作流'} 缺少路由`);
  } else if (!validation.routePaths.some(route => routeMatches(route, workflow.route))) {
    addError('ROUTE_NOT_FOUND', `${workflow.name} 引用了未声明路由 ${workflow.route}`);
  }

  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    addError('STEPS_REQUIRED', `${workflow.name || '未命名工作流'} 没有可执行步骤`);
  }

  const screenshotSteps = getScreenshotSteps(workflow);
  if (screenshotSteps.length === 0) {
    addError('SCREENSHOT_REQUIRED', `${workflow.name || '未命名工作流'} 没有截图步骤`);
  }

  for (const [index, step] of (workflow.steps || []).entries()) {
    if (!step || !SUPPORTED_ACTIONS.has(step.action)) {
      addError('UNKNOWN_ACTION', `${workflow.name} 第 ${index + 1} 步使用未知动作 ${step?.action}`);
      continue;
    }
    if (SELECTOR_ACTIONS.has(step.action) && (!step.selector || typeof step.selector !== 'string')) {
      addError('SELECTOR_REQUIRED', `${workflow.name} 第 ${index + 1} 步缺少 selector`);
    }
    for (const testId of extractSelectorTestIds(step.selector)) {
      if (!validation.sourceTestIds.has(testId)) {
        addError('TESTID_NOT_FOUND', `${workflow.name} 引用了源码中不存在的 data-testid=${testId}`);
      }
    }
  }

  const verifyMethod = workflow.verify?.method || 'pixel';
  if (verifyMethod !== 'pixel') {
    addError('VERIFY_METHOD_UNSUPPORTED', `${workflow.name} 使用不支持的视觉验证方法 ${verifyMethod}`);
  }

  for (const [screenshotIndex, step] of screenshotSteps.entries()) {
    const threshold = resolveThreshold(workflow, step);
    if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      addError('THRESHOLD_INVALID', `${workflow.name} 的像素阈值必须在 0 到 1 之间`);
    }

    try {
      const baselinePath = path.join(
        validation.baselineDir,
        `${resolveBaselineName(workflow, step, screenshotIndex)}.png`,
      );
      if (!validation.baselineExists(baselinePath)) {
        addError('BASELINE_NOT_FOUND', `${workflow.name} 缺少人工审核基线 ${baselinePath}`);
      }
    } catch (error) {
      addError('BASELINE_NAME_INVALID', `${workflow.name} 的基线配置无效: ${error.message}`);
    }
  }

  return errors;
}

async function captureWorkflowScreenshot(runner, workflow, step, screenshotIndex, options = {}) {
  const baselineDir = options.baselineDir || DEFAULT_BASELINE_DIR;
  const screenshotDir = options.screenshotDir || DEFAULT_SCREENSHOT_DIR;
  const baselineExists = options.baselineExists || fs.existsSync;
  const ensureDir = options.ensureDir || (dir => fs.mkdirSync(dir, { recursive: true }));
  const comparisonName = `${safeImageName(workflow.name)}--step-${screenshotIndex + 1}`;
  const currentPath = path.join(screenshotDir, `${comparisonName}-current.png`);
  const baselinePath = path.join(
    baselineDir,
    `${resolveBaselineName(workflow, step, screenshotIndex)}.png`,
  );
  const threshold = resolveThreshold(workflow, step);

  ensureDir(screenshotDir);
  await runner.settleForCapture();
  await runner.page.screenshot({ path: currentPath, fullPage: true });

  if (!baselineExists(baselinePath)) {
    return {
      status: 'FAILED',
      reason: `缺少人工审核基线 ${baselinePath}`,
      baselinePath,
      currentPath,
      threshold,
    };
  }
  if (!runner.pixelDiff || typeof runner.pixelDiff.compare !== 'function') {
    return {
      status: 'FAILED',
      reason: '像素比较器不可用',
      baselinePath,
      currentPath,
      threshold,
    };
  }

  const comparison = await runner.pixelDiff.compare(baselinePath, currentPath, comparisonName);
  if (comparison.skipped) {
    try {
      const identical = fs.readFileSync(baselinePath).equals(fs.readFileSync(currentPath));
      return {
        status: identical ? 'PASSED' : 'FAILED',
        reason: identical
          ? undefined
          : `像素比较不可用且严格图像断言发现差异: ${comparison.reason || '未知原因'}`,
        baselinePath,
        currentPath,
        threshold,
        comparisonMethod: 'binary-exact',
        misMatchPercentage: identical ? 0 : 100,
      };
    } catch (error) {
      return {
        status: 'FAILED',
        reason: `像素比较不可用且严格图像断言失败: ${error.message}`,
        baselinePath,
        currentPath,
        threshold,
        comparisonMethod: 'binary-exact',
      };
    }
  }

  const misMatchPercentage = Number(
    comparison.rawMisMatchPercentage ?? comparison.misMatchPercentage,
  );
  if (!Number.isFinite(misMatchPercentage)) {
    return {
      status: 'FAILED',
      reason: '像素比较未返回有效差异百分比',
      baselinePath,
      currentPath,
      threshold,
      diffPath: comparison.diffImagePath,
    };
  }

  const passed = misMatchPercentage <= threshold * 100;
  return {
    status: passed ? 'PASSED' : 'FAILED',
    reason: passed
      ? undefined
      : `视觉差异 ${misMatchPercentage}% 超过阈值 ${threshold * 100}%`,
    baselinePath,
    currentPath,
    diffPath: comparison.diffImagePath,
    threshold,
    misMatchPercentage,
  };
}

function createWorkflowError(message, screenshots) {
  const error = new Error(message);
  error.screenshots = screenshots;
  return error;
}

async function executeWorkflow(runner, workflow, options = {}) {
  const baseUrl = options.baseUrl || runner.url || 'http://127.0.0.1:5174';
  const screenshots = [];
  let screenshotIndex = 0;

  await runner.page.goto(buildWorkflowUrl(baseUrl, workflow.route), {
    waitUntil: 'domcontentloaded',
    timeout: 10000,
  });
  if (workflow.setup) await workflow.setup(runner.page);

  for (const step of workflow.steps) {
    const stepResult = await executeStep(runner.page, step, {
      captureScreenshot: () => captureWorkflowScreenshot(
        runner,
        workflow,
        step,
        screenshotIndex,
        options,
      ),
    });
    if (step.action === 'screenshot') {
      screenshotIndex += 1;
      screenshots.push(stepResult);
      if (stepResult.status !== 'PASSED') {
        throw createWorkflowError(stepResult.reason, screenshots);
      }
    }
  }

  return { test: workflow.name, status: 'PASSED', screenshots };
}

async function runWorkflowSuite(tests, options = {}) {
  const silent = options.silent === true;
  const log = (...args) => { if (!silent) console.log(...args); };
  const validationOptions = prepareValidationOptions(options.validationOptions);
  const results = [];
  const runnableTests = [];
  const seenNames = new Set();

  for (const test of tests) {
    const errors = validateWorkflowDefinition(test, validationOptions);
    if (seenNames.has(test.name)) {
      errors.push({ code: 'DUPLICATE_NAME', message: `工作流名称重复: ${test.name}` });
    }
    seenNames.add(test.name);

    if (errors.length > 0) {
      const error = errors.map(item => `[${item.code}] ${item.message}`).join('; ');
      results.push({ test: test.name, status: 'FAILED', error, contractErrors: errors });
      log(`   ❌ ${test.name}: ${error}`);
    } else {
      runnableTests.push(test);
    }
  }

  let runner = null;
  // 浏览器起不来时本套件不抛错（既有契约），而是把每条用例回填成 FAILED；
  // 那是"一条结论都没有"而不是"31 条全红"，必须显式告诉聚合器，否则 aborted 与 failed 会被混同。
  let runnerLaunchFailed = false;
  if (runnableTests.length > 0) {
    runner = options.runner || (options.runnerFactory
      ? options.runnerFactory()
      : new VisualTestRunner());

    try {
      await runner.launch();
      for (const test of runnableTests) {
        log(`📋 测试: ${test.name}`);
        try {
          results.push(await executeWorkflow(runner, test, {
            ...options.executionOptions,
            baselineDir: validationOptions.baselineDir,
            baselineExists: validationOptions.baselineExists,
          }));
        } catch (error) {
          results.push({
            test: test.name,
            status: 'FAILED',
            error: error.message,
            screenshots: error.screenshots || [],
          });
          log(`   ❌ ${error.message.split('\n')[0]}`);
        }
      }
    } catch (error) {
      runnerLaunchFailed = true;
      for (const test of runnableTests) {
        if (!results.some(result => result.test === test.name)) {
          results.push({ test: test.name, status: 'FAILED', error: `视觉运行器启动失败: ${error.message}` });
        }
      }
    } finally {
      if (runner && typeof runner.close === 'function') await runner.close();
    }
  }

  const failed = results.filter(result => result.status === 'FAILED').length;
  log(`\n工作流结果: ${results.length - failed}/${results.length} 通过，${failed} 失败\n`);
  return { results, failed, runnerLaunchFailed };
}

async function runAllWorkflowTests() {
  console.log(`🔄 开始 ${workflowTests.length} 个工作流视觉测试...\n`);
  return runWorkflowSuite(workflowTests);
}

async function executeStep(page, step, context = {}) {
  switch (step.action) {
    case 'click':
      await page.click(step.selector, { timeout: STEP_TIMEOUT });
      if (step.name) console.log(`   → ${step.name}`);
      break;
    case 'fill':
      await page.fill(step.selector, step.value, { timeout: STEP_TIMEOUT });
      break;
    case 'waitFor':
      await page.waitForSelector(step.selector, { timeout: STEP_TIMEOUT });
      break;
    case 'waitForSelector':
      await page.waitForSelector(step.selector, {
        state: step.state || 'visible',
        timeout: STEP_TIMEOUT,
      });
      break;
    case 'screenshot':
      if (typeof context.captureScreenshot !== 'function') {
        throw new Error('截图步骤缺少视觉验证上下文');
      }
      return context.captureScreenshot();
    case 'press':
      await page.keyboard.press(step.key);
      break;
    case 'select':
      await page.selectOption(step.selector, step.value, { timeout: STEP_TIMEOUT });
      break;
    case 'setInputFiles':
      await page.setInputFiles(step.selector, step.files);
      break;
    case 'selectDate':
      await page.keyboard.type(step.value);
      break;
    case 'dragAndDrop':
      await page.setInputFiles(step.selector, step.files);
      break;
    default:
      throw new Error(`不支持的工作流动作: ${step.action}`);
  }
  
}
// CLI 入口（仅当直接调用此文件时执行，被 require() 时不触发副作用）
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--single' && args[1]) {
    runSingleWorkflow(args[1]).then(result => {
      process.exitCode = result && result.failed ? 1 : 0;
    }).catch(err => {
      console.error(err);
      process.exitCode = 1;
    });
  } else if (args[0] === '--list') {
    console.log('可用的工作流测试:');
    workflowTests.forEach(w => console.log(`  - ${w.name}`));
  } else {
    runAllWorkflowTests().then(result => {
      process.exitCode = result.failed > 0 ? 1 : 0;
    }).catch(err => {
      console.error(err);
      process.exitCode = 1;
    });
  }
}

// 单独测试某个工作流
async function runSingleWorkflow(workflowName) {
  const test = workflowTests.find(w => w.name === workflowName);
  if (!test) {
    console.log(`❌ 未找到工作流: ${workflowName}`);
    console.log('可用工作流:', workflowTests.map(w => w.name).join(', '));
    return { failed: 1 };
  }

  return runWorkflowSuite([test]);
}

module.exports = {
  workflowTests,
  buildWorkflowUrl,
  captureWorkflowScreenshot,
  executeStep,
  executeWorkflow,
  extractRoutePaths,
  extractSelectorTestIds,
  extractSourceTestIds,
  runAllWorkflowTests,
  runSingleWorkflow,
  runWorkflowSuite,
  validateWorkflowDefinition,
};
