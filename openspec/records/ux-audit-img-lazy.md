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

## 四、验证读数

- 探针（改前 → 改后）：`扫描 .vue=186，<img>=37，未声明 loading=32 → 0，未声明 decoding=33 → 0`；
- 改动面：26 个 `.vue` + 新锁 + 反证驱动 + `scripts`/`01-docs`/`CHANGELOG`/本记录；
- 锁：5 条，控制跑 `collected=5 red=0`；
- 反证：8 道 `COUNTERPROOF=ALL_CAUGHT`，逐条 `还原字节一致=OK`；
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

## 远程同步

| 远程同步 | 由门禁推导 | 本行**不事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属（只认 squash 尾注 `(#NNNN)`，PR 号见本 PR 页面）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇还不在基线上 ⇒ 判 `byDesign` 不红；把状态列预写成 `PASS` 会被 `prematureClaims` 判红。**本行的存在本身就是判据**：`check-gate-record-debt.js` 对「整块缺 远程同步 行」的新记录当场判红。main push 回读证据写在 PR 评论里，不写回本文件。 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING（收口由门禁推导）
