# 执行记录：s2v-voice-cleanup（2026-10-20）

**分支**：`s2v-voice-cleanup` ｜ **基线**：`origin/main@337d8f9ff`
**动因**：消化 #4048 收尾时如实登记的 3 项未闭合中的 2 项（第 3 项 `electron-ci` 超时改为独立诊断，见文末）。

## 门禁表

| 门禁 | 结果 | 证据 |
|---|---|---|
| 会话隔离 | ✅ | worktree `<worktree-root>/mp-s2v-voice-cleanup`，非 C 盘，分支裸名；共享根保持 `main` clean |
| 依赖就绪 | ✅ | `pnpm install --frozen-lockfile` exit 0；`ensure-electron` v43.7.7；`verify-worktree-deps` 11 项解析 OK |
| 先文档再代码 | ✅ | 本记录 + `01-docs/PRD.md` 音色域合同新增 3 行（只读 computed 与 requireDeps / fail-closed 归属层 / 状态最小面） |
| TDD | ✅ | B：先复现 6 例（seed=1792469548946）→ 插桩定位 → 修复 → 5 个顺序全绿；C：先删断言暴露 `22 → 21` 契约破裂 → 同步实现 |
| 单测 | ✅ | `useTtsVoices.test.js` **32/32**（正常顺序 + seed 1792469548946/42/999/7 各 32/32） |
| 全量回归 | ✅ | video-creation + CreateView + 删除守卫 + 选项自动保存 = **519/519**（18 文件） |
| Lint | ✅ | 改动 7 文件 ESLint exit 0 |
| 变异反证 | ✅ | 把 `const d = requireDeps()` 加回 `s2vVoiceOptions` ⇒ **7 failed**（含新增回归锁单独指名）；撤销后 32/32 |
| QM-1 打包 | N/A | 未改 `apps/desktop/electron/` 与 `packages/rpa-engine/`；改动全在渲染层 |
| QM-4 视觉 | N/A | 模板 / DOM / 样式 / locale 零改动 |
| Gate 7 locale | ✅ | 未新增用户可见文案、未改 locales ⇒ CJK 与 key 计数不变 |
| 远程同步 | 由门禁推导 | PR（开 PR 后补） |

## 一、B：`--sequence.shuffle` 下 6 例失败的根因与修复

### 症状与错误的既有归因

`--sequence.shuffle --sequence.seed=1792469548946` 下，新的 describe 稳定 6 例失败，实际读到 `['v1','v2','v3']`（上一个用例的目录/克隆数据），而正常顺序 31/31 全绿。

#4048 收尾时把它登记为「测试夹具顺序耦合，起点日志证实复位有效（`[] []`），泄漏发生在被测函数执行期间，根因未定位」。**这个归因是错的**。

### 定位过程

在断言前同时打印 computed 值、按同一公式手算的值、以及两个真实依赖：

```
[DIAG-B] computed=["v1","v2","v3"]  manual=["official-old","MiniMaxVoice_auto1"]
         cat=["official-old"]  clones=["MiniMaxVoice_auto1"]
```

**三个关键事实**：两个真实依赖都是正确值、手算同一公式得到正确值、只有 computed 返回陈旧值 ⇒ 不是夹具泄漏，是 **Vue computed 缓存污染**。

### 真实根因

```js
export const s2vVoiceOptions = computed(() => {
  const d = requireDeps()   // ← 整个函数体从未使用 d
  ...
})
```

Vue 3 的 computed 在求值**抛错**时把 `_dirty` 置回 `false`，却**保留上一次的 `_value`**；而抛错那次没有成功注册依赖订阅。于是此后 `state.s2vVoiceCatalog` 再变化也 trigger 不到这个 computed ⇒ 永久返回旧值。

触发链：① 某用例赋值 catalog/clones 并读 computed ⇒ 缓存 `[v1,v2,v3]`；②「deps 未注入时 fail-closed」用例读它（deps 已被 reset 置空）⇒ 抛错 ⇒ 冻结旧值；③ 之后所有用例都读到 `[v1,v2,v3]`。

为什么正常顺序不复现：该 fail-closed 用例在文件里的位置恰好早于数据赋值用例，缓存里还是空值。

### 修复

删掉 4 个 computed 里的死 `requireDeps()`（`s2vVoiceCatalogRefreshable` / `s2vVoiceModelHidden` / `s2vVoiceContextModel` / `s2vVoiceOptions`），只保留真正消费 `d.t` 的 `s2vVoiceProviderOptions`。

并把 fail-closed 契约**重新归位**：
- 写路径方法（`getS2VVoiceContext` 等）**继续**抛错 —— 这是 fail-closed 的真正归属层；
- 只读 computed 在 deps 缺失时返回安全空值，**不再**参与 fail-closed。

新增回归锁「只读 computed 在 deps 未注入时不抛错、且不污染缓存」，四步：有 deps 求真实值 → reset → deps 缺失时读它不得抛错且为 `[]` → 重新注入换数据必须反映新值。

### 证据

