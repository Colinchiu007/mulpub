# Tasks

## 后端（ops-center）

- [x] 1. `app_menu_service.py`：`_seed_if_empty` → `_provision_from_catalog`，按 CATALOG 增量补齐缺失行（只补不改已有行）
- [x] 2. `app_menu_service.py`：`get_bootstrap_app_menu` 缺行 `sort_order` 兜底由 `0` 改为目录序号
- [x] 3. 模块 docstring 增补「目录供给」契约段，说明为何不能只在全空时播种
- [x] 4. `tests/test_app_menu_api.py`：3 条回归（缺行补齐 / 不覆盖运营者配置 / 页面与下发项目集合与顺序一致）
- [x] 5. 夹具改用 `_provision_from_catalog`；`_seed_if_empty` 全仓引用点清零
- [ ] 6. 后端门禁：`pytest` 全量（445 基线 + 3 新增）

## 桌面端主进程

- [x] 7. `_syncNowInner`：目录与运行时改为 `Promise.allSettled` 并行且互不门控，保持 10s 单请求预算
- [x] 8. 抽出 `_syncRuntimeBestEffort` / `_applyRuntimeSettled`，`模型服务未就绪` 分支仍拉运行时
- [x] 9. 新增 `setOnRuntimeUpdated` 注入点；`applyRuntime` 末尾回调，回调抛错不影响已应用状态
- [x] 10. `phase3-services.js` 接线：广播 `ops-center:runtime-updated`，窗口未创建/已销毁时静默跳过
- [x] 11. `preload/system.js` 暴露 `onOpsCenterRuntimeUpdated`；`access-control.js` 登记为 public；重打包 `index.bundle.js`
- [x] 12. `electron/services/ops-center-sync.test.js`：4 条回归（目录 500 仍应用菜单 / 未就绪仍拉 runtime / 回调触发 / 回调抛错无影响）+ 超时用例升级为并行契约
- [x] 13. `electron/bootstrap/phase3-services.test.js`：广播 channel 与窗口不可用两条断言

## 桌面端渲染层

- [x] 14. `src/api/ops-center-sync.js`：新增 `onOpsCenterRuntimeUpdated` 封装（非 Electron 环境返回空操作）
- [x] 15. `MpSidebar.vue`：onMounted 订阅、onUnmounted 成对取消；`loadAppMenu` 改为「仅成功时替换」
- [x] 16. `MpSidebar.appmenu.test.js`：3 条回归（事件到达免重启 / 重拉失败保留上一份 / 卸载取消订阅）
- [x] 17. ~~`useOpsCenterSync.js` 部分成功分支~~ **已撤销**（QM-6：该 UI 入口不存在，见 §「QM-6 第二轮」）
- [x] 18. ~~locales 成对新增 `syncPartialSuccess`~~ **已撤销**（死键）
- [x] 19. ~~`useOpsCenterSync.test.js` 部分成功断言~~ **已撤销**
- [ ] 20. 桌面端门禁：vitest 全量 + QM-1 打包验证 + `test:visual:pixel`

## 运营中心前端

- [x] 21. `AppMenu.vue`：更新生效时机与目录自动对齐说明，移除「需重启应用」表述
- [ ] 22. 前端门禁：`npm test` + `npm run build`

## 文档与收口

- [ ] 23. `01-docs/FEATURE-APP-MENU-2026-09-15.md`：修正过期内容（19 项 → 20 项、跨组限制已撤销），补数据供给/同步通道/生效时机/显示项与提示文字
- [ ] 24. `01-docs/PRD.md`：补「应用菜单同步」章节（数据校验、流程、功能逻辑、交互逻辑、显示项、提示文字）
- [ ] 25. `CHANGELOG.md` 收口本次变更（修复级）
- [ ] 26. `01-docs/learnings.md`：记录「双真源目录缺供给机制」pitfall 与「串行改并行的预算证据」pattern
- [ ] 27. `AGENTS.md` QM-2 增补跨端目录契约门禁条目
- [ ] 28. Bug 反思循环 5 步产出物（根因/逃逸链/系统性漏洞/回归保护/预防措施）

