---
record: dep-audit-brace-expansion-floor
task: 真升级 brace-expansion 到修复版结掉 6 条 high 公告，并把 pnpm 域解析器 parseNpmAudit 的 patched 从「覆盖」改成「合并」以消灭该字段的非确定性（定时刷新第一次跑就产出红基线的根因）
date: 2026-10-24
---

## 本次执行记录：brace-expansion 升到修复版 + parseNpmAudit 的 patched 改合并语义（dep-audit-brace-expansion-floor，2026-10-24）

> **来由**：PR #4358 引入的定时刷新（`.github/workflows/dep-audit-refresh.yml`）**第一次真实运行就产出红基线**。
> 机器人自己刷出来的那份基线（`chore/dep-audit-refresh` 分支）里长这样：
>
> ```diff
> -      "patched": ">=1.1.16",
> +      "patched": ">=5.0.7",
>        "targetVersion": "1.1.16",
> ```
>
> ⇒ `DECISION_CONTRADICTS_PATCHED: npm/GHSA-3jxr-9vmj-r5cp 的目标版本 1.1.16 低于修复下界 >=5.0.7`
> —— **人已经判过的账，被一次机器刷新判成「永远闭不了」**。
> 本次分两层修：**① 事实层**（brace-expansion 确实还中招 ⇒ 真升级，让 6 条公告不再命中）
> 与 **② 判据层**（`parseNpmAudit` 的 `patched` 覆盖而非合并 ⇒ 该字段非确定 ⇒ 一次响应顺序抖动就能翻脸）。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 运行时代码（依赖配置 + 锁 + 门禁数据文件 + 判据本体 + 回归锁） | 改动落在 `pnpm-workspace.yaml`（overrides 段）、`pnpm-lock.yaml`、`scripts/dep-audit-baseline.json`、`scripts/check-dep-audit.js`、`scripts/check-dep-audit.test.js`、`packages/api-publish-engine/test/production-dependency-security.test.js` 六个文件；**不改任何 `package.json`、不改任何运行时代码** ⇒ QM-1 打包 / QM-4 视觉 N/A |
| 第一性原因（QM-5 ①） | 已定位，**两层根因** | **事实层**：6 条 high 公告覆盖 `brace-expansion` 的**两条修复线**（1.x 线 >=1.1.21、4.x/5.x 线 >=5.0.12），而本仓锁里解析出 `1.1.15`（1.x 槽）与 `5.0.6`（5.x 槽）⇒ **两条线都仍在易感区间内**；2.1.4 不在任何一条公告的易感区间里。**判据层**：`scripts/check-dep-audit.js` 的 `parseNpmAudit`（pnpm 域解析器）对**同一 GHSA 的多个修复族**，`patched` 字段是**覆盖**（只留最后读到的那一个），而 `parseNpmAuditV2`（npm v2 域）是**合并**的 ⇒ 记录下来的下界取决于 **npm 响应里各族的先后顺序** ⇒ **该字段非确定** |
| 逃逸分析（QM-5 ②） | 逐层 | ①**族为什么会多**：npm/pnpm 对**一个 GHSA 的多条易感区间**（不同版本线各有自己的修复版）返回**多条** advisory，共享同一个 `github_advisory_id`；`brace-expansion` 一条 GHSA 就是 2 族（1.x + 5.x），6 条 GHSA 共 12 族。②**覆盖为什么没被发现**：`parseNpmAuditV2` 早就是合并语义（同样的多族问题在 npm v2 域被处理过），**两个解析器对同一语义用了两种口径**，而门禁实际用的是 pnpm 域那个。③**为什么人判过的账会被机器翻脸**：`patched` 会与人工写的 `targetVersion` 配对（`checkTargetEscapes` 判「目标版本低于修复下界 ⇒ 闭不了账」），⇒ 一次顺序抖动就足以让**已闭合的账**当场判红。④**为什么台账里看得到指纹**：main 的基线里那 6 条 `patched` 存的是 `>=1.1.16` / `>=5.0.10` / `>=5.0.8` / `>=5.0.12` / `>=5.0.11` / `>=1.1.18` —— **同一个 GHSA 的两个族各被随机记了一个**，这就是非确定性的现场 |
| 修复 + 回归保护（QM-5 ④） | 已落地 | **① 事实层**：两个槽位各自钉在自己 major 内（`minimatch@3>brace-expansion: '^1.1.21'`、`minimatch@10>brace-expansion: '^5.0.12'`）⇒ 锁里解析出 `1.1.21` / `5.0.12` / `2.1.4`（2.x 不中招，原样不动）⇒ **6 条公告全部不再命中**。**② 判据层**：`parseNpmAudit` 的 `patched` 改成**去重 + 按版本号数值升序**的合并语义（与 `parseNpmAuditV2` 对齐），**并保留保守侧**：任一族没有修复版本 ⇒ 合并结果也是空（有一条线无解 ⇒ 整本账无解）。**③ 回归锁**：`scripts/check-dep-audit.test.js` 新增 2 例（多族合并 + **顺序无关** + 数值排序 + 去重；任一族无解 ⇒ 结果为空），`production-dependency-security.test.js` 新增 1 例（锁里 brace-expansion 的两个槽位必须各自落在自己 major 的修复版上，且不许出现未登记的 major） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①**判据不再非确定**：合并 + 排序 ⇒ 同一份锁、同一批公告，**两次刷新的产物逐字节相同**（本次实测幂等，见下）⇒ 「响应顺序抖动」这一类红**从机制上消失**。②**下界跟着公告走**：本次把 `overrides` 的地板抬到公告的修复下界（1.x >=1.1.21 / 5.x >=5.0.12），并由棘轮用例盯住「锁里必须真的落到那两个版本」⇒ 「下界忘了抬」与「覆写写了但没生效」这两类当场红。③**parent>child 覆写进了棘轮的解析范围**：既有棘轮用例的 overrides 解析正则原本是 `[\w./-]+`，**不接受** `minimatch@3>brace-expansion` 这种键（`@` 与 `>` 都在字符类外）⇒ 本次一并放宽并留注释说明为什么必须收下这两种键形态 |
| 行尾与 diff 对账 | ✅ | 四个改动文件均实测为**纯 LF blob**；`scripts/dep-audit-baseline.json` 的回写方式**先证明该序列化能字节还原原文件**（实测 20688 → 20688 字节逐字节相同）再动；差量形状：workspace `+19/-0`、lock `+11/-9`、基线 `+16/-82`、判据 `+60/-1`、判据用例 `+51/-0`、棘轮用例 `+44/-2` |
| 接线棘轮 | N/A | 未新增 `*.test.js`；改的是**既有**棘轮用例的常量表与解析器，以及**既有**门禁用例文件 |
| QM-1 打包 / QM-4 视觉 | N/A | 未改运行时代码、未改 electron、未触 UI 文件；`maxFileLines` 已实跑核对：三个改到的文件**都不在扫描域**（域是 `apps/desktop/src` / `apps/desktop/electron` / `packages` / `ops-center/backend`），`scripts/` 不在域内；域内那个 285 行 < limit 500 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper` / `claude` / `opencode` 后端，**如实写「未执行」，不以自审冒充通过**。替代的自证是本记录 §2.6 的对照实验与 §2.7 的幂等实测 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>` |

