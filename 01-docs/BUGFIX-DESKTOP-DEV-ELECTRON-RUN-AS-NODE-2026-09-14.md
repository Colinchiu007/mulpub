# Bug 反思报告 — 开发模式无法启动应用：Electron 退化为 Node（2026-09-14）

- 文档编号：BUGFIX-DESKTOP-DEV-ELECTRON-RUN-AS-NODE-2026-09-14
- 严重程度：P1（在受影响环境上开发模式 **100% 起不来**，且报错指向错误方向）
- 影响范围：`apps/desktop/scripts/dev.js`（`pnpm dev` / `start-desktop.ps1` 主路径）、`scripts/launch-worktree.js`
- 关联模块：桌面启动契约 `scripts/start-desktop.ps1`
- 修复分支：`mp-hottopics-video-e2e`
- 关联 PRD：无（属开发工具链缺陷，不涉及产品行为）

---

## 1. 现象与复现

**现象**：在设置了 `ELECTRON_RUN_AS_NODE=1` 的环境（Electron 系 IDE 的集成终端、部分 CI/工具链会注入；本机 Codex / WorkBuddy 会话默认值为 `1`）中执行开发模式启动：

- Vite 正常起来、Python bridge / Splitter bridge / Prompt bridge 的 `/health` 全部 200；
- **窗口永不出现**，CDP 端口从不监听；
- `start-desktop.ps1` 最终以 `ERROR: 150s 内未出现可见主窗口` 退出。

**真实报错（在 `%TEMP%\mp-start-dev.err.log` 里，而非启动脚本自己的输出）**：

```text
D:\...\node_modules\electron\dist\electron.exe: bad option: --user-data-dir=D:\tmp\Multi-Publish-debug-profile
D:\...\node_modules\electron\dist\electron.exe: bad option: --disk-cache-dir=D:\tmp\...\cache
D:\...\node_modules\electron\dist\electron.exe: bad option: --no-sandbox
D:\...\node_modules\electron\dist\electron.exe: bad option: --remote-debugging-port=10967
D:\...\node_modules\electron\dist\electron.exe: bad option: --disable-gpu
...
[dev] vite exited code=null signal=SIGTERM（端口 6919 可能被占用/冲突；可用 MP_VITE_PORT 显式换端口）
```

**附带迷惑项**：`electron.exe --version` 在该环境下会打印 **Node 版本**（如 `v24.18.0`）而不是 Electron 版本，进一步误导排查方向（容易被判成"electron 装错了"）。

---

## 2. ① 第一性原因溯源

**引入点**：`apps/desktop/scripts/dev.js` 的 electron spawn（长期存在，非近期引入）：

```js
electron = spawn(electronCommand, electronSpawnArgs, {
  cwd: desktopDir,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,                          // ← 缺陷：把 ELECTRON_RUN_AS_NODE 原样透传给 electron
    ELECTRON_USER_DATA_DIR: electronUserDataDir,
    DEV_SERVER_PORT: String(vitePort),
  },
});
```

`scripts/launch-worktree.js` 存在同一模式（`...process.env` 透传）。

**为什么会写成这样（第一性原因）**：

1. **Electron 的双重人格**：`ELECTRON_RUN_AS_NODE=1` 让 Electron 二进制退化为**纯 Node 运行时**（这是 Electron 官方特性，用于复用其 Node 版本）。退化后 `electron.exe <appPath>` 里的所有 Chromium/Electron 开关都变成 Node 的未知参数 → `bad option` 并立即退出。
2. **环境变量是"继承即生效"的隐式契约**：`dev.js` 的设计意图是"把宿主环境原样传给应用"，这在多数变量上正确，但对**会改变运行时语义**的变量（`ELECTRON_RUN_AS_NODE`）恰恰相反——它不是应用的配置，而是**启动器的开关**，不该被继承。
3. **失败信号被淹没**：electron 的 stderr 写进了 `dev.js` 的 `stdio: 'inherit'` → `%TEMP%\mp-start-dev.err.log`，而启动脚本只输出自己的"150s 无窗口"；且 electron 退出后 `dev.js` 连带 `vite.kill()`，日志里最后一条是 **Vite 被 SIGTERM**，把注意力引向"端口冲突"这一错误方向。
4. **注释与文档未覆盖**：`dev-launcher.js` 只负责拼参数，`start-desktop.ps1` 只负责编排，没有任何一处显式声明"哪些环境变量必须被剔除"。

