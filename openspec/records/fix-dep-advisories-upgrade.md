---
record: fix-dep-advisories-upgrade
task: 升级 body-parser 两条线 / zod / electron 解掉 7 条依赖公告，并清掉基线里已不再命中的挂账
date: 2026-10-24
---

## 本次执行记录：依赖公告升级片（fix-dep-advisories-upgrade，2026-10-24）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 依赖/工具链变更（`pnpm-workspace.yaml` 的 overrides、`pnpm-lock.yaml`、`scripts/dep-audit-baseline.json`、既有棘轮测试）⇒ 隔离 worktree + 裸分支 `fix-dep-advisories-upgrade`；共享主目录留在 `main` |
| 第一性原因（QM-5 ①） | ✅ | 三条公告把「基线靠每个 PR 手工维护」这条路推到极限：**zod**（GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404，修复下界 4.6.6）被**精确 pin 在 4.3.6** 的地方有 5 处（`@modelcontextprotocol/sdk@1.32.1`、`@remotion/media@4.0.484`、`@remotion/studio@4.0.484`、`mutation-server-protocol@0.4.1`、`zod-to-json-schema@3.25.2`）⇒ **升 remotion 也解不了**（4.0.538 最新版自己 pin 的是 4.5.4 < 4.6.6）⇒ 只能 override；**body-parser**（GHSA-27r3-jxmh-p828）两条线都命中（1.20.5 < 1.20.9、2.3.0 ∈ [2.0.0,2.4.0)）；**electron**（GHSA-jr5w-w6x2-84p9）43.7.7 落在 43.x 区间（<43.8.1），而 `electron-updater@6.8.9` 把它钉死 ⇒ 门禁扫描命中的正是 `packages__rpa-engine>electron` / `packages__shared-utils>electron` 两条 optional peer 路径 |
| 逃逸分析（QM-5 ②） | ✅ | ①**公告流在持续发布**：本会话内该门禁红了 **4 轮**（zod → body-parser+electron → fast-uri×4+undici×2，全部集中在 2026-10-01 与 2026-10-23 两天）⇒ 任何重跑该 check 的 PR 都会被新公告挡，**与 PR 改了什么无关**；②**基线靠每个 PR 手工维护**：仓里「每周一 03:00 UTC 定时跑」是权威来源，但那个跑**只出结论、不写基线** ⇒ 结论是「基线过期了」，而修基线的动作落在每个 PR 头上；③**「只升 devDependency 门禁不会变绿」这个陷阱本仓已写进注释**（electron 那段）⇒ 本片按既有机制走 overrides 而非只升声明 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①`pnpm-workspace.yaml` 的 overrides 增 `zod: '^4.6.6'`、把 `electron` 的下界从 `^43.7.7` 抬到 `^43.8.1`（**两条都带 `^` 上界** ⇒ 既有棘轮 `hasUpperBound` 判据强制）；②锁里解析结果：`zod@4.6.7`、`electron@43.8.3`、`body-parser@1.20.9` + `body-parser@2.4.0`、`express@4.22.3`；③`scripts/dep-audit-baseline.json` **从 30 条缩到 23 条**（删掉 7 条已不再命中的挂账，基线**只能缩小**）；④**棘轮表补下限**：`packages/api-publish-engine/test/production-dependency-security.test.js` 的 `OVERRIDE_FLOORS` 把 `electron` 从 43.5.0 抬到 **43.8.1**、新增 `zod: 4.6.6` ⇒ 新下限从此有人守（复跑 7/7 绿） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①**新 override 必须带 `^` 上界**——既有棘轮 `每条 pnpm override 都必须有上界（裸 >= 下限一律判红）` 强制，且失败文案由 `boundedHint()` 单一真源生成；②**锁的 overrides 段必须与 `pnpm-workspace.yaml` 逐条一致**（既有棘轮强制，CI 走 `--frozen-lockfile` 会直接拒绝）⇒ 漂移在本地就被拦；③新增的 `zod` 下界进了 `OVERRIDE_FLOORS` ⇒ 将来若有人把 override 降回 4.3.6，**当场红** |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 逐行相等（提交前实测） |
| 接线棘轮 | ✅ | 本次**未新增** `*.test.js`（改的是既有棘轮测试文件 `production-dependency-security.test.js`，它已在 CI 的 `node --test` 点名内）⇒ 无需新增 workflow 点名 |
| QM-1 打包 / QM-4 视觉 | N/A | QM-1：改动在依赖解析面（lockfile + overrides），不触碰打包产物；QM-4：无任何界面渲染变更（无 .vue / CSS / locale 改动） |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未见可用的外部评审通道；**如实记为未执行，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写** |

### 处置取舍：这次是「升级」而不是「挂账」

主干的挂账形态是「登记 decision + note，动作留给下一个 PR」。本片**直接做动作**，理由：

1. 门禁给的第一个选项就是「升级依赖」；
2. 三条里有两条（body-parser 两条线、electron）是**补丁级**；
3. 代价对比：挂 3 笔账约 +45 行且把债留给下一个人；升级是 `pnpm-lock.yaml` 几十行 + 两条 override，**一次解掉 7 条**（含 fast-uri/undici 那批已由前一片解掉的）；
4. 挂账是**推后**，升级是**解掉**。

### 实操要点（本片踩出来的，下次直接用）

