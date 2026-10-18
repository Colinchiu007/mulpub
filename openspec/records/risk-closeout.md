---
record: risk-closeout
task: 同型风险收尾 —— R11 漏检缺陷修复（审计面 2→13）+ 本地门禁消噪 + 掩码 A/B 工具固化 + 文档收口
date: 2026-10-18
branch: risk-closeout
---

## 本次执行记录：同型风险收尾（risk-closeout，2026-10-18）【混合 PR】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=false`（含 `apps/desktop/electron/`、`scripts/`、`.github/workflows/`）
- 保留门禁：行数门禁 ✅ ｜ 品牌残留 ✅ ｜ 远程同步 由门禁推导

### 任务来源

用户从四项候选里全选了：A（R11 两条加理由注释）/ B（`check-unwired-tests` 排除本地归档）/ C（A/B 覆盖工具固化）/ D（文档收口）。
**执行 A 时发现两个比 A 本身重要得多的问题**，本条记录以它们为主体。

### 🔴 核心发现 ①：R11 长期漏检 11 个模块级集合

**现象**：给 `notify.js rateBuckets` 与 `window.js _completedIpcRegistrars` 各加一段理由注释后，
R11 读数从 `moduleSets=11 / writeOnly=2` 变成 `9 / 0` —— 看起来像"豁免生效"。

**但它不可能是豁免**：`scanModuleStateGrowth` 全程只判 `writes && !clears`，**从不读注释**。
往代码里加注释不可能改变判定，除非它改变了**别的**东西。

**根因**（`scripts/lib/same-type-risk-locks-r3.js`）：
```js
const declLine = masked.slice(0, m.index).split('\n').pop()
if (/^\s/.test(declLine)) continue        // 缩进的声明不是模块顶层
```
`MODULE_SET_RE` 以 `(?:^|\n)` 开头 ⇒ `m.index` 指向那个 `\n` ⇒ `slice(0, m.index)` 之后
`.split('\n').pop()` 取到的是**上一行**内容。于是：

- 声明上方是**代码** ⇒ 上一行非空白开头 ⇒ 计入
- 声明上方是**注释或空行**（掩码后纯空白）⇒ `/^\s/` 为真 ⇒ **整条声明被当成缩进声明跳过**

我的注释恰好把两条声明"藏"了起来。**删掉守卫后真实读数是 `moduleSets=34 / writeOnly=13`** ——
即此前长期有 **11 个模块级集合不在审计面里**（比修复前看到的 2 条多 6.5 倍）。

**为什么该守卫本来也无用**：正则要求 `(?:^|\n)(?:const|let|var)`，即声明必须**紧跟行首**，
缩进声明根本不会命中。守卫不但多余，还以错误的方式（看上一行）实现。

**修法**：删除该守卫，并在原位留下根因说明（"勿加回来"）。回归锁 `r3.test.js` +3 例：
声明上方是注释 / 是空行 / 真正缩进（后者确认删守卫不会回退成误报）。
下界**上调**（`moduleSets >= 30`、`writeOnly >= 10`）—— 修好的漏检若在下次误改中复发必须当场红。

### 🔴 核心发现 ②：锁的提示文案在指认一条不存在的机制

原 `detail` 写「若为有意的只增语义，请在该声明上方写明理由注释」。
但**判据不读注释**，照做的人会得到「读数变了」的错觉（正是发现①的入口）。
改为：
> 审计面：本判据**不读注释**，写理由不会让它消失；请人工复核它是缓存 / 登记表 / 竞态守卫中的哪一种，确认「有意的只增」后在此登记结论

即：**审计面就该人工看，不要伪装成"可自助豁免"**。

### 13 条审计面的分类结论（已写进 derived §4.2）

| 分类 | 条数 | 判定 |
| --- | --- | --- |
| 登记表 / 幂等保护（key 有界，**必须**只增）| 3 | ✅ 可接受（clear 会破坏保护）|
| 平台 / 适配器注册表（key = 平台或类型）| 4 | ✅ 可接受 |
| 限流桶（过期原地覆盖）| 1 | ✅ 可接受 |
| 测试 mock | 1 | ✅ 可接受 |
| **真实无淘汰缓存** | **4** | ⚠️ **登记待评估**（`llmRewriteCache` / `llmRewriteCallCount` / `_lastImportedMediaGcByBaseDir` / `_blocklistCache`）|

登记表与幂等保护两类都**不能** clear：`_completedIpcRegistrars` 一旦清空，macOS
`app.on('activate')` 的二次 `createWindow` 会重新注册同一批 handler 并当场崩溃（R28）。
这一点已写进两处声明的注释（A 的产出保留，只是把措辞从"已登记豁免"改为"人工复核结论"）。

### B：本地门禁消噪（3546 行 → 3 行）

