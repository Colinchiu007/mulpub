# Tasks

## 后端（ops-center）

- [x] 1. `app_menu_service.py`：`_seed_if_empty` → `_provision_from_catalog`，按 CATALOG 增量补齐缺失行（只补不改已有行）
- [x] 2. `app_menu_service.py`：`get_bootstrap_app_menu` 缺行 `sort_order` 兜底由 `0` 改为目录序号
- [x] 3. 模块 docstring 增补「目录供给」契约段，说明为何不能只在全空时播种
- [x] 4. `tests/test_app_menu_api.py`：3 条回归（缺行补齐 / 不覆盖运营者配置 / 页面与下发项目集合与顺序一致）
- [x] 5. 夹具改用 `_provision_from_catalog`；`_seed_if_empty` 全仓引用点清零
- [x] . 后端门禁：`pytest` 全量（445 基线 + 3 新增） 〔归档时补记：CI `ops-center 后端测试` pass；本地全量最终 455 passed〕

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
- [x] 0. 桌面端门禁：vitest 全量 + QM-1 打包验证 + `test:visual:pixel` 〔归档时补记：CI electron-tests/QG 分片 pass；QM-1 打包 PASS（`--config.electronDist`）；视觉 15/18 经 main 同序列对照定性为既有基线漂移〕

## 运营中心前端

- [x] 21. `AppMenu.vue`：更新生效时机与目录自动对齐说明，移除「需重启应用」表述
- [x] 2. 前端门禁：`npm test` + `npm run build` 〔归档时补记：`npm test` 57 passed / 10 files、`npm run build` PASS（合并 main 后复跑）〕

## 文档与收口

- [x] 3. `01-docs/FEATURE-APP-MENU-2026-09-15.md`：修正过期内容（19 项 → 20 项、跨组限制已撤销），补数据供给/同步通道/生效时机/显示项与提示文字 〔归档时补记：FEATURE 文档升 v1.2（含 §3.2 供给规则、§6.2/6.4 双通道与通知链、§10.1、§16）〕
- [x] 4. `01-docs/PRD.md`：补「应用菜单同步」章节（数据校验、流程、功能逻辑、交互逻辑、显示项、提示文字） 〔归档时补记：PRD 应用菜单章节两份副本重写（目录 20 项、流程、排序分组、交互、显示项、提示文字、验收）〕
- [x] 5. `CHANGELOG.md` 收口本次变更（修复级） 〔归档时补记：CHANGELOG 收口（并修复了本 PR 早期误删 main 两节的问题，核对相对上游 0 删除）〕
- [x] 6. `01-docs/learnings.md`：记录「双真源目录缺供给机制」pitfall 与「串行改并行的预算证据」pattern 〔归档时补记：learnings 置顶复盘 + 后续三轮追加〕
- [x] 7. `AGENTS.md` QM-2 增补跨端目录契约门禁条目 〔归档时补记：AGENTS.md QM-2 两条 MUST 已合入 main〕
- [x] 8. Bug 反思循环 5 步产出物（根因/逃逸链/系统性漏洞/回归保护/预防措施） 〔归档时补记：FEATURE §16 五步产出物齐全（16.1-16.6）〕

## 交付

- [x] 9. QM-6 双模型外部评审（claude + opencode），Critical 清零 〔归档时补记：实际用 claude + codex 双模型跑三轮；Critical 全部处置完毕〕
- [x] 0. 提交、推送、创建 PR、CI 通过后合并 〔归档时补记：#2374 已合并 `43e62ce9`〕
- [ ] 31. 部署后验证：线上 ops-center 列表出现 `copy-library`（共 20 项）；客户端下次启动后侧边栏按运营端显隐与顺序渲染（无需用户手动同步）
- [x] 2. 记忆三写：内置记忆 / 外部记忆 / EverOS 〔归档时补记：内置记忆 2 文件 + 外部记忆（learnings/quality-gates/AGENTS/CHANGELOG）+ EverOS extracted 已检索确认〕

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
- [x] 3. 第二轮复评（Critical 清零确认）后放开 auto-merge 〔归档时补记：已放开并据此合并；第三轮另发现归因需更正，见 §第四轮记录〕


## QM-6 第二轮复评后的第三轮（2026-09-25）

