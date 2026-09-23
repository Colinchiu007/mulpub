const { FunctionalRunner } = require('./functional-runner');

const SUITE_OPTIONS = { initPro: true };
const CONDITION_TIMEOUT = 5000;
const FEATURE_READY_TIMEOUT = 15000;

function record(r, name, passed, details) {
  r.checks.push({ kind: 'functional', name, passed: Boolean(passed), details: details || null });
  if (!passed) console.log('  ✗', name, details || '');
  else console.log('  ✓', name);
  return Boolean(passed);
}

function isTimeoutError(error) {
  return error && (error.name === 'TimeoutError' || /timeout/i.test(error.message || ''));
}

async function waitForVisible(locator, timeout = CONDITION_TIMEOUT) {
  const target = typeof locator.first === 'function' ? locator.first() : locator;
  if (typeof target.waitFor === 'function') {
    try {
      await target.waitFor({ state: 'visible', timeout });
      return true;
    } catch (error) {
      if (isTimeoutError(error)) return false;
      throw error;
    }
  }
  return (typeof target.count !== 'function' || await target.count() > 0)
    && (typeof target.isVisible !== 'function' || await target.isVisible());
}

async function waitForHidden(locator, timeout = CONDITION_TIMEOUT) {
  const target = typeof locator.first === 'function' ? locator.first() : locator;
  if (typeof target.waitFor === 'function') {
    try {
      await target.waitFor({ state: 'hidden', timeout });
      return true;
    } catch (error) {
      if (isTimeoutError(error)) return false;
      throw error;
    }
  }
  return typeof target.isVisible !== 'function' || !(await target.isVisible());
}

async function waitForPageCondition(r, predicate, argument, timeout = CONDITION_TIMEOUT) {
  if (typeof r.page.waitForFunction !== 'function') {
    return Boolean(await r.page.evaluate(predicate, argument));
  }
  try {
    const handle = await r.page.waitForFunction(predicate, argument, { timeout });
    if (handle && typeof handle.dispose === 'function') await handle.dispose();
    return true;
  } catch (error) {
    if (isTimeoutError(error)) return false;
    throw error;
  }
}

async function bodyHas(r, text, timeout = CONDITION_TIMEOUT) {
  const body = r.page.locator('body');
  if (typeof body.filter === 'function') {
    return waitForVisible(body.filter({ hasText: text }), timeout);
  }
  return body.innerText().then((value) => value.includes(text));
}

async function clickText(r, text, options = {}) {
  const selector = options.selector || `.cohere-main button:has-text("${text}"), .fullscreen-main button:has-text("${text}"), .cohere-main [role="button"]:has-text("${text}"), .fullscreen-main [role="button"]:has-text("${text}"), .cohere-main uibutton:has-text("${text}"), .fullscreen-main uibutton:has-text("${text}"), .cohere-main uibutton[title="${text}"], .fullscreen-main uibutton[title="${text}"]`;
  const locator = r.page.locator(selector).first();
  if (!(await waitForVisible(locator, options.timeout || 3000))) return false;
  await locator.click({ timeout: 3000 });
  return true;
}

async function fillByPlaceholder(r, placeholder, value) {
  const locator = r.page.locator(`.cohere-main input[placeholder*="${placeholder}"], .cohere-main textarea[placeholder*="${placeholder}"]`).first();
  if (!(await waitForVisible(locator))) return false;
  await locator.fill(value);
  return true;
}

async function waitForPublishReady(r, timeout = FEATURE_READY_TIMEOUT) {
  return waitForPageCondition(r, (selectors) => selectors.every((selector) => {
    const element = document.querySelector(selector);
    return element && element.getClientRects().length > 0;
  }), [
    '[data-testid="publish-title"] input',
    '[data-testid="publish-editor"]',
    '[data-testid="publish-target-selector"]',
    '[data-testid="publish-submit"]',
  ], timeout);
}

async function fillPublishTitle(r, value) {
  const locator = r.page.locator('[data-testid="publish-title"] input').first();
  if (!(await waitForVisible(locator, FEATURE_READY_TIMEOUT))) return false;
  await locator.fill(value);
  return true;
}

async function fillPublishBody(page, value) {
  const editor = page.locator(
    '[data-testid="publish-editor"] .ql-editor[contenteditable="true"], [data-testid="publish-editor"] textarea.md-editor, .cohere-main .ql-editor[contenteditable="true"], .cohere-main textarea.md-editor',
  ).first();
  if (!(await waitForVisible(editor))) return false;
  await editor.fill(value);
  const actualValue = await editor.evaluate((element) => (
    'value' in element ? element.value : element.textContent
  ));
  return String(actualValue || '').includes(value);
}

async function selectFirstUsable(r, selector = '.cohere-main select') {
  const locator = r.page.locator(selector).first();
  if (!(await waitForVisible(locator))) return false;
  const values = await locator.locator('option').evaluateAll((options) => options.map((o) => o.value).filter(Boolean));
  if (!values.length) return false;
  await locator.selectOption(values[0]);
  return true;
}

async function expectIpc(r, method, name) {
  if (typeof r.page.waitForFunction === 'function') {
    await waitForPageCondition(r, (expectedMethod) => (
      window.__ipcCallsByMethod?.[expectedMethod] || 0
    ) > 0, method);
  }
  const count = await r.getIpcCalls(method);
  return record(r, name || `IPC ${method} 被调用`, count > 0, { method, count });
}

