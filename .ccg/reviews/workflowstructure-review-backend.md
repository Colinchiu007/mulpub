# QM-6 后端轴评审原文（逻辑/安全/规格合规）

- 通道：`opencode run --model opencode/nemotron-3-ultra-free`（CC Switch 本地代理 :15721 实测未监听 ⇒ codeagent-wrapper 配置的 backend primary=codex 不可达，按既有替代通道降级，**这不是配置里的 primary**）
- 日期：2026-10-13；被审 head：见本 PR 提交历史（评审输入 = 本 worktree 源码 + 变更集快照）
- 采信口径：只收录该模型 stdout 的结论段，工具调用行已剥除；下列行号是**它当时读到的位置**，与我方文件的真实行号存在偏差（已按正文逐条对代码复核，采纳与否见执行记录）

---

Based on my analysis of the review materials, here are my findings:

---

### CRITICAL

**1. Missing `runs-on` validation for regular jobs**  
**File:** `.github/scripts/check-workflow-structure.js`  
**Lines:** 141–173 (`checkJob` function)  
The `checkJob` function validates `defaults`, `steps`, and `uses`, but **never checks for the required `runs-on` field** on jobs that have `steps` (non-reusable jobs). A job like:
```yaml
jobs:
  test:
    steps:
      - run: echo hi
```
passes validation but GitHub will reject it at queue time with "Missing required field 'runs-on'". This is the exact class of "GitHub rejects before queue" defect the gate is designed to catch.

---

### MAJOR

**2. Job with both `steps` AND `uses` not flagged**  
**File:** `.github/scripts/check-workflow-structure.js`  
**Lines:** 160–172  
When a job has `steps`, the function returns early at line 167 (`return;`), skipping the `uses` check entirely. GitHub Actions forbids a job from having both `steps` and `uses` (they're mutually exclusive), but this validator would silently accept it.

**3. `isAllowedEmpty` whitelist comment misleading / potential gap**  
**File:** `.github/scripts/check-workflow-structure.js`  
**Lines:** 87–93  
The comment states "全部 null 值恰好就是 on/*/workflow_dispatch 这 8 处" but the implementation allows **any** depth-2 key under `on` (e.g., `on.schedule:`, `on.workflow_call:`, `on.registry_package:`). This is actually correct behavior (GitHub allows empty config for all event types), but the comment is factually wrong and could mislead future maintainers into thinking the whitelist is narrower than it is.

---

### MINOR

**4. No test for reusable workflow jobs (`jobs.<id>.uses`)**  
**File:** `.github/scripts/check-workflow-structure.test.js`  
The test suite covers `JOB_NO_ACTION_TARGET` for jobs with neither `steps` nor `uses`, but **has no positive test** for a valid reusable workflow job (e.g., `jobs: call-another: uses: owner/repo/.github/workflows/called.yml@main`). This pattern is explicitly supported at lines 169–172 but untested.

**5. No validation of `permissions` string shorthand**  
**File:** `.github/scripts/check-workflow-structure.js`  
The validator doesn't inspect `permissions` at all. GitHub accepts both object form (`permissions: { contents: read }`) and string shorthand (`permissions: read-all` / `write-all` / `none`). Not a bug (out of scope), but worth noting as a known gap if the gate ever expands scope.

**6. Gate 3 `shell: bash` change — low risk but verify Node path handling**  
**File:** `.github/workflows/quality-gate.yml` (diff lines 33–37)  
Switching from default `pwsh` to `shell: bash` is correct for fail-fast semantics. Risk is minimal because:
- All invoked scripts are Node.js (`node --test ...`, `node .github/scripts/check-workflow-structure.js`)
- They use `path.join`, `fs`, `os.tmpdir()` — cross-platform APIs
- No shell-specific commands (no `cp`, `mv`, `ls`, etc.) in the `run` block
**Verify:** The CLI test at line 374–406 uses `execFileSync(process.execPath, [script], ...)` which is correct for cross-platform Node invocation.

---

### INFO

**7. `walkNulls` correctly handles block scalars for `run`**  
**File:** `.github/scripts/check-workflow-structure.js`  
**Line:** 130  
The check `typeof step.run !== 'string' || step.run.trim() === ''` works for YAML block scalars (`|` / `>`) because `js-yaml` parses them as strings. No false positive here.

**8. Matrix / `if` expressions / `needs` / `concurrency` / `environment` — intentionally out of scope**  
The gate targets "structural defects that cause GitHub to reject at queue time" (empty required nodes, missing required fields). Matrix, conditionals, and concurrency are semantic/configuration concerns, not queue-rejection structural defects. Current scope is appropriate.

**9. CI wiring test is strong**  
**File:** `.github/scripts/check-workflow-structure.test.js`  
**Lines:** 413–434  
The test verifies: Gate 3 uses `bash`, both test file and CLI are invoked, and `.github/workflows/**` is **not** in `CI_IGNORED_PATHS` (prevents docs-only short-circuit). This is a good defense-in-depth check.

---

### Summary

| Level | Count |
|-------|-------|
| CRITICAL | 1 |
| MAJOR | 2 |
| MINOR | 3 |
| INFO | 3 |

**Top priority fix:** Add `runs-on` validation in `checkJob` for jobs that have `steps` but not `uses`. This closes the exact gap that lets a "GitHub rejects at queue" workflow pass the gate.
