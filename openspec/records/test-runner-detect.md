# 本次执行记录：runner 机械判定（根治「登记表靠人工判」同型坑）（signer-reuse-integration 分支追加，2026-10-21）【混合 PR】

- 分支：`signer-reuse-integration`（worktree：`<仓库父目录>/mp-worktrees/mp-signer-reuse`）
- 前序：#4110（拆假签名 `2db86538`），其 §三 把本项留作下一轮。

## 一、要根治的问题

本仓三次踩「测试文件与 runner 不匹配」：

| # | 形态 | 出处 |
| --- | --- | --- |
| ① | vite alias 未注册 → 浏览器端加载失败（18 条 E2E 全红） | #3983 |
| ② | 新增 vitest 文件**漏登记** VITEST_FILES → node 直跑 `describe is not defined` | #4019 / 本仓 |
| ③ | **反向**：把 node:test 风格文件**误登记**进 VITEST_FILES → `No test suite found` | #4110（本轮前一次提交） |

②和③方向相反，正好证伪"记得登记就好"——**判不准，不是记不住**。
根因：登记表要求人工判断每个文件属于哪个 runner，而两种风格都是 `*.test.js`，文件名无法区分。

## 二、改法：唯一事实源从「人的记忆」改为「文件内容」

新增 `packages/api-publish-engine/scripts/lib/test-runner-detect.js`，
`run-tests.js` 的 `classifyTestFiles()` 改用它；VITEST_FILES **降级为例外表**
（只在判定器返回 `unknown` 时生效），且登记表与判定冲突时**以判定器为准并打印告警**。

### 2.1 判定规则（按**实测分布**收敛，不是拍脑袋）

对全量 184 个测试文件统计特征组合：

| 组合 | 数量 | 归属 |
| --- | --- | --- |
| assert 裸脚本 | 60 | direct |
| vitest globals | 46 | vitest |
| node:test + assert + globals | 33 | direct |
| node:test + globals | 21 | direct |
| assert + globals | 14 | direct |
| 无任何特征 | 8 | 须人工登记 |

**结论**：唯一可靠的硬判据是 `require('node:test')`（55 个，全 direct）；
而 `assert`（108 次）与 `globals`（114 次）**交叉重叠**（33+14 同时命中）⇒ 都不能单独当判据。

最终规则（`detectRunner`）：
1. import 区含 `require('node:test')` ⇒ **direct**（最硬）
2. import 区含 `require('assert')` ⇒ **direct**（自定义收集器形态）
3. 显式 import vitest，或**行首**出现 vitest 全局调用 ⇒ **vitest**
4. 都不命中 ⇒ **unknown**（不猜，落例外表）

### 2.2 两处真实的判定陷阱（都靠取证修掉，不是猜）

| 陷阱 | 现象 | 修法 |
| --- | --- | --- |
| **夹具字符串污染** | 自测文件体内含 `require('node:test')` 字样（那是三种风格的样例夹具），全文件正则把它当 import ⇒ 把自己判成 direct | import 区**截断在首条测试语句之前**；vitest 判定只看**行首**调用（夹具都嵌在字符串里、不在行首） |
| **剥字面量反而判不出** | 试过"先剥字符串再判定"，结果 `require("assert")` 的实参被剥空 ⇒ 匹配不到 | 放弃剥离，改用**分区判定**（import 区认 direct / 行首认 vitest） |

## 三、验证

| 项 | 读数 |
| --- | --- |
| 判定器 vs 登记表全量交叉 | vitest **47**（46 原有 + 1 新增）/ 登记表 46 / **误登记 0、漏登记 0**（新增那个已登记例外） |
| `test/test-runner-detect.test.js` | **7 passed**（含变异反证 + 本文件自证） |
| `packages/api-publish-engine` 全量 | **rc=0（47 文件）**，较前次 +1（新回归锁） |
| 门禁 | max-lines ✅ / unwired OK / abs-paths PASS / 编码 OK / 品牌 PASS / 记录债务 OK |

### 3.1 变异反证（判据必须能当场变红）

`test/test-runner-detect.test.js` ⑤ 用同一段逻辑造三种 runner 特征，断言判定**随特征变化**
（`direct/direct/vitest`），并显式断言 vitest 形态**绝不能**被判成 direct —— 那正是第三次踩坑的形态。
（研发过程中该反证确实红过一次：我最初的用例设计错了，改对后绿 —— 红过才证明它在守门。）

## 四、未闭合

8 个"无任何特征"文件仍返回 `unknown`，走例外表：
`api-key-manager` / `integration-key-manager` / `plugin-config-isolation` / `plugin-dynamic` /
`plugin-integration` / `plugin-loader` / `plugin-manifest` / `usage-tracker`。
它们当前按 direct 跑（与现状一致），但**未做归属确认** —— 留待专项。

## 五、远程同步

| 远程同步 | 由门禁推导 |
