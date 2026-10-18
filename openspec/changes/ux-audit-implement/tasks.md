# Tasks: ux-audit-implement

> 阶段编号沿用 `01-docs/UX-AUDIT-2026-10-17.md` §5。依赖定序：0.4 → 0.1/0.2/2.6；3.2 → 1.5；5.4 ≥ 1.8。
> 每项完成的标准是"代码 + 回归锁 + 当场跑过的证据"，不是"文件存在"。

## 阶段 0：安全网

- [x] 0.4 `scripts/check-danger-confirm.js` 确认接线门禁（作用域判据 + A/B 两档 + 只能缩小的登记表 + 取证入口），9 条回归锁（含"合规形态必须绿"与 P3"确认写在别的函数里仍判红"），接 `quality-gate.yml` Gate 2b7
- [x] 0.1 `usePublishDrafts.removeDraft` 补 `confirmDanger`，文案含被删标题；5 条用例（取消时 `draftDelete` 调用为 0 / 点名标题 / 无标题占位 / `draftId` 缺席不弹窗 / 接线守卫）
- [x] 0.2 破坏性操作补确认：清理缓存、退出登录 ×2、撤销其他设备会话；账号单删文案补"不可恢复"
  - [x] 0.2a 门禁首遍实测新增两条审计未列出的入口：`LogsSettings.clearLogs`、`AutomationView.remove`（各配取消分支行为锁）
  - [x] 0.2b `views/member-center/AccountSecurity.test.js` 新建（该视图此前无任何测试）
- [x] 0.3 `UiModal` 默认值 `trapFocus`/`closeOnEsc` 翻 true；`closeOnOverlay` 经实测否证"遮罩=默认同意"后保持 true，判据改写为"破坏性动作不得绑在关闭路径上"（`UiModal.destructive.test.js`，承载点清单钉死）
- [x] 0.5 `useUnsavedLeaveGuard`（路由 + beforeunload 两条出口、`isDirty` 非函数即抛）；接入 RewriteView；覆盖面扫描锁 `src/unsaved-leave-contract.test.js`（实测 8 个编辑视图，7 个带实测理由登记）
- [x] 0.6 4 处 `var(--token)hex` 死声明修复（审计稿记 3 处，`OptimalTimeTip.vue:42` 为漏计）+ `scripts/check-css-var-concat.js` 结构锁（8 条，含扫描域规模下界与引号感知属性抽取），接 Gate 2b7

## 阶段 1：接线批次

- [x] 1.5 导航单一实现 `useHomeShellNavigation`（MpSidebar 外提 + App.vue 快捷键落点改走同一段），10 条锁（含双向结构锁）
- [x] 1.6 设置页「快捷键」面板消费既有 `hotkeys:list`；`hotkeys.js` 补 `labelKey` 并修掉与表长期不同步的头注释与 `CmdOrCtrl+Comma` 假标签；`utils/accelerator-format.js`（9 条）；面板 7 条（三态 + 出声告警）
  - [x] 1.6a `src/icon-imports-exist.test.js`：图标具名导入存在性锁（动因：`Keyboard` 不存在，组件测试因 Proxy mock 全绿，只有 `vite build` 才炸——实测发生在本 PR）