- [x] 43. 复评判首轮 Critical **只修了一半**：`01-docs/FEATURE-APP-MENU-2026-09-15.md` §2 约束表、§6.2 下发流程图、§10 提示清单 T1、§14 遗留 L1 共 4 处仍是旧表述 → 全部改写为「启动时同步一次 / 下次启动生效 / 界面不提供手动入口」
- [x] 44. 同类残留扩到本 change 之外：`ops-center/docs/PRD.md:812`（描述已隐藏的同步卡片）、`ops-center/docs/OPERATIONS.md:194`（教运营者「桌面端点立即同步」）→ 改写并在 PRD 里如实登记 `runSyncNow` 已无生产调用方
- [x] 45. 收口方式由「逐处改」换成「关键词全仓扫 + 每条命中显式定性」：`立即同步` / `手动同步` 在 `.md/.vue/.py` 的命中逐条判定（6 改 / 历史归档与无关同名保留）；含不带关键词的变体「（自动或手动）」1 处
- [x] 46. `AGENTS.md` QM-2 两条新门禁与本文 §16.5 P7 落地「文案类修复必须复扫到 0 命中」
- [x] 47. 合并 `origin/main`（#2377/#2378）：`CHANGELOG.md` 手工解冲突时发现**本分支此前用范围替换加节，吞掉了 main 上两节**（`fix-toutiao-tab-load-hang`、`account-card-display-fix`）→ 改「取上游全文 + 前置新节」重建，核对 `git diff --numstat origin/main -- CHANGELOG.md` = **41 插入 / 0 删除**
- [x] 48. 合并后重跑：ops-center 前端 `npm test` 57 passed / 10 files + `npm run build` PASS；后端 `test_app_menu_api.py` 21 passed
- [x] 49. QM-6 第三轮收口确认：claude 判 `critical_cleared: true`、0 残留（20 处命中全定性，并补出 `Dashboard.vue` 同名按钮属平台内容同步、`locales` 的 `syncNow` 死键）；codex 两次尝试均无结论输出（RC=1），故本轮记为**单模型确认**
- [x] 50. 补注册写保护计划任务：**受本机权限阻断**（见下条证据），Health 任务已注册成功，Write Guard 任务无法注册
- [x] 51. QM-6 第三轮 codex 成功输出**推翻**本 change「全仓 `-a` 前扫到 0 命中」的判据：`01-docs/PRD.md` / `learnings.md` 等含 NUL 字节的文档被 grep/rg 默认当二进制静默跳过（同文件 `grep -rn` 计 1、`grep -rna` 计 10），改用 `-a` 复扫另得 15 处现行文档残留；已逐条核实并把「复扫必须带 `-a`」写入 `AGENTS.md` 门禁
- [ ] 52. 另案（**不属本 change 范围**，已核实现行事实供接手者直接用）：清理「模型服务运营同步卡片」旧线的 15 处文档残留。
  现行代码事实（2026-09-26 实测，改文档以这三条为准）：
  ① 卡片由 **`0c91b837`（#2199 "hide ops backend config from users"）** 隐藏；`ModelProviders.vue` 现仅剩 3 处命中且全非入口
  （424 行是「限流由运营后台同步下发」提示文案、526 行注释、1346 行 CSS 注释），**页面上不存在可点击的同步卡片**；
  ② 但 IPC 与 preload 通道**仍在**：`ipc-handlers/ops-center-sync.js:30` 仍注册 `ops-center-sync:now`、
  `preload/system.js:253` 仍暴露 `opsCenterSyncNow`；③ `autoSync` 语义仍在（`services/ops-center-sync.js:141/151/176`）。
  故正确口径为「能力保留、入口对用户隐藏、生效时机＝客户端启动时同步一次」：既不能照旧文案写「用户点立即同步」，
  也不能写成「该能力已删除」。
  待改清单：`01-docs/PRD.md:584/3991/4006/4037/4048/9115/12522/12537/12568/12579`（§7.4.5 交互与验收 ① 要求点「立即同步」）、
  `01-docs/PRD-sync-zero-config.md:127/148`（状态仍「待评审」，设计上保留该按钮，与 ① 冲突，应标注为被后续决策取代）、
  `01-docs/PRD-MODEL-LIST-SORT-ORDER-2026-09-23.md:75`（页面说明含「重启或手动同步」）、
  `01-docs/product-manual.md:321/342`（用户手册把「立即同步」列为可用操作）
- [ ] 53. 遗留（本 change 不做）：清理 `useOpsCenterSync.runSyncNow` 与 `modelProviders.syncNow`（zh/en）死键及其 3 条用例；跨端 CATALOG 一致性 CI 断言（见 §16.6）

### 50. 写保护计划任务注册结果（2026-09-25 23:0x→23:2x，本机权限实测 + 已闭合）

**最终状态：两个计划任务均已注册、watcher 常驻、共享根健康门禁返回 0。**

- `bootstrap-write-guard.ps1` 在共享根（已含 #2375 修复）跑通到 `[2/5] 自检` 的注册步骤：
  `Session Isolation Health` **注册成功**（`Get-ScheduledTask -TaskPath '\Multi-Publish'` 可见，State=Ready）。