### 一、本次改了什么（可转交其他会话）

| 文件 | 改动 |
|---|---|
| `pnpm-workspace.yaml` | 加两条 **parent>child 限定式** override：`'minimatch@3>brace-expansion': '^1.1.21'`、`'minimatch@10>brace-expansion': '^5.0.12'` |
| `pnpm-lock.yaml` | 重解析 ⇒ `brace-expansion` 解析出 `1.1.21` / `2.1.4` / `5.0.12`（原 `1.1.15` / `2.1.4` / `5.0.6`） |
| `scripts/check-dep-audit.js` | `parseNpmAudit` 的 `patched` 改为**合并**（去重 + 数值升序）；新增 `mergePatchedBounds` / `cmpPatchedBound` 并导出 |
| `scripts/check-dep-audit.test.js` | 新增 2 例回归锁（多族合并 / 顺序无关 / 数值排序 / 去重；任一族无解 ⇒ 结果为空） |
| `scripts/dep-audit-baseline.json` | 6 条 brace-expansion 挂账**结掉**（它们不再命中）；另由机器刷新补上 `patched` 的合并值与 4 条 `roots` 的修正 |
| `packages/api-publish-engine/test/production-dependency-security.test.js` | overrides 解析正则放宽以接受 `parent>child` 键；`OVERRIDE_FLOORS` 加两条限定式地板；新增 1 例锁内版本锁 |

