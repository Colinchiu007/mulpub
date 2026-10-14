# 轴 1（逻辑/安全/规格合规）外部评审结论原件 — 审查对象 = 提交 9c2aec9b5（处置落在 37c31668d）
# 模型 opencode/nemotron-3-ultra-free（第一选择 exo-free 已废弃、零结论）；VERDICT: CHANGES，6 条发现
# 我的逐条处置见 openspec/records/gui-test-required-shape.md 的 QM-6 行

### 1. **Critical** | `.github/workflows/gui-test.yml:71-74` | **If `changes` job fails, `gui-test` job never runs — required check "never arrives" at job level**

The `gui-test` job has `needs: [changes]` but **no `if: always()`**. In GitHub Actions, when a job has `needs`, it only runs if all needed jobs **succeed** (default). If `changes` fails (script error, git fetch failure, etc.), `gui-test` is **skipped entirely** — no check run is created. This replicates the exact "never arrives" problem the commit tries to solve, but at the job level instead of trigger level.

**Evidence**: 
```yaml
# gui-test.yml lines 71-74
gui-test:
  needs: [changes]
  if: github.event_name != 'pull_request' || needs.changes.outputs.gui-relevant == 'true'
```

When `changes` fails:
- `needs.changes.result` = `'failure'`
- `gui-test` job doesn't run (default `needs` behavior requires success)
- No "GUI Tests / gui-test" check run appears
- Required check (when added) would be missing → merge blocked

**Compare with `quality-gate.yml`**: It has a `gate-result` job with `if: always()` and `needs: [changes, ...all jobs...]` that runs even when upstream fails, detects `needs.changes.result != 'success'`, and fails visibly.

**Suggested fix**: Add a `gate-result`-equivalent aggregator job with `if: always()` that depends on both `changes` and `gui-test`, checks `needs.changes.result`, and fails if `changes` failed. Or add `if: always()` to `gui-test` and handle missing output inside the job (but then Windows runner spins up unnecessarily).

---

### 2. **Warning** | `.github/workflows/gui-test.yml:54-55` | **`workflow_dispatch` and tag push: `github.event.pull_request.*` is empty but early exit handles it correctly**

For non-PR events (`workflow_dispatch`, `push` tags), `${{ github.event.pull_request.base.sha }}` and `${{ github.event.pull_request.head.sha }}` resolve to empty strings. The bash script correctly early-exits before using them:

```bash
if [ "${{ github.event_name }}" != "pull_request" ]; then
  echo "gui-relevant=true" >> "$GITHUB_OUTPUT"
  exit 0
fi
```

**However**: The `EVT_BASE_SHA`/`EVT_HEAD_SHA` env vars are still set to empty strings. This is harmless because the early exit happens first, but it's slightly confusing. The `ci-pr-changeset.js` is never called for non-PR events.

**Suggested fix**: Wrap the `env` block in an `if` or move the env vars inside the PR branch of the script for clarity.

---

### 3. **Critical** | `scripts/ci-gui-relevance.js:44-51` | **CLI fail-closed is correct for git errors, but empty change set returns `gui-relevant=false` (skips GUI tests)**

- **Git failure**: Correctly exits 1, writes to stderr, **does not write `GITHUB_OUTPUT`** — verified by mutation N7/N8 and CLI test.
- **Empty change set** (`base==head`): `changedFileStatuses` returns `[]` → `isGuiRelevant([])` returns `false` (line 23: `files.some(...)` on empty array is `false`).

**Is this reasonable?** For a genuinely empty PR (no file changes), skipping GUI tests is acceptable. But if `git diff` returns empty due to a subtle error (e.g., merge-base resolution issue), it would silently skip. The `changedFileStatuses` throws on git errors, so empty array only occurs for truly empty diffs.

**Suggested fix**: Document this behavior explicitly. Consider adding a warning log when `entries.length === 0` to surface potential misconfigurations.

---

### 4. **Warning** | `scripts/ci-gui-relevance.js:3` + `scripts/classify-docs-only.js:58-67` | **`matchesPattern` coupling: semantic differences from GitHub paths matching**