- `Session Isolation Write Guard` 注册报 `Register-ScheduledTask : 拒绝访问 HRESULT 0x80070005`。
- **二分定位到触发器类型**（同 principal、同 action、同文件夹，只换参数）：
  `-AtLogOn` 的三种组合（plain / ExecutionTimeLimit 3650d / 2min）**全部 FAIL**，
  `-Once` **PASS** → 不是任务名、路径、时限或动作的问题，是**非管理员令牌不允许注册登录触发器**。
- 换 API 路径同样失败：`schtasks /Create /SC ONLOGON`（无嵌套引号干扰的最小 /TR）返回 RC=1 拒绝访问。
- 账户事实（提权前）：`IsInRole(Administrator)=False`、`EnableLUA=1`、`ConsentPromptBehaviorAdmin=5`，而 `to_co` **在** local Administrators 组内 → 只是当前进程为受限令牌，UAC 提权可解。
- **✅ 闭合方式（经用户批准提权）**：`Start-Process powershell -Verb RunAs -File <ASCII-only 包装脚本>`（包装脚本内先回写 `elevated=True` 再调 `install-session-isolation-task.ps1 -Minutes 15`）→ 两个任务均注册成功；随后**非提权** `Start-ScheduledTask -TaskName 'Session Isolation Write Guard' -TaskPath '\Multi-Publish\'` 让 watcher 立即常驻。
- **复验（不采信 `$LASTEXITCODE`）**：`Get-ScheduledTask` → Health=Ready、Write Guard=Running；`Get-ScheduledTaskInfo.LastTaskResult=267009`（0x41301＝正在运行，非错误）；`guard-shared-root-writes.ps1 -Watch` 进程存在；健康报告 `writeGuard = {taskRegistered:true, running:true, violations:0, quarantineCount:0, ok:true}`。
- **⚠️ 注册成功后不得再以非提权身份重跑 `bootstrap-write-guard.ps1`**：其 `[2/5] 自检` 会以 `-Force` 重注册那个 AtLogOn 任务，受限令牌下 0x80070005 失败并打断 bootstrap（本次实测复现）。同理 `installer_rc=1` 是 `&` 调用 .ps1 后 `$LASTEXITCODE` 的残留值，与成败无关——按它记账会把"已注册成功"误记为失败。
- **顺带修掉两处挡住"环境缺口已闭合"结论的红项**（与写保护本身无关）：健康报告当时为
  `marker:false` + `hooks[post-checkout].match:false`。分别按文档动作处理：
  ① `session-guard.ps1 -Branch main` 写 `.agent_context/expected-branch`（该文件由 session-guard 负责，钩子本身不写它）；
  ② `install-git-hooks.ps1` 把 `scripts/hooks/*` 覆盖安装到 `.git/hooks/`，使 installed 与仓库源一致（`git hash-object` 均为 `f6bbd56927`）。
  之后 `mp-worktree-health.ps1 -RequireWriteGuard -RequireClean -RequireHooks -RequirePrimary` 返回 **0 / ok=true**（11 个 worktree 全 ok）。
- **该红项的根因不在本 PR 范围，且我未把它查清（如实登记）**：曾假设"某个 worktree 的旧版钩子经共享 `.git/hooks` 覆盖了机器级钩子"，
  实测**不成立**——11 个 worktree 的 `scripts/hooks/post-checkout` 哈希全部相同。仓库里另有 `mp-fix-health-hook-append-tolerance`
  工作区正在处理"健康检查对钩子的比对容忍度"，`match:false` 更可能属于那一类（例如安装后被其他工具追加内容）。
  **副作用声明**：我为让门禁转绿执行了覆盖安装，因此当时 `.git/hooks/post-checkout` 上若有其他工具追加的内容已被替换；
  该文件不受 git 跟踪、无备份，此项不可复原。后续排障归那一工作区，本 PR 不再动钩子。
- **⚠️ 本次留下的一处取证失误（记为教训）**：我在覆盖安装**之前**没有留存或 diff 旧的 `.git/hooks/post-checkout`，
  等于销毁了案发现场。更严重的是，我一度把原因写成"旧版用 `${2}` 取来源 commit"——那是**未实测的推断且与事实相反**
  （现行源文件用 `BRANCH_CHECKOUT="${3:-0}"`，且该钩子是共享根分支守卫，与 expected-branch 无关），已在同一次编辑中删除。
  规则：修漂移前先 `cp` 现场或 `diff --no-index` 落证据；写进仓库记录的因果句必须有当次可复跑的命令支撑，
  "看起来能解释现象"不构成证据。
- **当初考虑过但未采用的绕过方案**（会静默改变隔离机制语义）：把 guard 触发器改成 `-Once + -RepetitionInterval`（受限用户可注册，但不是"登录即常驻"，watcher 有间歇窗口），
  或改由 `startup` 文件夹/注册表 `Run` 键自启（同样非计划任务，且不受 `mp-worktree-health.ps1 -RequireWriteGuard` 认可）。
