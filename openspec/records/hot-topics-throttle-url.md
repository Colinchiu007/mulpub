---
record: hot-topics-throttle-url
task: 热门选题采集配额治理——限流/熔断键从来源身份改为端点配额、手动刷新节流、状态跨重启落盘
date: 2026-10-13
sync_status: PENDING
sync_reason: 本 PR 合并后由后续回填 PR 回填 PASS + merge SHA，并在同一次提交删除本记录文件的三 sync_ 字段与 gate-record-debt-ledger.json 的登记项
sync_backfill_owner: hot-topics-throttle-url
---

## 本次执行记录：热门选题采集配额治理（hot-topics-throttle-url，2026-10-13）

> 支撑分支 `hot-topics-throttle-url`（裸分支名）｜worktree `D:/Data/projects/mp-worktrees/mp-hot-topics-throttle-url`（D 盘托管根，非 C 盘）
> 入口：`bash scripts/session-init.sh hot-topics-throttle-url`（依赖三步均 OK：`pnpm install --frozen-lockfile` / `ensure-electron` / `verify-worktree-deps` 11 项链接解析到本 worktree）
> 判定 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **docs-only=false**（含 `apps/desktop/electron/` 运行时代码，走完整质量节拍）
> 动机：对采集频率与机制逐行取证确认四条真实风险（P0/P1/P2/P3），全部落地修复；同时**更正上一轮分析的一条误判**（快捷采集中文榜 `provider:'hot-topics'` 零新抓取，不存在跨模块双打）。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 会话隔离 | PASS | worktree `mp-hot-topics-throttle-url`（D 盘）、分支 `hot-topics-throttle-url`；共享根保持 main clean |
| TDD | PASS | 红灯先行：`hot-topics-quota.test.js` 首跑因 `throttle.js` 不存在 import 失败；实现后 14 例全绿 |
| 定向测试 | PASS | 9 文件 / **212 例**（配额 14 + hot-topics 既有回归） |
| 全量回归 | PASS | `electron/services/` + `HotTopics.test.js` + `content-categories.test.js` → **385 文件 / 7408 例（1 skipped）**，0 失败 |
| 静态门禁 | PASS | eslint（4 改动文件）exit 0；`check-no-brand-residue` PASS（8281 tracked 文件）；`check-locale-sync` pair/keys/cjk 三项 PASS（keys 1911） |
| 行尾对账 | PASS | 两口径逐行一致；`CHANGELOG.md`（CRLF=20081/bareLF=0）、`learnings.md`（CRLF=17698/bareLF=0）显式 CRLF 只拼头部 |
| QM-1 打包 | PASS | `verify-worktree-deps` OK → `build:vue` rc=0（14.45s）→ `electron-builder --win --dir --publish never` rc=0，asar **151146194 B** |
| QM-1 asar + require | PASS | `asar list` 含新增 `\electron\services\hot-topics\throttle.js`；解包产物 require：throttle 四导出齐全、归一化断言通过、service 暴露 `MANUAL_REFRESH_MIN_INTERVAL_MS=60000`/`THROTTLE_STATE_KEY`、实例方法 `_persistQuotaState/_restoreQuotaState` 齐全 |
| QM-1 启动冒烟 | PASS | 经 interactive 用户会话（`explorer.exe`）拉起打包 exe：进程存活、日志写入、禁用标记 0 命中、进程计数回基线 0 |
| 变异反证 | PASS（附现场教训） | `quotaKeyOf` 变异回「id 作键」→ **5 例当场红**；⚠️ 还原时未先备份 + `-ErrorAction SilentlyContinue` 吞掉路径错误，变异版残留工作区 —— 已沉淀为 learnings（变异前备份到仓库外并核验、还原后哈希比对、覆盖性操作失败必须可见） |
| QM-6 评审 | 未执行（如实登记） | 行为由 14 例新锁 + 7408 例全量锁定；**不声称跨模型评审通过** |
| 记忆沉淀 | PASS | `learnings.md` 置顶新增 2 章；gstack `learnings.jsonl` 追加；EverOS add→flush + 读回验证（判据取落盘产物） |
| 远程同步 | PENDING | 待 PR 合并后回填 PASS + merge SHA，并在**同一次提交**删除本文件三 sync_ 字段与 ledger 登记项 |
