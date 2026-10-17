---
record: fav-collect-ux
task: 知乎收藏批量三件：①主按钮文案「采集并改写」→「采集&改写」②去重跳过的进度行不再显示「完成」而显示跳过说明+指路强制重采（修「进度全完成但结果区 0 新增」的可归因性）③按钮名同步锁升级（区块限定 key，修同名 key 跨区块取错值的假绿）
date: 2026-10-17
branch: fav-collect-ux
---

# 执行记录：fav-collect-ux（2026-10-17）

## 0. 动因（用户实测）

1. 「采集与改写」按钮文字改成「采集&改写」。
2. 点按钮后进度明细显示全部「完成」，但**底部采集结果 0 新增**——「还是说采集改写结果存在别处了？」

## 1. 问题 2 的根因（代码级定位，不是猜测）

`zhihu-fav-batch:run` 的 C2 去重合同：已采集过的 URL（进程内记忆 ∪ 传入的 collectedUrls）**默认跳过**（`duplicate: true`），除非勾选「包含已采集（强制重采）」。

**用户那两条在上一轮已经采集成功过** ⇒ 本轮全部走 `duplicateSkipped` 分支 ⇒

- 后端行为**完全正确**（不重复采集是防反爬/防重复入库的既定设计）
- 进度明细也逐条打了「完成」——**缺陷在呈现**：duplicate 与正常完成共用 `doneNote`（「完成」），用户面对「2/2 全完成、结果区 0 新增」无法归因，只能怀疑「结果存哪去了」
- 汇总行虽有「跳过重复 N」，但折叠明细 + 逐条「完成」的形态把关键信息淹没了

**回答用户的疑问**：结果没有存在别处——这两条**上一轮就已经采过并在结果区里**（可按标题搜一下确认）；本轮因去重被跳过，所以 0 新增。想强制重采：勾选「包含已采集（强制重采）」再点按钮。

## 2. 修复

| 项 | 改动 |
|---|---|
| 按钮文案 | `collection.zhihuFav.collectAndRewrite`：`采集并改写` → `采集&改写`（en 本就是 `Collect & rewrite`，不动） |
| 去重进度行 | done 事件 `res.duplicate` 分支新增：显示 `duplicateNote`（zh：「已采集过，本次跳过（勾选「包含已采集」可强制重采）」），不再与「完成」混同 |
| 引导文案联动 | `stepHintNeedContents` 里引用的按钮名同步改「采集&改写」（**按钮名同步锁当场拦截了旧文案**，见 §4） |

**明确不改**：后端去重逻辑（C2 合同正确）；汇总行（已有「跳过重复 N」）；en 文案（本就 `&` 形态）。

## 3. 按钮名同步锁升级（本次最有价值的发现）

改按钮名的瞬间，同步锁**应当红但没红** —— 追查发现判据的 `extractValue` 用**裸 key**（`collectAndRewrite`）取值，而本仓 `zhihuFavlist` 与 `zhihuFav` 是**同级区块、内层同名 key 各一份**：

- `zhihuFavlist.collectAndRewrite` = `采集并改写`（旧区块，无 UI 消费者，未改）
- `zhihuFav.collectAndRewrite` = `采集&改写`（本次改的）

裸 key 恒匹配**第一个**（旧值）⇒ 引导文案引用旧名 vs 按钮现值旧值 ⇒ **永远 PASS 的假绿**。

**修法**：`extractValue` 支持**区块限定 key**（`zhihuFav.collectAndRewrite` → 定位 `zhihuFav: {` 之后再找叶子）；`checkOneLocale` 里 `text` 与 `refKey` 两处都改传完整 key。REGISTRY 同时修正归属错误（`loadBtn` 实际在 `zhihuFavlist` 区块）。

**修后**：对真实仓库立刻 RED（引导还引用旧名「采集并改写」）⇒ 同步改引导文案 ⇒ PASS。**这条锁从「装饰性门禁」变成了真门禁——假绿被真实改动当场揭穿。**

## 4. 门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 独立 worktree，基线 `origin/main`（含 #3840） |
| TDD | PASS | 先加 3 锁 ⇒ RED(30 tests / 3 failed)；实现 ⇒ **30/30**；collection 全集 **16 文件 / 296 用例**全绿 |
| 同步锁自测 | PASS | 6/6（fixture 随区块归属修正：loadBtn 移入 zhihuFavlist） |
| i18n 四项 | PASS | `--keys`（**2102**）/ `--pair-base` / `--cjk`（基线 1374/当前 1217）/ `check-locale-button-name-sync` 全 PASS |
| eslint | PASS | rc=0 |
| QM-1 | N/A | 未触 `electron/`（纯 renderer + locale + 判据脚本） |
| QM-4 | PASS（盲区同前） | 折叠组内文案，像素不覆盖 |
| 行尾两口径对账 | PASS | commit 后取证 |
| 文档同步 | PASS | PRD §4.3.6 登记表更新 + §4.3.7 新增（去重呈现）+ 本记录 |
| 远程同步 | PASS | PR **#3848** 已 squash 合并，merge SHA `b7c618d9c285ea6815cb9fde1390efc4cb083eef`；远端分支已删（ls-remote 0 行）。main push run `39041205223` 回读 **completed / success**。回填与销账同一次提交（本行 + bullet + 删 `sync_*` 三字段） |

- 保留门禁：变更类型与隔离 ✅ | TDD ✅ | 同步锁 ✅ | i18n ✅ | eslint ✅ | 文档同步 ✅ | 行尾对账 ✅ | 远程同步 PASS

## 5. QM-6 判定

以 decider 实际读数为准。改动核心是「呈现层文案 + 判据脚本健壮性」，风险面在判据（`extractValue` 区块限定逻辑）——已由 6 例自测 + 对真实仓库的双态验证（改前 RED / 改后 PASS）覆盖。

## 6. 未闭合（不假装闭合）

1. **无真机验证**：duplicate 进度行的实际观感、按钮新文案的渲染，需真机确认。
2. **汇总行增强未做**：`duplicateSkipped === total`（整批全被跳过）时可在汇总行追加一句更醒目的说明；本轮只修了逐条明细。
3. **`zhihuFavlist` 旧区块的 12 个未消费 key**（含旧 `collectAndRewrite`）仍在，属 zhihu-fav-entries-consolidate 的既有遗留，未扩大清理面。
