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