async function exerciseHome(r) {
  // 首页已复刻为参考产品风格 .mp-home 布局，旧版 .cohere-main 选择器已不存在。
  const cards = r.page.locator('.mp-home .mp-home-shortcut');
  record(r, '首页显示功能入口', await cards.count() > 0, { count: await cards.count() });
  await expectIpc(r, 'dashboardStats', '首页加载发布统计（与数据看板同源 publish-history）');
  await expectIpc(r, 'listAccounts', '首页加载账号（与账号页同源 AccountManager）');
  await expectIpc(r, 'historyList', '首页加载近期动态');
}

async function exerciseComments(r) {
  const item = r.page.locator('.comment-platform-item').first();
  record(r, '评论平台列表有数据', await item.count() > 0);
  if (await item.count()) {
    await item.click();
    record(r, '选择平台后显示标签栏引导', await bodyHas(r, '顶部标签栏'));
    await expectIpc(r, 'pageManagerCreateNewTabPage', '选择平台在全局标签栏打开评论页');
  }
}

async function exerciseFirstRun(r) {
  record(r, '首次运行从欢迎步骤开始', await bodyHas(r, '欢迎使用社媒管家'));
  // 验证 firstRunCheck 被调用
  await expectIpc(r, 'firstRunCheck', '首次运行检查环境');
  // 验证下一步可点击：点击 “开始配置” 进入环境步骤
  const clicked = await clickText(r, '开始配置');
  if (clicked) {
    record(r, '开始配置进入环境步骤', await bodyHas(r, '环境'));
  } else {
    record(r, '开始配置进入环境步骤', false);
  }
}

async function exercisePublish(r) {
  // initPro 已在 FunctionalRunner 构造时通过 addInitScript 注入，页面首次加载即为 Pro
  await waitForPublishReady(r);
  record(r, '标题字段可填写', await fillPublishTitle(r, 'E2E 发布标题'));
  record(r, '正文字段可填写', await fillPublishBody(r.page, 'E2E 发布正文内容'));
  const platform = r.page.locator('.cohere-main [data-testid="platform-weibo"]').first();
  if (await waitForVisible(platform, FEATURE_READY_TIMEOUT)) await platform.click();
  const batch = r.page.locator('[data-testid="publish-batch-mode"]').first();
  if (await batch.count()) {
    await batch.click();
    record(r, '批量模式显示添加文章', await bodyHas(r, '添加文章'));
    await batch.click();
  }
  const publishClicked = await clickText(r, '一键发布', { selector: '[data-testid="publish-submit"]', timeout: FEATURE_READY_TIMEOUT });
  record(r, '一键发布按钮可点击', publishClicked);
}

async function exerciseAccounts(r) {
  const expectedAccountCount = await r.page.evaluate(() => window.__fixtures?.accounts?.accounts?.length || 0);
  const accountsReady = expectedAccountCount > 0 && await waitForPageCondition(
    r,
    (expected) => document.querySelectorAll('.account-row').length === expected,
    expectedAccountCount,
  );
  const accountCount = await r.page.locator('.account-row').count();
  record(r, '账号 fixture 渲染', accountsReady, { count: accountCount, expected: expectedAccountCount });
  const filters = r.page.locator('.filter-tabs button[role="tab"]');
  for (let i = 0; i < await filters.count(); i++) await filters.nth(i).click();
  record(r, '账号状态筛选均可点击', await filters.count() >= 3);
  const add = await clickText(r, '添加账号', { selector: '[data-testid="account-add"]', timeout: FEATURE_READY_TIMEOUT });
  if (add) {
    const modal = r.page.locator('.ui-modal, .el-dialog').first();
    const modalShown = await waitForVisible(modal, FEATURE_READY_TIMEOUT);
    record(r, '添加账号打开弹窗', modalShown);
    // 关闭弹窗
    const closeButton = r.page.locator('.ui-modal-close').first();
    if (await waitForVisible(closeButton, 1000)) await closeButton.click();
    else await r.page.keyboard.press('Escape');
    record(r, '添加账号弹窗可关闭', await waitForHidden(modal));
  } else {
    record(r, '添加账号打开弹窗', false);
  }
  await r.goto('/accounts');
  const allFilter = r.page.locator('.filter-tabs button[role="tab"]:has-text("全部")').first();
  if (await allFilter.count() > 0) await allFilter.click();
  // 寻找 “验证” 按钮（不依赖具体位置）
  const verifyBtn = r.page.locator('.account-row [data-testid^="verify-"]').first();
  let verify = false;
  if (await waitForVisible(verifyBtn, FEATURE_READY_TIMEOUT)) {
    await verifyBtn.click({ timeout: 3000 });
    verify = true;
  }
  record(r, '账号登录验证可执行', verify);
  if (verify) await expectIpc(r, 'accountCheckLogin', '账号验证调用 IPC');
}

async function exerciseDashboard(r) {
  // syncCached 是异步加载，等待真实平台卡片出现后再断言，避免把加载窗口误报为功能失败。
  const platformCards = r.page.locator('.cohere-content > .cohere-card-grid .cohere-card');
  const cardsReady = await waitForVisible(platformCards.first());
  const cardCount = await platformCards.count();
  record(r, '平台数据卡片渲染', cardsReady && cardCount >= 2, { count: cardCount, ready: cardsReady });
  const refreshed = await clickText(r, '刷新数据');
  record(r, '刷新数据可执行', refreshed);
  if (refreshed) await expectIpc(r, 'syncAll', '刷新调用全平台同步');
  // 基准比较：填入标题并点分析，验证 BenchmarkChart 被渲染
  await fillByPlaceholder(r, '基准', 'E2E 基准文章');
  const analyzeClicked = await clickText(r, '分析');
  const chartRendered = await waitForVisible(r.page.locator('.cohere-main [class*="cohere-card"]:has-text("内容基准比较")'));
  record(r, '基准比较组件渲染', analyzeClicked && chartRendered, { analyzeClicked, chartRendered });
  await expectIpc(r, 'intelligenceGetBenchmark', '基准调用 IPC');
  await expectIpc(r, 'dashboardStats', '看板统计加载');
}

