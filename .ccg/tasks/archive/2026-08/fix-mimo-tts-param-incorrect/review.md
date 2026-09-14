# Review: MiMo TTS 默认音色导致 Param Incorrect

Task: `fix-mimo-tts-param-incorrect`
Branch: `codex/fix-mimo-tts-param-incorrect`
Reported run: `run_1787475502069_9888`
Date: 2026-08-23

## 远程同步

- PR #1140 已于 `2026-08-23T10:35:47Z` squash 合并，merge SHA 为 `40f32a88b7a2e20cf1b5bb32538a039351162a76`。
- 所有 required checks 通过；`origin/main` 已核验包含该 merge SHA。
- 当前运行应用来自 `D:/Data/projects/mp-worktrees/mp-ue-parity-v2`，本次未杀进程或修改该 worktree；需要重启应用后加载修复。
- OpenSpec change 已归档至 `openspec/changes/archive/2026-08-23-fix-mimo-tts-param-incorrect`，正式规格已同步至 `openspec/specs/mimo-tts-provider-contract/spec.md`。
- 本任务的 `openspec validate --archived --strict` 结果为通过；全局 `openspec-sync-check.js` / `validate --archived` 仍报告仓库既有历史任务问题，未归因于本任务。
- 归档 PR #1141 已于 `2026-08-23T10:48:00Z` squash 合并，merge SHA 为 `11a333ed7e5cbfd4e961f80ece1a989d84e67385`；`origin/main` 已核验包含该 SHA。

## QM-5 根因溯源

### 1. 第一性原因

`git blame` 显示 `apps/desktop/electron/services/adapters/mimo-tts.js:36` 的默认值由 `c9df8bf5dc`（2026-07-15，新增 MiMo 适配器）引入为 `default`。该初始适配器没有把当前 MiMo v2.5 官方普通 TTS 音色表固化到请求体测试中。运行 `run_1787475502069_9888` 使用 `mimo-v2.5-tts`、未选择音色，`params.voice || DEFAULT_VOICE` 最终发送 `audio.voice=default`，MiMo 返回 `Param Incorrect`。官方中文文档明确普通 TTS 预置音色为 `mimo_default`。

### 2. 逃逸链

- 单元测试：既有测试只覆盖显式 `voice` 和默认 `format`，没有断言未传/空字符串音色的最终 JSON 请求体，因此未拦截错误默认值。
- 集成测试：资产生成和模型管理测试使用 provider/adapter mock，没有真实 MiMo API 密钥，未验证服务商对 `audio.voice` 的参数合同。
- E2E/视觉：既有流水线与视觉测试关注阶段状态、产物和界面，不检查 MiMo 请求体中的服务商音色 ID。
- 代码审查：初始适配器审查未把官方文档中的内置音色与默认常量逐项对照，属于 provider 合同审查盲区。

### 3. 系统性漏洞

分类为“测试场景缺失 + provider 合同审查盲区”：适配器默认参数没有统一的官方文档证据和最终请求体回归模板。

### 4. 修复与回归保护

- 将 `DEFAULT_VOICE` 改为 `mimo_default`，只影响 MiMo 适配器，不改变其他 provider。显式非空音色仍原样透传。
- 新增 `mimo-tts.test.js` 两条回归：未传 `voice`、传 `voice=''`，都解析 `fetchMock.calls[0].opts.body` 并断言 `audio.voice=mimo_default`。
- TDD 证据：修复前两条测试均以 `Received: "default"` 失败；修复后 MiMo 适配器 `26/26`、MiMo 适配器+音色服务 `52/52`、资产生成/模型管理/Story2Video 阶段相关套件 `228/228`。

### 5. 预防措施

- 新增 OpenSpec capability `mimo-tts-provider-contract`，把普通 TTS 默认音色和空配置行为写成可追踪场景。
- 本复盘写入 `01-docs/learnings.md`：新增/修改 provider adapter 时，必须以官方文档核对默认参数，并用最终序列化请求体覆盖省略值、空值和显式值。
- Voice Design/Voice Clone 是不同模型合同，本次记录为非目标；后续改动这些模型时必须单独核对文档并补模型专用请求体测试。

## 双模型审查记录

按 CCG 要求并行调用 opencode 与 Claude reviewer：

| Reviewer | 结果 | 原因 |
|---|---|---|
| opencode | 降级 | wrapper 请求外部角色文件权限被拒绝，完成但没有 `agent_message` |
| Claude | 降级 | wrapper 启动后长时间无输出，按超时规则中断，没有有效报告 |

外部报告不可用后，两个独立本地只读探针完成交叉复核；主代理按 file:line 复核 diff、测试、OpenSpec 和构建证据。

### Critical

无。

### Warning

无未解决 Warning。`params.voice || DEFAULT_VOICE` 对 `null/false/0` 的 truthy 归一是既有输入语义；本次调用方合同只产生未定义/空字符串，未扩大为通用参数校验。默认值对 Voice Design/Voice Clone 的适用性已列为非目标，并由独立模型合同约束。

### Info

- `mp3`、语速、音调和音量未被纳入本次修复，因为运行日志和官方错误证据只指向非法 `audio.voice`。
- `build:vue` 产生的 `electron/preload/index.bundle.js` 已精确恢复，最终 diff 不包含构建副产物。

## 验证证据

- `node --check`：通过。
- `git diff --check`：通过；仅有 Git LF/CRLF 转换提示。
- `node scripts/verify-worktree-deps.js`：9 项 workspace 消费方解析当前 worktree，`OK`。
- 变更文件 ESLint：通过。
- `npx @fission-ai/openspec@latest validate fix-mimo-tts-param-incorrect --strict --no-interactive`：`Change ... is valid`。
- `pnpm run build:vue`：1907 modules transformed，构建成功。
- `pnpm exec electron-builder --win --dir --publish never`：exit code 0。
- ASAR 抽取后真实加载 `electron/services/adapters/mimo-tts.js`：`ASAR_REQUIRE_OK MimoTtsAdapter`。
- 打包启动 8 秒：进程保持运行，使用 `CALLBACK_SERVER_PORT=16531` 避免当前应用占用默认端口；`stderr=0`，主窗口显示，未见配置/插件/ASAR/updater 启动错误。

## 结论

本地审查结论：`PASS`，0 Critical / 0 Warning。外部双模型审查因本机 wrapper 环境不可用已按降级流程记录。
