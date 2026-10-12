---
record: converge-article-body-helpers
task: 正文形态 helpers 收敛到引擎单一实现（desktop 两份宽判据实现委托 content-formatter，修复代码片段误伤）
date: 2026-10-12
---

## 本次执行记录：正文形态 helpers 收敛到引擎单一实现（converge-article-body-helpers，2026-10-12）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 重构 + 真实缺陷修复；worktree `D:\Data\projects\mp-worktrees\mp-converge-article-body-helpers`（D 盘）、裸分支、基线 `origin/main = e11774988`；`verify-worktree-deps.js` OK |
| 需求边界 | ✅ | 只收敛 `apps/desktop/electron/**` 两份实现为**委托**（导出名/签名不变、调用点零改动）；`packages/rpa-engine` 零依赖约束不动（第三份登记为已知）；非目标：不加新平台、不改引擎语义 |
| 修复的真实缺陷 | ✅ | 宽判据（`<` 后跟字母）把 `#include <stdio.h>` 误判成标签：`stripHtmlToPlainText` 整段吃掉（影响快手等无标题平台描述）、`hasHtmlTags` 误判成 HTML 使代码尖括号被编辑器吞（影响公众号注入）。正/反双向用例锁死 |
| TDD | ✅ | 先加 2 条红用例（`hasHtmlTags('代码 #include <stdio.h> 结尾')===false` 修复前红；完整 HTML 文档反转委托语义），实现后绿 |
| 回归 | ✅ | wechat-mp-article **28/28**、rpa-view-platforms **83/83**、rpa-view-helpers + publisher-router **70/70**、引擎全量 `run-tests.js` rc=0（39 文件，direct + vitest） |
| QM-1 打包 | ✅（含一处如实缺口） | `electron-builder --win --dir --publish never` rc=0（第二次含渲染层 vite build 产物）；asar 清单含 3 个关键文件；**从打包产物 require 验证**（`ELECTRON_RUN_AS_NODE` + asar extract）：引擎导出、desktop 委托（`'<p>甲</p><p>乙</p>'→'甲\n乙'`、代码片段逐字保留）、wechat 白名单语义全部生效。⚠「启动 8 秒存活」本机不可判：用户实例持单实例锁令打包实例 exit 0 / stderr 0 行（与 main 记录先例 `.quality-gates.md` L18 同因）⇒ 以 require 链验证作替代证据，如实登记 |
| CCG verify-security | PASS（存量误报，文档化豁免） | 门禁对触及的 `wechat-mp-article.js:120` 报 1 条 XSS 高危（`tmp.innerHTML`，JSAPI 注入通道的净化临时容器，语句内已移除 script/iframe/object/embed 与 on* 属性）。取证：对 `git show origin/main:<file>`（本 PR 未触碰该行）实跑同一扫描器得**同位置同一条**告警 ⇒ 存量、非本次引入。按先例（`.quality-gates.md` L669/L10581 同类登记）`SKIP_CCG_GATE=1` 文档化豁免（未用 `--no-verify`） |
| 静态门禁 | ✅ | ESLint `pnpm run lint` 0 error；check-max-lines 全绿（无新增超大文件）；locale-sync `--keys` 1927 key 全存在（未动 locales）；text-encoding 无新增损坏；brand residue PASS |
| QM-6 评审 | N/A | 纯收敛重构，行为差量=两个白名单判据修复（已有正/反双向用例 + 打包产物级验证），且沿用 #3389 同一判据层的评审结论；如实登记，不冒充评审通过 |
| 远程同步 | PASS | 已合并：PR #3416，merge `a0ba23dc5387e6d5b18041fcd7e173e55384a705`（2026-10-12T08:09:12Z，squash）。取证：`git log origin/main --grep='(#3416)$' --format=%H|%cI` 唯一命中；`git ls-remote --heads origin converge-article-body-helpers` 返回 **0 行**；上方 `sync_*` 三字段与 ledger 登记项已在本回填提交同次删除 |

### 遗留（不假装已闭合）

- `packages/rpa-engine/src/toutiao-direct-bridge.js:33` 的内联 `<p>` 拼接是**第三份实现**（rpa-engine 零依赖约束，不能 require api-publish-engine）；其单换行/空行都成段的语义与引擎一致，但缺 CRLF 归一与代码尖括号保护。收敛需在 rpa-engine 建立契约镜像测试或把判据下沉到 shared-utils，另立 PR。
- 启动 8 秒验证的替代证据（require 链）覆盖模块加载与委托语义，不覆盖窗口创建后的运行时行为；待单实例锁空窗时补真机启动验证。