- [x] 1.7 catch-all + `NotFound.vue`（真路由表 N1 + 出口 + 只回显 path），`route-registry` 同步登记（`check-route-registry` 实测 37/37）
- [x] 1.7 离线双向：`offline:lost` 推送 + preload 暴露 + 白名单 + `useOfflineStatus` 三通道重写 + `dispose`；横幅文案入 locales、加 `role="alert"` 与暗色档；6 条主进程锁 + 4 条 composable 新锁
- [x] 1.8 `lastEventAt` 陈旧看门狗（3 分钟阈值 / 15 秒采样 / 三个"不谎报"边界 / interval 幂等），面板停滞徽标与关闭解禁；6 条锁
- [x] 1.1 暗色主题入口（**单独成包**，评审 c2）：`useTheme` 改模块级单例（`mode/theme/loaded` 住模块作用域，`boot()` 幂等、系统监听只挂一次、`setThemeMode` 拒绝非法值且不写盘）+ 设置页「外观」分组（跟随系统/浅色/深色三档 `fieldset/legend`，未读到偏好前整面板 `disabled` 并给 `role="status"`）+ `App.vue` 启动引导（不打开设置也能恢复上次主题）。持久化真源存**模式**而非解析结果，脏值回落 `system` 且不回写。`test-runner.js` 的主题注释更正为如实描述写者（原句描述的接线当时不存在），并把 77 处旧读数改成本场重取的 72 处。锁：`useTheme.test.js` 25 条 + `AppearanceSettings.test.js` 8 条 + `App.theme-boot.test.js` 2 条（装配锁）+ `SettingsDialog.test.js` Tab 顺序/计数；变异 M1（摘 `App.vue` 的 `useTheme()`）⇒ 装配锁 2 条全红、M2（摘面板行、留 Tab）⇒ 只有指名那条红、M3（摘非法值拒绝）⇒ `it.each` 三条红，三处还原后 md5 与备份逐字节一致。合并后暗档像素门禁起算，**暗色基线重建仍须人工审核**（本 PR 不伪造基线）
- [x] 1.2 `AnnouncementBanner` 挂载 —— **没有**"挂一行"：`WebContentsView` 是压在渲染层 DOM 之上的原生图层（CSS z-index 无效），其 y 由主进程镜像常量 `BROWSER_CHROME_TOP=76` 算出，故必须先建 **top-inset 通道**（仿 `setSidebarWidth` 的四处同步：`view-bounds.js` 的 `normalizeTopInset`/`contentTopWithInset` + `webview-manager/layout.js` 的 `setTopInset`/`_repositionAll` + `webview-manager/ipc-handlers.js` 的 `page-manager:set-top-inset` + `preload/page-manager.js` 的 `setTopInset`），横幅用 `offsetHeight` 上报、卸载/关闭穷尽回 0。登录视图（`auth-view-manager`）同步收 `_topInset`；**扫码视图不收**（已改独立窗口承载，`_sidebarWidth` 只是签名兼容，加 setter 就是无人读取的死接线）。文案全部入 locales（新增 `locales/announcement/{zh,en}.js` 5 键），`useOpsCenterRuntime` 的 `SEVERITY_LABELS` 中文字面量随之下线（导出完整性锁同步改判）。0 是合法值（与 `normalizeSidebarWidth` 拒绝 0 相反，因为 0 表示"无横幅"这一收口态）；非法值回落 0 并出声告警。锁：`view-bounds-top-inset.test.js` 18 条 + `webview-manager-top-inset.test.js` 17 条（含通道三处同步的源锁、"扫码视图不得收到"的反向锁）+ `AnnouncementBanner.test.js` 9 条 + `App.announcement-inset.test.js` 2 条装配锁；变异 M4（摘掉 App.vue 的挂载行）⇒ 装配锁 2 条全红，还原后 md5 与备份一致。既有回归按 AGENTS 全跑：`overlay-view-suspension` / `shell-mode-6a/6b` / `webview-manager` / `auth-view-manager` / `view-bounds` 共 164 条 + 33 条通过
- [x] 1.3 `TrialBanner` 挂进 `MemberCenter`（可见资格取服务端 `entitlement.plan`，倒计时取本地 license；关闭只会话内生效）；`LoadingState` 与其测试、两处全局注册一并删除（实测全仓模板零消费）；新增 `src/global-components-contract.test.js`（注册↔消费 + 两份清单对账 + 反失明 + 墓碑，6 条，变异"加一条假注册"实测双红）
- [x] 1.4 `/first-run` 接回启动判定：写标记从启动流程摘除（`runSetup` 与 `first-run:status` 推送通道删除），新增 `first-run:complete` IPC + preload + 两处白名单；`useFirstRunGate` 只在读到 `code===0 && setupDone===false` 时 `replace`（6 条判据锁 + 4 条 App 装配锁，装配锁变异"摘掉调用"实测变红）；向导由四步改三步并补「跳过引导」出口；顺带删除第二套引导真源 `services/onboarding.js`（`onboarding-done` 全仓零写点）
- [ ] 1.9 已在 1.7 落地（catch-all 即本项）
- [x] 1.10 「帮助与支持」改可用：三个入口全部指向应用内真实落点（`requestSettingsDialog('general'|'model')`、`router.push('/accounts')`），日志区块取 `logs:info` 真源三态 + `writeClipboard`；**未新增任何外链与第二份协议判据**（本仓无文档站地址，故不写 URL）；`userErrors.LLM_KEY_MISSING` 的"参考使用说明"改为具名可落路径；8 条行为锁
- [x] 0.2 补做：阶段 0 的 `member-center/AccountSecurity.test.js` 因 `vi.hoisted` 工厂内引用顶部 `import { ref }` 触发 TDZ，**整文件 0 条用例被执行**（集合失败不贡献测试数，只看 `Tests N passed` 完全看不出）→ 改异步 hoisted 形态后跑出 6 条，并暴露两个真实缺陷：`AccountSecurity.vue` 两个按钮 `pending !== 动作名` 判据方向写反（空闲态恒禁用 ⇒ 用户点不动「切换/退出登录」），以及 store 夹具须用 `reactive` 才与 Pinia 解包语义同形

## 阶段 2：发布主流程确定性