### 二、本机实测（逐条亲自跑出来的）

#### 2.1 6 条公告的两个槽位（逐族实测，不是抄公告）

| 槽位 | 装着的版本 | 6 条公告的易感区间 | 修复下界 |
|---|---|---|---|
| A `apps__desktop>…>rimraf>glob>minimatch` | `1.1.15` | 1.x 线：`<1.1.16` / `<1.1.17` / `<1.1.18` / `<1.1.19` / `<1.1.20` / `<1.1.21` | **>=1.1.21** |
| B `.>@askjo/camofox-browser>…>glob>minimatch` | `5.0.6` | 4.x/5.x 线：`>=4.0.0 <5.0.7` … `>=4.0.0 <5.0.12` | **>=5.0.12** |
| 另两处 minimatch 5/7/9 | `2.1.4` | **无一条覆盖 2.x** | 不用动 |

⇒ 升到 `1.1.21` + `5.0.12` 后，**6 条公告全部不再命中**。

#### 2.2 为什么必须用 parent>child，**不能平铺**（实测三个包的实际导出形状）

| 包 | 导出形状 | 谁在用 |
|---|---|---|
| `brace-expansion@1.1.21` | CommonJS `module.exports = expandTop`（**函数**） | `minimatch@3.1.5`：`var expand = require('brace-expansion')` **当函数调用** |
| `brace-expansion@5.0.12` | `"type":"module"` + CJS 构建导出**具名** `exports.expand` | `minimatch@10.2.5`：`require("brace-expansion")` 后用 `.expand` |

⇒ **平铺把 1.x 槽位也抬到 5.0.12 ⇒ `minimatch@3` 拿到的是 `{expand}` 而不是函数 ⇒ 直接打断** ⇒ 两个槽位必须各钉在自己 major 内。
⇒ 也**不能靠升消费方绕开**：1.x 槽位的源头是 `puppeteer-extra-plugin-user-data-dir@2.4.1`（**最新版**）声明 `rimraf: ^3.0.2` ⇒ `rimraf@3` → `glob@7` → `minimatch@3`，而 `minimatch@3.0.4` 的区间 `^3.0.4` 最高版就是 `3.1.5` ⇒ 消费方侧无路可走。

#### 2.3 pnpm 11 支持 parent>child（实测，不是查文档）

- 精确形态 `minimatch@3.1.5>brace-expansion: '^1.1.21'` ⇒ 解析出 `brace-expansion@1.1.21` ✓
- **range 形态** `minimatch@3>brace-expansion: '^1.1.21'` ⇒ 同样解析出 `1.1.21` ✓ ⇒ **本 PR 用 range 形态**（钉死 `3.1.5` 会在 minimatch 被升版后静默失效）

#### 2.4 升级前后审计面（同一台机器、同一组扫描器）

| 口径 | 升级前 | 升级后 |
|---|---|---|
| `pnpm audit --prod` 原始条目 | 27 | **21** |
| 唯一 GHSA | 21 | **20**（body-parser 的 2 族被合并成 1） |
| brace-expansion 相关公告 | 6 | **0** ✓ |
| 门禁 rc | 1（`DECISION_CONTRADICTS_PATCHED`） | **0** ✓ |

#### 2.5 门禁读数（三域真扫，`ops-center/frontend` 已 `npm ci --omit=dev`）

```
命中分布: npm=20 npm-opscenter=2 pip=2 命中=24 挂账=24
✅ 无新增已知漏洞公告，基线与现实一致且结论完整。
```