async function exerciseCollection(r) {
  record(r, '采集 URL 可填写', await fillByPlaceholder(r, '文章链接', 'https://example.com/e2e'));
  const clicked = await clickText(r, '采集', { selector: '[data-testid="collection-collect-btn"]' });
  record(r, '链接采集可执行', clicked);
  if (clicked) {
    record(r, '采集结果展示标题', await bodyHas(r, '采集的标题'));
    await expectIpc(r, 'urlCollectFetch', '采集调用 IPC');
  }
  record(r, '新建草稿按钮可点击', await clickText(r, '新建草稿'));
}

async function exerciseKeywords(r) {
  record(r, '关键词状态 fixture 渲染', await bodyHas(r, 'AI 创作'));
  await fillByPlaceholder(r, '监测关键词', 'E2E 关键词');
  record(r, '添加关键词可点击', await clickText(r, '添加'));
  await expectIpc(r, 'keywordStart', '添加关键词调用 IPC');
  await r.goto('/keywords');
  record(r, '查看历史可点击', await clickText(r, '查看历史'));
  record(r, '关键词历史渲染', await bodyHas(r, '总提及'));
}

async function exerciseViral(r) {
  await fillByPlaceholder(r, '你想分析的主题', 'AI 内容创作');
  record(r, '爆款分析可执行', await clickText(r, '爆款分析'));
  record(r, '爆款潜力分渲染', await bodyHas(r, '爆款潜力分'));
  await expectIpc(r, 'viralAnalyze', '爆款分析调用 IPC');
  record(r, '生成文案可执行', await clickText(r, '生成文案'));
  record(r, '生成标题结果渲染', await bodyHas(r, '5 个 AI 工具'));
  await expectIpc(r, 'viralGenerate', '文案生成调用 IPC');
}

async function exerciseModelProviders(r) {
  const providerCards = r.page.locator('.provider-card');
  record(r, '模型服务商列表渲染', await waitForVisible(providerCards));
  const allTab = r.page.locator('.view-mode-tab:has-text("全部")').first();
  if (await allTab.count() > 0) await allTab.click();
  const chips = r.page.locator('.cohere-main .filter-chip');
  for (let i = 0; i < await chips.count(); i++) await chips.nth(i).click();
  record(r, '模型类别筛选可点击', await chips.count() >= 5, { count: await chips.count() });
  const added = await clickText(r, '添加服务商');
  const dialog = r.page.locator('.el-dialog').first();
  record(r, '添加服务商弹窗打开', added && await waitForVisible(dialog));
  // 关闭弹窗（el-dialog 的 overlay），避免阻挡后续操作
  if (added) {
    await r.page.keyboard.press('Escape');
    record(r, '添加服务商弹窗可关闭', await waitForHidden(dialog));
  }
  // 导航刷新页面，确保弹窗完全关闭
  await r.goto('/model-providers');
  record(r, '服务商刷新可点击', await clickText(r, '刷新'));
  await expectIpc(r, 'modelProviderList', '服务商列表调用 IPC');
}

// 除图片轮播（story2video-compose）外的其他内置流水线（与 electron/services/pipeline-engine.js 内置列表对齐）
const CAROUSEL_PIPELINE = 'story2video-compose';
const AUTO_PIPELINES = ['animated-explainer', 'framework-smoke', 'documentary-montage', 'animation', 'avatar-spokesperson', 'character-animation', 'hybrid'];
const MEDIA_PIPELINES = ['clip-factory', 'cinematic', 'talking-head', 'localization-dub'];
const LEGACY_PIPELINES = ['podcast-repurpose'];
const UNAVAILABLE_PIPELINES = ['screen-demo'];
const PIPELINE_LABELS = {
  'animated-explainer': 'AI 讲解视频',
  'talking-head': '口播视频',
  cinematic: '电影感短片',
  animation: '动画视频',
  'avatar-spokesperson': '数字人口播',
  'character-animation': '角色动画',
  'clip-factory': '视频切片工厂',
  'documentary-montage': '纪录蒙太奇',
  hybrid: '混合视频',
  'localization-dub': '本地化配音',
  'podcast-repurpose': '播客转视频',
  'framework-smoke': '框架冒烟测试',
  'screen-demo': '屏幕演示',
};

async function selectPipelineByName(r, name) {
  const card = r.page.locator(`.pipeline-card[data-pipeline-id="${name}"]`).first();
  if (!(await waitForVisible(card, FEATURE_READY_TIMEOUT))) return false;
  await card.click();
  return waitForVisible(r.page.locator('.pipeline-detail'), FEATURE_READY_TIMEOUT);
}

async function orchestratedStartCallsFor(r, method) {
  return r.page.evaluate((m) => (window.__ipcCalls || [])
    .filter((c) => c.method === m)
    .map((c) => (c.args && c.args[0]) || null), method);
}

