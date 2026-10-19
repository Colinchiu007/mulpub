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
| 验证 1：asar 清单 | `pnpm exec asar list dist-electron\win-unpacked\resources\app.asar` | film-kit 共 **52** 条目；新增三 JSON 与 **16 个 prompt `.md`** 全部在包内；本轮复验另确认 `dist/index.html` 与 `services/film-engineering/shot-duration.js` 在包内 |
| 验证 2：require 链 | 本次未改 `@multi-publish/rpa-engine`，跳过（该验证针对 rpa-engine 链接；本 PR 未触碰） | N/A |
| 验证 3：启动（**第二轮，真 PASS**） | 8s 窗口 + 存活断言 + env 剔除 | **PASS**：窗口期内未退出；stdout 19431 B；**stderr 0 B** |
| 验证 3 的第一轮 | 同上（清空 `dist-electron` 后首跑） | **NEEDS_REVIEW**：stderr 283 B，`Failed to load URL: …app.asar/dist/index.html — ERR_FILE_NOT_FOUND` |

### ⚠ 一次被抓住的「假绿」（必须留档）

第一次跑 QM-1 时启动验证是 **PASS（stderr 0 B）**，但那个 PASS 是在**含有上一轮会话遗留 `dist/` 的 `dist-electron` 产物**上取得的。
本轮因为代码改动重跑打包、按规范先 `Remove-Item dist-electron`，新 asar 里没有 `dist/index.html`（本 worktree 从未构建过前端），启动即报 `ERR_FILE_NOT_FOUND`。

三层判据在这里起了作用：它不是红线（不在黑名单里），但 stderr 非空 ⇒ 判 **NEEDS_REVIEW 而不是 PASS**。随后 `pnpm build`（会先 vite 构建再打包）生成 `dist/`，复跑才拿到真正的 PASS。

**教训**：`rm -rf dist-electron` 之后，asar 里缺什么取决于**本 worktree 是否构建过前端**，与「代码对不对」无关。清空产物后的第一次 PASS 才算数；沿用旧产物上的 PASS 属于把别人的成果当自己的证据。

### 启动验证的三层判据与隐含前提

```
① 进程存活（单独断言）  → 通过（若提前退出即 FAIL，不因 stderr 空而判绿）
② stderr 命中已知红线  → 未命中
③ stderr 为空          → 是 ⇒ PASS
```

**告警（如实记录）**：父环境带有 `ELECTRON_RUN_AS_NODE=1`，已在子进程环境中**显式剔除**。
该变量会让任何 Electron 可执行文件以纯 Node 模式静默退出（rc=0、stdout/stderr 皆空、不建窗口），
与「启动干净」完全同形。验证脚本按 AGENTS.md 要求独立断言存活 + 剔除变量 + 出声告警，三件事都做了。

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
| 行尾/编码两口径对账 | ✅ 提交后 `--numstat` 与 `--ignore-cr-at-eol --numstat` 完全一致（+3504/-19）。过程中抓到一次真差异：`prompt-doctrine.json` 的 **HEAD 版本末尾无换行符**（由 `fetch-hell-grind-kit.py` 生成），我加了尾换行导致 `}` 被算作 1 行删除（179/1 vs 178/0）。正解是对齐生成器的无尾换行约定，而不是把新增记进基线。 |
| 品牌残留 | ✅ PASS（扫描 10810 个 tracked 文件） |
| 文档绝对路径 | ✅ PASS（首次 FAIL：执行记录里写了 worktree 绝对路径，改为 `<WORKTREE_ROOT>` / `<F_DRIVE_WORKTREE_ROOT>` 占位符形态） |
| 文档同步 | 见 CI doc-gate |
| QM-1 打包 | ✅ rc=0 + 三验证（见 §二） |
| TDD | ✅ 先写测试（`shot-duration.test.js` / `prompt-library.test.js` 在实现前先跑红） |
| QM-2 代码必检项 | ✅ 纯函数模块零 IO；无同步 CPU 密集原语；无新增全局组件；无 Electron 安全面改动 |
| QM-6 双模型评审 | ✅ **真实跑过**，见 §五之二 |

### 五之二、QM-6 双模型对抗审查（真实执行记录）

**这一节是修正后才写成的。** 本记录的第一版在这里写的是「数据资产 + 纯函数，S 复杂度；按决策矩阵不调外部模型」——那句话与同一提交里三份 `.ccg/reviews/*.json` 的 `mode=dual, status=pending` 直接冲突。它被本次审查自己的 i6 条抓出来了：占位工件没说话，是记录替它说了谎。

#### 第一轮：失败（必须留档）

```
sh scripts/deep-review.sh
→ critic=claude 评审失败：JSON解析失败:模型输出被截断，JSON 不完整
  （括号计数恰好配平 33/33，但结尾不是 }，被砍断的是最后一个字符串，共 18857 字符）
→ RC=2
```

原因：单提交的 diff 是 **4058 行**，critic 输出超长被截断。引擎自己的诊断写着「重跑同样输入多半还是截断」。

处置：**不重跑、不换后端、不降标准**，而是按体积把单提交拆成三次逻辑提交（docs / 数据资产 / 运行时代码），让每条 diff 都进得了 critic 的输出预算。附带好处是历史可读性变好——三部分本来就互不依赖。

#### 第二轮：成功

