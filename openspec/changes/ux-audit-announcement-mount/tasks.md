# 任务：公告横幅接线（ux-audit-announcement-mount）

## 1. 测试先行（红）

- [x] 1.1 `src/components/AnnouncementBanner.test.js`：空列表不渲染任何容器（含 `role="region"`）
- [x] 1.2 有公告时按 severity 分档渲染，且 `content` 缺席不渲染空容器
- [x] 1.3 未知 / 缺失 severity 落 `info` 档，整条不得被丢弃
- [x] 1.4 `maintenance` 档不得出现关闭按钮；`info` / `warning` 可以关
- [x] 1.5 关闭后写入 `localStorage`，重挂载后仍隐藏；**新增公告不得让已关闭项复活**
- [x] 1.6 无 `id` 的旧数据按 `severity:title:content` 记忆，同内容重启后命中同一键
- [x] 1.7 可访问名：区域 `aria-label` 与关闭 `aria-label` 来自 locale，切 `en` 后不得残留中文
- [x] 1.8 locale 成对自锁：`announcement` 域 zh/en 键集合必须相等（不依赖 Gate 7，它对本仓拆分文件实测失明）
- [x] 1.9 **接线锁**：`App.vue` 必须真的渲染 `<AnnouncementBanner`，且只在工作台外壳分支渲染

## 2. 实现（绿）

- [x] 2.1 `src/locales/announcement/{zh,en}.js` 新域 + 在 `locales/zh.js`、`locales/en.js` 注册命名空间
- [x] 2.2 `useOpsCenterRuntime.js`：删除写死中文的 `SEVERITY_LABELS` 常量导出（改为机器值 `SEVERITIES` 白名单）
- [x] 2.3 `AnnouncementBanner.vue`：全部文案走 `useI18n()`，severity 标签按 locale 取，未知值兜 `info`
- [x] 2.4 `App.vue`：在 `.mp-shell-main` 的 `NavBar` 之后、工作区 `main` 之前挂载组件
- [x] 2.5 若 `structure-lock.test.js` 因新域报错，按它要求的形状补齐（不得改宽它的判据）
- [x] 2.9 **接线过程中自己引入的回归**：横幅 `onMounted` 的浮空 promise 让全域出现 5 条 Unhandled Rejection（测试全绿，只有 `Errors` 行看得见）。
      修在边界（`loadRuntime()` 永不 reject）而不是每个调用点补 `.catch`，并加 2 条行为锁。见记录"自测（全域）"行。

## 3. 反证

- [x] 3.1 `scripts/announcement-mount-contract-mutate.js`：C1–C6 逐个注入（形态规矩沿用 1.3：
      必须可执行、不得攻击断言本身、解析前剥 ANSI、`collected > 0` 下界、`RUN_UNCLEAN` 档）
- [x] 3.2 末跑必须 `CAUGHT=6/6` 且驱动 rc=0

## 4. 文档与验证

- [x] 4.1 `01-docs/PRD-ANNOUNCEMENT-BANNER-MOUNT-2026-10-21.md`（含显示项、交互、数据校验、残留限制）
- [ ] 4.2 审计文档 1.2 行状态 + 文末落地记录；CHANGELOG 条目
- [ ] 4.3 `openspec/records/ux-audit-announcement-mount.md`（门禁表 + 现场读数）
- [ ] 4.4 全域 `vitest run src` 对照（先跑 `build:preload`，否则 bundle 新鲜度断言会 ENOENT）+ 聚合 eslint
- [ ] 4.5 静态门禁：`check-unwired-tests` / `check-no-brand-residue` / `check-doc-abs-paths` / locale 成对
- [ ] 4.6 像素门禁：`settings-general` 等基线预期零回归（`announcements` 为空时组件不渲染任何东西）；
      若 CI 报回归，只允许按"同一次 CI 渲染"刷新，禁止本机截图与 `--update-baseline`
- [ ] 4.7 QM-6 双模型评审与逐条处置
- [ ] 4.8 PR + CI + 合并后回读 main push

## 5. 遗留（不在本批解决，必须写明）

- [ ] 5.1 浏览器/登录标签前台时公告被内嵌视图遮住（design D1 方案 C 的定义性代价）。
      真解是几何双向通道（`topOffset` 参数已存在但四个消费点都没用过），另批
- [ ] 5.2 公告是拉取式（仅挂载时 `loadRuntime()`），长时间开着不会自动获得新公告
- [ ] 5.3 `announcement-banner-dismissed` 无上限累积
- [ ] 5.4 反证驱动接进 CI（任务 #23 同批欠账）