#### 2.6 对照实验：判据层与事实层**各自独立成立**

- **判据层**（`patched` 覆盖 vs 合并）：用**同一份**扫描数据造两条 `advisories`（同 GHSA 两族），
  **颠倒族的先后顺序**再跑一次 ⇒ 改前两次结果不同（`>=1.1.16` vs `>=5.0.7`），
  改后两次结果**逐字相同**（`>=1.1.16, >=5.0.7`）⇒ 非确定性被消灭。
- **事实层**（`patched` 非确定与锁无关）：把**改动前的锁**与**本 PR 的锁**分别喂给 `pnpm audit --prod`，
  两者产出的 12 个族**逐条完全相同**（含 `>=5.0.7`）；锁里 `brace-expansion` 的三个版本在改动前后
  **逐字相同**（`1.1.15` / `2.1.4` / `5.0.6`）⇒ **`--update` 在改动前也会写出同样的矛盾值**，
  那个红**与本次改动无关**，是判据与刷新路径的既有缺陷。

#### 2.7 幂等实测（**这条是本次最关键的一条读数**）

```
$ node scripts/check-dep-audit.js --update      # 第一次刷新
基线已写入 …（24 条）
$ node scripts/check-dep-audit.js --update      # 第二次刷新
→ 产物与第一次**逐字节相同** ✓
$ node scripts/check-dep-audit.js               # 拿刷新产物再判
命中分布: npm=20 npm-opscenter=2 pip=2 命中=24 挂账=24
✅ 无新增已知漏洞公告…（rc=0）
```

⇒ **原来会红的那一步（刷新 ⇒ 门禁判红）现在是绿的**，且**基线不再抖动**。

#### 2.8 与在飞 PR 的关系（开工前查过，先比覆盖面）

| PR | 改什么 | 与本次的关系 |
|---|---|---|
| **#4369** `fix-dep-advisories-upgrade` | 升级 **zod / body-parser / electron** 三条 + 清 7 条挂账（30→23） | **不同批公告**（它管 zod/body-parser/electron，本次管 brace-expansion）⇒ 互补；**文件面重叠**（`pnpm-workspace.yaml` / `pnpm-lock.yaml` / 基线）⇒ 合并顺序上后合的那个要重解一次文本冲突 |
| **#4370** `dep-audit-refresh-body-verdict` | 让刷新 PR 正文补上「**结论已失效**」那一档（直接用 `evaluate()` 的原话） | **互补**：它让红**可见**，本次让红**不产生**（事实层升级 + 判据层确定性）⇒ 合起来是「不产生 + 若产生也看得见」 |
| **#4368** `chore/dep-audit-refresh` | **机器人自己刷出来的那份基线** | 本次修的正是它里面那条矛盾（`patched: ">=5.0.7"` + `targetVersion: "1.1.16"`）⇒ 它的基线在本次合并后会被下一次刷新重写 |
| **#4360** `dep-audit-fast-uri-undici` | 登记 fast-uri ×4 / undici ×3 | ⚠️ **它登记的那 7 条已被 PR #4361 的升级修掉**（不再命中）⇒ **它一旦合入，门禁会判 `RESOLVED_STILL_BASELINED` 而变红** ⇒ 不应合入 |

### 三、遗留（不假装已闭合）

- **`body-parser` 那一族的多段下界与人写的 `targetVersion` 的关系**（实测自洽，但要写进 note）：
  `GHSA-27r3-jxmh-p828` 合并后的 `patched` 是 `>=1.20.9, >=2.4.0`（1.x 线与 2.x 线各一个修复版），
  而 `targetVersion` 只能写**一个**数（现为 `2.4.0`）。`checkTargetEscapes` 判「目标版本 >= 每段下界」
  ⇒ `2.4.0 >= 1.20.9` 且 `2.4.0 >= 2.4.0` ⇒ **通过**；但**实际动作是两槽位各升各的**
  （1.x→>=1.20.9、2.x→>=2.4.0）⇒ 单个数表达不了这个动作 ⇒ 本次已把该条 note 的旧口径
  （"扫描器汇总报出的是 >=2.4.0"）改成并集口径并写明缘由。**这是 #4369 的动作范围**（它真升级 body-parser），
  本 PR 不动那条的决定。
