---
record: heygen-adapter-contract
task: HeyGen 数字人 adapter 对齐官方 v2 契约（请求体/轮询端点/认证头）
date: 2026-10-21
---

## 本次执行记录：HeyGen Adapter 对齐官方 v2 契约（heygen-adapter-contract，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码：worktree `<仓库父目录>/mp-worktrees/mp-heygen-adapter-contract`，分支 `heygen-adapter-contract`（非共享根 main）；`scripts/start-mp-task.ps1` 创建，依赖 11 项解析 OK |
| 第一性原因（QM-5 ①） | ✅ | `git log -- apps/desktop/electron/services/adapters/heygen.js` → `473609440`「feat(adapters): 补齐全部 39 个模型供应商 Adapter」一次性批量生成，`generateVideo` 的 body 形状与状态端点均未对照 HeyGen 文档；`generateVideo` 自引入起从未有真实调用 |
| 逃逸分析（QM-5 ②） | ✅ | 单元测试断言自家形状（旧 `heygen.test.js` 断言 `video_inputs[0].character === 'anna'`）；无契约层；E2E `ipc-mock.js` 直接伪造成功；#3969 验收 A1-A8 不含 adapter HTTP 形状；review 按文件存在性通过 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `heygen.js`：`video_inputs[].character` 对象（type/avatar_id/avatar_style）、`voice` 对象（type/input_text/voice_id）、顶层 `dimension`；轮询改 `{apiRoot}/v1/video_status.get?video_id=`；认证改单一 `X-Api-Key`；`testConnection` 改 `/avatars`。回归锁在 `heygen.test.js`：先 RED（5 例失败，旧实现）后 GREEN（33/33） |
| 防止再次发生（QM-5 ⑤） | ✅ | 测试注释明确「官方契约锁，不照实现回写」；`Authorization` 必须为 `undefined` 的反向断言；learnings 记录「mock 断言自家形状 = 把 bug 写成期望值」 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致：`84/30`（heygen.js）、`101/11`（heygen.test.js）；`git diff --check` rc=0 |
| 接线棘轮 | N/A | 未新增 `*.test.js` 文件，仅修改既有 `heygen.test.js`（已在 CI 点名） |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A | `pnpm run build:win`（= `build:vue` + `electron-builder --win --x64`）exit 0；产物 `Multi-Publish.Setup.0.2.0.exe` 271,281,354 bytes @ 2026-10-21 22:20:48。asar 内 `electron/services/adapters/heygen.js` 复核：`X-Api-Key` / `/v1/video_status.get` / `avatar_style` 均在（11751 chars）。启动烟测：隔离 `--user-data-dir` + `--no-sandbox` 下存活 8s（PASS），userData 生成 44 个文件。**注**：首次只跑 `electron-builder` 时 `apps/desktop/dist` 不存在，产物缺 renderer、启动即退；改为 `build:win` 后复测通过。QM-4 N/A（无 UI 改动） |
| QM-6 CCG 决策层评审 | ⚠️ 未闭环（如实记录） | `sh scripts/plan-review.sh openspec/changes/heygen-adapter-contract/proposal.md` 判定 DUAL。第 1 次跑满 3 轮被 2 条 Critical 阻断，但两条均源于 proposer 自行扩张的 `/v1/me` 与 `HEYGEN_AUTH_MODE`（不在代码/提案内），已用 `.adversarial/ccg-plan-proposal-claude/response-v3.md` 逐条拒绝并附证据；第 2 次在轮 1 修订阶段模型输出无法通过 Revision 校验（`edits[2].before` 不匹配），工具以 exit 1 结束。第 2 轮 8 条问题已逐条回应（6 采纳 / 2 拒绝，见 `response-v1.md`），并按采纳项改了代码与测试；**未取得收敛结论，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行不需要事后改写；合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导 |

### 验收判据（本轮可机械验证）

| # | 判据 | 读数 |
|---|---|---|
| A1 | `generateVideo` 请求体 = 官方对象形状 + `dimension` | `heygen.test.js` 主用例断言 `toEqual({type:'avatar',avatar_id:'anna',avatar_style:'normal'})` / `{type:'text',input_text:'Hello world',voice_id:'en_us'}` / `{width:1280,height:720}` |
| A2 | 轮询 URL = `/v1/video_status.get?video_id=` 且不含 `/v2/video/status` | 同文件 `getVideoStatus` 用例 `toBe('https://api.heygen.com/v1/video_status.get?video_id=vid-123')` |
| A3 | 认证头 = 单一 `X-Api-Key`，无 `Authorization` | 主用例 + `testConnection` 用例 |
| A4 | 既有错误分类零回归（401/429/超时/网络） | 33/33 全绿（原 30 例 + 3 例新增：未知 avatarStyle 回落、无版本段 baseUrl、带端口 baseUrl） |
| A5 | 业务 code 非 100/0 → `PROVIDER_ERROR` | 新增用例通过 |
| A6 | `avatarStyle` 只接受 normal/circle，未知值回落 normal | 新增用例通过 |
| A7 | `_apiRoot` 用 URL 解析，无版本段/带端口均不误伤 | 2 例新增用例通过 |

### 遗留（不假装已闭合）

- **真实 Key 首跑未执行**：当前没有可用 HeyGen Key，本轮只做契约级正确性。Key 到位后按 `tasks.md` T4 执行：① 真实 `GET /v2/avatars` 拉到形象；② `generateVideo` 返回 `video_id`；③ 轮询到 `completed` 且有 `video_url`；④ 下载成片有音轨。
- **`testConnection` 走 `/v2/avatars`**：这是仓库已实现且有测试的端点，但同样未经过真实 Key 验证（与首跑同批验证）。
- **Python 后端未改**：`packages/python-backend` 的 HeyGen 走 `/v1/workflows/executions`，与桌面 adapter 是两条链路；不在本次范围内。

## CHANGELOG 条目

# fix(video): HeyGen 数字人 Adapter 按官方 v2 契约修正请求体、轮询端点与认证头（heygen-adapter-contract）

- 修复数字人流水线首次真实调用必失败的三处契约错位：`video_inputs[].character/voice` 改为官方对象形状（含 `dimension`），轮询改为 `GET /v1/video_status.get?video_id=`，认证改为单一 `X-Api-Key`。
- 回归锁改为按官方契约断言（旧测试断言的是自家错误形状，等于把 bug 写成期望值），并新增「不得发送 `Authorization`」的反向断言。

## learnings

### lesson: mock 断言自家输出形状等于把 bug 锁成期望值

**现场**：`apps/desktop/electron/services/adapters/heygen.js` 由 `473609440` 批量生成时把 HeyGen v2 的 `character/voice` 对象写成扁平字符串，`heygen.test.js` 同步断言 `character === 'anna'`，30 例全绿；#3969 数字人流水线接通后仍无真实调用，问题一直潜伏。

**根因**：测试的期望值来自实现而不是外部契约文档；E2E fixture 又直接返回成功，跨过了 HTTP 契约层。两层 mock 叠加后，没有任何一层证明「请求能被真实服务接受」。

**可复用的 N 条**：

1. 供应商 adapter 的契约测试必须按官方文档形状写断言，并在注释里留文档 URL；不能从实现反推期望值。
2. 有「测试连接」按钮的 adapter，`testConnection` 要打真实业务端点（本项目用 `/v2/avatars`），不要用伪造 id 打状态接口再把 404/500 当成功。
3. 没有真实 Key 时，验收要显式标注「契约级通过 / 实跑未验证」，不能把 mock 全绿写成「已跑通」。
