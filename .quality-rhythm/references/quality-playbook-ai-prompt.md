# OpenMontage → Multi-Publish 迁移质量路线图
## AI 会话启动提示词模板

> **用法**: 每次开始一个新的编码会话时，将这份提示词粘贴给 AI，让它自动按路线图执行。
> 如果会话聚焦某个特定 Phase，在末尾追加 "当前焦点：Phase N"。

---

## 一、主提示词（Session 启动时粘贴）

```
你正在执行 OpenMontage → Multi-Publish 的视频创作模块迁移项目。

## 项目背景
Multi-Publish（D:\Data\projects\mulpub）是一个多平台一键发布桌面应用（Electron + Vue 3）。
OpenMontage（D:\Projects\OpenMontage）是一个 AI 视频制作平台，当前已将 Remotion 前端（~5%）移植过来，
但 Python 后端工具链（70+ 模块）和 Pipeline 编排系统（13 条管线）完全缺失。

迁移规划的 5 个 Phase 见 01-docs/migration-plan-opermontage.md。
产品需求见 01-docs/PRD-video-creation.md。
开发流程规范见 AGENTS.md。

## 质量铁律（必须遵守）
在整个开发过程中，你必须主动按以下顺序调用对应的技能/流程：

### 需求与规划阶段
1. planning-with-files —— 开始任何编码前，先读取 OpenMontage 对应功能的完整源码，列出所有接口和参数
2. planning-and-task-breakdown —— 把本次任务拆成 ≤4h 的子任务，标注依赖关系
3. source-driven-development —— 实现时以 OpenMontage 源码为 spec，参数名/类型/行为必须对齐
4. spec-driven-development —— 先写接口定义，再写实现

### 编码阶段（TDD 优先）
5. test-driven-development —— 所有新代码必须先写测试再写实现，测试覆盖 normal/error/edge 三态
6. doubt-driven-development —— 每次 copy-paste 前主动质疑：这个在 Windows Electron 环境能跑吗？
7. code-simplification —— 在 OpenMontage 代码基础上做减法，只保留 Multi-Publish 需要的路径
8. incremental-implementation —— 严格按子任务列表推进，未完成的子任务不跳过的
9. subagent-driven-development —— 互不依赖的任务可以并行（如多个前端组件 / 多个 Python 工具）
10. dispatching-parallel-agents —— 并行任务要明确划分写范围，避免冲突
11. context-engineering —— 每次 session 开始时，先读取当前 Phase 的目标文件和对应的 OpenMontage 源文件

### 代码评审阶段
12. code-review-and-quality —— 每完成 2-3 个功能，做一次代码审查，覆盖逻辑/安全/边界/性能
13. testing-anti-patterns —— 审查测试本身的质量：不 mock 不该 mock 的东西
14. receiving-code-review —— 收到审查意见后逐条确认，不辩解，快速修复
15. requesting-code-review —— 发起审查时提供 diff + 测试结果 + 审查重点

### 集成调试阶段
16. investigate —— 出现"OpenMontage 能跑但 Multi-Publish 不能跑"的问题时，严格执行：
    - Phase 1: 复现 + 检查代码 + 对比两个项目的差异
    - Phase 2: 跟踪数据流
    - Phase 3: 一次验证一个假设
    - Phase 4: 修根因而不是症状
    - Phase 5: 输出 DEBUG REPORT
17. careful —— Python 桥接首次联调时，每步确认结果再前进
18. systematic-debugging —— 数据流跟踪 + 二分法缩小范围
19. defense-in-depth —— 每个集成点做多层保护：ffprobe 验证输出、超时保护、错误恢复

### 验证与发布阶段
20. verification-before-completion —— 每个子任务完成时，对照 PRD 验收标准逐条确认
21. health —— 代码质量检查：测试覆盖率、依赖一致性、死代码
22. finishing-a-development-branch —— 分支完成标准化流程

### 复盘沉淀阶段
23. documentation-and-adrs —— 每个关键技术决策记录 ADR（为什么选这个方案）
24. learn —— 记录踩坑和兼容性问题到 learnings

## 输出要求
- 代码改动：使用 apply_patch，不要 rewrite 整个文件
- 审查报告：按 AGENTS.md 格式输出 🔴/🟠/🟢
- 测试：与实现代码在同一次提交中
- 进度：每次 session 结束时输出完成状态和下一步

## 当前焦点
Phase [填入当前 Phase 编号] —— [填入当前子任务名称]
```

---

## 二、Phase 专用补充提示词

### Phase 1 补充（基础渲染完善）

```
补充约束：
- 不要动 OpenMontage 的 remotion-composer 源码
- render-engine.js 的改动必须向后兼容（原有入参仍可用）
- 前端组件必须覆盖 loading / empty / error 三态
- 优先使用已有的 TaskQueue，不要重新造轮子
- 焦点文件列表：
  - apps/desktop/electron/render-engine.js
  - apps/desktop/electron/ipc-handlers/render.js
  - apps/desktop/src/views/CreateView.vue （重构）
  - apps/desktop/src/views/ResultView.vue （新建）
  - apps/desktop/src/components/ 下 12 个新组件
```

