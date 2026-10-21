# PRD：撤下两个"存在但无人渲染"的组件（UX 审计 1.3，ux-audit-dead-components-retire）

日期：2026-10-21 ｜ 分支：`ux-audit-dead-components-retire` ｜ 类型：删除 + 防复活锁（S–M）

## 1. 问题与取证

审计条目 1.3 原文：**`TrialBanner` 接进 MemberCenter 或删除；`LoadingState` 删除或接上**，
判据是「二选一，不允许"存在但无人渲染"」。

| 件 | 位置 | 取证命令与结果 |
|---|---|---|
| 试用横幅 | `apps/desktop/src/components/TrialBanner.vue` | `grep -rna "<TrialBanner" apps/desktop` ⇒ **0 模板用法**；`grep -rna TrialBanner apps/desktop/src` ⇒ 只命中自身、两个测试文件、若干注释 |
| 它的文案 | 组件内硬编码中文「当前为免费版，部分功能受限」「试用期还剩 N 天」 | 未走 locales（i18n 债），且**已被产品决策判为误导** |
| 决策历史 | `apps/desktop/src/views/Dashboard.style-guard.test.js` | 第 1 版（2026-10-16）要求横幅必须在 `.cohere-content` 内（对齐缺陷）；第 2 版（2026-10-17）**用户决策方案 C：撤下**，理由「本页三个数据源门禁都是登录而非套餐，没有内容因套餐受限」；套餐差异改由区块锁占位真实表达（PRD §3.2） |
| 真实承载 | `apps/desktop/src/features/dashboard/DashboardLockedPanel.vue` | 区块级"锁区块占位"就是当前的套餐差异显示面 |
| 加载态 | `apps/desktop/src/components/LoadingState.vue` | `main.js:57` 全局注册；`grep -rna "<LoadingState" apps/desktop/src` ⇒ **0 用法**；骨架屏实际由 `EmptyState` / `UiSkeleton` 承担 |
| 隐藏注册点 | `apps/desktop/test-setup.js`（`src` **之外**） | 测试全局组件表镜像了 `main.js` 的注册；只 grep `src/` 会漏 ⇒ 首次删除后 4 个测试文件以 `Failed to resolve import "./src/components/LoadingState.vue" from "test-setup.js"` 整片挂死 |

## 2. 决策：删除，而不是接到会员中心

判据不是"哪个设计更好"，而是**会不会与已编码的 UX 契约冲突**：

1. 横幅要表达的"你在免费版/试用剩余 N 天"，在本仓已由**区块锁占位**逐区承载（且这是用户决策）；
   再接一个全局横幅等于造第二份真源，两者不一致时用户不知道该信谁。
2. 那条文案的"误导"性质与页面无关：会员中心同样按权益分区展示，横幅在那里只会重复而不是澄清。
3. 审计条目的是消除"存在但不可达"，删除直接满足，且不需要新文案设计、不需要 i18n 补齐、不需要新增视觉判定域。

若产品将来确要恢复：MUST 同时恢复看板页「必须在 `.cohere-content` 内」的位置守卫（防对齐缺陷回潮），
并另开 change 说明文案与落点。这条前置写进了锁的红文案里，不靠记忆。

## 3. 变更清单

| 动作 | 文件 | 说明 |
|---|---|---|
| 删除 | `components/TrialBanner.vue`、`components/TrialBanner.test.js` | 组件与其"自己 mount 自己"的测试 |
| 删除 | `components/LoadingState.vue`、`components/LoadingState.test.js` | 同上 |
| 删除 | `components/more-tests.test.js` | 去掉 TrialBanner 的 4 条后该文件**零用例**（vitest 报 `No test suite found` 是红不是跳过），且其中 `UpgradeModal` 的 import 本就未被该文件使用；`UpgradeModal` 的真实测试在同名 `.test.js` |
| 改 | `src/main.js` | 去掉 `LoadingState` import 与 `app.component('LoadingState', …)`，原地留"为什么删"的注释 |
| 改 | `apps/desktop/test-setup.js` | 去掉测试全局组件表里的 `LoadingState`（镜像注册点） |
| 改（注释） | `features/dashboard/DashboardExtraPanels.vue`、`DashboardLockedPanel.vue` | 两处注释原指向"TrialBanner.vue 的三轮注释"，文件已删 ⇒ 改为 `git log -p --follow -- <路径>` 取证写法 |
| 新增 | `components/dead-components.test.js` | 防复活锁（11 条） |

## 4. 显示项与交互（本批"减少"的部分）

| 面 | 变化 |
|---|---|
| 看板页 | 无变化（横幅早已不渲染，本批只是删文件） |
| 会员中心 | 无变化（本批不新增任何显示面） |
| 加载/骨架态 | 无变化：实际渲染的仍是 `EmptyState` / `UiSkeleton` |
| 全局组件表 | 少一项 `LoadingState`（`main.js` 与 `test-setup.js` 同步） |
| 用户可见文案 | **只减不增**（删除组件里硬编码的中文串），因此 locales 无新增键、无 zh/en 成对面 |

## 5. 锁的口径（本批真正的技术内容）

`dead-components.test.js` 六条：

