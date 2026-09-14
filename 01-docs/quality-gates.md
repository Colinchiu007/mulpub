# Multi-Publish — 质量门禁

## 阶段门禁


**PRD 阶段**：MVP 范围清晰 ✅ / 验收标准可验证 ✅ / CEO 签字确认 ✅
**架构阶段**：最简单方案 ✅ / 目录结构明确 ✅
**开发阶段**：测试全通过 ✅ / 核心功能可手动验证 ✅ / 错误处理到位 ✅
**Code Review**：CRITICAL 问题已修复 ✅ / 代码规范一致 ✅
**发布阶段**：安装包可用 ✅ / git 已提交并 tag ✅

---

## 实用沟通模板

## 强制质量门禁


> 违反以下任何一条，任务不算完成。

### QM-1：electron 主进程代码 — 本地打包验证

每次修改 `apps/desktop/electron/` 下的代码后，**必须**在本地执行一次：

```bash
cd apps/desktop && node ../../node_modules/electron-builder/cli.js --win --x64
```

- ✅ 返回 exit code 0 → 提交代码
- ❌ 打包失败 → 修复后重新打包，直到成功
- ❌ 打包成功但应用启动报错 → 修复后重新打包

**不打包不提交。** 单元测试不能替代完整打包验证（require 路径、文件 glob 覆盖、语法错误等只能在打包产物中检测）。

### QM-2：代码审查必检项

Code review 时除逻辑正确性外，必须逐项检查：

- **require 路径**：每个 `require('../x')` / `require('./y')` 的解析目标文件是否真实存在
- **注释语法**：`/* */` 成对出现，`* text` 开头的行必须前面有 `/*`
- **模块导出**：`module.exports = {` 后不能有多余逗号
- **文件 glob 覆盖**：`package.json` 的 `files` 数组必须包含所有被 require 的非 node_modules 文件

### QM-3：测试策略

- 旧“56 个单元测试”是历史快照，不能作为当前质量结论。
- 当前任务的真实执行结果、Story2Video 聚焦集、串行全量、preload 双 sandbox、真实 ffmpeg、视觉与 Windows 打包门禁统一记录在仓库根 `.quality-gates.md`。
- 本地打包验证覆盖 require 链、文件包含、语法；启动验证必须同时检查 stderr，不能只看进程存活。

## 新增模块（参考产品逆向分析集成）