async function assertPipelineStarted(r, name, method) {
  const started = await clickText(r, '启动流水线', { timeout: FEATURE_READY_TIMEOUT });
  if (!started) return false;
  // 单一数据源：直接等待 __ipcCalls 中出现「该 method + 该流水线名」的调用记录，
  // 不依赖 __ipcCallsByMethod 计数与数组两套状态。
  return waitForPageCondition(r, (expected) => (
    (window.__ipcCalls || []).some((c) => c.method === expected.method && (c.args && c.args[0]) === expected.name)
  ), { method, name }, CONDITION_TIMEOUT);
}

async function exerciseCreate(r) {
  record(r, '渲染引擎状态就绪', await bodyHas(r, '渲染引擎就绪').catch(() => false) || !(await bodyHas(r, '依赖未安装')));
  const pipelineCard = r.page.locator(`.pipeline-card[data-pipeline-id="${CAROUSEL_PIPELINE}"]`).first();
  const firstPipelineId = await r.page.locator('.pipeline-card').first().getAttribute('data-pipeline-id').catch(() => null);
  record(r, '故事讲述流水线优先显示', firstPipelineId === CAROUSEL_PIPELINE && await pipelineCard.first().innerText().then(text => /故事讲述|story telling/i.test(text)));
  const cardCount = await r.page.locator('.pipeline-card').count();
  // 16 个内置流水线卡片（14 条来自 pipelineList + CreateView 额外插入 video-clone 与 film-engineering；改动 CreateView 流水线卡片需同步此计数）
  record(r, '全部内置流水线卡片渲染', cardCount === 16, { count: cardCount });

  // 图片轮播（本次排除项）：仅保留既有启动路径回归
  if (await pipelineCard.count()) {
    await pipelineCard.click();
    await fillByPlaceholder(r, '输入视频文案', 'E2E 视频创作文案');
    const started = await clickText(r, '启动流水线');
    record(r, '启动故事讲述流水线可执行', started);
    if (started) await expectIpc(r, 'pipelineStartOrchestrated', '启动流水线调用 IPC');
  }

  // 除图片轮播外的其他流水线：逐条 选择 → 详情渲染 → 输入 → 启动 → IPC 携带正确流水线名
  await r.resetToRoute('/create');
  for (const name of AUTO_PIPELINES) {
    const detailRendered = await selectPipelineByName(r, name) && await waitForVisible(r.page.locator('.pipeline-detail'));
    record(r, `${name} 详情渲染`, detailRendered, { label: PIPELINE_LABELS[name] });
    if (!detailRendered) { await r.resetToRoute('/create'); continue; }
    record(r, `${name} 标题渲染`, await bodyHas(r, PIPELINE_LABELS[name]));
    await fillByPlaceholder(r, '输入视频文案', 'E2E 自动化流水线文案');
    record(r, `${name} 启动携带正确流水线名`, await assertPipelineStarted(r, name, 'pipelineStartOrchestrated'));
    await r.resetToRoute('/create');
  }

  for (const name of MEDIA_PIPELINES) {
    const detailRendered = await selectPipelineByName(r, name) && await waitForVisible(r.page.locator('.pipeline-detail'));
    record(r, `${name} 详情渲染`, detailRendered, { label: PIPELINE_LABELS[name] });
    if (!detailRendered) { await r.resetToRoute('/create'); continue; }
    const videoTab = await clickText(r, '视频素材');
    record(r, `${name} 视频素材标签可用`, videoTab);
    if (!videoTab) { await r.resetToRoute('/create'); continue; }
    const videoInput = r.page.locator('.pipeline-detail input[type="file"][accept^="video"]').first();
    await videoInput.setInputFiles({ name: 'e2e.mp4', mimeType: 'video/mp4', buffer: Buffer.from('e2e-video') });
    const imported = await waitForPageCondition(r, () => document.body.textContent.includes('e2e.mp4'), null, CONDITION_TIMEOUT);
    record(r, `${name} 视频素材导入成功`, imported);
    if (!imported) { await r.resetToRoute('/create'); continue; }
    await fillByPlaceholder(r, '口播文案', 'E2E 口播文案');
    record(r, `${name} 启动携带正确流水线名`, await assertPipelineStarted(r, name, 'pipelineStartOrchestrated'));
    await r.resetToRoute('/create');
  }

  for (const name of LEGACY_PIPELINES) {
    const detailRendered = await selectPipelineByName(r, name) && await waitForVisible(r.page.locator('.pipeline-detail'));
    record(r, `${name} 详情渲染`, detailRendered, { label: PIPELINE_LABELS[name] });
    if (!detailRendered) { await r.resetToRoute('/create'); continue; }
    await fillByPlaceholder(r, '输入视频文案', 'E2E 状态机流水线文案');
    record(r, `${name} 启动携带正确流水线名`, await assertPipelineStarted(r, name, 'pipelineStart'));
    await r.resetToRoute('/create');
  }

  for (const name of UNAVAILABLE_PIPELINES) {
    const detailRendered = await selectPipelineByName(r, name) && await waitForVisible(r.page.locator('.pipeline-detail'));
    record(r, `${name} 详情渲染`, detailRendered, { label: PIPELINE_LABELS[name] });
    if (!detailRendered) { await r.resetToRoute('/create'); continue; }
    record(r, `${name} 不可用提示显示`, await waitForVisible(r.page.locator('[data-testid="pipeline-unavailable-hint"]')));
    // 断言共享启动按钮存在且处于禁用态（不允许用 .catch(() => true) 把定位失败当成通过）
    const startBtn = r.page.locator('[data-testid="start-story2video"]').first();
    const startBtnExists = await startBtn.count() > 0;
    const startDisabled = startBtnExists && await startBtn.isDisabled().catch(() => false);
    record(r, `${name} 启动按钮存在且禁用`, startBtnExists && startDisabled, { exists: startBtnExists, disabled: startDisabled });
    const orchestratedStarts = await orchestratedStartCallsFor(r, 'pipelineStartOrchestrated');
    const legacyStarts = await orchestratedStartCallsFor(r, 'pipelineStart');
    record(r, `${name} 未触发启动 IPC`, !orchestratedStarts.includes(name) && !legacyStarts.includes(name));
    await r.resetToRoute('/create');
  }

  record(r, '快速渲染标签可切换', await clickText(r, '快速渲染'));
  record(r, '历史记录标签可切换', await clickText(r, '历史记录'));
}

