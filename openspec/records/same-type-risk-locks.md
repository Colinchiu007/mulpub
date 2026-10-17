---
record: same-type-risk-locks
task: 把逆向衍生清单里的 4 条「竞品缺陷同型风险」做成静态锁并接进 CI（L1 转义表完整性 / L2 while(true) 必有出口 / L3 catch 不得自递归 / L4 组件定时器必须清理）
date: 2026-10-17
branch: same-type-risk-locks
---

## 本次执行记录：竞品缺陷同型风险四锁（same-type-risk-locks，2026-10-17）

- 保留门禁：QM-1 打包 **N/A**（未改 `apps/desktop/electron` / `packages/rpa-engine`）｜ 行数门禁 ✅ ｜ 品牌残留 ✅ ｜ 绝对路径 ✅ ｜ 远程同步 PASS（`354c4183b5efe81b71dba3d1ff43ba7680932ab9`）
### 做了什么

来源：`01-docs/research/competitor-reverse-2026-10-13/derived/竞品缺陷同型风险清单.md`（同批 PR #3796）。
清单核到本仓后结论是「**当前是对的，但没有任何测试会阻止后来者把它改坏**」——本轮把这 4 条变成机器判据。

| 锁 | 判据 | 竞品原型 |
| --- | --- | --- |
| **L1** 转义表完整性 | `replace(/[class]/g, m => map[m])` 的**字符类必须 ⊆ map 键集** | 竞品 C1：字符类含 `/` 但 map 无 `/` ⇒ 每处 `/` 被静默替换成字面量 `"undefined"` |
| **L2** `while (true)` 必有出口 | 循环体内必须有 `break` / `return` / `deadline`·`timeout` | 竞品 C2：只认一种成功响应 ⇒ 每秒打服务端且 Promise 永不 settle |
| **L3** catch 不得重调被包裹函数 | catch 体内不得出现**同时包住该 catch** 的函数自身调用 | 竞品 X-C1：catch 重调整个截图函数 ⇒ 原 Promise 永不 resolve ⇒ 流程死锁 |
| **L4** 组件定时器必须清理 | 同一文件出现 `setInterval(` ⇒ 必须出现 `clearInterval(` | 竞品 X-20 型：定时器/观察者建了不 dispose |

落点：`scripts/lib/same-type-risk-locks.js`（纯函数）+ `scripts/check-same-type-risk-locks.js`（CLI，只读）
+ `scripts/same-type-risk-locks.test.js`（**14 例**）+ `.github/workflows/quality-gate.yml` 的 `changes` job 新增 **Gate 2c6**。

### 真实仓实测（当前全绿，且必须证明「不是空转」）

```
[same-type-risk] 扫描 2861 个文件
L1 字符类回调=4 映射表=2 ｜ L2 while(true)=9 ｜ L3 catch 块=3346 ｜ L4 含 setInterval 文件=34
PASS（四条锁全部通过）
```

覆盖下界已写进测试断言（L1 回调 ≥3、映射表 ≥1、L2 ≥8、L3 ≥3000、L4 ≥20）——**命中数 0 会让「解析失败」伪装成「全部合规」**，本轮真踩过（见下 §自纠 2）。

### 变异反证（M1–M4，全部作用在真实仓文件上，逐条按 sha256 校验字节还原）

| 变异 | 落点 | 结果 |
| --- | --- | --- |
| M1 删掉映射表里的 `'` 键 | `packages/ui/utils/sanitize.ts` | **红** ✅（`L1-escape-map-coverage`，字节还原一致）|
| M2 加一个只有 `await` 无出口的 `while (true)` | `packages/shared-utils/src/scheduler.js` | **红** ✅（`L2-while-true-no-exit`）|
| M3 在 catch 体内插入 owner 函数自身调用 | `packages/shared-utils/src/scheduler.js` | **红** ✅（`L3-catch-self-recursion`，插入 `notifyDispatchFailed()`）|
| M4 把 `clearInterval(` 改名 | `apps/desktop/src/features/accounts/components/AccountCloudSyncDialog.vue` | **红** ✅（`L4-interval-no-cleanup`）|

> M3 首版变异**无效**（用正则近似挑了 catch，结果插到了内层函数的 catch 里，owner 名字对不上 ⇒ 锁没红）。
> 改成复用模块自己的 `collectFunctions` 精确找 owner 后才红。**变异本身也要被验证**，否则「锁没红」会被误判成「锁不灵」。

### 开发期被自己抓住的 6 处（都已修，不留在代码里）

1. **L3 首版 30+ 条全假阳**：用「最近的前置函数声明」猜外层函数 ⇒ `if(` / `console.warn(` / `setTimeout(` 都被当成函数名。
   改成**按花括号范围判包含**（取最内层），并要求调用点前一个非空字符不是 `.`（属性访问同名方法不算自调用）。