1. **扫描域规模下界**（`scanned > 100`）：空集合会让"零引用"读起来完全像通过。
2. **组件文件不得复活**：`TrialBanner.vue` / `LoadingState.vue` 必须不存在。
3. **`TrialBanner` 不得再出现在代码行**（豁免两个反向守卫）。
4. **`LoadingState` 不得再出现在代码行**，并额外直接断言 `main.js` 没有 `app.component('LoadingState'`。
5. **反向守卫本身必须还在**：`Dashboard.style-guard.test.js` 仍含 `<TrialBanner` 缺席断言、
   `Dashboard.test.js` 仍含 `TrialBanner` 的 `findComponent` 缺席断言。
   没有这条，豁免清单就是一个可复用的洞（"禁令必须配正向对偶"同族）。
6. 判据先**剥行注释**再匹配：解释"为什么删"的注释必然提到被禁名字，按整文件匹配会把说明判成违规。

## 6. 反证（可复跑驱动，逐条实测）

判据是"文件/字符串"形态且**豁免清单只能缩小**，一次人工注入不足以让下一个会话复验，
因此本批落成了驱动 `scripts/dead-components-contract-mutate.js`（与 1.5 / 1.6 两个驱动同一套骨架：
基线不干净一律拒跑、变异前备份 + `finally` 还原 + 还原后 md5 复验、`--only=` / `--keep-going`）。

现场读数：

```
[BASELINE] rc=0 failed=0 passed=11 collected=11 errors=0 blind=false
[C1] CAUGHT … [C2] CAUGHT … [C3] CAUGHT … [C4] CAUGHT（红 4 条）… [C5] CAUGHT
[SUMMARY] 共 8 条：CAUGHT=8 其余=0        驱动 rc=0
```

| # | 注入（必须是**可执行**形态） | 期望 |
|---|---|---|
| C1 | 把 `LoadingState: EmptyState,` 加回 `test-setup.js` 的全局注册表（注册名是真的，值指向别的组件） | 第 6 条红 |
| C2 | 在 `main.js` 里重新 `app.component('LoadingState', …)` | 第 4 条红 |
| C3 | 把豁免方 `Dashboard.style-guard.test.js` 的探针换成 `indexOf("<GhostBanner")`（守卫恒过但仍在文件里） | 第 5 条红（豁免不可白拿） |
| C4 | 把扫描根 `SRC` 改成一个不存在的目录 | 第 1 条红（扫描退化不得读成通过；实测红 4 条） |
| C5 | 重新创建 `components/LoadingState.vue`（空壳） | 第 2 条红 |
| C6 | 把接线藏进「行首块注释 + 同行代码」：`/* 恢复 */ app.component('LoadingState', EmptyState)` | 第 4 条红（旧 `code()` 整行当注释丢掉 ⇒ 漏报） |
| C7 | 把 `Dashboard.test.js` 的缺席断言翻成正面断言（`.toBe(false)` 改成 `.toBe(true)`） | 第 5 条红（旧判据只看名字在场 ⇒ 完全隐身） |
| C8 | 把对比度探针的 dashboard 档改回已撤组件的类名 `.banner-text` | 第 11 条红（该选择器只存在于已撤组件里，且这一档不得被整条删掉） |

⚠️ 三条**取反证形态的规矩**，都由本批第一跑"5 条全 MISSED"复盘得来，细节见执行记录 §3.3：

1. 解析 vitest 输出前**必须剥 ANSI**——汇总行的数字被转义符包着，不剥就恒 0，
   于是"基线干净"和"变异没红"共用同一个读数。
2. 注入必须是**能求值**的形态。裸 `LoadingState,`（对象简写）是未定义标识符，
   会让整个测试文件在收集期死亡，输出只剩文件级 `FAIL` 而无具名红——
   驱动为此新增 `RUN_UNCLEAN` 档：`rc≠0 且具名红=0` 一律判"不可归因"，**不得**读成"锁没牙"。
3. 变异**不得攻击断言本身**（"把那行 `expect` 删掉"证明不了任何锁有牙）。
   要攻击的是被锁保护的那个**行为**；若锁因此太弱（本批实测：只查"文件里提到那个名字"），
   正解是**补强锁**（收紧成形状判据）再改变异，禁止为了让变异红而放宽锁。

接进 CI 的欠账仍记在任务 #23（三个同类驱动一起接，落点须避开 30 分钟预算墙）。


## 7. 验收标准

| # | 判据 |
|---|---|
| V1 | 四个组件文件与 `more-tests.test.js` 均不在树里（`git ls-files` 读回） |
| V2 | `dead-components.test.js` 11 条全绿 |
| V3 | `UpgradeModal.test.js` + 两个 Dashboard 守卫全绿（共 56 passed，本批现场读数） |
| V4 | 全域 `vitest run src` 与 origin/main 基线对照，无**新增**红（读数写进执行记录） |
| V5 | 聚合 `eslint electron src --quiet` rc=0；`check-locale-sync --cjk` 无新增硬编码 |
| V6 | 反证 C1–C5 各自点名变红 |
| V7 | `debt-baseline` 的 `maxFileLines`/`filesOver500` 等指标不因本批变大（删除应只会变小；若某项反而要调大，须按"调大必须与真实清理同 PR"的锁处理） |

## 8. 遗留

1. 通用的"未接线组件"门禁属阶段 5.3（`check-ui-wired.js`）；本批只锁这两例，不擅自打开全域。
2. `TrialBanner` 依赖的 `useLicenseStore`（`isTrial` / `isFree` / `daysRemaining`）仍有其它消费方，
   本批不动 store；若将来 5.3 之后要做"试用剩余天数"的真实提示，那是一个新单元（含文案、i18n、落点）。
3. 反证手工注入未接 CI（同任务 #23 欠账）。
