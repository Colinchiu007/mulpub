# 版本管理规范（Version Management）

> 生效日期：2026-09-14
> 适用范围：整个 Multi-Publish 单体仓库（monorepo）只产出**一个**桌面端安装包，因此全仓使用**单一产品版本号**。

## 1. 核心原则

1. **单一真相源（Single Source of Truth）**：版本号只定义在根 `package.json` 的 `version` 字段。
   `apps/desktop/package.json` 的 `version` 由脚本**自动派生**，禁止手写、禁止独立演进。
2. **自动同步**：任何提交/构建前，`scripts/sync-version.mjs` 把根版本写入 `apps/desktop/package.json`，两处永不一致。
3. **明确的 bump 触发点**：版本号只在 PR 合并到 main（或发布）时按本规范手动 bump，只改根 `package.json`。
4. **CHANGELOG 纪律**：日常累积用 `## [未发布]`；发版时把这批条目收口为一个 `## [vX.Y.Z] - 日期` 段落。**复盘轮次不再单独标版本号**（复盘是过程，不是版本）。

## 2. 版本格式

标准语义化版本 `MAJOR.MINOR.PATCH`：

- 当前开发阶段整体控制在 **1.0.0 以下**（`0.Y.Z`）。
- `0.x` 阶段语义（遵循 SemVer 官方约定）：`0.x` 本身即表示「不稳定、允许破坏性变更」。

## 3. 改动规模 ↔ 版本级别

| 级别 | 触发条件 | 示例 |
|------|----------|------|
| **MAJOR** | 破坏既有用户数据/配置兼容；移除已发布的 IPC/API 契约；改动 `envelope` 结构 | 改 `data` 字段契约、删 IPC 接口、换配置存储格式 |
| **MINOR** | 新增可见模块/能力、新增用户可感知功能、新增（向后兼容的）IPC 接口 | 热门选题一键视频、爆款库、骨架屏体系 |
| **PATCH** | Bug 修复、无外部行为变化的重构、文案/样式微调、依赖升级无 API 变化 | 登录态误判、露缝修复、lint 清零 |
| **不 bump** | 纯文档 / 测试 / CHANGELOG | — |

**0.x 阶段的特殊约定**：即使发生「破坏性变更」，也只涨 **MINOR** 的 `Y`（不涨 MAJOR）。因为 `0.x` 本就承诺可 breaking。
待第一个对外承诺兼容的公开发布时，才升到 **1.0.0**；之后破坏性变更才涨 MAJOR。

## 4. 日常操作

```bash
# 只改根 package.json，并按规则 bump（0.x 基线：修复 patch / 功能与破坏性 minor）
pnpm version:bump patch     # 0.1.0 -> 0.1.1（修复级）
pnpm version:bump minor     # 0.1.0 -> 0.2.0（功能级；0.x 下破坏性变更也走这里）
pnpm version:bump major     # 0.x 下降级为 minor；仅当已 ≥1.0.0 时涨主版本

# 手动把 apps/desktop 对齐到根（提交/构建前 pre-commit 已自动做）
pnpm version:sync

# 发版前本地自检：CHANGELOG 是否收口 + root/desktop 是否一致
pnpm version:check

# 一键发版：bump → 门禁自检 → 提交版本变更 + CHANGELOG → 打 tag（不自动推送）
pnpm version:release minor
```

`version:bump` 会**同时**更新根与 `apps/desktop` 两处（一次性，避免漂移）；
`version:sync` 只把根版本复制到 `apps/desktop`（pre-commit 钩子自动调用）；
`version:check` 是 `release-gate` 的本地入口，`version:release` 是其一键封装。

## 5. 发布流程

1. 合并所有待发 PR 到 main。
2. 把 CHANGELOG 顶部这批 `## [未发布]` 收口为 `## [vX.Y.Z] - <日期>`。
3. 在 main 上 `pnpm version:bump <级别>`，提交版本变更（根 + apps/desktop）。
4. 打 tag：`git tag vX.Y.Z` 并推送；或 `pnpm version:release <级别>`（自动完成 2-4）。
5. CI（`build.yml`）先跑 `release-gate`：校验「根 version == tag」且「CHANGELOG 含该版本小节」，
   任一不满足即**阻断发布**；通过后才执行 `sync-version` 生成安装包。

> 开发阶段「发布前不需要出安装包」：不打 tag、不跑发布构建即可；版本号仅作为代码内标识（应用内 `getVersion()`、自动更新策略比对）。

## 6. 实现文件

- `scripts/sync-version.mjs` —— 根 → `apps/desktop` 版本同步（幂等、零依赖）。
- `scripts/bump-version.mjs` —— 按级别 bump 根版本并同步 desktop（0.x 下 major 降级为 minor）。
- `scripts/release-gate.mjs` —— **强制门禁**：校验「根 version == tag」「CHANGELOG 含目标版本小节」「root/desktop 一致」；对「破坏性变更却 patch 级」软警告。
- `scripts/release.mjs` —— `version:release` 一键封装（bump → 门禁自检 → 提交 + 打 tag，不自动推送）。
- `scripts/sync-version.test.mjs` / `scripts/release-gate.test.mjs` —— 零依赖单测（`node --test scripts/release-gate.test.mjs`）。
- `scripts/hooks/pre-commit` —— 提交前自动跑 `sync-version.mjs` 并对齐 `apps/desktop/package.json`。
- `.github/workflows/build.yml` —— tag 推送时先跑 `release-gate`，通过后才调用 `sync-version.mjs`。

## 7. 强制机制（为什么需要 release-gate）

版本号「没人逼你 bump」「没人校验级别」属于两个性质不同的问题：

- **没人逼你 bump → 可机械强制**：发布动作发生在「打 tag」这一刻。把校验放到 tag 边界——`release-gate` 要求「根 `package.json` 的 version 必须等于 tag 版本」且「CHANGELOG 已收口」，否则 CI 直接阻断。这样不打 `version:bump` 就打不了 tag，强制自然落地。
- **没人校验级别 → 本质是人类判断，不能硬阻断**：机器无法判定一次改动「是否破坏性」。可判定的范畴只剩「0.x 下破坏性变更不得是 patch」。做法：
  1. `bump-version` 在 0.x 下把 `major` 自动降级为 `minor`（破坏性变更因此不会落到主版本）；
  2. `release-gate` 对「CHANGELOG 含 `BREAKING CHANGE:` 标记但本次仅 patch 级」**软警告**（不阻断）；
  3. 最终由 Code Review（QM-2）的「版本级别 ↔ 改动规模匹配」清单项人工把关。

> 故意**不**对级别做硬阻断：会误伤正常 patch，且「破坏性」机器无法确认。