- **`parseNpmAudit` 与 `parseNpmAuditV2` 的口径差异已消除**（本次改成一致），
  但**同族的其它字段**（`severity` / `module`）仍是「后读覆盖」⇒ 若某个 GHSA 的两个族严重度不同，
  记下来的会取决于顺序。**本次不扩到那两个字段**（它们不参与 `checkTargetEscapes` 的判定），
  扩进来属另一件事。
- **zod / body-parser / electron 三条仍未修**（#4369 在做）；`electron` 那条按 AGENTS 需连带
  `ensure-electron.js` / `electron-ci.yml` / 打包链，属独立排期。
- **本次没有给定时刷新加「红就不开 PR」那道闸** —— 那是**错的**：刷新产物的基线在**有新增待办时本来就该红**
  （`BASELINE_META_INVALID`，因为新条目一律 `decision: TODO`）⇒ 那样做会让刷新作业**永远开不出 PR**，
  工作流直接死掉。**正确做法是 #4370 的「让人看见」**（正文逐条带出判据原话），不是「不许开」。

## CHANGELOG 条目

# fix(dep-audit): 把 brace-expansion 真升到修复版并结掉 6 条 high 公告，同时修掉 pnpm 域解析器「patched 覆盖而非合并」导致的非确定性（dep-audit-brace-expansion-floor）

- 依赖漏洞基线自动刷新（#4358）**第一次真实运行就产出红基线**：人已经判过的
  `brace-expansion` 挂账被机器刷新改写后，当场判「这笔账永远闭不了」。
- 根因是两层：**① 事实层** —— `brace-expansion` 的 6 条 high 公告覆盖两条修复线
  （1.x 线 >=1.1.21、4.x/5.x 线 >=5.0.12），本仓锁里 `1.1.15` 与 `5.0.6` **两条线都还在易感区间内**；
  **② 判据层** —— pnpm 域解析器对同一 GHSA 的多个修复族只保留最后读到的那一个 `patched`，
  该字段因此**取决于 npm 响应里各族的先后顺序**（非确定），与人工写的 `targetVersion` 配对时就会随机判红。
- 本次把两个槽位各自升到自己 major 内的修复版（`1.1.21` / `5.0.12`，用 parent>child 限定式覆写，
  因为 `minimatch@3` 与 `minimatch@10` 要求的**导出形状不同**，平铺会打断其中一方）⇒ 6 条公告不再命中、
  挂账结掉；并把解析器改成**合并**语义 ⇒ **同一份锁两次刷新的产物逐字节相同**，基线不再抖动。
- 顺带把「覆写地板棘轮」的解析放宽到能认 `parent>child` 键，并加一条用例盯住
  「锁里两个槽位必须真的落到各自 major 的修复版上」。

## learnings

### lesson: 同一语义的两个解析器用了两种口径 —— 门禁只会走其中一个（2026-10-24 实测，跨项目通用）

**现场**：定时刷新第一次跑就产出红基线，人已经判过的账被机器刷新判成「永远闭不了」。

**根因**：`parseNpmAuditV2`（npm v2 域）对**同一 GHSA 的多个修复族**用「去重后 join」**合并**下界，
`parseNpmAudit`（pnpm 域）却是**覆盖** ⇒ 门禁实际走的那个是非确定的那个。
多族不是罕见形态：npm/pnpm 对**一个 GHSA 的多条易感区间**（不同版本线各有自己的修复版）
返回**多条** advisory，共享同一个 `github_advisory_id`。

**可复用的 N 条**：

1. **凡是「按 id 聚合」的解析器，都要问「同一个 id 会不会来多条、聚合时哪些字段是合并哪些是覆盖」**：
   `roots` 合并而 `patched` 覆盖 ⇒ 同一行里两种语义并存，最难发现。
