# PRD：主后端数据目录健壮性合同（2026-09-20）

> 关联：mainBackend「主服务已停止」事故复盘（cmd set 尾随空格 → 路径中间空白 → mkdir WinError 3）；
> 启动器侧治本修复见 main `scripts/mp-applive-launcher.ps1`；本 PRD 约束运行时纵深防御（PR #2109）。

## 背景

`ELECTRON_USER_DATA_DIR` 经 cmd `set VAR=val &` 形态注入时会携带尾随空格，Node `path.join` 后空格落在路径中间，Python 侧 `.strip()` 无法修复，`DATA_DIR.mkdir(parents=True)` 抛 `WinError 3`，mainBackend 静默启动失败。

## 合同要求

1. **环境变量消费点归一化**：Electron/脚本层所有读取 `ELECTRON_USER_DATA_DIR` 并派生路径的消费点（`dev-launcher.js`、`python-bridge.js`、`account-state-restorer.js`、`startup-compat.js`），必须先 `trim()` 再使用；空字符串视为未配置并回退默认目录。
2. **数据目录 fail-fast**：`packages/python-backend` 的数据目录解析集中于 `src/data_dir.py::ensure_data_dir`——strip 首尾空白；`mkdir` 失败时以 `SystemExit` 终止并打印 `repr(path)`（FATAL 消息为英文运维文案，不进入用户可见 i18n 通道），让隐形空白腐蚀变成可读启动错误。
3. **启动验证契约**：launcher 启动成功判定必须同时满足「窗口出现」+「8299 端口 Listen」，仅窗口可见不构成通过。

## 回归保护（已随 PR #2109 落地）

- `dev-launcher.test.js`：尾随空格 env 归一化（node --test 5/5，RED 已验证）
- `python-bridge.integration.test.js`：spawn env `MULTI_PUBLISH_DATA_DIR` 无任何空白断言
- `account-state-restorer.test.js`：尾随空格 env 仍写入规范目录
- `tests/test_data_dir.py`：strip/回退/fail-fast 6 例（pytest 23/23）

## 边界说明

- `ensure_data_dir` 的 FATAL 消息面向开发者/运维（启动期无渲染端），故使用英文硬编码；新增**运行时用户可见**错误仍必须走 `UserVisibleError(error_code)` + 渲染端 locale（i18n-content-sync）。
- 修改 `server.py` 中部代码段时保持行数净增为零，避免 `locale-py-cjk-baseline.json` 的 `file:line` 基线漂移造成存量命中误报。
