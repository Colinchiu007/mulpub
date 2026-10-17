---
record: collected-results-fix
task: 三合一：①引导文案按钮名与 locale 机械同步锁（闭 PRD §4.3.5-3 遗留）②「改写失败用原文」可诊断化（后端吞错 → 带出原因）③结果区「编辑/点内容没反应」（滚动反馈 + 假可点光标）
date: 2026-10-17
branch: collected-results-fix
sync_status: PENDING
sync_reason: PR 尚未合并（记录随代码 PR 落地，合并后回填 merge SHA）
sync_backfill_owner: collected-results-fix 会话（回填 PR）
---

# 执行记录：collected-results-fix（2026-10-17）

## 0. 变更类型与隔离

| 项 | 内容 |
|---|---|
| 变更类型 | 运行时代码（electron IPC + renderer）+ 新判据脚本 + CI 接线 + 文档 |
| 隔离方式 | 独立 worktree `<仓库父目录>\mp-worktrees\<任务名>`，裸分支 `collected-results-fix`，基线 `origin/main` = `e379b2a73` |
| 动因 | 用户真机走查三连报：①上轮遗留「按钮名与 locale 无机械校验」②「改写失败用原文」看不出为什么 ③结果区「编辑/点内容没反应」 |

## 1. 门禁结果

| 门禁 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 独立 worktree，基线 `e379b2a73` |
| TDD | PASS | 后端先 RED(2 failed)→GREEN(24/24)；collection 全集 **16 文件 / 293 用例**全绿（含新增 8 条锁）；新判据自测 **6/6** |
| QM-1 打包 + 启动三层判据 | PASS | 改了 `electron/ipc-handlers/zhihu-favlist.js` ⇒ 必跑：`build:dir` rc=0 + 8s 存活 + stderr 0 字节（层③）；`buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE` 并出声告警 |
| QM-2 代码必检项 | PASS | 无同步 CPU 原语/新全局注册/新 IPC 参数；`rewriteError` 是纯字符串透传（≤200 字符截断） |
| i18n 成对与使用性 | PASS | `--keys` / `--pair-base origin/main` / `--cjk` 三项 PASS；本轮**未新增**用户可见文案 key（原因摘要来自后端数据，非 locale） |
| QM-4 视觉回归 | PASS（盲区同前） | `collection` 像素 PASSED、未刷新基线；详情框出现后的形态不在基线序列（已登记遗留） |
| **新判据**：引导文案按钮名同步锁 | PASS | `node scripts/check-locale-button-name-sync.js` 对真实仓库 PASS；自测 6/6；**接进 changes job**（不被 docs-only 短路）+ 判据自身测试同进 changes job；`check-unwired-tests` 30/30 |
| eslint（`apps/desktop` 内） | PASS | rc=0 |
| 行尾两口径对账 | PASS | 见提交前读数（`--head=HEAD` 判据**在 commit 之后**取证——上轮踩过的坑本轮未再踩） |
| QM-6 双模型评审 | 见第 4 节 | 按 decider 判定 |
| 文档同步 | PASS | PRD §4.3.5-3 改判已闭环 + 新增 §4.3.6；新增 BUGFIX 文档（根因/逃逸/修复/回归锁/遗留）；本记录 |
| 远程同步 | PENDING | PR 未开。合并后同一次提交改写为 `PASS` + merge SHA 并删除 `sync_*` 三字段 |

- 保留门禁：变更类型与隔离 ✅ | TDD ✅ | QM-1 ✅ | QM-2 ✅ | i18n ✅ | QM-4 ✅ | 新判据 ✅ | eslint ✅ | 文档同步 ✅ | 行尾对账 ✅ | 远程同步 PENDING

## 2. 三个修复的要点（详见 BUGFIX 文档）

1. **改写失败可诊断**：`rewriteOne` 失败改返 `{ error }`（异常摘要 ≤200 字符 / 空结果明确说明）；调用方删 `catch {}`，原因落 `item.rewriteError` + `log.warn` + done 事件；进度行追加「：原因」，结果徽标内联 + `title` 悬停。**回答用户的疑问：出现「改写失败用原文」= 该条采集成功、仅自动改写失败并按 D2 合同回退原文；现在会同时显示为什么。**
2. **「编辑/点内容没反应」**：根因是**状态变了但视口没动**（详情框在页面上方）。修法：`selectCollectedItem` 选中 + `scrollIntoView` + 一次性高亮；`@select` 从裸赋值改为走该函数（结构锁防回退）。
3. **假可点光标**：`card-info`/`card-icon` 绑定 `select` + 显式 `cursor:pointer` + hover 变色——看着能点就真能点。
4. **按钮名同步锁**：显式登记表判据 `check-locale-button-name-sync.js`（非启发式，本仓有启发式引入 5 假阳的前科）；接进 changes job；当前登记 2 条（`stepHintNoFavlists`→loadBtn；`stepHintNeedContents`→loadContents+collectAndRewrite，en 侧按语言覆盖只核 loadContents——en 文案里 "collected & rewritten" 是普通短语不是按钮名引用）。**落地时判据先抓到了我自己的登记错误**（登记了文案里不存在的第 2 个引用）——判据有效性的即时反证。

## 3. 实操缺陷（发生在自己身上，留痕）

- **测试 fixture 三次不完整**：新判据的临时 locale fixture 先后缺 `collectAndRewrite` key、缺第二个「」引用段、findings key 用短名断言——三次都被判据/断言当场拦住。教训：**fixture 必须与真实文案结构同形**，写 fixture 时先看真实文件。
- **`w.vm.collectedResultBox = box` 对 script-setup ref 无效**（静默不生效）⇒ 改用 `document.getElementById` 锚（采集页单实例 + jsdom 可桩）。
- **`toBe` 撞 reactive proxy**（"serializes to the same string"）⇒ 换 `toStrictEqual`。
- **jsdom 路径**：`new URL(file).pathname` 在该环境返回非 file 协议 ⇒ 用 `join(process.cwd(), …)`。

## 4. QM-6 判定

以 `ccg-review-decider` 实际读数为准（本记录提交时落盘）。要点：改动跨 electron + renderer + 新判据 + CI 接线，属跨层变更；若判 DUAL，评审焦点是「`rewriteError` 是否会把敏感信息（如 URL/内部路径）透传给 UI」——答复：摘要取自异常 `message`，与现有 `zhihuFavlistError` 的暴露面同级，且经 200 字符截断；`log.warn` 走既有 logger 通道。

## 5. 未闭合（不假装闭合）

1. **用户这次遇到的具体失败原因未知**：本次修的是「看不到原因」。请修复生效后重跑一次「采集并改写」看进度行的新摘要；若是 `ECONNREFUSED` ⇒ python-backend 没起，启动它即可。
2. **滚动/高亮的真机观感**未验证（jsdom 只断言调用与类名）。
3. **可供性判据化**（可点样式必须绑事件等）未做。
4. **像素门禁**对详情框出现后的形态无基线。
