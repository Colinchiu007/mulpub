# Proposal: dep-audit-new-advisories（收敛依赖漏洞审计门禁的 10 条 NEW_ADVISORY）

> **本提案由 PR #4341（hifly-voice-subtitle-parity）的合并阻塞派生。**
> 该 PR 自身已全绿，但 `依赖漏洞审计` 在 origin/main 上是红的，按 AGENTS「主干红着不许往里合」被卡住。
> **这不是 #4341 引入的**——它未动 `package.json` / `pnpm-lock.yaml`。

## Why

`node scripts/check-dep-audit.js` 在最新 origin/main 上 rc=1，报 **10 条 `NEW_ADVISORY`**。

门禁语义：一条公告**既没被升级修掉、也没在 `scripts/dep-audit-baseline.json` 里登记 decision** ⇒ 判「新公告」⇒ 红。

- workflow：`依赖漏洞审计门禁`（ID `364691268`）
- 判据：`scripts/check-dep-audit.js`（本地可复现，无需 CI）
- 基线现状：`advisories` 27 条，`reviewBy: 2026-12-31`

**这是主干级依赖腐化，不是某次改动的回归**：10 条全部指向本仓库长期未刷新的传递依赖，且其中 3 个包（undici / fast-uri / electron）只差一个 patch 版本。

## 阻塞影响（为什么必须现在处理）

| 影响面 | 说明 |
|---|---|
| **所有 PR 的 `Gate Result`** | `依赖漏洞审计` 是 required check，它红 ⇒ `Gate Result` 红 ⇒ **任何 PR 都无法合并**（`check-main-red.js` 判 rc=2 主干红） |
| **实测受害者** | PR #4341（数字人形象+声音捆绑克隆）代码侧已全部完成并通过其余 13 项门禁，仅因此条卡住 |
| **腐化趋势** | 基线 `reviewBy: 2026-12-31`，若不滚动更新，新公告会持续累积 |

## What Changes

### 待处理的 10 条公告（本地实测版本）

| # | GHSA | 包 | 严重度 | 需升级到 | 本地实测 | 影响路径 |
|---|---|---|---|---|---|---|
| 1 | `GHSA-27r3-jxmh-p828` | body-parser | **high** | >=2.4.0 | **1.20.5 / 2.3.0** | `.` \| `packages/ai-writer-api` |
| 2 | `GHSA-mrhx-c7xc-m3w5` | zod | **high** | >=4.6.6 | **4.3.6** | `.` \| `packages/remotion-composer` |
| 3 | `GHSA-jr5w-w6x2-84p9` | electron | **high** | >=43.8.1 | **43.7.7** | `.` \| `packages/rpa-engine` \| `packages/shared-utils` |
| 4 | `GHSA-xjj6-f33q-929c` | undici | **high** | >=7.30.1 | **7.30.0** | `.` \| `apps/desktop` \| `packages/rpa-engine` \| `packages/shared-utils` |
| 5 | `GHSA-4qv8-2p9j-2685` | undici | moderate | >=7.30.1 | 7.30.0 | 同上 |
| 6 | `GHSA-f72v-6w45-q472` | undici | moderate | >=7.30.1 | 7.30.0 | 同上 |
| 7 | `GHSA-w74x-v6f9-j3xg` | fast-uri | moderate | >=3.1.9 | **3.1.8** | `.` \| `packages/remotion-composer` |
| 8 | `GHSA-wjr9-j795-jxcr` | fast-uri | moderate | >=3.1.9 | 3.1.8 | 同上 |
| 9 | `GHSA-333x-w4r6-6crp` | fast-uri | low | >=3.1.9 | 3.1.8 | 同上 |
| 10 | `GHSA-xhq7-xmqj-769h` | fast-uri | low | >=3.1.9 | 3.1.8 | 同上 |

按包聚合：`fast-uri` ×4、`undici` ×3、`body-parser` ×1、`zod` ×1、`electron` ×1。

### 分级处置建议

#### A 级：直接升级（低风险，优先做）

| 包 | 动作 | 理由 |
|---|---|---|
| `fast-uri` 3.1.8 → 3.1.9 | 刷 lockfile 或 `pnpm.overrides` | 只差一个 patch；`packages/remotion-composer` 的传递依赖 |
| `undici` 7.30.0 → 7.30.1 | 刷 lockfile 或 `pnpm.overrides` | 只差一个 patch；影响 `.` / `apps/desktop` / `rpa-engine` / `shared-utils` 四处，但都是传递依赖 |

> 注意：这两个都是**传递依赖**（`package.json` 无直接声明），普通 `pnpm update` 可能不触及。
> 若刷不动，在根 `package.json` 加 `pnpm.overrides` 是最可靠的收敛手段，但**要先确认 override 不破坏
> 依赖方的 API 假设**（`fast-uri` 被 `@vue/compiler-core` 等构建期消费，`undici` 被 Electron 主进程消费）。

#### B 级：评估后升级（中风险）

