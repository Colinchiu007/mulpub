---
record: dep-audit-undici-fasturi-floor
task: 抬高 undici / fast-uri 两条 pnpm override 的下界到 2026-10-24 新公告的修复版本、刷新锁文件真正修掉这 7 条，并结掉 PR #4356 为它们登记的挂账
date: 2026-10-24
---

## 本次执行记录：undici / fast-uri 覆写下界随公告修复版抬升 + 锁文件刷新 + 结掉同批挂账（dep-audit-undici-fasturi-floor，2026-10-24）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 运行时代码（依赖配置 + 锁 + 门禁数据文件 + 回归锁常量） | 依赖配置与锁文件变更 ⇒ 走完整质量节拍，不借道 docs-only 快速通道；改动落在 `pnpm-workspace.yaml`（overrides 段）、`pnpm-lock.yaml`（overrides 段 + 解析结果）、`scripts/dep-audit-baseline.json`（摘掉 7 条已修挂账）、`packages/api-publish-engine/test/production-dependency-security.test.js`（既有棘轮用例的常量表）四处，另加本记录 |
| 第一性原因（QM-5 ①） | 已定位 | 门禁红的是**公告库侧新增事实**与**本仓覆写下界未同步**的差集：GitHub Advisory Database 在 2026-10-24 新增 undici 3 条（`GHSA-xjj6-f33q-929c` high / `GHSA-4qv8-2p9j-2685` / `GHSA-f72v-6w45-q472`，修复下界 `>=7.30.1`）与 fast-uri 4 条（`GHSA-w74x-v6f9-j3xg` / `GHSA-wjr9-j795-jxcr` / `GHSA-333x-w4r6-6crp` / `GHSA-xhq7-xmqj-769h`，修复下界 `>=3.1.9`）。本仓 `pnpm-workspace.yaml` 的两条 override 下界仍停在此前那一波公告的修复版（undici `^7.29.1` / fast-uri `^3.1.7`），锁里解析出的 `undici@7.30.0` / `fast-uri@3.1.8` **满足**旧下界、却**低于**新公告的修复下界 ⇒ 判「新公告」⇒ 红。**判据本身是对的**，缺的是下界与锁一起跟到公告 |
| 逃逸分析（QM-5 ②） | 逐层 | ①**公告层**：7 条公告全部命中 `undici` / `fast-uri`，两者在本仓都是**纯传递依赖**（实测：`importers` 段无人直接声明；undici 由 `@electron/get@5.0.0` / `cheerio@1.2.0` / `jsdom@29.1.1` 声明，fast-uri 由 `ajv@8.18.0` / `ajv@8.20.0` 声明）⇒ 直接改某个包的 `package.json` 区间**抬不动**它们；②**覆写层**：`pnpm-workspace.yaml` 已有 `undici` / `fast-uri` 两条 override，但**下界是旧的** ⇒ 升 workspace 包的区间也抬不动；③**锁层**：锁里的解析版本是 `7.30.0` / `3.1.8`，两者都落在旧下界区间内 ⇒ 只跑一次 `pnpm install` **不会**把版本抬到修复版（pnpm 复用已满足的旧解）——这正是「刷新 lockfile」这一步单独做**不够**的原因；④**棘轮层**：`production-dependency-security.test.js` 的 `OVERRIDE_FLOORS` 同样停在 `7.29.1` / `3.1.7` ⇒ 覆写地板棘轮判**绿**、依赖漏洞审计判**红**，两条判据各说各话，**这是本仓第一次出现「同一条事实被两条判据分别读成相反结论」**（此前 axios 那次是「两条都红」，形态不同）；⑤**挂账层**：`scripts/dep-audit-baseline.json` 是快照式挂账，走「登记」可以清红，但那是把未修的洞记成已记账（见「与 #4356 的关系」一节） |
| 修复 + 回归保护（QM-5 ④） | 已落地 | 四处同步改：①`pnpm-workspace.yaml` 两条 override 下界 `^7.29.1`→`^7.30.1`、`^3.1.7`→`^3.1.9`；②`pnpm-lock.yaml` 用 `pnpm install --lockfile-only` 重解析 ⇒ **全树收敛到单一版本**（undici 只有 `7.30.1`、fast-uri 只有 `3.1.9`；`undici@7.30.0` 与 `fast-uri@3.1.8` 在锁里**彻底消失**，不再是「只升了 prod、dev 域还留着一份低危副本」）；③`production-dependency-security.test.js` 的 `OVERRIDE_FLOORS` 同步抬到 `7.30.1` / `3.1.9` ⇒ 棘轮从此守的是**当前**公告的修复下界；④`scripts/dep-audit-baseline.json` **摘掉**这 7 条已修挂账（37 → 30 条，**纯删除、零新增行**，其余 30 条逐字未动）。锁文件差量 **39 行**：overrides 段 2 行、两个包的 resolution+integrity 4 行、snapshots 引用 5 行、`glob 7.2.0→7.2.3`（2 处传递 patch）、`ora 5.3.0→5.4.1`（1 处传递 minor）、`deprecated:` 元数据文案刷新 3 行（registry 侧文本，无功能影响） |
| 防止再次发生（QM-5 ⑤） | ✅（含判据侧的一处真修） | 本次最有价值的产出不是版本号本身，而是**把「覆写下界 = 公告修复下界」这条耦合写进判据**：此前 `OVERRIDE_FLOORS` 是「公告库新增 ⇒ 人记得来抬」，人没记得时它不响；现在它与公告的修复下界对齐，且**锁里解析版本被同一条用例钉住**（既有的「锁里 undici / fast-uri 仍落在同一 major 且不低于修复版」那条）⇒ 覆写下界被抬、锁没跟上，或锁被降级，两条用例都会红。`pnpm-workspace.yaml` 的注释里也补了「**只刷 lockfile 不抬下界 / 只抬下界不刷 lockfile，两条判据都各说各话**」这段来由 |
| 行尾与 diff 对账 | ✅ | 四个改动文件均实测为**纯 LF blob**（`pnpm-workspace.yaml` 80 LF / 0 CR、`pnpm-lock.yaml` 14944 LF / 0 CR、测试文件 243 LF / 0 CR、`scripts/dep-audit-baseline.json` 经 JSON 往返实测字节一致）⇒ 本次改动不触碰行尾，不存在 CRLF/LF 混存带来的幽灵行。基线文件的回写方式见 §2.1（**先证明 JSON 序列化能字节还原原文件**，再动） |
| 接线棘轮 | N/A | 未新增 `*.test.js`；改的是**既有**棘轮用例的常量表（`OVERRIDE_FLOORS`），该文件已在仓内既有 workflow 的测试面内 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 与任何 UI 文件；未改 electron 版本 ⇒ 打包链与视觉基线不受影响 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper` / `claude` / `opencode` 后端，**如实写「未执行」，不以自审冒充通过**。替代的自证是本记录下方的「反证」三档变异：证明新抬的地板**有牙齿**（能被判红），而不是「加了行注释就算防复发」 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 一、与 #4356 的关系：记账与还账

本会话开工时（main = `d94f83a7bd42`），门禁在 main 上以 **7 条 `NEW_ADVISORY`** 连红。
**在本次改动落地之前**，另一条线把同一批 7 条以「登记」的方式合进了 main：

- PR **#4356**「fix(dep-audit): 登记 2026-10-24 新涌出的 7 条依赖公告」，
  merge SHA `cb50f0c9af36`，2026-10-24T02:25:07Z。基线 30 → **37 条**，
  7 条全部登记为 `upgrade-tracked`（targetVersion = 公告的修复下界），note 首句即写「未经可利用性评估」。

它走的是门禁给出的**两条出路之一**（登记），并明确**没有做实际升级**。

本 PR 与它**不是竞争关系，是互补关系**：

| | #4356（已合） | 本 PR |
|---|---|---|
| 对这 7 条做了什么 | **记账**：登记 `upgrade-tracked` + note，承诺「动作 = 升级并刷新 lockfile」 | **还账**：真的升级了（undici→7.30.1、fast-uri→3.1.9）并刷新锁文件 |
| 漏洞现状 | 仍然命中，靠挂账压住门禁 | **不再命中**，从扫描面消失 |
| 挂账状态 | 7 条挂着，等 reviewBy（2026-12-31）到期 | **摘掉这 7 条**（37 → 30），门禁读数回到「现实 30 = 基线 30」 |

**若本 PR 不摘掉那 7 条会怎样**：基线里有、扫描里没有 ⇒ 门禁判 `RESOLVED_STILL_BASELINED`
（「已不再命中（多半已升级），请 --update 清账」）⇒ **本 PR 会把门禁弄红**。
⇒ 这不是「顺手清账」，是本 PR 成立的**必要条件**：升级与清账必须同一次落地，否则升级本身变成新的红。

### 二、本机实测（逐条亲自跑出来的）

#### 2.1 为什么**没有**用 `node scripts/check-dep-audit.js --update` 来清账

门禁的红文案让人「跑 `--update` 清账」。本机实跑了，**它的产物不能直接用**——实况如下：

1. `--update` 确实**正确地**摘掉了那 7 条（37 → 30，零新增），这部分符合预期。
2. 但它同时**改写了另外 13 条**既有条目的字段：`roots` 有 10 条多出 `.`（根 importer 也消费它们）、
   2 条 pip 补上 `aliases`、1 条 `patched` 从 `>=1.1.16` 变成 **`>=5.0.7`**。
3. 第 2 条里那个 `patched` 跳变会**当场制造一条红**：

```
❌ DECISION_CONTRADICTS_PATCHED: npm/GHSA-3jxr-9vmj-r5cp 的目标版本 1.1.16 低于修复下界 >=5.0.7
   —— 升上去仍然命中该公告，这笔账永远闭不了（patched 全段=>=5.0.7）
```

**根因（已定位，且与本次改动无关）**：`scripts/check-dep-audit.js` 的 `parseNpmAudit`（pnpm 域解析器）
对**同一 GHSA 的多个修复族**只保留**最后读到的那一个** `patched`（`patched` 字段直接覆盖，不合并），
而 `parseNpmAuditV2`（npm v2 域解析器）**是合并的**（`[...new Set([prev.patched, patched])].join(', ')`）。
实测 `brace-expansion` 的同一 GHSA 在 pnpm 原始输出里有 **12 个族**（6 个 GHSA × 2 条修复线：
1.x 线 `>=1.1.16`~`>=1.1.21`、5.x 线 `>=5.0.7`~`>=5.0.12`），
记录哪个下界取决于 **npm 响应里这些族的先后顺序** ⇒ 该字段**非确定**。

**对照实验（证明与本次改动无关）**：把 **main 的旧锁** 与本次的新锁分别喂给 `pnpm audit --prod`，
两者产出的 12 个族**逐条完全相同**（含 `>=5.0.7`）；锁里 `brace-expansion` 的三个版本
（`1.1.15` / `2.1.4` / `5.0.6`）在两份锁里也**逐字相同**。
⇒ **`--update` 今天在 main 上跑同样会写进 `>=5.0.7` 并撞上同一条矛盾**。
本 PR 若直接采用 `--update` 的产物，就是替别人踩了同一颗雷，还要连带解释 13 条无关字段的改写。

**本 PR 的处置**：**外科式清账**——用 JSON 解析取出基线、**只摘掉那 7 条**、其余 30 条**逐字不动**，
回写格式与 `writeBaseline` 一致（`JSON.stringify(body, null, 2) + '\n'`）。
动手前先证明该序列化能**字节还原原文件**（实测：26440 字节 → 26440 字节，逐字节相同），
再动；事后 diff 为**纯删除 101 行、零新增行**。
⇒ 结论一致（37 → 30），但**不引入任何无关字段的改写**，也不把那颗雷带进来。

#### 2.2 门禁红的是 7 条，不是转交材料里写的 10 条

转交材料（PR #4355 的提案正文）写的是 10 条 `NEW_ADVISORY`。**那是旧快照**：
main 的 HEAD 当时已是 PR #4354「登记 2026-10-23 同批同步的三条公告（zod / body-parser / electron）」，
那三条已进基线（基线 27 → 30 条）。
本机在**未改动的 main**（`d94f83a7bd42`）上跑 `node scripts/check-dep-audit.js`（三个域都真扫）：

```
命中分布: npm=33 npm-opscenter=2 pip=0 命中=35 挂账=30
❌ NEW_ADVISORY: npm/GHSA-333x-w4r6-6crp (fast-uri low, 修复版本 >=3.1.9, 路径 .|packages__remotion-composer)
❌ NEW_ADVISORY: npm/GHSA-4qv8-2p9j-2685 (undici moderate, 修复版本 >=7.30.1, 路径 .|apps__desktop|packages__rpa-engine|packages__shared-utils)
❌ NEW_ADVISORY: npm/GHSA-f72v-6w45-q472 (undici moderate, 修复版本 >=7.30.1, 路径 .|apps__desktop|packages__rpa-engine|packages__shared-utils)
❌ NEW_ADVISORY: npm/GHSA-w74x-v6f9-j3xg (fast-uri moderate, 修复版本 >=3.1.9, 路径 .|packages__remotion-composer)
❌ NEW_ADVISORY: npm/GHSA-wjr9-j795-jxcr (fast-uri moderate, 修复版本 >=3.1.9, 路径 .|packages__remotion-composer)
❌ NEW_ADVISORY: npm/GHSA-xhq7-xmqj-769h (fast-uri low, 修复版本 >=3.1.9, 路径 .|packages__remotion-composer)
❌ NEW_ADVISORY: npm/GHSA-xjj6-f33q-929c (undici high, 修复版本 >=7.30.1, 路径 .|apps__desktop|packages__rpa-engine|packages__shared-utils)
```

⇒ 7 条 = **undici 3 条 + fast-uri 4 条**，全在 npm 域。`npm-opscenter` 域 2 条、`pip` 域 2 条
（`PYSEC-2026-1325` ecdsa / `PYSEC-2026-4298` python-jose）**均已在基线内**，本轮零违规。
**zod / body-parser / electron 三条不归本次管**——#4354 已按 `upgrade-tracked` 登记，它们不是红的原因。

#### 2.3 修复前后逐项对比（同一台机器、同一组扫描器）

| 口径 | 修复前（main `cb50f0c9af`，即 #4356 之后） | 修复后（本 PR） |
|---|---|---|
| `pnpm audit --prod` 公告数 | 33 | **26** |
| 门禁违规数 | 0（#4356 记账压住） | **0** |
| 门禁退出码 | rc=0 | **rc=0** |
| 基线条数 | 37（含 7 条挂账） | **30**（7 条已修，摘掉） |
| 命中 / 挂账 | 30 / 37 | **30 / 30** |
| 锁里 undici 版本 | `7.30.0`（唯一） | **`7.30.1`（唯一）** |
| 锁里 fast-uri 版本 | `3.1.8`（唯一） | **`3.1.9`（唯一）** |
| 锁里是否残留未修复副本 | — | **无**（`undici@7.30.0` / `fast-uri@3.1.8` 已从锁中消失） |

修复后门禁首行：`✅ 无新增已知漏洞公告，基线与现实一致且结论完整。`

#### 2.4 为什么「只刷新 lockfile」不够（本案最要紧的一段）

转交材料的建议是「A 级：undici / fast-uri 直接升级」。**只刷 lockfile 是不够的**，本机实测给出了原因：
锁里的 `undici@7.30.0` **满足**旧 override 区间 `^7.29.1`，`fast-uri@3.1.8` 同样满足 `^3.1.7`
⇒ pnpm 复用旧解，**不抬版本** ⇒ 公告照旧命中。必须**同时**把 override 下界抬到公告的修复下界。

反过来，**只抬下界不刷 lockfile** 也不行：锁里那份旧解还在 ⇒ 同样判红。
⇒ **两边必须一起动**，这也是本 PR 除了版本号还要改 `production-dependency-security.test.js` 的原因。

#### 2.5 与在飞 PR #4345 的覆盖面比对（同一处有并行改动，先比覆盖面再决定谁留）

PR #4345（`model-provider-status-tristate`，在飞）**也**刷新了 `pnpm-lock.yaml`，实测它的锁里
`fast-uri` 已是 `3.1.9`、`undici` 新增了 `7.30.1`。本机把两份锁分别喂给 `pnpm audit --prod` 对比：

| 锁 | 公告数 | 与 main 的差集 | 锁里是否残留 `undici@7.30.0` |
|---|---|---|---|
| main | 33 | — | 是（唯一版本 7.30.0） |
| #4345 | 26 | 恰好少那 7 条、零新增 | **是**（`cheerio` 那条路径仍指 7.30.0） |

⇒ #4345 的锁**能让门禁变绿**，但它变绿的原因是「残留的那份 `undici@7.30.0` 只被 dev 域路径引用，
而门禁扫的是 `pnpm audit --prod` 看不见它」。这正是本仓 `pnpm-workspace.yaml` 里 axios 那段注释
**逐字写下**的同一个陷阱：「只升 prod 会让门禁变绿、锁里那份低危副本一条没少」。
⇒ 本 PR 的覆盖面**严格更大**：把下界抬到公告的修复下界，让**全树（含 dev 域）收敛到单一已修版本**，
残留副本从锁里**消失**，而不只是从门禁视野里消失。

#### 2.6 反证（锁必须能红）

四档跑同一套件（`node --test packages/api-publish-engine/test/production-dependency-security.test.js`）。
**基线读数说明**：该套件共 7 例，其中「每一个 axios 直接消费方…」那条在本机**恒红** ——
它要 `require.resolve('axios/package.json')`，而本机沙箱在本 PR 落地时**未装 node_modules**
（`Cannot find module 'axios/package.json'`）。**对照实验**：在**未改动的 main** 上一字不差地跑同一套件，
读数**完全相同**（6 pass / 1 fail，同样是 axios 那条 `MODULE_NOT_FOUND`）⇒ 这条红是**环境缺口**、
不是本次改动引入。故本节读数看**差分**（哪一档让**哪一条**变红），不看绝对通过数。

| 档 | 变异内容 | 变红的用例 | 通过/失败 | 还原 |
|---|---|---|---|---|
| M0 | 无变异（基线） | 仅 axios 那条（环境缺口） | 6 / 1 | — |
| M1 | 两条 override 下界退回 `^7.29.1` / `^3.1.7`（**workspace 与锁同改**） | **「每条 pnpm override 都必须有上界」**（其内地板断言：`override undici 低于修复版本 7.30.1`） | 5 / 2 | `restored=true` |
| M2 | 只改 workspace（`fast-uri` → `^3.9.9`），**锁不动** ⇒ 两把锁漂移 | **「lock 的 overrides 段必须与 workspace 逐条一致」** | 5 / 2 | `restored=true` |
| M3 | 锁里 undici 解析版本降回 `7.30.0`（改 2 处 `undici@7.30.1` + 3 处 `undici: 7.30.1`） | **「收上界不得改变解析结果：锁里 undici / fast-uri 仍落在同一 major 且不低于修复版」** | 5 / 2 | `restored=true` |
| M4 | 三档全部还原后复跑 | 仅 axios 那条（环境缺口） | 6 / 1 | — |

三点读数：

1. **每档恰好一条用例变红，且各不相同** ⇒ 三条判据**互不掩盖**：地板判据（test 3）、两锁一致性（test 4）、
   锁内版本地板（test 5）各守各的那一格。M2 尤其关键：它红的是**漂移锁**那条而**不是**上界那条，
   证明「下界抬了但锁没跟」这一形态有专属出口。
2. **M1 证明新抬的地板有牙齿**：把下界退回旧公告的修复版，地板断言当场红 —— 也就是「下界忘了跟着公告抬」
   这件事从此由判据挡，不再靠人记得。
3. **M3 证明锁内版本也守得住**：把锁里的 undici 降回 `7.30.0`，「不低于修复下限」当场红。

三档均**先断言「文本真的变了」**（打印变异前后的行内容）再**按字节还原**，还原后 md5 与变异前一致
（`restored=true`）并复跑回绿。

#### 2.7 CI 等价判据

`pnpm install --lockfile-only --frozen-lockfile` **rc=0**（13 个 workspace 项目，锁**未被重写**，
且 pnpm 11 的 `✓ Lockfile passes supply-chain policies` 通过）⇒ 证明这份锁与「workspace manifests + overrides」
一致，CI 的 `pnpm install --frozen-lockfile` 不会拒它。**这一步不可省**：本 PR 改的正是 overrides，
而 pnpm 的 overrides 段在 workspace 与锁里各存一份，两份漂移时 frozen install 直接失败。

### 三、遗留（不假装已闭合）

- **`parseNpmAudit` 的 `patched` 字段非确定（本次挖出的真缺陷，未修）**：
  pnpm 域解析器对同一 GHSA 的多个修复族只保留最后读到的那一个（覆盖，不合并），
  而 `parseNpmAuditV2` 是合并的 ⇒ 记录下来的下界取决于 npm 响应里各族的先后顺序。
  实测 `brace-expansion` 一个 GHSA 就有 12 个族（1.x 线 6 个 + 5.x 线 6 个）。
  **后果**：`--update` 今天会写进 `>=5.0.7` 并触发 `DECISION_CONTRADICTS_PATCHED`（本记录 §2.1 有实测）。
  **为什么本 PR 不顺手修**：修好它（改成合并）会让 `patched` 变成多段下界，
  `checkTargetEscapes` 随即要求 `targetVersion >= 每一段` ⇒ 那 6 条 brace-expansion 族的
  既有 `targetVersion`（1.1.16 一侧）**当场判红**，必须连同人工结论一起重判 ——
  这是**另一个 PR 的工作量**，且与「解主干红」无关，夹带进来会让本 PR 的变更面失焦。
  ⇒ 建议单独立项：把 `parseNpmAudit` 的 `patched` 改成与 `parseNpmAuditV2` 同形的合并语义，
  再逐条重判 brace-expansion 族的人工结论。
- **`ops-center/frontend` 的 undici 仍在修复版之下**：它用自己的 `package-lock.json`（npm 管理，不在 pnpm
  workspace 内），实测解析到 `undici@7.29.0`。它是 **dev 依赖**（vitest 链），而 `npm-opscenter` 域按
  `npm audit --omit=dev` 扫 ⇒ 当前不可见。是否把 dev 域收进判定，是仓内 `undici-fasturi-bounded`
  （2026-10-05）已登记的同一个决策，本 PR **不夹带**。
- **undici 8.x / fast-uri 4.x 的 major 抬升仍是一次显式决策**：本仓 override 刻意保留 major 7 / 3
  （既有棘轮用例也钉住「不得跨 major」）。要不要真升 8.x 涉及 `@electron/get` / `cheerio` / `jsdom`
  三家对 undici 的区间预期 ⇒ 另议。
- **zod / body-parser / electron 三条 high 公告仍未修复**（#4354 登记为 `upgrade-tracked`）：
  其中 **body-parser 那条在本仓是字面成立的未认证进程级 DoS**（`express.json()` 默认 `inflate:true`、
  鉴权中间件挂在 body 解析之后、`app.listen` 未绑回环地址）。本 PR 只处理它自己修掉的那 7 条，
  **不假装这三条已经消失** —— 真正的处置动作在 #4354 的记录里已单独立项。
- **AGENTS.md 的 electron 版本号是陈的**：`AGENTS.md` 的打包小节仍写「需 node_modules 里有 electron@43.1.1」，
  而锁里实际是 `43.7.7`、override 是 `^43.7.7`。与本次改动无关（本次未动 electron），
  但下一个动 electron 的人会被这句绊一次。

## CHANGELOG 条目

# fix(dep-audit): 真正修掉 undici / fast-uri 7 条依赖公告并结掉挂账，同时把覆写下界钉到公告修复版（dep-audit-undici-fasturi-floor）

- 依赖漏洞审计门禁对每个 PR 都跑，2026-10-24 GitHub Advisory Database 新增 undici 3 条与 fast-uri 4 条公告
  （修复下界分别为 `>=7.30.1` 与 `>=3.1.9`），使**全仓所有 open PR 同时变红**，与各自改动无关。
- 根因不是「有人改坏了」，是**覆写下界没跟上公告**：本仓的 `undici` / `fast-uri` override 下界仍停在此前
  那一波公告的修复版，锁里解析出的版本满足旧下界、却低于新公告的修复下界 ⇒ 门禁判「新公告」。
- 本次把两条 override 的下界抬到公告的修复版本并刷新锁文件，**全树收敛到单一已修版本**
  （undici `7.30.1`、fast-uri `3.1.9`），锁里不再残留低危副本。
- PR #4356 已把这 7 条登记为挂账（基线 30 → 37 条）；本次**真的升级**了它们，
  因此把那 7 条挂账**结掉**（基线 37 → 30 条）——升级与清账必须同一次落地，
  否则「已修」在门禁眼里会变成「基线腐化」而判红。
- 同时把覆写地板棘轮的下界同步抬到当前公告的修复版本，使「下界忘了抬」这件事以后由判据当场挡住，
  而不是靠人记得。

## learnings

### lesson: 「刷新 lockfile」与「抬高覆写下界」必须一起动，只动一边两条判据会各说各话（dep-audit-undici-fasturi-floor）

**现场**：依赖漏洞审计门禁在 main 上以 7 条 `NEW_ADVISORY` 连红（undici 3 条 / fast-uri 4 条）。
按直觉「升级依赖 ⇒ 刷新 lockfile 即可」操作后，版本纹丝不动 —— 锁里的 `undici@7.30.0`
**满足**仓库里既有的 override 区间 `^7.29.1`，pnpm 复用旧解、不抬版本。

**根因**：override 的**下界**才是决定解析结果的那一格，而下界是**按上一波公告的修复版**手工写死的。
公告库新增一波 ⇒ 下界与实际修复下界之间出现差集 ⇒ 门禁判红。
更隐蔽的一层是：`production-dependency-security.test.js` 的 `OVERRIDE_FLOORS` 也停在同一个旧数字上，
于是**覆写地板棘轮判绿、依赖漏洞审计判红** —— 两条判据读的是同一个事实，结论却相反。

**可复用的 N 条**：

1. 「升级依赖」这个动作在有 override 的仓库里是**两格**的（下界 + 锁），只动一格等于没动；
   判据问三遍：**下界抬了吗？锁跟着抬了吗？两格的下界是不是同一个数？**
2. 当两条判据对同一份事实给出相反结论时，**先怀疑它们的常量表不同步**，而不是怀疑其中一条坏了 ——
   本案两条都是对的，只是各自锚在不同时间的公告上。
3. 覆写/别名/白名单这类「按名字生效的规则」都要有一条**跟着事实走的**地板判据：
   地板值必须锚在「当前公告的修复下界」上，而不是锚在「当初写它时那批公告的修复下界」上。
4. 抬下界后要**确认全树收敛到单一版本**（本仓查 `pnpm-lock.yaml` 里该包只剩一个版本条目）；
   只让「门禁看得见的那条路径」变干净，等于把漏洞挪到门禁视野外，不是修复。

### lesson: 别人已经「记账」的那笔账，升级时必须连着清账，否则升级本身变成新的红（dep-audit-undici-fasturi-floor）

**现场**：本 PR 在 lockfile 里把 undici / fast-uri 升到修复版之后，门禁反而报
`RESOLVED_STILL_BASELINED: … 已不再命中（多半已升级），请 --update 清账` ——
因为另一条线（#4356）已把这 7 条登记进基线。**升级修好的那一刻，就是「基线条目失效」的那一刻。**

**根因**：这条门禁的基线是**快照式**的，「现实命中 ⊆ 基线登记」是它的判据；
基线里有一条现实里已经没有 ⇒ 判「基线腐化」。登记与升级是**同一笔账的两种表达**，
只做其一会让另一面判红。

**可复用的 N 条**：

1. 修「某条公告」时，先查它**在基线里的状态**：不在基线 ⇒ 升级完就结束；在基线 ⇒ **升级 + 摘条目**必须同一次落地。
2. 判据是「现实 ⊆ 基线」还是「基线 ⊆ 现实」，决定了清账的方向；
   读红文案时先确认它要的是「补登记」还是「清死条目」。
3. 同题并行改动（一个登记、一个升级）**不冲突而是互补**，但**必须合并成一次落地**，
   否则两条各自都对、合起来却红。

### lesson: 工具产物的字段可能是非确定的，先证明它可靠再用（dep-audit-undici-fasturi-floor）

**现场**：门禁红文案让人跑 `node scripts/check-dep-audit.js --update` 清账。本机实跑：
它**正确地**摘掉了该摘的 7 条，却同时把 13 条无关条目的字段改了 —— 其中一条 `patched` 从
`>=1.1.16` 跳成 `>=5.0.7`，当场造出一条 `DECISION_CONTRADICTS_PATCHED`。
根因是 `parseNpmAudit` 对同一 GHSA 的多个修复族**只保留最后读到的那一个**（覆盖不合并），
而 `parseNpmAuditV2` 是合并的 ⇒ 该字段取决于 npm 响应里各族的先后顺序。

**根因**：两个解析器对**同一语义**（多族规格）用了**两种口径**（覆盖 vs 合并），
其中被门禁实际使用的那一个写错了。这不是「工具坏了」，是「工具的某个字段不可信」。

**可复用的 N 条**：

1. 用工具产物改数据文件之前，**先跑一遍看它到底改了什么**（逐条对比，不是看总数）。
2. 工具改了与本次意图**无关**的字段时，那是信号：要么该字段不可信，要么工具的默认行为不适合当前场景。
3. 区分「工具的结论」与「工具的字段」：结论（该摘哪几条）可以采信，字段（`patched`）要自己核。
4. 改数据文件前先证明**序列化能字节还原原文件**，再动；改完 diff 必须是**纯删除、零新增行**才安心。
5. 要判「这个字段是本次改动造成的吗」，做**对照实验**：拿**改动前的锁**跑同一条命令比输出，
   而不是靠推理（本次两份锁的 12 个族逐条相同 ⇒ 与改动无关）。
