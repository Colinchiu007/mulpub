---
branch: avatar-heygen-wiring
title: 数字人（avatar-spokesperson）流水线真正接通 HeyGen
date: 2026-10-19
mode: full
---

# 执行记录：数字人流水线接通 HeyGen（avatar-heygen-wiring）

## 一、变更类型与隔离声明

| 项 | 值 |
|---|---|
| 变更类型 | 运行时代码变更（apps/desktop/electron + apps/desktop/src）+ 文档 |
| 隔离方式 | **独立 worktree**：`D:/Data/projects/mp-worktrees/mp-avatar-heygen-wiring` |
| 分支 | `avatar-heygen-wiring`（非共享根 main） |
| 是否 docs-only | 否（混合 PR，走完整质量节拍） |
| 落盘路径 | D 盘（符合「非 C 盘」要求） |

## 二、门禁执行结果

| 门禁 | 判据 | 结果 |
|---|---|---|
| 会话隔离 | worktree 已创建、分支非 main、依赖门禁 OK | ✅ |
| 依赖解析 | `node scripts/verify-worktree-deps.js` → OK（11 项） | ✅ |
| PRD | `01-docs/PRD-AVATAR-SPOKESPERSON-HEYGEN-WIRING-2026-10-19.md` | ✅ |
| TDD | 先写测试后实现；新增 5 个测试文件共 71 例 | ✅ |
| QM-1 打包 | `pnpm exec electron-builder --win --x64` | ✅（exit 0，见 §五） |
| QM-2 代码必检项 | 见 §四自查 | ✅ |
| locale 成对 | zh/en 均改 `locales/create/{zh,en}.js` | ✅ |
| IPC 契约 | 新 namespace `avatarCatalog` 已在 preload 注册 | ✅ |
| CI | `gh pr checks` 全绿（见 §六） | ✅ |

## 三、改动清单

### 主进程（apps/desktop/electron/）

| 文件 | 改动 |
|---|---|
| `services/adapters/heygen.js` | 新增 `listAvatars()`（`GET /v2/avatars`）、`listVoices()`（`GET /v2/voices`），带字段归一化 |
| `services/adapters/_base/base.js` | `KNOWN_METHODS` 增补 `'listAvatars'`（**关键**：不加则 `callAdapter` 闸门拦截，方法永不执行） |
| `services/avatar-catalog-service.js` | 新增：目录服务，5 分钟 TTL 缓存 + refresh 强制刷新 + invalidate |
| `services/videogen-stages.js` | 新增数字人分支：解析 heygen provider、三要素（character/voice/script）、独立生成路径；`avatar_select` 阶段补 `voiceId` |
| `services/pipeline-engine.js` | avatar-spokesperson 的 generate 阶段 `options.digitalHuman = true` |
| `services/pipeline-model-preflight.js` | 新增 `checkDigitalHumanRequirements()`：avatarId/voiceId/HeyGen 可用性三层校验 |
| `ipc-handlers/avatar-catalog.js` | 新增三个通道（avatars/voices/invalidate），含 isSafeIdentifier 校验 |
| `ipc-handlers/index.js` | 注册新 handler |
| `preload/avatar-catalog.js` | 新增 preload API（namespace `avatarCatalog`） |
| `preload/index.js` | 接入聚合 |

### 渲染层（apps/desktop/src/）

| 文件 | 改动 |
|---|---|
| `api/avatar-catalog.js` | 新增 renderer API（字面量直写，满足 ipc-exposure-contract） |
| `views/video-creation/composables/useAvatarCatalog.js` | 新增：目录加载，带 requestId 竞态守卫 |
| `views/CreateView.vue` | 数字人配置区模板 + `avatarId`/`avatarVoiceId` data + 启动参数下发 + 阻断原因 |
| `locales/create/zh.js`、`en.js` | 数字人文案 15 键成对新增 |

### 文档

