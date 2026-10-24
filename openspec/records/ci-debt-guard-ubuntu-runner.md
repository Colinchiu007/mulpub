---
record: ci-debt-guard-ubuntu-runner
task: 把「债务熔断门禁」作业从 windows-latest 挪到 ubuntu-latest（判定与 runner 无关，解除主干读数的排队等待）
date: 2026-10-23
branch: ci-debt-guard-ubuntu-runner
---

# 债务熔断门禁换 runner：把「主干读数拿不到」这个放大器拆掉

## 1. 现场

2026-10-23 清 PR 积压时，所有 PR 的本地合并判据都停在同一句：

```
MAIN-RED verdict=STOP_MAIN_RED exit=2 main=0c64ad9613 pr=434e418d1b
  prFail=0 mainFail=1 newRed=0 ... baseline=7718f8987 staleness=4 baseKind=red
```

判据本体的口径（`scripts/lib/main-red.js` 的 `pickBaseline`）：主干侧读数**不是**取 tip，
而是沿第一父链回溯，取**最后一次完整跑完**的那一版。回溯窗口 5 步、过期上限 3 步。

现场的第一父链与各 commit 的作业状态：

| commit | 作业状态 |
|---|---|
| `0c64ad961`（tip） | 债务熔断门禁 **pending** |
| `fb55036bb` | 定时作业心跳巡检 queued |
| `9e95b7fe5` | quality-gate / Build & Release / GUI Tests queued、Electron CI in_progress |
| `98558636e` | Electron CI 重跑后 success，但 quality-gate 仍 queued |
| `7718f8987` | 债务熔断门禁 **failure**（旧的 TARGET_GROW 红，#4329 之后已不存在） |

⇒ 主干链上**没有一版是「完整跑完且全绿」**：越新的越在排队，越旧的那一版自带历史红。
而「完整跑完」这一步卡住的，全是 **Windows 托管池**上的作业（债务熔断门禁 / Electron CI / GUI Tests）。

同批次的纯 ubuntu 作业（quality-gate 的 changes job）**零排队** ——
这与本仓 `ci-failure-handler.yml` 里早就写下的那条结论同族：

> ⛔ 必须 ubuntu-latest，不得占 windows-latest 的并发额度（2026-10-22，change: main-red-run-baseline）。
> 迁移前的实测代价：electron-tests / GUI Tests / 本 handler 三家全在 windows-latest 抢同一个
> 托管池，主干 push 的 electron-tests 作业实测排队 46.6 分 / 51.5 分才起跑；
> 而同批次的纯 ubuntu 作业（quality-gate）**零排队**。Windows 额度是「主干读数拿不到」的直接放大器。

## 2. 改动

`.github/workflows/debt-guard.yml`：`runs-on: windows-latest` → `ubuntu-latest`。

**作业名 `债务熔断检查` 不变**（它是 ruleset `main-ci-gate` 的 required check，改名会让所有 PR 永久 BLOCKED）。

## 3. 平台无关性（迁 runner 前逐条核过，不靠「都是 node」这句空话）

本作业三步全是「纯 node + git」：

| 步骤 | 命令 | 平台相关点 | 结论 |
|---|---|---|---|
| 1 | `node scripts/check-debt-budget.js` | 路径一律 `.replace(/\\/g,'/')` 归一 | 两平台同键名 |
| 2 | `node .github/scripts/check-max-lines.js` + `node --test …test.js` | 行数口径 `fs.readFileSync(fp,'utf8').split(NEWLINE).length` | **CRLF 与 LF 同数**（CRLF 只是一个换行符终结的片段，尾随的 CR 不额外计行）⇒ 读数不受 checkout 的 autocrlf 影响 |
| 3 | `node scripts/detect-unwired-exports.js`（软门禁） | 零平台引用 | 同判定 |

⇒ **判定结果与 runner 无关**，迁移只改「在哪个池上排队」，不改「什么算过」。

## 4. 验证

本地（Linux）实跑三步：

| 步骤 | 读数 |
|---|---|
| `check-debt-budget.js` | rc=0 |
| `check-max-lines.js` | ✅ 无新增超大文件，挂账清单与现实一致 |
| `check-max-lines.test.js` | 36 passed / 0 failed |
| `detect-unwired-exports.js` | rc=0（软门禁，只出候选清单） |

workflow YAML 解析通过：`name=债务熔断检查` / `runs-on=ubuntu-latest` / 4 个 step 齐全。

## 5. 为什么这是本片要修的那一件

本仓的「主干红着就别往里合」判据是**为了防「主干红着还往里合」**而装的；
而它自己**取主干读数**取的就是「主干链上最后一次完整跑完的那一版」。
当主干链上排队的作业全挤在 Windows 池上时，这条判据会**因为「读不到」而恒红** ——
判据的 fail-closed 方向是对的（宁可停下不合并），但它的**等待成本**落在了最紧的池上。
把一条纯 node+git 的作业挪出 Windows 池，是本仓自己已经批准过的同族动作
（ci-failure-handler.yml 那次）。

## 6. 遗留

- 本片**只改 runner**，不动门禁判定口径、不动 targets 棘轮、不动任何脚本。
- `#4337`（允许同 PR 重锚 targets）是**另一件事**：它给这条门禁加了「本次是否在放宽零增长约束」
  的审计，而那条审计在 CI 里因为取不到 base 而恒红（`TARGET_BASE_UNAVAILABLE`）——
  已在 #4337 里单独修（base 取法改候选链 + workflow 传 merge-base + checkout 补 `fetch-depth: 0`），
  不在本片范围内。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |
