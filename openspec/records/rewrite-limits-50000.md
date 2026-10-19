---
record: rewrite-limits-50000
task: 改写引擎输入/输出字数上限放开到 50000；输出截断从静默砍尾改为可见（outputTruncated/outputLength + 结果卡横幅）；主进程 max_tokens=64000 透传；上限单一真源结构锁 ×2
date: 2026-10-19
---

## 本次执行记录：字数上限 50000 + 输出截断可见化（rewrite-limits-50000，2026-10-19）

> 本文件为执行记录（唯一强制载体）。状态列不手写远程同步状态词：合并后由 `scripts/lib/merge-ledger.js` 推导。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 隔离 worktree `mp-worktrees/mp-rewrite-limits-50000` + 裸分支 `rewrite-limits-50000`（入口 `start-mp-task.ps1`，基于 origin/main `74a0f5d93`）；依赖三件套 `pnpm install --frozen-lockfile` + `ensure-electron` + `verify-worktree-deps` 全绿 |
| 第一性原因（QM-5 ①） | ✅ | 输入 6000 上限是 2026-09-12 按旧模型上下文定的（PRD-REWRITE-WORD-COUNT-CONTROL），与 128K+ 现代模型能力脱节；输出侧 `_postProcess` 砍尾从引擎诞生起就是静默行为（返回 string，无截断事实） |
| 逃逸分析（QM-5 ②） | ✅ | 静默截断逃逸：引擎测试只断言「截断后的长度」（W5-W7），从未断言「用户是否被告知」；UI 层无任何截断展示位。输入上限逃逸：#3979 用截断缓解但未质疑 6000 本身 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 引擎 L1/L2/L3 + W3/W8 重写（50001 TOO_LONG + 6001 走通正控）；渲染层结构锁 ×2（输入/输出常量与引擎源码比对，判据消费常量）；横幅出现/缺省两态；越界 50001 校验文案；自适应 12000→14400 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① learnings 顶部 4 条（三层上限语义 / 静默截断缺陷类别 / max_tokens 转移瓶颈 / 自适应默认值同帧更新）；② PRD 全量文档；③ CHANGELOG；④ 本记录 |
| 行尾与 diff 对账 | ✅ | 提交后取证（见自测块） |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → OK（提交后取证） |
| QM-1 打包 | ✅ | `pnpm run build:vue` rc=0；`electron-builder --win --dir` rc=0；asar 实测含 `MAX_INPUT_CHARS = 50000` / `MAX_OUTPUT_CHARS = 50000` / `outputTruncated` |
| QM-2 代码必检项 | ✅ | 无同步阻塞原语、无新增 IPC、无 v-html、无硬编码等待；上限数字全链路零写死（渲染层常量 + 结构锁）；横幅 CSS 复用既有设计变量 |
| QM-4 视觉回归 | N/A（有据） | 新增横幅为条件渲染（仅截断时出现），默认视图无新元素；样式独立 class 不触碰既有选择器 |
| QM-6 CCG 双模型外部评审 | 由 pre-commit CCG 判定 | 见提交后判定记录（本刀含 electron 主进程 1 文件 3 行改动 + 渲染层 + 引擎包，预期 DUAL；按降级口径闭环） |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

## 设计决策（输出上限「尽量大」的分析结论）

| 层 | 改后值 | 为什么 |
|---|---|---|
| 输入 MAX_INPUT_CHARS | 50000 | 现代模型 128K+ 上下文；50000 字 ≈ 75K tokens，成本/质量可控；>50000 走分段改写（独立 PRD） |
| 输出 MAX_OUTPUT_CHARS（显式区间） | 50000 | 用户显式要求大输出时应被尊重；实际可达性受 provider max output tokens 约束（模型侧截断，引擎检测不到，遗留 §10） |
| 无意图兜底 DEFAULT_MAX_OUTPUT_LENGTH | 3000 不变 | 用户没给任何字数意图时的保守兜底，防失控 |
| 策略 postProcess.maxLength | 800-3000 不变 | 平台形态语义（抖音口播 800 等）；用户显式区间优先级高于它 |
| 桥接 max_tokens | 64000 | CJK 1 字≈1-1.6 token × 倍余量；Anthropic 必填字段（原 4096）同步受益 |

## 自测块（提交前当场跑）

```
cd packages/rewrite-engine && pnpm exec vitest run
→ Test Files 14 passed / Tests 219 passed（含新增 L1/L2/L3）

cd apps/desktop && pnpm exec vitest run \
  src/utils/rewrite-engine-limits.test.js src/utils/rewrite-defaults.test.js \
  src/utils/rewrite-engine-error.test.js src/utils/user-facing-error.test.js
→ 10 + 19 + 8 + 32 = 69 passed

cd apps/desktop && pnpm exec vitest run src/views/Collection.rewrite-input-limit.test.js src/views/RewriteView.test.js
→ 6 + 100 passed

cd apps/desktop && pnpm exec vitest run src/views/Collection.test.js src/utils/rewrite-lineage.test.js
→ 125 passed

eslint（10 个改动文件 + electron/services/rewrite-engine.js）→ exit 0
pnpm run build:vue → rc=0；electron-builder --dir → rc=0
asar 实测：MAX_INPUT_CHARS=50000 ✓ MAX_OUTPUT_CHARS=50000 ✓ outputTruncated ✓
```

## 遗留（不假装已闭合）

- >50000 长文的分段改写方案（成本 ×N、前后文一致性）需独立 PRD。
- provider 侧 max output tokens 小于引擎上限时，模型侧截断引擎检测不到；后续可消费 `finish_reason: 'length'`。
- Python 聚合链路字数上限独立于 JS 引擎，本刀未动。
