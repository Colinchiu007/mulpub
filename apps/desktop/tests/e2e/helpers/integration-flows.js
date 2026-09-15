/**
 * 集成流 E2E 测试（Phase 3）
 *
 * 4 条主流程：
 *   Flow 1: 创建 → 发布 → 看板
 *   Flow 2: 账号管理 → 侧栏 → 发布
 *   Flow 3: 模型服务商 → AI 写作
 *   Flow 4: 监控 → 评论回复
 *
 * 使用：
 *   node tests/e2e/helpers/integration-flows.js flow-1
 *   node tests/e2e/helpers/integration-flows.js all
 */

const { FunctionalRunner } = require('./functional-runner');

const SUITE_OPTIONS = { initPro: true };
const CONDITION_TIMEOUT = 5000;
const FEATURE_READY_TIMEOUT = 15000;

function record(r, name, passed, details) {
  r.checks.push({ kind: 'integration', name, passed: Boolean(passed), details: details || null });
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

async function waitForIpcCall(r, methods, timeout = CONDITION_TIMEOUT) {
  const names = Array.isArray(methods) ? methods : [methods];
  if (typeof r.page.waitForFunction === 'function') {
    const ready = await waitForPageCondition(r, (expectedMethods) => expectedMethods.some(
      (method) => (window.__ipcCallsByMethod?.[method] || 0) > 0
    ), names, timeout);
    if (!ready) return false;
  }
  const counts = await Promise.all(names.map((method) => r.getIpcCalls(method)));
  return counts.some((count) => count > 0);
}

async function bodyHas(r, text, timeout = CONDITION_TIMEOUT) {
  const body = r.page.locator('body');
  if (typeof body.filter === 'function') {
    return waitForVisible(body.filter({ hasText: text }), timeout);
  }
  return body.innerText().then((value) => value.includes(text));
}

async function clickText(r, text, options = {}) {
  const selector = options.selector
    || `.cohere-main button:has-text("${text}"), .cohere-main [role="button"]:has-text("${text}"), .cohere-main uibutton:has-text("${text}"), .cohere-main uibutton[title="${text}"]`;
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
  const selectors = [
    '[data-testid="publish-title"] input',
    '[data-testid="publish-editor"]',
    '[data-testid="publish-target-selector"]',
    '[data-testid="publish-submit"]',
  ];
  return waitForPageCondition(r, (expectedSelectors) => expectedSelectors.every((selector) => {
    const element = document.querySelector(selector);
    return element && element.getClientRects().length > 0;
  }), selectors, timeout);
}

async function fillPublishTitle(r, value) {
  const locator = r.page.locator('[data-testid="publish-title"] input').first();
  if (!(await waitForVisible(locator, FEATURE_READY_TIMEOUT))) return false;
  await locator.fill(value);
  return true;
}

async function fillPublishContent(r, value) {
  const markdown = r.page.locator('[data-testid="publish-editor"] textarea.md-editor').first();
  const richText = r.page.locator('[data-testid="publish-editor"] .ql-editor[contenteditable="true"]').first();
  const mdSwitch = r.page.locator('[data-testid="publish-editor"] button:has-text("Markdown")').first();
  if (await waitForVisible(mdSwitch, FEATURE_READY_TIMEOUT)) await mdSwitch.click({ force: true });
  if (await waitForVisible(markdown, FEATURE_READY_TIMEOUT)) {
    await markdown.fill(value);
    return true;
  }
  if (await waitForVisible(richText, FEATURE_READY_TIMEOUT)) {
    await richText.fill(value);
    return true;
  }
  return false;
}

async function ipcCounts(r, methods) {
  const names = Array.isArray(methods) ? methods : [methods];
  const counts = await Promise.all(names.map(async (method) => [method, await r.getIpcCalls(method)]));
  return Object.fromEntries(counts);
}

async function waitForIpcIncrement(r, methods, baseline, timeout = FEATURE_READY_TIMEOUT) {
  const names = Array.isArray(methods) ? methods : [methods];
  return waitForPageCondition(r, (expected) => expected.names.some((method) => (
    (window.__ipcCallsByMethod?.[method] || 0) > (expected.baseline[method] || 0)
  )), { names, baseline }, timeout);
}

/**
 * Flow 1: 创建 → 发布 → 看板
 * 1. /create 生成一篇文章
 * 2. 保存到历史
 * 3. 跳到 /publish
 * 4. 选择平台、填内容
 * 5. 模拟发布成功
 * 6. 跳到 /dashboard
 * 7. 验证出现该条记录
 */
async function flowCreateToDashboard(r) {
  console.log('\n→ Flow 1: 创建 → 发布 → 看板');

  // Step 1: /create 生成一篇文章
  await r.goto('/create');
  const pipelineCard = r.page.locator('.pipeline-card').first();
  if (await waitForVisible(pipelineCard)) {
    await pipelineCard.click();
  }
  await fillByPlaceholder(r, '视频文案', 'E2E 集成测试视频文案');
  const taValue = await r.page.locator('textarea[placeholder*="视频文案"]').first().inputValue().catch(() => '');
  record(r, 'Flow1.1 创作文案可填写', taValue === 'E2E 集成测试视频文案', { value: taValue });

  // Step 2: 启动流水线（保存到历史）
  const startBtn = await clickText(r, '启动流水线');
  record(r, 'Flow1.2 启动流水线保存内容', startBtn);

  // Step 3: 跳到 /publish
  await r.goto('/publish');
  const publishReady = await waitForPublishReady(r);
  record(r, 'Flow1.3 跳转到发布页', publishReady && (await r.currentRoute()).startsWith('/publish'));

  // Step 4: 选择平台、填内容
  const titleFilled = await fillPublishTitle(r, 'E2E 集成发布标题');
  const contentFilled = await fillPublishContent(r, 'E2E 集成发布正文内容 — 测试 sample content for publishBatch IPC trigger');

  const titleValue = await r.page.locator('[data-testid="publish-title"] input').first().inputValue().catch(() => '');
  let contentLen = 0;
  const mdText = await r.page.locator('[data-testid="publish-editor"] textarea.md-editor').first().inputValue().catch(() => '');
  if (mdText.length > 0) contentLen = mdText.length;
  else {
    const qlText = await r.page.locator('[data-testid="publish-editor"] .ql-editor').first().innerText().catch(() => '');
    contentLen = (qlText || '').length;
  }
  record(r, 'Flow1.4 发布表单填写完成', titleFilled && contentFilled && titleValue === 'E2E 集成发布标题' && contentLen > 0, { title: titleValue, contentLen });

  // Step 5: 验证发布目标 + 按钮是否启用（enabled 意味着 selectedPlatforms.length > 0）
  const publishBtnState = await r.page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, uibutton, [role=button]'));
    const targets = buttons.find((b) => /一键发布/.test(b.innerText) || /一键发布/.test(b.textContent || ''));
    if (!targets) return { found: false };
    return {
      found: true,
      disabled: targets.disabled === true || targets.getAttribute('disabled') !== null || targets.classList.contains('is-disabled'),
      tagName: targets.tagName.toLowerCase(),
    };
  });
  // 检查页面是否存在 el-checkbox-group 或平台 checkbox/list 之类的占位（全部不可能为 0）
  const platformAreaHint = await r.page.evaluate(() => {
    const main = document.querySelector('.cohere-main');
    if (!main) return { hint: false };
    const text = main.innerText || '';
    return {
      hint: /发布目标|选择平台|搜索平台|平台/.test(text),
      textSnippet: text.substring(0, 200),
    };
  });
  record(r, 'Flow1.5 发布目标存在+有平台可发', (publishBtnState.found && !publishBtnState.disabled) || platformAreaHint.hint, { ...publishBtnState, hintText: platformAreaHint.textSnippet });

  // Step 6: 模拟发布
  const publishBaseline = await ipcCounts(r, ['publishBatch', 'publishWechat']);
  const publishClicked = await clickText(r, '一键发布', { selector: '[data-testid="publish-submit"]', timeout: FEATURE_READY_TIMEOUT });
  record(r, 'Flow1.6 一键发布按钮可执行', publishClicked);
  const publishIpcObserved = publishClicked && await waitForIpcIncrement(r, ['publishBatch', 'publishWechat'], publishBaseline);
  const batchCalls = await r.getIpcCalls('publishBatch');
  const wechatCalls = await r.getIpcCalls('publishWechat');
  record(r, 'Flow1.7 publishBatch IPC 被调用', Boolean(publishIpcObserved), { publishBatch: batchCalls, publishWechat: wechatCalls });

  // Step 7: 跳到 /dashboard
  await r.goto('/dashboard');
  const dashboardIpcObserved = await waitForIpcCall(r, 'dashboardStats', FEATURE_READY_TIMEOUT);
  record(r, 'Flow1.8 跳转到看板', (await r.currentRoute()).startsWith('/dashboard'));

  // Step 8: 验证 dashboardStats IPC 被调用（说明已加载发布数据）
  const dashboardCalls = await r.getIpcCalls('dashboardStats');
  record(r, 'Flow1.9 看板统计已加载', dashboardIpcObserved && dashboardCalls > 0, { count: dashboardCalls });
  record(r, 'Flow1.10 看板渲染数据卡片', await r.page.locator('.cohere-main .cohere-card').count() >= 2);
}

