# 视觉门禁修复审查

日期：2026-08-04

## 外部双模型

- Antigravity：wrapper 真实失败，`agy command not found in PATH`。
- Claude：wrapper 真实启动后退出码 `1`，未产生报告。

外部交叉审查不可用，未将其记为通过。

## 本地审查

### Critical

- 未发现 Critical。

### Warning

- 账号页基线由旧账号页布局刷新为本次参考产品 parity 布局，属于预期 UI 改版；已通过本地 17/17 像素门禁和既有参考产品 3/3 审计，仍应由 PR reviewer 关注二进制基线的人工可读性。
- 全量桌面 Vitest 的两个既有失败仍独立存在，未由本修复引入。
- 外部双模型不可用，保留 wrapper 原始输出。

### Info

- 根因是视觉测试选择器分散且未与页面稳定容器合同同步；本次同步像素、全视图、功能和条件等待四处，并新增 `visual-ci.test.js` 断言。

## 结果

- `visual-ci.test.js` + `condition-waiting.test.js`：40/40 passed。
- 与 CI 同口径 `run-pixel-tests.js`：17/17 passed。
- `all-views.visual.test.js`：24 个路由检查通过。
- `git diff --check`：通过。

## 结论

**CONDITIONAL APPROVE**：修复范围内没有本地 Critical，且远端视觉门禁失败已复现、修复并本地回归；外部审查工具不可用和全量既有失败继续按边界披露。
