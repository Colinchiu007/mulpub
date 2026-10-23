---
record: fix-deep-review-entry-rc-script-closure
task: 补回 deep-review 入口测试的脚本复制清单（修 main 上 QG Changes 变红）
date: 2026-10-23
branch: fix/deep-review-entry-rc-script-closure
delivered_by_pr: 4349
---

# 补回 deep-review 入口测试的脚本复制清单

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 通过 | 测试夹具清单一行；独立克隆 + 裸分支 `fix/deep-review-entry-rc-script-closure` |
| 第一性原因（QM-5 ①） | 通过 | #4093 把 `check-pr-exec-record.js` 的白名单收敛到单一真源 `scripts/lib/exec-record-statuses.js`，但漏把它加进 `scripts/deep-review-entry-rc.test.js` 的 `SCRIPT_CLOSURE` 复制清单 ⇒ 临时目录里入口脚本的相对 require 解析失败 |
| 逃逸分析（QM-5 ②） | 通过 | 该测试文件此前**从未被本地跑过**（我在本会话只跑了同族的 `ccg-review-decider.test.js`，它不经过临时目录复制 ⇒ 绿）；CI 的 Windows runner 上暴露 |
| 修复 + 回归保护（QM-5 ④） | 通过 | `scripts/deep-review-entry-rc.test.js` 修复前 6 例红（`Cannot find module './lib/exec-record-statuses'`）→ 修复后 **10/10 绿**；同族 `ccg-review-decider.test.js`(71)、`check-pr-exec-record.audit.test.js`(10)、`check-text-encoding-integrity.test.js`(5) 全绿 |
| 防止再次发生（QM-5 ⑤） | 通过 | 清单项补上并写明动因与后果（required check 变红 ⇒ 全仓 PR 被挡），下次有人动 `SCRIPT_CLOSURE` 能看到为什么这一项必须在 |
| 行尾与 diff 对账 | 通过 | 纯 ASCII 注释 + 一行清单项；无行尾改动 |
| 接线棘轮 | 通过 | 该测试文件已接线在 `quality-gate.yml` 的 QG Changes job（`node --test scripts/...`）⇒ 本 PR 自身的 QG Changes 会实跑它 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（仅 CI 测试夹具） |
| QM-6 CCG 双模型外部评审 | **未执行** | 本机无 `codeagent-wrapper` ⇒ 如实记「未执行」，不以自审冒充通过 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写** |

## 1. 为什么这是「全仓级」阻断

`QG Changes` 是 required check。**main 自身红 ⇒ 每个 open PR 的该 check 都红**
（本会话的 #4342 / #4343 就是这么红的）。

## 2. 判定证据（为什么断定是 main 级、不是我的改动）

| 证据 | 内容 |
|---|---|
| 错误一致 | main 的 QG Changes 日志与 PR 的**完全同一个错**：`Cannot find module './lib/exec-record-statuses'` |
| 本地复现 | 干净的 `origin/main` 检出上跑同一测试 **6 例红** ⇒ 与 PR 改动无关 |
| 与 OS 无关 | 本地 Linux 同样红（不是 CI Windows runner 特有） |
| 编码门禁是清白的 | 日志里的「❌ 基线内文件的损坏量增加 / 新增 1 处编码损坏」是**编码门禁自测故意造出来的现场**（测试要先破坏文件才能验证门禁会报）；那批测试自身 `# fail 0` ⇒ 真正的失败只有 `deep-review-entry-rc` 这一处 |

## 3. 修法

`SCRIPT_CLOSURE` 补一行 `'lib/exec-record-statuses.js'`。

**不改**入口脚本的 require 形态、**不**把 lib 内联回调用方 —— 那会把 #4093 刚做的
「单一真源收敛」退回去。清单项本来就该跟着新依赖走。
