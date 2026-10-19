# 执行记录：影视工程提示词资产层（批次一落地）

- **分支**：`film-batch1`
- **PR**：见远端分支（本记录随 PR 提交）
- **日期**：2026-10-20
- **依据**：`01-docs/RESEARCH-AI-FILM-OPENSOURCE-2026-10-19.md` §5.2 批次一 + §3.22.3 修订排期
- **PRD**：`01-docs/PRD-FILM-PROMPT-ASSETS-2026-10-20.md`
- **变更类型**：**混合 PR**（`apps/desktop/electron/` 运行时代码 + 数据资产 + 文档）→ 完整质量节拍

## 一、变更类型与隔离声明

| 项 | 内容 |
|----|------|
| 隔离方式 | 独立 worktree `<WORKTREE_ROOT>\mp-film-batch1`（**非 C 盘**，NTFS），分支 `film-batch1` |
| 依赖就绪 | `pnpm install --frozen-lockfile`（1m29s）+ `node scripts/verify-worktree-deps.js` → OK（11 项消费方解析通过，9 个 workspace 包） |
| 共享根状态 | 未在共享根落任何文件（起点与收尾均为 clean，stash 数 0） |
| 分层判定 | 含 `apps/desktop/electron/**` 运行时改动 ⇒ 混合 PR，不得借 docs-only 通道 |

> **踩坑记录（F 盘）**：首次把 worktree 建在 `<F_DRIVE_WORKTREE_ROOT>`，写入 `shot-grammar.json` 时报
> `EISDIR`。根因是 **F 盘为 exFAT**，不支持硬链接，而写工具走「临时文件 + 硬链接」的原子写入。
> 已 `safe-worktree-remove.ps1 -Force -ConfirmDirtyDiscarded` 清理并迁到 D 盘 NTFS。
> **后续纪律**：worktree 必须建在 NTFS 分区上；建前先 `Get-Volume -DriveLetter <X>` 查文件系统。

## 二、QM-1 打包验证证据

| 步骤 | 命令 | 结果 |
|------|------|------|
| 依赖解析门禁 | `node scripts/verify-worktree-deps.js` | OK（worktree 路径与 9 个 workspace 包均解析到本 worktree） |
| 打包 | `pnpm exec electron-builder --win --x64 --publish never` | **rc=0**；产物 `dist-electron\Multi-Publish.Setup.0.2.0.exe` |
| 验证 1：asar 清单 | `pnpm exec asar list dist-electron\win-unpacked\resources\app.asar` | film-kit 共 **52** 条目；新增三 JSON 与 **16 个 prompt `.md`** 全部在包内 |
| 验证 2：require 链 | 本次未改 `@multi-publish/rpa-engine`，跳过（该验证针对 rpa-engine 链接；本 PR 未触碰） | N/A |
| 验证 3：启动 | `node qm1-startup-check.cjs`（8s 窗口 + 存活断言 + env 剔除） | **PASS**：窗口期内未退出；stdout 7732 B；**stderr 0 B** |

### 启动验证的三层判据与隐含前提

```
① 进程存活（单独断言）  → 通过（若提前退出即 FAIL，不因 stderr 空而判绿）
② stderr 命中已知红线  → 未命中
③ stderr 为空          → 是 ⇒ PASS
```

**告警（如实记录）**：父环境带有 `ELECTRON_RUN_AS_NODE=1`，已在子进程环境中**显式剔除**。
该变量会让任何 Electron 可执行文件以纯 Node 模式静默退出（rc=0、stdout/stderr 皆空、不建窗口），
与「启动干净」完全同形。本次验证的 `qm1-startup-check.cjs` 按 AGENTS.md 要求独立断言存活 + 剔除变量
+ 出声告警，三件事都做了。

## 三、测试证据

| 套件 | 用例数 | 结果 |
|------|-------|------|
| `electron/services/film-engineering/`（26 文件） | 407 | 全绿（既有） |
| 同上 + `src/views/film-auto`（29 文件） | **456** | **全绿**（含新增） |
| `prompt-library.test.js`（新增） | 28 | 全绿 |
| `shot-duration.test.js`（新增） | 37 | 全绿 |
| `kit-loader.test.js`（扩充 23 → 51） | 51 | 全绿 |
| `auto-plan.test.js`（扩充 44 → 51） | 51 | 全绿 |