async function exerciseResult(r) {
  record(r, '无路径时提供去创作操作', await bodyHas(r, '去创作') || await bodyHas(r, '重新创作'));
  // Hash 模式下使用 hash 内的 query：/#/create/result?path=...
  const resultPath = '/create/result?path=' + encodeURIComponent('C:/mock/e2e.mp4');
  const resultUrl = r.url.replace(/\/$/, '') + '/#' + resultPath;
  await r.page.goto(resultUrl, { waitUntil: 'domcontentloaded' });
  await r.waitForAppReady(resultPath);
  record(r, '结果路径渲染视频或错误状态', await waitForVisible(r.page.locator('.video-player, .empty-state, .video-section')));
  const publish = await clickText(r, '去发布');
  if (publish) record(r, '结果页可跳转发布', (await r.currentRoute()).startsWith('/publish'));
}

async function exercisePipeline(r) {
  // /create/pipeline 已合并到 /create（CreateView.vue），此处仅验证重定向后渲染创作页 + 流水线卡片
  record(r, '流水线卡片渲染阶段', await waitForVisible(r.page.locator('.pipeline-card')));
  record(r, '历史记录可切换', await clickText(r, '历史记录'));
  const completedStatus = r.page.locator('.history-status.completed').filter({ hasText: '已完成' });
  record(r, '流水线历史 fixture 渲染', await waitForVisible(completedStatus));
}

async function exerciseCreateHistory(r) {
  // /create/history 已重定向到 /create?view=history（历史记录标签为唯一入口，旧独立页废弃）
  record(r, '历史记录标签渲染', await r.page.locator('.history-status-tabs').count() > 0);
  record(r, '历史任务卡片渲染', await r.page.locator('.history-item').count() > 0);
  const editableTask = r.page.locator('.history-item-body.is-interactive').first();
  const hasEditableTask = await editableTask.count() > 0;
  let openedEditor = false;
  if (hasEditableTask) {
    await editableTask.click({ timeout: FEATURE_READY_TIMEOUT });
    await r.page.waitForFunction(() => window.location.hash.startsWith('#/create/result?project=e2e-story2video-project'), null, { timeout: FEATURE_READY_TIMEOUT });
    openedEditor = true;
  }
  record(r, '历史任务直达视频任务编辑页', openedEditor);
  if (openedEditor) {
    record(r, '视频任务编辑页显示任务标题', await bodyHas(r, 'E2E 视频任务'));
  }
  await r.resetToRoute('/create?view=history');
  record(r, '历史记录可切换', await clickText(r, '流水线创作'));
  await r.resetToRoute('/create?view=history');
  const failedTab = r.page.locator('.history-status-tab[data-status="failed"]');
  await failedTab.waitFor({ state: 'visible', timeout: FEATURE_READY_TIMEOUT });
  await failedTab.click({ timeout: FEATURE_READY_TIMEOUT });
  const failedTabSelected = await failedTab.evaluate((element) => element.getAttribute('aria-selected') === 'true');
  record(r, '状态标签可切换', failedTabSelected);
}

async function exerciseCloudPublish(r) {
  await fillByPlaceholder(r, 'videos/xxx.mp4', 'https://example.com/e2e.mp4');
  await fillByPlaceholder(r, '视频标题', 'E2E 云发布标题');
  await fillByPlaceholder(r, '视频描述', 'E2E 云发布描述');
  await fillByPlaceholder(r, '标签', 'E2E,云发布');
  await selectFirstUsable(r);
  record(r, '云发布提交可执行', await clickText(r, '提交云端发布'));
  record(r, '云发布返回任务 ID', await bodyHas(r, '任务已创建'));
  await expectIpc(r, 'cloudPublishSubmit', '云发布提交调用 IPC');
  record(r, '云发布记录渲染', await bodyHas(r, 'E2E 云发布记录'));
}

async function exerciseIntelligence(r) {
  await fillByPlaceholder(r, '输入关键词', 'AI 创作');
  record(r, '内容情报搜索可执行', await clickText(r, '搜索'));
  record(r, '跨平台搜索结果渲染', await bodyHas(r, '热门讨论'));
  record(r, '标题分析建议渲染', await bodyHas(r, '标题中加入'));
  await expectIpc(r, 'intelligenceSearch', '情报搜索调用 IPC');
  const reference = await clickText(r, '参考');
  record(r, '搜索结果可作为参考', reference);
  // 关闭 ReferenceFinder 弹窗（UiModal 不支持 ESC，必须点击 .ui-modal-close）
  if (reference) {
    const modal = r.page.locator('.ui-modal').first();
    const closeButton = r.page.locator('.ui-modal-close').first();
    if (await waitForVisible(closeButton)) await closeButton.click({ force: true, timeout: 3000 });
    record(r, '参考内容弹窗可关闭', await waitForHidden(modal));
  }
  record(r, '清空搜索可执行', await clickText(r, '✕'));
}

