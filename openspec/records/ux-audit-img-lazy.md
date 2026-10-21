---
record: ux-audit-img-lazy
task: UX 审计 4.8 的 <img> 半边 —— 37 个 <img> 全部显式声明 loading/decoding，eager 逐条给理由；新增图片加载合同锁 + 反证驱动入库
date: 2026-10-21
sync_pr: pending
sync_status: PENDING
sync_reason: 运行时代码变更（apps/desktop/src 下 26 个 .vue）+ 设计文档/CHANGELOG，合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：图片加载合同（ux-audit-img-lazy，2026-10-21）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 独立 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-img-lazy`（非 C 盘），分支同名裸名；判据取产物：`rev-parse --abbrev-ref HEAD` = `ux-audit-img-lazy`、`rev-parse --show-toplevel` 可进入、`node scripts/verify-worktree-deps.js` 打印「消费方解析通过 11 项 … OK」 |
| 质量节拍 pre-flight | ✅ | 编辑前确认非共享根 `main`；共享根全程未写入 |
| 自测（新增锁） | ✅ | `apps/desktop/src/img-loading-contract.test.js` 5 条全绿；驱动控制跑 `[BASE] rc=0 collected=5 red=0` |
| 自测（消费者并集） | ✅ | 判据取「消费者并集」：按被改组件名 + `\.vue` 精确匹配反查测试消费者（**不能按裸词匹配**——按裸词会把 151 个只在散文里提到 "Home"/"TabBar" 的文件拉进来），结果 **82** 个测试文件 + 本锁全跑 = **1655 passed / 0 failed / 2 skipped**。第一跑曾报 **1 failed**，但不是回归：`overlay-view-suspension.test.js` 读的是构建产物 `electron/preload/index.bundle.js`，新 worktree 里从未构建 ⇒ `ENOENT`。这是**环境缺失伪装成 UI 失败**的同型（AGENTS.md 对像素门禁写过同一条判据）：正解是补 `pnpm run build:preload` 再跑，**不是**把那条用例 skip 掉或记成"已知红" |
| 反证（8 道） | ✅ | `node scripts/img-loading-contract-mutate.js` → `COUNTERPROOF=ALL_CAUGHT`；红集互不相同（M6=2，其余各 1），八条均 `还原字节一致=OK`；M8 第一版 MISSED（见 §三），改正后才 CAUGHT |
| 模板编译核验 | ✅ | 批量属性插入的专用检查：用 `@vue/compiler-sfc` 的 `parse` + `compileTemplate` 逐个核验 26 个改动文件 → `VUE_FILES=26 含img=26 BAD=0`；探针自身要求 diff 非空且 `parse/compileTemplate` 存在，否则拒绝报 OK |
| 静态门禁 | ✅ | `check-max-lines` / `check-debt-budget` / `check-locale-sync --cjk` / `check-no-brand-residue` / `check-doc-abs-paths` 全 PASS；`git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐字相等 |
| QM-1 打包 | N/A | 只改 `apps/desktop/src/**` 与 `scripts/`，未触碰 `electron/**`、`packages/rpa-engine/**` |
| QM-4 视觉回归 | 未跑（如实登记） | 本批改的是请求时机与解码线程，**不改任何尺寸/裁剪/样式**，像素门禁应当零差异；但正因为像素门禁对本批"看不见"，它不构成通过证据 —— 判定交由 `QG Visual` 在 CI 跑同源基线；宽高占位那半边**刻意不做**（会改渲染结果，见 PRD §二.1） |
| QM-6 双模型 | 未跑（本批性质判断见 §五） | 变更集是 37 个属性的机械添加 + 一条新锁，无状态机/无持久化/无鉴权；但按 AGENTS.md 的 M+ 判据它是否必须跑由 `ccg-review-decider.js` 说了算，见 §五 的现场读数 |

## 一、改了什么（用户可见口径）

| 面 | 改前 | 改后 |
|---|---|---|
| 列表类图片（账号卡头像/平台图标、发布历史缩略图、爆款库封面、采集监测头像、文案库表格） | 进页面即全部并发下请求，默认 `eager` 且解码线程由浏览器自决 | `loading="lazy"` + `decoding="async"`：滚到附近才发请求，解码不占主线程那一帧 |
| 弹窗与预览面（封面预览/裁剪、成片素材预览、刚选中的本地图片、待评测图片） | 同上（被一并推迟会显得"弹窗是空的"） | 显式 `loading="eager"` + 理由进白名单：**不滚动的壳**与**用户刚要它出现的内容**才允许 eager |
| 视觉 | — | 无变化：`loading`/`decoding` 都不改变盒子的尺寸、裁剪与占位 |

