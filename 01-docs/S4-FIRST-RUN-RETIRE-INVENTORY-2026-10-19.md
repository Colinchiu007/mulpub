# S4「首跑引导下线」清点清单（PRD-UI-FLOW-CLARITY §14 #1 / §12）

> 2026-10-19 · 依据 origin/main `fe0f9c5aa` 全仓 `git grep -c 'FirstRun|firstRun|first-run'` 实测。
> 结论：**全仓 386 处命中里，真实运行时改动面只有 14 个文件（86 处）+ 20 个测试文件 + 2 张基线 PNG + 2 张基线登记行**；
> 其余 72 个 docs / 8 个 other 是历史记录（**不动**——历史文档不追改）。
> 此前「386 处须逐项人工清点」的恐惧被这次机械细分推翻：改动面完全可枚举。

## A. 运行时改动面（14 文件，按处置方式分组）

### A1. 整文件删除（2）
| 文件 | 说明 |
|------|------|
| `apps/desktop/src/views/FirstRun.vue` | 首跑引导组件本体 |
| `apps/desktop/electron/services/first-run.js` | `runSetup()/checkDeps()` 服务本体（`first-run:status` 三个发送点全在此） |

### A2. 渲染端删行/删条目（5 文件）
| 文件 | 命中 | 处置 |
|------|------|------|
| `src/config/route-registry.js` | 3 | 删 `/first-run` 路由登记（暗路由行 + table 行） |
| `src/router/index.js` | 1 | 删 `/first-run` 路由定义 |
| `src/App.vue` | 1 | 删 `isFullScreenRoute` 对 `/first-run` 的判断（其余全屏路由保留） |
| `src/api/publisher.js` | 2 | 删 `firstRunCheck` 导出 |
| `src/components/BackToTop.vue` | 1 | 删全屏路由排除名单里的 `/first-run` 项 |

### A3. Electron 主进程/preload 删行（6 文件）
| 文件 | 命中 | 处置 |
|------|------|------|
| `electron/services/first-run.js` | 整删 | 见 A1 |
| `electron/preload/system.js` | 5 | 删 `firstRunCheck`/`onFirstRunStatus` 两条桥接 + 注释行（**连带 preload.test.js 计数断言 -2**） |
| `electron/ipc-handlers/misc.js` | 3 | 删 `first-run:check` handler 与依赖注入解构 |
| `electron/ipc-handlers/license-access-control.js` | 1 | 删 `first-run:check` 白名单行 |
| `electron/bootstrap/phase1-context.js` | 2 | 删 `firstRun: createFirstRunService(...)` 装配 |
| `electron/bootstrap/phase5-ipc.js` | 2 | 删 misc handler 注册的 firstRun 依赖 |
| `electron/window.js` | 2 | 删 `firstRun.runSetup(mainWindow)` 调用与依赖解构 |

### A4. 语义保留项（必须写明，防止误删）
- `first-run-done` **标记文件语义保留**（防再次引导的判定仍被主进程其他逻辑读取时留观察窗；实施时以「删后全仓 grep `first-run-done` 为零读点」为准）。
- PRD §14 #1 裁决的是「下线」不是「删标记兼容」——旧用户机器上的标记文件留着无害。

## B. 测试改动面（20 文件）

| 类别 | 文件 | 处置 |
|------|------|------|
| 整删 | `src/views/FirstRun.test.js` | 随组件 |
| 契约锁改数 | `electron/preload.test.js` | `SYSTEM_METHODS` 删 2 项；`147 个方法` 计数断言 **147→145**（注释写明 -firstRunCheck/-onFirstRunStatus）；子系统键数断言（131/52 等）按实际重数 |
| mock 清理 | `src/api/publisher.test.js`、`src/views/views-coverage.test.js`、`views-coverage2.test.js`、`electron/bootstrap.test.js`、`phase1-context.test.js`、`electron/preload.test.js`（mock 行） | 删 `firstRunCheck`/`onFirstRunStatus`/`firstRun` 相关 mock 与用例块 |
| 视图覆盖锁 | `views-coverage*.test.js` 的 `FirstRunView (coverage)` describe | 整块删 |
| 其余 ~13 个 | grep 逐个核对（多为 mock 行/路由断言行） | 删行 |

## C. 视觉测试改动面

| 项 | 处置 |
|----|------|
| `scripts/run-pixel-tests.js:26` 的 `first-run` 行 | 删（连带 `waitFor: '.fullscreen-main h2:has-text("欢迎使用汤姆鱼")'`） |
| `autonomous-loop.js:43/71` 两行 | 删 |
| `base-screenshots/first-run.png` / `first-run-dark.png` | 删（`check-baseline-freshness` 对「基线有、CI 无渲染且未登记」会红 → 需按其口径在 visual-coverage-debt 或删除清单里消掉；以判据实际文案为准） |
| `contrast-audit-diag.txt` / `contrast-audit-report.json` | 生成物，不动 |

## D. 门禁预检清单（提交前本地全跑，避免 CI 轮回）

1. `check-route-registry.js`（删登记后应 PASS，路由数 36→35）
2. `check-unwired-tests.js`（删测试文件后核对登记表——**本轮教训**：`check-blanket-fs-mock.js` 的 KNOWN_BLANKET 若登记了 FirstRun 相关文件，删文件必须同步销登记）
3. `check-max-lines.js`（删行只会减不会加，应 PASS）
4. `check-locale-sync --keys`（FirstRun 的 locale 命名空间若成孤儿键，按 `--keys` 判据清）
5. `check-baseline-freshness.js --partial`（CI 渲染后核对）
6. `verify-security` / CCG hooks 照常

## E. 执行顺序（单 PR，预计 1 个工作会话）

1. 建隔离 worktree（`start-mp-task` / `gwm-task start ui-flow-firstrun-retire`）
2. A1 整删 2 文件 → A2/A3 删行 → 跑 `pnpm exec vitest run electron src/views/FirstRun src/api` 修测试
3. B 组测试清理 → C 组视觉清单 + 基线删除
4. D 组门禁全绿 → QM-1 **必做**（本阶段改 `electron/`，与 #3951/#4000 不同）
5. openspec 记录 + PR

## F. 本清点推翻/确认了什么

- **推翻**：「386 处须人工逐项清点」——细分后 docs 占 72 文件（历史记录不追改），真实改动面 86 处且全部机械可判。
- **确认**：preload 桥接（`firstRunCheck`/`onFirstRunStatus`）+ 计数型断言（147）+ license 白名单 + ipc-contract 的「悬空通道」锁（`ipc-contract.test.js` 会抓「preload 还有 invoke、主进程没 handler」的形状）是四个真正的风险点；删桥接必须四者同一次提交内对齐。
