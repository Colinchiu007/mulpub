---
record: ux-audit-toast-a11y
task: UX 审计阶段 2.7 / 4.6 开工前的重测与规格更正（toast 面）：撤回 audit-60 的 a11y 前提、把 2.7 的缺口从"调用点数量"改判到"出口没有策略"，并记录一条被自己探针造出的假缺陷
date: 2026-10-19
sync_pr: pending
sync_status: PENDING
sync_reason: docs-only 变更，合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：toast 面实测更正（ux-audit-toast-a11y，2026-10-19）

| 门禁 | 状态 | Fresh 证据（当场实跑） |
|---|---|---|
| 判定：docs-only | ✅ | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true（提交后取证；本批只改 `01-docs/` 与 `CHANGELOG.md` 与本记录） |
| 变更类型与隔离 | ✅ | 纯文档/规格变更：按 AGENTS 就地编辑 + 经 PR 落地，但本批**同时在独立 worktree 里做**（`<仓库父目录>/mp-worktrees/mp-ux-audit-toast-a11y`），因为随后接的代码批需要这个工作区，避免同一分支混两类变更 |
| 行尾对账 | ✅ | `git diff --numstat` = `54 0` 与 `--ignore-cr-at-eol --numstat` = `54 0` **两口径相同、删除 0 行**；审计稿实测纯 CRLF（830→884 行，crlf==lf） |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` PASS（10574 个 tracked 文件） |
| 文档绝对路径 | ✅ | `node scripts/check-doc-abs-paths.js` PASS（现场 1163 处按文件与基线对齐；本批新增段落只用占位与相对路径） |
| 冲突标记 | ✅ | `node scripts/check-no-conflict-markers.js` OK（标记行 8 全带登记、不超基线） |
| 数字可重取 | ✅ | 本文每一处读数都附**当场可重跑的命令**（见下"读数与命令"），并在 16.3 记下一条因探针错而**撤回**的结论 |
| QM-1 / QM-2 / QM-4 / TDD / QM-6 | N/A | docs-only 通道：不改 `apps/desktop/electron/**`、`packages/rpa-engine/**`、不改渲染端视觉面、无代码变更 ⇒ 打包、代码必检项、像素门禁、TDD、双模型评审均不适用（跳过的都是与运行时无关的门禁） |

## 一、这一批做了什么（以及为什么不是直接写代码）

审计 §阶段2 的 2.7（toast 单点化）与 §阶段4 的 4.6（toast 容器补 a11y）是下一批代码的输入。
开工前按 `动手前重新拉取实况` 的纪律对 toast 面重取了一遍数，结果是**两条前提都不成立**：

- **4.6 的前提错在"量的对象选错"**：element-plus 的 message 根节点自带 `role="alert"`
  （`grep -ra "role:" node_modules/element-plus/es/components/message/` ⇒
  `message.vue_..._lang.mjs: role: "alert"`）。`role="alert"` 在 ARIA 里就是 assertive + atomic
  的活动区域 ⇒ **播报已在**。审计写的是"我们的源码里没写 aria 属性"，那是字面量层面的观察，
  不是最终渲染出来的宿主节点。同时实测本仓有 **27 个**非测试源文件已经写了
  `role="status"` / `aria-live`，"零 a11y 容器"也不成立。
- **2.7 的前提错在"把缺口定位在调用点数量"**：单一出口**已经存在**
  （`src/utils/notifyCore.js` 124 行 + `src/composables/useNotify.js` 127 行，六个导出）。
  实测缺口是出口里**没有策略**：`useNotify.js` 内 `duration` 出现 **0 次**，
  时长由各调用点自定（实测显式值分布 2500×2 / 4000×3 / 6000×1），也没有同源去重/分组。

所以这批**只落更正与规格重定义**，不动 90 个调用点：把"出口是否有策略"和"某页文案对不对"
混在同一次提交里，会让后者的任何回归都没法归因给前者（AGENTS「同一次提交改两个变量会让归因失效」的同条纪律）。

## 二、重定义后的三条可判定口径（写入 §16.2，代码批照此实现）

1. 出口持有**唯一一处**时长策略（默认值 + 上限 + 按 level 分档），调用点显式 `duration` 必须被策略夹住；
2. 出口做**同源合并**（相同 level + 相同文案在窗口内只留一条并显示计数），窗口与合并键进契约；
3. 直调 `ElMessage.{error,success,warning,info}` 由**只可缩小的棘轮**拦新增
   （基线 = 现测 **90** 处；`ElMessageBox.confirm` 7 处属模态确认，**不计入**、也不许与上面合并计数）。

## 三、读数与命令（下一轮可当场重取，不是"量过一次"）

```
# 90 处直调 + 7 处模态：只扫非测试源文件
grep -rnaE "ElMessage\.(error|success|warning|info)\(" apps/desktop/src --include="*.vue" --include="*.js" | grep -v ".test.js" | wc -l
# 出口里没有时长策略
grep -c duration apps/desktop/src/composables/useNotify.js     # 现测 = 0
# element-plus 已提供 alert 语义
grep -ra "role:" node_modules/element-plus/es/components/message/
```

## 四、一条被撤回的自造结论（16.3 同源，写下来比结论本身有用）

探针第一版用 `(?:^|[^\w-])duration\s*:\s*(\d+)` 数出「`2ms` 三次」，我据此准备写「存在 2 毫秒的
toast，用户根本看不见」。**打开原文核对后撤回**：三处是 CSS `animation-duration: 2s` / `2.4s`
（`LoadingState.vue:67`、`HotTopicsCentralLoading.vue:76`、`ProfileMenu.vue:456`）——
正则既没排除 `animation-` 前缀，也没参与单位 `s` 的判定。
口径落进审计 §16.3：**凡由计数器得出的"缺陷"，写进文档前必须逐条打开原文看一眼**；
报出的每个数都要能被当场重跑的那条命令重取，否则不许写"机械可复现"。

## 本次执行记录：toast 出口策略 + 单点棘轮（代码批，同分支第二批，2026-10-19）

| 门禁 | 状态 | Fresh 证据（当场实跑） |
|---|---|---|
| 判定：docs-only | ❌ false | 本批改 `apps/desktop/src/**` 与 `.github/workflows/**` ⇒ 混合 PR，走完整质量节拍（`classify-docs-only` 必须在 commit 后取证，预提交时 HEAD==base 会给出假 false） |
| 变更类型与隔离 | ✅ | 运行时代码变更在独立 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-toast-a11y`（非 C 盘）、裸分支名 `ux-audit-toast-a11y`；共享根保持 main clean |
| TDD（测试先于实现） | ✅ | `toast-policy.test.js` 15 条 + `useNotify.test.js` 19 条 + `toast-assert-helpers.test.js` 5 条；`cd apps/desktop && npx vitest run src/composables/useNotify.test.js src/utils/toast-policy.test.js` → **39 passed (39)**；全量 `npx vitest run src`（369 个测试文件）在补建 `electron/preload/index.bundle.js`（`npm run build:preload`，缺它时 `overlay-view-suspension` / `shell-mode-6b` 两条报 ENOENT）后全绿 |
| 变异反证 | ✅ 9/9 CAUGHT | 驱动先跑未变异正控（vitest 39 passed / gate `fail 0`）与**解析器正控**（四族失败行写法认不出即 exit 2），再逐条变异；还原后三个目标文件 md5 逐字节 IDENTICAL |
| 门禁接线 | ✅ | 判据本体 + 自测**两条命令都**接进 `quality-gate.yml` 的 `changes` 作业、且在非 PR 早退之前 ⇒ PR 与 main push 两档都覆盖；`node scripts/check-unwired-tests.js` → 「检查域内测试文件 109 个 / OK」 |
| 行尾对账 | ✅ | `git diff --numstat HEAD` 与 `git diff -w --numstat HEAD` 对照：`.gitignore 3/0`、`quality-gate.yml 6/0`、`useNotify.js 26/9` 两口径相同；`useNotify.test.js` 89/10 vs 88/9 —— 差的 **1/1 是原文件末尾没有行尾换行**、追加时补上那一个换行所致（`git diff | grep "^-"` 现场可见那行就是 `})`，非内容丢失） |
| 中文硬编码 | ✅ | `node .github/scripts/check-locale-sync.js --cjk` → PASS（基线 1331 / 当前 1164，无新增）；策略告警文案写成 ASCII（`console.warn` 是给开发者的，不是用户可见文案 ⇒ 按 AGENTS 不新增 locale 死键） |
| 超大文件 | ✅ | `node .github/scripts/check-max-lines.js` → 「无新增超大文件，挂账清单与现实一致」 |
| workflow 可编译 + fail-fast | ✅ | `node .github/scripts/check-workflow-structure.js` → files=14 violations=0；`node scripts/check-step-failfast.js` → 「多测试步骤均 fail-fast」（本批所在 run 块是 `shell: bash`，任一条非零即中止） |
| QM-1 打包 | N/A | 本批只改渲染端 `apps/desktop/src/**` 与 `scripts/**`，未触碰 `apps/desktop/electron/**`、`packages/rpa-engine/**` ⇒ AGENTS QM-1 的触发条件不成立（不假装跑过打包） |
| QM-4 视觉 | 未覆盖 | 出口改的是**调用参数**（duration/grouping/type 来源），不改样式与 DOM 结构；toast 是瞬时元素，`settleForCapture()` 之后已不在页面上 ⇒ 像素门禁对它的态**结构性失明**。如实记"没有视觉级证据"，不写成"已验证无回归" |
| QM-6 双模型 | ⚠️ 未执行 | 本机无 CCG：pre-commit 打印 `[CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁`。替代自证＝6 条变异 + 6 条门禁自测 + 34 条单测；不谎称跑过外部模型 |
| 品牌残留 / 冲突标记 / 绝对路径 | ✅ | `check-no-brand-residue` PASS；`check-no-conflict-markers` OK（标记行 8 全带登记）；`check-doc-abs-paths` 本批新段落只用相对路径与 `<占位>` |

### 变异反证（九条，各自只动一个变量）

| # | 变异 | 实测红在 | 结论 |
|---|---|---|---|
| ① | 出口不再套策略：`ElMessage({ message, type, duration: ms, grouping: … })` → `ElMessage({ message, type })` | 7 条：缺省 duration / 上限夹住 / grouping 默认开 / 0 常驻 / 非法回落 / 显式 grouping:false / `level:'warn'` 档位 | CAUGHT |
| ② | `resolveToastGrouping` 默认从开翻成关（`requested === false ? false : true` → `requested === true ? true : false`） | 4 条：「默认开（审计现场的刷屏…）」及出口侧三条 grouping 断言 | CAUGHT |
| ③ | 棘轮从"按份数"退化成"在册即放行"（`else if (n > allowed)` → `else if (false)`） | 1 条指名：「同一文件直调数从 3 涨到 4」 | CAUGHT |
| ④ | 摘掉注释剥离（`stripLineComments(src)` → `src`） | 2 条：「注释里举例写的 ElMessage.error( 不得计数」+「真实仓现场处数必须等于基线总数」 | CAUGHT |
| ⑤ | 档位词表漏掉 `warn` 档 | 3 条：出口侧 `level:'warn'` + 策略侧别名 + **成对键集锁** | CAUGHT |
| ⑥ | 只在**时长表**加一档（行为面看不出来） | 2 条：默认时长精确表 + 成对键集锁 | CAUGHT |
| ⑦ | 摘掉成员形态计数（`if (member > 0) memberByFile.set(...)` → `if (false)`） | 1 条指名：「方括号成员形态…在出口之外出现 ⇒ 红」 | CAUGHT |
| ⑧ | 摘掉出口豁免（`if (EXIT_ALLOWLIST.some(...)) {` → `if (false) {`） | 2 条：同上一条（出口内那处被当成违规）+「真实仓现场处数必须等于基线总数」 | CAUGHT |
| ⑨ | 观察助手恒真（`asymmetricMatch: (arg) => textOf(arg) === expected` → `() => true`） | 2 条：「文案不对就是不匹配」+ **「负控：参数根本不是消息时一律不匹配」** | CAUGHT |

第一轮驱动只拿到 2/4，两条 NOT_CAUGHT 事后证明**都是探针自己的错，不是实现的错**（这条比结论有用）：

- **跑法错**：驱动从**仓库根**执行 `npx vitest run src/...`，`@/i18n` 别名解析不到 ⇒ `useNotify.test.js`
  整份没加载。vitest 对此打印的是 `FAIL <file> [ <file> ]`（套件级），与"某条用例红"是两种形态；
  正确跑法是 cwd 落在 `apps/desktop`（本仓 CI 收编的那种）。**口径：判"某测试抓不抓得住"必须在
  runner 真实采用的那种跑法下跑一次**，本地另一种跑法的结论不算。
- **解析器漏码点**：失败行正则只认 `×`(U+00D7)，不认 node runner 的 `✖`(U+2716) ⇒ ③ 明明红了 1 条却报 `red=0`。
  由此在驱动里固化三件事：① 每条命令带自己的 cwd；② **`rc≠0` 而解析不到失败行 ⇒ PROBE_BLIND 直接 exit 2**，
  不得读成"没抓住"（这一档在本轮真的把第二次误报拦在了门口）；③ 解析器自带正控，四族写法各喂一行、
  认不出就 exit 2。
- **期望清单错**（第三条独立成因）：② 原先还指望「显式 grouping:false」也红 —— 该用例传的是显式 `false`，
  翻默认值不影响它的输入输出，**不红才是对的**。这是「认领不经该判据的用例」的同型，已改为只列依赖默认值的那条，
  并把"这条红不到"写进注释而不是靠放宽断言凑红。

### 用户可见行为的变化（写给下一个读代码的人，不必反推）
（本节按最终实现写：出口用「类型方法 + 选项对象」，不是泛化调用。理由见下一节《出口形态的二次改判》。）


- 同一条通知重复出现时折叠成一条并显示次数（此前是逐条堆叠刷屏）。
- 停留时长按档区分：error 6s、warning 4s、info 3s、success 2s；**此前出口不传 duration，四档一律 3s**
  （element-plus 默认），也就是"报错和提示一样久"。
- 调用点显式传的 `duration` 仍被尊重，但超过 10s 会被夹到 10s 并在控制台出声；传 `0` 表示常驻，原样放行。
- `notifyConfirm`（模态确认）不套时长策略、不进棘轮计数。

## 出口形态的二次改判（同批内，被全量套件推翻的第一版）

第一版实现把出口改成**一次泛化调用** `ElMessage({ message, type, duration, grouping })`，我自己那两个测试文件
**34 passed** 就认为成立。跑全量 `src` 后现场是 **18 个测试文件 / 284 条用例红**，错误签名 568 次
`ElMessage is not a function`：16 个消费者测试的 element-plus 夹具只提供**命名方法**（宿主确实提供命名方法，
`message.d.ts:174-179`），而我改成只调泛化形态，等于单方面打破了它们的观察契约。

**改判**：出口取 `ElMessage[type]({ message, duration, grouping })` —— 宿主 `MessageTypedFn` 实测接受选项对象
（`message.d.ts:173`），策略全部照样生效，而消费者观察面一条不用改。取舍不是"哪个设计更漂亮"，
而是**改契约要付多少别人的账**：改 16 个夹具动的是其他会话的测试面，且会把"mock 该长什么样"的争论带进本批。

改判带来的三条配套（都是必须项，缺一就是给门禁留洞）：

1. **棘轮必须数第三种形态**。`ElMessage[...]` 加进 `scan()` 成为第三张计数图，否则"别人也改用方括号"是一条
   完全不被观测的绕过路径 —— 而出口自己正是这一形。出口豁免因此要覆盖**全部三态**，只豁免泛化那一态
   会让门禁把自己的出口判成违规（变异 ⑧ 抓的就是这条）。
2. **blindness 判据必须跟着扩**。原条件是"两张计数图都空才算失明"，加第三张时我没并进去，
   于是只剩成员形态的夹具被误判成 rc=2「门禁坏了」——**是门禁的自测当场抓住的**（我为新一维加的那条用例），
   不是我读代码读出来的。口径：加任何"全部为空才失明"的判据时，先问"新这张图能不能单独支撑一个可判定的状态"，
   能就必须并进失明条件。
3. **消费者断言收敛到语义而不是形态**。新增 `src/utils/toast-assert-helpers.js`（单一实现），把 **78 处**
   `ElMessage.<档>).toHaveBeenCalledWith('文案')` / `expect.stringContaining(...)` / 直接读 `mock.calls[..][0]`
   的写法改成 `messageIs / messageContains / messageOf`，对字符串形态与选项形态**同时成立**；
   助手自身 5 条锁含一条关键负控（`undefined / 数字 / 空对象 / message 非字符串` 一律不匹配），变异 ⑨ 证明它有牙。
   78 这个数字来自清点探针（67 字面量 + 10 stringContaining + 1 `i18n.global.t(...)`），转换脚本对每个形态各断言命中数。

两处由**批量改写自己造出来**的破损（都在提交前被当场抓住，值得记下来因为它们的形状很普通）：

- 第二遍转换的字面量分支**漏了调用自身的收尾括号**（3 行 + 1 行带 `;` 的漏网），报的是 vite 解析错，
  定位不到具体行。正解不是去读测试输出，而是**改完立刻用 esbuild 把整个域的测试文件过一遍**
  （本轮 369 个文件，秒级，失败即非零退出）。`node --check` 抓不到这类问题（ESM/括号跨行都不报）。
- 变异驱动 v3 的**收尾漏了 `restore('final')`** ⇒ ⑨ 的变异（`() => true`）留在磁盘上。
  是我按"md5 逐字节对照"回读现场时发现的（`assert=81dc2cc0` 对不上驱动打印的那个值）。
  口径：反证驱动的**最后一次 restore 与逐字节对账**必须写在摘要之前，否则最后一条变异一定留残留。

最终读数：`npx vitest run src/composables/useNotify.test.js src/utils/toast-policy.test.js src/utils/toast-assert-helpers.test.js`
→ **39 passed**；被触及的 21 个文件 → **800 passed**；全量 `src` → **369 个文件全绿**（补建 preload 产物后）；
门禁自测 **7 passed / fail 0**；九条变异 **9/9 CAUGHT**、`restore[final] … => IDENTICAL`。

## 第 2 轮 re-sync 与本棘轮的第一次真实拦截（2026-10-19）

- 合入 `origin/main`（落后 8 个提交）后只有 `CHANGELOG.md` 一处冲突（两侧都是置顶新条目），按并集合：
  `hunks=1 / mine=77 / theirs=7`，双向多重集对账 `lost=0 gainedKinds=0`，标记行只剩 0 条。
  交集文件另有 `apps/desktop/src/views/FilmCanvasView.actions.test.js`（git 自动合，合并后 `git diff origin/main..HEAD -- 该文件`
  只剩我自己的 4/3 行 ⇒ 主干新增的 83 行完整保留），该文件 14 例与 toast 三套一起跑：**53 passed**。
- **棘轮当场拦下一笔主干增量**：`GREW views/FilmCanvasView.vue 12→13`。取证三连（merge-base=12 / origin/main=13 /
  `git log -1 -S` 归因到已合并的 `3b41a02c3 (#3978)`），确认与本分支无关后按「归因给 base 并逐项出声」口径 re-sync，
  并在判据头注释与基线 `_comment` 双处写下动因；`check-toast-single-exit.js` 现读 `直调处数=85 / 基线处数=85 / 违规=0 PASS`，
  `node --test scripts/check-toast-single-exit.test.js` 由 6/1 回到 **7 pass 0 fail**。
- 同跑（re-sync 后）：`check-gate-record-debt` OK、`check-pr-exec-record --mode=enforce` OK（本 PR 28 文件 / 携带 1 篇记录）、
  `check-doc-abs-paths` PASS（现场 1163 处、基线内 563 文件，无新增）、`check-no-brand-residue` PASS。
- **不认领别人的账**：本条只 re-sync 基线数字与出声，不迁移那一处调用点 —— 迁移要 messageKey 与 zh/en 成对 locale，
  属「某页文案对不对」的另一批变更，与本批「出口有没有策略」混在一起会让两批归因互相污染。


## 第三次改判：出口形状变更打破了一条**观察面断言**（CI 现场，2026-10-19）

### 现场（判据取产物，不是推断）

本 PR 第一轮 CI 唯一红项是 `QG Desktop Shards (2/2)`，1 红 / 8693：

```
FAIL src/views/Collection.rewrite-input-limit.test.js > 采集页一键改写 — 超长正文自动截取
AssertionError: expected '[object Object]' to contain '6766'
```

### 归因与 A/B 对照（先问"是不是我"，两条都跑）

在**另起的一个基于 main 的 worktree**（只加判据、未碰 useNotify）跑同一条用例：**5 passed**；
在本分支跑：红。⇒ **是本批引入，不是 main 既有**。机制很干净：该文件的观察助手写的是

```js
ElMessage.warning.mock.calls.map((call) => String(call[0])).join('\n')
```

而统一出口 `useNotify` 现在传给 `ElMessage.warning` 的是**选项对象** `{message, duration, grouping}`
（时长与同源合并由 utils/toast-policy 唯一持有，必然带选项），于是 `String(obj)` 得 `[object Object]`。

### 这是本批第二次踩"改调用形态就是改契约"，且这次落在**断言侧**

上一轮我把泛化 `ElMessage({...})` 改回 `ElMessage[type]({...})`，理由是"16 个消费者夹具只挂具名方法"——
那修的是**夹具形状**；这一处漏掉的是**断言读法**：`String(call[0])` 把"第一个实参是字符串"当成了契约。
两种形状在这一点上**并不等价**：观察者读的是实参类型，不只是"有没有弹"。

### 处置：改观察助手，不改断言强度

用本批已入库的共享助手 `utils/toast-assert-helpers` 的 `messageOf` 取文案
（它对"字符串形态"与"选项对象形态"都给得出文本），三处断言**原样保留**：
仍要求文案含 `6766` / `6000` / `截取`。没有放宽任何断言——这是形状迁移，不是降强度。

### 反证（teeth check，正控与变异都要有产物）

- 正控：未变异 `pnpm vitest run src/views/Collection.rewrite-input-limit.test.js` ⇒ **rc=0，5 passed**。
- 变异 N-a：把 `Collection.vue` 的截断分支改成恒假（即"摘掉截断提示"这一原始缺陷形态）
  ⇒ **rc=1，红的正是**「6766 字正文 → 截到 6000 码点后调用 aiRewrite，并明确提示截断；原文不被改写」。
- 跑后 `Collection.vue` 与跑前 md5 逐字节相同。

**顺手记下驱动自己的一次假阴性**：第一版 teeth 判据要求"摘要行含 `failed`"，而 vitest 的摘要行在剥色后
仍被 `─` 分隔符截成 `Tests 1 ───` ⇒ 明明 rc=1、用例名也解析到了，却报 `TEETH=NO`。
第三条判据**绑在了一条会被排版吃掉的文本上**——正是本仓反复记的"探针把自己的输出格式当契约"。
现改为以 **rc + 红集非空** 为准，摘要行只作展示。

### 同批另外两次探针失败（不是结论，记下来防重复）

1. 用 `execFileSync('node', ['node_modules/vitest/vitest.mjs', …])` 驱动时 MODULE_NOT_FOUND，
   而我一度把这个 rc=1 读成"变异把测试打红了"。**rc=1 有三种来源**（真红 / 工具没跑起来 / shell 包装问题），
   不看原始输出就无法区分；判"变异生效"必须**读到 FAIL 行本身**。
2. `shell: true` 时参数只做拼接不做转义（Node 自带发 DEP0190 警告），带路径的命令应改走
   `bash -lc '<整串>'` 并把输出重定向到文件再解析。
## 远程同步

| 远程同步 | 由门禁推导 | 本行**不事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属（只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇还不在基线上 ⇒ 判 `byDesign` 不红；把状态列预写成 `PASS` 会被 `prematureClaims` 判红（change: `ban-record-closure-backfill-pr` / `gate-record-sync-derived-status`）。main push 回读证据写在 PR 评论里，不写回本文件。 |