## 二、为什么此前没人发现（逃逸分析）

1. **默认值把"忘了写"伪装成"决定"**：HTML 的 `loading` 默认 `eager`，所以 diff 里看不到任何异常，代码审查也没有可读的信号 ⇒ 审查盲区（与 AGENTS.md「装饰性链路」同族：缺陷没有形状）。
2. **没有一条东西在看模板里的属性完备性**：仓内既有 `element-plus.test.js`（组件登记表）、`href-scheme-contract.test.js`（`:href` 协议）这类模板级结构锁，但**图片加载属性一把都没有** ⇒ 测试场景缺失。
3. **像素门禁对本批结构性失明**：它在的是"看起来一样"这一层，而请求时机与解码线程不改变像素 ⇒ 视觉层不构成防线，也不能用来宣称"已通过"。
4. **`--cjk` / 品牌 / 行数类静态门禁都不看这个维度**，CI 全绿躺了很久。

## 三、反证里的一处自我纠正（写下来以免重犯）

M8「把 `ALLOWED_LOADING` 放宽成 `['lazy','eager','immediate','later']`」第一版 **MISSED**：仓库里现在没有任何图片写错值，所以"词表是否闭合"这一维度对真实仓读数完全不可见，只断言仓库状态的那条用例照绿。正解不是删掉这条变异，而是**给判据补一个能观测它的 fixture**（新增一条用例：`loading="immediate"` / `decoding="weird"` 必须被词表判为非法）—— 变异随之指名红。这与本仓「一条禁令不得只靠列举已知坏值」「覆盖面数字必须连着探针定义一起报」是同族：**放宽判据不会让"只测现状"的锁变红，必须由 fixture 去测词表本身。**

同类第二处：消费者并集第一次用裸组件名匹配，得到 151 个文件（大量只在散文里提到 "Home"/"TabBar" 的无关测试）——判据本身错了会让"验证范围"这句话变成装饰，故改为 `组件名 + .vue` 的导入形态匹配（82 个）。

## 三-B、QM-6 第一轮评审后暴露的三处「我自己的错」（逐条都是当场实测，不是推断）

1. **「反证驱动入库」这句话是假的（评审 i1）**。CHANGELOG 与 §四 都写了「驱动入库、从干净 checkout 一条命令可复跑」，而 `git ls-files scripts/img-loading-contract-mutate.js` 当场 **零命中** —— 文件躺在工作树里，被 `.gitignore:106` 的 `scripts/*.js` 静默忽略，我写声明时按记忆而不是按仓库状态。**这是本仓「新增 scripts/ 下的门禁/工具本体必须补 `!scripts/<name>.js` 反选」那条既有纪律的第 N 次落点**，也是我上一轮刚刚在别的批里写过的同一形态。修法：补反选（`.gitignore:146`）+ `git add` 复验（rc=0、`git status` 出现 `A`）后才重新声称入库。
2. **eager 白名单是文件级而不是逐图级（评审 i3）**，而合同标题写着「eager 逐条给理由」—— 标题与实现不同源。后果实测口径：已在名单上的文件再新增一个毫无理由的 eager，「未授权」和「陈旧」两条断言**全部放行**。修法：条目改成 `{file, match, reason}`，并新增「同一张 eager 被两条条目同时命中 ⇒ 红」这条**锚点互相认领**判据（M10 就是造这条）。
3. **属性解析器有整串正则的老毛病（评审 i4）**：`attr()` 在整段属性串上跑 `name\s*=\s*"…"`，于是 `:alt='loading="lazy"…'` 会被当成**真声明**（假绿）、`:class="'loading=bad'"` 会被当成非法值（假红）。这把锁自己已经处理过「属性值里带 `>`」的同族坑，却没处理「属性名字面量出现在别的属性值里」——**同一条"解析要按结构而不是按字面"的纪律，只做半截就等于没做。**修法：改成 token 级解析 + 两条双向 fixture。