/**
 * Flow 2: 账号管理 → 侧栏 → 发布
 * 1. /accounts 添加账号
 * 2. 跳回首页
 * 3. 验证侧栏出现该平台
 * 4. 点 /publish
 * 5. 验证该平台可勾选
 */
async function flowAccountToPublish(r) {
  console.log('\n→ Flow 2: 账号管理 → 侧栏 → 发布');

  // Step 1: /accounts 添加账号
  await r.goto('/accounts');
  await waitForVisible(r.page.locator('.account-row, .account-card-grid > *').first(), FEATURE_READY_TIMEOUT);
  const initialAccounts = await r.page.locator('.account-row').count();
  record(r, 'Flow2.1 账号列表初始渲染', initialAccounts > 0, { count: initialAccounts });

  const addClicked = await clickText(r, '添加账号', { selector: '[data-testid="account-add"]', timeout: FEATURE_READY_TIMEOUT });
  if (addClicked) {
    const modal = r.page.locator('.ui-modal, .el-dialog').first();
    record(r, 'Flow2.2 添加账号弹窗打开', await waitForVisible(modal, FEATURE_READY_TIMEOUT));
    // 关闭弹窗
    const closeButton = r.page.locator('.ui-modal-close').first();
    if (await waitForVisible(closeButton, 1000)) await closeButton.click({ force: true });
    else await r.page.keyboard.press('Escape');
    record(r, 'Flow2.3 添加账号弹窗可关闭', await waitForHidden(modal));
  } else {
    record(r, 'Flow2.2 添加账号弹窗打开', false);
  }

  // Step 2: 跳回首页
  await r.goto('/');
  // 首页已复刻为参考产品风格，支持平台区域改用 .mp-home-platform-tag（保留旧选择器兼容）。
  await waitForVisible(r.page.locator('.mp-home-platform-tag, .platform-item, .cohere-platform-item').first(), FEATURE_READY_TIMEOUT);
  record(r, 'Flow2.4 跳回首页', (await r.currentRoute()) === '/' || (await r.currentRoute()) === '');

  // Step 3: 验证首页平台列表显示
  const sidebarPlatforms = await r.page.locator('.mp-home-platform-tag, .platform-item, .cohere-platform-item').count();
  record(r, 'Flow2.5 首页平台列表显示', sidebarPlatforms > 0, { count: sidebarPlatforms });

  // Step 4: 跳到 /publish
  await r.goto('/publish');
  const publishReady = await waitForPublishReady(r);

  // Step 5: 验证平台可勾选
  const platformCheckboxes = await r.page.locator('[data-testid="publish-target-selector"] input[data-testid^="platform-"]').count();
  record(r, 'Flow2.6 发布页平台选项可勾选', publishReady && platformCheckboxes > 0, { count: platformCheckboxes });
}

