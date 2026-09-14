# Review：参考产品账号与发布 parity 续作

日期：2026-08-05
分支：`codex/mp-parity-followup-20260804`

## 结论

- **Critical：无。** 未发现会阻断交付的逻辑、安全或构建问题。
- **Warning：4 个既有 ESLint unused warning。** `Accounts.vue` 中 `groupedPlatforms`、`addAccountForPlatform`、`setDefault`、`openPlatform` 未使用；本轮未引入，未擅自扩大范围修复。
- **Warning：二维码预览允许任意 HTTPS/Blob 来源。** 当前 IPC 事件链没有发现可被外部网页伪造的入口；保留 HTTPS 是为了兼容逆向资料中平台页面提取远程二维码图片的真实流程。后续如能取得平台 host 白名单，可再收敛。
- **Info：外部 Antigravity/Claude 双模型审查不可用。** wrapper 在本机分别出现 WSL `ERROR_PATH_NOT_FOUND`/`agy command not found in PATH` 与 Claude wrapper exit code 1；因此本记录只声明本地静态审查、定向审查代理和自动化测试证据，不把外部审查误报为通过。

## 本轮改动核验

- 账号 IPC 对公开账号字段做白名单和别名归一化，检查原因做敏感片段脱敏与 240 字符上限，凭据和未知字段不透传。
- `account:set-proxy` 等待异步持久化完成并统一转换错误；代理对话框保留类型/端口但不回显主机、用户名和密码。
- 二维码事件只渲染 PNG/JPEG/WebP data URL、HTTPS 或 Blob 图片，拒绝 `javascript:`、SVG data URL 和其他协议。

## 验证证据

| 检查 | 结果 |
|---|---|
| 账号 IPC、代理组件定向 Vitest | 35/35 passed |
| 账号 Store/视图/组件/发布 API 定向 Vitest | 383/383 passed |
| 账号事件与二维码视图定向 Vitest | 77/77 passed |
| 桌面完整 Vitest | 357 files / 6135 tests passed，exit 0 |
| ESLint 受影响文件 | 0 errors，4 个既有 warnings |
| Vue renderer/preload build | `npm run build:vue` exit 0 |
| 视觉像素回归 | 17/17 passed |
| Windows electron-builder | exit 0 |
| ASAR 清单 | 包含 `electron/ipc-handlers/account.js`、`electron/preload/index.bundle.js` 和 Accounts renderer chunks |
| ASAR require | 解包后输出 `ACCOUNT_IPC_REQUIRE_OK` |
| 打包启动 | `Multi-Publish.exe` 启动后 8 秒仍存活；捕获 stderr 无内容 |
| diff hygiene | `git diff --check` 无错误 |

## 交付边界

本轮证据覆盖本地 IPC、renderer、Vue 构建、视觉基线、ASAR require 和打包启动；不等同于真实第三方登录、Cookie 恢复、真实平台上传/发布、团队分享、审核、跨设备同步或外部双模型服务可用性。