另外两处不是我的错，但如实记下：评审 i6 指出提交集里带了**过期的判定产物**（`.ccg/reviews/50e1cb5d….json` 记的是 267 行的早期暂存快照，而 head 是 839 行）—— 这是 pre-commit 落产物的命名/时机形状（`decider` 按暂存 diff 取名，commit 之后 head 与产物内容不再同源），与 `ux-audit-leaf-roles` §5 记的是同一条链路形状；本轮改为**对最终 head 重跑 decider 并提交与 head 同源的那份**。评审 i5 指出批量插入留下双空格与错位缩进（11 个文件），已一次脚本化收敛，缩进取自同标签上一行而不是写死空格数，15 个 `.vue` 全部经 `@vue/compiler-sfc` 编译复验 **BAD=0**。

## 四、验证读数

- 探针（改前 → 改后）：`扫描 .vue=186，<img>=37，未声明 loading=32 → 0，未声明 decoding=33 → 0`；
- 改动面：26 个 `.vue` + 新锁 + 反证驱动 + `scripts`/`01-docs`/`CHANGELOG`/本记录。⚠ **这句在首轮是半假的**：`scripts/img-loading-contract-mutate.js` 当时**并没有进提交集**（被 `.gitignore:106` 的 `scripts/*.js` 静默忽略），处置见 §五-B 的 i1 条目与 §三-B；
- 锁：**首轮 5 条**（控制跑 `collected=5 red=0`）→ QM-6 评审后 **6 条**（新增「理由词表自身」一条 fixture 自锁），控制跑 `collected=6 red=0`；
- 反证：**首轮 8 道 ALL_CAUGHT** → 本轮 **12 道 ALL_CAUGHT**（`[BASE] collected=6 red=0`），逐条 `还原字节一致=OK`。其中 M9/M10/M11/M12 四道是为评审 i3/i4/i7 新加的牙，**M12 第一版 MISSED**（见 §三-B）；
- 消费者并集：**83** 个测试文件（82 个消费者 + 本锁）全跑 = **1655 passed / 0 failed / 2 skipped**；
  第一跑曾报 1 failed，归因为**环境缺产物**（`index.bundle.js` 未构建，`ENOENT`），补
  `pnpm run build:preload` 后复跑才是上面这个读数 —— 顺序不能反：先归因再复跑，不是先 skip 再宣布通过；
- Vue 编译核验：`VUE_FILES=26 BAD=0`。

## 五、QM-6 判定与登记

`node scripts/ccg-review-decider.js --staged` 现场读数与 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` 的结果写在下面，不手写结论：

- 判定模式与是否要求双模型：见下面五-A / 五-B；
- 五-A decider 读数（`node scripts/ccg-review-decider.js --staged`，本批暂存集）：

  ```
  审查模式判定 [验证层(动手后·diff)]: DUAL
  变更 267 行 > 200 行阈值（对齐 §12.6 Red Team）
  变更 267 行 / 27 个源文件 / 敏感命中 0 路径 + 1 内容
  ⚠ 文档行命中敏感词 3 处（不计入模式判定）
  要求 双模型(claude + opencode) 深度审查，后端就绪（claude + opencode）
  判定已落盘: .ccg/reviews/50e1cb5d….json
  ```

  ⇒ 本批**确实是 DUAL**（这次是规模规则，267 > 200，不是假阳性），按 QM-6 必须跑双模型。

- 五-B 双模型评审：见本记录末「评审轮次补记」（跑完由引擎自己写下读数，不手写结论）。

- 五-C enforce 读数：**必须在提交之后才能取** —— `check-pr-exec-record.js --base=origin/main` 取的是
  merge-base 到 head 的差量，索引里有改动但还没 commit 时它读到「变更集为空」并按 fail-closed 判不通过
  （本轮实测：`本 PR 变更文件 0 个 ｜ 变更集为空或取证失败`）。这与 `classify-docs-only --head=HEAD`
  必须 commit 后取证是同一条顺序约束，不是判据坏了。真实读数补在「评审轮次补记」里。

**本批不做自扮演豁免**：不把 `deepReview.status` 写成闭环值，也不用 `closureNote` 给自己签发；
未闭合就是未闭合，留在欠账门禁上等人工。（引擎口径已实测：`blockingFromAdjudication` 把
`verdict=upheld` 一律计阻断，所以"承认并修好"反而闭不了环 —— 只有 dismissed 能到
`self_play_resolved`。因此本 PR 的 QM-6 状态需要一次零发现的评审轮次或人工 `needs_revision`。）

## 评审轮次补记

（跑完由引擎自己写读数，不手写结论。）

- **五-C enforce 实测读数**（提交 `e4241a47c` 之后跑 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce`）：

  ```
  本 PR 变更文件 31 个（A=3 M=28 D=0） ｜ 新增记录 1 篇 / 修订本分支记录 0 篇 / 新增豁免 0 篇
  - CCG 深度审查欠账 1 条 …
      - .ccg/reviews/50e1cb5d….json（mode=dual，status=pending，decidedAt=2026-10-21T12:44:28.271Z）
      出口：① 补跑 sh scripts/deep-review.sh（真外部评审）；② 确认判定确属假阳性 ⇒ …
  不通过：1 条理由
  ```

  这条与 §五 开头那次「变更集为空」的读数**是同一个判据在两种取证据顺序下的样子**：commit 之前取差量必然为空 ⇒ 判据按 fail-closed 出声，不是它坏了；记录里两次数都留着，是因为"提交后才能取证"这条约束本身就是下一个会话会踩的坑（AGENTS.md 对 `classify-docs-only --head=HEAD` 写的是同一条顺序约束）。