async function exerciseCalendar(r) {
  const labelBefore = await r.page.locator('.cohere-page-header span').first().textContent().catch(() => '');
  await clickText(r, '▶');
  await waitForPageCondition(r, (previousLabel) => {
    const label = document.querySelector('.cohere-page-header span');
    return label && label.textContent !== previousLabel;
  }, labelBefore);
  const labelAfter = await r.page.locator('.cohere-page-header span').first().textContent().catch(() => '');
  record(r, '日历可切换下个月', labelBefore !== labelAfter, { labelBefore, labelAfter });
  record(r, '日历可回到今天', await clickText(r, '今天'));
  const day = r.page.locator('.cal-day:not(.other-month)').first();
  if (await day.count()) await day.click();
  record(r, '日期格可选择', await waitForVisible(r.page.locator('.cal-day.selected')));
  await expectIpc(r, 'schedulerList', '日历加载排期');
  await expectIpc(r, 'historyList', '日历加载发布历史');
}

const definitions = {
  home: { route: '/', title: '多平台内容一键发布', exercise: exerciseHome },
  comments: { route: '/comments', title: '评论管理', exercise: exerciseComments },
  'first-run': { route: '/first-run', title: '欢迎使用社媒管家', exercise: exerciseFirstRun },
  publish: { route: '/publish', title: '一键发布', exercise: exercisePublish },
  accounts: { route: '/accounts', title: '账号管理', exercise: exerciseAccounts, initialAuditStrategy: 'semantic' },
  dashboard: { route: '/dashboard', title: '数据看板', exercise: exerciseDashboard },
  collection: { route: '/collection', title: '内容采集', exercise: exerciseCollection },
  keywords: { route: '/keywords', title: '关键词监测', exercise: exerciseKeywords },
  'viral-analysis': { route: '/viral-analysis', title: '爆款分析', exercise: exerciseViral },
  'model-providers': { route: '/model-providers', title: '模型服务商设置', exercise: exerciseModelProviders },
  create: { route: '/create', title: '视频创作', exercise: exerciseCreate },
  result: { route: '/create/result', title: '视频预览', exercise: exerciseResult },
  pipeline: { route: '/create/pipeline', redirectExpected: '/create', title: '视频创作', exercise: exercisePipeline },
  'create-history': { route: '/create/history', redirectExpected: '/create?view=history', title: '视频创作', exercise: exerciseCreateHistory },
  'cloud-publish': { route: '/cloud-publish', title: '云端发布', exercise: exerciseCloudPublish },
  intelligence: { route: '/intelligence', title: '内容情报', exercise: exerciseIntelligence },
  calendar: { route: '/calendar', title: '发布日历', exercise: exerciseCalendar }
};

function expectedRouteFor(definition) {
  return definition.redirectExpected || definition.route;
}

async function gotoDefinition(r, definition) {
  const expectedRoute = expectedRouteFor(definition);
  return expectedRoute === definition.route
    ? r.goto(definition.route)
    : r.goto(definition.route, { expectedRoute });
}

async function resetDefinitionRoute(r, definition) {
  if (typeof r.resetToRoute === 'function') {
    return r.resetToRoute(definition.route, { expectedRoute: expectedRouteFor(definition) });
  }
  return gotoDefinition(r, definition);
}

function repeatedAccountTestIdKey(testid) {
  const match = /^(select|favorite|check|proxy)-.+$/.exec(String(testid || ''));
  return match ? `testid:${match[1]}` : `testid:${testid}`;
}

function controlSemanticKey(control) {
  if (control.testid) return repeatedAccountTestIdKey(control.testid);
  const name = String(control.ariaLabel || control.title || control.text || control.index || '').trim();
  return `button:${name}`;
}

function fieldSemanticKey(field) {
  if (field.testid) return repeatedAccountTestIdKey(field.testid);
  const className = String(field.className || '')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join('.');
  if (className) return `field:${field.tag}|${field.type}|class:${className}`;
  return `field:${field.tag}|${field.type}|${field.name || ''}|${field.placeholder || ''}`;
}

function selectInitialAuditSamples(descriptors, keyForDescriptor, strategy) {
  if (strategy !== 'semantic') return { selected: descriptors, suppressed: [] };
  const seen = new Set();
  const selected = [];
  const suppressed = [];
  for (const descriptor of descriptors) {
    const key = keyForDescriptor(descriptor);
    if (seen.has(key)) {
      suppressed.push({ descriptor, key });
      continue;
    }
    seen.add(key);
    selected.push(descriptor);
  }
  return { selected, suppressed };
}

function initialButtonLocator(r, control) {
  return control.testid
    ? r.page.locator(`.cohere-main button[data-testid=${JSON.stringify(control.testid)}]`)
    : r.page.locator('.cohere-main button').nth(control.index);
}

async function clickInitialButton(r, control) {
  const locator = initialButtonLocator(r, control);
  if (!(await waitForVisible(locator, CONDITION_TIMEOUT))) {
    throw new Error(`初始按钮不可见: ${control.testid || control.text || control.index}`);
  }
  if (await locator.isDisabled()) {
    throw new Error(`初始按钮意外变为禁用: ${control.testid || control.text || control.index}`);
  }
  await locator.click({ timeout: CONDITION_TIMEOUT });
}