### 本轮修正的两个测试契约（都是「实现更正确后契约需同步」，不是掩盖失败）

1. **`shot-library.real-kit.test.js` 的 `BLOCK_HEADINGS` 断言**：原为「抽取向导集合 **严格等于** 方法论块标签」
   （当时同为 7）。v7 把方法论扩到 11 块后该断言失效。经判定：`BLOCK_HEADINGS` 的语义是
   「从随包 153 镜语料里抽取块」，语料只含原 7 块；与「方法论有几块」**不是同一概念**。
   故改为断言真实不变量：① 抽取集合 **⊆** 方法论块（不许凭空造标题）；② v7 新增四块确实存在。
   **没有**改成「把新块也塞进 BLOCK_HEADINGS」——那会让抽取器去找语料里根本不存在的标题。

2. **`kit-loader.test.js` 的夹具**：`KIT_FILES` 从 4 扩到 7 后，最小夹具需同步补三份 JSON 与
   `prompts/tasks`。这是契约扩展的正当后果，不是放宽判据。

## 四、设计决策记录（三条，均可被反驳但仍成立）

### D1：缺失 vs 损坏必须分开处理

初版实现把新资产做成**硬必填**，结果 6 个测试文件 41 例当场失败——那 41 例测的是
shot-library 逻辑，与资产完整性无关。这个失败本身就是信号：硬必填把所有消费方耦合到了最新资产。

改判：**fail-closed 的对象是「损坏的数据」，不是「不存在的增强」**。

- 损坏（存在但非法）→ 整级不可用（绝不用半份数据）
- 缺失（不存在）→ 可用 + `assetWarnings`（可见不静默）+ `requireAssets: true` 严格模式

严格模式给导入校验用，`loadFilmKitChain` 透传后可在缺失时回退到 asar 内置包——
**老用户升级后实际拿到的是随包新资产**，而不是瘫痪。

### D2：时长字段是纯增量，不替换 `seconds`

`seconds` 是用户输入的档位意图，`durationMs` 是按台词的物理估计，两者都有信息量。
现有 5 个消费方只读 `seconds`，替换它属不必要的破坏性变更。故新增
`durationMs` / `durationSec` / `durationSource` / `estimatedDurationSec` / `durationSourceCount` 五个字段，
**既有 `seconds` 与 `plannedDurationSec` 语义一字不动**（有测试锁定）。

### D3：色盘注入串必须校验「含全部主色」

色盘的价值不在「文件里存了 4 个颜色」，而在「每次生成都原样粘贴同一串」。
注入串漏一个色，模型就自行补一个——漂移从这一刻开始。故 `validatePalette` 断言
`paletteLine.<locale>` 包含每个 `primary[].hex`。这是把「文档纪律」变成「机械判据」的一例。

## 五、门禁执行情况

| 门禁 | 结果 |
|------|------|
| 行尾/编码两口径对账 | 见 PR 提交后取证 |
| 品牌残留 | 见 CI Gate 12 |
| 文档同步 | 见 CI doc-gate |
| QM-1 打包 | ✅ rc=0 + 三验证 |
| TDD | ✅ 先写测试（`shot-duration.test.js` / `prompt-library.test.js` 在实现前先跑红） |
| QM-2 代码必检项 | ✅ 纯函数模块零 IO；无同步 CPU 密集原语；无新增全局组件；无 Electron 安全面改动 |
| QM-6 双模型评审 | 数据资产 + 纯函数，S 复杂度；按决策矩阵不调外部模型（CCG 判定已落 `.ccg/reviews/`） |

## 六、遗留与后续

| 项 | 说明 |
|----|------|
| UI 未接线 | 方法论标签页仍按 7 块渲染；新 4 块与台账/配方/枚举/色盘/合规清单的 UI 分区属批次二 |
| 导入 IPC 未接 `requireAssets` | 能力已提供，接线属批次二 |
| F8 三维提示词未做 | 本批次只提供 `generate_shot_prompt` 的 system/user 与 `frame_constraint` 规则 |
| TTS 未接 | 优先级链已就绪，只需在 TTS 完成时填 `ttsDurationMs` |
| `qm1-startup-check.cjs` | 一次性验证脚本，已按 R0 走 `safe-delete` 清理，未入库 |

## 七、远程同步

| 远程同步 | 由门禁推导 |
|---|---|