2. **L1 空转**：`findCharMaps` 跑在被屏蔽的文本上，而屏蔽器把字符串抹白 ⇒ `mapsFound=0` 却打印 PASS。
   改为「原文切片解析 map + 屏蔽文本定位调用点」；随后又发现屏蔽器把字符类里的 `"` 当字符串起始，
   会把后续代码一起抹白 ⇒ 给 `maskNonCode` 加 `{ maskStrings: false }`，L1 专用。
   最后还有一层：键解析用 `['"]([^'"]{1,2})['"]` 时，「键本身是引号」（`'"'` / `"'"`）永远匹配不到 ⇒
   而这正是要守的两个字符 ⇒ 改用**后向引用**定界。
3. **L3 漏掉最常见的写法**：首版正则只认 `catch (e) {`，把 `catch((error) => {`（promise 链主流写法）整类漏掉 ⇒ 红夹具当场抓出。
4. **CLI 的 `main()` 没有 `require.main` 守卫** ⇒ 测试 `require` 它时 `process.exit(0)` 直接把测试进程干掉，
   `node --test` 只报 **1 个 test** 且结论 `pass` —— **假绿**。修守卫后 14 个用例才真正跑起来，并补一条
   「require CLI 不得退出进程」的接线锁（子进程断言输出 `ALIVE`）。
5. **workflow 插入丢了缩进**：把 `- name:` 插到第 0 列（步骤实际缩进 6 空格）⇒ YAML 解析失败；
   而 `check-unwired-tests` 因此把「解析不了」读成「这两条测试没接线」（报了 2 条与我改动无关的假阳）。
   **这正是本仓反复记录的「工具的失明读成结论」**：判据工具自身坏掉时，它给的是误导性结论而不是报错。
6. **worktree 没装依赖**：上述 5 的排查一开始被归因成「判据逻辑变了」，实际是 `check-unwired-tests` 用
   `js-yaml` 解析 workflow，而新 worktree 未 `pnpm install` ⇒ 解析必然失败。补齐依赖后两条假阳同时消失。

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A** | 未改 `apps/desktop/electron/` 与 `packages/rpa-engine/`；改动面是 `scripts/`、`.github/workflows/`、`openspec/` |
| QM-2 代码必检项 | ✅ | 新增代码为纯函数 + 只读 CLI；无同步 CPU 密集原语、无网络、无文件写（CLI 只读；测试只在内存夹具上跑）|
| QM-4 视觉 | **N/A** | 无 UI 变更 |
| QM-6 双模型评审 | 见下 | 本次 diff 规模触发 dual（>200 行）⇒ 走 CCG 引擎 |
| 远程同步 | PASS | PR #3812 已合并，merge SHA `354c4183b5efe81b71dba3d1ff43ba7680932ab9`（2026-10-17 16:07 +08:00）|

### 一处需要人过目的邻界面（如实登记）

本 PR 在 `.github/workflows/quality-gate.yml` 的 `changes` job 里**新增了一个判据执行步骤**（Gate 2c6）。
按 `AGENTS.md`「改 `.github/workflows/` 属改『谁来守门』，须人工过目」的邻近条款，这一笔需要人确认。
本仓既有约定（`check-unwired-tests`：不接线的测试等于永不执行）要求新测试必须登记进 workflow，
且本步骤方向是**收紧**守门（新增判据，未动分支保护规则、未动 `CI_IGNORED_PATHS`）。

### 未闭合（不假装已闭合）

| # | 项 | 卡在哪 |
| --- | --- | --- |
| 1 | 四条锁都是**文本级**判据，不是 AST 级 | 不解析语法树 ⇒ L3 只认 4 种函数形态（`function NAME` / `NAME: function` / 行首方法简写 / `const NAME = (…) => {`）；箭头函数直接传参（`Promise.resolve().catch((e) => f(e))` 之类）不覆盖 |
| 2 | L1 跳过非字面量字符类 | 含 `\d`/`\w`/`\p{...}`/区间（`a-z`）的字符类无法与「字面量键表」对账，跳过并计数（`skippedNonLiteralClasses`），**不猜** |
| 3 | L2 的「出口」是关键字级 | 只认 `break`/`return`/`deadline`/`timeout` 字样；`while (true) { if (x) { continue } }` 里远处的 break 也算 —— 语义级「真的会退出」没验 |
| 4 | L4 只看同文件配对 | 跨文件清理（父组件清理子组件的 timer）不覆盖；且只看 `setInterval`，`setTimeout` 链式重排未覆盖 |
| 5 | 四条锁的**触发面**仅 `apps/**` + `packages/**` | `ops-center/**`、`scripts/**` 自身未扫 |
| 6 | 清单里另外 8 类同型风险**仍未加锁** | R5 失败分支不复位 UI / R7 后缀与 mime 不一致 / R8 `await` 结果无兜底 / R9 假进度 / R11 模块级状态累积 等，仍需人工审计（清单 §2 标「未核」）|
