# CI 失败完整修复计划 - 2026-09-20 (更新版)

## 📊 当前状态总结

### ✅ 已完成的修复

1. **ProfileMenu 弹出层头像移除** - 已提交到 main 分支
   - 移除了不必要的头像图标
   - 简化了用户信息展示
   - 可能触发视觉回归测试

2. **TabStore API 测试修复** - 已提交到 main 分支
   - 修复了 `window.electronAPI.pageManager` 的测试设置
   - 解决了 'getAllTabs is not a function' 错误
   - 本地测试全部通过 ✅

### ⏳ 待修复的 CI 失败项 (剩余 13 个)

---

## 🔴 Priority 1: QG Coverage - ENOENT 文件路径错误

### 错误信息
```
ENOENT: no such file or directory
```

### 根本原因分析
ExecutionRecorder 在写入文件时遇到路径不存在的问题。

**相关代码**:
- `apps/desktop/electron/services/execution-recorder.js`
- `apps/desktop/electron/core/container.setup.js` (第 78, 289 行)

### 修复方案

#### 确保目录存在
在 `execution-recorder.js` 中添加目录创建逻辑：

```javascript
// 在 _handleEvent 方法中，写入文件前确保目录存在
const projectDir = this.projectService.getProjectDirectory(projectId)
const replayDir = path.join(projectDir, 'replay')

// 添加目录创建
if (!fs.existsSync(replayDir)) {
  fs.mkdirSync(replayDir, { recursive: true })
}
```

#### 验证步骤
```bash
cd apps/desktop
pnpm test -- execution-recorder.test.js
```

---

## 🔴 Priority 2: QG Static - workflow_dispatch 检查失败

### 错误信息
```
'quality-gate 必需保留 workflow_dispatch'
```

### 现状分析
`quality-gate.yml` 第 21 行已有：
```yaml
workflow_dispatch:  # 必需保留，用于手动触发质量节拍检查
```

### 可能原因
1. **检查脚本 Bug**: `.github/scripts/workflow-contract.test.js` 可能有逻辑错误
2. **YAML 格式问题**: 缩进或格式不符合检查器要求

### 修复方案

#### 检查 workflow-contract.test.js
**文件**: `.github/scripts/workflow-contract.test.js`  
**行动**:
1. 查看检查逻辑
2. 确认是否正确识别 `workflow_dispatch`

#### 验证 YAML 格式
```bash
node -e "const yaml = require('js-yaml'); const fs = require('fs'); const doc = yaml.load(fs.readFileSync('.github/workflows/quality-gate.yml', 'utf8')); console.log(JSON.stringify(doc.on, null, 2))"
```

---

## 🔴 Priority 3: QG Visual - 视觉回归测试

### 原因
ProfileMenu 修改导致布局变化（预期变更）

### 修复方案

#### 更新视觉基线
**命令**:
```bash
cd apps/desktop
pnpm run test:visual --update
```

或者根据项目配置使用正确的命令

---

## 🔴 Priority 4: 债务熔断检查

### 需要查看详细指标
目前无法通过 `gh run` 获取详细信息

### 可能的超标项
1. **代码覆盖率下降**: 新增代码未覆盖
2. **技术债务累积**: TODO/FIXME 数量过多
3. **依赖安全漏洞**: npm audit 发现问题

---

## 🎯 下一步行动计划

### Step 1: 修复 ENOENT 错误 (预计 45 分钟)
1. 检查 ExecutionRecorder 路径逻辑
2. 添加目录创建保护
3. 运行集成测试验证
4. 提交并推送

### Step 2: 修复 workflow_dispatch 检查 (预计 20 分钟)
1. 检查 workflow-contract.test.js
2. 修复检查逻辑或 YAML 格式
3. 运行静态检查验证

### Step 3: 更新视觉基线 (预计 15 分钟)
1. 运行视觉测试更新命令
2. 确认基线更新正确
3. 提交更新的基线文件

### Step 4: 解决债务指标 (预计 60 分钟)
1. 查看详细指标
2. 制定改进计划
3. 分批修复

---

## 📝 实施记录

### 2026-09-20 10:16
- ✅ 完成 TabStore API 测试修复
- ✅ 本地测试全部通过 (6/6)
- ✅ 提交到 main 分支
- ⏳ 等待 CI 验证

### 2026-09-20 09:57
- ✅ 完成 ProfileMenu 弹出层头像移除
- ✅ 提交到 main 分支
- ⏳ 等待 CI 验证

---

## 📚 参考文档

- `PR-2066-CI-FIX-TRACKING.md` - 完整 CI 跟踪报告
- `DASHBOARD-I18N-FIX-REPORT.md` - i18n 修复案例
- `CI-FIX-PROGRESS-20260920.md` - 进展报告
- `AGENTS.md` - 开发流程规范
- `.quality-gates.md` - 质量门禁标准

---

## 🚨 注意事项

1. **不要跳过质量门禁**: 所有修复必须通过 CI 检查
2. **保持分支隔离**: 每个修复在一个独立的 feature branch 进行
3. **充分测试**: 修复后必须进行充分的本地测试
4. **文档同步**: 更新相关文档和报告

---

**最后更新**: 2026-09-20 10:18
**状态**: 进行中
**已完成**: 2/5 主要问题
**进度**: 40%