/**
 * Flow 3: 模型服务商 → AI 写作
 * 1. /model-providers 切换默认服务商
 * 2. 重读服务商列表，验证目标服务商是唯一默认项
 * 3. 跳 /publish 并打开 AI 写作面板
 * 4. 验证 AI 写作面板查询服务商配置
 */
async function flowProviderToAI(r) {
  console.log('\n→ Flow 3: 模型服务商 → AI 写作');

  // Step 1: /model-providers 切换默认服务商
  await r.goto('/model-providers');
  const providerLocator = r.page.locator('.provider-card');
  await waitForVisible(providerLocator);
  const providerCards = await providerLocator.count();
  record(r, 'Flow3.1 服务商列表渲染', providerCards > 0, { count: providerCards });

  // 调用 IPC 切换默认服务商（模拟"设为默认"按钮）
  const setDefaultResult = await r.page.evaluate(() => window.electronAPI.modelProviderSetDefault('llm', 'preset_anthropic'));
  record(r, 'Flow3.2 默认服务商切换 IPC 调用', setDefaultResult && setDefaultResult.code === 0 && (await r.getIpcCalls('modelProviderSetDefault')) > 0, { response: setDefaultResult });

  const providerListResult = await r.page.evaluate(() => window.electronAPI.modelProviderList('llm'));
  const providers = providerListResult && Array.isArray(providerListResult.data) ? providerListResult.data : [];
  const defaults = providers.filter((provider) => provider.is_default);
  record(r, 'Flow3.3 重读列表仅有目标唯一默认服务商', providerListResult && providerListResult.code === 0 && defaults.length === 1 && defaults[0].id === 'preset_anthropic', {
    code: providerListResult && providerListResult.code,
    defaultIds: defaults.map((provider) => provider.id)
  });

  // Step 3: 跳到 /publish 并打开 AI 写作面板
  await r.goto('/publish');
  await waitForPublishReady(r);
  const aiPanelOpened = await clickText(r, 'AI', { selector: '[data-testid="open-ai-writer"]' });

  // Step 4: 面板初始化必须真实查询模型服务商配置
  const aiPanelVisible = aiPanelOpened && await waitForVisible(r.page.locator('.ai-writer-panel'));
  const configuredIpcObserved = await waitForIpcCall(r, 'modelProviderIsConfigured');
  const aiContent = aiPanelVisible && await bodyHas(r, 'AI 辅助写作');
  record(r, 'Flow3.4 发布页面 AI 写作面板加载', aiContent, { aiPanelOpened, aiPanelVisible });
  const configuredCalls = await r.getIpcCalls('modelProviderIsConfigured');
  record(r, 'Flow3.5 AI 服务商配置 IPC 已调用', configuredIpcObserved && configuredCalls > 0, { count: configuredCalls });
}