2. **「非确定」的危害不在值难看，而在它会与人工字段配对**：一个由机器顺序决定的字段，
   一旦拿去和人写的承诺（`targetVersion`）比大小，就成了**随机判红的开关**。
3. **判据的确定性要单独验**：同一份输入**颠倒条目顺序**再跑一次，结果必须逐字相同。
   这条比任何"我看了代码觉得没问题"都强。
4. **合并要排序**（按版本号数值，不是字典序）⇒ 否则输出仍随输入顺序抖动，基线 diff 会脏。
5. **合并要保留保守侧**：任一族没有修复版本 ⇒ 合并结果也是空（有一条线无解 ⇒ 整本账无解），
   别写成"看起来有修复版"。

### lesson: 「升级到修复版」在多槽位依赖上不是一次 bump，是每槽位一次（2026-10-24 实测，跨项目通用）

**现场**：同一个包在树里同时存在 `1.1.15` 与 `5.0.6` 两个版本，各被一条公告覆盖，
且**两个槽位的消费方要求的导出形状不同**（一个当函数调、一个用具名导出）。

**根因**：一条「修复下界」是**按版本线**给的（`>=1.1.21` 与 `>=5.0.12` 两条线），
而「升到修复版」这个动作**要按槽位分别做**；把整棵树抬到一个版本号上，
在形状不兼容时会**直接打断**其中一方。

**可复用的 N 条**：

1. **先摸清每个槽位的「消费方声明区间」与「实际导出形状」**，再决定怎么升
   （本例：两个 minimatch 声明 `^1.1.7` / `^5.0.5`，修复版都在各自 major 内 ⇒ 不需要改任何声明）。
2. **能靠消费方抬版本解决时优先升消费方**；升不动（上游最新版仍钉着旧区间）才上 override。
3. **override 写成 parent>child 限定式**（pnpm 支持 `parent@range>child`），
   并把**该形态纳入既有棘轮的解析范围** —— 否则新写法会被自家门禁判「解析不了」而打红
   （本例棘轮原本的正则 `[\w./-]+` 就不收 `@` 与 `>`）。
4. **限定式写 range 不写精确版本**（`minimatch@3>` 而非 `minimatch@3.1.5>`）：钉死精确版本会在上游升版后静默失效。
5. **不受影响的槽位原样不动**：本例 `2.1.4` 不在任何易感区间里，没必要跟着动。

### lesson: 「机器刷新 + 人工确认」的台账，机器产物必须先过机器自己的判据（2026-10-24 实测，跨项目通用）

**现场**：定时刷新的产物是一份基线 JSON，**它自己就是门禁的输入** ——
而刷新路径**没有把产物再喂回门禁验一遍** ⇒ 一份自相矛盾的基线能直接进主干（机器人开的 PR 就是这个形态）。

**可复用的 N 条**：

1. **机器产出的东西，在推送/开 PR 之前要过一遍「它自己所在的那道判据」**；
   本次实测：刷新产物再判门禁 ⇒ rc=0，且**连续两次刷新的产物逐字节相同**（幂等 = 不抖动的机械证据）。
2. **幂等是最容易验、也最容易被跳过的一条**：同一输入跑两次，产物必须逐字节相同。
   本次的红就是「非幂等 + 无自验」的合体。
3. ⚠️ **但别把自验做成「不合格就不产出」**：刷新产物的基线在**有新增待办时本来就该红**
   （新条目一律 `decision: TODO` ⇒ `BASELINE_META_INVALID`）⇒ 那样做会让刷新作业**永远开不出 PR**。
   **正确分工是：机器照刷（红是预期态），把「哪几条红了、红的原话」逐条带进 PR 正文**（PR #4370 已在做）。
4. **台账里的人工字段与机器字段要能对上**：本次发现基线里同一条的 `patched` 存着
   `>=1.1.16` / `>=5.0.8` / `>=5.0.12` 这种互相矛盾的取值 ⇒ **那不是人工写错，是机器的非确定写进去的**
   ⇒ 一条台账记录里出现「同一字段自相矛盾的值」⇒ 先怀疑写入方，而不是读它的人。