async function auditInitialControls(r, definition) {
  await resetDefinitionRoute(r, definition);
  const discoveredControls = await r.page.locator('.cohere-main button').evaluateAll((buttons) => {
    const visibleButtons = [];
    buttons.forEach((button, index) => {
      if (button.getClientRects().length === 0 || button.closest('details:not([open])')) return;
      visibleButtons.push({
        index,
        text: (button.textContent || '').trim().slice(0, 60),
        testid: button.getAttribute('data-testid') || '',
        ariaLabel: button.getAttribute('aria-label') || '',
        title: button.getAttribute('title') || '',
        scanMode: button.getAttribute('data-e2e-scan') || '',
        disabled: button.disabled,
      });
    });
    return visibleButtons;
  });
  const automaticControls = discoveredControls.filter((control) => control.scanMode !== 'manual');
  const manualControls = discoveredControls.filter((control) => control.scanMode === 'manual');
  const samples = selectInitialAuditSamples(
    automaticControls,
    controlSemanticKey,
    definition && definition.initialAuditStrategy,
  );
  const controls = samples.selected;
  let clicked = 0;
  let skipped = 0;
  const failures = [];
  for (const control of controls) {
    if (control.disabled) { skipped++; continue; }
    await resetDefinitionRoute(r, definition);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await resetDefinitionRoute(r, definition);
        await clickInitialButton(r, control);
        clicked++;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) failures.push({
      text: control.text,
      testid: control.testid,
      attempts: 2,
      error: lastError.message.slice(0, 500),
    });
  }
  const semanticSampling = definition && definition.initialAuditStrategy === 'semantic';
  record(
    r,
    semanticSampling ? '初始可用按钮语义采样完成' : '初始可用按钮均完成点击扫描',
    failures.length === 0,
    {
      total: discoveredControls.length,
      manual: manualControls.length,
      sampled: controls.length,
      suppressed: samples.suppressed.length,
      clicked,
      skipped,
      failures,
    },
  );

  await resetDefinitionRoute(r, definition);
  await auditInitialFields(r, definition);

  await resetDefinitionRoute(r, definition);
  const links = await r.page.locator('.cohere-main a').evaluateAll((items) => items.filter((item) => item.getClientRects().length > 0 && !item.closest('details:not([open])')).map((item) => ({ href: item.getAttribute('href'), text: (item.textContent || '').trim() })));
  let linksClicked = 0;
  for (let i = 0; i < links.length; i++) {
    await resetDefinitionRoute(r, definition);
    const descriptor = links[i];
    const link = descriptor.href
      ? r.page.locator(`.cohere-main a:visible[href=${JSON.stringify(descriptor.href)}]`).first()
      : r.page.locator('.cohere-main a:visible').filter({ hasText: descriptor.text }).first();
    try {
      if (await link.count()) { await link.click({ noWaitAfter: true, timeout: 2000 }); linksClicked++; }
    } catch (_) { /* external/browser-only links are still enumerated */ }
  }
  record(r, '页面链接完成点击扫描', links.length === 0 || linksClicked === links.length, { total: links.length, clicked: linksClicked, links });
}

function fieldValueFor(type) {
  if (type === 'number' || type === 'range') return '1';
  if (type === 'date') return '2026-07-15';
  if (type === 'datetime-local') return '2026-07-15T10:00';
  if (type === 'time') return '10:00';
  if (type === 'month') return '2026-07';
  if (type === 'week') return '2026-W29';
  if (type === 'color') return '#336699';
  if (type === 'email') return 'e2e@example.com';
  if (type === 'url') return 'https://example.com/e2e';
  return 'E2E 自动输入';
}