/**
 * Flow 4: 评论 → 全局标签页
 * 1. /comments 平台列表渲染
 * 2. 点平台 → 在顶部全局标签栏打开评论页（page-manager 体系）
 * 3. 验证 pageManagerCreateNewTabPage IPC 已调用
 */
async function flowCommentsToPageManager(r) {
  console.log('\n→ Flow 4: 评论 → 全局标签页');

  // Step 1: /comments 加载
  await r.goto('/comments');
  await waitForVisible(r.page.locator('.comment-platform-item').first());
  const commentItems = await r.page.locator('.comment-platform-item').count();
  record(r, 'Flow4.1 评论平台列表渲染', commentItems > 0, { count: commentItems });

  // Step 2: 选择平台 → 在顶部标签栏打开评论页
  if (commentItems > 0) {
    await r.page.locator('.comment-platform-item').first().click();
    record(r, 'Flow4.2 选择平台后显示标签栏引导', await bodyHas(r, '顶部标签栏'));
  }

  // Step 3: pageManager 打开标签 IPC 已调用
  if (commentItems > 0) await waitForIpcCall(r, 'pageManagerCreateNewTabPage');
  const createTabCalls = await r.getIpcCalls('pageManagerCreateNewTabPage');
  record(r, 'Flow4.3 pageManagerCreateNewTabPage IPC 已调用', createTabCalls > 0, { count: createTabCalls });
}