- **五-B 双模型评审**：本批走出口①（真跑）。执行方式与两条前置条件（引擎根 + HEAD 命名的判定记录）见 `ux-audit-leaf-roles` 记录 §5.3；跑完把 critic 的每条发现与处置追加在本节，**不改写** `deepReview.status`（引擎口径：`verdict=upheld` 一律计阻断，所以"承认并修好"闭不了环，需要一轮零发现的评审或人工 `needs_revision`）。
## 五-D、QM-6 第一轮评审：8 条发现的逐条处置（head `e4241a47c`，产物 `.adversarial/ccg-deep-e4241a47/critique-v1.md`）

| id | 级别 | 处置 | 现场证据 |
|---|---|---|---|
| i1 | Warning | **采纳，且是最重的一条自我纠正** | 评审指出「记录与 CHANGELOG 声称反证驱动入库，但 839 行 diff 里没有任何 `scripts/` 文件」。当场 `git ls-files scripts/img-loading-contract-mutate.js` ⇒ **零命中**，`git show --stat HEAD` 同样没有该文件 ⇒ 声称与提交集不同源。根因是 `.gitignore:106` 的 `scripts/*.js` 静默忽略新建脚本（本仓既有纪律点名的正是这一行）。修法：补 `!scripts/img-loading-contract-mutate.js` 反选 + `git add` 复验（`git status` 出现 `A`）。 |
| i2 | Warning | **采纳（改实现，也改规则）** | 逐条读到源码：`sas-preview-image`（点开缩略图后才出现的灯箱大图）确实是「②用户刚要它出现的内容本身」却写着 lazy，而 `ResultView.vue` 的同类预览写着 eager ⇒ 分叉成立，改 eager。`TabBar.vue` 的 16px 平台图标评审说是「①不滚动的应用外壳」，**这半句被否证**：它是 `v-for` 出来的**列表项**且标签栏会横向溢出，按「列表/网格一律 lazy」应当留 lazy；PRD 的口径因此补上反向清单并显式点名它（规则含糊是根因，实现只是把含糊暴露成不一致）。 |
| i3 | Warning | **采纳** | 「文件级豁免」被实测复现：条目按文件键 ⇒ 已授权文件（`CreateView.vue` 本就有 2 个 eager）再加一个无锚点 eager 时 unauthorized/stale 两条**都放行**。改成 `{file, match, reason}` 逐张条目，并新增「两条锚点同时命中一张 eager ⇒ 红」；反证 M9/M10 各造一次，均指名红。 |
| i4 | Warning | **采纳** | 在整段属性串上跑 `name\s*=\s*"…"` 会撞「属性名字面量出现在别的属性值里」。两向 fixture 各一条：`:alt='loading="lazy"…'` 必须算**未声明**（否则漏写被读成已写）；`:alt="'a loading=b'"` 不得抢走真声明（否则合法写法假红）。反证 M11 把解析退回旧写法 ⇒ 指名红。 |
| i5 | Info | **采纳** | 双空格 18 处 + 闭合 `>` 被属性串顶替后留下的错位缩进 4 处，共 15 个文件；一次脚本化归一（**缩进取自同标签上一行**，不写死空格数——写死会在别的文件里再错一次），`@vue/compiler-sfc` 复验 BAD=0。 |
| i6 | Warning | **按链路形状登记，不改判据** | 提交集里 `.ccg/reviews/50e1cb5d….json` 记的是早期 267 行暂存快照而 head 是 839 行：`decider` 按**暂存 diff** 取名落盘，commit 之后 head 与产物内容必然不同源（与 `ux-audit-leaf-roles` §5 记的是同一条）。本轮另生成 head 同源那份（`e4241a47c….json`）并随本轮提交；把 `.ccg/reviews` 整体改成不入库属「改谁来守门」，上报不代拍。 |
| i7 | Info | **采纳为词表 + 如实降级** | 「关键词白名单式强校验」确实是弱判据（含「本地」二字即放行）。改成**空话词表**（`以后再说/先这样/回头再说/顺手/都行/随便/默认值/默认的` 命中即红）+ 必须点名三条口径之一；同时如实写明：**理由的语义强弱仍是人工评审锚点**，机器只挡最省事的写法。反证 M4（把理由换成"带点开、但含以后再说"的写法 ⇒ 只有空话词表会拦）与 M12（摘掉词表 ⇒ fixture 红）两道合起来才证明这一格有牙。 |
| i8 | Info | **采纳** | 记录曾以 `sync_status=PENDING` 入库而 CHANGELOG 用完成时态写「验证全绿」——同一提交里既说未闭环又说已验证。本轮把两侧对齐：CHANGELOG 补「QM-6 第一轮处置」段（本节），记录的补记就是本节，enforce/decider 读数见 §五-C/§五-B；**远程同步那一行仍按「由门禁推导」不写状态词**。 |