| 要点 | 说明 |
|---|---|
| **override 只认 `pnpm-workspace.yaml`** | pnpm 11 起 `package.json` 的 `pnpm` 字段**会被忽略并告警** ⇒ 改错文件等于没改 |
| **删锁条目能逼 pnpm 重解** | 传递依赖的解析被锁「钉住」时，`pnpm update <pkg>` 推不动（`~1.20.5` 仍满足 1.20.5）⇒ 删掉该条目 + `pnpm install --lockfile-only` ⇒ pnpm 按范围重新解析并取到 1.20.9 |
| **删条目要连父包一起删** | 只删 `body-parser@1.20.5` 会留下**悬空引用**（express 的快照仍指向它）⇒ 连带删 `express@4.22.3` 的解析条目，让整棵子树重解 |
| **父包的 `~` 范围照样能升补丁** | express@4.22.3 声明 `body-parser: ~1.20.5` ⇒ 1.20.9 在范围内，**不需要 override**；只有 zod 那种「精确 pin」才需要 |
| **override 键不能带 `>`** | 既有棘轮的解析正则 `[\w./-]+` 不接受 `parent>child` 形态 ⇒ 父级限定式 override 在本仓用不了 ⇒ zod 只能走全局 override |

### 未闭合（不假装已闭合）

1. **公告流仍在发布**：本片合上后，下一批公告仍会让当时的 PR 连红。
   根治要么给基线加**定期自动刷新**（定时跑在授权下直接 `--update` + 自动补 decision/note），
   要么把 PR 侧降为「只报不拦」、新公告由每日定时跑统一收口。**本片不处理**（仓库级决策）。
2. **`zod` 的全局 override 是「强行突破」**：remotion 4.0.538 自己 pin 的是 4.5.4，
   本片把它抬到 4.6.7（同 major 的 minor）⇒ 上游没测过这个组合。
   已验：remotion / MCP / express 相关的 87 条用例全绿，但**渲染链的真机回归**未做（需人工）。
3. **基线里仍有 23 条挂账**（含 axios / ip-address 等），本片只清了因本次升级而失效的 7 条。
4. **dev 树不在门禁面内**：门禁按 `--omit=dev --prod` 扫 ⇒ dev-only 的传递依赖漏洞不会被这条门禁发现。

## CHANGELOG 条目

# fix(deps): 升级 body-parser 两条线 / zod / electron，解掉 7 条依赖公告并清账（fix-dep-advisories-upgrade）

- 把三条新公告对应的依赖**直接升级**掉，而不是再往挂账表里加几笔债：
  body-parser 两条线（1.20.5→1.20.9、2.3.0→2.4.0）、zod（4.3.6→4.6.7）、electron（43.7.7→43.8.3）。
  升级后门禁命中的公告从 26 条降到 19 条，**基线里 7 条已不再命中的挂账一并清掉**（30 → 23 条）。
- zod 只能靠 override：它被 5 处**精确钉死**在 4.3.6，而 remotion 的最新版（4.0.538）自己 pin 的是 4.5.4，
  仍低于修复下界 4.6.6 ⇒ 升 remotion 也解不了。两条新 override 都带 `^` 上界，既有棘轮会当场拦住无上界写法。
- electron 的下界抬到 43.8.1 并进了棘轮表 ⇒ 今后若有人把 override 降回去，当场红。
- 顺带修掉 express 4.22.2 → 4.22.3，body-parser 的 1.x 线随之从 1.20.5 升到 1.20.9。

## learnings

### lesson: dep-audit-upgrade-not-defer-when-it-is-a-patch

**现场**：依赖漏洞审计门禁在本会话内红了 4 轮，每轮都是新发布的公告（zod / body-parser /
electron / fast-uri×4 / undici×2）。仓里的通行形态是「登记 decision + note，动作留给下一个 PR」，
本片改为**直接把动作做掉**。

**根因**：挂账的成本不是那十几行 JSON，而是**它把「什么时候修」这个问题推给了下一个碰到它的人**；
而公告流在持续发布 ⇒ 「下一个」永远不会来 ⇒ 基线只涨不消 ⇒ 每个 PR 都在替全仓还债。

**可复用的 N 条**：

1. 判据：**补丁级 + 能刷 lockfile ⇒ 直接升级**；大版本 / 被精确 pin ⇒ 才挂账。
   代价对比要算到「谁在什么时候还这笔债」。
2. **挂了账 ≠ 修好了**。挂账是**记账**，升级才是**修复**；基线表变短是好事，不是丢账。
3. 升级前先量**声明面的真实范围**（registry 里父包的 dependencies）——
   `~1.20.5` 允许 1.20.9（刷 lockfile 即可），`4.3.6` 精确 pin（只能 override）⇒
   **同样是「传递依赖」，处置完全不同**。
4. 传递依赖被锁钉住时 `pnpm update` 推不动 ⇒ **删掉锁里的解析条目**（连父包一起删）让 pnpm 重解。
5. 本仓的 override **只认 `pnpm-workspace.yaml`**（pnpm 11 忽略 `package.json` 的 `pnpm` 字段），
   且既有棘轮要求**每条 override 都带 `^` 上界**、**锁里的 overrides 段与 workspace 逐条一致**。
6. **同一处有并行 PR 时**（本片撞上：主干 #4354 已登记同三条公告）⇒ 我的基线**用主干的逐字原文**，
   把差异降到零 ⇒ 合并无冲突。**「用真源的措辞」比「自己再写一份」便宜。**
