---
record: bundle-untrack
task: 把 5 个受管构建产物（preload/paginator bundle）移出版本控制，消除 build:vue 后的 stat-dirty
date: 2026-10-17
branch: bundle-untrack
sync_status: PENDING
sync_reason: PR 尚未合并（记录随代码 PR 落地，合并后回填 merge SHA）
sync_backfill_owner: bundle-untrack 会话（回填 PR）
---

# 执行记录：构建产物移出版本控制（bundle-untrack，2026-10-17）

## 0. 变更类型与隔离

| 项 | 内容 |
|---|---|
| 变更类型 | 构建配置 / 版本控制面（`.gitignore` + `git rm --cached`），**不改任何运行时代码** |
| 隔离方式 | 独立 worktree `<仓库父目录>\mp-worktrees\<任务名>`，裸分支 `bundle-untrack`，基线 `origin/main` = `a699ef825` |
| 动因 | 采集页修复任务里发现：`pnpm run build:vue` 会重写 5 个**受管** bundle，使 `git status` 出现 `M`，而 `git diff` 内容为空（`core.autocrlf` 归一后无差异）⇒ **stat-dirty 噪音**，每次构建后都要手工还原才能保持提交干净 |

## 1. 被移出的 5 个产物

| 文件 | 大小 | 生成者 |
|---|---|---|
| `apps/desktop/electron/preload/index.bundle.js` | 96957 | `build:preload`（`scripts/build-preload.js`） |
| `apps/desktop/electron/home-shell-preload.bundle.js` | 97988 | `build:preload` |
| `apps/desktop/electron/monitor-preload.bundle.js` | 15653 | `build:preload` |
| `apps/desktop/electron/services/generated/card-paginator.iife.js` | 7947 | `build:paginator`（`scripts/build-paginator.js`） |
| `apps/desktop/electron/services/stealth/stealth-preload-enhanced.bundle.js` | 17144 | `build:preload` |

## 2. 安全性论证（为什么移出不会破坏任何路径）

| 路径 | 是否先构建 | 依据 |
|---|---|---|
| `pnpm run build` | ✅ | `build` = `build:vue && electron-builder` |
| `pnpm run build:win` | ✅ | `build:vue && electron-builder --win --x64` |
| `pnpm run build:dir` | ✅ | `build:vue && electron-builder --dir` |
| `pnpm run dev:electron` | ✅ | `build:preload && wait-on … && electron .` |
| CI `.github/workflows/build.yml` | ✅ | L153 `pnpm --filter @multi-publish/desktop build:vue` |

而 `build:vue` = `build:preload && build:paginator && vite build` ⇒ **上表每一条都会先重建这 5 个文件**。

## 3. 决定性验证（实测，不是推理）

**验证 A：删掉即可重建**

1. 物理删除全部 5 个文件
2. `pnpm run build:vue`（19s）
3. 结果：**5/5 全部重建** ✅

**验证 B：构建后不再产生 stat-dirty**（本次改动的核心目标）

| 判据 | 读数 |
|---|---|
| unstaged 的 bundle 修改（`^ M …bundle.js`） | **0** ✅（改动前实测为 1：`M home-shell-preload.bundle.js`） |
| 未跟踪的 bundle（`^?? …bundle.js`） | **0** ✅（证明 `.gitignore` 生效） |
| `git check-ignore` 抽查 2 个 | 均**被忽略** ✅ |
| 5 个文件物理存在 | 5/5 ✅ |

**验证 C：打包产物仍包含它们**

`pnpm run build:dir` + `asar list` 抽查 5 个路径（见第 5 节 QM-1）。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `.gitignore` | 追加 8 行注释 + 5 条精确路径规则（**不做整目录通配**，避免误伤同目录其他受管文件） |
| 5 个 bundle | `git rm --cached`（**只取消跟踪，工作区文件保留**） |
| 本文档 | 新增 |

**明确的非目标**：不改构建脚本、不改 `package.json` 脚本链、不改 CI workflow、不改任何运行时代码。

## 5. 门禁结果

| 门禁 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 独立 worktree，基线 `a699ef825` |
| 决定性验证 | PASS | 第 3 节验证 A/B（重建 5/5、stat-dirty 归零） |
| QM-1 打包 + 产物抽查 | PASS | `pnpm run build:dir` **rc=0**（`.playwright-browsers` 缺失提示不影响 dir 打包）。`asar list` 实测**含全部 5 个 bundle**：`\electron\preload\index.bundle.js` / `\electron\home-shell-preload.bundle.js` / `\electron\monitor-preload.bundle.js` / `\electron\services\generated\card-paginator.iife.js` / `\electron\services\stealth\stealth-preload-enhanced.bundle.js`。**过程记录**：首次抽查 5/5 报「缺失」是**假阴性** —— 匹配模式写成了字面双反斜杠（`electron\\preload\\...`），而 `asar list` 输出是单反斜杠；改用 `asar list \| Select-String "bundle"` 复核后确认全部在场。这是一次「**判据写法错误伪装成产品缺陷**」的实例，值得记入：报红/报绿都要先问「判据本身写对了吗」 |
| QM-2 代码必检项 | N/A | 无运行时代码改动 |
| QM-4 视觉回归 | N/A | 无 UI 改动 |
| QM-6 双模型评审 | 见下 | 按变更规模判定 |
| 测试 | PASS | `electron/ipc-handlers/zhihu-favlist.test.js` 12 用例通过（bundle 取消跟踪不影响测试：文件物理存在） |
| 文档同步 | PASS | 本文档 + PR 正文 + `.gitignore` 内联说明 |
| 行尾两口径对账 | PASS | 仅 `.gitignore` 一个文本文件，新增行 LF |
| 远程同步 | PENDING | PR 未开。合并后同一次提交改写为 `PASS` + merge SHA 并删除 `sync_*` 三字段 |