| 环境 | `check-unwired-tests` 输出 | rc |
| --- | --- | --- |
| 共享根（有 `.agent_context`）| **3546 行**，其中 **3543 行**来自 `.agent_context/worktree-archive-*` | **1** |
| 干净 worktree | 3 行（`检查域内测试文件 104 个` + `OK`）| **0** |

`.agent_context` 是**本地会话归档**（`git ls-files .agent_context` = **0** 条），CI 上根本不存在
⇒ 这就是 CI 一直绿、而本地天天红的原因。**一个天天红的门禁等于没有**（红色被训练成背景色）。
修法：加进 `PRUNE_DIRS`（与 `node_modules`/`dist` 同级），并补 2 例测试（行为锁 + 常量钉住）。

### C：掩码覆盖 A/B 固化为工具

前两轮修 `code-mask` 时，"旧 vs 新逐文件比可见字符数"是最有效的取证手段（一次性揪出 174 增 / 0 回归，
并当场发现两个候选修复各自的回归）—— 但那次脚本写在 `%TEMP%`，用完即弃。

现在固化为：
- `scripts/lib/mask-coverage-ab.js`（`listSourceFiles` / `loadMaskFromGit` / `compareCoverage`）
- `scripts/check-mask-coverage.js`（CLI）：`--base` / `--limit` / `--json`；**可见减少 > 0 即 rc=1**

实跑（本 PR 未改 `code-mask` 行为）：`扫描 3114 文件 / 可见增加=0 / 不变=3114 / 减少=0 / 等长性失败=0` → PASS。
测试 7 例，其中一例专测「候选掩得更多必须被判回归」—— 那是这条取证手段的元判据。
接线：Gate 2c6。

**夹具教训（本轮第二次踩）**：第一版 `blindMask` 直接"什么都不掩"，结果它连字符串都不掩
⇒ 比真实现看得**更多** ⇒ 被误判成"修复造成回归"。夹具必须只差一个维度（用真实现打底再额外掩）。

### 改动清单

| 文件 | 改动 |
| --- | --- |
| `scripts/lib/same-type-risk-locks-r3.js` | **删漏检守卫**（+根因注释）· 改审计面文案（明确"判据不读注释"）|
| `scripts/same-type-risk-locks-r3.test.js` | +3 例回归锁 · 下界上调（30 / 10）· 断言行锚点 |
| `scripts/check-unwired-tests.js` | `PRUNE_DIRS` 加 `.agent_context`（+3546 行噪声的实测理由）· 导出 `PRUNE_DIRS` |
| `scripts/check-unwired-tests.test.js` | +2 例（行为锁 + 常量钉住）|
| `scripts/lib/mask-coverage-ab.js` / `.test.js` / `scripts/check-mask-coverage.js` | **新增**（工具 + 7 例）|
| `.github/workflows/quality-gate.yml` | Gate 2c6 接 `mask-coverage-ab.test.js` |
| `apps/desktop/electron/ipc-handlers/notify.js` · `window.js` | 声明上方加「为什么只增」的注释（含 `openspec/records/risk-closeout.md` 指向）|
| `01-docs/research/.../derived/竞品缺陷同型风险清单.md` | R11 行改真读数 · 新增 §4.2（13 条分类）· §4.1 补 A/B 工具 · §6 未闭合更新 |

### 验证

| 项 | 读数 |
| --- | --- |
| 测试合计 | **110 例全绿**（16 + 17 + 17 + 7 + 14 + 7 + 32）|
| CLI 八锁 | `PASS` rc=0；`R11 模块级集合=34 有写无清=13`、`R7 独立映射=0`、`R5 无复位=0`、`R9a 字面量进度=0` |
| `check-unwired-tests` | `检查域内测试文件 105 个` + `OK` rc=0 |
| `check-mask-coverage` | 0 增 / 0 减 / 0 等长性失败 → PASS |

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A（已核）** | `apps/desktop/electron/` 下改动**仅注释**：`notify.js` 6 行、`window.js` 5 行，全部以 `//` 开头；两文件 `node --check` 均 rc=0。零可执行语句变化 |
| QM-2 代码必检项 | ✅ | 无新增 IO/网络/同步密集原语；新 CLI 只读文件 |
| QM-4 视觉 | **N/A** | 无 UI 变更 |
| QM-6 双模型评审 | 见 PR | 按 CCG 判定器结果 |
| 远程同步 | 由门禁推导 | change `gate-record-sync-derived-status` |

### 未闭合（不假装已闭合）

| # | 项 |
| --- | --- |
| 1 | R11 **4 条无淘汰缓存**待评估（见 §4.2）—— 需按实际调用基数判断内存增长，本轮只登记不深挖 |
| 2 | 审计面是否该有"人工登记豁免表"（像 `loading-machine-exemptions.js`）—— 本轮选"不改判据、改文案"，若要自助豁免需另立判据 |
| 3 | 正则/除号判定仍是启发式（JS 词法固有歧义，不可消除）|
