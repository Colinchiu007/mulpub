# Group 1 前置确认结论（实现期记录，非规划产物）

基线 worktree：`D:/Data/projects/mp-worktrees/mp-account-name-source`，分支 `account-name-source`，HEAD `0ef09cce`（= #2409 squash 合入后的 `origin/main`）。

## 1.1 基线含 c9937925 交付 —— 通过

`git grep -c "resolveAccountDisplayName" apps/desktop/electron/publishers/account-manager.js` = 3。
守卫 5 条形态规则（`CHROME_SUFFIXES` / `METRIC_PATTERNS` / `ELLIPSIS_PATTERN` / `TITLE_SEPARATOR_PATTERN` / `hasUnbalancedBrackets`）与 CJS/ESM 孪生均在 main 上。故本 change 直接以 main 为基线，无需堆叠 `account-nickname-noise-fix` 分支。

## 1.2 就绪门禁不读 SQLite 的 accounts.name —— D3 风险面已收窄

- `apps/desktop/electron/services/login-status-monitor.js:63` 的门禁判断是 `if (!_store || !_store._ready) return`，**只看就绪标志，不读任何列**。
- `:64` 注释自证：「账号真源 = 后端 accounts.json；store（SQLite）只用于就绪门禁，不再作为账号列表来源」；`:68` 实际取数走 `_accountManager.listAccounts()`。
- `:80`/`:93` 日志里的 `acc.name || acc.account_name` 也来自该后端列表，不是 SQLite。
- 全仓 `FROM accounts` 的读消费者只有 `apps/desktop/electron/services/store/account-store.js:106,117-118`，其上游是 `ipc-handlers/store.js` 的 `store:*` 通道 —— 即本 change 要改走的旧断链通道，不是门禁。

**结论**：D3 把 rename 从 `store:update-account` 改到后端 PATCH，不影响就绪门禁；SQLite 侧继续 best-effort 写 `name` 即可（保守保留，避免 `store.test.js:364-377` 既有契约破裂）。

## 1.3 改动前基线红名单

### 后端（`packages/python-backend`）

本冷克隆环境有 **4 个模块收集期即失败**，与账号无关，已 `--ignore` 排除：

- `tests/test_frame_html.py` → `ModuleNotFoundError: No module named 'playwright'`（`pyproject.toml:16` **已声明** `playwright>=1.50.0`，本机未装）
- `tests/test_http_client.py` / `_deep.py` / `_extended.py` → `ModuleNotFoundError: No module named 'respx'`（**全仓未声明**：pyproject.toml 与任何 requirements*.txt 均无 respx —— 属既有的测试依赖声明缺口，不在本 change 范围内修）

排除后：`17 failed, 2603 passed, 1 skipped, 25 errors`（43 条红项，清单见本机 `%TEMP%/f2-pytest-baseline.txt`）。

**关键**：43 条红项中**没有任何一条**命中 `account` / `server_account` —— 即本 change 要触碰的账号测试面在基线上是全绿的，实现后必须仍为全绿。

复跑命令（后续对比用同一条，保证可比）：

```
cd packages/python-backend && python -m pytest tests -q \
  --ignore=tests/test_frame_html.py \
  --ignore=tests/test_http_client.py \
  --ignore=tests/test_http_client_deep.py \
  --ignore=tests/test_http_client_extended.py
```

### 桌面（`apps/desktop`）

基线全量 vitest 结果见实现期后续回填；已知既有环境项：`electron/services/feedback.test.js` 的 `EPERM: operation not permitted, symlink`（本机无符号链接特权）。