async function auditInitialFields(r, definition) {
  const fields = r.page.locator('.cohere-main input, .cohere-main textarea, .cohere-main select');
  const discoveredDescriptors = await fields.evaluateAll((elements) => {
    const occurrences = new Map();
    return elements.map((element, index) => {
      const visible = element.getClientRects().length > 0 && !element.closest('details:not([open])');
      const identity = {
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute('type') || '',
        placeholder: element.getAttribute('placeholder') || '',
        name: element.getAttribute('name') || '',
        testid: element.getAttribute('data-testid') || '',
        className: typeof element.className === 'string' ? element.className : '',
      };
      const key = JSON.stringify(identity);
      const occurrence = visible ? (occurrences.get(key) || 0) : -1;
      if (visible) occurrences.set(key, occurrence + 1);
      return {
        index,
        ...identity,
        occurrence,
        visible,
        disabled: Boolean(element.disabled),
        readOnly: Boolean(element.readOnly)
      };
    });
  });
  const samples = selectInitialAuditSamples(
    discoveredDescriptors,
    fieldSemanticKey,
    definition && definition.initialAuditStrategy,
  );
  const descriptors = samples.selected;
  const editable = descriptors.filter((field) => field.visible && !field.disabled && !field.readOnly);
  let exercised = 0;
  const failures = [];
  for (const descriptor of editable) {
    if (definition) await resetDefinitionRoute(r, definition);
    try {
      let field = fields.nth(descriptor.index);
      if (definition) {
        const identityReady = await waitForPageCondition(r, (expected) => {
          const matches = Array.from(document.querySelectorAll('.cohere-main input, .cohere-main textarea, .cohere-main select'))
            .filter((element) => element.getClientRects().length > 0
              && !element.closest('details:not([open])')
              && element.tagName.toLowerCase() === expected.tag
              && (element.getAttribute('type') || '') === expected.type
              && (element.getAttribute('placeholder') || '') === expected.placeholder
              && (element.getAttribute('name') || '') === expected.name
              && (element.getAttribute('data-testid') || '') === expected.testid);
          return matches.length > expected.occurrence;
        }, descriptor);
        if (!identityReady) throw new Error('重置后找不到对应的初始字段');
        const currentFields = r.page.locator('.cohere-main input, .cohere-main textarea, .cohere-main select');
        const currentVisibleIndex = await currentFields.evaluateAll((elements, expected) => {
          const visibleElements = elements.filter((element) => element.getClientRects().length > 0 && !element.closest('details:not([open])'));
          const matchingElements = visibleElements.filter((element) =>
            element.tagName.toLowerCase() === expected.tag
            && (element.getAttribute('type') || '') === expected.type
            && (element.getAttribute('placeholder') || '') === expected.placeholder
            && (element.getAttribute('name') || '') === expected.name
            && (element.getAttribute('data-testid') || '') === expected.testid);
          return visibleElements.indexOf(matchingElements[expected.occurrence]);
        }, descriptor);
        if (currentVisibleIndex < 0) throw new Error('重置后找不到对应的初始字段');
        field = r.page.locator('.cohere-main input:visible, .cohere-main textarea:visible, .cohere-main select:visible').nth(currentVisibleIndex);
        if (!(await waitForVisible(field))) throw new Error('重置后的初始字段不可见');
        const resolvedIdentity = await field.evaluate((element) => ({
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute('type') || '',
          placeholder: element.getAttribute('placeholder') || '',
          name: element.getAttribute('name') || '',
          testid: element.getAttribute('data-testid') || ''
        }));
        if (resolvedIdentity.tag !== descriptor.tag
          || resolvedIdentity.type !== descriptor.type
          || resolvedIdentity.placeholder !== descriptor.placeholder
          || resolvedIdentity.name !== descriptor.name
          || resolvedIdentity.testid !== descriptor.testid) {
          throw new Error('重置后的字段身份发生变化');
        }
      }
      if (descriptor.tag === 'select') {
        const values = await field.locator('option').evaluateAll((options) => options.map((o) => o.value).filter(Boolean));
        if (!values.length) throw new Error('没有可选择的非空选项');
        await field.selectOption(values[0]);
      } else if (descriptor.type === 'checkbox' || descriptor.type === 'radio') {
        await field.check();
      } else if (descriptor.type === 'file') {
        await field.setInputFiles({ name: 'e2e.txt', mimeType: 'text/plain', buffer: Buffer.from('e2e') });
      } else {
        await field.fill(fieldValueFor(descriptor.type));
      }
      exercised++;
    } catch (error) {
      failures.push({
        index: descriptor.index,
        tag: descriptor.tag,
        type: descriptor.type,
        placeholder: descriptor.placeholder,
        name: descriptor.name,
        testid: descriptor.testid,
        error: error.message
      });
    }
  }
  const semanticSampling = definition && definition.initialAuditStrategy === 'semantic';
  const details = {
    fieldCount: discoveredDescriptors.length,
    sampledFieldCount: descriptors.length,
    suppressed: samples.suppressed.length,
    editableCount: editable.length,
    exercised,
    failures,
  };
  const passed = failures.length === 0 && exercised === editable.length;
  record(r, semanticSampling ? '初始可编辑字段语义采样完成' : '全部初始可编辑表单字段完成输入扫描', passed, details);
  return { passed, details };
}

async function runRouteSpec(specName, options = {}) {
  const definition = definitions[specName];
  if (!definition) throw new Error(`Unknown route spec: ${specName}`);
  const r = new FunctionalRunner({ specName: `${specName}.functional`, ...SUITE_OPTIONS, ...options });
  await r.launch();
  r.page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  // 允许的 console error（预期的 mock 路径错误等）
  const allowedConsoleErrors = ['Not allowed to load local resource'];
  try {
    await gotoDefinition(r, definition);
    // 若定义了 redirectExpected（如 /create/pipeline → /create），检查重定向后路径
    const expectedRoute = definition.redirectExpected || definition.route;
    record(r, '路由地址正确', (await r.currentRoute()).startsWith(expectedRoute));
    record(r, '页面标题渲染', await bodyHas(r, definition.title), { title: definition.title });
    await definition.exercise(r);
    await auditInitialControls(r, definition);
    await r.page.setViewportSize({ width: 1024, height: 768 });
    await resetDefinitionRoute(r, definition);
    const expectedTitle = definition.title;
    record(r, '响应式窗口仍渲染标题', await bodyHas(r, expectedTitle) || (specName === 'first-run' && await bodyHas(r, '开始配置')));
    await r.expectNoConsoleError(allowedConsoleErrors);
    await r.expectNoPageError();
    await r.screenshot('final');
  } catch (error) {
    record(r, 'spec 未抛出异常', false, { message: error.message, stack: error.stack });
  }
  const report = r.generateReport();
  // 过滤已知的 console error（如 mock 路径加载错误）
  const blockedErrors = report.consoleErrors.filter((e) => !allowedConsoleErrors.some((a) => e.text.includes(a)));
  report.consoleErrors = blockedErrors;
  r.saveReport(report);
  await r.close();
  console.log(`\n${specName}: ${report.checks.passed}/${report.checks.total} checks, ${report.consoleErrors.length} console errors, ${report.pageErrors.length} page errors`);
  return report;
}

if (require.main === module) {
  const name = process.argv[2];
  runRouteSpec(name).then((report) => {
    process.exit(report.checks.failed || report.consoleErrors.length || report.pageErrors.length ? 1 : 0);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  definitions,
  runRouteSpec,
  auditInitialControls,
  auditInitialFields,
  fillPublishBody,
  controlSemanticKey,
  fieldSemanticKey,
  selectInitialAuditSamples,
};
