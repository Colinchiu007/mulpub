---
record: ux-audit-knowledge-error-classify
task: UX 审计 3.8（错误文案真源）首批 —— 渲染端 9 处把后端/IPC 原文直出成用户提示的调用点收敛到统一口径，并配 11 条锁与 4 道变异反证
date: 2026-10-21
sync_pr: pending
sync_status: PENDING
sync_reason: 运行时代码变更（apps/desktop/src）+ PRD/CHANGELOG，合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：错误提示不直出原文（ux-audit-knowledge-error-classify，2026-10-21）

| 门禁 | 状态 | Fresh 证据（当场实跑，非引用） |
|---|---|---|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 独立 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-knowledge-error-classify`（非 C 盘），分支 `ux-audit-knowledge-error-classify`（`rev-parse --abbrev-ref HEAD` 回读同值）。共享仓库根（main-only 协调目录）全程未写入 |
| 质量节拍 pre-flight | ✅ | 编辑前确认当前分支非共享根 `main`；`git status` 起始仅本次改动集（8 个文件），无他人未提交内容 |
| 自测（消费者并集） | ✅ | 判据不是「我改过的文件」而是**消费者并集**：对 6 个被改组件 + `user-facing-error` 模块逐个 `git grep -l` 反查测试消费者，得 16 个测试文件 ⇒ `vitest run` 该并集 = **301 passed / 1 skipped（302）/ 16 files**，含 `PublishFrequencySettings.test.js`、`SettingsDialog.test.js`、`PerformanceInsights.test.js`、`RewriteView.test.js`（98）、`ipc-exposure-contract.test.js`（20） |
| 反证（4 道） | ✅ | `node <临时脚本目录>/mw-38-mutate.cjs`（变异驱动落在本机临时目录、未入库）→ `COUNTERPROOF=ALL_CAUGHT`，`rc=0` 基线趟 `collected=11 red=[]`；M1/M2/M3/M4 **红集互不相同**，每条 `restoreByteIdentical=OK`。M3 另断言「点名清单里的锁不得因本变异而红」= OK，证明全域棘轮与点名锁是**两个保护面**而不是同一条锁 |
| 静态门禁 | ✅ | `check-locale-sync.js --cjk` → **PASS（基线 1330 条，当前 1125 条，无新增硬编码）**：本批未新增任何用户可见字符串，只改「取哪份文案」这一步 ⇒ **不需要**成对改 locales；`check-max-lines` → 无新增超大文件、挂账清单与现实一致（`PublishFrequencySettings.vue` 495→496，仍在 500 以下）；`check-no-brand-residue` → PASS；`check-doc-abs-paths` → PASS（counts=1161 domain=4757 files=561，本记录一律用 `<仓库父目录>/…` 占位） |
| 行尾对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` **逐字相等**（8 个代码文件 2/1、5/4、110/0、21/1；文档 19/0、10/0）。本轮**当场抓到并修掉一处自造全文改写**，见「三、行尾那一刀」 |
| QM-1 打包 | N/A | 只改 `apps/desktop/src/**`（渲染端），未触碰 `apps/desktop/electron/**` 与 `packages/rpa-engine/**` ⇒ 打包判据不触发；理由写在这里，不留给下一个会话猜 |
| QM-4 视觉回归 | 未跑（如实登记） | 本批只替换 toast 取文案的表达式，不改盒模型/颜色/字号；且文案内容由既有 locale 键与被分类文案决定，像素门禁对「错误路径上的文案」结构性失明（错误态需要注入失败才有内容）。像素判定由 `QG Visual` 在 CI 以 CI 渲染为准执行 |
| QM-6 双模型 | 未跑（如实登记） | 本机 CCG 未安装，pre-commit 实测打印「未找到 CCG（run_skill.js），已跳过」；`scripts/ccg-review-decider.js` 对本次变更集判 `mode`（见第五节读数）。**不伪造 `cleared`，也不写 `self_play_resolved`** |
| 第一性原因（QM-5 ①） | ✅ | 不是「忘了调 `formatUserError`」，而是**分类器的两个出口对调用点都是负收益**：`matched='passthrough'` 原样透出自然语言原文（含 `Error: write ECONNREFUSED 127.0.0.1:8000` 这类技术串），`matched='fallback'` 给通用「操作失败，请稍后重试」。调用点原本写 `(res && res.message) \|\| t('页面专属键')`，等于**绕过分类器**——但即便改成 `formatUserError(res).message` 也一样错：会把「草稿加载失败」换成信息量更低的通用串。缺的是「只有真认出来才采纳」这一层 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：`user-facing-error.test.js`（32 例）测的是**分类器自身**，没有任何一条看调用点用什么表达式 ⇒「分类器正确 + 调用点不用它」可同时成立（本仓「注册≠注入≠生效」的同型）。集成层：`KnowledgeBaseHotsyncUi.test.js` 等断言渲染结构与键名不断言错误文案。视觉层：错误态需要注入失败，像素门禁不覆盖。审查层：3.8 这一行是靠人工读码发现的，此前不在任何机械判据视野内。四类原因同时命中：无测试 / 断言不精确 / 测试不执行（对调用点而言）/ 环境差异 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 单一实现 = `user-facing-error.js` 的 `userFacingErrorMessage(input, fallback)`（`fallback` 支持惰性函数，避免每次调用做 i18n 查表）；9 处调用点全部改走它。回归保护 = 同目录新文件 `user-facing-error.call-site.test.js`（11 条，含逐文件点名锁 + 全域棘轮 + 两条反失明断言） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **全域棘轮**：`ElMessage.*((res\|e) && (res\|e).message) \|\| t(..)` 在 `src/**` 源码内**存量为 0**，新增即红（清单无法"登记例外"，因为它不是白名单而是等值判据）；② 棘轮自带**反失明**两条：扫描域文件数 > 100、域内含 `ElMessage.error(` 的文件数 > 10 —— 没有这两条，「零命中」与「扫描器没读到任何文件」同形（M4 专门测这一格）；③ 点名锁与棘轮**保护面互不重叠**，由 M3 的「点名锁必须保持绿」断言钉住；④ 判据一律用**枚举** `{errorCode, code, pattern}` 而非「message 非空」——后者会把 `fallback`/`passthrough` 两档放行（M2 专门测这一格） |