---

## 3. ② 测试逃逸分析（逃逸链）

| 层级 | 是否有覆盖 | 为什么没拦住 |
|------|-----------|-------------|
| 单元测试 | ❌ 无 | `apps/desktop/scripts/*.test.js` 只测了 `dev-ports`（端口派生）、`dev-launcher`（参数拼装）、`dev-exit-log`（退出留痕）；**没有任何用例覆盖 spawn 的环境变量构造**——因为环境构造此前是内联在 `dev.js` 里的字面量，不可单测 |
| 集成测试 | ❌ 无 | 无"启动一次 dev 栈并断言窗口/CDP 出现"的测试 |
| E2E | ❌ 无 | 既有 E2E 都是"连接**已运行**实例"，不负责拉起实例；拉起动作依赖人工执行 `start-desktop.ps1` |
| CI | ❌ 无 | CI 只做语法检查 + 单测，不启动 Electron（Windows runner 也无 GUI） |
| 人工验证 | ❌ 漏过 | 该缺陷只在**特定宿主环境**（`ELECTRON_RUN_AS_NODE=1`）触发；开发者在"干净终端"里验证永远复现不到 |

**逃逸原因分类**：`无测试`（环境构造不可测） + `环境相关`（宿主变量隐式影响） + `错误信号被淹没`（真正的报错不在主日志流里）。

---

## 4. ③ 系统性漏洞定位

| 缺陷类型 | 具体文件 | 系统性缺陷 |
|----------|---------|-----------|
| 契约缺口 | `apps/desktop/scripts/dev.js`、`scripts/launch-worktree.js` | "spawn Electron 时的环境净化规则"没有单一实现，两处各自 `...process.env` 内联，新增启动点就会再犯 |
| 可测性缺口 | `dev.js` 内联 env 字面量 | 环境构造逻辑与进程编排耦合，无法单测 ⇒ 无法进 CI |
| 门禁缺口 | `.github/workflows/quality-gate.yml` Gate 2b | 只跑硬编码的 3 个 scripts 测试文件；新增 scripts 测试需要人肉改 CI 列表，容易漏 |
| 可观测性缺口 | `start-desktop.ps1` / `dev.js` | electron 的启动失败信息（stdout/stderr）没有回显到主日志，失败原因需要人肉去 `%TEMP%` 翻文件 |

---

## 5. ④ 修复 + 回归保护测试

### 5.1 修复方案（单一公共路径 + 两处接线）

新增 `apps/desktop/scripts/electron-runtime-env.js`，作为 **spawn Electron 时环境构造的唯一实现**：

```js
const ELECTRON_STRIPPED_ENV_KEYS = Object.freeze(['ELECTRON_RUN_AS_NODE'])

function buildElectronEnv(baseEnv, overrides = {}) {
  // 1) 复制 baseEnv，剔除 ELECTRON_STRIPPED_ENV_KEYS（不区分大小写）
  // 2) 叠加 overrides（undefined 跳过）；overrides 在剔除之后应用 ⇒ 调用方显式设置优先
  // 纯函数：不修改入参
}
```

接线（两处 electron spawn）：

| 文件 | 改动 |
|------|------|
| `apps/desktop/scripts/dev.js` | `env: buildElectronEnv(process.env, { ELECTRON_USER_DATA_DIR, DEV_SERVER_PORT })` |
| `scripts/launch-worktree.js` | `env: buildElectronEnv(process.env, { ...loadEnvFile(args.envFile), ELECTRON_USER_DATA_DIR, CALLBACK_SERVER_PORT, BACKEND_PORT, PROMPT_PORT, SPLITTER_PORT, DEV_SERVER_PORT })` |