- 保留门禁：变更类型与隔离 ✅ | 决定性验证 ✅ | QM-1 ✅ | 测试 ✅ | 文档同步 ✅ | 行尾对账 ✅ | 远程同步 PENDING

## 6. 为什么是 **5 个**而不是 7 个（两个同类文件被**有意保留**）

评审侧提出「是否漏掉同类产物」。逐个人工核查后确认：仓库里另有 2 个 `*bundle*` 形态的受管文件，**都不应移出**，理由如下。

| 文件 | 为什么不移出 |
|---|---|
| `apps/desktop/electron/services/stealth/evasions-bundle.js` | **它是输入源，不是产物**。`scripts/build-preload.js:56` 的注释即写明「必须把同目录 `evasions-bundle.js` 内联成单文件」——它被 esbuild 当作**待内联的源**读入。移出会让 `build:preload` 直接失败 |
| `apps/desktop/electron/stealth-preload.bundle.js` | **它是产物，但当前没有任何脚本生成它**（`git grep` 排除文档后为空；最后一次改动是 #3635）。而 `core/preload-path.js` 的语义是「**存在 bundle 就用 bundle，否则回退源文件**」，且本仓 CHANGELOG 明确记过「sandbox preload **无法** require 相对路径文件」（真机实测 `module not found`）。⇒ 移出它会触发**不可用的回退分支**，把它从「可能过时但可用」变成「确定不可用」。**保留，并登记为遗留** |

**结论**：移出清单收敛到「有明确生成脚本 + 无回退风险」的 5 个。**这条核查本身就是本次评审的最大价值**——`git ls-files | grep bundle` 得到 7 个，照字面全移出会引入两个真实故障。

## 7. 门禁之外还要销的一笔：`check-max-lines` 的超限挂账

CI 的 **`债务熔断检查` workflow**（`node .github/scripts/check-max-lines.js`）维护一张「超限文件挂账表」`.github/scripts/max-lines-baseline.json`。其中两条正是本次移出的产物：

- `apps/desktop/electron/home-shell-preload.bundle.js`（1833 行）
- `apps/desktop/electron/preload/index.bundle.js`（1782 行）

文件一旦不在受管范围，挂账项立刻变成 **`STALE_LEDGER_ENTRY`** 并阻断。处置：`node .github/scripts/check-max-lines.js --prune <路径>` **单键清账 + 立碑**（墓碑保留行数供追溯）。
清账后读数：超限文件 97→**95**、挂账 97→**95**、墓碑 3→**5**，复核打印 `✅ 无新增超大文件，挂账清单与现实一致`（rc=0），其回归测试 **27 passed**。

**踩坑记录（第二次同型）**：本地预跑只枚举了 `quality-gate.yml` 的 `changes` job（21 tests + 15 scripts 全绿），**却漏了另一个 workflow**。上一轮的教训是「本地判据集合 ≠ CI 判据集合（同一 job 内）」，这一轮暴露的是**「≠ CI workflow 集合」（跨 job/workflow）** —— 报红后才去读 `债务熔断检查` 的日志。
**下一次的判据**：预跑前先 `ls .github/workflows/`；凡改动触及 `.gitignore` / 受管文件删除 / 构建产物，就要想到 `债务熔断检查` 与 `build` 这两条 workflow，而不只看 `quality-gate`。

**另一条环境差异**：`--prune` 第一次被拒（`仍超限…不得发墓碑`），因为脚本**扫工作区**看到文件还在（`git rm --cached` 只取消跟踪）。而 **CI 按 git 索引判**，所以 CI 报 STALE、本地报一致。⇒ 先真正删掉物理产物，`--prune` 才成立。**同一判据在「工作区视角」与「索引视角」下结论相反**，是这次最值得记的一条。

## 8. 未闭合（不假装闭合）

1. **`git clone` 后首次使用必须先构建**：若有人跳过 `dev:electron`/`build*` 直接 `electron .`，preload 会缺失。这属「构建产物不入库」的固有代价，已写进 `.gitignore` 内联注释与 PR 正文。
2. **`stealth-preload.bundle.js` 的「无生成脚本」状态待单独处理**：它可能是 #3635 之后生成链被重构时遗漏的孤儿产物。正确处理是「补上生成脚本」或「确认不再使用后删除并让 `preload-path` 永久走源文件」，两者都超出「移出版本控制」的范围，需单独评审。
3. **未做真机构建验证**：验证到「打包产物含 5 个 bundle」为止，未启动应用实测 preload 注入。