## 一、这次到底改了什么（用户可见口径）

**改前**：知识库相关面板、发布频率设置、表现洞察共 9 处，一旦后端/IPC 返回的 `message` 非空，就把**它**当提示正文显示。现场形态是英文技术串与内部地址，例如 `Error: write ECONNREFUSED 127.0.0.1:8000`、`Command failed: …`。用户既看不懂，也等于把内部拓扑透露到界面上。

**改后**：这 9 处一律经 `userFacingErrorMessage(res|e, () => t('页面专属键'))`：

| 情形 | 用户看到 | 说明 |
|---|---|---|
| 返回带稳定 `errorCode`（如 `NETWORK_ERROR`） | 该码的中文「原因 + 建议」，例：「网络连接失败。请检查网络后重试。」 | 采纳分类文案 |
| 返回数值 `code`（`-3`/`-2`/`-10`/`-11`/`-12`/`-13`/`429`/`402`） | 同上（映射到对应码的文案） | 采纳分类文案 |
| 只有遗留英文原文但命中 pattern 规则（未登录/网络/超时/存储/限流/额度/API Key） | 同上 | 采纳分类文案 |
| 认不出来（`matched='fallback'` 或 `'passthrough'`） | **该页面原本那句专属文案**（如「草稿加载失败」「保存失败，请检查输入后重试」） | 不用通用「操作失败」顶掉它，也不透出原文 |
| `input` 为 `null` / `undefined` / 抛错对象无 message | 同上一行的页面专属文案 | **不得抛错**，提示链路自身不能成为新故障源 |

显示位置、触发时机、按钮、是否自动消失**均未改变**；本批只动「取哪一份文案」这一步，因此**不需要**新增或修改任何 locale 键。

## 二、为什么不写成 `formatUserError(x).message`

分类器返回 `{ errorCode, message, matched }`。`message` 在四档里都非空，但语义完全不同：

- `errorCode` / `code` / `pattern`：`message` 是**本地化的原因+建议** ⇒ 可用；
- `fallback`：`message` 是通用「操作失败，请稍后重试」⇒ 用它等于把页面专属信息降级；
- `passthrough`：`message` **就是原始输入文本**（长度 ≤200 时原样透传）⇒ 用它等于没修。

所以采纳条件必须写成**枚举匹配**。这一条若不写清，下一个会话最自然的"顺手简化"就是把 `userFacingErrorMessage` 收成一行 `formatUserError(x).message` —— M2 变异正是把这个简化写回实现（`Boolean(matched.message)`），实测让 2 条锁同时指名红。

## 三、行尾那一刀（本轮自造并已修掉的全文改写）

插入 `import` 的锚点最初写成 `/^import \{[^}]*\} from 'vue'\r?$/m`。`$` 在 multiline 下匹配 `\n` **之前**，而 `\r?` 会把行尾的 `\r` **吃进锚点**，于是 `slice(0, anchor.end) + '\r\n' + IMPORT + 余文` 拼出 `\r\r\n` + 裸 `\n` 两处畸形终止符。后果不是"难看"：`* text=auto` 对**混合行尾**的文件**不做转换**（`git ls-files --eol` 报 `i/-text`），于是整份文件以 CRLF 入 blob，`git diff --numstat` 从 5/4 膨胀到 **496/495**（= 全文重写），下一个会话合这个文件时必然得到"整文件冲突"。