**保留"调用方显式覆盖"能力**：若某个脚本**故意**要以 Node 模式跑 Electron（例如纯脚本任务），仍可在 overrides 里显式传 `ELECTRON_RUN_AS_NODE` —— 语义是"由启动器决定，而不是由宿主环境意外泄漏"。

### 5.2 回归保护测试（已落地）

**文件**：`apps/desktop/scripts/electron-runtime-env.test.js`（`node --test`，与 `dev-ports.test.js` 同风格）

| # | 用例 | 断言要点 |
|---|------|---------|
| 1 | 剔除 `ELECTRON_RUN_AS_NODE`（精确键名） | 该键不存在；`PATH`/`HOME` 等其它键原样保留 |
| 2 | 剔除是大小写不敏感的 | `electron_run_as_node` / `Electron_Run_As_Node` 等变体全部不泄漏 |
| 3 | 不修改入参（纯函数） | `baseEnv` / `overrides` 调用前后深比较相等 |
| 4 | overrides 生效；显式同值可覆盖剔除结果 | `DEV_SERVER_PORT` 被 overrides 覆盖；`overrides` 里显式传 `ELECTRON_RUN_AS_NODE` 时生效（保留主动设置能力） |
| 5 | overrides 中 `undefined` 的键被跳过 | 不产生空串变量 |
| 6 | `baseEnv` 为 null/undefined | 只返回 overrides；两者皆空返回 `{}` |
| 7 | 常量契约 | `ELECTRON_STRIPPED_ENV_KEYS` 含 `ELECTRON_RUN_AS_NODE` 且已冻结 |
| 8 | 真实场景 | `{...process.env, ELECTRON_RUN_AS_NODE:'1'}` 净化后无该键、无 `undefined` 值 |

**运行**：`node --test apps/desktop/scripts/electron-runtime-env.test.js` → **8 passed**。

**纳入 CI**：`.github/workflows/quality-gate.yml` Gate 2b 的 `node --test` 文件列表追加 `apps/desktop/scripts/electron-runtime-env.test.js`。

---

## 6. ⑤ 预防措施（已落地）

1. **收敛为单一实现（代码层闭环）**：任何新增的 Electron spawn 点必须走 `buildElectronEnv`；`dev.js` / `launch-worktree.js` 已是先例。
2. **进 CI（门禁层闭环）**：Gate 2b 覆盖环境净化逻辑，回归会被 CI 直接拦下。
3. **文档化宿主陷阱**：`01-docs/E2E-HOT-TOPICS-ONE-CLICK-VIDEO-2026-09-14.md` 的"环境陷阱"章节记录该现象、判别方法与修复点，供后续 E2E/启动排查复用。
4. **经验沉淀**：本条与"环境变量并非都是应用配置——启动器开关必须显式剔除"一同进入项目长期记忆。

---

## 7. 验证记录

| 项 | 命令 | 结果 |
|----|------|------|
| 目标用例（RED→GREEN） | `node --test apps/desktop/scripts/electron-runtime-env.test.js` | **8 passed** |
| 语法检查 | `node --check apps/desktop/scripts/dev.js` / `scripts/launch-worktree.js` | 通过 |
| 端到端复现 | 在有 `ELECTRON_RUN_AS_NODE=1` 的宿主中运行 `scripts/start-desktop.ps1` | 修复前：150s 无窗口 + `bad option: --user-data-dir=...`；修复后：**窗口出现 + CDP 端口监听 + identity 可读** |
| 同族回归 | `node --test apps/desktop/scripts/dev-ports.test.js apps/desktop/scripts/dev-launcher.test.js apps/desktop/scripts/dev-exit-log.test.js` | 见 CI |
| CI | GitHub Actions `quality-gate.yml` | 见 PR |
