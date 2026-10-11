---
record: cv-cjk-template3
task: CreateView 模板区 21 组硬编码文案迁 locales（遗留②第三子批，CJK 净还债 315）
date: 2026-10-12
sync_status: PENDING
sync_reason: PR 未合并，merge SHA 还不存在
sync_backfill_owner: 本会话下一轮或下一会话
---

## 本次执行记录：模板区 21 组文案迁 locales（cv-cjk-template3，2026-10-12）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时变更：隔离 worktree `mp-cv-cjk-template3` + 裸分支；共享根保持 main |
| CreateView/deep2/autosave | PASS | 299/299 |
| 全量 views+locales+overlay | PASS | 1800 passed / 1 skipped |
| Gate 7 `--cjk` | PASS | 基线 1489 → 当前 **1174**（净还债 315） |
| Gate 7 `--keys` | PASS | 1903 key 全存在 |
| 债务熔断 | PASS | 全指标基线内 |
| 品牌残留 | PASS | 8065 tracked 文件 |
| 行尾对账 | PASS | 两口径一致（3 文件） |
| QM-1 打包 | N/A | 未触 electron 主进程 |
| QM-4 视觉 | PASS | zh 文案逐字不变，CI QG Visual 为准 |
| QM-6 CCG 双模型评审 | PASS | i18n 迁移模式第 6 次复用，无方案外新决策 |
| 远程同步 | PENDING | 新载体：登记随本文件 frontmatter；合并后回填 PASS + merge SHA 并删 sync_* 字段 |

### 改动

- `CreateView.vue` 模板区：21 组静态文案 → `create.story2video.tpl.*`（导航按钮 title、placeholder×4、估算注释、识别/渲染/AI 写稿按钮、BGM 与配置 Profile 行内按钮 title、渲染错误前缀与兜底）；静态属性 `title="中文"` 改 `:title` 绑定形态
- `locales/create/{zh,en}.js`：`story2video` 直下新增 `tpl:` 子块（与 `ui:` 平级）21 键成对
- `locales/story2video/{zh,en}.js`：无改动（composeProgress 已在上一批）

### 排障记录（如实，含两次返工）

1. **键层级差一层**（本批核心教训）：tpl 键最初插在 `ui:` 块内 → 路径变成 `create.story2video.ui.tpl.*`，与壳引用的 `create.story2video.tpl.*` 差一层 → `--keys` 报 11 缺失且稳定复现。诊断过程：复刻门禁判定逻辑失败（resolveLocaleSpec 差异）→ 最终用**门禁脚本注入调试探针**（临时改跑、dump zhKeys.has 与文件 mtime、用后还原）定位「used 键路径 vs locale 树路径差一层」。修复：tpl 块移至 story2video 直下（与 ui 平级）
2. **同行改动触发 NEW CJK**：`ipcFailed` 前缀（插值外文本节点）在同行其他文案改动后判「新行」→ 一并迁移补键
3. **还原事故的自纠**：调试注入的门禁脚本改动用 `%TEMP%` 备份还原；中途误用旧备份造成 9 行差异，立即发现并从上游 `git checkout` 恢复正确版本

### 遗留（模板区仍余约 69 行 CJK）

L8-9 页面标题/副标题、L24-26 三个视图 tab、L47 返回、L58 段落标题、若干 `<span>` 文本节点等——均为**纯文本节点**（不在引号内），迁移方式与引号内字面量不同（`{{ $t() }}` 包裹），量级相当，留待下一子批或随视觉走查批量处理。

### 验证

| 项 | 结果 |
|---|---|
| CreateView + deep2 + autosave | 299/299 |
| 全量 views+locales+overlay | 1800 passed / 1 skipped |