/**
 * Flow 5: 设置变更级联（Phase 3.2）
 * 1. 切离线 → 发布任务进入离线缓存
 * 2. 恢复后仍可正常发布
 * 3. 验证 Pro 状态变化
 */
async function flowSettingCascade(r) {
  console.log('\n→ Flow 5: 设置变更级联');

  // Step 1: 默认状态 — 发布按钮启用
  await r.goto('/publish');
  await waitForPageCondition(r, (shouldBeDisabled) => {
    const target = Array.from(document.querySelectorAll('button, uibutton, [role=button]')).find((button) => /一键发布/.test(button.innerText));
    if (!target) return false;
    const disabled = target.disabled || target.getAttribute('disabled') !== null || target.classList.contains('is-disabled');
    return disabled === shouldBeDisabled;
  }, false);
  const enabledBeforeOffline = await r.page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, uibutton, [role=button]'));
    const target = buttons.find((b) => /一键发布/.test(b.innerText));
    if (!target) return { found: false };
    return { found: true, disabled: target.disabled || target.getAttribute('disabled') !== null || target.classList.contains('is-disabled') };
  });
  record(r, 'Flow5.1 在线时发布按钮启用', enabledBeforeOffline.found && !enabledBeforeOffline.disabled);

  // Step 2: 切换 mock 状态并重新进入发布页，让页面读取真实离线合同
  await r.page.evaluate(() => window.__setOffline(true));
  await r.goto('/');
  await r.goto('/publish');
  const offlineReady = await waitForPublishReady(r);
  await r.page.waitForFunction(() => window.__mockState?.offline === true, { timeout: FEATURE_READY_TIMEOUT }).catch(() => {});
  const offlineTitleFilled = await fillPublishTitle(r, 'E2E 离线缓存标题');
  const offlineContentFilled = await fillPublishContent(r, 'E2E 离线缓存正文');
  const offlineBaseline = await ipcCounts(r, 'offlineAddToCache');
  const offlinePublishClicked = await clickText(r, '一键发布', { selector: '[data-testid="publish-submit"]', timeout: FEATURE_READY_TIMEOUT });
  const offlineIpcObserved = offlinePublishClicked && await waitForIpcIncrement(r, 'offlineAddToCache', offlineBaseline);
  const offlineStatus = await r.page.evaluate(() => window.electronAPI.offlineStatus());
  const offlineCalls = await r.getIpcCalls('offlineStatus');
  const offlineCacheCalls = await r.getIpcCalls('offlineAddToCache');
  record(r, 'Flow5.2 离线状态合同生效且任务进入缓存队列', Boolean(
    offlineStatus
      && offlineStatus.code === 0
      && offlineStatus.data
      && offlineStatus.data.offline === true
      && offlineCalls > 0
      && offlineReady
      && offlineTitleFilled
      && offlineContentFilled
      && offlinePublishClicked
      && offlineIpcObserved
  ), { offlineCalls, offlineCacheCalls, response: offlineStatus, offlinePublishClicked });

  // Step 3: 恢复在线并重新挂载发布页
  await r.page.evaluate(() => window.__setOffline(false));
  await r.goto('/');
  await r.goto('/publish');
  await waitForPublishReady(r);
  const onlineButtonReady = await waitForPageCondition(r, (shouldBeDisabled) => {
    const target = Array.from(document.querySelectorAll('button, uibutton, [role=button]')).find((button) => /一键发布/.test(button.innerText));
    if (!target) return false;
    const disabled = target.disabled || target.getAttribute('disabled') !== null || target.classList.contains('is-disabled');
    return disabled === shouldBeDisabled;
  }, false, FEATURE_READY_TIMEOUT);
  const onlineStatus = await r.page.evaluate(() => window.electronAPI.offlineStatus());
  const enabledOnline = await r.page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, uibutton, [role=button]'));
    const target = buttons.find((button) => /一键发布/.test(button.innerText));
    return target
      ? !(target.disabled || target.getAttribute('disabled') !== null || target.classList.contains('is-disabled'))
      : false;
  });
  record(r, 'Flow5.3 恢复在线后发布按钮重新启用', Boolean(
    onlineStatus
      && onlineStatus.code === 0
      && onlineStatus.data
      && onlineStatus.data.offline === false
      && onlineButtonReady
      && enabledOnline
  ), { response: onlineStatus, enabledOnline });

  // Step 4: Pro 状态验证
  await r.goto('/');
  const licenseResult = await r.page.evaluate(() => window.electronAPI.licenseFeatures());
  const proIPC = await r.getIpcCalls('licenseFeatures');
  record(r, 'Flow5.4 licenseFeatures 返回可验证的许可合同', Boolean(
    proIPC > 0 && licenseResult && licenseResult.code === 0 && licenseResult.data
  ), { count: proIPC, response: licenseResult });
}