维度分（当场从产物读，不凭印象）：correctness 7 / security 9 / performance 9 / maintainability 6 —— 最低分来自 maintainability，落点就是 i1（声称入库而未入库）、i3（授权粒度）、i5（批量插入的格式噪声）三条。


## 远程同步

| 远程同步 | 由门禁推导 | 本行**不事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属（只认 squash 尾注 `(#NNNN)`，PR 号见本 PR 页面）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇还不在基线上 ⇒ 判 `byDesign` 不红；把状态列预写成 `PASS` 会被 `prematureClaims` 判红。**本行的存在本身就是判据**：`check-gate-record-debt.js` 对「整块缺 远程同步 行」的新记录当场判红。main push 回读证据写在 PR 评论里，不写回本文件。 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING（收口由门禁推导）

## 五-E、QM-6 第二轮评审：12 条发现（6 条 escalate 进裁决）的逐条处置（head `1c43d93d5`，产物 `.adversarial/ccg-deep-1c43d93d/`）

这一轮的**主线不是补判据，是把判据的解析层整个换掉**。第一轮留下的锁用
`indexOf('<img')` + 手写 `readOpenTag` + 手写 `attrTokens` + 手写 `blankOutNonTemplate`
在裸文本上重造了一遍 HTML 解析，于是每一轮评审都会发现一个新的解析漏洞（注释、插值、自闭合、
属性值里带 `>`、属性名出现在别的属性值里……），而本批修这些漏洞的方式是"补一条 fixture 加一道变异"。
i3 把这件事说破了：**四道变异存在的唯一原因就是这层手写解析脆弱 —— 复杂度在螺旋上升，而不是从根上消解**。
而同一个 PR 里已经在用 `@vue/compiler-sfc` 做模板编译核验。所以第二轮的处置是删掉自造解析器，
站点与属性一律取自模板 AST。

