---
branch: fix-ensure-deps-root-required
date: 2026-10-17
sync_reason: 本 PR（fix-ensure-deps-root-required）的远程同步待合并后由后续 docs PR 就地改写为 PASS 并删除本登记字段
sync_backfill_owner: fix-ensure-deps-root-required 分支作者会话（合并收尾时回填）
---

# 本次执行记录：fragileFor 的 root 必传化——堵住「缺参调用点静默降级」（fix-ensure-deps-root-required，2026-10-17）【混合 PR】

> task: 上一 PR（#3829）给 `fragileFor` 加 `root` 参数时设了**默认值** `DEFAULT_ROOT`，
> 导致「不传 root」的调用点静默按**脚本所在目录**解析 sharp 版本。本次在临时 worktree 验证 main 时当场抓住。

## 一、第一性原因（QM-5 ①）

`#3829` 的实现给 `fragileFor(platform, arch, root = DEFAULT_ROOT)` 设默认值，本意是「兼容旧调用」。
但 `root` 的语义是「要检查哪棵树的依赖」——它**没有**安全的默认值：

- 传了 root ⇒ 检查指定树（正确）
- 不传 root ⇒ 检查**脚本自己所在的仓库**（DEFAULT_ROOT = `path.resolve(__dirname, '..')`）

于是任何「忘记传 root」的调用点都会**静默**去检查脚本所在树。在以下场景判据直接失效：
临时目录里的 worktree、CI 的只读检出、别的 worktree（各自 node_modules 不同）——
sharp 条目会因为「脚本所在树没有 node_modules/sharp」而**凭空缺席**，平台过滤判据退化为永远通过。

第一性引入点：#3829 的 `fragileFor(platform = process.platform, arch = process.arch, root = DEFAULT_ROOT)`。
**根因是「给一个语义上必须由调用方决定的参数设默认值」**——这不是笔误，是默认值本身不该存在。

## 二、逃逸分析（QM-5 ②）

| 层 | 为什么没拦住 |
| --- | --- |
| #3829 的单元测试 | 19 条全绿。唯一涉及 `fragileFor` 平台过滤的用例 `fragileFor('win32','x64')` **不传 root**，于是走 DEFAULT_ROOT = 该 worktree（有完整 node_modules）⇒ sharp 条目在 ⇒ 断言通过。**测试与缺陷共享同一个盲区**：它只在「脚本所在树有依赖」时才有效 |
| #3829 的变异反证 | 6 条变异（A/B/B2/C/D/E）全部围绕「版本/清理/root 是否被传入」设计，其中 C 变异是「`fragileFor` 忽略 root 参数」——但它变异的是**函数体内** `root = DEFAULT_ROOT`，而默认值在**签名**里，不在体内 ⇒ 变异 C 抓的是另一条路径，签名默认值这条完全没覆盖 |
| 真实树 `--check` | 只在「有依赖的 worktree」里跑过，从没在**无 node_modules**的目录跑过 ⇒ 降级路径从未被执行 |

**共性**：默认值造成的降级路径，只在「非默认 root」场景才暴露，而所有测试都跑在默认 root 上。

## 三、系统性漏洞（QM-5 ③）

`scripts/ensure-desktop-deps.js` 的 `fragileFor` 签名：`platform`/`arch` 有默认值是**合理**的
（`process.platform`/`process.arch` 确实是普适默认），但 `root` 的默认值是**语义错误**——
它把「检查对象」这个必须显式决策的参数变成了隐式猜测。

## 四、修复 + 回归保护（QM-5 ④）

| 改动 | 文件 | 回归保护 |
| --- | --- | --- |
| `root` 改为**必传、无默认值**；缺参当场 `throw new Error('fragileFor: root 必传…')` | `scripts/ensure-desktop-deps.js` | 测试 `fragileFor 平台过滤` 增加 `assert.throws(() => lib.fragileFor('win32','x64'), /root 必传/)`；同时把该用例本身改为传测试 root（让它不再依赖 DEFAULT_ROOT） |
| 同步更新用例，使平台过滤断言不再依赖「脚本所在树有依赖」 | `scripts/ensure-desktop-deps.test.js` | 同上 |

**TDD 见证**：先改测试 ⇒ `# fail 1`（`fragileFor('win32','x64')` 因不传 root 抛错）；
实现后 `# tests 19 / # pass 19 / # fail 0`。

**真实树验证**：新建 worktree（`git worktree add` + `pnpm install` + `ensure-electron` + `verify-worktree-deps` OK）
上跑 `node scripts/ensure-desktop-deps.js --check` ⇒ `DESKTOP_DEPS_OK`（rc=0）——
这正是上一版会降级失效的场景，现在判据完整工作。

## 五、变异反证

| 变异 | 结果 |
| --- | --- |
| F：把 `root` 必传改回有默认值（`root = DEFAULT_ROOT`） | CAUGHT（`assert.throws` 红） |
| G：把 throw 改成静默 `return []`（缺参不炸、返回空） | CAUGHT（同上，`assert.throws` 红） |

还原校验：变异前后 SHA-256 前 12 位一致。

**为什么这次能抓住而 #3829 抓不住**：#3829 的变异都作用在**函数体内**，
而缺陷在**函数签名**。本次直接把「缺参必须抛错」写成断言，默认值无论藏在签名还是体内都会红。

## 五之二、深度评审（QM-6）3 条裁决 + 高危域外部复核