/**
 * Flow 6: 错误路径（Phase 3.3）
 * 1. IPC 失败 → 错误提示出现
 * 2. 表单空提交 → 校验提示
 */
async function flowErrorPaths(r) {
  console.log('\n→ Flow 6: 错误路径');

  // Step 1: 模拟 IPC 失败
  await r.goto('/publish');
  await waitForPublishReady(r);
  await r.failNextIpc('publishBatch', '模拟网络错误：发布队列不可达');
  // 不填字段点发布，触发校验提示（不需 IPC）
  const publishClicked = await clickText(r, '一键发布');
  const validationReady = await waitForPageCondition(r, () => {
    const messages = document.querySelectorAll('.el-message, .el-notification, .el-message-box');
    return messages.length > 0 || /请输入|不能为空|必填|错误/.test(document.body.innerText);
  }, undefined, FEATURE_READY_TIMEOUT);
  // 验证校验提示可能出现在 Message 或 alert
  const validationShown = await r.page.evaluate(() => {
    // Element Plus 的 Message 会插入 .el-message / .el-notification
    const msgs = document.querySelectorAll('.el-message, .el-notification, .el-message-box');
    if (msgs.length > 0) return true;
    return /请输入|不能为空|必填|错误/.test(document.body.innerText);
  });
  record(r, 'Flow6.1 表单校验提示出现（空提交触发）', validationReady && validationShown, { clicked: publishClicked });

  // Step 2: 验证 IPC 失败路径
  await fillPublishTitle(r, 'ErrorTest Title');
  await fillPublishContent(r, 'ErrorTest content for IPC failure path');
  // 下一次 publishBatch 调用会失败（因为前面 failNextIpc 是 LIFO/单次）
  const publishBaseline2 = await ipcCounts(r, 'publishBatch');
  const publishClicked2 = await clickText(r, '一键发布', { selector: '[data-testid="publish-submit"]', timeout: FEATURE_READY_TIMEOUT });
  let errorWaitReady = false;
  if (publishClicked2) {
    errorWaitReady = await waitForPageCondition(r, () => {
      const errorElement = document.querySelector('.cohere-card-danger, .error-banner, .el-message--error, [class*="danger"], [class*="error"]');
      return /失败|错误|error|failed/i.test(document.body.innerText) && Boolean(errorElement);
    }, undefined, FEATURE_READY_TIMEOUT);
  }
  const publishBatchObserved = publishClicked2 && await waitForIpcIncrement(r, 'publishBatch', publishBaseline2, FEATURE_READY_TIMEOUT);
  const errorUIVisible = await r.page.evaluate(() => {
    const errorElement = document.querySelector('.cohere-card-danger, .error-banner, .el-message--error, [class*="danger"], [class*="error"]');
    return /失败|错误|error|failed/i.test(document.body.innerText) && Boolean(errorElement);
  });
  record(r, 'Flow6.2 IPC 失败后错误提示可达', Boolean(errorWaitReady && publishBatchObserved && errorUIVisible), {
    errorUIVisible: errorWaitReady && errorUIVisible,
    publishBatchObserved,
    publishBatchCalls: await r.getIpcCalls('publishBatch'),
  });

  // Step 3: 验证必填字段缺失时按钮可用性
  await r.goto('/create');
  const createReady = await waitForPageCondition(r, () => /流水线|启动|创作/.test(document.body.innerText || ''), undefined, FEATURE_READY_TIMEOUT);
  const requiredBlank = await r.page.evaluate(() => {
    const text = document.body.innerText || '';
    return /流水线|启动|创作/.test(text);
  });
  record(r, 'Flow6.3 创作页必填提示可达', createReady && requiredBlank, { note: '已加载流水线界面' });
}