| id | 级别 | 裁决 | 处置与现场取证 |
|---|---|---|---|
| i1 | Warning | **upheld** | 属性值里的 `<img>` 字面量（`:title="t('x',{example:'<img src=y>'})"` 这类 i18n/提示串）与 `v-pre` 文本在旧实现下会造**伪站点**（假红），引号区间还可能吞掉真实站点的 `>`（静默漏扫）。PRD 自己把"注释/插值里的示例"列为必须涂白的理由，属性值就是同一误报类的第 4 个漏网点。AST 化后伪站点这一类**结构上不可产生**（站点只能来自 AST 节点），另加一条 fixture 用例钉住边界 |
| i2 | Warning（高危域标记 `auth`） | **upheld** | 一条锚点认领多张图：`CreateView.vue` 的 `:src="img.preview"` 同时命中两个 v-for 块（管线图 / 快图），而旧 `doubleCovered` 只防"两条目→一张图"。新增 **`covers` 计数**判据 —— 锚点实际覆盖的 eager 站点数必须**恰等于**登记值，多一张少一张都红；该条现登记 `covers: 2` 且理由点名两个块。⚠ `auth` 这个域标记是敏感分类器在属性名/文档散文上的误报（本批零鉴权代码），按既有口径如实记下、不改判据也不据此绕门禁 |
| i3 | Warning | **upheld（本轮最大改动）** | 删除 `attrTokens` / `readOpenTag` / `blankOutNonTemplate`（`grep` 实测命中 **0** 次），改 `import { parse as parseSfc } from '@vue/compiler-sfc'`。变异集随之重排为 M1–M13：原"解析自身"那一格不再靠变异堆叠，而由两条 fixture 承接（AST 边界 / 声明形态口径）。**副作用即 i4 的答案**：锁从 303 行降到 **233 行**（`wc -l` 实测），自证 PRD「新锁 <300 行」这条锚点 |
| i4 | Warning | **upheld（并纠正一处我自己的误读）** | 交付物 303 行 > PRD 自己锚点写的 <300。**但执行记录 §四 那句 `check-max-lines` 全 PASS 并不是假话** —— 当场跑 `.github/scripts/check-max-lines.js`：`limit=500 testLimit=1500`，该锁既没到 500 也没到 1500，PASS 是真的。所以这一格的真实缺陷不是"谎报 PASS"，而是**PRD 写了一条比机器门禁更严、却没有任何机器在看的自定数字**：自锚点不会被门禁 red-flag，于是它只在人愿意回头看时成立。AST 化删掉自造解析层后实测 **233 行**（`wc -l`），锚点与产物重新对上。教训改写为：**写进验收锚点的数字必须能一句话重取，且要么有门禁看它、要么标明"仅自述"** |
| i5 | Warning | **upheld** | CHANGELOG 顶部仍写「新锁 5 条 / 八道变异」，同一文件末尾已写「扩到 12 道 / collected=6」，提交集实际是 6 个 `it` + 13 项 `MUTANTS` —— 旗舰文档的最终态数字与提交集不同源。现按当场重取改写：`[BASE] rc=0 collected=6 red=0`、`M1–M13 ALL_CAUGHT`，并加一句"条数是当日读数，验收以门禁现场通过数为准"；Vue 官方解析器核验重跑为**全量改动集** `files=26 BAD=0`（含本轮两处 `.vue`），不再沿用未经复验的旧句 |
| i6 | Warning | **upheld** | 本 PR 提交的两份产物分别是 `sha=50e1cb5d`（267 行早期暂存快照）与 `sha=e4241a47c`（`self_play_pending`，note 写"4/4 条未定"），而最终 head 是 `1c43d93d5`，其同源产物当时仍是 **untracked** ⇒ **i6 自己声讨的形状在同一个 PR 里复发了一次**。本轮把与最终 head 同源的产物一并提交。**⚠️ 本行原先写「引擎没有"只结算已填裁决"的入口」，该说法被当场否证并更正**：当时只 `grep` 了 `--finalize/--resume/--adjudicate` 这几个我猜的旗标名，没读主流程 —— 引擎其实有 `--sha`（`ccg-deep-review.js:67`），并走「复用存档 critique + 已填完的裁决 ⇒ 跳过模型调用」的短路（`:874-880` → `finalizeAdjudication`）。实跑现场：`♻ 复用存档 critique（12 条）+ 已填完的裁决 —— 跳过模型调用` ⇒ 产物由 `self_play_pending`+`findings:null` 变为 **`self_play_blocked` + `findings` 6 条 + `blocking` 逐条点名**（脚本 exit 1 是"有阻断项"的正确读数，不是脚本坏了）。**改产物的是引擎，不是我**。**结论收窄（原因换了且更准）**：不是"没有出口"，而是 ①任何 `upheld` 都计阻断（本批 i1–i6 全是"承认并已修"，机械上仍算阻断），②高危域条目无论 verdict 都阻断。所以填裁决 + `--sha` 短路能让审计面**如实带证据**，但 `self_play_*` 拿不到闭合态；闭合只能靠外部复核或人工判 `needs_revision`/`cleared`（任务 #19 的形状由本次得到一次现场收窄）。仍**绝不**手写 `deepReview.status` 冒充已裁决 |
| i7–i12 | Info | **i7/i8/i9/i10/i11 采纳，i12 采纳** | i7：`CoverThumbnail.vue` 的 `:src="dataUrl"` 与 `CoverPreviewDialog` 同源（渲染的就是用户刚选的本地封面预览），`lazy` 属口径分裂 ⇒ 改 `eager` 并按③登记理由，**不是**"顺手统一"（同数据的预览弹窗本来就是 eager）。i8：`:loading="'lazy'"` 这类**字符串字面量绑定算已声明**（编译期常量，值不推迟到运行时），`:loading="x"` 非常量绑定算未声明 —— 两条都写进用例名与 PRD 口径，避免下一批把它当遗漏。i9：`FilmEngineeringView.vue` 残留的 `alt=""␣␣decoding` 双空格正是 i5(第一轮) 声称已收敛的那一类，本轮补净。i10：反证驱动不再 `spawnSync('pnpm.cmd', …, {shell:true})`（POSIX 上 ENOENT，与"干净 checkout 一条命令可复跑"直接矛盾），改 `process.execPath` 直跑 `node_modules/vitest/vitest.mjs`，入口取不到走 **blind 档**而不是静默当通过。i11：`srcKind` 是**死字段**（无任何断言消费），却暗示"src 绑定形态已被校验" ⇒ 删除，把可表示性留给 i8 那条真判据。i12：PRD 图片加载合同一节出现**两个 `### 三、`** ⇒ QM-6 修订节改号为 `### 四、`；重号的代价不是排版，`check-docs-sync` 与人工都按锚点取节，两个同名锚点会让"我改的是哪一节"不可判定 |