## 交付

- [ ] 29. QM-6 双模型外部评审（claude + opencode），Critical 清零
- [ ] 30. 提交、推送、创建 PR、CI 通过后合并
- [ ] 31. 部署后验证：线上 ops-center 列表出现 `copy-library`（共 20 项）；客户端下次启动后侧边栏按运营端显隐与顺序渲染（无需用户手动同步）
- [ ] 32. 记忆三写：内置记忆 / 外部记忆 / EverOS

## QM-6 双模型外部评审后的第二轮（2026-09-25）

- [x] 33. 生效模型改口径：应用端**启动时同步一次**，不引入轮询、不引入推送、不暴露任何同步入口
- [x] 34. `AppMenu.vue` 页面文案去掉「用户在设置页点立即同步」的指引，改为「客户端下次启动生效」
- [x] 35. 撤销 `modelProviders.syncPartialSuccess`（zh/en）与 `useOpsCenterSync` 部分成功分支及其测试（死键，UI 不可达）
- [x] 36. 补齐改用 SQLite `INSERT ... ON CONFLICT DO NOTHING`（并发唯一键冲突）
- [x] 37. 补齐只 `flush()`，由四个入口各自 `commit()`（恢复 `upsert_items` 整批原子性）
- [x] 38. `list_items` 按 `CATALOG_KEYS` 过滤，页面与下发同一份集合（脏 key 不显示也不下发，保留不删）
- [x] 39. 广播回调只传 `{ syncedAt }`，不传配置内容（对齐 D4）；phase3 转发起同步时间
- [x] 40. preload 新监听器进 `LISTENER_CASES` + 行为级用例（channel / event+payload 拆参 / 同一 channel+handler 退订）
- [x] 41. 新回归断言经「回退旧实现即红」实测（并发与原子性两条）
- [x] 42. `AGENTS.md` 门禁 ③ 改为条件式：结果面向用户才需区分部分成功；链路对用户透明时禁止新增 locale 键
- [ ] 43. 第二轮复评（Critical 清零确认）后放开 auto-merge


## QM-6 第二轮复评后的第三轮（2026-09-25）

- [x] 43. 复评判首轮 Critical **只修了一半**：`01-docs/FEATURE-APP-MENU-2026-09-15.md` §2 约束表、§6.2 下发流程图、§10 提示清单 T1、§14 遗留 L1 共 4 处仍是旧表述 → 全部改写为「启动时同步一次 / 下次启动生效 / 界面不提供手动入口」
- [x] 44. 同类残留扩到本 change 之外：`ops-center/docs/PRD.md:812`（描述已隐藏的同步卡片）、`ops-center/docs/OPERATIONS.md:194`（教运营者「桌面端点立即同步」）→ 改写并在 PRD 里如实登记 `runSyncNow` 已无生产调用方
- [x] 45. 收口方式由「逐处改」换成「关键词全仓扫 + 每条命中显式定性」：`立即同步` / `手动同步` 在 `.md/.vue/.py` 的命中逐条判定（6 改 / 历史归档与无关同名保留）；含不带关键词的变体「（自动或手动）」1 处
- [x] 46. `AGENTS.md` QM-2 两条新门禁与本文 §16.5 P7 落地「文案类修复必须复扫到 0 命中」
- [x] 47. 合并 `origin/main`（#2377/#2378）：`CHANGELOG.md` 手工解冲突时发现**本分支此前用范围替换加节，吞掉了 main 上两节**（`fix-toutiao-tab-load-hang`、`account-card-display-fix`）→ 改「取上游全文 + 前置新节」重建，核对 `git diff --numstat origin/main -- CHANGELOG.md` = **41 插入 / 0 删除**
- [x] 48. 合并后重跑：ops-center 前端 `npm test` 57 passed / 10 files + `npm run build` PASS；后端 `test_app_menu_api.py` 21 passed
- [ ] 50. 遗留（本 change 不做）：清理 `useOpsCenterSync.runSyncNow` 与 `modelProviders.syncNow`（zh/en）死键及其 3 条用例；跨端 CATALOG 一致性 CI 断言（见 §16.6）
