# Review — mp-account-sort-status-parity

## Scope

本审查覆盖账号 Store 排序、Accounts.vue 排序控件、AccountManagementCard 状态/检查记录、相关测试与 PRD/逆向文档。

## External model review

- Antigravity wrapper：未运行，`agy command not found in PATH`。
- Claude wrapper：未运行，wrapper 退出码 `1`。
- 因此没有声称双模型审查通过；以下为本地静态审查和可执行门禁证据。

## Findings

### Critical

- 无。

### Warning

1. 完整桌面 Vitest 未通过：`334 passed / 53 failed / 10 skipped`（357 files）。失败主要是续作工作树临时依赖闭包不完整，具体缺少 `jsdom`、`js-yaml`、`sharp`、`playwright`、`electron` 和若干 `@multi-publish/*` 运行时包；失败栈不指向本轮三个账号组件/Store测试。定向测试与 Vue 构建已单独通过，不能把完整套件结果报告为全绿。
2. Prettier `--check` 对 6 个本轮文件报告既有全文件格式差异；未执行全文件自动格式化，避免引入无关大 diff。定向 ESLint 为 0 error、4 warnings，warning 是 Accounts.vue 既有未使用 `groupedPlatforms`、`addAccountForPlatform`、`setDefault`、`openPlatform`。
3. 视觉/功能自动化真实浏览器回归未完成：完整套件中的 visual-contract 用例因缺少 `playwright` 依赖而失败；本轮证据只覆盖组件渲染和 renderer 编译，不等同于真实窗口截图像素通过。
4. 状态排序当前将 `active/online` 归为有效，其余状态归为无效二级；这与状态筛选合同一致，但不会在排序中区分 offline、error、unknown 的细粒度顺序。若后续产品要求四态排序，应新增明确 rank 和验收用例，不应隐式改变当前合同。

### Info

- 名称排序已统一使用 `account_name || name`，与卡片可见名称一致，避免排序字段与显示字段冲突；该一致性回归在首次 wrapper 尝试后补入并重新通过定向测试。
- 缺失/非法日期和粉丝数使用 `-Infinity`；升序置前、降序置后，并以筛选结果中的原始索引做稳定 tie-break。
- 状态徽章提供稳定 `data-testid`、`role=status`、`aria-label`；未知状态显示“暂无检查记录”，不伪造第三方在线结果。
- 检查时间字段优先，非法/缺失后才回退异常原因；完全缺失显示“暂无检查记录”。异常徽章和非法检查时间回退也有组件回归覆盖。

## Passing evidence

- 定向 Vitest：3 files / 153 tests passed（包含名称优先级和异常原因回退新增回归）。
- Vue renderer/preload build：`npm run build:vue` exit 0；仅有既有动态导入、大 chunk 和依赖注释 warning。
- 定向 ESLint：0 errors，4 个既有 unused-vars warnings。
- `git diff --check`：通过。
- `node --check`/Vitest 编译覆盖变更 JS/Vue 文件：通过。

## Verdict

`REQUEST_CHANGES` 仅针对环境门禁和外部审查不可用证据；本轮账号排序、状态徽章和检查记录实现满足本地验收合同。合并前必须保留上述边界，不能宣称真实参考产品第三方授权、Cookie 恢复、线上状态或视觉像素 100% 已验证。