critic 给出 4 条问题，其中 3 条进入自扮演裁决；这 3 条里 **i1 被标 `crypto`、i2 被标 `datamigration`**。
按引擎规则（`blockingFromAdjudication`）：**只要 `highRiskDomains` 非空即阻断，且自扮演无权豁免，必须外部复核**。

| # | 域标签 | 指控 | 处置 |
| --- | --- | --- | --- |
| i1 | `crypto`（Critical） | 签名把 platform/arch 默认值也删了，超出声明范围、与文档矛盾；旧调用点会断 | **采纳并已修**：恢复 platform/arch 默认值，只让 root 必传；新增「默认值不对称」测试。域标签**误分类**（本 PR 无加密/凭据/哈希，见下取证） |
| i2 | `datamigration`（Warning） | record 里的 sync_* 临时字段易忘清理 | **驳回**：这是 AGENTS.md 规定的既有工作流，且由 `check-gate-record-debt.js` Gate 2c **机械兜底**（PENDING 未收口即判红），不存在「易遗忘」。域标签**误分类**（不涉及库表/迁移/持久化用户数据） |
| i3 | 无域标签 | learnings 写「platform/arch 默认值合理」但代码已删，文字与实现矛盾 | **采纳并已修**：改写该条 pitfall，明确「只有有普适真相的参数才配做默认值」，并记下我这次「多删的那半刀」 |

**i1 被判成立是本次最有价值的一条**：它抓到我「改动范围 > 声明范围」——我只声明要动 root，却顺手删了 platform/arch 的默认值，
同时制造了「行为回归」和「文档说谎」两个后果。已在 learnings 沉淀为通用纪律。

**高危域误分类的取证**（供后续改进判据）：本 PR 改动 6 个文件（脚本 + 测试 + 3 份文档 + 1 个评审产物），
`git diff origin/main...HEAD` 对 `crypto|cipher|hash(|secret|credential|migrat|ALTER TABLE|schema` 的命中数为 **0**。
即 critic 给这两条打的域标签是关键词误命中，与本 PR 实际改动面无关。
但**引擎规则不可绕过**：域标签存在即必须外部复核，故走 codex 独立复核（见下）。

**外部复核（codex 0.144.6，read-only，跨家族第二模型）结论**——逐问裁定：

| 复核问题 | codex 裁定 |
| --- | --- |
| Q1：i1 的 `crypto` 标签正确吗？ | **错误**。`fragileFor` 的参数是依赖树健康检查的路径/平台参数，不涉及加密、凭据、机密或哈希；且该发现已过时（默认值已恢复 + 测试已加） |
| Q2：i2 的 `datamigration` 标签正确吗？ | **错误**。`openspec/records/` 的 `sync_*` 属 PR 流程元数据，不涉及库表结构、数据迁移或持久化用户数据 |
| Q3：i1 还需改代码吗？ | **不需要**。默认值已恢复，生产调用点三参全传，「省略 platform/arch 仍工作」与「缺 root 抛错」均有测试锁定 |
| Q4：i2 还需改吗？ | **不需要**。`sync_*` 生命周期由 AGENTS.md 强制，Gate 2c 机械阻塞 PENDING；回填前保留属正常流程 |
| 总结 | 两个高风险域标签都误读了无关代码；本 PR **安全可合并**（前提是其余质量门禁通过） |

落盘位置：`.ccg/reviews/<sha>.json` 的 `deepReview.externalReview` 字段；`status` 置 `self_play_resolved`、`confidenceWeight` 升为 `1.0`（真跨家族）。

## 六、顺带核实的两件事（结论：无需改动）

1. **共享根 `node_modules/@img/sharp-win32-x64` 混版是否复发**：本轮开场查到 `index.cjs` 指向 `0.35.1.node`，
   收尾时复核**已自愈**（`index.cjs` 正确指向 `0.35.5.node`，`require('sharp')` ⇒ `sharp OK 0.35.5`）。
   中间有其他会话修好。⇒ 无需本 PR 处理。
2. **新版判据能否识别「内容级混版」**：不能——`isInstalled` 只查文件存在性，
   共享根当时 `isInstalled: true`（假阳性消除）但 `index.cjs` 内容仍错。
   这是**已知边界**：文件在但内容错，只能靠 restore 或重装。已登记为遗留，不做内容校验
   （那需要解析 index.cjs 的 require 目标，超出依赖健康检查的职责）。

## 七、门禁与取证

| 门禁 | 读数 |
| --- | --- |
| TDD | 先红 1 条 → 后绿 `19 passed / 0 failed` |
| 变异反证 | 2/2 CAUGHT，逐字节还原 |
| 真实树 `--check` | `DESKTOP_DEPS_OK`（rc=0，新建 worktree 完整依赖） |
| 变更类型判定 | `classify-docs-only.js` ⇒ 混合 PR（改 `scripts/` 自身） |
| 行尾对账 | `git diff --numstat` 与 `--ignore-cr-at-eol` 两口径一致（2/2） |
| 品牌残留 / doc-abs-paths / 行数门禁 | 全 PASS |
| 执行记录 | `check-pr-exec-record.js --mode=enforce` |
| CCG 提交门禁 | pre-commit 5 项 |
| QM-1 打包 | 未改 `apps/desktop/electron/`，不适用 |
| QM-6 深度评审 | 见 `.ccg/reviews/<sha>.json` 与 `.adversarial/` 产物 |

| 远程同步 | PENDING |