| 文件 | 改动 |
|---|---|
| `01-docs/PRD-AVATAR-SPOKESPERSON-HEYGEN-WIRING-2026-10-19.md` | 新建，完整 PRD |
| `01-docs/user-manual.md` | 修正 `talking-head` 误标 + 新增数字人使用章节 |
| `01-docs/learnings.md` | 3 条 lesson（命名像≠接通、KNOWN_METHODS 闸门、能力表粒度） |
| `01-docs/i18n-glossary.md` | 数字人术语登记 + 与 TTS 音色的边界 |
| `CHANGELOG.md` | 追加变更条目 |

## 四、QM-2 自查

| 检查项 | 结论 |
|---|---|
| 高频路径同步阻塞原语 | 无新增；目录加载为异步 + 缓存 |
| 详情函数复用到列表 | 无此类复用 |
| UI 框架全量引入 | 未新增 element-plus 组件；数字人区块用原生 `<select>` |
| 首屏阻塞 IPC | 数字人目录仅在**选中该流水线时**加载，不在首屏路径 |
| require 路径 | 新增 3 个 require 均指向新增文件，已验证存在 |
| preload 改动 | 新增独立模块，未改既有 preload 行为；新增 IPC 需重启应用生效（已在 PR 说明） |
| IPC 参数序列化 | `loadAvatarCatalog` 传参为纯字面量对象 `{providerId, refresh}` |
| 硬编码密钥 | 无 |
| 日志污染 | 无 console.log，错误走 log.warn（含脱敏） |

## 五、QM-1 打包证据

```
cd apps/desktop && pnpm exec electron-builder --win --x64
→ exit code 0
```

（产物 `dist-electron/Multi-Publish.Setup.0.2.0.exe` + `win-unpacked/Multi-Publish.exe` 已生成）

## 六、测试与门禁读数

### 本次新增测试（8 个文件 123 例全绿）

| 文件 | 例数 | 覆盖 |
|---|---|---|
| `electron/services/avatar-catalog-service.test.js` | 19 | 缓存/refresh/TTL/入参校验/二层失败 |
| `electron/ipc-handlers/avatar-catalog.test.js` | 14 | 三通道 + fail-closed 校验 |
| `electron/preload/avatar-catalog.test.js` | 1 | 通道名对账 |
| `electron/services/adapters/heygen.test.js` | 26（+8） | listAvatars/listVoices 归一化 |
| `electron/services/videogen-stages.digital-human.test.js` | 19 | ★character/voice/script 透传 + 通用链路零回归 |
| `electron/tests/pipeline-model-preflight.digital-human.test.js` | 15 | 假阳性修复 |
| `src/views/CreateView.avatar-digital-human.test.js` | 9 | 启动参数/禁用原因/四态 |
| `electron/tests/ipc-exposure-contract.test.js` | 20 | 新增 `avatar-catalog.js` 登记（修复本次引入的判红） |

### 回归测试

- videogen 全族：`videogen-stages.test.js`(37) + `videogen-stages-poll.test.js`(5) + `videogen-content-fidelity.test.js`(30) + 数字人(19) → **91 passed**
- preflight 全族：43 passed
- pipeline-engine：全绿

### 全量测试既有失败（与本改动无关，已用 `git stash` A/B 对照证伪）

`pnpm exec vitest run` 全量 17883 项中 12 项失败，**基线（stash 掉本次改动）同样失败**：

| 文件 | 失败原因 | 基线是否同样失败 |
|---|---|---|
| `electron/services/stealth/preload-variant.test.js`(4) | enhanced bundle 构建产物缺失（`__mpStealthInjStart`） | ✅ 是（4 项） |
| `electron/core/preload-path.test.js`(2) | 三个 sandbox preload bundle 未产出 | ✅ 是 |
| `electron/tests/bundled-font-packaging.test.js`(1) | `resources/fonts/` 产物缺失 | ✅ 是 |
| `electron/ipc-handlers/podcast-*-ipc.test.js`(2) | tracked bundle 未重生 | ✅ 是 |
| `electron/tests/gui-ci-exit-contract.test.js`(2) | 观测预算/台账样本（墙钟依赖） | ✅ 是 |
| `electron/services/story2video-compose-engine.test.js`(2-3) | 真实 ffmpeg 合成慢测试超时抖动 | ✅ 是（flaky） |