- [ ] 2.1 封面缩略图三步（handler 异步化三层防御 / 生成小图缓存 / 可见区驱动）
- [ ] 2.2 历史列表三项（防抖值 / 行内函数 Map 缓存 / renderLimit）
- [ ] 2.3 `Publish.vue` / `Collection.vue` / `PodcastChannelView` onMounted 改 `allSettled`
- [ ] 2.4 `AutomationView.vue` 监听注册移到 `await` 前
- [ ] 2.5 聚合进度软权重 + 汇总行「第 N/共 M」
- [ ] 2.6 发布前摘要确认闸门（复用 0.4 已硬化的原语）
- [ ] 2.7 toast 规范单点化（duration 上限 / grouping / 未命中出声 / `ElMessage` 直用棘轮 85 处）
- [ ] 2.8 首屏体量（CSS 按路由切分 / 语言包按需 / 三组件异步化；裁语言包前先核实 `check-locale-sync --keys` 扫的是源码还是产物）

## 阶段 3：真源收敛

- [ ] 3.1 术语单一真源四组判归 + 硬编码进 locales
- [ ] 3.2 首页/主页 4 份真源收敛到 `route-registry` 派生（**先于 1.5 的后续扩展**）
- [ ] 3.3 品牌名统一 —— **本片排除**：产品决策，不可由 agent 自行改（已在 PRD §10 上报待裁决）
- [ ] 3.4 数据页口径归一（先取证再定性：audit-35 根因未取证）+ 统计去重 + `number-format.js`
- [ ] 3.5 令牌双轨收敛（先别名映射零回归，再按文件批次替换）
- [ ] 3.6 控件体系收敛（`<button>` 571 处四类分批迁 `UiButton` + `ui-btn`/`cohere-btn` 补 `:focus-visible`）
- [ ] 3.7 三态统一（新建 `UiErrorState.vue`、5 处自绘错误块、39 处空态迁 `EmptyState`、图标白名单消 emoji）
- [ ] 3.8 最差文案 Top 8 逐条改写 + 10 处 raw message 过 `formatUserError`（zh/en 同批）
- [ ] 3.9 账号页工具条三段式 + 卡片空值省略 + 数据页 paywall 合并

## 阶段 4：无障碍与适配

- [ ] 4.1 浅色档对比度重取 + `tokens.slots.test.js` 的 ≥4.5 断言扩到 `:root`
- [ ] 4.2 579 处裸 hex 收编（`Accounts.vue` 优先）
- [ ] 4.3 `UiInput` 自动 id 绑 `for`；134 处孤岛 label；`aria-required`
- [ ] 4.4 49 处非 button 点击补键盘可达（**与 3.6 同控件层，须按组件粒度归批**）
- [ ] 4.5 「更多」菜单 roving tabindex + 方向键 + Esc + 焦点回收
- [ ] 4.6 toast 容器 `role="status"` / `aria-live`
- [ ] 4.7 长度限制按 w10 修正：展示口径统一码点 + 就地显示该平台上限与真实单位 + 富文本补上限
- [ ] 4.8 38 处 index `:key` 改稳定键；37 个 `<img>` 补 lazy 与宽高占位

## 阶段 5：门禁与第二前端面

- [ ] 5.1 `check-frontend-consistency.js` 扫描根可配置并纳入 `ops-center/frontend`（新基线需人工批准）
- [ ] 5.2 `check-max-lines.js` 的 `SCAN_DIRS` 补 `ops-center/frontend`
- [ ] 5.3 新增 `check-ui-wired.js` 未接线组件锁（清单只能缩小）
- [ ] 5.4 新增 `check-field-consumed.js` 死观测字段锁（**前置 1.8 已完成** ✅）
- [ ] 5.5 `contrast-audit.js` 接 CI（每周 + 主题 PR 必跑），判定域扩到全部视图 + 浅色档
- [ ] 5.6 导航行为埋点（先定义隐私边界与"数据就绪"判据：最小样本量 + 最小跨天数）

## 交付与收口

- [x] `01-docs/PRD-UX-AUDIT-IMPLEMENT-2026-10-18.md`（显示项 / 交互 / 校验 / 提示文字全清单）
- [x] openspec change 四件套（proposal / design / specs / tasks）
- [ ] `docs/frontend-interaction-spec.md` 追加导航、守卫与门禁章节（CRLF 基线需逐行保留）
- [ ] `CHANGELOG.md` 收口（append-only，先测行尾基线）
- [x] QM-1 打包三层判据（`build:vue` rc=0 → `electron-builder --dir` rc=0 → asar 含 `dist/index.html` 且 `offline:lost`/`onOfflineLost` 在产物内 → 隔离 userData 启动 10s 存活、stderr 0 字节、`electron` 进程计数前后相等）
- [ ] 视觉像素门禁浅档（阶段 0/1 只跑浅档；暗档自 1.1 起算）
- [ ] PR + CI 全绿 + 自动 squash 合并 + 记录回填（远程同步 PASS 与 `sync_*` 删除同次提交）