`ci-gui-relevance.js` reuses `matchesPattern` from `classify-docs-only.js`. The implementation:
```javascript
function matchesPattern(filePath, pattern) {
  if (pattern.endsWith('/**')) {
    return filePath.startsWith(pattern.slice(0, -3) + '/')
  }
  if (pattern === '*.md') {
    return !filePath.includes('/') && filePath.endsWith('.md')
  }
  return filePath === pattern
}
```

**Differences from GitHub paths semantics**:
| Aspect | GitHub `paths` | `matchesPattern` |
|--------|----------------|------------------|
| Case sensitivity | Case-insensitive on Windows/macOS runners | **Case-sensitive** (string `startsWith`/`===`) |
| `**/*.md` (all .md at any depth) | Supported | **Not supported** — only root `*.md` |
| `dir/**/*.ext` | Supported | Not supported |

**Current impact**: `GUI_PATHS` only uses `dir/**` and literal paths, so the unsupported patterns don't matter **today**. But the case-sensitivity difference means on Windows runners, `Apps/Desktop/file.vue` (wrong case) would not match `apps/desktop/**`, while GitHub's trigger would match it.

**Suggested fix**: Add a comment documenting the case-sensitivity assumption. If `GUI_PATHS` ever expands to use `**/*.ext` patterns, `matchesPattern` will need enhancement.

---

### 5. **Info** | `apps/desktop/tests/gui-ci-exit-contract.test.js:225-305` | **Tests are substantive, not decorative — CLI end-to-end test is excellent**

The test suite includes:
- Workflow YAML structure assertions (no `paths` in PR trigger)
- `GUI_PATHS` content verification
- `isGuiRelevant` behavior matrix (relevant/irrelevant/empty)
- `gui-test` job `needs` + `if` wiring check
- **CLI end-to-end test** (lines 250-305): Creates real git repo, makes commits, runs actual CLI, verifies:
  - Doc changes → `gui-relevant=false` written to `GITHUB_OUTPUT`
  - Desktop changes → `gui-relevant=true` + hit files listed
  - Git failure (`definitely-not-a-ref`) → `rc=1`, **no `GITHUB_OUTPUT` file created**
  - Normal path → `GITHUB_OUTPUT` actually appended

**Mutation testing confirms**: 8/8 mutations caught (N1-N8), including N7 (fail-closed writes `gui-relevant=false` + exit 0) and N8 (no `GITHUB_OUTPUT` write).

**No decorative locks found** — all assertions test actual behavior, not just "function was called".

---

### 6. **Critical** | `.github/workflows/gui-test.yml:18-20` | **`cancel-in-progress` + `changes` job failure = required check missing on last run**

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

For PRs, `cancel-in-progress: true`. If a PR has multiple pushes:
1. Run 1 starts, `changes` job fails → `gui-test` doesn't run → no check
2. Run 2 starts, cancels Run 1
3. Run 2 succeeds → check appears

**But**: If the **last** push's `changes` job fails, the final state has **no "GUI Tests / gui-test" check run at all**. When this check is added to required (classic/ruleset), the PR will be blocked with "Required check never ran" — not "failed", not "skipped", but **absent**.

This is the same structural flaw as the original trigger-level paths filter, moved one level down.

**Suggested fix**: Same as Finding 1 — add an aggregator job with `if: always()` that ensures a check run exists even when `changes` fails.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 3 (Findings 1, 3-partially, 6) |
| Warning  | 2 (Findings 2, 4) |
| Info     | 1 (Finding 5) |

---

## VERDICT: CHANGES

The commit correctly solves the **trigger-level** "never arrives" problem by moving path filtering to a `changes` job, enabling `skipped` status for irrelevant PRs. However, it introduces a **job-level** "never arrives" failure mode: if the `changes` job itself fails, the downstream `gui-test` job doesn't run (due to `needs` without `if: always()`), and no aggregator job exists to surface the failure as a visible check run. This will block merges when the check is added to required.

**Required fixes before merge**:
1. Add an aggregator job (like `gate-result` in `quality-gate.yml`) with `if: always()` that depends on `changes` and `gui-test`, checks `needs.changes.result`, and fails visibly if `changes` failed.
2. Document the empty-change-set behavior in `ci-gui-relevance.js`.
3. Consider adding case-insensitive matching to `matchesPattern` or documenting the limitation.
OPENCODE_RC=0