**唯一与本次改动相关的一条**（`ipc-exposure-contract.test.js`：新增 `src/api/avatar-catalog.js` 未登记 `SCAN_DOMAIN`）已修复并复跑 20/20 绿。

### 其它门禁

| 门禁 | 读数 |
|---|---|
| `check-locale-sync.js --cjk` | PASS（基线 1331 → 当前 1172，无新增硬编码） |
| `check-locale-sync.js --keys` | PASS（2125 个 key 均存在） |
| `check-no-brand-residue.js` | PASS（10322 tracked） |
| `.github/scripts/check-max-lines.js` | PASS（无新增超大文件） |
| `verify-worktree-deps.js` | OK（11 项解析通过） |

## 七、远程同步

| 项 | 状态 |
|---|---|
| 远程同步 | 由门禁推导 |

- PR #3969（`avatar-heygen-wiring`）
- 收口方式：`scripts/lib/merge-ledger.js` 按主干历史推导（change `gate-record-sync-derived-status`，
  2026-10-17 起新 PR 不手写状态词——手写 `PASS` 会在合并前被判 `prematureClaim` 红）
- main push 回读证据写在 PR 评论里，不写回本文件（merge SHA 只在合并后存在）

## 八、CCG 深度双模型审查（本地跑，不进 CI）

`sh scripts/deep-review.sh` → DUAL（变更 955 行 > 200 行阈值）· proposer=opencode / critic=claude

**轮 1 抓到 1 个真实缺陷并已修**：

> Duplicate locale keys — avatar keys added both in `locales/create/avatar/{zh,en}.js`
> AND inline in `locales/create/ui/{zh,en}.js`.

根因：拆分 `create/{zh,en}.js` 是两步做的，第二步吃掉了第一步的成果——先在 ui 块内联加
21 个 avatar 键，随后为压 500 行门禁把**整个 ui 块**从 git HEAD 搬到 `ui/{zh,en}.js`，
而那个 HEAD 版本已含这些键。装配处 `ui: { ...uiZh, ...avatarZh }` 让后展开的覆盖前者，
**值恰好相同所以功能看起来完全正常**，但改 `ui/*.js` 那份不生效、两处不同步也不报错，
`--keys` 门禁只查"key 是否存在"，查不出重复。

修法：`avatar/{zh,en}.js` 作唯一真源，从 `ui/{zh,en}.js` 删掉重复的 21 键；两边键集现完全不相交。
回归锁 `ui-assembly.test.js` 从 2 例扩到 4 例（键集不相交 / avatar 键可见 / ui 原有键可见 /
zh-en 结构对等），并做了变异反证（注入重复键 ⇒ 判红点名 `[zh] avatarSectionTitle`；
删装配处 `...avatarZh` ⇒ 结构对等锁判红）。提交 `c06b4df01`。

**工具侧限制（如实记录，不掩饰）**：轮 1 之后 critic 的 JSON 输出被截断
（`{ 34 个 / } 33 个，结尾无 }`，13594 字符），驱动报
`JSON解析失败：模型输出被截断` 并以 exit 2 结束，故**没有产出闭环的
`deepReview.status`**；另一次重试为 `codeagent-wrapper ETIMEDOUT`。方案体量
（179 KB proposal / 3747 行 diff 基线）超出 critic 单轮输出预算，仓内文档也写明
深度审查"实测单次 >15 分钟、不进 CI"。

因此本记录的深度审查结论是「**已执行、已抓到并修复 1 个真实缺陷、但工具未能自动
闭环**」，不是"未执行"。该门的机械判据在 CI 侧是 `--mode=advisory`（只告警不阻断，
见 `quality-gate.yml` 该 step），本地 `--mode=enforce` 仍会点名这 1 条欠账。