| 包 | 动作 | 需先确认 |
|---|---|---|
| `body-parser` 2.3.0 → 2.4.0 | 升 minor | 2.x 的 breaking 变更；`packages/ai-writer-api` 是直接消费方 |
| `zod` 4.3.6 → 4.6.6 | 跨 3 个 minor | `packages/remotion-composer` 的 schema 用法；4.x 内部的 API 漂移 |

#### C 级：暂不升级，登记 `accepted-risk`（高风险，须写清 note）

| 包 | 为什么不能贸然 bump |
|---|---|
| `electron` 43.7.7 → 43.8.1 | AGENTS.md 明确写死 `electron@43.1.1`，且 QM-1 打包 / `scripts/ensure-electron.js` / `electron-ci.yml` 三处都按 43.x 假设运转。升级 electron 牵动：① 二进制下载与缓存 ② `electron-builder@25.1.8` 兼容性 ③ QM-1 启动烟测（`ELECTRON_RUN_AS_NODE` 剔除逻辑）④ CI shard 的 electron 版本矩阵。**这是独立任务，不应塞进消红 PR。** |

## 设计决策

### 决策 1：为什么不「全部登记 accepted-risk」了事

`scripts/dep-audit-baseline.json` 现有 27 条的 `note` 都写到「影响面 + 为什么暂不处理 + 何时处理」这个粒度，
反例可参 `source-map-js` 那条：

> *"纯构建期传递依赖：经 @vue/compiler-core@3.5.41 的 vue 构建链引入，ops-center/frontend/package.json 零声明、源码零引用，不进浏览器运行时产物。"*

如果把 10 条一股脑登记成 `accepted-risk` 而不做影响面分析，等于**用挂账机制掩盖真实腐化**——
基线的意义是「已知且有决策」，不是「免检符」。且 `zod` / `electron` 是 high  severity，
登记时若无真实分析，后续 review 无法判断该决策是否仍成立。

### 决策 2：为什么要分 A/B/C 三级而不是一次性全升

`electron` 与 `zod` 的升级面不在同一量级。混在一个 PR 里会导致：
① 出问题时分不清是哪个包引起的；
② QM-1 打包验证（`pnpm build:win`）一旦红，要回退整包；
③ 违反 AGENTS「选最简单的方案」——消红不等于把构建链一起换。

### 决策 3：`reviewBy` 是否要顺带滚动

建议**本次不动**。它是「挂账到期日」，滚动它属于改守门参数；
且当前 27 条存量挂账的到期决策应由负责依赖的会话统一做，不宜由消红 PR 夹带。

## Impact

### Affected Code

| 文件 | 改动 |
|---|---|
| `pnpm-lock.yaml` | A 级升级后刷新（若走 overrides 则不动） |
| `package.json`（根） | 仅在采用 `pnpm.overrides` 收敛 fast-uri / undici 时新增一段 |
| `packages/ai-writer-api/package.json` | B 级 body-parser 升级时 |
| `packages/remotion-composer/package.json` | B 级 zod 升级时 |
| `scripts/dep-audit-baseline.json` | C 级 electron 登记 1 条；A/B 级升级成功后由 `--update` 重算 |

### Affected Specs

- 无（本提案不新增/修改 capability 规格，属依赖治理）

### 验证口径

每一步后都必须复现判据，**不得只凭 CI**：

```bash
node scripts/check-dep-audit.js          # 期望：NEW_ADVISORY 逐条减少，最终 rc=0
node scripts/check-dep-audit.js --update # 仅在升级成功后重算基线
```

A/B 级升级后**额外必跑**（否则不算验证）：

```bash
pnpm install --frozen-lockfile
node scripts/ensure-electron.js
node scripts/verify-worktree-deps.js
cd apps/desktop && pnpm run build:win     # QM-1
```

C 级登记后需人工核对 `note` 是否满足「影响面 + 理由 + 复检条件」三要素。

## 交付顺序建议

1. **先 A 级**（fast-uri + undici）：预期一次消掉 7 条，风险最低，可立即解除大部分阻塞
2. **再 C 级**（electron 登记）：消掉最后 1 条 high，**此时主干即可转绿，PR #4341 能合**
3. **B 级单独排期**（body-parser + zod）：需评估 breaking，不与 1/2 混

> 按这个顺序，第 2 步完成时 `check-dep-audit.js` 就 rc=0，不必等 B 级。

## Open Questions（需负责依赖的会话确认）

1. `fast-uri` / `undici` 走 **lockfile 刷新**还是 **`pnpm.overrides`**？前者更干净，但传递依赖可能刷不动；后者可靠但是显式钉版本，后续升级要手动维护。
2. `zod` 4.3.6 → 4.6.6 是否已有其他会话在跟？（`packages/remotion-composer` 近期有无相关改动）
3. `electron` 登记 `accepted-risk` 时，`note` 里的「复检条件」写什么？（建议：`electron-builder` 或 `ensure-electron.js` 下一次改动时连带评估）