| 顺序 | 结果 |
|---|---|
| 正常顺序 | 32/32 |
| seed 1792469548946（原失败种子） | 32/32 |
| seed 42 / 999 / 7 | 各 32/32 |
| 变异 M1：把死 `requireDeps()` 加回 | **7 failed**（回归锁单独指名 + 原 6 例） |
| 撤销 M1 | 32/32 |

## 二、C：移除 `s2vPersistedVoiceId` 死状态

### 判定

`git grep` 全仓 29 处引用，其中**代码零读取**：9 处纯赋值（4 个文件）+ 1 处壳 computed 桥接 + 15 处测试/注释。生产路径里没有任何 `if (s2vPersistedVoiceId === ...)` 类消费 —— 它与 `s2vConfig.voiceId` 完全重复，且后者才是权威。

**它是「为断言而存在的状态」**：唯一读它的是测试，而「偏好已保存」的真实证据本来就是 `selectTtsVoice` 的入参断言。

### 变更面（16 处）

| 文件 | 改动 |
|---|---|
| `tts-voices-state.js` | 删 `reactive` 初值与 `resetTtsVoicesForTest` 的 `initial` 各 1 处（22 → 21 ref） |
| `useTtsVoices.js` | 删 5 处赋值（reset / 分支 A / 分支 B / 分支 C / else） |
| `tts-voices-shared.js` | 删 2 处赋值（clear 成功路径 / select 成功路径） |
| `tts-voices-clone.js` | 删 1 处赋值（删除后回退） |
| `CreateView.vue` | 删 computed 桥接 1 行 |
| `CreateView.test.js` | 删 1 处断言，改为指向 `selectTtsVoice` 入参（真实落盘证据） |
| `useTtsVoices.test.js` | 删 7 处读写 + 导出面断言 22 → 21；4 处断言改指 `s2vConfig.voiceId`（权威） |

**语义零损失**：「保留已保存的 voiceId」由「不写 `s2vConfig.voiceId`」承担，「偏好已保存」由 `selectTtsVoice` 入参证明。

### 保留的正确指引

在 3 处删除点留注释说明：若将来真需要「主进程归一后的 id」（`result.data.selectedVoiceId` 可能与本地传入值不同），正解是**回写 `s2vConfig.voiceId`**（让权威与显示同步），而不是再存一份没人读的镜像。

## 回归基线

| 项 | 结果 |
|---|---|
| `useTtsVoices.test.js` | **32/32**（+1 新增回归锁，-0） |
| video-creation + CreateView + 删除守卫 + 选项自动保存 | **519/519**（18 文件，较 #4048 的 468 多 51 —— 基线自身前进了） |
| ESLint（7 文件） | exit 0 |
| 模板 / DOM / 样式 / locale | 零改动 |

## 残留风险（不假装已解决）

1. **`s2vVoiceProviderOptions` 仍依赖 deps**（它真用 `d.t`），因此理论上仍具同类风险。当前所有读取点都在 deps 注入之后；生产壳的注入顺序（先 `setupTtsVoicesDeps` 再渲染）保证安全。未改它是因为改动需把 `d.t` 换成惰性求值，属独立重构。
2. **`s2vVoiceModelHidden` / `s2vVoiceContextModel` 仍经 `getS2VVoiceProvider()` 间接 `requireDeps()`**，故 deps 缺失时仍会抛错。测试不读它们，未观察到污染；若将来读它们，需按同一口径处理。
3. **B 的修复只覆盖 `--sequence.shuffle` 的场景（本仓 CI 不跑 shuffle）**。它不会让任何原本通过的东西变红，但 shuffle 也**没有**被接线进 CI —— 顺序耦合仍可能在新增用例时回归。接线是独立决策（会改变 CI 成本）。
4. **`electron-ci` 的 main push 超时未在本次修复**，见文末独立诊断。

## 附：`electron-ci` 超时（独立议题，不在本 PR 范围）

`#4048` 合并后的 main push 上 `Electron CI` failure，形态是 `Unit tests (Vitest, non-Electron, single-worker deterministic)` 的 `exit code 124`（36m44s ≈ 2204s > 预算 2100s）。归因：main 上从 `528acaa0`(07:32Z) 起连续 8 个 run 同样形态，其中 6 个发生在本次合并**之前**；同一文件在工作流注释里已记录该现象（「main 近 14 次运行里 8 次 exit 124」）并把根因写成「按 `--shard` 把这一轮切开（issue 档 2）」，同时明确「2100s 属**单调放宽**，不是修好了根因」。

该步骤 `if: github.event_name != 'pull_request'` —— PR 侧本就跳过（同一批桌面测试已由 QG desktop-shards 分片执行），只在 main push / workflow_dispatch 跑。**改它属于「改谁来守门」**，按 AGENTS.md 须人工过目、不走 agent 自动合并；`--shard` 的 matrix 方案还与 required status check 存在结构性冲突（matrix 会把作业报成 `job (1)/(2)`，required context 要的是不带后缀的名 ⇒ 全绿仍判 `base branch policy prohibits the merge`，详见 AGENTS.md「取证口径」节）。

故本次**只出诊断与方案对比，不动 workflow**，交由人工决策。
