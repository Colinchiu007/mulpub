# 启动脚本 Python 解释器解析加固（fix-python-bridge）

## 背景
应用以裸 `python` 经三个 bridge 拉起 Python 服务：主服务(8299)、分句引擎(8002)、提示词优化引擎(8013)。
当从 PATH 含 WorkBuddy 托管 Python 3.13 的终端启动应用时，裸 `python` 会解析到缺少
`uvicorn` / `pydantic` / `splitter` 的 3.13 解释器，导致三项服务在 import 阶段崩溃，
服务面板显示「3 项服务不可用（2/6 运行中）」。

## 根因
`scripts/start-desktop.ps1` 只把 node 目录前置到 PATH，对 Python 不做任何处理，
完全继承调用方 PATH。因此从任意被托管 Python 截胡的环境启动都会踩坑。

## 修复（提交 1aa09f38）
1. `scripts/start-desktop.ps1`：node 自定位后新增 **Python 自定位块** —— 优先 `py -3.12`，
   回退 `...\Python312\python.exe`；命中即前置其目录到 PATH 并打印，
   使裸 `python` 恒指向系统 Python 3.12，不再依赖调用方终端。
2. 三处 bridge 的 `python` 硬编码改为
   `process.env.MP_PYTHON || process.env.PYTHON_PATH || (win32 ? 'python' : 'python3')`
   （`base-python-bridge.js:107` / `python-bridge.js:99` / `prompt-bridge.js:250`），
   与 `asset-generator.js:469` 的解析对齐，支持运行时覆盖且向后兼容（不设环境变量时行为不变）。

## 验证
以「Python 3.12 前置 PATH、剥离托管 3.13」重启后，CDP `servicesGetStatus()` 确认
主服务 / 分句引擎 / 提示词优化引擎均 `running`（reason=ok）；对齐引擎 `standby` 为
on_demand 设计行为。面板回到「6/6 可用」。