修法不是"探测多数派 eol 再统一回写"（那会改写全部 462 行），而是**把那一行自己的终止符原样带过去再补一行**：`^(import …)(\r?\n)` → `$1$2 + 新行 + $2`。修后两口径逐字相等（5/4、2/1），`git ls-files --eol` 回到 `i/lf w/crlf`。

同批两处防自证设计：文档 runner 在落笔前先断言 `join(split(text)) === text` **逐字节可逆**；插入点用「锚点行形状 + 其后 1~4 行内必须出现目标标题」双条件定位（PRD 是同拼接段的巨文档，那句锚点出现 **2 次**，只按内容匹配会插错段），当场因"锚点下一行是空行"而拒绝执行过一次，改正后才落盘。

## 四、四道变异（各自红集互不相同）

| 编号 | 变异内容（取被禁形态本身） | 期望指名红 | 实测 |
|---|---|---|---|
| M1 | `KnowledgeBasePage.vue` 的调用点退回 `ElMessage.error((res && res.message) \|\| t(…))` | 点名锁（该文件） | CAUGHT，newReds=2（点名锁 + 全域棘轮） |
| M2 | `userFacingErrorMessage` 的采纳门改成 `Boolean(matched.message)` | passthrough 保留兜底那条 | CAUGHT，newReds=2（passthrough 锁 + 空输入锁）——**顺带暴露**：空输入那条也依赖这道门，"非空即采纳"连 `null` 都兜不住 |
| M3 | 在**未进点名清单**的 `Dashboard.vue` 把一句 `ElMessage.error(t('dashboard.syncFailed'))` 改成禁形态 | 只有全域棘轮 | CAUGHT，newReds=1，且断言点名锁保持绿 = OK（证明两条锁不是同一条） |
| M4 | 把 `scanDomain` 的收集语句改成 `if (false)`（掏空扫描域） | 扫描域非空那条反失明锁 | CAUGHT，newReds=1 |

每条跑完对被改文件做 md5 比对，四道全部 `restoreByteIdentical=OK`；还原一律从**内存里的原始字节**，不走 `git checkout`（本次新增的测试文件尚未入库，`git checkout HEAD -- <未跟踪路径>` 无从恢复，用它会静默丢文件）。

## 五、判定与后续（不假装已闭合）

- `node scripts/ccg-review-decider.js`（不带 `--base`，判暂存区）现场读数：**SINGLE / 变更 156 行（≤ 200）/ 8 个源文件 / 无敏感命中**，判定落盘 `.ccg/reviews/62eb61e4e1b5de8bac3cf8c397ca7735e2502d64c9f784eec6425f89f5a73e04.json`。要点：decider 的行数口径只算**源文件**（156 = 146 插 + 10 删），文档与执行记录不计入 —— 首次带 `--base origin/main` 跑时因改动仍在暂存区而打印「未判定：origin/main...HEAD 为空」，并明确写了「这不等于无需审查」，两种成因各给补救，按补救改跑法即可。`check-pr-exec-record.js --mode=enforce` 的读数见 PR 评论。**QM-6 双模型外部评审今天仍跑不成**（`codeagent-wrapper` 对 claude 后端固定走 stdin 模式并拼出 `--setting-sources` 空值 ⇒ `exit 1`；opencode 免费档被 IP 信誉拦截），已按实际登记为未执行；decider 文案里的「后端就绪（claude + opencode）」是它对配置文件的静态读法，与实跑结果相反，不得据其声称评审发生过。
- **未收敛的存量（本批刻意不做，需产品裁决）**：
  1. `useCollectionBatchPublish.js` 3 处 `notify.error(String((e && e.message) \|\| e))` —— 兜底是**异常对象本身**而非 locale 键，直接套 `userFacingErrorMessage` 会在认不出时显示 `[object Object]`；正解要先定「批量发布的失败文案是否统一取 `collection.batch.*`」，属产品裁决，不在本刀顺手改。
  2. 页面内**错误行**（`error.value = (res && res.message) \|\| t(…)`，如 `PersonalFormDialog.vue`、`ViralFormDialog.vue`、`FeishuSettingsTab.vue`、`ZhihuSettingsTab.vue`、`PodcastScriptEntry.vue` 等）—— 本刀的棘轮只覆盖 toast（`ElMessage.*`）。要不要把「一切用户可见的错误文本都经分类器」立为契约，是范围决定而非遗漏；若立，棘轮判据需扩到赋值表达式与 `.value` 绑定两类形态，并先量一次存量。
- 首页文案、品牌称谓、遥测隐私等既有产品待决项与本批无关，未据此改动任何显示文案。