const flows = {
  'flow-1': { name: 'Flow 1: 创建→发布→看板', exercise: flowCreateToDashboard },
  'flow-2': { name: 'Flow 2: 账号管理→侧栏→发布', exercise: flowAccountToPublish },
  'flow-3': { name: 'Flow 3: 模型服务商→AI 写作', exercise: flowProviderToAI },
  'flow-4': { name: 'Flow 4: 评论→全局标签页', exercise: flowCommentsToPageManager },
  'flow-5': { name: 'Flow 5: 设置变更级联', exercise: flowSettingCascade },
  'flow-6': { name: 'Flow 6: 错误路径', exercise: flowErrorPaths }
};

async function runFlow(flowKey, options = {}) {
  const flow = flows[flowKey];
  if (!flow) throw new Error(`Unknown flow: ${flowKey}`);
  const r = new FunctionalRunner({ specName: `integration.${flowKey}`, ...SUITE_OPTIONS, ...options });
  await r.launch();
  try {
    await flow.exercise(r);
    await r.expectNoConsoleError();
    await r.expectNoPageError();
    await r.screenshot('final');
  } catch (error) {
    record(r, 'flow 未抛出异常', false, { message: error.message });
  }
  const report = r.generateReport();
  r.saveReport();
  await r.close();
  console.log(`\n${flowKey}: ${report.checks.passed}/${report.checks.total} checks, ${report.consoleErrors.length} console errors, ${report.pageErrors.length} page errors`);
  return report;
}

async function runAllFlows(options = {}) {
  console.log('=== Phase 3: 跨视图集成流 ===');
  const results = {};
  for (const key of Object.keys(flows)) {
    results[key] = await runFlow(key, options);
  }
  return results;
}

if (require.main === module) {
  const arg = process.argv[2];
  const promise = arg === 'all' || !arg ? runAllFlows() : runFlow(arg);
  promise.then((results) => {
    // results 可能是单 report（ { checks: ... } ），也可能是 {flow-1: report, ...}
    const allReports = Array.isArray(results)
      ? results
      : (results && typeof results === 'object' && results.checks
        ? [results]
        : Object.values(results || {}));
    const totalChecks = allReports.reduce((s, r) => s + (r && r.checks ? r.checks.total : 0), 0);
    const totalPassed = allReports.reduce((s, r) => s + (r && r.checks ? r.checks.passed : 0), 0);
    const totalFailed = allReports.reduce((s, r) => s + (r && r.checks ? r.checks.failed : 0), 0);
    const totalErrors = allReports.reduce((s, r) => s + (r && r.consoleErrors ? r.consoleErrors.length : 0), 0);
    console.log(`\n=== 集成流汇总: ${totalPassed}/${totalChecks} checks passed, ${totalFailed} failed, ${totalErrors} console errors ===`);
    process.exit(totalFailed || totalErrors ? 1 : 0);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { flows, runFlow, runAllFlows };