| 项 | 读数 |
|----|------|
| 后端 | critic=`claude`（ABS 解析 via `~/.local/bin`）× proposer=`opencode`（ABS via `npm-global`），跨家族校验通过 |
| 基线 | `origin/main`（4243 行） |
| 首轮产出 | **8 条问题**，4 个维度（correctness / security / performance / maintainability），最低分 **6** |
| 收敛出口 | 引擎第三档「自扮演裁决」（`self_play`，置信权重 0.6；6 条待裁决，其中 1 条高危域） |
| 产物 | `.adversarial/ccg-deep-01258c7a/`：`critique-v1.md` / `proposal-v1.md` / `adjudication.json` |

#### 8 条发现与处置（全部成立，全部已修）

| ID | 严重度 | 维度 | 问题 | 处置 |
|----|--------|------|------|------|
| i1 | Warning | correctness | 自动模式把整段 `beat.text` 当台词计时长（动作描述按 8 字/秒算），且逐镜时长警告只挂 `shots[].durationWarnings`，`plan.warnings` 看不到 → 「超限必须拆解」静默 | ✅ 新增 `extractDialogueText()` 按引号抽取真台词（无引号退化为整段并标 `usedQuotes=false`）；新增 W9 聚合，**只覆盖 overflow 与 truncation 两类实质事件**，不把良性提示变成噪音 |
| i2 | Warning | security | `resolveInside` 只做词法 `path.resolve`，注释却宣称「越界符号链接一律拒绝」 | ✅ 实现 `resolveSymlinks`：`fs.realpathSync` 后二次断言包含关系；解析失败 fail-closed |
| i3 | Warning | correctness | `MAX_AUTO_SHOT_SEC=12` 配档位 `[5,8,10]` → 12s 不可达、`rawSec > maxSec` 分支结构上不可能触发；注释却写「同源」 | ✅ 上限改为 `Math.max(...AUTO_SHOT_SECONDS)`；新增 `durationTiers` 入参让 kit 成为运行时事实源；**没有**直接把 12 塞进档位（那会改 `validateAutoInputs` 的输入域，属破坏性变更，不该藏在缺陷修复里） |
| i4 | Warning | maintainability（**高危域 datamigration**） | 四个 `validate*` 都不读 `schemaVersion`，本 PR 引入的 `schemaVersion: 2` 纯装饰 | ✅ 新增 `checkSchemaVersion`：整数 + 受支持集合 + 可选 `allowMissing`；三个新资产要求精确 1，doctrine 允许缺失（历史兼容）但声明后在 [1,2]。**高危域的处置是直接消除争议而不是自扮演豁免** |
| i5 | Warning | correctness | 纯向上吸附导致 40 字→5s、41 字→8s（+60%） | ✅ 加 `toleranceSec`（默认 0.3s）——容差内取该档；同时回传 `rawSec`/`snapDeltaSec` 让落差可见；W9 的 truncation 一类点名被压到更短档位的镜号。**拒不采纳**「下限=默认档」（会让用户 `seconds` 输入失效） |
| i6 | Warning | maintainability | `.ccg/reviews` 三份 pending、`findings=null`，而记录宣称 QM-6 已落 → **占位工件被当证据** | ✅ 见本节：真跑审查、修完 8 条、记录改为如实 |
| i7 | Info | correctness | `readOptionalJsonFile` 对字面 `null` 的 JSON 判为缺失静默放行（第三个静默分支） | ✅ 按损坏处理并点明「文件存在但不是有效对象」 |
| i8 | Info | correctness | `countSpeechUnits` 把假名/谚文按汉字 8 字/秒折算 → 日韩文案时长被低估 | ✅ 字计数收紧到汉字区间；假名/谚文单独计数并给出「请手工设定」的警告 |

#### 修复后的测试面

| 套件 | 修复前 | 修复后 |
|------|-------|-------|
| `shot-duration.test.js` | 37 | **50**（+6 引号抽取 / +2 日韩 / +2 落差回传 / +1 端到端 / 容差改写 3 例） |
| `kit-loader.test.js` | 51 | **59**（+4 checkSchemaVersion / +4 接线 / +1 字面 null） |
| `prompt-library.test.js` | 28 | **32**（+4 符号链接越界） |
| `auto-plan.test.js` | 51 | **55**（+4 时长警告可见 / 注入档位） |
| film 相关合计（29 文件） | 456 | **486 全绿** |

>`i5` 有一半被驳回并写进 `adjudication.json` 的 `dismissedPart`：「任何非空台词镜至少 5s」不是实现选择，而是模型档位最小 5s 的客观边界；如实反映在 `rawSec`/`snapDeltaSec` 上即可，不因此改语义。

## 六、遗留与后续

| 项 | 说明 |
|----|------|
| UI 未接线 | 方法论标签页仍按 7 块渲染；新 4 块与台账/配方/枚举/色盘/合规清单的 UI 分区属批次二 |
| 导入 IPC 未接 `requireAssets` | 能力已提供，接线属批次二 |
| F8 三维提示词未做 | 本批次只提供 `generate_shot_prompt` 的 system/user 与 `frame_constraint` 规则 |
| TTS 未接 | 优先级链已就绪，只需在 TTS 完成时填 `ttsDurationMs` |
| 自动模式的时长口径仍是「引号优先、无引号退化为整段」 | 无引号的长动作镜仍会高估；已由 `durationRawSec` 与 W9 暴露，彻底解决需要剧本层面的台词/动作分离（批次二） |
| `qm1-startup-check.cjs` | 一次性验证脚本，已按 R0 走 `safe-delete` 清理，未入库 |

## 七、远程同步

| 远程同步 | 由门禁推导 |
|---|---|

