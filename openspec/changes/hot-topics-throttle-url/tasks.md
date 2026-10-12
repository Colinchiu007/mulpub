# 任务清单：hot-topics-throttle-url

> 勾选判据取**产物**（命令输出/测试结果/合并取证），不取「做过了」的叙述。

## 1. 风险取证（前置）

- [x] 1.1 逐行取证四条风险（P0 同 URL 多身份、P1 force 无上限、P2 同端点跨模块、P3 内存态）
- [x] 1.2 **更正**上轮分析误判：快捷采集中文榜 `provider:'hot-topics'` 零新抓取，无跨模块双打；真实重叠仅 `ithome` feed 源共用 RSS

## 2. TDD 实现

- [x] 2.1 红灯：`hot-topics-quota.test.js` 14 例（throttle.js 不存在 → import 失败红）
- [x] 2.2 新增 `hot-topics/throttle.js`：`throttleKey` / `quotaKeyOf`（唯一真源）/ 可持久化 Throttle 与 Breaker（restore fail-closed）
- [x] 2.3 P0：`_collectChannel` / `_collectBoostChannel` 限流与熔断键 → `quotaKeyOf`；跳过带 `reason:'throttled-by-url'`
- [x] 2.4 P1：`MANUAL_REFRESH_MIN_INTERVAL_MS=60s`；force 间隔内返回缓存 + `throttled:true`；`boostCategories` 豁免
- [x] 2.5 P2：`ithome-tech`/`ithome-ai` 显式 `throttleKey:'ithome-rss'` 共享配额
- [x] 2.6 P3：`hot_topics_throttle_state` 落盘/恢复；恢复失败只清空
- [x] 2.7 绿灯：配额测试 14 例 + 既有回归全绿（hot-topics 9 文件 212 例 → 收口后 146+66）

## 3. 变异反证（防假绿）

- [x] 3.1 把 `quotaKeyOf` 变异回「id 作键」→ **5 例当场红**（A1/A3/补拉/配置一致性/共享键）
- [x] 3.2 变异后按内容还原并复跑确认全绿
- [x] 3.3 **现场教训**：变异还原时因未先做文件备份导致覆盖后无法精确恢复（靠掌握的实现内容重写）；后续变异必须先备份

## 4. 文档

- [x] 4.1 PRD `01-docs/PRD-HOT-TOPICS-QUOTA-GOVERNANCE-2026-10-13.md`（背景/方案/数据校验/流程/交互/显示项/提示文字/验收/风险/不做）
- [x] 4.2 openspec change 五件套（proposal/design/tasks/spec delta/.openspec.yaml）
- [ ] 4.3 `CHANGELOG.md` 顶部条目
- [ ] 4.4 `01-docs/learnings.md` 新章节（含 3.3 的变异还原教训）

## 5. 质量节拍与验证

- [x] 5.1 定向测试全绿（9 文件 / 212 例）
- [ ] 5.2 全量回归（electron/services + 关键渲染层）0 失败
- [ ] 5.3 eslint 改动文件 exit 0
- [ ] 5.4 `check-locale-sync`（本轮未动 locales，仍需跑）+ `check-no-brand-residue`
- [ ] 5.5 QM-1 打包（改了 `electron/services/`，强制项）+ asar/require 链
- [ ] 5.6 `.quality-gates.md` 记录 + ledger 登记

## 6. 记忆沉淀

- [ ] 6.1 `learnings.md`（配额键单一真源 / fail-closed 方向 / 变异还原纪律）
- [ ] 6.2 gstack `learnings.jsonl`
- [ ] 6.3 EverOS add→flush + 读回验证

## 7. 交付

- [ ] 7.1 提交 + 推送
- [ ] 7.2 PR + CI 全绿后 squash 合并
- [ ] 7.3 回填远程同步 + 销账
- [ ] 7.4 worktree 按 R1–R5 清理
