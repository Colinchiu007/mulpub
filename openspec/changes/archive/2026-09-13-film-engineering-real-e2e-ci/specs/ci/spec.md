## ADDED Requirements

### Requirement: 电影工程真实 E2E 默认门禁

Build & Release 的 Windows build job SHALL 在执行 `electron-builder --win --x64 -p never` 后运行 `pnpm --filter @multi-publish/desktop test:e2e:film-engineering`；该步骤失败 SHALL 使整个 job 失败并阻塞 PR 合并。E2E 报告 SHALL 输出到 `apps/desktop/tests/e2e/reports/film-engineering-real`，并在成功或失败时上传为 artifact。

E2E 启动参数 SHALL 包含 `--lang=zh-CN`，且关键操作按钮 MUST 使用稳定 `data-testid` 定位，不得依赖 runner 默认语言文案。

#### Scenario: PR 包含电影工程代码变更

- **WHEN** PR 触发 Build & Release Windows job 且打包成功
- **THEN** job 使用 `dist-electron/win-unpacked/Multi-Publish.exe` 启动真实 Electron，完成电影工程 24 项检查；任一检查失败导致 job 失败

#### Scenario: 无外部图片 Provider

- **WHEN** 临时 profile 未配置图片 Provider，其余流程正常
- **THEN** E2E 记录“生成被 Provider 配置阻断”为环境阻断而非失败；参数校验或页面错误仍按失败处理

### Requirement: 证据保留

Build & Release Windows build job SHALL 上传 `film-engineering-real-e2e.json`、截图、主进程 stdout/stderr 日志作为 artifact，且上传步骤不得因 E2E 失败被跳过。

#### Scenario: E2E 失败

- **WHEN** 电影工程 E2E 任一检查失败
- **THEN** job 保存并上传失败截图与 JSON 报告，随后以非零退出码结束
