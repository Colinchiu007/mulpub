# 任务：快捷采集·内置词条按用户真实需求重排（quick-collect-preset-refresh）

## T1. 词条重排（先测试后实现）

- [ ] T1.1 `quick-collect-presets.test.js`：id 闭集改为新 6 条；新增「两个被移除 id 不再存在」负向断言；
  新增「只有 `builtin-ai-trends` 是 `provenance:'user'`」来源锁；新增两个新词条的源闭集与专属源断言（先红）
- [ ] T1.2 `quick-collect-presets.js`：删 `builtin-platform-policy` / `builtin-risk-alert`，
  增 `builtin-ai-papers`（arxiv + hf + qbitai + 英文社区，168h）/ `builtin-ai-howto`
  （sspai + oschina + infoq_cn + 英文社区，168h）；6 条全部加 `provenance`；头部口径注释说明该字段来由
- [ ] T1.3 `quick-collect-cn-sources.test.js`：闭集子集断言不再引用已移除词条
- [ ] T1.4 `QuickCollectPanel.test.js`：夹具与 `data-testid` 随词条改名（全局替换，勿漏第三处）
- [ ] T1.5 跑特性域全量（14 文件）确认 GREEN，并确认渲染端无旧 id 残留

## T2. 门禁与证据

- [ ] T2.1 变异反证 3 条：① 把 `builtin-ai-trends.provenance` 改成 `'agent'` ⇒ 来源锁红；
  ② 把 `builtin-ai-papers` 的源改成闭集外的 id ⇒ 闭集断言红；
  ③ 把 AI 领域动向提示词改一个字 ⇒ AC-10 逐字断言红（证明旧锁仍有效）
- [ ] T2.2 静态门禁：`check-max-lines` / `check-locale-sync` 三档 / `check-ipc-bridge` / `check-frontend-consistency` /
  `check-no-brand-residue` / ESLint error 级
- [ ] T2.3 QM-1：`node scripts/verify-worktree-deps.js` + `pnpm run build:dir` rc=0 + asar 内词条清单核对
- [ ] T2.4 QM-4：仅改主进程产品内容与文案来源提示（无 UI 结构变化）⇒ 以 PR 的 `QG Visual` 为准

## T3. 文档与记录

- [ ] T3.1 `01-docs/PRD-QUICK-COLLECT-2026-10-11.md`：场景 2 换成 AI/新技术向；F-2 写清"只有一条是用户给定"；
  新增本次调整说明（含 provenance 机制）
- [ ] T3.2 `openspec/changes/quick-collect/specs/quick-collect/spec.md`：内置目录 Requirement 的 id 清单更新 +
  新增 `provenance` Requirement（含 Scenario）
- [ ] T3.3 `openspec/changes/quick-collect/proposal.md`：6 条词条清单更新 + 来源标注
- [ ] T3.4 `01-docs/PRD-QUICK-COLLECT-CN-SOURCES-2026-10-11.md`：§4.3 标注 S3 目标随词条替换作废（保留证据表）；
  §13 词条表更新；§15 未闭合项同步
- [ ] T3.5 `openspec/changes/quick-collect-cn-sources/tasks.md`：S3 段标注作废理由与替代去向
- [ ] T3.6 `CHANGELOG.md` 顶部条目 + `openspec/records/quick-collect-preset-refresh.md` 执行记录
- [ ] T3.7 `.quality-gates.md` 记录（含 `| 远程同步 | PENDING |`）+ `scripts/gate-record-debt-ledger.json` 登记

## T4. 收尾

- [ ] T4.1 PR：推送 → `gh pr create` → CI 全绿 → `--squash --delete-branch`（判据取产物）
- [ ] T4.2 回填 PR 合并 + worktree 按 R1-R5 清理
- [ ] T4.3 记忆沉淀：`01-docs/learnings.md` 新章节（需求与推演必须机械可分）+ gstack `learnings.jsonl` + EverOS flush
