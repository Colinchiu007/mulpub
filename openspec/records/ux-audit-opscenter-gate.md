---
record: ux-audit-opscenter-gate
task: UX 审计实施方案 5.1/5.2 —— ops-center 前端纳入一致性门禁（跨应用规则 + 反向边界 + 域健康守卫），并修掉该应用唯一那处原生 window.confirm 孤例
date: 2026-10-19
---

## 本次执行记录：ops-center 纳入门禁（ux-audit-opscenter-gate，2026-10-19）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 改 `.github/scripts/` 判据本体 + 共享基线 JSON + `ops-center/frontend/src/**` 运行时代码 ⇒ 混合 PR，不借 docs-only 快速通道 ⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-ux-audit-opscenter-gate`、裸分支同名（`scripts/start-mp-task.ps1` 创建，判据取 `git worktree list` + `rev-parse --abbrev-ref HEAD` 实证，不取 rc） |
| 判定 | `classify-docs-only` docs-only=false | 改动集含工具脚本与运行时前端代码两类 |
| 缺陷本体（先证明它真存在） | ✅ | `git show origin/main:ops-center/frontend/src/views/PromptEvalWorkbench.vue \| grep -c window.confirm` ⇒ **1**，命中原文第 440 行：`if (!window.confirm('确认删除该评测及其生成物？')) return`。同应用其余删除入口（`Announcements.vue:128`、`AppMenu.vue:286`、`ContentCategories.vue:194`）**全部**已经是 `ElMessageBox.confirm` ⇒ 这是孤例，不是"该应用用原生框" |
| 第二处缺陷：失败无出口 | ✅ | 原实现 `await deletePromptEvalCase(id)` **没有 try/catch**：删除接口 500/404 时异常直接冒出，界面上没有任何提示（该文件其余入口一律写 `errorMsg.value = '…：' + apiErrorMessage(e)`）。确认框换成 ElMessageBox 时一并补上，不新增文案键 |
| 修法选择 | ✅ | `doDelete(row.id)` 改为 `doDelete(row)`：文案必须点名被删对象（title + ID），而只传 id 就取不到 title。模板调用点同步改（`@click="doDelete(row)"`），并新增 `import { ElMessageBox } from 'element-plus'`（与该应用既有风格逐字一致，不是全局注册） |
| 取消语义 | ✅ | `try { await ElMessageBox.confirm(...) } catch { return }` —— 取消/ESC/遮罩关闭全部走 reject ⇒ 什么都不做（fail-closed）。**不得**写成"catch 里继续删"，那正是本 PRD §3.1 第 2 条要消灭的形态 |
| 模板编译验证 | ✅ | 本 worktree **没有** `ops-center/frontend/node_modules`，跑不了 `vite build`；改用仓库根 `@vue/compiler-sfc` 直接解析该 SFC：`parse errors: 0`、`template errors: 0`、`compileScript ok`（并断言 `doDelete` 进了绑定表）。**这不是 `vite build` 的等价物**，只是模板层的最小证据；构建覆盖的缺口见下面「现场发现的更大问题」 |
| 判据扩域规格 | ✅ | `.github/scripts/check-frontend-consistency.js` 新增第二扫描根 `ops-center/frontend/src`，规则按"跨应用是否成立"分配：`windowConfirm` 两应用都守；新增 `opsElectronApi` 反向边界（该 API 只在桌面端渲染进程存在，ops 引用即运行期恒 undefined 的静默 no-op）；`rendererIpcDirect` 与 `appleAlias` **明确不扩** —— 前者依赖桌面端 `src/api` 桥接层白名单，后者依赖桌面端 `tokens.css` 资产，套到 ops 只会造出既不可修也不可解释的"存量" |
| ops 侧为什么走全域遍历 | ✅ | `RENDERER_DIRS`（views/components/composables/stores/features/layouts/story2video/i18n/router/utils）是按**桌面端目录结构**写的。ops 的目录是 `api/ config/ constants/ styles/ …`，套那张表会漏掉除 views 之外的一切。回归锁直接点名这条：在 `api/`、`config/`、`constants/` 各放一处违规，断言三条都被看见（旧口径一条都扫不到） |
| 既有计数不得被顺改 | ✅ | 现场读数：`域: desktop(renderer=375,anySrc=540) ops(renderer=54,anySrc=83)`；`windowConfirm 0 / rendererIpcDirect 0 / opsElectronApi 0 / appleAlias 0`，共享基线里他方键 `colorLiterals=129`、`cssVarUndefined=64` 原样保留（`mergeBaseline` 契约） |
| 基线新键 | ✅ | `frontend-consistency-baseline.json` 插入 `opsElectronApi: 0`（紧跟 `rendererIpcDirect`）。`evaluateBaseline` 对缺键 fail-closed，所以基线必须与代码同批落，否则门禁一上线就红在"我自己缺配置"而不是"发现违规" |
| 域健康守卫（本次最要紧的一条） | ✅ | 扩域最危险的失败形态不是报错，而是**路径写错 ⇒ 扫到 0 个文件 ⇒ 0 违规 ⇒ 读成通过**。`domainStats()` 每根每桶出声，`assertDomainHealthy()` 三档（根不存在 / 域为空 / 低于下界 ⇒ 退出码 2，与"发现违规"的 1 分开）。下界按当场实测登记（`desktop:renderer 200 / desktop:anySrc 300 / ops:anySrc 40`），并锁「下界的键集 == 被消费的 (根,scope) 组合集」—— 给没人用的组合留下界是死配置，有没人守的组合是漏守，两者当场红 |
| 回归锁 | ✅ | `.github/scripts/check-frontend-consistency.test.js` **32 例全绿**（原 21 例 + 本批 11 例：跨根检测与前缀正确性 / 缓存按 (根,scope) 分键 / `domainStats` 读数 == 非缓存 ground truth / ops 全域覆盖三个 RENDERER_DIRS 盲区 / 反向边界互不越根 / appleAlias 不得扩到 ops / 未注册根抛错 / 域健康三档失明 / 真实仓两根读数与下界 / main 必须显式传两个根且默认第二参数为 null / 本批 .vue 落点的取消+失败两条出口） |
| 变异反证 | ✅ | **10 道全部 CAUGHT，红集互不相同，`RESTORED_OK=true`（md5 自证还原）**：FC-M1 前缀写死桌面端 ⇒ 跨根 + 反向边界红；FC-M2 缓存退回 scope 单键 ⇒ 分键锁 + `domainStats` ground-truth 锁红；FC-M3 `windowConfirm.roots` 退回 desktop ⇒ 4 条红；FC-M4 撤 `scopeByRoot.ops` ⇒ 4 条红；FC-M5 `appleAlias` 越根 ⇒ 2 条红；FC-M6 摘"域为空" ⇒ 失明锁红；FC-M7 摘"域塌方" ⇒ 失明锁红；FC-M8 摘未知根抛错 ⇒ 红；FC-M9 默认参数改读真实 ops 目录 ⇒ 结构锁红；FC-M10 消费时忽略声明的 roots ⇒ 5 条红 |
| 两条被实测否证的自写用例（改的是夹具，不是断言） | ✅ | ① **FC-M2 第一次跑报 `MISSED(照绿)`**：我的分键夹具让两根各走**不同** scope 字面量，而不同字符串本来就不相撞 ⇒ 那条锁对"缓存键少了 rootId"结构性免疫。改法不是放宽变异，而是**强制两根走同一个 scope**（临时清空 `scopeByRoot`），另加一把"缓存读数必须等于非缓存遍历结果"的交叉量。② **FC-M10 的期望清单写错**：我把"声明面"的 PATTERNS 用例列进了"消费面"变异的红集 ⇒ 报成"红了但没红在指名用例"。改正期望并把它写进本行，免得下一个会话以为那条锁该红 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触碰 `apps/desktop/electron/`、`packages/rpa-engine/`、桌面端 `.vue`/样式/locale。改动面是 ops-center 前端一个视图 + CI 判据 |
| QM-2 代码必检项 | ✅ | ① 高频路径无同步 CPU 密集原语（判据只在 CI 跑）；② 无新增全局 `app.component`/顶层 CSS；③ `require('./check-frontend-consistency')` 同目录存在（`node --check` 两文件均通过）；④ 未改 preload/IPC；⑤ 无 `v-html`；⑥ 桌面端渲染端零新增中文字面量（改的是 ops-center，其文案不走进桌面端 locales 体系，故**不新增 locale 死键**） |
| QM-6 CCG 双模型外部评审 | 未执行 | pre-commit 打印 `[CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁`；本机无可用外部评审通道 ⇒ 如实记未执行，不伪造 PASS；`ccg-review-decider` 未产生 `mode=dual` 产物 ⇒ 无深度审查欠账可闭环 |
| 行尾对账 | ✅ | 四个被改文件在 `git ls-files --eol` 均为 `i/lf w/crlf attr/text=auto` ⇒ 工作副本约定是 CRLF。新增行按文件自身行尾归一（逐文件断言 `crlf==lf`、无裸 `\r`），`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致 |
| 文档同步 | 随 CI doc-gate | 规格面：`openspec/specs/desktop-ui-consistency` 目前只描述桌面端；本批把两条规则扩到第二个应用并新增一条反向边界，**属规格变更**。不随本 PR 偷改主干规格（归档流程另有其路径），在此显式登记为后续项 |
| 远程同步 | 由门禁推导 | 本行**不事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导；预写 `PASS` 会被 `prematureClaims` 判红 |

- 保留门禁：docs-only=false 完整节拍 | 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件 | 远程同步 PR #（合并后由门禁推导）

## 现场发现的更大问题（不在本批修，登记 + 已开工单）

`grep -rla "ops-center/frontend" .github/workflows/*.yml` 命中 **0 个文件**，而 `ops-center/frontend/package.json` 明确有 `build: vite build` 与 `test: vitest run`，AGENTS 也把它写成「build 门禁：npm run build」。也就是说：**运营中心前端的构建与测试在 CI 上完全没有覆盖** —— 模板编译错误、依赖漂移、该应用自身的单测，全都不会让任何 PR 变红。本批之所以只能退而用 `@vue/compiler-sfc` 手工解析，就是这个缺口的直接后果。

补它属"改谁来守门"，且有两个必须先定的口径（不是 agent 能自行拍的）：落点（新增 job 还是并入既有 ops-center 作业）与包管理器（该目录是**独立依赖、不在 pnpm workspace 内**，`npm ci` 与仓库 pnpm 唯一制相冲）；以及时长预算与是否进 required 清单。判据写死在这里，供下一个会话接手时直接验收：**接进 CI 后必须让一个故意的模板错误在 PR 上变红（反证）**，否则又是一条装饰性门禁。本记录不引用会话内任务号（那对未来读者不可按），后续项以这一段为准。

## 刻意没做的事

- **没有**把 `rendererIpcDirect` / `appleAlias` 扩到 ops-center（理由见规格表；`src/api` 白名单与 `tokens.css` 都是桌面端资产）。
- **没有**把 `check-color-literals` / `check-css-var-defined` 两个模式扩到 ops-center：它有自己的样式真源，扩域需要先确定 ops 的令牌表，属另一批。
- **没有**动 `.github/workflows/`（本批的判据早已接在既有步骤里，见 quality-gate.yml 的 `node .github/scripts/check-frontend-consistency.js`），也**没有**动 `CI_IGNORED_PATHS` 与分支保护。
- **没有**顺手改 ops-center 其它视图（`apiErrorMessage` 缺失的错误出口可能还有，但那是独立审计项，不在"让门禁能守住"这条链上）。