### 本轮验证现场

- `npx vitest run src/img-loading-contract.test.js` → **6 passed**（驱动控制跑 `[BASE] rc=0 collected=6 red=0` 同数）。
- `node scripts/img-loading-contract-mutate.js` → **M1–M13 全 CAUGHT**（`COUNTERPROOF=ALL_CAUGHT`），
  红集互不相同，13/13 `还原字节一致=OK`；M13 是"合规形态必须绿"的正控（改回 lazy 并**同次**删锚点），
  M12 守"字面量绑定被过度拒绝"那一侧。
- Vue 官方解析器复验：`@vue/compiler-sfc` `parse` + `compileTemplate` 扫本 PR 全量 `.vue` 改动集 ⇒ `files=26 BAD=0`。
- **消费者并集**（按 i7/i9 两处被改组件名 + `.vue` 导入形态反查得 6 个测试文件，与锁同跑）⇒
  `useHistoryCoverThumbnails` / `BatchArticleFields` / `element-plus` / `FilmEngineeringHubView` /
  `FilmEngineeringView` / `video-copy-refine` + 本锁，**7 files / 77 passed**。
  这一格不能省：本轮改的两个 `.vue` 都不在 diff 里的测试文件中，只跑"我改过的那把锁"就等于没测消费者（AGENTS 既有口径）。
- 真实 max-lines 门禁当场重跑（`.github/scripts/check-max-lines.js`，**不在** `scripts/` 下）⇒
  `limit=500 testLimit=1500`、`超限文件=95 挂账=95`、无新增超大文件、PASS。
- 裁决 6/6 已填写（`.adversarial/ccg-deep-1c43d93d/adjudication.json`，gitignored 工作产物），
  随后用引擎自身的**零模型调用短路**把它结算进审计产物：
  `CCG_ARL_DIR=<技能根>/scripts node <技能根>/scripts/ccg-deep-review.js --sha 1c43d93d5…`
  ⇒ 产物由 `self_play_pending`+`findings:null` 变为 **`self_play_blocked` + `findings` 6 条 + `blocking` 点名**
  （现场打印 `♻ 复用存档 critique（12 条）+ 已填完的裁决 —— 跳过模型调用`，脚本 exit 1 = "有阻断项"的正确读数）。
  **改产物的是引擎，不是我** —— 没有手写任何字进 `.ccg/reviews/*.json`。