### Phase 2 补充（多模式扩展）

```
补充约束：
- 每个 Composition 模式对应一个独立的前端编辑器组件
- ModeSelector 从 Root.tsx 的 Composition 注册表自动发现
- TalkingHead / CinematicRenderer 需要先从 CreateView 的 buildProps 中拆分出独立的数据结构
- 焦点文件列表：
  - apps/desktop/src/components/ModeSelector.vue
  - apps/desktop/src/components/TalkingHeadEditor.vue
  - apps/desktop/src/components/CinematicEditor.vue
  - apps/desktop/src/components/CollageEditor.vue
  - apps/desktop/src/components/LyricEditor.vue
```

### Phase 3 补充（Python 工具链）

```
补充约束：
- Python 子进程管理复用已有的 python-bridge.js 模式
- 不要复制 OpenMontage 全部代码，用 submodule 或 pip -e 方式引入
- 每个 AI 提供商工具必须实现 get_status() → 检查 API Key 是否配置
- API Key 管理复用 apps/desktop/electron/credential-store.js
- 首次使用时懒加载检查环境，缺少依赖时给出明确安装指引
- 焦点文件列表：
  - apps/desktop/electron/openmontage-bridge.js （新建）
  - packages/openmontage-core/ （新建 submodule 或子集）
  - tools/video/hunyuan_video.py（适配）
  - tools/audio/openai_tts.py（适配）
  - tools/audio/audio_mixer.py（适配）
```

### Phase 4 补充（Pipeline 编排）

```
补充约束：
- Pipeline 定义使用 YAML 格式（与 OpenMontage 一致）
- 检查点协议先做内存态（重启丢失），再做持久化
- 预算管理先做 observe 模式（只记录不拦截），再升到 warn/cap
- Delivery Promise 分类器先做硬编码映射（见 migration plan 4.4），再做成可配置
- 素材检索优先做 Pexels + Pixabay，其余作为可选
```

### Phase 5 补充（增强完善）

```
补充约束：
- 人脸增强/背景移除等 OpenCV 工具需要先检测用户本机是否有 OpenCV
- 屏幕录制模式先做 FFmpeg 路径（不需要 GPU）
- 自定义 Playbook 保存在 styles/custom/ 目录
- 自动化测试覆盖所有新增工具
```

---

## 三、快速会话启动命令

如果不想贴整段提示词，可以用这个精简版：

```
阅读 01-docs/quality-playbook-ai-prompt.md 并按照其中的质量路线图执行当前任务：
1. 当前 Phase：[编号]
2. 当前子任务：[名称]
3. 涉及文件：[路径列表]
4. 本期目标：[一句话描述]
```

AI 读了这个 markdown 文件就会自动按路线图执行。你只需要告诉我 Phase 编号和任务名就可以开始。

---

## 四、常见场景应对

### 场景 1："AI 跳过测试写代码怎么办？"
→ 用验证技能：`verification-before-completion` + `testing-anti-patterns`
> 你在执行 TDD，先写测试。没看到测试代码之前不要写实现。

### 场景 2："出现看不懂的错误"
→ 用调试技能：`/investigate`
> 使用 investigate 技能：Phase 1 复现 → Phase 2 分析 → Phase 3 假设 → Phase 4 修复 → Phase 5 报告

### 场景 3："OpenMontage 和 Multi-Publish 代码对不上"
→ 用源码对齐技能：`source-driven-development`
> 使用 source-driven-development 技能，先完整读取 OpenMontage 对应文件，列出所有函数签名和参数，再对比 Multi-Publish 的差异。

### 场景 4："不知道当前开发顺序"
→ 用规划技能：`incremental-implementation`
> 使用 incremental-implementation 和 planning-and-task-breakdown，先告诉我当前 Phase 的完整子任务列表，我再推进。

### 场景 5："需要并行开发多个模块"
→ 用编排技能：`dispatching-parallel-agents`
> Phase 3 的 AI 视频提供商适配可以并行。使用 dispatching-parallel-agents 技能，为每个提供商启动一个独立 worker。

---

## 五、质量门禁速查表

| 关卡 | 检查内容 | 失败处理 |
|------|---------|---------|
| 测试覆盖 | 新代码有对应测试 | 补测试后再继续 |
| 三态覆盖 | 组件有 loading/empty/error | 补全后再合并 |
| 向后兼容 | render-engine.js 旧调用可用 | 修复后再合入 |
| API Key 安全 | 无硬编码密钥 | 迁移到 credential-store |
| 子进程清理 | 取消渲染时进程树完整清理 | 修复 before-quit 处理 |
| 跨平台路径 | 使用 path.join 不是硬编码 `/` | 修复所有路径处理 |
| 错误传播 | Python 错误能正确传到前端 UI | 补错误处理链 |
